import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createConsoleSessionHost } from "./session-host.ts";
import { fakeExtensionApi } from "../../test-support/fake-extension-api.ts";

test("switching replaces the extension, cleans the target session, starts its issue, and quits the current instance", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "console-host-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const started: number[] = [];
  const stopped: number[] = [];
  const host = createConsoleSessionHost({
    repoRoot: root,
    runsDir: "runs",
    issue: 9,
    startRun: async (issue, channel) => {
      started.push(issue!);
      if (issue === 10) {
        await channel.awaitContinue({
          kind: "review",
          message: "wait",
        } as never);
        stopped.push(issue);
      }
      return { status: "no-work" };
    },
    switchSession: async (path) => {
      assert.equal(join(path, ".."), join(root, "runs/issue-10/console"));
      await old.fire("session_shutdown");
      await host.factory(next);
      await next.fire("session_start");
      return { cancelled: false };
    },
  });
  const old = fakeExtensionApi();
  const next = fakeExtensionApi();
  await host.factory(old);
  await old.fire("session_start");
  await new Promise<void>((resolve) => setImmediate(resolve));
  await old.callCommand("10");
  assert.deepEqual(started, [9, 10]);
  assert.deepEqual(
    next.events.requests.map((r) => r.method),
    ["ping", "status"],
  );
  await host.shutdown();
  assert.deepEqual(stopped, [10]);
  await next.fire("session_shutdown");
});

test("quit after a switch reports the current worker's failed exit proof", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "console-host-failure-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const { fakeSubagents } =
    await import("../../test-support/fake-subagents.ts");
  const { runConsoleRuntime } = await import("./start.ts");
  let stopping = false;
  const bus = fakeSubagents({
    stop: () => {
      stopping = true;
      return {};
    },
    status: () =>
      stopping
        ? {
            error: { code: "unavailable", message: "cannot prove worker exit" },
          }
        : { asyncSnapshot: { runs: [] } },
  });
  const old = fakeExtensionApi();
  const next = fakeExtensionApi(bus);
  const host = createConsoleSessionHost({
    repoRoot: root,
    runsDir: "runs",
    issue: 9,
    startRun: async (issue, human) => {
      if (issue === 10)
        await human.runImplementation({
          phase: "implementation",
          envelope: "implement",
          promptPath: "unused",
          worktree: root,
          skillPath: root,
          sessionDir: join(root, "worker"),
          logPath: join(root, "log"),
          aggregateLogPath: join(root, "aggregate"),
          timeoutMs: 10000,
        });
      return { status: "no-work" };
    },
    switchSession: async () => {
      await old.fire("session_shutdown");
      await host.factory(next);
      await next.fire("session_start");
      return { cancelled: false };
    },
  });
  await host.factory(old);
  await old.fire("session_start");
  await new Promise<void>((resolve) => setImmediate(resolve));
  await old.callCommand("10");
  const deadline = Date.now() + 2000;
  while (!bus.requests.some((request) => request.method === "spawn")) {
    assert.ok(Date.now() < deadline, "worker did not launch");
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
  let disposed = false;
  await assert.rejects(
    runConsoleRuntime(
      {
        diagnostics: [],
        dispose: async () => {
          disposed = true;
        },
      },
      async () => {},
      () => {},
      () => host.shutdown(),
    ),
    /cannot prove worker exit/,
  );
  assert.equal(disposed, true);
  assert.equal(stopping, true);
});
