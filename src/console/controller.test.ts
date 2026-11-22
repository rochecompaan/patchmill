import assert from "node:assert/strict";
import test, { after } from "node:test";
import fs from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ConsoleController, type StartRun } from "./controller.ts";
import type { PhaseLaunch, PhaseRun } from "../kernel/launch.ts";
import type { RunSnapshot } from "../kernel/run-snapshot.ts";
import type { RunOnceOutcome } from "../kernel/run-once.ts";
import { fakeExtensionApi } from "../../test-support/fake-extension-api.ts";
import type { StatusLine } from "./run-status.ts";

const sessionDir = await fs.mkdtemp(join(tmpdir(), "console-planning-test-"));
after(() => fs.rm(sessionDir, { recursive: true, force: true }));

const launch: PhaseLaunch = {
  phase: "planning",
  envelope: "Plan issue 9",
  promptPath: "prompt",
  worktree: "/tmp",
  skillPath: "skill",
  sessionDir,
  logPath: "log",
  aggregateLogPath: "all",
  timeoutMs: 1000,
};
const result: PhaseRun = {
  result: { ok: true, result: { status: "done", summary: "ok" } },
  session: { exitCode: 0, timedOut: false, aborted: false },
};
function setup(
  startRun: StartRun = async () => ({ status: "no-work" }),
  runStatus?: { show(line: StatusLine): void; clear(): void },
  announceRunEnd?: boolean,
) {
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
  const controller = new ConsoleController({
    pi,
    workers,
    startRun,
    ...(runStatus ? { runStatus } : {}),
    ...(announceRunEnd === undefined ? {} : { announceRunEnd }),
  });
  return { pi, controller, workers, stops: () => stops };
}

function recordingStatus() {
  const calls: string[][] = [];
  return {
    calls,
    show: (line: StatusLine) => {
      calls.push(["show", line.label]);
    },
    clear: () => {
      calls.push(["clear"]);
    },
  };
}
function statusSnapshot(state: RunSnapshot["state"]): RunSnapshot {
  return {
    issue: 9,
    title: "Polls",
    runId: "r",
    runDir: "r",
    startedAt: "now",
    session: 1,
    state,
  };
}

const tick = () => new Promise<void>((resolve) => setImmediate(resolve));
function mergedSnapshot(cleanup: RunSnapshot["cleanup"]): RunSnapshot {
  return {
    ...statusSnapshot("ended"),
    summary: "The pull request is merged.",
    facts: {
      pullRequest: { state: "merged", url: "https://x/pr/1" },
    } as unknown as NonNullable<RunSnapshot["facts"]>,
    ...(cleanup ? { cleanup } : {}),
  };
}
const stopped: RunOnceOutcome = {
  status: "stopped",
  issue: 9,
  label: "needsInfo",
  summary: "Checks failed.",
};
const endMessages = (pi: ReturnType<typeof fakeExtensionApi>) =>
  pi.messages.filter((m) => m.message.content.startsWith("Issue #"));

test("the status shows preparing at once and keeps the end label after a merged run", async () => {
  const status = recordingStatus();
  const { controller, pi } = setup(async (_issue, _human, observe) => {
    observe(statusSnapshot("deriving"));
    observe({ ...statusSnapshot("planning"), phase: "planning" });
    observe(mergedSnapshot("cleaned"));
    return { status: "completed", issue: 9 };
  }, status);
  await controller.startIssueRun(9);
  assert.deepEqual(status.calls[0], ["show", "preparing"]);
  await tick();
  assert.deepEqual(status.calls, [
    ["show", "preparing"],
    ["show", "preparing"],
    ["show", "01 planning"],
    ["show", "ended"],
    ["show", "merged · cleaned up — safe to quit"],
  ]);
  const [end] = endMessages(pi);
  assert.match(
    end!.message.content,
    /^Issue #9 run ended: the pull request is merged\./,
  );
  assert.deepEqual(end!.options, { triggerTurn: false });
  await controller.shutdown();
});

test("a stopped run keeps the end label", async () => {
  const status = recordingStatus();
  const { controller } = setup(async (_issue, _human, observe) => {
    observe(statusSnapshot("deriving"));
    return stopped;
  }, status);
  await controller.startIssueRun(9);
  await tick();
  assert.deepEqual(status.calls.at(-1), [
    "show",
    "stopped: needs info — see the summary",
  ]);
  assert.equal(
    status.calls.some(([call]) => call === "clear"),
    false,
  );
  await controller.shutdown();
});

test("a thrown run keeps the end label and posts the error once", async () => {
  const status = recordingStatus();
  const { controller, pi } = setup(async (_issue, _human, observe) => {
    observe(statusSnapshot("deriving"));
    throw Error("boom");
  }, status);
  await controller.startIssueRun(9);
  await tick();
  assert.deepEqual(status.calls.at(-1), ["show", "failed — see the error"]);
  const posted = pi.messages.filter((m) => m.message.content.includes("boom"));
  assert.equal(posted.length, 1);
  assert.match(posted[0]!.message.content, /^Issue #9 run ended: failed\./);
  await controller.shutdown();
});

test("stopped, failed and kept-cleanup runs ask the Console agent to explain", async () => {
  const cases: [StartRun, boolean][] = [
    [async () => stopped, true],
    [
      async () => {
        throw Error("boom");
      },
      true,
    ],
    [
      async (_issue, _human, observe) => {
        observe(mergedSnapshot("kept"));
        return { status: "completed", issue: 9 };
      },
      true,
    ],
    [
      async (_issue, _human, observe) => {
        observe(mergedSnapshot("cleaned"));
        return { status: "completed", issue: 9 };
      },
      false,
    ],
  ];
  for (const [startRun, explain] of cases) {
    const { controller, pi } = setup(startRun);
    await controller.startIssueRun(9);
    await tick();
    const [end] = endMessages(pi);
    assert.deepEqual(end!.options, { triggerTurn: explain });
    await controller.shutdown();
  }
});

test("the end message resolves a pending continue", async () => {
  const { controller, pi } = setup(async (_issue, human, observe) => {
    await human.awaitContinue({ kind: "review", message: "Merge PR" });
    observe(mergedSnapshot("cleaned"));
    return { status: "completed", issue: 9 };
  });
  await controller.startIssueRun(9);
  const next = await controller.continueRun();
  assert.equal(next, controller.status().ended!.message);
  assert.equal(pi.messages.at(-1)!.message.content, next);
  await controller.shutdown();
});

test("status reports the ended run", async () => {
  const { controller } = setup(async (_issue, _human, observe) => {
    observe(mergedSnapshot("cleaned"));
    return { status: "completed", issue: 9 };
  });
  await controller.startIssueRun(9);
  await tick();
  const status = controller.status();
  assert.equal(status.ended!.outcome, "merged");
  assert.equal(status.ended!.label, "merged · cleaned up — safe to quit");
  assert.equal(status.snapshot!.state, "ended");
  await controller.shutdown();
});

test("a new run resets the ended run", async () => {
  const status = recordingStatus();
  let calls = 0;
  const { controller } = setup(async (_issue, human, observe) => {
    if (++calls === 1) return stopped;
    observe(statusSnapshot("gate-wait"));
    await human.awaitContinue({ kind: "gate", message: "Merge" });
    return { status: "no-work" };
  }, status);
  await controller.startIssueRun(9);
  await tick();
  assert.ok(controller.status().ended);
  const before = status.calls.length;
  await controller.startIssueRun(9);
  assert.equal(controller.status().ended, undefined);
  assert.deepEqual(status.calls[before], ["show", "preparing"]);
  await tick();
  assert.deepEqual(status.calls.at(-1), ["show", "awaiting approval"]);
  await controller.shutdown();
});

test("shutdown after an ended run clears the status", async () => {
  const status = recordingStatus();
  const { controller } = setup(async () => stopped, status);
  await controller.startIssueRun(9);
  await tick();
  await controller.shutdown();
  assert.deepEqual(status.calls.at(-1), ["clear"]);
});

test("shutdown clears the status", async () => {
  const status = recordingStatus();
  const { controller } = setup(async (_issue, human, observe) => {
    observe(statusSnapshot("gate-wait"));
    await human.awaitContinue({ kind: "gate", message: "Merge" });
    return { status: "no-work" };
  }, status);
  await controller.startIssueRun(9);
  await tick();
  assert.deepEqual(status.calls, [
    ["show", "preparing"],
    ["show", "awaiting approval"],
  ]);
  await controller.shutdown();
  assert.deepEqual(status.calls.at(2), ["clear"]);
});

test("a run that settles during shutdown shows and posts nothing", async () => {
  const status = recordingStatus();
  const { controller, pi } = setup(async (_issue, human, observe) => {
    observe(statusSnapshot("review-wait"));
    assert.equal(
      await human.awaitContinue({ kind: "review", message: "Merge PR" }),
      "quit",
    );
    observe({ ...statusSnapshot("ended"), summary: "Waiting." });
    return { status: "completed", issue: 9 };
  }, status);
  await controller.startIssueRun(9);
  await tick();
  const posted = pi.messages.length;
  await controller.shutdown();
  const cleared = status.calls.findIndex(([call]) => call === "clear");
  assert.deepEqual(status.calls.slice(cleared), [["clear"]]);
  assert.equal(pi.messages.length, posted);
  assert.equal(controller.status().ended, undefined);
});

test("shutdown resolves a pending continue", async () => {
  const { controller } = setup(async (_issue, human) => {
    while (
      (await human.awaitContinue({ kind: "review", message: "Merge PR" })) ===
      "continue"
    );
    return { status: "completed", issue: 9 };
  });
  await controller.startIssueRun(9);
  await tick();
  const next = controller.continueRun();
  await controller.shutdown();
  assert.equal(await next, "The console is shutting down.");
});

test("announceRunEnd false posts only a thrown error", async () => {
  const quiet = setup(
    async (_issue, human) => {
      await human.awaitContinue({ kind: "review", message: "Merge PR" });
      return stopped;
    },
    undefined,
    false,
  );
  await quiet.controller.startIssueRun(9);
  const next = await quiet.controller.continueRun();
  assert.equal(next, "Checks failed.");
  assert.equal(endMessages(quiet.pi).length, 0);
  assert.equal(quiet.controller.status().ended!.outcome, "stopped");
  await quiet.controller.shutdown();
  const status = recordingStatus();
  const failing = setup(
    async () => {
      throw Error("boom");
    },
    status,
    false,
  );
  await failing.controller.startIssueRun(9);
  await tick();
  assert.deepEqual(
    failing.pi.messages.map((m) => m.message.content),
    ["boom"],
  );
  assert.deepEqual(status.calls.at(-1), ["show", "failed — see the error"]);
  await failing.controller.shutdown();
});

test("a failing end message does not block continue or shutdown", async () => {
  const { controller, pi } = setup(async (_issue, human) => {
    await human.awaitContinue({ kind: "review", message: "Merge PR" });
    return stopped;
  });
  await controller.startIssueRun(9);
  pi.sendMessage = () => {
    throw new Error("stale context");
  };
  const next = await controller.continueRun();
  assert.match(next, /^Issue #9 run ended: stopped/);
  await controller.shutdown();
});

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
    const reported = await controller.continueRun();
    if (next === "end")
      assert.match(reported, /^Issue #9 run ended: stopped \(needs info\)\./);
    else
      assert.equal(
        reported,
        next === "wait"
          ? "Still open"
          : "The Issue run continues with implementation.",
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

test("settled runs release the slot; an unknown issue posts only its error", async () => {
  let calls = 0;
  const { controller, pi } = setup(async () => {
    if (++calls === 1) throw new Error("boom");
    return { status: "no-work" };
  });
  assert.equal(await controller.startIssueRun(), "Started the next Issue run.");
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(pi.messages[0]?.message.content, "boom");
  assert.deepEqual(pi.messages[0]?.options, { triggerTurn: false });
  await controller.startIssueRun(10);
  await new Promise<void>((resolve) => setImmediate(resolve));
  await controller.shutdown();
  assert.equal(pi.messages.length, 2);
  assert.match(
    pi.messages[1]!.message.content,
    /^Issue #10 run ended: the run did not start\./,
  );
});

for (const ending of ["completed", "rejected"] as const) {
  test(
    ending === "completed"
      ? "after an Issue run ends, the controller permits another Issue run"
      : "after an Issue run throws, the controller permits another Issue run",
    async (t) => {
      let finish!: (outcome: RunOnceOutcome) => void;
      let fail!: (error: Error) => void;
      const pending = new Promise<RunOnceOutcome>((resolve, reject) => {
        finish = resolve;
        fail = reject;
      });
      const started: number[] = [];
      const { controller } = setup(async (issue) => {
        started.push(issue);
        return issue === 9 ? pending : { status: "no-work" };
      });
      t.after(async () => {
        finish({ status: "completed", issue: 9 });
        await controller.shutdown();
      });
      await controller.startIssueRun(9);
      if (ending === "completed") finish({ status: "completed", issue: 9 });
      else fail(new Error("Issue #9 failed"));
      await new Promise<void>((resolve) => setImmediate(resolve));

      assert.match(await controller.startIssueRun(10), /#10/);
      assert.deepEqual(started, [9, 10]);
    },
  );
}

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
  registerConsoleTools(pi, () => controller);
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
