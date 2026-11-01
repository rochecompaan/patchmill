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
    assert.equal(f.bus.requests.at(-1)?.method, "stop");
    const requests = f.bus.requests.length;
    assert.equal((await f.launcher.run(f.launch)).session.aborted, true);
    assert.equal(f.bus.requests.length, requests);
  });
}
