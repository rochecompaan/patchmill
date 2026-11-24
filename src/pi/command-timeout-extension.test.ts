import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { pathToFileURL } from "node:url";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerRequiredChildExtensions } from "pi-subagents/required-child-extensions";
import {
  COMMAND_TIMEOUT_ENV,
  COMMAND_TIMEOUT_EXTENSION_PATH,
  MAX_COMMAND_TIMEOUT_ENV,
  commandLimits,
  commandLimitsEnv,
  createCommandTimeoutExtension,
  limitCommandTimeout,
  readCommandLimits,
  type CommandLimits,
} from "./command-timeout-extension.ts";
import { DEFAULT_CONFIG } from "../config/config.ts";

type Handler = (event: unknown, ctx: unknown) => unknown;
type Register = typeof registerRequiredChildExtensions;

/** A minimal Pi API: records handlers and fires them with a chosen session ID. */
function load(limits: CommandLimits, register: Register) {
  const handlers = new Map<string, Handler[]>();
  const pi = {
    on(event: string, handler: Handler) {
      handlers.set(event, [...(handlers.get(event) ?? []), handler]);
    },
  } as unknown as ExtensionAPI;
  createCommandTimeoutExtension({ limits, register })(pi);
  return {
    async fire(event: string, payload: unknown = {}, sessionId = "s1") {
      for (const handler of handlers.get(event) ?? [])
        await handler(payload, {
          sessionManager: { getSessionId: () => sessionId },
        });
    },
  };
}

const on: CommandLimits = { defaultSeconds: 1200, maxSeconds: 1500 };
const noRegister: Register = () => ({ dispose() {} });

test("limitCommandTimeout applies the policy table", () => {
  const defaultOff = { defaultSeconds: 0, maxSeconds: 1500 };
  const capOff = { defaultSeconds: 1200, maxSeconds: 0 };
  const off = { defaultSeconds: 0, maxSeconds: 0 };
  const cases: [
    number | null | undefined,
    CommandLimits,
    number | undefined,
  ][] = [
    [undefined, on, 1200],
    [null, on, 1200],
    [null, { defaultSeconds: 0, maxSeconds: 1500 }, undefined],
    [600, on, 600],
    [1500, on, 1500],
    [1501, on, 1500],
    [undefined, defaultOff, undefined],
    [2000, defaultOff, 1500],
    [undefined, capOff, 1200],
    [9999, capOff, 9999],
    [undefined, off, undefined],
    [9999, off, 9999],
    [undefined, { defaultSeconds: 2000, maxSeconds: 1500 }, 1500],
  ];
  for (const [timeout, limits, expected] of cases)
    assert.equal(
      limitCommandTimeout(timeout, limits),
      expected,
      `${String(timeout)} with ${JSON.stringify(limits)}`,
    );
  for (const invalid of [0, -5, Number.NaN, Infinity])
    for (const limits of [on, defaultOff, capOff, off])
      assert.equal(limitCommandTimeout(invalid, limits), invalid);
});

test("commandLimits converts minutes to seconds", () => {
  assert.deepEqual(
    commandLimits({
      ...DEFAULT_CONFIG.pi,
      commandTimeoutMinutes: 20,
      maxCommandTimeoutMinutes: 0.5,
    }),
    { defaultSeconds: 1200, maxSeconds: 30 },
  );
});

test("commandLimitsEnv and readCommandLimits round-trip", () => {
  for (const limits of [
    on,
    { defaultSeconds: 0, maxSeconds: 1500 },
    { defaultSeconds: 1, maxSeconds: 0 },
  ])
    assert.deepEqual(readCommandLimits(commandLimitsEnv(limits)), limits);
});

test("missing variables give the built-in defaults", () => {
  assert.deepEqual(readCommandLimits({}), on);
});

test("an invalid variable throws", () => {
  for (const name of [COMMAND_TIMEOUT_ENV, MAX_COMMAND_TIMEOUT_ENV])
    for (const value of ["abc", "-1", "", "2147484"])
      assert.throws(
        () => readCommandLimits({ [name]: value }),
        (error: unknown) =>
          error instanceof Error && error.message.includes(name),
        `${name}=${value}`,
      );
});

test("importing the module with an invalid variable does not throw", () => {
  const url = pathToFileURL(COMMAND_TIMEOUT_EXTENSION_PATH).href;
  const script = `
    const module = await import(${JSON.stringify(url)});
    let error;
    try { module.default({ on() {} }); } catch (e) { error = e; }
    if (!String(error?.message).includes(${JSON.stringify(COMMAND_TIMEOUT_ENV)})) process.exit(2);
  `;
  const child = spawnSync(
    process.execPath,
    ["--input-type=module", "-e", script],
    {
      env: { ...process.env, [COMMAND_TIMEOUT_ENV]: "abc" },
      encoding: "utf8",
      timeout: 20_000,
    },
  );
  assert.equal(child.status, 0, child.stdout + child.stderr);
});

test("the extension path is a file", () => {
  assert.ok(existsSync(COMMAND_TIMEOUT_EXTENSION_PATH));
});

test("tool_call sets and caps bash timeouts and ignores other tools", async () => {
  const pi = load(on, noRegister);
  const call = async (toolName: string, input: Record<string, unknown>) => {
    await pi.fire("tool_call", { type: "tool_call", toolName, input });
    return input;
  };
  assert.equal((await call("bash", { command: "x" })).timeout, 1200);
  assert.equal(
    (await call("bash", { command: "x", timeout: 2000 })).timeout,
    1500,
  );
  assert.equal((await call("bash", { command: "x", timeout: 30 })).timeout, 30);
  // Some models send an explicit null for an omitted optional argument.
  assert.equal(
    (await call("bash", { command: "x", timeout: null })).timeout,
    1200,
  );
  assert.deepEqual(await call("read", { path: "a" }), { path: "a" });
  const off = load({ defaultSeconds: 0, maxSeconds: 1500 }, noRegister);
  const input = { command: "x" };
  await off.fire("tool_call", { type: "tool_call", toolName: "bash", input });
  assert.equal("timeout" in input, false);
});

function recorder() {
  const calls: Parameters<Register>[0][] = [];
  const disposed: string[] = [];
  const register: Register = (input) => {
    calls.push(input);
    return { dispose: () => disposed.push(input.sessionId) };
  };
  return { calls, disposed, register };
}

test("session_start registers the extension file for the session", async () => {
  const r = recorder();
  await load(on, r.register).fire("session_start");
  assert.deepEqual(r.calls, [
    {
      sessionId: "s1",
      extensions: [
        {
          id: "patchmill-command-timeout",
          path: COMMAND_TIMEOUT_EXTENSION_PATH,
        },
      ],
    },
  ]);
});

test("session_shutdown disposes and a new session registers again", async () => {
  const r = recorder();
  const pi = load(on, r.register);
  await pi.fire("session_start", {}, "s1");
  await pi.fire("session_shutdown", {}, "s1");
  await pi.fire("session_start", {}, "s2");
  assert.deepEqual(r.disposed, ["s1"]);
  assert.deepEqual(
    r.calls.map((call) => call.sessionId),
    ["s1", "s2"],
  );
});

test("a duplicate registration does not fail the session", async (t) => {
  const errors: string[] = [];
  t.mock.method(console, "error", (...args: unknown[]) => {
    errors.push(args.map(String).join(" "));
  });
  const pi = load(on, () => {
    throw new Error(
      "Required child extensions are already registered for session 's1'; dispose them first.",
    );
  });
  await pi.fire("session_start");
  assert.equal(errors.length, 1);
  const input: Record<string, unknown> = { command: "x" };
  await pi.fire("tool_call", { type: "tool_call", toolName: "bash", input });
  assert.equal(input.timeout, 1200);
});

test("other registration errors are raised", async () => {
  const pi = load(on, () => {
    throw new Error("not an importable file");
  });
  await assert.rejects(pi.fire("session_start"), /not an importable file/);
});

test("the real registry holds the entry under the session ID", async (t) => {
  const id = `command-timeout-test-${process.pid}`;
  const pi = load(on, registerRequiredChildExtensions);
  await pi.fire("session_start", {}, id);
  const again = () =>
    registerRequiredChildExtensions({
      sessionId: id,
      extensions: [{ id: "probe", path: COMMAND_TIMEOUT_EXTENSION_PATH }],
    });
  assert.throws(again, /already registered/);
  await pi.fire("session_shutdown", {}, id);
  const registration = again();
  t.after(() => registration.dispose());
});

const E2E =
  "a command that never ends times out, its children die, and the agent continues";
test(E2E, { timeout: 30_000 }, async (t) => {
  // Isolate upstream process-global timers and environment from the test runner.
  if (!process.env.PATCHMILL_COMMAND_TIMEOUT_CHILD) {
    const env = { ...process.env, PATCHMILL_COMMAND_TIMEOUT_CHILD: "1" };
    delete env.NODE_TEST_CONTEXT;
    for (const name of Object.keys(env))
      if (/^PI_(SUBAGENT|SESSION)_/.test(name)) delete env[name];
    const child = spawnSync(
      process.execPath,
      [
        "--test",
        "--test-force-exit",
        `--test-name-pattern=${E2E}`,
        import.meta.filename,
      ],
      { env, encoding: "utf8", timeout: 25_000 },
    );
    assert.equal(child.status, 0, child.stdout + child.stderr);
    assert.match(child.stdout, /pass 1\n/);
    assert.match(child.stdout, /fail 0\n/);
    return;
  }
  const {
    createAgentSessionFromServices,
    createAgentSessionServices,
    ModelRuntime,
    SessionManager,
  } = await import("@earendil-works/pi-coding-agent");
  // A dependency of the pinned pi-coding-agent; Patchmill adds none.
  const { fauxAssistantMessage, fauxProvider, fauxToolCall } =
    await import("@earendil-works/pi-ai");
  const dir = await mkdtemp(join(tmpdir(), "patchmill-command-timeout-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const pidFile = join(dir, "pid");
  const faux = fauxProvider();
  faux.setResponses([
    fauxAssistantMessage(
      fauxToolCall("bash", {
        command: `sleep 30 & echo $! > ${JSON.stringify(pidFile)}; wait`,
      }),
      { stopReason: "toolUse" },
    ),
    fauxAssistantMessage("done"),
  ]);
  const model = faux.getModel();
  const modelRuntime = await ModelRuntime.create({
    authPath: join(dir, "auth.json"),
    modelsPath: null,
    refreshOnCreate: false,
  });
  modelRuntime.registerNativeProvider(faux.provider);
  await modelRuntime.setRuntimeApiKey(model.provider, "test");
  const services = await createAgentSessionServices({
    cwd: dir,
    agentDir: join(dir, "agent"),
    modelRuntime,
    resourceLoaderOptions: {
      noExtensions: true,
      noSkills: true,
      extensionFactories: [
        {
          name: "command-timeout",
          factory: createCommandTimeoutExtension({
            limits: { defaultSeconds: 1, maxSeconds: 2 },
            register: noRegister,
          }),
        },
      ],
    },
  });
  const { session } = await createAgentSessionFromServices({
    services,
    sessionManager: SessionManager.inMemory(dir),
    model,
  });
  const started = Date.now();
  await session.prompt("Run the command.");
  assert.ok(Date.now() - started < 10_000);
  const result = session.messages.find(
    (message) => message.role === "toolResult",
  );
  assert.ok(result && result.role === "toolResult");
  assert.equal(result.isError, true);
  assert.match(
    result.content
      .map((part) => (part.type === "text" ? part.text : ""))
      .join(""),
    /Command timed out after 1 seconds/,
  );
  const pid = Number(await readFile(pidFile, "utf8"));
  // A killed orphan can stay a zombie for a moment before init reaps it.
  const gone = async () => {
    for (let wait = 0; wait < 2_000; wait += 50) {
      try {
        process.kill(pid, 0);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ESRCH") return true;
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    return false;
  };
  assert.equal(await gone(), true, `process ${pid} is still running`);
  assert.equal(faux.state.callCount, 2);
  const last = session.messages.at(-1);
  assert.ok(last && last.role === "assistant");
  assert.deepEqual(last.content, [{ type: "text", text: "done" }]);
});
