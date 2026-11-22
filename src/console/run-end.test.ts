import assert from "node:assert/strict";
import test from "node:test";
import type { RunSnapshot } from "../kernel/run-snapshot.ts";
import type { Facts } from "../kernel/facts.ts";
import { describeRunEnd, type RunEndInput } from "./run-end.ts";

const restart =
  "quit, and run `patchmill run-once --interactive --issue 9` to start again.";
const explain = "I explain the problem below and say how I can resolve it.";
const switchHint = "run `/patchmill-issue <number>` for another issue.";

function ended(extra: Partial<RunSnapshot> = {}, pr?: string): RunSnapshot {
  return {
    issue: 9,
    title: "Polls",
    runId: "r",
    runDir: "r",
    startedAt: "now",
    session: 2,
    state: "ended",
    summary: "The pull request is merged.",
    ...(pr
      ? {
          facts: {
            pullRequest: { state: pr, url: "https://x/pr/1" },
          } as unknown as Facts,
        }
      : {}),
    ...extra,
  };
}
const completed = { outcome: { status: "completed", issue: 9 } } as const;

type Row = {
  name: string;
  input: RunEndInput;
  outcome: string;
  label: string;
  explain: boolean;
  message: string;
};
const rows: Row[] = [
  {
    name: "merged, cleaned",
    input: {
      snapshot: ended({ cleanup: "cleaned" }, "merged"),
      settled: completed,
    },
    outcome: "merged",
    label: "merged · cleaned up — safe to quit",
    explain: false,
    message: [
      "Issue #9 run ended: the pull request is merged.",
      "Summary: The pull request is merged.",
      "Cleanup: finished. The worktrees and branches are removed.",
      "Next: You can quit the session now. To work on another issue, run `/patchmill-issue <number>`.",
    ].join("\n"),
  },
  {
    name: "merged, kept",
    input: {
      snapshot: ended({ cleanup: "kept" }, "merged"),
      settled: completed,
    },
    outcome: "merged",
    label: "merged · cleanup incomplete — see the summary",
    explain: true,
    message: [
      "Issue #9 run ended: the pull request is merged.",
      "Summary: The pull request is merged.",
      "Cleanup: did not finish. The cleanup messages above say what was kept and why. Patchmill tries again at its next run start.",
      `Next: ${explain} After that, you can quit, or ${switchHint}`,
    ].join("\n"),
  },
  ...(["skipped", undefined] as const).map(
    (cleanup): Row => ({
      name: `merged, ${cleanup ?? "no cleanup"}`,
      input: {
        snapshot: ended(cleanup ? { cleanup } : {}, "merged"),
        settled: completed,
      },
      outcome: "merged",
      label: "merged · cleanup on next run — safe to quit",
      explain: false,
      message: [
        "Issue #9 run ended: the pull request is merged.",
        "Summary: The pull request is merged.",
        "Cleanup: did not run, because the host did not confirm the merge yet. Patchmill cleans up at its next run start.",
        "Next: You can quit the session now. To work on another issue, run `/patchmill-issue <number>`.",
      ].join("\n"),
    }),
  ),
  {
    name: "pr-ready",
    input: {
      snapshot: ended({ summary: "The pull request was verified." }, "open"),
      settled: completed,
    },
    outcome: "pr-ready",
    label: "PR ready · not merged — see the summary",
    explain: false,
    message: [
      "Issue #9 run ended: the pull request is ready but not merged.",
      "Summary: The pull request was verified.",
      "Next: Merge the pull request. Then quit, and run `patchmill run-once --interactive --issue 9` to finish the issue.",
    ].join("\n"),
  },
  ...(
    [
      ["needsInfo", "needs info"],
      ["inProgress", "in progress"],
    ] as const
  ).map(
    ([label, words]): Row => ({
      name: `stopped, ${label}`,
      input: {
        snapshot: ended({ summary: "Checks failed." }),
        settled: {
          outcome: { status: "stopped", issue: 9, label, summary: "Other" },
        },
      },
      outcome: "stopped",
      label: `stopped: ${words} — see the summary`,
      explain: true,
      message: [
        `Issue #9 run ended: stopped (${words}).`,
        "Summary: Checks failed.",
        `Next: ${explain} After that, ${restart}`,
      ].join("\n"),
    }),
  ),
  {
    name: "paused",
    input: {
      settled: {
        outcome: { status: "paused", issue: 9, summary: "Console shut down." },
      },
    },
    outcome: "paused",
    label: "paused — start the issue again to continue",
    explain: false,
    message: [
      "Issue #9 run ended: paused.",
      "Summary: Console shut down.",
      "Next: Quit, and run `patchmill run-once --interactive --issue 9` to continue.",
    ].join("\n"),
  },
  {
    name: "failed",
    input: { issue: 9, settled: { error: "boom" } },
    outcome: "failed",
    label: "failed — see the error",
    explain: true,
    message: [
      "Issue #9 run ended: failed.",
      "Summary: boom",
      `Next: ${explain} After that, ${restart}`,
    ].join("\n"),
  },
  {
    name: "not-started",
    input: {
      settled: {
        outcome: { status: "refused", issue: 9, reason: "Issue is closed." },
      },
    },
    outcome: "not-started",
    label: "not started — see the summary",
    explain: false,
    message: [
      "Issue #9 run ended: the run did not start.",
      "Summary: Issue is closed.",
      `Next: Read the summary. You can quit, or ${switchHint}`,
    ].join("\n"),
  },
];

for (const row of rows)
  test(`labels and messages for every end case: ${row.name}`, () => {
    const ended = describeRunEnd(row.input)!;
    assert.equal(ended.outcome, row.outcome);
    assert.equal(ended.label, row.label);
    assert.equal(ended.explain, row.explain);
    assert.equal(ended.message, row.message);
  });

test("a merged run reports its cleanup and the snapshot title", () => {
  const result = describeRunEnd({
    snapshot: ended({ cleanup: "cleaned" }, "merged"),
    settled: completed,
  })!;
  assert.equal(result.issue, 9);
  assert.equal(result.title, "Polls");
  assert.equal(result.cleanup, "cleaned");
  assert.equal(result.summary, "The pull request is merged.");
});

test("a thrown error wins over the ended snapshot summary", () => {
  const result = describeRunEnd({
    snapshot: ended({}, "merged"),
    settled: { error: "boom" },
  })!;
  assert.equal(result.outcome, "failed");
  assert.equal(result.summary, "boom");
});

test("the issue comes from the outcome or the start issue", () => {
  const refused = describeRunEnd({
    settled: { outcome: { status: "refused", issue: 4, reason: "No." } },
  })!;
  assert.equal(refused.issue, 4);
  assert.equal("title" in refused, false);
  assert.equal(
    describeRunEnd({ issue: 7, settled: { error: "boom" } })!.issue,
    7,
  );
  assert.equal(
    describeRunEnd({ issue: 7, settled: { outcome: { status: "no-work" } } })!
      .summary,
    "Issue run no-work.",
  );
});

test("returns undefined when no issue is known", () => {
  assert.equal(
    describeRunEnd({ settled: { outcome: { status: "no-work" } } }),
    undefined,
  );
  assert.equal(describeRunEnd({ settled: { error: "boom" } }), undefined);
});
