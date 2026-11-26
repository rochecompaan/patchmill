import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { COMMAND_TIMEOUT_EXTENSION_PATH } from "../pi/command-timeout-extension.ts";
import { BACKGROUND_WORK_EXTENSION_PATH, rpcModeLauncher } from "./launch.ts";

const fakePi = new URL("../../test-support/fake-pi.mjs", import.meta.url).href;
const done = { status: "done", summary: "Finished" };

test("rpcModeLauncher runs Pi in RPC mode with the background-work extension first and passes env", async (t) => {
  const dir = await fs.mkdtemp(join(tmpdir(), "patchmill-launch-"));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const script = join(dir, "steps.json");
  await fs.writeFile(script, JSON.stringify([{ result: done }]));
  const argvPath = join(dir, "argv.json");
  const wrapper = join(dir, "pi.mjs");
  await fs.writeFile(
    wrapper,
    `process.env.PATCHMILL_FAKE_PI_SCRIPT = ${JSON.stringify(script)}; (await import("node:fs")).writeFileSync(${JSON.stringify(argvPath)}, JSON.stringify({ argv: process.argv.slice(2), timeout: process.env.PATCHMILL_COMMAND_TIMEOUT_SECONDS })); await import(${JSON.stringify(fakePi)});`,
  );
  const promptPath = join(dir, "prompt.md");
  await fs.writeFile(promptPath, "prompt");
  const run = await rpcModeLauncher({
    command: { command: process.execPath, argsPrefix: [wrapper] },
    agentDir: join(dir, "agent"),
    extensionPaths: ["/ext/one"],
    // Not the default 1200, which a Patchmill session that runs this test has.
    env: { PATCHMILL_COMMAND_TIMEOUT_SECONDS: "77" },
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
  const recorded = JSON.parse(await fs.readFile(argvPath, "utf8"));
  assert.equal(recorded.timeout, "77");
  assert.deepEqual(recorded.argv, [
    "--mode",
    "rpc",
    "--session-dir",
    join(dir, "sessions"),
    "--skill",
    "/skill",
    "-e",
    BACKGROUND_WORK_EXTENSION_PATH,
    "-e",
    COMMAND_TIMEOUT_EXTENSION_PATH,
    "-e",
    "/ext/one",
  ]);
  assert.ok(existsSync(BACKGROUND_WORK_EXTENSION_PATH));
});

test("rpcModeLauncher with a Stall policy stops at the Stall limit without a reminder", async (t) => {
  const dir = await fs.mkdtemp(join(tmpdir(), "patchmill-launch-"));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const script = join(dir, "steps.json");
  await fs.writeFile(
    script,
    JSON.stringify([{ hang: true, recovery: { hang: true } }]),
  );
  const wrapper = join(dir, "pi.mjs");
  await fs.writeFile(
    wrapper,
    `process.env.PATCHMILL_FAKE_PI_SCRIPT = ${JSON.stringify(script)}; await import(${JSON.stringify(fakePi)});`,
  );
  const promptPath = join(dir, "prompt.md");
  await fs.writeFile(promptPath, "prompt");
  const actions: string[] = [];
  const run = await rpcModeLauncher({
    command: { command: process.execPath, argsPrefix: [wrapper] },
    agentDir: join(dir, "agent"),
    extensionPaths: [],
    env: {},
    stall: {
      limits: {
        stopAfterMs: 250,
        maxStalls: 2,
        command: { defaultSeconds: 0, maxSeconds: 0 },
      },
      phase: "implementation",
    },
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
    onStall: async (notice) => {
      actions.push(notice.action);
    },
  });
  assert.match(
    run.stallBlock ?? "",
    /^The implementation session stopped after 2 stalls\./,
  );
  assert.equal(run.stalls?.length, 2);
  assert.equal(run.session.aborted, false);
  assert.deepEqual(actions, ["recovering", "blocked"]);
  const commands = (await fs.readFile(`${script}.commands.log`, "utf8"))
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line) as { type: string });
  assert.deepEqual(
    commands.map((command) => command.type),
    ["prompt", "abort", "prompt", "abort"],
  );
});

test("rpcModeLauncher without a Stall policy returns no stalls", async (t) => {
  const dir = await fs.mkdtemp(join(tmpdir(), "patchmill-launch-"));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const script = join(dir, "steps.json");
  await fs.writeFile(script, JSON.stringify([{ result: done }]));
  const wrapper = join(dir, "pi.mjs");
  await fs.writeFile(
    wrapper,
    `process.env.PATCHMILL_FAKE_PI_SCRIPT = ${JSON.stringify(script)}; await import(${JSON.stringify(fakePi)});`,
  );
  const promptPath = join(dir, "prompt.md");
  await fs.writeFile(promptPath, "prompt");
  const run = await rpcModeLauncher({
    command: { command: process.execPath, argsPrefix: [wrapper] },
    agentDir: join(dir, "agent"),
    extensionPaths: [],
    env: {},
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
  assert.equal(run.stalls, undefined);
  assert.equal(run.stallBlock, undefined);
});
