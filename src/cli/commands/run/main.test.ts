import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, type TestContext } from "node:test";
import { CONFIG_FILE } from "../../../config/config.ts";
import {
  LifetimeLockHeldError,
  type LifetimeLock,
} from "../../../kernel/runner/lifetime-lock.ts";
import type {
  RunnerShellInput,
  RunnerShellResult,
} from "../../../kernel/runner/shell.ts";
import { stateTrackingMode } from "../../../kernel/state-tracking-mode.ts";
import type { CommandRunner } from "../../../process/command.ts";
import { main } from "./main.ts";

const gh: CommandRunner = async () => ({ code: 0, stdout: "", stderr: "" });

async function harness(t: TestContext, config: object = {}) {
  const root = await mkdtemp(join(tmpdir(), "patchmill-run-cli-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(join(root, CONFIG_FILE), JSON.stringify(config));
  const stdout: string[] = [];
  const stderr: string[] = [];
  let releases = 0;
  let lockRequests = 0;
  const lock: LifetimeLock = {
    path: join(root, ".git/patchmill/run.lock"),
    record: {
      instanceId: "i-1",
      pid: process.pid,
      processStart: null,
      host: "h",
      repository: root,
      startedAt: "2026-11-21T12:00:00.000Z",
    },
    release: async () => {
      releases += 1;
    },
  };
  let shellInput: RunnerShellInput | undefined;
  const options = {
    repoRoot: root,
    runner: gh,
    output: {
      stdout: (s: string) => stdout.push(s),
      stderr: (s: string) => stderr.push(s),
    },
    acquireLifetimeLock: async () => {
      lockRequests += 1;
      return lock;
    },
    runRunnerShell: async (input: RunnerShellInput) => {
      shellInput = input;
      return { kind: "stopped" } as RunnerShellResult;
    },
  };
  return {
    root,
    stdout,
    stderr,
    options,
    releases: () => releases,
    lockRequests: () => lockRequests,
    shellInput: () => shellInput!,
  };
}

test("help prints usage without configuration", async () => {
  const stdout: string[] = [];
  const code = await main(["--help"], {
    repoRoot: "/nonexistent",
    output: { stdout: (s) => stdout.push(s), stderr: () => {} },
  });
  assert.equal(code, 0);
  assert.match(stdout.join("\n"), /Usage: patchmill run/);
});

test("unknown arguments exit 1", async (t) => {
  const h = await harness(t);
  assert.equal(await main(["--runner", "a"], h.options), 1);
  assert.equal(h.lockRequests(), 0);
  assert.match(h.stderr.join("\n"), /Unknown argument: --runner/);
});

test("a refused mode exits 1 before the lock", async (t) => {
  const h = await harness(t);
  const reason =
    "patchmill run does not support control-plane mode yet (#360).";
  const code = await main([], {
    ...h.options,
    stateTrackingMode: (config) => ({
      ...stateTrackingMode(config),
      run: { allowed: false, reason },
    }),
  });
  assert.equal(code, 1);
  assert.ok(h.stderr.join("\n").includes(reason));
  assert.equal(h.lockRequests(), 0);
});

test("a failed host check exits 1 before the lock", async (t) => {
  const h = await harness(t);
  const code = await main([], {
    ...h.options,
    runner: async () => ({ code: 1, stdout: "", stderr: "no gh" }),
  });
  assert.equal(code, 1);
  assert.equal(h.lockRequests(), 0);
});

test("a live lock owner exits 2", async (t) => {
  const h = await harness(t);
  const code = await main([], {
    ...h.options,
    acquireLifetimeLock: async () => {
      throw new LifetimeLockHeldError("/x/run.lock", {
        ...(await h.options.acquireLifetimeLock()).record,
        pid: 4242,
      });
    },
  });
  assert.equal(code, 2);
  assert.match(h.stderr.join("\n"), /pid 4242/);
});

test("a clean stop exits 0 and releases the lock", async (t) => {
  const h = await harness(t);
  assert.equal(await main([], h.options), 0);
  assert.equal(h.releases(), 1);
});

test("a fatal pass exits 1 and releases the lock", async (t) => {
  const h = await harness(t);
  const code = await main([], {
    ...h.options,
    runRunnerShell: async () => ({ kind: "fatal", reason: "x conflict" }),
  });
  assert.equal(code, 1);
  assert.match(h.stderr.join("\n"), /x conflict/);
  assert.equal(h.releases(), 1);
});

test("a shell throw exits 1 and releases the lock", async (t) => {
  const h = await harness(t);
  const code = await main([], {
    ...h.options,
    runRunnerShell: async () => {
      throw new Error("boom");
    },
  });
  assert.equal(code, 1);
  assert.equal(h.releases(), 1);
});

test("the shell receives the configured backoff and a local work source", async (t) => {
  const h = await harness(t, { run: { idleBackoff: { initialSeconds: 7 } } });
  let passed: AbortSignal | undefined;
  assert.equal(
    await main([], {
      ...h.options,
      runOneIssue: async (_config, _deps, options) => {
        passed = options.signal;
        return { status: "no-work" };
      },
    }),
    0,
  );
  const input = h.shellInput();
  assert.equal(input.backoff.idle.initialSeconds, 7);
  assert.equal(input.backoff.error.initialSeconds, 30);
  const signal = new AbortController().signal;
  assert.deepEqual(await input.workSource.pass(signal), {
    kind: "idle",
    reason: "no eligible issue",
  });
  assert.equal(passed, signal);
});

test("the configured triage interval reaches the gate", async (t) => {
  const h = await harness(t, { run: { triageIntervalMinutes: 5 } });
  let time = new Date(2026, 10, 21, 12).getTime();
  const start = time;
  await main([], { ...h.options, now: () => new Date(time) });
  const gate = h.shellInput().triageGate;
  assert.ok(await gate.tryGrant());
  time = start + 4 * 60_000;
  assert.equal(await gate.tryGrant(), undefined);
  time = start + 5 * 60_000;
  assert.ok(await gate.tryGrant());
});

test("the shell's triage calls runTriage with the grant's beforeWrite", async (t) => {
  const h = await harness(t);
  let received: { beforeWrite?: unknown; signal?: AbortSignal } | undefined;
  await main([], {
    ...h.options,
    runTriage: async (_config, _deps, options) => {
      received = options;
      return [];
    },
  });
  const beforeWrite = async () => {};
  const signal = new AbortController().signal;
  await h.shellInput().triage({ beforeWrite, release: async () => {} }, signal);
  assert.equal(received?.beforeWrite, beforeWrite);
  assert.equal(received?.signal, signal);
});

for (const name of ["SIGINT", "SIGTERM"] as const) {
  test(`${name}: the first signal aborts and a second forces exit 1`, async (t) => {
    const h = await harness(t);
    const before = process.listeners(name);
    const exits: number[] = [];
    const code = await main([], {
      ...h.options,
      exit: (code) => exits.push(code),
      runRunnerShell: async (input) => {
        assert.equal(input.signal.aborted, false);
        process.emit(name, name);
        assert.equal(input.signal.aborted, true);
        assert.deepEqual(exits, []);
        process.emit(name, name);
        assert.deepEqual(exits, [1]);
        return { kind: "stopped" };
      },
    });
    assert.equal(code, 0);
    assert.match(h.stderr.join("\n"), /forced exit/);
    assert.deepEqual(process.listeners(name), before);
  });
}
