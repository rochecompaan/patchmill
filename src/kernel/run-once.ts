import fs from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { resolve, join } from "node:path";
import {
  trustedAuthors,
  type PatchmillConfig,
  type LabelsConfig,
} from "../config/config.ts";
import type { Host, Issue } from "../host/types.ts";
import type { CommandRunner } from "../process/command.ts";
import type { PiCommandSpec } from "../cli/pi-cli.ts";
import type { KernelGit } from "./git.ts";
import { collectFacts, type Facts } from "./facts.ts";
import { derivePhase, type Derived, type Phase } from "./phase.ts";
import { acquireLock, LockHeldError } from "./lock.ts";
import { claimSwap, releaseSwap } from "./labels.ts";
import { renderRunEnvelope } from "./envelope.ts";
import { supervisePi } from "./pi-supervisor.ts";
import { parseAgentResult, lastJsonBlock } from "./result.ts";
import { verifyOutcome, type OutcomeLabel } from "./verify.ts";
import { sumSessionUsage, costLine } from "./pi-cost.ts";

export type RunOnceOptions = {
  issue?: number;
  dryRun?: boolean;
  planOnly?: boolean;
  signal?: AbortSignal;
};
export type RunOnceDeps = {
  host: Host;
  runner: CommandRunner;
  git: KernelGit;
  piCommand: PiCommandSpec;
  extensionPaths: string[];
  repoRoot: string;
  now: () => Date;
  output: { stdout: (line: string) => void; stderr: (line: string) => void };
};
export type RunOnceOutcome =
  | { status: "no-work" }
  | {
      status: "dry-run";
      issue: number;
      derived: Derived | "ambiguous-branches";
    }
  | { status: "claimed-elsewhere"; issue: number }
  | { status: "refused"; issue: number; reason: string }
  | { status: "stopped"; issue: number; label: OutcomeLabel; summary: string }
  | { status: "completed"; issue: number };

export function selectIssue(
  issues: Issue[],
  labels: LabelsConfig,
  explicit?: number,
): Issue | undefined {
  const eligible = issues.filter(
    (i) => i.state === "open" && !i.labels.includes(labels.inProgress),
  );
  if (explicit !== undefined)
    return eligible.find((i) => i.number === explicit);
  return eligible
    .filter((i) => i.labels.includes(labels.ready))
    .sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt))[0];
}

function initialDecision(
  facts: Facts,
  config: PatchmillConfig,
  ready: boolean,
): Derived {
  const derived = derivePhase(facts, config.workflow.specApproval.required);
  return ready && derived.kind === "stop" && derived.label === "specReview"
    ? { kind: "phase", phase: "planning" }
    : derived;
}

export async function runOneIssue(
  config: PatchmillConfig,
  deps: RunOnceDeps,
  options: RunOnceOptions,
): Promise<RunOnceOutcome> {
  const { host, git, repoRoot, now, output } = deps;
  const selected = selectIssue(
    await host.listOpenIssues(),
    config.labels,
    options.issue,
  );
  if (!selected)
    return options.issue === undefined
      ? { status: "no-work" }
      : {
          status: "refused",
          issue: options.issue,
          reason: "Issue is missing, closed, or already in progress.",
        };
  const issueNumber = selected.number;
  const ready = selected.labels.includes(config.labels.ready);
  const collect = (issue: Issue) => collectFacts({ ...deps, config }, issue);
  if (options.dryRun) {
    const result = await collect(selected);
    const derived =
      result.kind === "facts"
        ? initialDecision(result.facts, config, ready)
        : "ambiguous-branches";
    output.stdout(JSON.stringify({ issue: issueNumber, derived }));
    return { status: "dry-run", issue: issueNumber, derived };
  }
  const issueDir = resolve(
    repoRoot,
    config.paths.runsDir,
    `issue-${issueNumber}`,
  );
  let lock;
  try {
    lock = await acquireLock(join(issueDir, "lock"), { now });
  } catch (error) {
    if (error instanceof LockHeldError)
      return {
        status: "refused",
        issue: issueNumber,
        reason: "another Run attempt is active",
      };
    throw error;
  }
  const runId = randomUUID();
  const startedAt = now().toISOString();
  const runDir = join(issueDir, runId);
  const sessions: {
    phase: Phase;
    exitCode: number | null;
    timedOut: boolean;
    status: string;
  }[] = [];
  let label: OutcomeLabel = "needsInfo";
  let summary = "The session limit was reached.";
  let warnings: string[] = [];
  let finalBlock: string | undefined;
  let claimedElsewhere = false;
  try {
    try {
      const claim = claimSwap(config.labels);
      await host.setLabels(issueNumber, claim.add, claim.remove);
      const issue = await host.viewIssue(issueNumber);
      if (
        issue.state !== "open" ||
        !issue.labels.includes(config.labels.inProgress)
      ) {
        claimedElsewhere = true;
        return { status: "claimed-elsewhere", issue: issueNumber };
      }
      await fs.mkdir(runDir, { recursive: true });
      for (let index = 0; index < 3; index++) {
        const before = await collect(issue);
        if (before.kind === "ambiguous-branches") {
          summary = `Several issue branches exist: ${before.branches.join(", ")}`;
          break;
        }
        const facts = before.facts;
        const decision =
          index === 0
            ? initialDecision(facts, config, ready)
            : derivePhase(facts, config.workflow.specApproval.required);
        if (decision.kind === "stop") {
          label = decision.label;
          summary =
            label === "done"
              ? "The pull request is merged."
              : "The spec is ready for review. Approval is required.";
          break;
        }
        const phase = decision.phase;
        const skill = {
          name: phase,
          path: resolve(repoRoot, config.skills[phase]),
        };
        const promptPath = join(runDir, "prompt.md");
        const gate = config.workflow.specApproval.required;
        const envelope = renderRunEnvelope({
          repository: await host.repository(),
          issue,
          phase,
          facts,
          skill,
          gateRequired: gate,
          timeoutMinutes: config.pi.timeoutMinutes,
          trusted: trustedAuthors(config),
        });
        const revision =
          index === 0 && ready && derivePhase(facts, gate).kind === "stop";
        await fs.writeFile(
          promptPath,
          envelope +
            (revision
              ? `\nState: ${config.labels.specReview}. Approval label ${config.labels.specApproved}: absent. Revise the existing spec.\n`
              : ""),
        );
        const sessionDir = join(runDir, "sessions", String(index + 1));
        const logPath = join(runDir, `session-${index + 1}.log`);
        const session = await supervisePi({
          command: deps.piCommand,
          cwd: facts.worktree,
          agentDir: resolve(repoRoot, config.pi.agentDir),
          sessionDir,
          skillPath: skill.path,
          promptPath,
          logPath,
          extensionPaths: deps.extensionPaths,
          timeoutMs: config.pi.timeoutMinutes * 60_000,
          ...(options.signal ? { signal: options.signal } : {}),
        });
        const result = parseAgentResult(session.stdout);
        finalBlock = lastJsonBlock(session.stdout);
        sessions.push({
          phase,
          exitCode: session.exitCode,
          timedOut: session.timedOut,
          status: result.ok ? result.result.status : "invalid",
        });
        const after = await collect(issue);
        if (after.kind === "ambiguous-branches") {
          summary = `Several issue branches exist: ${after.branches.join(", ")}`;
          break;
        }
        const verified = verifyOutcome({
          issue: issueNumber,
          phase,
          result,
          session,
          facts: after.facts,
          gateRequired: gate,
          logPath,
          uncommitted: await git.hasUncommittedChanges(facts.worktree),
          unpushed: await git.unpushedCommits(facts.worktree, facts.branch),
        });
        if (verified.kind === "stop") {
          label = verified.label;
          summary = verified.comment;
          warnings = verified.warnings;
          if (phase === "planning" && !after.facts.specPath)
            summary += `\nExpected artifact: ${after.facts.expectedSpecPath}`;
          break;
        }
        if (options.planOnly && phase === "planning") {
          label = gate ? "specReview" : "needsInfo";
          summary = "planning complete";
          break;
        }
        const next = derivePhase(after.facts, gate);
        if (next.kind === "phase" && next.phase === phase) {
          summary = `The phase did not advance. Expected artifact: ${phase === "planning" ? after.facts.expectedPlanPath : after.facts.expectedSpecPath}`;
          break;
        }
      }
    } catch (error) {
      label = "needsInfo";
      summary = error instanceof Error ? error.message : String(error);
    } finally {
      if (!claimedElsewhere) {
        const cost = costLine(await sumSessionUsage(join(runDir, "sessions")));
        const line = `Issue #${issueNumber}: ${config.labels[label]}`;
        try {
          const release = releaseSwap(config.labels, label);
          await host.setLabels(issueNumber, release.add, release.remove);
          await host.commentIssue(
            issueNumber,
            [line, summary, cost, ...warnings].join("\n\n"),
          );
        } catch (error) {
          label = "needsInfo";
          const message =
            error instanceof Error ? error.message : String(error);
          summary += `\nFinalization failed: ${message}. Remote labels or comment are uncertain.`;
          output.stderr(message);
        } finally {
          const outcome: RunOnceOutcome =
            label === "done"
              ? { status: "completed", issue: issueNumber }
              : { status: "stopped", issue: issueNumber, label, summary };
          await fs.mkdir(runDir, { recursive: true });
          await fs.writeFile(
            join(runDir, "result.json"),
            JSON.stringify(
              {
                runId,
                issue: issueNumber,
                startedAt,
                finishedAt: now().toISOString(),
                outcome,
                sessions,
              },
              null,
              2,
            ),
          );
        }
        if (finalBlock !== undefined)
          output.stdout(`\`\`\`json\n${finalBlock}\n\`\`\``);
        output.stdout(`Issue #${issueNumber}: ${config.labels[label]}`);
        output.stdout(cost);
      }
    }
    return label === "done"
      ? { status: "completed", issue: issueNumber }
      : { status: "stopped", issue: issueNumber, label, summary };
  } finally {
    await lock.release();
  }
}
