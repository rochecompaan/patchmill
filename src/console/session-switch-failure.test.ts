import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createConsoleSessionHost } from "./session-host.ts";
import { fakeExtensionApi } from "../../test-support/fake-extension-api.ts";
import { runConsoleRuntime } from "./start.ts";

for (const failure of ["cancel", "before", "after"] as const) {
  test(`switch ${failure}: only post-teardown failure ends the console`, async (t) => {
    const root = await mkdtemp(join(tmpdir(), "console-switch-failure-"));
    t.after(() => rm(root, { recursive: true, force: true }));
    const old = fakeExtensionApi();
    const next = fakeExtensionApi();
    const fatal: { issue: number; error: unknown }[] = [];
    let attempts = 0;
    let stopped = 0;
    const started: number[] = [];
    const host = createConsoleSessionHost({
      repoRoot: root,
      runsDir: "runs",
      issue: 9,
      startRun: async (issue) => {
        started.push(issue!);
        return { status: "no-work" };
      },
      onFatalSwitch: (issue, error) => {
        fatal.push({ issue, error });
      },
      switchSession: async () => {
        if (++attempts === 1) {
          if (failure === "cancel") return { cancelled: true };
          if (failure === "after") {
            await old.fire("session_shutdown");
            stopped++;
          }
          throw new Error("replacement failed");
        }
        await old.fire("session_shutdown");
        await host.factory(next);
        await next.fire("session_start");
        return { cancelled: false };
      },
    });
    await host.factory(old);
    await old.fire("session_start");
    await new Promise<void>((resolve) => setImmediate(resolve));
    await assert.doesNotReject(old.callCommand("10"));
    if (failure === "after") {
      assert.equal(stopped, 1);
      assert.equal(fatal.length, 1);
      assert.equal(fatal[0]?.issue, 10);
      assert.match(String(fatal[0]?.error), /replacement failed/);
      assert.equal(old.events.listenerCount(), 0);
    } else {
      assert.deepEqual(fatal, []);
      assert.match(
        old.messages.at(-1)?.message.content ?? "",
        failure === "cancel" ? /cancelled/i : /replacement failed/,
      );
      await old.callCommand("11");
      assert.deepEqual(started, [9, 11]);
    }
    await host.shutdown();
  });
}

test("fatal switch exits a pending console run non-zero and disposes it", async () => {
  const stderr: string[] = [];
  let disposed = false;
  const failure =
    "replacement failed\nRun `patchmill run-once --interactive --issue 10` to continue.";
  const outcome = runConsoleRuntime(
    {
      diagnostics: [],
      dispose: async () => {
        disposed = true;
      },
    },
    () => new Promise<void>(() => {}),
    (line) => stderr.push(line),
    async () => {},
    Promise.resolve(failure),
  );
  const timedOut = Symbol("timed out");
  const result = await Promise.race([
    outcome,
    new Promise((resolve) => {
      const timer = setTimeout(() => resolve(timedOut), 1000);
      timer.unref();
    }),
  ]);
  assert.equal(result, 1);
  assert.equal(disposed, true);
  assert.deepEqual(stderr, [failure]);
});
