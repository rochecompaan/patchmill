import fs from "node:fs/promises";
import { resolve, join } from "node:path";
import { type PatchmillConfig } from "../config/config.ts";
import type { Host, Issue } from "../host/types.ts";
import type { CommandRunner } from "../process/command.ts";
import type { PiCommandSpec } from "../cli/pi-cli.ts";
import type { KernelGit } from "./git.ts";
import {
  collectFacts,
  provisionWorkspace,
  resolveBaseBranch,
  type Facts,
} from "./facts.ts";
import { derivePhase, type Derived, type Phase } from "./phase.ts";
import { acquireLock, LockHeldError, type IssueLock } from "./lock.ts";
import type { WorkflowState } from "./workflow-state.ts";
import { stateTrackingMode } from "./state-tracking-mode.ts";
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
  workerQuestion,
} from "./interactive-loop.ts";
import { isReviewWait, reviewWait, collectReviewFacts } from "./review-wait.ts";
import { publishAttemptStop, type StopPublication } from "./publish.ts";
import {
  formatRunResult,
  formatRunStart,
  formatPhaseStart,
  formatPhaseComplete,
  formatStall,
} from "./console.ts";
import { consumeStallBlock, writeStallBlock } from "./stall-block.ts";
import type { OutcomeLabel } from "./verify.ts";
import { reviewedDocuments, verifyPlanningApproval } from "./chat-approval.ts";
import { sumSessionUsage, costLine } from "./pi-cost.ts";
import { runSnapshot, type RunSnapshot } from "./run-snapshot.ts";
import { projectRunProgress, writeRunProgress } from "./run-progress.ts";
import { createRunHistory } from "./run-history.ts";
import { gateWaitPublished } from "./gate-wait.ts";
import { selectRunIssue } from "./issue-selection.ts";
import { newRunId } from "./names.ts";
import { cleanupMergedIssue, type CleanupResult } from "./merged-cleanup.ts";
import { sweepMergedIssues } from "./merged-cleanup-sweep.ts";
import type { ParsedResult } from "./result.ts";
import { explainMissingResult } from "./unfinished-runs.ts";
import {
  explainProviderFailure,
  providerFailureNotice,
} from "./provider-failure.ts";
import {
  conflictResolutionGaps,
  findConflictingPullRequests,
  isRecordedAttempt,
  recordConflictAttempt,
  type ConflictCandidate,
} from "./merge-conflicts.ts";
import { errorMessage } from "./errors.ts";

export const MAX_SESSIONS_WITHOUT_HUMAN = 3;
export type RunOnceOptions = {
  issue?: number;
  dryRun?: boolean;
  planOnly?: boolean;
  signal?: AbortSignal;
  /**
   * The per-issue lock of `issue`, which the caller already holds. The run
   * uses it instead of taking its own, and never releases it.
   */
  heldLock?: IssueLock;
};
export type RunOnceDeps = {
  human?: HumanChannel;
  workflow: WorkflowState;
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
  | ({ status: "completed"; issue: number } & Publication)
  /** The console shut down (Pause, Ctrl-C or a server stop) during a
   * session. Nothing is published; the next start continues the run. */
  | { status: "paused"; issue: number; summary: string };

// Label and comment failures never change the verified outcome.
type Publication = { publicationErrors?: string[] };

export async function runOneIssue(
  config: PatchmillConfig,
  deps: RunOnceDeps,
  options: RunOnceOptions,
): Promise<RunOnceOutcome> {
  const { host, git, repoRoot, now, output } = deps;
  const workflow = deps.workflow;
  const { heldLock } = options;
  if (heldLock) {
    if (options.issue === undefined)
      throw new Error("A held lock requires an issue number.");
    const expected = join(
      resolve(repoRoot, config.paths.runsDir, `issue-${options.issue}`),
      "lock",
    );
    if (resolve(heldLock.path) !== expected)
      throw new Error(
        `The held lock does not own issue #${options.issue}'s lock path.`,
      );
  }
  if (!options.dryRun) {
    await sweepMergedIssues({
      ...deps,
      config,
      report: output.stderr,
      ...(options.signal ? { signal: options.signal } : {}),
      ...(heldLock ? { skipIssue: options.issue } : {}),
    });
  }
  await workflow.sync(options.issue);
  const issueDirOf = (n: number) =>
    resolve(repoRoot, config.paths.runsDir, `issue-${n}`);
  // Unattended runs resolve a conflicting done pull request before new work.
  let conflictSelection: ConflictCandidate | undefined;
  let conflictLock: IssueLock | undefined;
  if (options.issue === undefined && !deps.human) {
    const found = await searchConflicts(config, deps, issueDirOf);
    // A stop request that arrived before the claim leaves every issue untouched.
    if (found.length && !options.dryRun && options.signal?.aborted)
      return { status: "no-work" };
    for (const candidate of found) {
      if (!options.dryRun) {
        try {
          conflictLock = await acquireLock(
            join(issueDirOf(candidate.issue.number), "lock"),
            { now },
          );
        } catch (error) {
          if (!(error instanceof LockHeldError)) throw error;
          output.stderr(
            `Issue #${candidate.issue.number} conflict resolution skipped: another Run attempt is active`,
          );
          continue;
        }
      }
      conflictSelection = candidate;
      // The search kept only pull requests into the base branch.
      const base = `origin/${candidate.pullRequest.baseBranch}`;
      output.stderr(
        `Issue #${candidate.issue.number}: pull request #${candidate.pullRequest.number} conflicts with ${base} in ${candidate.conflict.files.join(", ")}${options.dryRun ? "" : "; resolving it first"}.`,
      );
      break;
    }
  }
  const selection = conflictSelection
    ? { kind: "selected" as const, issue: conflictSelection.issue }
    : await selectRunIssue({
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
  const issueDir = issueDirOf(issueNumber);
  // A stop request that arrived before the claim leaves the issue untouched.
  if (options.signal?.aborted) {
    await conflictLock?.release();
    return { status: "no-work" };
  }
  let lock: IssueLock;
  try {
    lock =
      heldLock ??
      conflictLock ??
      (await acquireLock(join(issueDir, "lock"), { now }));
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
  const history = createRunHistory({
    issue: issueNumber,
    runId,
    runDir,
    now,
    warn: output.stderr,
  });
  const progressOutput = async (stream: "stdout" | "stderr", text: string) => {
    await history.progress(stream, text);
    output[stream](text);
  };
  const snapshot = runSnapshot(
    { issue: issueNumber, runId, runDir, startedAt },
    deps.observe,
    (line) => output.stderr(line),
    async (record) => {
      const progress = projectRunProgress(record, !!deps.human, now());
      await history.snapshot(progress);
      await writeRunProgress(issueDir, progress);
    },
  );
  const sessions: {
    phase: Phase;
    exitCode: number | null;
    timedOut: boolean;
    status: string;
    stalls?: number;
    planningApproval?: "pr" | "no-pr";
  }[] = [];
  let stop: Omit<StopPublication, "cost"> = {
    label: "needsInfo",
    summary: "The session limit was reached.",
    warnings: [],
  };
  let displayFacts: Facts | undefined;
  let paused = false;
  let totalOutputTokens = 0;
  let published = false;
  // An unattended gate stop derived before any session in this attempt.
  let derivedGateStop = false;
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
        stop,
      })),
    );
  };
  // A Provider failure names the stop. Its message stays in local output.
  const explainResult = async (result: ParsedResult, sessionDir: string) => {
    const provider = await explainProviderFailure(
      result,
      sessionDir,
      issueNumber,
    );
    if (!provider) return explainMissingResult(result, sessionDir);
    await progressOutput("stderr", providerFailureNotice(provider.failure));
    return provider.result;
  };
  const review = async (facts: Facts, restart: boolean) => {
    await snapshot.wait("review-wait");
    await reviewWait({
      facts,
      issue: issueNumber,
      ...deps,
      workflow,
      human: deps.human!,
      restart,
      publish,
      refresh: () => collectReviewFacts(workflow, issueNumber, facts, collect),
      update: async (facts, nextLabel, nextSummary) => {
        published = true;
        displayFacts = facts;
        await snapshot.facts(facts);
        stop = { ...stop, label: nextLabel, summary: nextSummary };
      },
    });
  };
  try {
    try {
      await workflow.setStatus(issueNumber, { status: "inProgress", runId });
      let issue = await workflow.issue(issueNumber);
      snapshot.title(issue.title);
      if (issue.state !== "open" || issue.status !== "inProgress")
        return { status: "claimed-elsewhere", issue: issueNumber };
      await fs.mkdir(runDir, { recursive: true });
      await progressOutput("stderr", formatRunStart(issue));
      let sessionNumber = 0;
      let sinceHuman = 0;
      let feedback: string | undefined;
      let resume: { facts: Facts; text: string } | undefined;
      let firstDerivation = true;
      while (sinceHuman < MAX_SESSIONS_WITHOUT_HUMAN) {
        await snapshot.deriving();
        issue = await workflow.issue(issueNumber);
        snapshot.title(issue.title);
        const before = resume
          ? { kind: "facts" as const, facts: resume.facts }
          : await provisionWorkspace({ ...deps, config }, issue);
        if (before.kind === "ambiguous-branches") {
          stop.summary = `Several issue branches exist: ${before.branches.join(", ")}`;
          break;
        }
        const facts = before.facts;
        displayFacts = facts;
        await snapshot.facts(facts);
        // Only an open pull request into the base can have stopped conflicting;
        // any other change goes through the normal derivation.
        if (
          firstDerivation &&
          conflictSelection &&
          !facts.mergeConflict &&
          facts.pullRequest?.state === "open" &&
          facts.pullRequest.baseBranch === facts.baseBranch
        ) {
          stop = {
            label: "done",
            summary: `Pull request #${conflictSelection.pullRequest.number} no longer conflicts with origin/${facts.baseBranch}; nothing to resolve.`,
            warnings: [],
          };
          break;
        }
        firstDerivation = false;
        let decision = phaseDecision(facts, feedback, !!resume);
        if (
          deps.human &&
          !resume &&
          decision.kind === "phase" &&
          decision.phase === "implementation" &&
          !(await reviewedDocuments(git, config, facts, issueNumber))
        )
          decision = { kind: "phase", phase: "planning" };
        if (decision.kind === "stop") {
          stop = {
            ...stop,
            ...derivedStop(
              facts,
              issueNumber,
              await host.repository(),
              decision.label,
            ),
          };
          if (
            stop.label === "inProgress" &&
            (await continueGate(facts, deps.human, () =>
              snapshot.wait("gate-wait"),
            ))
          ) {
            sinceHuman = 0;
            continue;
          }
          derivedGateStop =
            stop.label === "inProgress" && !deps.human && !sessions.length;
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
          stop.summary = "planning complete";
          break;
        }
        const conflict =
          phase === "implementation" ? facts.mergeConflict : undefined;
        const resolving =
          conflict &&
          (conflictSelection !== undefined ||
            (await isRecordedAttempt(issueDir, conflict, output.stderr)))
            ? conflict
            : undefined;
        if (resolving)
          await recordConflictAttempt(issueDir, {
            runId,
            startedAt: now().toISOString(),
            conflict: resolving,
          });
        const { launch, launcher } = await preparePhasePrompt(
          config,
          deps,
          runDir,
          issue,
          phase,
          facts,
          sessionNumber + 1,
          options.signal,
          resolving !== undefined,
        );
        launch.onStall = (notice) =>
          progressOutput("stderr", formatStall(notice, config.pi.maxStalls));
        sessionNumber++;
        sinceHuman++;
        await snapshot.phase(phase, sessionNumber);
        await history.session({
          number: sessionNumber,
          phase,
          stage: facts.stage,
        });
        await progressOutput("stderr", formatPhaseStart(phase, sessionNumber));
        const launched = await launchPhase(
          launch,
          launcher,
          deps.human,
          feedback,
          resume?.text,
        );
        const run =
          launched.session.timedOut ||
          launched.session.aborted ||
          launched.stallBlock
            ? launched
            : {
                ...launched,
                result: await explainResult(launched.result, launch.sessionDir),
              };
        resume = undefined;
        const { session, result } = run;
        if (deps.human && phase === "planning" && !session.aborted)
          sinceHuman = 0;
        const phaseUsage = await sumSessionUsage(launch.sessionDir);
        totalOutputTokens += phaseUsage?.outputTokens ?? 0;
        await progressOutput(
          "stderr",
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
          ...(run.stalls ? { stalls: run.stalls.length } : {}),
          ...(run.planningApproval
            ? { planningApproval: run.planningApproval }
            : {}),
        });
        await snapshot.session();
        // A console shutdown or a stop request aborts a session: a pause,
        // not a failure. Publish nothing; the next start continues the run.
        if ((deps.human || options.signal?.aborted) && session.aborted) {
          paused = true;
          stop = { label: "inProgress", summary: "Run paused.", warnings: [] };
          break;
        }
        // The resume record is used once, by an attempt that did not pause.
        if (phase === "implementation")
          await consumeStallBlock(issueDir, runDir);
        if (run.stallBlock)
          await writeStallBlock(issueDir, { runId, stalls: run.stalls ?? [] });
        const after = await collect(await workflow.issue(issueNumber), facts);
        if (after.kind === "ambiguous-branches") {
          stop.summary = `Several issue branches exist: ${after.branches.join(", ")}`;
          break;
        }
        displayFacts = after.facts;
        await snapshot.facts(after.facts);
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
            ...(run.stallBlock ? { stallBlock: run.stallBlock } : {}),
            ...(conflict
              ? {
                  conflictGaps: await conflictResolutionGaps(
                    git,
                    conflict,
                    after.facts,
                  ),
                }
              : {}),
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
          await fs.appendFile(join(runDir, "guidance.md"), guidance + "\n\n");
          resume = { facts: after.facts, text: guidance };
          sinceHuman = 0;
          continue;
        }
        if (verified.kind === "stop") {
          const question = workerQuestion({
            status: verified.label,
            human: !!deps.human,
            session,
            result,
          });
          stop = {
            label: verified.label,
            summary:
              phase === "planning"
                ? planningStopSummary(verified.comment, facts, after.facts)
                : verified.comment,
            warnings: verified.warnings,
            ...(question !== undefined ? { question } : {}),
          };
          if (
            stop.label === "inProgress" &&
            (await continueGate(after.facts, deps.human, () =>
              snapshot.wait("gate-wait"),
            ))
          ) {
            sinceHuman = 0;
            continue;
          }
          if (deps.human && phase === "implementation" && stop.label === "done")
            await review(after.facts, false);
          break;
        }
        if (options.planOnly && phase === "planning") {
          stop.label = "needsInfo";
          stop.summary = "planning complete";
          break;
        }
        const next = derivePhase(after.facts);
        if (next.kind === "phase" && next.phase === phase) {
          stop.summary = `The phase did not advance. Expected artifact: ${phase === "planning" ? after.facts.expectedPlanPath : after.facts.expectedSpecPath}`;
          break;
        }
      }
    } catch (error) {
      stop.label = "needsInfo";
      stop.summary = error instanceof Error ? error.message : String(error);
      if (published) await publish();
    }
    const usage = await sumSessionUsage(join(runDir, "sessions"));
    const cost = costLine(usage);
    // A stop request pauses an unfinished unattended attempt too, also when
    // the abort made it throw. Verified completed work still publishes.
    if (options.signal?.aborted && !published && stop.label !== "done") {
      paused = true;
      stop = { label: "inProgress", summary: "Run paused.", warnings: [] };
    }
    const unchangedGateWait =
      derivedGateStop &&
      !published &&
      !paused &&
      stop.label === "inProgress" &&
      (await gateWaitPublished({ issueDir, runId, summary: stop.summary }));
    if (unchangedGateWait)
      output.stderr("Unchanged planning gate wait; not republished.");
    if (!published && !paused && !unchangedGateWait) await publish();
    let cleanup: CleanupResult | undefined;
    if (stop.label === "done" && displayFacts?.stage === "implementation") {
      cleanup = await cleanupMergedIssue({
        ...deps,
        config,
        issue: issueNumber,
        branch: displayFacts.branch,
        lock,
        report: output.stderr,
        runLogPath: join(runDir, "pi.log"),
        ...(options.signal ? { signal: options.signal } : {}),
      });
    }
    const publication = publicationErrors.length ? { publicationErrors } : {};
    const outcome: RunOnceOutcome = paused
      ? { status: "paused", issue: issueNumber, summary: stop.summary }
      : stop.label === "done"
        ? { status: "completed", issue: issueNumber, ...publication }
        : {
            status: "stopped",
            issue: issueNumber,
            label: stop.label,
            summary: stop.summary,
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
          ...(unchangedGateWait ? { republished: false } : {}),
          sessions,
          progress: projectRunProgress(
            {
              issue: issueNumber,
              runId,
              runDir,
              startedAt,
              state: "ended",
              session: sessions.length,
              ...(sessions.at(-1) ? { phase: sessions.at(-1)!.phase } : {}),
              ...(displayFacts ? { facts: displayFacts } : {}),
              summary: stop.summary,
              outcome: { status: outcome.status, label: stop.label },
            },
            !!deps.human,
            now(),
          ),
        },
        null,
        2,
      ),
    );
    await progressOutput(
      "stdout",
      formatRunResult({
        label:
          outcome.status === "completed"
            ? displayFacts?.pullRequest?.state === "merged"
              ? "Already merged"
              : "PR ready"
            : paused
              ? "Paused"
              : stop.label === "inProgress"
                ? "Planning PR merge required"
                : "Stopped",
        severity:
          outcome.status === "completed" && !publicationErrors.length
            ? "success"
            : "warning",
        issue: selected,
        ...(displayFacts ? { facts: displayFacts } : {}),
        summary: stop.summary,
        warnings: [...stop.warnings, ...publicationErrors],
        outcomeLabel:
          stateTrackingMode(config).statusTitles(config)[stop.label],
        logPath: join(runDir, "pi.log"),
        sessionPath: join(runDir, "sessions"),
        cost,
        ...(usage ? { usage } : {}),
        elapsedSeconds: (now().getTime() - started.getTime()) / 1000,
      }),
    );
    await snapshot.ended(
      stop.summary,
      { status: outcome.status, label: stop.label },
      cleanup?.status,
    );
    return outcome;
  } finally {
    if (lock !== heldLock) await lock.release();
  }
}

/** Conflicting done pull requests; a search failure only reports. */
async function searchConflicts(
  config: PatchmillConfig,
  deps: RunOnceDeps,
  issueDir: (issue: number) => string,
): Promise<ConflictCandidate[]> {
  const report = deps.output.stderr;
  try {
    const candidates = (await deps.workflow.openIssues()).filter(
      (issue) => issue.state === "open" && issue.status === "done",
    );
    if (!candidates.length) return [];
    return await findConflictingPullRequests({
      host: deps.host,
      git: deps.git,
      candidates,
      baseBranch: await resolveBaseBranch({ ...deps, config }),
      issueDir,
      retryMinutes: config.run.conflictRetryMinutes,
      now: deps.now,
      report,
    });
  } catch (error) {
    report(`Merge conflict check failed: ${errorMessage(error)}`);
    return [];
  }
}
