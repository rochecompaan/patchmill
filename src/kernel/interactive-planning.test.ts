import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import {
  setupRun,
  spec,
  plan,
  done,
  implement,
  kernelComments,
} from "../../test-support/run-once-fixture.ts";
import { fakeHuman } from "../../test-support/fake-human.ts";
import { acquireLock } from "./lock.ts";

test("interactive run goes from planning to a verified PR in one attempt", async (t) => {
  const c = await setupRun(t, [
    {
      writeFiles: { [spec]: "s", [plan]: "p" },
      commit: "Plan",
      push: true,
      result: done,
    },
    implement,
  ]);
  const human = fakeHuman(c, { onWait: async () => "quit" });
  await c.run({ issue: 9 }, { human });
  assert.deepEqual(human.calls.slice(0, 2), ["planning", "implementation"]);
  assert.equal((await c.records()).result.sessions.length, 2);
});

test("a planning result that fails verification goes back to the chat", async (t) => {
  const c = await setupRun(t, [
    { writeFiles: { [spec]: "s", [plan]: "p" }, commit: "Plan", result: done },
    { push: true, result: done },
    implement,
  ]);
  const human = fakeHuman(c, { onWait: async () => "quit" });
  await c.run({ issue: 9 }, { human });
  assert.match(human.feedback[0]!, /remote branch does not exist/);
  assert.deepEqual(human.calls.slice(0, 3), [
    "planning",
    "planning",
    "implementation",
  ]);
  const comments = kernelComments(c);
  assert.equal(comments.length, 1);
  assert.doesNotMatch(comments[0]!.body, /needs-info/);
});

test("confirmed planning submissions reset the budget without reusing session paths", async (t) => {
  const c = await setupRun(t, [
    { writeFiles: { [spec]: "s", [plan]: "p" }, commit: "Plan", result: done },
    { result: done },
    { push: true, result: done },
    implement,
  ]);
  const human = fakeHuman(c);
  assert.equal((await c.run({ issue: 9 }, { human })).status, "completed");
  const { dir, result } = await c.records();
  assert.equal(result.sessions.length, 4);
  assert.equal(human.feedback.length, 2);
  assert.deepEqual((await fs.readdir(join(dir, "sessions"))).sort(), [
    "1",
    "2",
    "3",
    "4",
  ]);
  for (const number of [1, 2, 3, 4])
    assert.ok(
      (await fs.readFile(join(dir, `session-${number}.log`), "utf8")).length,
    );
});

test("quitting the console while planning pauses the run and releases the lock", async (t) => {
  const c = await setupRun(t, []);
  const human = fakeHuman(c, { quitPlanningAt: 1 });
  const outcome = await c.run({ issue: 9 }, { human });
  assert.deepEqual(outcome, {
    status: "paused",
    issue: 9,
    summary: "Run paused.",
  });
  // A pause changes nothing on the issue: the label stays and no comment.
  assert.deepEqual(c.host.state().issues[0]!.labels, ["in-progress"]);
  assert.equal(kernelComments(c).length, 0);
  const { result } = await c.records();
  assert.deepEqual(result.outcome, outcome);
  assert.equal(result.progress.state, "ended");
  assert.deepEqual(result.progress.outcome, {
    status: "paused",
    label: "inProgress",
  });
  await (await acquireLock(c.lockPath)).release();
});

test("interactive planning receives the chat result contract from the kernel", async (t) => {
  const c = await setupRun(t, []);
  const human = fakeHuman(c);
  let envelope: string | undefined;
  human.runPlanning = async (launch) => {
    envelope = launch.envelope;
    return {
      session: { exitCode: null, timedOut: false, aborted: true },
      result: { ok: false, reason: "Quit" },
    };
  };
  await c.run({ issue: 9 }, { human });
  assert.match(envelope!, /patchmill_submit_planning_result/);
});
