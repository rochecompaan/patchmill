import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import {
  fakeSubagents,
  NO_REPLY,
  type Script,
} from "../../test-support/fake-subagents.ts";
import { printModeLauncher, type PhaseLaunch } from "../kernel/launch.ts";
import { parseAgentResult } from "../kernel/result.ts";
import { SubagentsClient } from "./subagents-client.ts";
import { createWorkerLauncher } from "./worker-launcher.ts";
import { ConsoleController } from "./controller.ts";
import { fakeExtensionApi } from "../../test-support/fake-extension-api.ts";

async function fixture(
  t: test.TestContext,
  scripts: Record<string, Script> = {},
) {
  const root = await mkdtemp(join(tmpdir(), "patchmill-worker-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const sessionDir = join(root, "session");
  await mkdir(sessionDir);
  const launch: PhaseLaunch = {
    phase: "implementation",
    envelope: "envelope",
    promptPath: join(root, "prompt.md"),
    worktree: root,
    skillPath: root,
    sessionDir,
    logPath: join(root, "log"),
    aggregateLogPath: join(root, "aggregate"),
    timeoutMs: 1_000,
  };
  await writeFile(launch.promptPath, launch.envelope);
  const bus = fakeSubagents(scripts);
  const client = new SubagentsClient(bus, { replyTimeoutMs: 30 });
  t.after(() => client.dispose());
  return { root, launch, bus, client, launcher: createWorkerLauncher(client) };
}
async function waitUntil(predicate: () => boolean) {
  const deadline = Date.now() + 2_000;
  while (!predicate()) {
    assert.ok(Date.now() < deadline, "worker did not reach expected state");
    await delay(1);
  }
}
const done = { status: "done", summary: "implemented" };
const text = `\`\`\`json\n${JSON.stringify(done)}\n\`\`\``;

test("launcher reads saved output, logs it, copies session, and exposes active worker", async (t) => {
  const f = await fixture(t);
  const sessionFile = join(f.root, "worker.jsonl");
  await writeFile(sessionFile, "session");
  const pending = f.launcher.run(f.launch);
  await waitUntil(() => f.launcher.active() !== undefined);
  await writeFile(join(f.launch.sessionDir, "output.md"), text);
  assert.deepEqual(f.launcher.active(), { id: "run-1", state: "running" });
  assert.equal(f.bus.requests.at(-1)?.params.task, f.launch.envelope);
  assert.equal(
    f.bus.requests.at(-1)?.params.output,
    join(f.launch.sessionDir, "output.md"),
  );
  f.bus.complete("run-1", { results: [{ output: "fallback", sessionFile }] });
  const run = await pending;
  assert.deepEqual(run.result, { ok: true, result: done });
  assert.deepEqual(run.session, {
    exitCode: 0,
    timedOut: false,
    aborted: false,
  });
  assert.equal(await readFile(f.launch.logPath, "utf8"), text);
  assert.equal(
    await readFile(join(f.launch.sessionDir, "worker.jsonl"), "utf8"),
    "session",
  );
  assert.equal(f.launcher.active(), undefined);
});

test("missing JSON matches printModeLauncher parsing and uses completion fallback", async (t) => {
  const f = await fixture(t);
  const pending = f.launcher.run(f.launch);
  await waitUntil(() => f.launcher.active() !== undefined);
  f.bus.complete("run-1", {
    state: "failed",
    timedOut: true,
    results: [{ output: "plain text" }],
  });
  const run = await pending;
  const printed = await printModeLauncher({
    command: {
      command: process.execPath,
      argsPrefix: ["-e", "process.stdout.write('plain text')"],
    },
    agentDir: f.root,
    extensionPaths: [],
  })(f.launch);
  assert.deepEqual(run.result, parseAgentResult("plain text"));
  assert.deepEqual(run.result, printed.result);
  assert.deepEqual(run.result, { ok: false, reason: "no result" });
  assert.deepEqual(run.session, {
    exitCode: 1,
    timedOut: true,
    aborted: false,
  });
});

test("abort requests stop then waits for completion", async (t) => {
  const f = await fixture(t);
  const controller = new AbortController();
  const pending = f.launcher.run({ ...f.launch, signal: controller.signal });
  await waitUntil(() => f.launcher.active() !== undefined);
  controller.abort();
  await waitUntil(() => f.bus.requests.at(-1)?.method === "stop");
  assert.equal(f.bus.requests.at(-1)?.method, "stop");
  assert.deepEqual(f.launcher.active(), { id: "run-1", state: "stopping" });
  f.bus.complete("run-1", { state: "stopped", stopped: true });
  assert.equal((await pending).session.aborted, true);
});

test("resume uses previous id and fresh fallback rather than stale output", async (t) => {
  const f = await fixture(t);
  const initial = f.launcher.run(f.launch);
  await waitUntil(() => f.launcher.active() !== undefined);
  f.bus.complete("run-1");
  await initial;
  await writeFile(join(f.launch.sessionDir, "output.md"), "stale");
  const resumed = f.launcher.resume(f.launch, "guidance");
  await waitUntil(() => f.launcher.active() !== undefined);
  assert.deepEqual(f.bus.requests.at(-1)?.params, {
    id: "run-1",
    message: "guidance",
  });
  f.bus.complete("run-2", { results: [{ output: text }] });
  assert.deepEqual((await resumed).result, { ok: true, result: done });
  await f.launcher.stopActive();
});

test("already aborted launch stops its worker and stopActive waits for stop receipt", async (t) => {
  const f = await fixture(t);
  const pending = f.launcher.run({ ...f.launch, signal: AbortSignal.abort() });
  await waitUntil(() => f.launcher.active() !== undefined);
  assert.equal(f.bus.requests.at(-1)?.method, "stop");
  await f.launcher.stopActive();
  f.bus.complete("run-1", { state: "stopped", stopped: true });
  assert.equal((await pending).session.aborted, true);
});

test("unanswered spawn and RPC error become phase failures, not hangs", async (t) => {
  for (const spawn of [
    () => NO_REPLY,
    () => ({ error: { code: "execution_failed", message: "unavailable" } }),
  ]) {
    const f = await fixture(t, { spawn });
    const run = await f.launcher.run(f.launch);
    assert.equal(run.result.ok, false);
    if (!run.result.ok) assert.match(run.result.reason, /^pi-subagents: /);
    assert.deepEqual(run.session, {
      exitCode: null,
      timedOut: false,
      aborted: false,
    });
  }
});

for (const method of ["spawn", "resume"] as const) {
  test(`shutdown stops an in-flight ${method} and settles without a completion event`, async (t) => {
    let release: (() => void) | undefined;
    const f = await fixture(t);
    if (method === "resume") {
      const initial = f.launcher.run(f.launch);
      await waitUntil(() => f.launcher.active() !== undefined);
      f.bus.complete("run-1");
      await initial;
    }
    const original = f.client[
      method === "spawn" ? "spawnWorker" : "resume"
    ].bind(f.client);
    if (method === "spawn")
      f.client.spawnWorker = async (...args) => {
        await new Promise<void>((resolve) => {
          release = resolve;
        });
        return (original as SubagentsClient["spawnWorker"])(...args);
      };
    else
      f.client.resume = async (...args) => {
        await new Promise<void>((resolve) => {
          release = resolve;
        });
        return (original as SubagentsClient["resume"])(...args);
      };
    const pending =
      method === "spawn"
        ? f.launcher.run(f.launch)
        : f.launcher.resume(f.launch, "help");
    await waitUntil(() => release !== undefined);
    const closing = f.launcher.stopActive();
    release!();
    const run = await pending;
    await closing;
    assert.equal(run.session.aborted, true);
    assert.ok(f.bus.requests.some((request) => request.method === "stop"));
    const requests = f.bus.requests.length;
    assert.equal((await f.launcher.run(f.launch)).session.aborted, true);
    assert.equal(f.bus.requests.length, requests);
  });
}

for (const method of ["spawn", "resume"] as const) {
  test(
    `${method} execution deadline stops and settles without completion delivery`,
    { timeout: 2000 },
    async (t) => {
      const f = await fixture(t);
      if (method === "resume") {
        const initial = f.launcher.run(f.launch);
        await waitUntil(() => f.launcher.active() !== undefined);
        f.bus.complete("run-1");
        await initial;
        // Human waiting is not charged against the next execution allowance.
        await delay(30);
      }
      const launch = { ...f.launch, timeoutMs: 20 };
      const run = await (method === "spawn"
        ? f.launcher.run(launch)
        : f.launcher.resume(launch, "help"));
      assert.equal(run.session.timedOut, true);
      assert.equal(run.session.aborted, false);
      assert.ok(f.bus.requests.some((request) => request.method === "stop"));
      assert.equal(f.launcher.active(), undefined);
      assert.equal(f.bus.listenerCount(), 1);
    },
  );
}

test("shutdown during launch preparation prevents the spawn RPC", async (t) => {
  const f = await fixture(t);
  const run = f.launcher.run(f.launch);
  await f.launcher.stopActive();
  assert.equal((await run).session.aborted, true);
  assert.equal(f.bus.requests.length, 0);
});

test("shutdown waits for worker exit, not just the stop receipt", async (t) => {
  let running = true;
  const f = await fixture(t, {
    status: () => ({
      asyncSnapshot: {
        runs: running
          ? [
              {
                id: "run-1",
                state: "running",
                children: [{ agent: "patchmill-implementation" }],
              },
            ]
          : [],
      },
    }),
  });
  const run = f.launcher.run(f.launch);
  await waitUntil(() => f.launcher.active() !== undefined);
  let settled = false;
  const closing = f.launcher.stopActive().then(() => {
    settled = true;
  });
  await delay(10);
  assert.equal(settled, false);
  running = false;
  await closing;
  assert.equal((await run).session.aborted, true);
});

// Dropping failed stop evidence must not permit another worker or successful shutdown.
for (const path of ["deadline", "late spawn"] as const) {
  test(`${path} cleanup failure retains the worker and fails shutdown`, async (t) => {
    const f = await fixture(t, {
      status: () => ({
        error: { code: "unavailable", message: "status unavailable" },
      }),
    });
    const controller = new ConsoleController({
      pi: fakeExtensionApi(),
      workers: f.launcher,
      startRun: async () => ({ status: "no-work" }),
    });
    let release!: () => void;
    let closing: Promise<void> | undefined;
    if (path === "late spawn") {
      const spawn = f.client.spawnWorker.bind(f.client);
      f.client.spawnWorker = async (...args) => {
        await new Promise<void>((resolve) => {
          release = resolve;
        });
        return spawn(...args);
      };
    }
    const pending = f.launcher.run({ ...f.launch, timeoutMs: 10 });
    if (path === "late spawn") {
      await waitUntil(() => release !== undefined);
      closing = controller.shutdown();
      // Observe rejection immediately, even if the phase settles later.
      void closing.catch(() => {});
      release();
    }
    const run = await pending;
    assert.equal(run.session.timedOut, path === "deadline");
    assert.equal(run.session.aborted, path === "late spawn");
    assert.deepEqual(f.launcher.active(), { id: "run-1", state: "unresolved" });
    for (const method of ["run", "resume"] as const) {
      const result = await (method === "run"
        ? f.launcher.run(f.launch)
        : f.launcher.resume(f.launch, "help"));
      assert.equal(result.result.ok, false);
      if (path === "deadline" && !result.result.ok)
        assert.match(result.result.reason, /run-1.*status unavailable/);
    }
    assert.equal(
      f.bus.requests.filter(
        (r) => r.method === "spawn" || r.method === "resume",
      ).length,
      1,
    );
    const stops = f.bus.requests.filter((r) => r.method === "stop").length;
    await assert.rejects(
      closing ?? controller.shutdown(),
      /run-1.*status unavailable/,
    );
    await assert.rejects(f.launcher.stopActive(), /run-1.*status unavailable/);
    assert.ok(f.bus.requests.filter((r) => r.method === "stop").length > stops);
    assert.equal(f.launcher.active()?.id, "run-1");
  });
}

test("a later successful exit proof clears failed deadline cleanup and permits launch", async (t) => {
  let unavailable = true;
  const f = await fixture(t, {
    status: () =>
      unavailable
        ? { error: { code: "unavailable", message: "status unavailable" } }
        : { asyncSnapshot: { runs: [] } },
  });
  assert.equal(
    (await f.launcher.run({ ...f.launch, timeoutMs: 10 })).session.timedOut,
    true,
  );
  assert.equal(f.launcher.active()?.id, "run-1");
  unavailable = false;
  const pending = f.launcher.resume(f.launch, "help");
  await waitUntil(() => f.launcher.active()?.id === "run-2");
  const methods = f.bus.requests.map((r) => r.method);
  assert.deepEqual(methods.slice(-3), ["stop", "status", "resume"]);
  f.bus.complete("run-2", { results: [{ output: text }] });
  assert.equal((await pending).result.ok, true);
  assert.equal(f.launcher.active(), undefined);
  await f.launcher.stopActive();
});

test("an active worker past the stop wait remains unresolved", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: 100 });
  const f = await fixture(t, {
    stop: () => ({
      error: { code: "unavailable", message: "stop unavailable" },
    }),
    status: () => {
      t.mock.timers.tick(60_001);
      return {
        asyncSnapshot: {
          runs: [
            {
              id: "run-1",
              state: "running",
              children: [{ agent: "patchmill-implementation" }],
            },
          ],
        },
      };
    },
  });
  assert.equal(
    (await f.launcher.run({ ...f.launch, timeoutMs: 10 })).session.timedOut,
    true,
  );
  assert.equal(f.launcher.active()?.id, "run-1");
  const blocked = await f.launcher.run(f.launch);
  assert.equal(blocked.result.ok, false);
  assert.equal(f.bus.requests.filter((r) => r.method === "spawn").length, 1);
  await assert.rejects(f.launcher.stopActive(), /run-1.*stop wait/);
  assert.equal(f.launcher.active()?.id, "run-1");
});

for (const recovery of ["launch", "shutdown"] as const) {
  test(`completion during deadline cleanup retains proof for later ${recovery}`, async (t) => {
    const f = await fixture(t);
    let rejectStatus!: (error: Error) => void;
    const status = f.client.activeWorkers.bind(f.client);
    f.client.activeWorkers = () =>
      new Promise((_, reject) => {
        rejectStatus = reject;
      });
    let settled = false;
    const pending = f.launcher
      .run({ ...f.launch, timeoutMs: 10 })
      .then((run) => {
        settled = true;
        return run;
      });
    await waitUntil(() => rejectStatus !== undefined);
    f.bus.complete("run-1", { results: [{ output: text }] });
    // Let completion processing reach finalization while proof is still pending.
    await delay(20);
    assert.equal(settled, false, "phase must await outstanding cleanup");
    rejectStatus(new Error("late status rejection"));
    assert.equal((await pending).session.timedOut, true);
    assert.deepEqual(f.launcher.active(), { id: "run-1", state: "unresolved" });
    f.client.activeWorkers = status;
    const boundary = f.bus.requests.length;
    if (recovery === "launch") {
      const next = f.launcher.run(f.launch);
      await waitUntil(() => f.launcher.active()?.id === "run-2");
      assert.deepEqual(
        f.bus.requests.slice(boundary).map((r) => [r.method, r.params?.id]),
        [
          ["stop", "run-1"],
          ["status", undefined],
          ["spawn", undefined],
        ],
      );
      f.bus.complete("run-2", { results: [{ output: text }] });
      assert.equal((await next).result.ok, true);
      await f.launcher.stopActive();
    } else {
      await f.launcher.stopActive();
      assert.deepEqual(
        f.bus.requests.slice(boundary).map((r) => [r.method, r.params?.id]),
        [
          ["stop", "run-1"],
          ["status", undefined],
        ],
      );
    }
    assert.equal(f.launcher.active(), undefined);
  });
}

test("recovery and shutdown share the same pending exit proof", async (t) => {
  const f = await fixture(t, {
    status: () => ({
      error: { code: "unavailable", message: "initial failure" },
    }),
  });
  await f.launcher.run({ ...f.launch, timeoutMs: 10 });
  let release!: () => void;
  let statuses = 0;
  f.client.activeWorkers = async () => {
    if (++statuses === 1) {
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      throw new Error("older recovery rejected");
    }
    return [];
  };
  const next = f.launcher.run(f.launch);
  await waitUntil(() => release !== undefined);
  const closing = f.launcher.stopActive();
  void closing.catch(() => {});
  await delay(10);
  assert.equal(
    f.bus.requests.filter((r) => r.method === "stop").length,
    2,
    "one initial attempt and one shared recovery/shutdown attempt",
  );
  assert.equal(statuses, 1);
  release();
  await next;
  await assert.rejects(closing, /older recovery rejected/);
  // The next fresh proof succeeds, removing the failure for good.
  await f.launcher.stopActive();
  assert.equal(statuses, 2);
  assert.equal(f.launcher.active(), undefined);
});

for (const stage of [
  "deadline",
  "completion",
  "recovery",
  "shutdown",
] as const) {
  for (const succeeds of [true, false]) {
    test(`${stage} proof shared with shutdown: status ${succeeds ? "succeeds" : "rejects"}`, async (t) => {
      const f = await fixture(t);
      const retrying = stage === "recovery" || stage === "shutdown";
      if (retrying) {
        f.client.activeWorkers = async () => {
          throw new Error("initial rejection");
        };
        await f.launcher.run({ ...f.launch, timeoutMs: 10 });
      }
      let release!: () => void;
      let statuses = 0;
      f.client.activeWorkers = async () => {
        statuses++;
        await new Promise<void>((resolve) => {
          release = resolve;
        });
        if (!succeeds) throw new Error("latest rejection");
        return [];
      };
      const phase =
        stage === "shutdown"
          ? Promise.resolve(undefined)
          : f.launcher.run({ ...f.launch, timeoutMs: 10 });
      let closing: Promise<void> | undefined;
      if (stage === "shutdown") {
        closing = f.launcher.stopActive();
        void closing.catch(() => {});
      }
      await waitUntil(() => release !== undefined);
      if (stage === "completion")
        f.bus.complete("run-1", { results: [{ output: text }] });
      const shutdown = f.launcher.stopActive();
      void shutdown.catch(() => {});
      await delay(10);
      const attempts = retrying ? 2 : 1;
      assert.equal(
        f.bus.requests.filter((r) => r.method === "stop").length,
        attempts,
      );
      assert.equal(statuses, 1, "all callers share the in-flight proof");
      assert.equal(
        f.bus.requests.filter((r) => r.method === "spawn").length,
        1,
        "no new worker while exit is unproven",
      );
      release();
      await phase;
      if (succeeds) {
        await shutdown;
        await closing;
        assert.equal(f.launcher.active(), undefined);
      } else {
        await assert.rejects(shutdown, /latest rejection/);
        if (closing) await assert.rejects(closing, /latest rejection/);
        assert.equal(f.launcher.active()?.id, "run-1");
        // A failed latest proof is retryable; an eventual success removes it.
        f.client.activeWorkers = async () => [];
        await f.launcher.stopActive();
        assert.equal(f.launcher.active(), undefined);
      }
      assert.equal(
        f.bus.requests.filter((r) => r.method === "stop").length,
        attempts + (succeeds ? 0 : 1),
      );
    });
  }
}

// Failure settlement -> fresh retry before the older shutdown's final check.
for (const succeeds of [true, false]) {
  test(`concurrent shutdowns await a fresh proof after failure: latest ${succeeds ? "succeeds" : "rejects"}`, async (t) => {
    const f = await fixture(t, {
      status: () => ({
        error: { code: "unavailable", message: "deadline failure" },
      }),
    });
    await f.launcher.run({ ...f.launch, timeoutMs: 10 });
    let rejectFirst!: (error: Error) => void;
    let releaseLatest!: () => void;
    let statuses = 0;
    f.client.activeWorkers = async () => {
      if (++statuses === 1) {
        await new Promise<void>((_, reject) => {
          rejectFirst = reject;
        });
      } else {
        await new Promise<void>((resolve) => {
          releaseLatest = resolve;
        });
        if (!succeeds) throw new Error("latest failure");
      }
      return [];
    };
    let firstSettled = false;
    const first = f.launcher.stopActive();
    void first.then(
      () => {
        firstSettled = true;
      },
      () => {
        firstSettled = true;
      },
    );
    await waitUntil(() => rejectFirst !== undefined);
    const second = (async () => {
      // Observe the precise settlement boundary without waiting for a timer turn.
      for (let turn = 0; turn < 100; turn++) {
        if (f.launcher.active()?.state === "unresolved")
          return f.launcher.stopActive();
        await Promise.resolve();
      }
      assert.fail("did not observe failed proof before shutdown finalized");
    })();
    void second.catch(() => {});
    rejectFirst(new Error("first shutdown failure"));
    await waitUntil(() => releaseLatest !== undefined);
    await delay(10);
    const settledWhilePending = firstSettled;
    assert.equal(f.launcher.active()?.state, "stopping");
    assert.equal(statuses, 2);
    assert.equal(f.bus.requests.filter((r) => r.method === "stop").length, 3);
    assert.equal(f.bus.requests.filter((r) => r.method === "spawn").length, 1);
    releaseLatest();
    const results = await Promise.allSettled([first, second]);
    assert.equal(
      f.bus.requests.filter((r) => r.method === "stop").length,
      3,
      "final verification drains proofs without starting another attempt",
    );
    assert.equal(
      settledWhilePending,
      false,
      "older shutdown must await current proof",
    );
    assert.deepEqual(
      results.map((r) => r.status),
      succeeds ? ["fulfilled", "fulfilled"] : ["rejected", "rejected"],
    );
    if (!succeeds) {
      for (const result of results) {
        if (result.status === "rejected")
          assert.match(String(result.reason), /latest failure/);
      }
      assert.equal(f.launcher.active()?.state, "unresolved");
      f.client.activeWorkers = async () => [];
      await f.launcher.stopActive();
    }
    assert.equal(f.launcher.active(), undefined);
  });
}
