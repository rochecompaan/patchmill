import fs from "node:fs/promises";
import { resolve, join } from "node:path";
import { type PatchmillConfig } from "../config/config.ts";
import type { Host, Issue } from "../host/types.ts";
import type { CommandRunner } from "../process/command.ts";
import type { PiCommandSpec } from "../cli/pi-cli.ts";
import type { KernelGit } from "./git.ts";
import { collectFacts, provisionWorkspace, type Facts } from "./facts.ts";
import { derivePhase, type Derived, type Phase } from "./phase.ts";
import { acquireLock, LockHeldError } from "./lock.ts";
import type { WorkflowState } from "./workflow-state.ts";
import { LabelWorkflowState } from "./label-workflow.ts";
import type { HumanChannel } from "./human-channel.ts";
import {
  preparePhasePrompt,
  launchPhase,
  planningFeedback,
  continueGate,
  derivedStop,
  workerGuidance,
  phaseDecision,
  planningStopSummary,
} from "./interactive-loop.ts";
import { isReviewWait, reviewWait, collectReviewFacts } from "./review-wait.ts";
import { publishAttemptStop } from "./publish.ts";
import {
  formatRunResult,
  formatRunStart,
  formatPhaseStart,
  formatPhaseComplete,
} from "./console.ts";
import type { OutcomeLabel } from "./verify.ts";
import { verifyPlanningApproval } from "./chat-approval.ts";
import { sumSessionUsage, costLine } from "./pi-cost.ts";
import { runSnapshot, type RunSnapshot } from "./run-snapshot.ts";
import { selectRunIssue } from "./issue-selection.ts";
import { newRunId } from "./names.ts";

export const MAX_SESSIONS_WITHOUT_HUMAN = 3;
export type RunOnceOptions = {
  issue?: number;
  dryRun?: boolean;
  planOnly?: boolean;
  signal?: AbortSignal;
};
export type RunOnceDeps = {
  human?: HumanChannel;
  workflow?: WorkflowState;
  observe?: (snapshot: RunSnapshot) => void;
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

export async function runOneIssue(
  config: PatchmillConfig,
  deps: RunOnceDeps,
  options: RunOnceOptions,
): Promise<RunOnceOutcome> {
  const { host, git, repoRoot, now, output } = deps;
  const workflow = deps.workflow ?? new LabelWorkflowState(host, config.labels);
  await workflow.sync(options.issue);
  const selection = await selectRunIssue({
    host,
    workflow,
    ...(options.issue !== undefined ? { issue: options.issue } : {}),
    warn: (issue, message) =>
      output.stderr(`Warning: Issue #${issue}: ${message}`),
  });
  if (selection.kind === "refused")
    return {
      status: "refused",
      issue: selection.issue,
      reason: selection.reason,
    };
  if (selection.kind === "none") {
    output.stdout(
      formatRunResult({ label: "No eligible issue", severity: "success" }),
    );
    return { status: "no-work" };
  }
  const selected = selection.issue;
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
  const snapshot = runSnapshot(
    { issue: issueNumber, runId, runDir, startedAt },
    deps.observe,
    (line) => output.stderr(line),
  );
  const sessions: {
    phase: Phase;
    exitCode: number | null;
    timedOut: boolean;
    status: string;
    planningApproval?: "pr" | "no-pr";
  }[] = [];
  let label: OutcomeLabel = "needsInfo";
  let summary = "The session limit was reached.";
  let warnings: string[] = [];
  let displayFacts: Facts | undefined;
  let totalOutputTokens = 0;
  let published = false;
  let question: string | undefined;
  const publicationErrors: string[] = [];
  const publish = async () => {
    publicationErrors.push(
      ...(await publishAttemptStop({
        host,
        workflow,
        issue: issueNumber,
        issueDir,
        current: { runId, sessions },
        ...(displayFacts ? { facts: displayFacts } : {}),
        stop: {
          label,
          summary,
          warnings,
          ...(question !== undefined ? { question } : {}),
        },
      })),
    );
  };
  const review = async (facts: Facts, restart: boolean) => {
    snapshot.wait("review-wait");
    await reviewWait({
      facts,
      issue: issueNumber,
      ...deps,
      workflow,
      human: deps.human!,
      restart,
      publish,
      refresh: () => collectReviewFacts(workflow, issueNumber, facts, collect),
      update: (facts, nextLabel, nextSummary) => {
        published = true;
        displayFacts = facts;
        snapshot.facts(facts);
        label = nextLabel;
        summary = nextSummary;
      },
    });
  };
  try {
    try {
      await workflow.setStatus(issueNumber, { status: "inProgress", runId });
      let issue = await workflow.issue(issueNumber);
      if (issue.state !== "open" || issue.status !== "inProgress")
        return { status: "claimed-elsewhere", issue: issueNumber };
      await fs.mkdir(runDir, { recursive: true });
      output.stderr(formatRunStart(issue));
      let sessionNumber = 0;
      let sinceHuman = 0;
      let feedback: string | undefined;
      let resume: { facts: Facts; text: string } | undefined;
      while (sinceHuman < MAX_SESSIONS_WITHOUT_HUMAN) {
        snapshot.deriving();
        issue = await workflow.issue(issueNumber);
        const before = resume
          ? { kind: "facts" as const, facts: resume.facts }
          : await provisionWorkspace({ ...deps, config }, issue);
        if (before.kind === "ambiguous-branches") {
          summary = `Several issue branches exist: ${before.branches.join(", ")}`;
          break;
        }
        const facts = before.facts;
        displayFacts = facts;
        snapshot.facts(facts);
        const decision = phaseDecision(facts, feedback, !!resume);
        if (decision.kind === "stop") {
          ({ label, summary } = derivedStop(
            facts,
            issueNumber,
            await host.repository(),
            decision.label,
          ));
          if (
            label === "inProgress" &&
            (await continueGate(facts, deps.human, () =>
              snapshot.wait("gate-wait"),
            ))
          ) {
            sinceHuman = 0;
            continue;
          }
          break;
        }
        if (
          deps.human &&
          !resume &&
          decision.phase === "implementation" &&
          isReviewWait(facts, issueNumber, await host.repository())
        ) {
          await review(facts, true);
          break;
        }
        const phase = decision.phase;
        if (options.planOnly && phase === "implementation") {
          summary = "planning complete";
          break;
        }
        const { launch, launcher } = await preparePhasePrompt(
          config,
          deps,
          runDir,
          issue,
          phase,
          facts,
          sessionNumber + 1,
          options.signal,
        );
        sessionNumber++;
        sinceHuman++;
        snapshot.phase(phase, sessionNumber);
        output.stderr(formatPhaseStart(phase, sessionNumber));
        const run = await launchPhase(
          launch,
          launcher,
          deps.human,
          feedback,
          resume?.text,
        );
        resume = undefined;
        const { session, result } = run;
        if (deps.human && phase === "planning" && !session.aborted)
          sinceHuman = 0;
        const phaseUsage = await sumSessionUsage(launch.sessionDir);
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
          ...(run.planningApproval
            ? { planningApproval: run.planningApproval }
            : {}),
        });
        await snapshot.session();
        const after = await collect(await workflow.issue(issueNumber), facts);
        if (after.kind === "ambiguous-branches") {
          summary = `Several issue branches exist: ${after.branches.join(", ")}`;
          break;
        }
        displayFacts = after.facts;
        snapshot.facts(after.facts);
        const verified = await verifyPlanningApproval(
          {
            issue: issueNumber,
            repository: await host.repository(),
            phase,
            result,
            session,
            facts: after.facts,
            logPath: launch.logPath,
            uncommitted: await git.hasUncommittedChanges(facts.worktree),
            unpushed: await git.unpushedCommits(facts.worktree, facts.branch),
          },
          run,
          !!deps.human,
          git,
          issue,
        );
        feedback = planningFeedback(phase, run, verified, deps.human);
        if (feedback !== undefined) continue;
        if (
          deps.human &&
          run.planningApproval === "no-pr" &&
          verified.kind === "advance"
        )
          continue;
        const guidance = await workerGuidance(phase, run, verified, deps, () =>
          snapshot.wait("blocked"),
        );
        if (guidance !== undefined) {
          await fs.mkdir(runDir, { recursive: true });
          await fs.appendFile(join(runDir, "guidance.md"), guidance + "\n\n");
          resume = { facts: after.facts, text: guidance };
          sinceHuman = 0;
          continue;
        }
        if (verified.kind === "stop") {
          label = verified.label;
          summary = verified.comment;
          warnings = verified.warnings;
          question =
            label === "needsInfo" &&
            !deps.human &&
            !session.aborted &&
            !session.timedOut &&
            result.ok &&
            result.result.status === "needs-input"
              ? result.result.summary
              : undefined;
          if (phase === "planning")
            summary = planningStopSummary(summary, facts, after.facts);
          if (
            label === "inProgress" &&
            (await continueGate(after.facts, deps.human, () =>
              snapshot.wait("gate-wait"),
            ))
          ) {
            sinceHuman = 0;
            continue;
          }
          if (deps.human && phase === "implementation" && label === "done")
            await review(after.facts, false);
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
      summary = error instanceof Error ? error.message : String(error);
      if (published) await publish();
    }
    const usage = await sumSessionUsage(join(runDir, "sessions"));
    const cost = costLine(usage);
    if (!published) await publish();
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
    snapshot.ended(summary);
    return outcome;
  } finally {
    await lock.release();
  }
}
