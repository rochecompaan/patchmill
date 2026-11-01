import assert from "node:assert/strict";
import { test } from "node:test";
import {
  setupRun,
  spec,
  plan,
  done,
  branch,
  implement,
  merge,
  mergePullRequest,
  kernelComments,
  type Scenario,
} from "../../test-support/run-once-fixture.ts";
import { fakeHuman } from "../../test-support/fake-human.ts";
import { acquireLock, LockHeldError } from "./lock.ts";

const specBranch = "agent/issue-9--spec";
const planning = (files: Record<string, string>, pr = false) => ({
  writeFiles: files,
  commit: "Planning",
  push: true,
  ...(pr ? { pullRequest: { draft: false, body: "Refs #9" } } : {}),
  result: done,
});
async function ready(c: Scenario) {
  await c.seed({ [spec]: "spec", [plan]: "plan", "login.ts": "code" });
  await c.mutate((s) => {
    s.issues[0]!.labels = ["agent-done"];
    s.pullRequests.push({
      number: 1,
      url: "https://example.invalid/1",
      state: "open",
      draft: false,
      body: "Closes #9",
      headRepository: "fixture/repo",
      headBranch: branch,
      baseBranch: "main",
    });
  });
}

test("spec gate waits in the attempt and continues after the merge", async (t) => {
  const c = await setupRun(t, [
    planning({ [spec]: "spec" }, true),
    planning({ [plan]: "plan" }),
    implement,
  ]);
  c.config.workflow.specApproval.required = true;
  const messages: string[] = [];
  const human = fakeHuman(c, {
    onWait: async (wait, n) => {
      if (wait.kind !== "gate") return "quit";
      messages.push(wait.message);
      if (n === 2) await merge(c, specBranch);
      return "continue";
    },
  });
  await c.run({ issue: 9 }, { human });
  assert.deepEqual(human.calls, [
    "planning",
    "wait:gate",
    "wait:gate",
    "planning",
    "implementation",
    "wait:review",
  ]);
  assert.equal(messages[0], messages[1]);
  assert.equal((await c.records()).result.sessions.length, 3);
});

test("a verified PR gets agent-done at once and the run waits for the merge", async (t) => {
  const c = await setupRun(t, [implement]);
  await c.seed({ [spec]: "spec", [plan]: "plan" });
  let waited = false;
  const human = fakeHuman(c, {
    onWait: async (wait) => {
      waited = true;
      assert.equal(wait.kind, "review");
      assert.match(wait.message, /https:.*merge/i);
      assert.deepEqual(c.host.state().issues[0]!.labels, ["agent-done"]);
      assert.equal(kernelComments(c).length, 1);
      assert.match(
        c.host.state().pullRequests[0]!.body,
        /patchmill-run-cost:start/,
      );
      await assert.rejects(acquireLock(c.lockPath), LockHeldError);
      await mergePullRequest(c);
      return "continue";
    },
  });
  assert.equal((await c.run({ issue: 9 }, { human })).status, "completed");
  assert.equal(waited, true);
  assert.equal(kernelComments(c).length, 1);
});

test("a restart in the review wait removes in-progress and starts no session", async (t) => {
  const c = await setupRun(t);
  await ready(c);
  const human = fakeHuman(c);
  await c.run({ issue: 9 }, { human });
  assert.deepEqual(human.calls, ["wait:review"]);
  assert.deepEqual(c.host.state().issues[0]!.labels, ["agent-done"]);
  assert.equal(kernelComments(c).length, 0);
  assert.equal((await c.records()).result.sessions.length, 0);
});

for (const change of [
  "closed",
  "wrong base",
  "merged without closing",
] as const) {
  test(`${change} during review replaces agent-done with needs-info`, async (t) => {
    const c = await setupRun(t, [implement]);
    await c.seed({ [spec]: "spec", [plan]: "plan" });
    const human = fakeHuman(c, {
      onWait: async () => {
        await c.mutate((s) => {
          const pr = s.pullRequests[0]!;
          if (change === "closed") pr.state = "closed";
          if (change === "wrong base") pr.baseBranch = "release";
          if (change === "merged without closing") {
            pr.state = "merged";
            pr.body = "Refs #9";
          }
        });
        return "continue";
      },
    });
    await c.run({ issue: 9 }, { human });
    assert.deepEqual(c.host.state().issues[0]!.labels, ["needs-info"]);
    assert.equal(kernelComments(c).length, 2);
  });
}

test("review continue on an open PR waits again; quit publishes nothing more", async (t) => {
  const c = await setupRun(t, [implement]);
  await c.seed({ [spec]: "spec", [plan]: "plan" });
  const human = fakeHuman(c, {
    onWait: async (_wait, n) => (n === 1 ? "continue" : "quit"),
  });
  await c.run({ issue: 9 }, { human });
  assert.deepEqual(human.calls, [
    "implementation",
    "wait:review",
    "wait:review",
  ]);
  assert.equal(kernelComments(c).length, 1);
});

test("quitting during a derived gate wait publishes the gate stop", async (t) => {
  const c = await setupRun(t, [planning({ [spec]: "spec" }, true)]);
  c.config.workflow.specApproval.required = true;
  await c.run();
  await c.mutate((s) => {
    s.issues[0]!.comments = [];
  });
  const human = fakeHuman(c);
  await c.run({ issue: 9 }, { human });
  assert.deepEqual(human.calls, ["wait:gate"]);
  assert.deepEqual(c.host.state().issues[0]!.labels, ["in-progress"]);
  assert.match(kernelComments(c)[0]!.body, /Waiting for it to be merged/);
});

test("a non-interactive rerun on a ready PR still derives implementation", async (t) => {
  const c = await setupRun(t, [implement]);
  await ready(c);
  await c.run({ issue: 9 });
  assert.equal((await c.records()).result.sessions[0].phase, "implementation");
});
