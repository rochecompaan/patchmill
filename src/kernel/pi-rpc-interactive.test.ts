import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, type TestContext } from "node:test";
import {
  interactivePiArgs,
  startInteractivePi,
  type DialogRequest,
  type InteractivePiOptions,
} from "./pi-rpc-interactive.ts";
import type { RpcRecord } from "./pi-rpc-protocol.ts";
import { signalGroup } from "./pi-supervisor.ts";

const fakePath = new URL(
  "../../test-support/fake-interactive-pi.mjs",
  import.meta.url,
).pathname;

function opts(
  overrides: Partial<InteractivePiOptions> = {},
): InteractivePiOptions {
  return {
    command: { command: process.execPath, argsPrefix: [fakePath] },
    cwd: "/repo",
    agentDir: "/agent",
    sessionFile: "/runs/issue-7/console/a.jsonl",
    sessionDir: "/runs/issue-7/console",
    skillPaths: [],
    extensionPaths: [],
    logPath: "/runs/issue-7/console/web-session.log",
    onEvent: () => {},
    onDialog: () => {},
    ...overrides,
  };
}

async function fake(
  t: TestContext,
  step: Record<string, unknown>,
  overrides: Partial<InteractivePiOptions> = {},
) {
  const dir = await fs.mkdtemp(join(tmpdir(), "patchmill-pi-interactive-"));
  const script = join(dir, "script.json");
  await fs.writeFile(script, JSON.stringify(step));
  const events: RpcRecord[] = [];
  const dialogs: DialogRequest[] = [];
  const options = opts({
    cwd: dir,
    agentDir: join(dir, "agent"),
    sessionFile: join(dir, "s.jsonl"),
    sessionDir: dir,
    logPath: join(dir, "pi.log"),
    env: { PATCHMILL_FAKE_PI_SCRIPT: script },
    graceMs: 100,
    shutdownMs: 2000,
    onEvent: (record) => events.push(record),
    onDialog: (request) => dialogs.push(request),
    ...overrides,
  });
  const pi = startInteractivePi(options);
  t.after(async () => {
    await pi.end().catch(() => undefined);
    await fs.rm(dir, { recursive: true, force: true });
  });
  return {
    pi,
    events,
    dialogs,
    script,
    log: () => fs.readFile(options.logPath, "utf8"),
    commands: async () =>
      (await fs.readFile(`${script}.commands.log`, "utf8").catch(() => ""))
        .trim()
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line) as Record<string, unknown>),
    pid: async () => Number(await fs.readFile(`${script}.pid`, "utf8")),
  };
}

async function waitFor(check: () => boolean | Promise<boolean>) {
  const deadline = Date.now() + 5000;
  while (!(await check())) {
    if (Date.now() > deadline) throw new Error("condition not met");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

test("interactivePiArgs selects the session file, skills and extensions", () => {
  assert.deepEqual(
    interactivePiArgs(
      opts({ skillPaths: ["/s1", "/s2"], extensionPaths: ["/e"] }),
    ),
    [
      "--mode",
      "rpc",
      "--session",
      "/runs/issue-7/console/a.jsonl",
      "--session-dir",
      "/runs/issue-7/console",
      "--skill",
      "/s1",
      "--skill",
      "/s2",
      "-e",
      "/e",
    ],
  );
});

test("prompt waits for ready and always sends steer", async (t) => {
  const f = await fake(t, {});
  await f.pi.prompt("Ann: hi");
  const commands = await f.commands();
  assert.equal(commands[0]?.type, "get_state");
  assert.equal(commands[1]?.type, "prompt");
  assert.equal(commands[1]?.message, "Ann: hi");
  assert.equal(commands[1]?.streamingBehavior, "steer");
});

test("a failed prompt response rejects prompt()", async (t) => {
  const f = await fake(t, { promptError: "Agent is already processing" });
  await assert.rejects(f.pi.prompt("Ann: hi"), /Agent is already processing/);
});

test("abort sends RPC abort and keeps the process", async (t) => {
  const f = await fake(t, {});
  await f.pi.abort();
  const commands = await f.commands();
  assert.ok(commands.some((c) => c.type === "abort"));
  assert.equal(signalGroup(await f.pid(), 0), true);
});

test("dialogs reach onDialog and answer writes extension_ui_response", async (t) => {
  const f = await fake(t, {
    dialog: {
      type: "extension_ui_request",
      id: "d1",
      method: "select",
      title: "Approve the plan?",
      options: ["Approve", "Request changes"],
    },
  });
  await f.pi.prompt("Ann: go");
  await waitFor(() => f.dialogs.length === 1);
  assert.deepEqual(f.dialogs[0], {
    id: "d1",
    method: "select",
    title: "Approve the plan?",
    options: ["Approve", "Request changes"],
  });
  f.pi.answer("d1", { value: "Approve" });
  await waitFor(async () =>
    (await f.commands()).some((c) => c.type === "extension_ui_response"),
  );
  const response = (await f.commands()).find(
    (c) => c.type === "extension_ui_response",
  );
  assert.deepEqual(response, {
    type: "extension_ui_response",
    id: "d1",
    value: "Approve",
  });
});

test("other records reach onEvent and non-JSON stdout goes to the log", async (t) => {
  const f = await fake(t, {
    noise: "not json",
    stderr: "warning line",
    onPrompt: [
      { type: "agent_start" },
      {
        type: "extension_ui_request",
        id: "s1",
        method: "setStatus",
        statusKey: "patchmill",
        statusText: "#7",
      },
    ],
  });
  await f.pi.prompt("Ann: hi");
  await waitFor(() => f.events.length === 2);
  assert.equal(f.events[0]?.type, "agent_start");
  assert.equal(f.events[1]?.type, "extension_ui_request");
  assert.ok(f.events.every((e) => e.type !== "response"));
  await f.pi.end();
  const log = await f.log();
  assert.match(log, /not json/);
  assert.match(log, /warning line/);
});

test("end sends the stop command before stdin closes", async (t) => {
  const f = await fake(t, {});
  await f.pi.ready;
  const exit = await f.pi.end();
  const commands = await f.commands();
  const types = commands.map((c) => `${c.type}:${String(c.message ?? "")}`);
  assert.deepEqual(types.slice(-2), [
    "abort:",
    "prompt:/patchmill-web-session-stop",
  ]);
  assert.equal(exit.requested, true);
  assert.equal(exit.exitCode, 0);
});

test("end closes stdin and resolves with requested: true", async (t) => {
  const f = await fake(t, { ignoreStopCommand: true }, { shutdownMs: 100 });
  await f.pi.ready;
  const first = f.pi.end();
  assert.equal(f.pi.end(), first);
  const exit = await first;
  assert.equal(exit.requested, true);
  assert.equal(exit.exitCode, 0);
  assert.deepEqual(await f.pi.exited, exit);
});

test("end kills a group that ignores stdin and SIGTERM", async (t) => {
  const f = await fake(
    t,
    {
      ignoreStopCommand: true,
      ignoreStdinEnd: true,
      ignoreSigterm: true,
      spawnChild: true,
    },
    { graceMs: 100, shutdownMs: 100 },
  );
  await f.pi.ready;
  const pid = await f.pid();
  const exit = await f.pi.end();
  assert.equal(exit.requested, true);
  assert.equal(exit.signal, "SIGKILL");
  await waitFor(() => !signalGroup(pid, 0));
});

test("a crash resolves exited with requested: false and rejects pending commands", async (t) => {
  const f = await fake(t, { exitAfterPrompt: 3 });
  await f.pi.prompt("Ann: hi");
  const exit = await f.pi.exited;
  assert.deepEqual(exit, { exitCode: 3, signal: null, requested: false });
  await assert.rejects(f.pi.prompt("Ann: again"), /Pi/);
});

test("ready rejects if Pi exits before get_state", async (t) => {
  const f = await fake(t, { exitBeforeReady: 2 });
  await assert.rejects(f.pi.ready, /exited/);
  assert.equal((await f.pi.exited).exitCode, 2);
});
