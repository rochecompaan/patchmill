import assert from "node:assert/strict";
import test from "node:test";
import { ConsoleController, type StartRun } from "./controller.ts";
import type { PhaseLaunch, PhaseRun } from "../kernel/launch.ts";
import type { RunSnapshot } from "../kernel/run-snapshot.ts";
import { fakeExtensionApi } from "../../test-support/fake-extension-api.ts";

const launch: PhaseLaunch = {
  phase: "planning",
  envelope: "Plan issue 9",
  promptPath: "prompt",
  worktree: "/tmp",
  skillPath: "skill",
  sessionDir: "session",
  logPath: "log",
  aggregateLogPath: "all",
  timeoutMs: 1000,
};
const result: PhaseRun = {
  result: { ok: true, result: { status: "done", summary: "ok" } },
  session: { exitCode: 0, timedOut: false, aborted: false },
};
function setup(startRun: StartRun = async () => ({ status: "no-work" })) {
  const pi = fakeExtensionApi();
  let stops = 0;
  const workers = {
    run: async () => result,
    resume: async () => result,
    active: () => ({ id: "w1", state: "running" }),
    stopActive: async () => {
      stops++;
    },
  };
  const controller = new ConsoleController({ pi, workers, startRun });
  return { pi, controller, workers, stops: () => stops };
}

test("planning sends envelope, feedback, and accepts only a pending result", async () => {
  const { controller, pi } = setup();
  assert.equal(
    await controller.submitPlanning({ status: "done", summary: "ok" }),
    "Patchmill is not waiting for a planning result.",
  );
  const pending = controller.runPlanning(launch);
  assert.deepEqual(pi.userMessages.at(-1), {
    text: "Plan issue 9",
    options: { deliverAs: "followUp" },
  });
  await controller.submitPlanning({ status: "done", summary: "ok" });
  assert.deepEqual(await pending, result);
  const retry = controller.runPlanning(launch, "missing plan");
  assert.equal(
    pi.userMessages.at(-1)?.text,
    "Patchmill could not accept the planning result:\n\nmissing plan\n\nFix it and submit again.",
  );
  await controller.shutdown();
  assert.equal((await retry).session.aborted, true);
});

test("continue without a merge wait does nothing, including during implementation", async () => {
  const { controller } = setup();
  assert.deepEqual(await controller.runImplementation(launch), result);
  assert.deepEqual(
    await controller.resumeImplementation(launch, "fix"),
    result,
  );
  assert.equal(
    await controller.continueRun(),
    "No Issue run is waiting for a merge.",
  );
});

for (const next of ["wait", "phase", "end"] as const) {
  test(`continue reports the next ${next} rather than stale state`, async () => {
    const { controller, pi } = setup(async (_issue, human, observe) => {
      await human.awaitContinue({ kind: "review", message: "Merge PR" });
      if (next === "wait")
        await human.awaitContinue({ kind: "review", message: "Still open" });
      if (next === "phase") {
        observe({
          issue: 9,
          runId: "r",
          runDir: "r",
          startedAt: "now",
          state: "implementation",
          phase: "implementation",
          session: 1,
        });
        await human.awaitGuidance("blocked");
      }
      return {
        status: "stopped",
        issue: 9,
        label: "needsInfo",
        summary: "Finished",
      };
    });
    await controller.startIssueRun(9);
    assert.deepEqual(pi.messages[0], {
      message: { customType: "patchmill", content: "Merge PR", display: true },
      options: { triggerTurn: true },
    });
    assert.equal(
      await controller.continueRun(),
      next === "wait"
        ? "Still open"
        : next === "phase"
          ? "The Issue run continues with implementation."
          : "Finished",
    );
    await controller.shutdown();
  });
}

test("status combines observed snapshot, cost, worker and wait; shutdown is idempotent", async () => {
  const snapshot: RunSnapshot = {
    issue: 9,
    runId: "r",
    runDir: "r",
    startedAt: "now",
    state: "gate-wait",
    session: 1,
    usage: { inputTokens: 100, outputTokens: 20, costUsd: 0.1 },
  };
  const { controller, stops } = setup(async (_issue, human, observe) => {
    observe(snapshot);
    assert.equal(
      await human.awaitContinue({ kind: "gate", message: "Merge" }),
      "quit",
    );
    assert.equal((await human.runPlanning(launch)).session.aborted, true);
    assert.deepEqual(await human.awaitGuidance("blocked"), { kind: "quit" });
    return { status: "no-work" };
  });
  await controller.startIssueRun(9);
  await assert.rejects(
    controller.startIssueRun(10),
    /An Issue run is already active\./,
  );
  assert.deepEqual(controller.status(), {
    snapshot,
    worker: { id: "w1", state: "running" },
    waiting: { kind: "gate", message: "Merge" },
    estimatedCost: "Cost: 100 in / 20 out tokens, $0.10",
  });
  await controller.shutdown();
  await controller.shutdown();
  assert.equal(stops(), 1);
});

test("settled runs release the slot and only thrown errors notify", async () => {
  let calls = 0;
  const { controller, pi } = setup(async () => {
    if (++calls === 1) throw new Error("boom");
    return { status: "no-work" };
  });
  await controller.startIssueRun(9);
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(pi.messages[0]?.message.content, "boom");
  assert.deepEqual(pi.messages[0]?.options, { triggerTurn: false });
  await controller.startIssueRun(10);
  await controller.shutdown();
  assert.equal(pi.messages.length, 1);
});
