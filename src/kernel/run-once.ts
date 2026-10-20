import fs from "node:fs/promises";
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
import { collectFacts, provisionWorkspace, type Facts } from "./facts.ts";
import { derivePhase, type Derived, type Phase } from "./phase.ts";
import { acquireLock, LockHeldError } from "./lock.ts";
import { claimSwap, releaseSwap } from "./labels.ts";
import { renderRunEnvelope } from "./envelope.ts";
import { supervisePi } from "./pi-supervisor.ts";
import { parseAgentResult } from "./result.ts";
import {
  formatRunResult,
  formatRunStart,
  formatPhaseStart,
  formatPhaseComplete,
} from "./console.ts";
import { closesIssue, verifyOutcome, type OutcomeLabel } from "./verify.ts";
import { sumSessionUsage, costLine } from "./pi-cost.ts";
import { publishIssueCost } from "./pr-cost.ts";
import { KERNEL_COMMENT, planningGateComment } from "./comments.ts";
import { newRunId } from "./names.ts";

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
  | ({
      status: "stopped";
      issue: number;
      label: OutcomeLabel;
      summary: string;
    } & Publication)
  | ({ status: "completed"; issue: number } & Publication);

// Label and comment failures never change the verified outcome.
type Publication = { publicationErrors?: string[] };

export function selectIssue(
  issues: Issue[],
  labels: LabelsConfig,
  explicit?: number,
): Issue | undefined {
  const eligible = issues.filter((i) => i.state === "open");
  if (explicit !== undefined)
    return eligible.find((i) => i.number === explicit);
  return eligible
    .filter(
      (i) =>
        i.labels.includes(labels.ready) || i.labels.includes(labels.inProgress),
    )
    .sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt))[0];
}

export async function runOneIssue(
  config: PatchmillConfig,
  deps: RunOnceDeps,
  options: RunOnceOptions,
): Promise<RunOnceOutcome> {
  const { host, git, repoRoot, now, output } = deps;
  let issues: Issue[];
  try {
    issues =
      options.issue === undefined
        ? await host.listOpenIssues()
        : [await host.viewIssue(options.issue)];
  } catch (error) {
    if (options.issue === undefined) throw error;
    return { status: "refused", issue: options.issue, reason: String(error) };
  }
  const selected = selectIssue(issues, config.labels, options.issue);
  if (!selected) {
    if (options.issue === undefined)
      output.stdout(
        formatRunResult({ label: "No eligible issue", severity: "success" }),
      );
    return options.issue === undefined
      ? { status: "no-work" }
      : {
          status: "refused",
          issue: options.issue,
          reason: "Issue is missing or closed.",
        };
  }
  const issueNumber = selected.number;
  const collect = (issue: Issue, workspace?: Pick<Facts, "stage" | "branch">) =>
    collectFacts({ ...deps, config }, issue, workspace);
  if (options.dryRun) {
    const result = await collect(selected);
    const derived =
      result.kind === "facts"
        ? derivePhase(result.facts)
        : "ambiguous-branches";
    output.stdout(
      formatRunResult({
        label: "Dry run",
        severity: "success",
        issue: selected,
        transition: derived,
        ...(result.kind === "facts" ? { facts: result.facts } : {}),
      }),
    );
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
  const started = now();
  const runId = newRunId(started);
  const startedAt = started.toISOString();
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
  let displayFacts: Facts | undefined;
  let totalOutputTokens = 0;
  try {
    try {
      const claim = claimSwap(config.labels);
      await host.setLabels(issueNumber, claim.add, claim.remove);
      let issue = await host.viewIssue(issueNumber);
      if (
        issue.state !== "open" ||
        !issue.labels.includes(config.labels.inProgress)
      )
        return { status: "claimed-elsewhere", issue: issueNumber };
      await fs.mkdir(runDir, { recursive: true });
      output.stderr(formatRunStart(issue));
      for (let index = 0; index < 3; index++) {
        issue = await host.viewIssue(issueNumber);
        const before = await provisionWorkspace({ ...deps, config }, issue);
        if (before.kind === "ambiguous-branches") {
          summary = `Several issue branches exist: ${before.branches.join(", ")}`;
          break;
        }
        const facts = before.facts;
        displayFacts = facts;
        const decision = derivePhase(facts);
        if (decision.kind === "stop") {
          label = decision.label;
          summary =
            label === "done"
              ? "The pull request is merged."
              : planningGateComment(facts);
          const closing =
            facts.pullRequest &&
            closesIssue(
              facts.pullRequest.body,
              issueNumber,
              await host.repository(),
            );
          if (label === "done" && !closing) {
            label = "needsInfo";
            summary = `The merged pull request does not close issue #${issueNumber}; it cannot prove implementation completion.`;
          } else if (facts.stage !== "implementation" && closing) {
            label = "needsInfo";
            summary = `The planning pull request would close issue #${issueNumber}. Replace its closing reference with Refs #${issueNumber} before merging it.`;
          }
          break;
        }
        const phase = decision.phase;
        if (options.planOnly && phase === "implementation") {
          summary = "planning complete";
          break;
        }
        const skill = {
          name: phase,
          path: resolve(repoRoot, config.skills[phase]),
        };
        const promptPath = join(runDir, "prompt.md");
        const envelope = renderRunEnvelope({
          repository: await host.repository(),
          issue,
          phase,
          facts,
          skill,
          timeoutMinutes: config.pi.timeoutMinutes,
          trusted: trustedAuthors(config, (await host.checkCli()).login),
        });
        await fs.writeFile(promptPath, envelope);
        const sessionDir = join(runDir, "sessions", String(index + 1));
        const logPath = join(runDir, `session-${index + 1}.log`);
        output.stderr(formatPhaseStart(phase, index + 1));
        const session = await supervisePi({
          command: deps.piCommand,
          cwd: facts.worktree,
          agentDir: resolve(repoRoot, config.pi.agentDir),
          sessionDir,
          skillPath: skill.path,
          promptPath,
          logPath,
          aggregateLogPath: join(runDir, "pi.log"),
          extensionPaths: deps.extensionPaths,
          timeoutMs: config.pi.timeoutMinutes * 60_000,
          // Keep the agent protocol in the logs, not the operator's terminal.
          onOutput: () => {},
          ...(options.signal ? { signal: options.signal } : {}),
        });
        const result = parseAgentResult(session.stdout);
        const phaseUsage = await sumSessionUsage(sessionDir);
        totalOutputTokens += phaseUsage?.outputTokens ?? 0;
        output.stderr(
          formatPhaseComplete(
            phaseUsage,
            totalOutputTokens,
            (now().getTime() - started.getTime()) / 1000,
          ),
        );
        sessions.push({
          phase,
          exitCode: session.exitCode,
          timedOut: session.timedOut,
          status: result.ok ? result.result.status : "invalid",
        });
        issue = await host.viewIssue(issueNumber);
        const after = await collect(issue, facts);
        if (after.kind === "ambiguous-branches") {
          summary = `Several issue branches exist: ${after.branches.join(", ")}`;
          break;
        }
        displayFacts = after.facts;
        const verified = verifyOutcome({
          issue: issueNumber,
          repository: await host.repository(),
          phase,
          result,
          session,
          facts: after.facts,

          logPath,
          uncommitted: await git.hasUncommittedChanges(facts.worktree),
          unpushed: await git.unpushedCommits(facts.worktree, facts.branch),
        });
        if (verified.kind === "stop") {
          label = verified.label;
          summary = verified.comment;
          warnings = verified.warnings;
          if (phase === "planning") {
            if (!after.facts.specPath)
              summary += `\nExpected artifact: ${after.facts.expectedSpecPath}`;
            else if (facts.stage !== "spec" && !after.facts.planPath)
              summary += `\nExpected artifact: ${after.facts.expectedPlanPath}`;
          }
          break;
        }
        if (options.planOnly && phase === "planning") {
          label = "needsInfo";
          summary = "planning complete";
          break;
        }
        const next = derivePhase(after.facts);
        if (next.kind === "phase" && next.phase === phase) {
          summary = `The phase did not advance. Expected artifact: ${phase === "planning" ? after.facts.expectedPlanPath : after.facts.expectedSpecPath}`;
          break;
        }
      }
    } catch (error) {
      label = "needsInfo";
      summary = errorMessage(error);
    }
    const usage = await sumSessionUsage(join(runDir, "sessions"));
    const cost = costLine(usage);
    if (displayFacts?.pullRequest) {
      try {
        await publishIssueCost({
          host,
          branch: displayFacts.branch,
          issueDir,
          current: { runId, sessions },
        });
      } catch (error) {
        warnings.push(`PR cost report unavailable: ${errorMessage(error)}`);
      }
    }
    const publicationErrors: string[] = [];
    const publish = async (failure: string, effect: () => Promise<void>) => {
      try {
        await effect();
      } catch (error) {
        publicationErrors.push(`${failure}: ${errorMessage(error)}`);
      }
    };
    const release = releaseSwap(config.labels, label);
    await publish("Label update failed", () =>
      host.setLabels(issueNumber, release.add, release.remove),
    );
    await publish("Comment failed", () =>
      host.commentIssue(
        issueNumber,
        [
          KERNEL_COMMENT,
          `Issue #${issueNumber}: ${config.labels[label]}`,
          summary,
          cost,
          ...warnings,
          ...publicationErrors,
        ].join("\n\n"),
      ),
    );
    const publication = publicationErrors.length ? { publicationErrors } : {};
    const outcome: RunOnceOutcome =
      label === "done"
        ? { status: "completed", issue: issueNumber, ...publication }
        : {
            status: "stopped",
            issue: issueNumber,
            label,
            summary,
            ...publication,
          };
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
    output.stdout(
      formatRunResult({
        label:
          outcome.status === "completed"
            ? displayFacts?.pullRequest?.state === "merged"
              ? "Already merged"
              : "PR ready"
            : label === "inProgress"
              ? "Planning PR merge required"
              : "Stopped",
        severity:
          outcome.status === "completed" && !publicationErrors.length
            ? "success"
            : "warning",
        issue: selected,
        ...(displayFacts ? { facts: displayFacts } : {}),
        summary,
        warnings: [...warnings, ...publicationErrors],
        outcomeLabel: config.labels[label],
        logPath: join(runDir, "pi.log"),
        sessionPath: join(runDir, "sessions"),
        cost,
        ...(usage ? { usage } : {}),
        elapsedSeconds: (now().getTime() - started.getTime()) / 1000,
      }),
    );
    return outcome;
  } finally {
    await lock.release();
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
