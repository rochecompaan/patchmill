import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, type TestContext } from "node:test";
import { parseConfig } from "../../../config/config.ts";
import {
  acquireConsoleLock,
  CONSOLE_SESSION_BUSY,
} from "../../../console/console-lock.ts";
import { WEB_SESSION_EXTENSION_PATH } from "../../../console/web-session-extension.ts";
import type { InteractiveStart } from "../../../kernel/interactive-start.ts";
import type {
  InteractivePi,
  InteractivePiOptions,
} from "../../../kernel/pi-rpc-interactive.ts";
import { COMMAND_TIMEOUT_EXTENSION_PATH } from "../../../pi/command-timeout-extension.ts";
import { resolvePiSubagentsPackageRoot } from "../../../pi/pi-subagents-package.ts";
import { createSessionLauncher } from "./session-launcher.ts";

const handlers = { onEvent: () => {}, onDialog: () => {} };
const consoleDir = (root: string) =>
  join(root, ".patchmill/runs/issue-7/console");

async function setup(t: TestContext, prepared: InteractiveStart) {
  const root = await mkdtemp(join(tmpdir(), "patchmill-launcher-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const started: InteractivePiOptions[] = [];
  const config = parseConfig({
    pi: { commandTimeoutMinutes: 2, maxCommandTimeoutMinutes: 0 },
  });
  const launch = createSessionLauncher({
    config,
    repoRoot: root,
    runner: async () => ({ code: 0, stdout: "", stderr: "" }),
    prepare: async (input) => {
      assert.equal(input.issue, 7);
      return prepared;
    },
    start: (options) => {
      started.push(options);
      return { fake: true } as unknown as InteractivePi;
    },
  });
  return { root, started, launch };
}

test("a refused start never spawns Pi", async (t) => {
  const f = await setup(t, {
    kind: "refused",
    reason: "Issue #7 was claimed elsewhere.",
  });
  const result = await f.launch(
    7,
    handlers,
    () => {},
    new AbortController().signal,
  );
  assert.deepEqual(result, {
    kind: "refused",
    reason: "Issue #7 was claimed elsewhere.",
  });
  assert.equal(f.started.length, 0);
});

test("none and cancelled become refusals", async (t) => {
  for (const [prepared, reason] of [
    [{ kind: "none" }, "Issue #7 is not open or cannot run."],
    [{ kind: "cancelled" }, "The start was cancelled."],
  ] as const) {
    const f = await setup(t, prepared);
    const result = await f.launch(
      7,
      handlers,
      () => {},
      new AbortController().signal,
    );
    assert.deepEqual(result, { kind: "refused", reason });
    assert.equal(f.started.length, 0);
  }
});

test("an aborted signal after prepare spawns nothing", async (t) => {
  const f = await setup(t, { kind: "ready", issue: 7 });
  const controller = new AbortController();
  controller.abort();
  const result = await f.launch(7, handlers, () => {}, controller.signal);
  assert.deepEqual(result, {
    kind: "refused",
    reason: "The start was cancelled.",
  });
  assert.equal(f.started.length, 0);
  await assert.rejects(readdir(consoleDir(f.root)));
});

test("a held Console session lock refuses before the session file changes", async (t) => {
  const f = await setup(t, { kind: "ready", issue: 7 });
  const lock = await acquireConsoleLock(f.root, ".patchmill/runs", 7);
  assert.ok(lock);
  t.after(() => lock.release());
  const result = await f.launch(
    7,
    handlers,
    () => {},
    new AbortController().signal,
  );
  assert.deepEqual(result, {
    kind: "refused",
    reason: CONSOLE_SESSION_BUSY(7),
  });
  assert.equal(f.started.length, 0);
  assert.deepEqual(await readdir(consoleDir(f.root)), ["lock"]);
});

test("a ready start passes the console session file, skills, extensions and env", async (t) => {
  const f = await setup(t, { kind: "ready", issue: 7 });
  const result = await f.launch(
    7,
    handlers,
    () => {},
    new AbortController().signal,
  );
  assert.equal(result.kind, "started");
  const [options] = f.started;
  assert.ok(options);
  assert.equal(options.cwd, f.root);
  assert.equal(options.sessionDir, consoleDir(f.root));
  assert.ok(options.sessionFile.startsWith(consoleDir(f.root)));
  assert.match(options.sessionFile, /\.jsonl$/);
  assert.match(
    await readFile(options.sessionFile, "utf8"),
    /Start Issue run #7\./,
  );
  assert.deepEqual(options.extensionPaths, [
    resolvePiSubagentsPackageRoot(),
    WEB_SESSION_EXTENSION_PATH,
    COMMAND_TIMEOUT_EXTENSION_PATH,
  ]);
  assert.deepEqual(options.env, {
    PATCHMILL_COMMAND_TIMEOUT_SECONDS: "120",
    PATCHMILL_MAX_COMMAND_TIMEOUT_SECONDS: "0",
    PATCHMILL_WEB_SESSION_REPO: f.root,
    PATCHMILL_WEB_SESSION_ISSUE: "7",
  });
  assert.equal(options.logPath, join(consoleDir(f.root), "web-session.log"));
  assert.ok(options.skillPaths.length > 0);
  assert.equal(options.onEvent, handlers.onEvent);
  // The lock is free again for the Pi process.
  const again = await acquireConsoleLock(f.root, ".patchmill/runs", 7);
  assert.ok(again);
  await again.release();
});
