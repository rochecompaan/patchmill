import assert from "node:assert/strict";
import test from "node:test";
import { ConsoleController, type StartRun } from "./controller.ts";
import type { PhaseLaunch, PhaseRun } from "../kernel/launch.ts";
import type { RunSnapshot } from "../kernel/run-snapshot.ts";
import type { RunOnceOutcome } from "../kernel/run-once.ts";
import { registerConsoleTools } from "./tools.ts";
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
  let finish!: (run: PhaseRun) => void;
  const running = new Promise<PhaseRun>((resolve) => {
    finish = resolve;
  });
  let ended = false;
  let requestStop!: () => void;
  const stopped = new Promise<void>((resolve) => {
    requestStop = resolve;
  });
  const { controller, workers } = setup(async (_issue, human) => {
    await human.runImplementation(launch);
    ended = true;
    return { status: "no-work" };
  });
  workers.run = () => running;
  workers.stopActive = async () => {
    requestStop();
  };
  await controller.startIssueRun(9);
  assert.equal(ended, false);
  assert.equal(
    await controller.continueRun(),
    "No Issue run is waiting for a merge.",
  );
  let closed = false;
  const shutdown = controller.shutdown().then(() => {
    closed = true;
  });
  await stopped;
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(closed, false);
  finish(result);
  await shutdown;
  assert.equal(ended, true);
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

for (const ending of ["completed", "rejected"] as const) {
  test(
    ending === "completed"
      ? "after an Issue run ends, the start tool runs a second issue"
      : "after an Issue run throws, the start tool runs a second issue",
    async (t) => {
      let finish!: (outcome: RunOnceOutcome) => void;
      let fail!: (error: Error) => void;
      const pending = new Promise<RunOnceOutcome>((resolve, reject) => {
        finish = resolve;
        fail = reject;
      });
      const started: number[] = [];
      const { controller, pi } = setup(async (issue) => {
        started.push(issue);
        return issue === 9 ? pending : { status: "no-work" };
      });
      t.after(async () => {
        finish({ status: "completed", issue: 9 });
        await controller.shutdown();
      });
      registerConsoleTools(
        pi,
        () => controller,
        (issue) => controller.startIssueRun(issue),
      );
      await controller.startIssueRun(9);
      if (ending === "completed") finish({ status: "completed", issue: 9 });
      else fail(new Error("Issue #9 failed"));
      await new Promise<void>((resolve) => setImmediate(resolve));

      assert.match(
        await pi.callTool(
          "patchmill_start_issue_run",
          { issue: 10 },
          { confirm: true },
        ),
        /#10/,
      );
      assert.deepEqual(started, [9, 10]);
    },
  );
}

test("a declined start claims nothing", async (t) => {
  const started: number[] = [];
  const { controller, pi } = setup(async (issue) => {
    started.push(issue);
    return { status: "no-work" };
  });
  t.after(() => controller.shutdown());
  registerConsoleTools(
    pi,
    () => controller,
    (issue) => controller.startIssueRun(issue),
  );

  assert.equal(
    await pi.callTool(
      "patchmill_start_issue_run",
      { issue: 10 },
      { confirm: false },
    ),
    "Not submitted.",
  );
  assert.deepEqual(started, []);
  assert.match(
    await pi.callTool(
      "patchmill_start_issue_run",
      { issue: 10 },
      { confirm: true },
    ),
    /#10/,
  );
  assert.deepEqual(started, [10]);
});

test("confirm guidance with no block changes nothing", async () => {
  const { controller, pi } = setup();
  assert.equal(
    await controller.confirmGuidance("Use OAuth"),
    "No worker is blocked.",
  );
  assert.equal(pi.messages.length, 0);
});

test("confirmed guidance resolves the pending block once", async () => {
  const { controller, pi } = setup();
  const pending = controller.awaitGuidance("Which auth provider?");
  assert.deepEqual(pi.messages.at(-1), {
    message: {
      customType: "patchmill",
      content: "Which auth provider?",
      display: true,
    },
    options: { triggerTurn: true },
  });
  await controller.confirmGuidance("Use OAuth");
  assert.deepEqual(await pending, { kind: "guidance", text: "Use OAuth" });
  assert.equal(
    await controller.confirmGuidance("Again"),
    "No worker is blocked.",
  );
  const quit = controller.awaitGuidance("Still blocked");
  await controller.shutdown();
  assert.deepEqual(await quit, { kind: "quit" });
});

test("guidance tool requires confirmation and preserves a declined block", async () => {
  const { registerConsoleTools } = await import("./tools.ts");
  const { controller, pi } = setup();
  registerConsoleTools(
    pi,
    () => controller,
    (issue) => controller.startIssueRun(issue),
  );
  const pending = controller.awaitGuidance("Which provider?");
  assert.equal(
    await pi.callTool(
      "patchmill_confirm_block_guidance",
      { guidance: "Use OAuth" },
      { confirm: false },
    ),
    "Not submitted.",
  );
  await pi.callTool("patchmill_confirm_block_guidance", {
    guidance: "Use OAuth",
  });
  assert.deepEqual(pi.confirmations.at(-1), {
    title: "Send guidance to the worker?",
    message: "Use OAuth",
  });
  assert.deepEqual(await pending, { kind: "guidance", text: "Use OAuth" });
  await controller.shutdown();
});
