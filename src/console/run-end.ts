import type { CleanupResult } from "../kernel/merged-cleanup.ts";
import type { RunOnceOutcome } from "../kernel/run-once.ts";
import type { RunSnapshot } from "../kernel/run-snapshot.ts";

export type RunEndInput = {
  /** The started issue, when known. */
  issue?: number;
  /** The last snapshot, when any arrived. */
  snapshot?: RunSnapshot;
  settled: { outcome: RunOnceOutcome } | { error: string };
};
export type EndedRun = {
  issue: number;
  title?: string;
  outcome:
    | "merged"
    | "pr-ready"
    | "stopped"
    | "paused"
    | "failed"
    | "not-started";
  /** The status bar label. */
  label: string;
  summary: string;
  cleanup?: CleanupResult["status"];
  /** The end-of-run chat message. */
  message: string;
  /** The Console agent explains the problem at once. */
  explain: boolean;
};

const QUIT_OR_SWITCH =
  "You can quit the session now. To work on another issue, run `/patchmill-issue <number>`.";
const EXPLAIN = "I explain the problem below and say how I can resolve it.";
const restart = (issue: number, purpose: string) =>
  `run \`patchmill run-once --interactive --issue ${issue}\` to ${purpose}.`;

const MERGED: Record<
  CleanupResult["status"],
  { label: string; cleanup: string; next: string; explain: boolean }
> = {
  cleaned: {
    label: "merged · cleaned up — safe to quit",
    cleanup: "finished. The worktrees and branches are removed.",
    next: QUIT_OR_SWITCH,
    explain: false,
  },
  kept: {
    label: "merged · cleanup incomplete — see the summary",
    cleanup:
      "did not finish. The cleanup messages above say what was kept and why. Patchmill tries again at its next run start.",
    next: `${EXPLAIN} After that, you can quit, or run \`/patchmill-issue <number>\` for another issue.`,
    explain: true,
  },
  skipped: {
    label: "merged · cleanup on next run — safe to quit",
    cleanup:
      "did not run, because the host did not confirm the merge yet. Patchmill cleans up at its next run start.",
    next: QUIT_OR_SWITCH,
    explain: false,
  },
};

type Case = {
  outcome: EndedRun["outcome"];
  label: string;
  sentence: string;
  cleanup?: string;
  next: string;
  explain: boolean;
};

function endCase(
  issue: number,
  snapshot: RunSnapshot | undefined,
  settled: RunEndInput["settled"],
): Case {
  if ("error" in settled)
    return {
      outcome: "failed",
      label: "failed — see the error",
      sentence: "failed.",
      next: `${EXPLAIN} After that, quit, and ${restart(issue, "start again")}`,
      explain: true,
    };
  const { outcome } = settled;
  switch (outcome.status) {
    case "completed": {
      if (snapshot?.facts?.pullRequest?.state === "merged") {
        // A merged run always went through cleanup; absent means skipped.
        const merged = MERGED[snapshot.cleanup ?? "skipped"];
        return {
          outcome: "merged",
          label: merged.label,
          sentence: "the pull request is merged.",
          cleanup: merged.cleanup,
          next: merged.next,
          explain: merged.explain,
        };
      }
      return {
        outcome: "pr-ready",
        label: "PR ready · not merged — see the summary",
        sentence: "the pull request is ready but not merged.",
        next: `Merge the pull request. Then quit, and ${restart(issue, "finish the issue")}`,
        explain: false,
      };
    }
    case "stopped": {
      const words =
        outcome.label === "needsInfo" ? "needs info" : "in progress";
      return {
        outcome: "stopped",
        label: `stopped: ${words} — see the summary`,
        sentence: `stopped (${words}).`,
        next: `${EXPLAIN} After that, quit, and ${restart(issue, "start again")}`,
        explain: true,
      };
    }
    case "paused":
      return {
        outcome: "paused",
        label: "paused — start the issue again to continue",
        sentence: "paused.",
        next: `Quit, and ${restart(issue, "continue")}`,
        explain: false,
      };
    default:
      return {
        outcome: "not-started",
        label: "not started — see the summary",
        sentence: "the run did not start.",
        next: "Read the summary. You can quit, or run `/patchmill-issue <number>` for another issue.",
        explain: false,
      };
  }
}

function summaryOf(input: RunEndInput): string {
  const { snapshot, settled } = input;
  if ("error" in settled) return settled.error;
  if (snapshot?.state === "ended" && snapshot.summary) return snapshot.summary;
  const { outcome } = settled;
  if ("summary" in outcome) return outcome.summary;
  if ("reason" in outcome) return outcome.reason;
  return `Issue run ${outcome.status}.`;
}

/** What an ended Issue run means to the maintainer: label, message and report. */
export function describeRunEnd(input: RunEndInput): EndedRun | undefined {
  const { snapshot, settled } = input;
  const issue =
    snapshot?.issue ??
    ("outcome" in settled && "issue" in settled.outcome
      ? settled.outcome.issue
      : undefined) ??
    input.issue;
  if (issue === undefined) return undefined;
  const end = endCase(issue, snapshot, settled);
  const summary = summaryOf(input);
  const cleanup =
    end.outcome === "merged" ? (snapshot?.cleanup ?? "skipped") : undefined;
  const message = [
    `Issue #${issue} run ended: ${end.sentence}`,
    `Summary: ${summary}`,
    ...(end.cleanup ? [`Cleanup: ${end.cleanup}`] : []),
    `Next: ${end.next}`,
  ].join("\n");
  return {
    issue,
    ...(snapshot?.title === undefined ? {} : { title: snapshot.title }),
    outcome: end.outcome,
    label: end.label,
    summary,
    ...(cleanup ? { cleanup } : {}),
    message,
    explain: end.explain,
  };
}
