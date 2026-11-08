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
import type { RunSnapshot } from "./run-snapshot.ts";

const blocked = {
  result: { status: "needs-input", summary: "Which auth provider?" },
};

test("a blocked worker gets guidance and continues in the same attempt", async (t) => {
  const c = await setupRun(t, [
    {
      writeFiles: { [spec]: "spec", [plan]: "plan" },
      commit: "Planning",
      push: true,
      result: done,
    },
    blocked,
    implement,
  ]);
  const snapshots: RunSnapshot[] = [];
  const human = fakeHuman(c, {
    onGuidance: async (summary) => {
      assert.equal(summary, "Which auth provider?");
      assert.equal(snapshots.at(-1)?.state, "blocked");
      assert.equal(kernelComments(c).length, 0);
      assert.deepEqual(c.host.state().issues[0]!.labels, ["in-progress"]);
      return { kind: "guidance", text: "Use OAuth" };
    },
  });
  assert.equal(
    (await c.run({ issue: 9 }, { human, observe: (s) => snapshots.push(s) }))
      .status,
    "completed",
  );
  assert.deepEqual(human.calls, [
    "planning",
    "implementation",
    "guidance",
    "resume:Use OAuth",
    "wait:review",
  ]);
  assert.equal(kernelComments(c).length, 1);
  assert.match(kernelComments(c)[0]!.body, /pull request was verified/);
  assert.equal(
    await fs.readFile(join((await c.records()).dir, "guidance.md"), "utf8"),
    "Use OAuth\n\n",
  );
  assert.equal((await c.records()).result.sessions.length, 3);
  assert.deepEqual(
    snapshots
      .filter((s) => s.state === "implementation")
      .map((s) => s.session)
      .filter((n, i, a) => i === 0 || a[i - 1] !== n),
    [2, 3],
  );
});

for (const interactive of [true, false]) {
  test(`${interactive ? "quitting while blocked" : "non-interactive needs-input"} publishes the needs-info stop`, async (t) => {
    const c = await setupRun(t, [blocked]);
    await c.seed({ [spec]: "spec", [plan]: "plan" });
    const human = fakeHuman(c);
    const outcome = await c.run({ issue: 9 }, interactive ? { human } : {});
    assert.equal(outcome.status, "stopped");
    assert.deepEqual(
      human.calls,
      interactive ? ["implementation", "guidance"] : [],
    );
    assert.deepEqual(c.host.state().issues[0]!.labels, ["needs-info"]);
    assert.match(
      kernelComments(c)[0]!.body,
      /The agent reported needs-input\.\n\nWhich auth provider\?/,
    );
    assert.equal((await c.records()).result.sessions.length, 1);
  });
}

test("repeated blocks reset the human-free session budget", async (t) => {
  const c = await setupRun(t, [blocked, blocked, blocked, blocked, implement]);
  await c.seed({ [spec]: "spec", [plan]: "plan" });
  const human = fakeHuman(c, {
    onGuidance: async () => ({ kind: "guidance", text: "Use OAuth" }),
  });
  assert.equal((await c.run({ issue: 9 }, { human })).status, "completed");
  assert.equal((await c.records()).result.sessions.length, 5);
  assert.equal(
    await fs.readFile(join((await c.records()).dir, "guidance.md"), "utf8"),
    "Use OAuth\n\n".repeat(4),
  );
});

for (const failure of ["aborted", "timedOut", "failed", "invalid"] as const) {
  test(`${failure} implementation does not wait for guidance`, async (t) => {
    const c = await setupRun(t);
    await c.seed({ [spec]: "spec", [plan]: "plan" });
    const human = fakeHuman(c);
    human.runImplementation = async () => ({
      session: {
        exitCode: 1,
        aborted: failure === "aborted",
        timedOut: failure === "timedOut",
      },
      result:
        failure === "invalid"
          ? { ok: false, reason: "invalid" }
          : {
              ok: true,
              result: {
                status: failure === "failed" ? "failed" : "needs-input",
                summary: "stop",
              },
            },
    });
    assert.equal((await c.run({ issue: 9 }, { human })).status, "stopped");
    assert.equal(human.calls.includes("guidance"), false);
  });
}
