import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { BACKGROUND_WORK_EXTENSION_PATH, rpcModeLauncher } from "./launch.ts";

const fakePi = new URL("../../test-support/fake-pi.mjs", import.meta.url).href;
const done = { status: "done", summary: "Finished" };

test("rpcModeLauncher runs Pi in RPC mode with the background-work extension first", async (t) => {
  const dir = await fs.mkdtemp(join(tmpdir(), "patchmill-launch-"));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const script = join(dir, "steps.json");
  await fs.writeFile(script, JSON.stringify([{ result: done }]));
  const argvPath = join(dir, "argv.json");
  const wrapper = join(dir, "pi.mjs");
  await fs.writeFile(
    wrapper,
    `process.env.PATCHMILL_FAKE_PI_SCRIPT = ${JSON.stringify(script)}; (await import("node:fs")).writeFileSync(${JSON.stringify(argvPath)}, JSON.stringify(process.argv.slice(2))); await import(${JSON.stringify(fakePi)});`,
  );
  const promptPath = join(dir, "prompt.md");
  await fs.writeFile(promptPath, "prompt");
  const run = await rpcModeLauncher({
    command: { command: process.execPath, argsPrefix: [wrapper] },
    agentDir: join(dir, "agent"),
    extensionPaths: ["/ext/one"],
  })({
    phase: "implementation",
    envelope: "prompt",
    promptPath,
    worktree: dir,
    skillPath: "/skill",
    sessionDir: join(dir, "sessions"),
    logPath: join(dir, "session-1.log"),
    aggregateLogPath: join(dir, "pi.log"),
    timeoutMs: 10_000,
  });
  assert.deepEqual(run.result, { ok: true, result: done });
  assert.deepEqual(JSON.parse(await fs.readFile(argvPath, "utf8")), [
    "--mode",
    "rpc",
    "--session-dir",
    join(dir, "sessions"),
    "--skill",
    "/skill",
    "-e",
    BACKGROUND_WORK_EXTENSION_PATH,
    "-e",
    "/ext/one",
  ]);
  assert.ok(existsSync(BACKGROUND_WORK_EXTENSION_PATH));
});
