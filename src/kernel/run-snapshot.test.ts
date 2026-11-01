import assert from "node:assert/strict";
import { test } from "node:test";
import { join } from "node:path";
import {
  setupRun,
  spec,
  plan,
  done,
  implement,
  merge,
} from "../../test-support/run-once-fixture.ts";
import { fakeHuman } from "../../test-support/fake-human.ts";
import type { RunSnapshot, RunState } from "./run-snapshot.ts";

// Missing/reordered transitions and missing cumulative session updates are bugs.
test("observe receives each state of an interactive run in order", async (t) => {
  const c = await setupRun(t, [
    {
      writeFiles: { [spec]: "s", [plan]: "p" },
      commit: "Plan",
      push: true,
      result: done,
    },
    implement,
  ]);
  const snapshots: RunSnapshot[] = [];
  await c.run(
    { issue: 9 },
    { human: fakeHuman(c), observe: (s) => snapshots.push(s) },
  );
  const states = snapshots
    .map((s) => s.state)
    .filter((state, i, all) => i === 0 || state !== all[i - 1]);
  assert.deepEqual(states, [
    "deriving",
    "planning",
    "deriving",
    "implementation",
    "review-wait",
    "ended",
  ] satisfies RunState[]);
  assert.equal(snapshots[0]!.session, 0);
  assert.deepEqual(
    snapshots
      .filter((s) => s.usage)
      .slice(0, 2)
      .map((s) => [s.state, s.session, s.usage]),
    [
      ["planning", 1, { inputTokens: 100, outputTokens: 20, costUsd: 0.05 }],
      ["deriving", 1, { inputTokens: 100, outputTokens: 20, costUsd: 0.05 }],
    ],
  );
});

test("the final snapshot carries facts, session count, and usage", async (t) => {
  const c = await setupRun(t, [
    {
      writeFiles: { [spec]: "s", [plan]: "p" },
      commit: "Plan",
      push: true,
      result: done,
    },
    implement,
  ]);
  const snapshots: RunSnapshot[] = [];
  await c.run(
    { issue: 9 },
    { human: fakeHuman(c), observe: (s) => snapshots.push(s) },
  );
  const last = snapshots.at(-1)!;
  const { dir, result } = await c.records();
  assert.equal(last.state, "ended");
  assert.equal(last.issue, 9);
  assert.equal(last.runId, result.runId);
  assert.equal(last.runDir, dir);
  assert.equal(
    last.runDir,
    join(c.repoRoot, c.config.paths.runsDir, "issue-9", last.runId),
  );
  assert.equal(last.startedAt, c.deps.now().toISOString());
  assert.equal(last.session, 2);
  assert.equal(last.facts?.pullRequest?.url, "https://example.invalid/pulls/1");
  assert.deepEqual(last.usage, {
    inputTokens: 200,
    outputTokens: 40,
    costUsd: 0.1,
  });
  assert.ok(last.usage!.costUsd! > 0);
  assert.ok(last.summary);
  assert.equal(snapshots[0]!.state, "deriving");
  assert.equal(snapshots[0]!.usage, undefined);
  assert.ok(
    snapshots
      .filter((s) => s.state === "planning")
      .every((s) => s.phase === "planning"),
  );
  assert.ok(
    snapshots
      .filter((s) => s.state === "implementation")
      .every((s) => s.phase === "implementation"),
  );
});

test("observe reports the gate wait before continuing to the next session", async (t) => {
  const c = await setupRun(t, [
    {
      writeFiles: { [spec]: "s" },
      commit: "Spec",
      push: true,
      pullRequest: { draft: false, body: "Refs #9" },
      result: done,
    },
    { writeFiles: { [plan]: "p" }, commit: "Plan", push: true, result: done },
    implement,
  ]);
  c.config.workflow.specApproval.required = true;
  const states: RunState[] = [];
  const human = fakeHuman(c, {
    onWait: async (wait) => {
      if (wait.kind !== "gate") return "quit";
      assert.equal(states.at(-1), "gate-wait");
      await merge(c, "agent/issue-9--spec");
      return "continue";
    },
  });
  await c.run({ issue: 9 }, { human, observe: (s) => states.push(s.state) });
  assert.deepEqual(
    states.filter((s, i) => i === 0 || s !== states[i - 1]),
    [
      "deriving",
      "planning",
      "gate-wait",
      "deriving",
      "planning",
      "deriving",
      "implementation",
      "review-wait",
      "ended",
    ],
  );
});
