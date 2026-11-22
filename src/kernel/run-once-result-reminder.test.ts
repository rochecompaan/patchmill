import assert from "node:assert/strict";
import { test } from "node:test";
import {
  setupRun,
  spec,
  plan,
  done,
  implement,
  mergePullRequest,
  kernelComments,
} from "../../test-support/run-once-fixture.ts";
import { fakeHuman } from "../../test-support/fake-human.ts";

const { result: _result, ...implementWithoutResult } = implement;
const FALLBACK_WARNING =
  "the worker ended without a result block, so Patchmill verified the ready pull request";

test("a worker that answers the reminder is verified from its block", async (t) => {
  const c = await setupRun(t, [
    { ...implementWithoutResult, reminder: { result: done } },
  ]);
  await c.seed({ [spec]: "spec", [plan]: "plan" });
  assert.equal((await c.run()).status, "completed");
  const issue = c.host.state().issues[0]!;
  assert.deepEqual(issue.labels, ["agent-done"]);
  assert.match(kernelComments(c)[0]!.body, /Login work complete/);
  assert.doesNotMatch(kernelComments(c)[0]!.body, /without a result block/);
});

test("an interactive worker without a block and a ready PR enters the review wait", async (t) => {
  const c = await setupRun(t, [
    { ...implementWithoutResult, reminder: { stdout: "PR is ready" } },
  ]);
  await c.seed({ [spec]: "spec", [plan]: "plan" });
  const human = fakeHuman(c, {
    onWait: async (wait) => {
      assert.equal(wait.kind, "review");
      await mergePullRequest(c);
      return "continue";
    },
  });
  assert.equal((await c.run({ issue: 9 }, { human })).status, "completed");
  assert.ok(human.calls.includes("wait:review"));
  assert.ok(kernelComments(c)[0]!.body.includes(FALLBACK_WARNING));
});

test("an unattended worker without a block and a ready PR completes with a warning", async (t) => {
  const c = await setupRun(t, [
    { ...implementWithoutResult, reminder: { stdout: "PR is ready" } },
  ]);
  await c.seed({ [spec]: "spec", [plan]: "plan" });
  assert.equal((await c.run()).status, "completed");
  assert.deepEqual(c.host.state().issues[0]!.labels, ["agent-done"]);
  assert.ok(kernelComments(c)[0]!.body.includes(FALLBACK_WARNING));
});

test("a worker without a block and a draft PR stops with a clear reason", async (t) => {
  const c = await setupRun(t, [
    {
      ...implementWithoutResult,
      pullRequest: { draft: true, body: "Closes #9" },
      reminder: { stdout: "still working" },
    },
  ]);
  await c.seed({ [spec]: "spec", [plan]: "plan" });
  const outcome = await c.run();
  assert.equal(outcome.status, "stopped");
  assert.deepEqual(c.host.state().issues[0]!.labels, ["needs-info"]);
  const body = kernelComments(c)[0]!.body;
  assert.match(body, /without a result block, also after a reminder/);
  assert.match(body, /The pull request is a draft\./);
  assert.doesNotMatch(body, /no result/);
});
