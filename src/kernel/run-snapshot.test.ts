import assert from "node:assert/strict";
import { test, mock } from "node:test";
import fs from "node:fs/promises";
import { readFileSync } from "node:fs";
import { runSnapshot } from "./run-snapshot.ts";
import { join } from "node:path";
import {
  setupRun,
  spec,
  plan,
  done,
  implement,
  merge,
  kernelComments,
} from "../../test-support/run-once-fixture.ts";
import { fakeHuman } from "../../test-support/fake-human.ts";
import type { RunSnapshot, RunState } from "./run-snapshot.ts";

test("title() is carried by the next emission without emitting or persisting", async () => {
  const observed: RunSnapshot[] = [];
  const saved: RunSnapshot[] = [];
  const snapshot = runSnapshot(
    { issue: 9, runId: "r", runDir: "/unused", startedAt: "now" },
    (s) => observed.push(s),
    () => {},
    async (s) => {
      saved.push(s);
    },
  );
  snapshot.title("Add login");
  assert.deepEqual(observed, []);
  assert.deepEqual(saved, []);
  await snapshot.phase("planning", 1);
  assert.equal(observed[0]!.title, "Add login");
  assert.equal(saved[0]!.title, "Add login");
});

test("an edited title appears on the next emission", async () => {
  const observed: RunSnapshot[] = [];
  const snapshot = runSnapshot(
    { issue: 9, runId: "r", runDir: "/unused", startedAt: "now" },
    (s) => observed.push(s),
    () => {},
  );
  snapshot.title("Old");
  await snapshot.phase("planning", 1);
  snapshot.title("New");
  await snapshot.deriving();
  assert.deepEqual(
    observed.map((s) => s.title),
    ["Old", "New"],
  );
});

test("every emitted snapshot carries the issue title", async (t) => {
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
  assert.ok(snapshots.length > 0);
  assert.ok(snapshots.every((s) => s.title === "Add login"));
});

test("durable observations settle before console delivery and isolate disk errors", async () => {
  let release!: () => void;
  const saved: string[] = [];
  const observed: string[] = [];
  const warnings: string[] = [];
  const snapshot = runSnapshot(
    {
      issue: 9,
      runId: "20261114-120000-abcd",
      runDir: "/unused",
      startedAt: "2026-11-14T12:00:00Z",
    },
    (s) => observed.push(s.state),
    (line) => warnings.push(line),
    async (s) => {
      if (s.state === "planning")
        await new Promise<void>((resolve) => {
          release = resolve;
        });
      else throw new Error("disk unavailable");
      saved.push(s.state);
    },
  );
  const phase = snapshot.phase("planning", 1);
  assert.deepEqual(observed, []);
  release();
  await phase;
  assert.deepEqual(saved, ["planning"]);
  assert.deepEqual(observed, ["planning"]);
  await snapshot.ended("complete", { status: "completed", label: "done" });
  assert.deepEqual(observed, ["planning", "ended"]);
  assert.equal(warnings.length, 1);
});

test("final progress is durable before observer delivery and dry runs write nothing", async (t) => {
  const c = await setupRun(t, [implement]);
  await c.seed({ [spec]: "s", [plan]: "p" });
  const path = join(
    c.repoRoot,
    c.config.paths.runsDir,
    "issue-9",
    "progress.json",
  );
  let finalSeen = false;
  await c.run(
    { issue: 9 },
    {
      observe: (s) => {
        if (s.state === "ended") {
          const record = JSON.parse(readFileSync(path, "utf8"));
          assert.equal(record.state, "ended");
          assert.equal(record.outcome.label, "done");
          finalSeen = true;
        }
      },
    },
  );
  assert.equal(finalSeen, true);
  const before = await fs.readFile(path, "utf8");
  await c.run({ issue: 9, dryRun: true });
  assert.equal(await fs.readFile(path, "utf8"), before);
});

test("progress write failures do not change a verified run outcome or lose observations", async (t) => {
  const c = await setupRun(t, [implement]);
  await c.seed({ [spec]: "s", [plan]: "p" });
  const rename = fs.rename;
  const patch = mock.method(
    fs,
    "rename",
    async (...args: Parameters<typeof fs.rename>) => {
      if (String(args[1]).endsWith("/progress.json"))
        throw Error("projection unavailable");
      return rename(...args);
    },
  );
  t.after(() => patch.mock.restore());
  const states: string[] = [];
  assert.equal(
    (await c.run({ issue: 9 }, { observe: (s) => states.push(s.state) }))
      .status,
    "completed",
  );
  assert.equal(states.at(-1), "ended");
  assert.ok(c.output.some((line) => line.includes("projection unavailable")));
  assert.ok(
    kernelComments(c).every(
      (comment) => !comment.body.includes("projection unavailable"),
    ),
  );
});

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

for (const failingState of ["deriving", "ended"] as const) {
  test(`observer failure during ${failingState} does not change the completed outcome`, async (t) => {
    const c = await setupRun(t, [implement]);
    await c.seed({ [spec]: "spec", [plan]: "plan" });
    const states: RunState[] = [];
    const outcome = await c.run(
      { issue: 9 },
      {
        observe: (snapshot) => {
          states.push(snapshot.state);
          if (snapshot.state === failingState)
            throw new Error("Observer unavailable");
        },
      },
    );
    assert.deepEqual(outcome, { status: "completed", issue: 9 });
    const { result } = await c.records();
    assert.deepEqual(result.outcome, outcome);
    assert.equal(result.sessions.length, 1);
    assert.equal(states.at(-1), "ended");
    assert.deepEqual(c.host.state().issues[0]!.labels, ["agent-done"]);
    const diagnostics = c.output.filter((line) =>
      line.includes("Observer unavailable"),
    );
    assert.equal(diagnostics.length, 1);
    assert.match(diagnostics[0]!, /snapshot observer/i);
    assert.equal(diagnostics[0]!.split("\n").length, 1);
    assert.equal(kernelComments(c).length, 1);
    assert.doesNotMatch(kernelComments(c)[0]!.body, /Observer unavailable/);
  });
}
