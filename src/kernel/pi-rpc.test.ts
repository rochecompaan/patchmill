import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, type TestContext } from "node:test";
import { piRpcArgs, runPiRpc, startPiRpc } from "./pi-rpc.ts";
import { jsonlRecords } from "./pi-rpc-protocol.ts";
import { signalGroup, type PiSessionOptions } from "./pi-supervisor.ts";
import { hasResultBlock, parseAgentResult } from "./result.ts";

const fakePiPath = new URL("../../test-support/fake-pi.mjs", import.meta.url)
  .pathname;
const done = { status: "done", summary: "Finished" };

async function fake(t: TestContext, steps: unknown[]) {
  const dir = await fs.mkdtemp(join(tmpdir(), "patchmill-pi-rpc-"));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const script = join(dir, "script.json");
  await fs.writeFile(script, JSON.stringify(steps));
  const promptPath = join(dir, "prompt.md");
  await fs.writeFile(promptPath, "Do the work.");
  const options: PiSessionOptions = {
    command: { command: process.execPath, argsPrefix: [fakePiPath] },
    cwd: dir,
    agentDir: join(dir, "agent"),
    sessionDir: join(dir, "sessions"),
    promptPath,
    logPath: join(dir, "pi.log"),
    extensionPaths: [],
    timeoutMs: 10_000,
    graceMs: 100,
    onOutput: () => {},
    env: { PATCHMILL_FAKE_PI_SCRIPT: script },
  };
  return {
    options,
    script,
    log: () => fs.readFile(options.logPath, "utf8"),
    commands: async () =>
      (await fs.readFile(`${script}.commands.log`, "utf8"))
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line) as Record<string, unknown>),
    pid: async () => Number(await fs.readFile(`${script}.pid`, "utf8")),
  };
}

async function waitFor(check: () => Promise<boolean>) {
  const deadline = Date.now() + 5000;
  while (!(await check().catch(() => false))) {
    if (Date.now() > deadline) throw new Error("condition not met");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

test("piRpcArgs keeps the session, skill and extension arguments", () => {
  const base = {
    sessionDir: "/s",
    promptPath: "/prompt",
    extensionPaths: ["/one", "/two"],
  } as PiSessionOptions;
  assert.deepEqual(piRpcArgs({ ...base, skillPath: "/k" }), [
    "--mode",
    "rpc",
    "--session-dir",
    "/s",
    "--skill",
    "/k",
    "-e",
    "/one",
    "-e",
    "/two",
  ]);
  assert.deepEqual(piRpcArgs(base), [
    "--mode",
    "rpc",
    "--session-dir",
    "/s",
    "-e",
    "/one",
    "-e",
    "/two",
  ]);
});

test("normal result returns the print-mode text and logs both streams", async (t) => {
  const f = await fake(t, [{ stdout: "ok", stderr: "warning", result: done }]);
  const result = await runPiRpc(f.options);
  assert.equal(result.exitCode, 0);
  assert.equal(result.signal, null);
  assert.equal(result.timedOut, false);
  assert.equal(result.aborted, false);
  assert.deepEqual(parseAgentResult(result.stdout), { ok: true, result: done });
  assert.equal(
    result.stdout,
    `ok\n\`\`\`json\n${JSON.stringify(done)}\n\`\`\`\n`,
  );
  const log = await f.log();
  for (const text of ["ok", "warning", JSON.stringify(done)])
    assert.ok(log.includes(text), text);
  assert.doesNotMatch(log, /"type":/);
  assert.equal(signalGroup(await f.pid(), 0), false);
});

test("prompt text is the print-mode @file block without a BOM", async (t) => {
  const f = await fake(t, [{ result: done }]);
  await fs.writeFile(f.options.promptPath, "\uFEFFhello");
  await runPiRpc(f.options);
  const [prompt] = await f.commands();
  assert.equal(prompt!.type, "prompt");
  assert.equal(
    prompt!.message,
    `<file name="${f.options.promptPath}">\nhello\n</file>\n`,
  );
});

test("pi error gives empty stdout, exit code 1 and the logged message", async (t) => {
  const f = await fake(t, [
    { stopReason: "error", errorMessage: "overloaded", stdout: "x" },
  ]);
  const result = await runPiRpc(f.options);
  assert.equal(result.stdout, "");
  assert.equal(result.exitCode, 1);
  assert.match(await f.log(), /overloaded/);
});

test("truncated response keeps the text and exits with code 1", async (t) => {
  const f = await fake(t, [{ stopReason: "length", result: done }]);
  const result = await runPiRpc(f.options);
  assert.equal(parseAgentResult(result.stdout).ok, true);
  assert.equal(result.exitCode, 1);
  assert.match(await f.log(), /Response was truncated/);
});

for (const dialog of ["select", "confirm", "input", "editor"]) {
  test(`extension ${dialog} dialog is answered as cancelled`, async (t) => {
    const f = await fake(t, [{ dialog, result: done }]);
    const result = await runPiRpc(f.options);
    assert.equal(result.exitCode, 0);
    assert.ok(
      result.stdout.includes(
        'dialog:{"type":"extension_ui_response","id":"dialog-1","cancelled":true}',
      ),
    );
  });
}

test("crash before agent_settled keeps the last text and exit code", async (t) => {
  const f = await fake(t, [{ result: done, exitCode: 7 }]);
  const result = await runPiRpc(f.options);
  assert.equal(result.exitCode, 7);
  assert.equal(parseAgentResult(result.stdout).ok, true);
});

test("abort sends abort, ends Pi and leaves no process", async (t) => {
  const f = await fake(t, [{ result: done, sleepMs: 5000 }]);
  const controller = new AbortController();
  const session = startPiRpc({ ...f.options, signal: controller.signal });
  await waitFor(async () => (await f.log()).includes("Finished"));
  controller.abort();
  const result = await session.done;
  assert.equal(result.aborted, true);
  assert.equal(result.timedOut, false);
  assert.ok((await f.commands()).some((command) => command.type === "abort"));
  assert.equal(signalGroup(await f.pid(), 0), false);
  await session.abort();
  await assert.rejects(session.steer("late"), /done/);
});

test("a pre-aborted signal never starts Pi", async (t) => {
  const f = await fake(t, [{ result: done }]);
  const result = await runPiRpc({ ...f.options, signal: AbortSignal.abort() });
  assert.equal(result.aborted, true);
  assert.equal(result.exitCode, null);
  await assert.rejects(fs.stat(`${f.script}.pid`), { code: "ENOENT" });
});

for (const ignoreSigterm of [false, true]) {
  test(
    `timeout ends Pi ${ignoreSigterm ? "with SIGKILL" : "when its input closes"}`,
    { timeout: 5000 },
    async (t) => {
      const f = await fake(t, [
        { stdout: "ready", sleepMs: 5000, ignoreSigterm },
      ]);
      const result = await runPiRpc({ ...f.options, timeoutMs: 300 });
      assert.equal(result.timedOut, true);
      assert.equal(result.aborted, false);
      assert.equal(result.signal, ignoreSigterm ? "SIGKILL" : null);
      assert.ok(result.stdout.includes("ready"));
      assert.equal(signalGroup(await f.pid(), 0), false);
    },
  );
}

test("background work keeps the session until a later settle reports 0", async (t) => {
  const f = await fake(t, [{ result: done, backgroundCounts: [1, 0] }]);
  const result = await runPiRpc(f.options);
  assert.equal(result.exitCode, 0);
  assert.equal(result.stdout, "background turn 2\n");
});

test("a repeated 0 report for the same settle finishes the session", async (t) => {
  const f = await fake(t, [
    { result: done, backgroundCounts: [1], lateZero: true },
  ]);
  const started = performance.now();
  const result = await runPiRpc({ ...f.options, reportWaitMs: 60_000 });
  assert.equal(result.exitCode, 0);
  assert.equal(parseAgentResult(result.stdout).ok, true);
  assert.ok(performance.now() - started < 5000);
});

for (const reportAfterSettle of [false, true]) {
  test(`report ${reportAfterSettle ? "after" : "before"} agent_settled is matched`, async (t) => {
    const f = await fake(t, [{ result: done, reportAfterSettle }]);
    const started = performance.now();
    const result = await runPiRpc({ ...f.options, reportWaitMs: 60_000 });
    assert.equal(parseAgentResult(result.stdout).ok, true);
    assert.ok(performance.now() - started < 5000);
  });
}

test("a missing report finishes after the report wait with a warning", async (t) => {
  const f = await fake(t, [{ result: done, noReport: true }]);
  const result = await runPiRpc({ ...f.options, reportWaitMs: 100 });
  assert.equal(result.exitCode, 0);
  assert.equal(parseAgentResult(result.stdout).ok, true);
  assert.match(await f.log(), /background-work report/);
});

test("steer and follow_up reach Pi while it runs and reject after", async (t) => {
  const f = await fake(t, [{ result: done, sleepMs: 300 }]);
  const session = startPiRpc(f.options);
  await waitFor(async () => (await f.log()).includes("Finished"));
  await session.steer("go left");
  await session.followUp("then right");
  await session.done;
  const commands = await f.commands();
  assert.ok(
    commands.some((c) => c.type === "steer" && c.message === "go left"),
  );
  assert.ok(
    commands.some((c) => c.type === "follow_up" && c.message === "then right"),
  );
  await assert.rejects(session.followUp("late"), /done/);
});

test("a failed prompt is logged and exits with code 1", async (t) => {
  const f = await fake(t, [{ promptError: "No model configured" }]);
  const result = await runPiRpc(f.options);
  assert.equal(result.exitCode, 1);
  assert.equal(result.stdout, "");
  assert.match(await f.log(), /No model configured/);
});

test("a handled prompt finishes at once with empty stdout", async (t) => {
  const f = await fake(t, [{ handled: true }]);
  const result = await runPiRpc({ ...f.options, reportWaitMs: 60_000 });
  assert.equal(result.exitCode, 0);
  assert.equal(result.stdout, "");
});

test("extension errors go to the log", async (t) => {
  const f = await fake(t, [{ extensionError: "boom", result: done }]);
  await runPiRpc(f.options);
  assert.match(await f.log(), /Extension error \(\/ext\/broken\.ts\): boom/);
});

test("a group member left after Pi exits is stopped", async (t) => {
  const f = await fake(t, [{ spawnChild: true, result: done }]);
  const result = await runPiRpc(f.options);
  assert.equal(parseAgentResult(result.stdout).ok, true);
  const pid = Number(await fs.readFile(`${f.script}.child.pid`, "utf8"));
  assert.throws(() => process.kill(pid, 0), { code: "ESRCH" });
});

test("Pi exiting with a command outstanding rejects it and resolves done", async (t) => {
  const f = await fake(t, [{ result: done, sleepMs: 5000, exitOn: "steer" }]);
  const session = startPiRpc(f.options);
  await waitFor(async () => (await f.log()).includes("Finished"));
  await assert.rejects(session.steer("go"), /Pi exited/);
  const result = await session.done;
  assert.equal(result.exitCode, 3);
  assert.equal(signalGroup(await f.pid(), 0), false);
});

test("abort while startup is pending starts no Pi and resolves done", async (t) => {
  const f = await fake(t, [{ result: done }]);
  const session = startPiRpc(f.options);
  await session.abort();
  const result = await session.done;
  assert.equal(result.aborted, true);
  assert.equal(result.exitCode, null);
  await assert.rejects(fs.stat(`${f.script}.pid`), { code: "ENOENT" });
});

test("a log write failure rejects done once and stops Pi", async (t) => {
  const f = await fake(t, [{ result: done, sleepMs: 5000 }]);
  let calls = 0;
  const failure = new Error("sink closed");
  await assert.rejects(
    runPiRpc({
      ...f.options,
      onOutput: () => {
        calls++;
        throw failure;
      },
    }),
    (error) => error === failure,
  );
  assert.equal(calls, 1);
  assert.equal(signalGroup(await f.pid(), 0), false);
});

test("jsonlRecords splits only on newline and passes other text through", () => {
  const records: unknown[] = [];
  const text: string[] = [];
  const feed = jsonlRecords(
    (record) => records.push(record),
    (line) => text.push(line),
  );
  feed('{"a":"x\u2028y"}\r');
  feed('\n{"b":1}\nnot json\n[1]\n');
  assert.deepEqual(records, [{ a: "x\u2028y" }, { b: 1 }]);
  assert.deepEqual(text, ["not json", "[1]"]);
});

function reminder() {
  const calls: string[] = [];
  return {
    calls,
    remind: (stdout: string) => {
      calls.push(stdout);
      return hasResultBlock(stdout) ? undefined : "remind";
    },
  };
}
const prompts = (commands: Record<string, unknown>[]) =>
  commands.filter((command) => command.type === "prompt");

test("a settled session without a block gets one reminder and returns its answer", async (t) => {
  const f = await fake(t, [
    { stdout: "work done", reminder: { result: done } },
  ]);
  const r = reminder();
  const result = await runPiRpc({ ...f.options, remind: r.remind });
  assert.equal(result.exitCode, 0);
  assert.deepEqual(parseAgentResult(result.stdout), { ok: true, result: done });
  const sent = prompts(await f.commands());
  assert.equal(sent.length, 2);
  assert.equal(sent[1]!.message, "remind");
  assert.deepEqual(r.calls, ["work done\n"]);
  assert.match(await f.log(), /work done/);
});

test("a reminder answer without a block ends the session without a second reminder", async (t) => {
  const f = await fake(t, [
    { stdout: "work done", reminder: { stdout: "still prose" } },
  ]);
  const r = reminder();
  const result = await runPiRpc({ ...f.options, remind: r.remind });
  assert.equal(result.exitCode, 0);
  assert.equal(result.stdout, "still prose\n");
  assert.equal(prompts(await f.commands()).length, 2);
  assert.equal(r.calls.length, 1);
});

test("a session with a block is not reminded", async (t) => {
  const f = await fake(t, [{ result: done }]);
  const r = reminder();
  const result = await runPiRpc({ ...f.options, remind: r.remind });
  assert.equal(parseAgentResult(result.stdout).ok, true);
  assert.equal(prompts(await f.commands()).length, 1);
});

test("a duplicate zero report does not finish before the reminder turn", async (t) => {
  const f = await fake(t, [
    { stdout: "work done", duplicateZero: true, reminder: { result: done } },
  ]);
  const r = reminder();
  const result = await runPiRpc({
    ...f.options,
    reportWaitMs: 60_000,
    remind: r.remind,
  });
  assert.equal(result.exitCode, 0);
  assert.deepEqual(parseAgentResult(result.stdout), { ok: true, result: done });
});

test("a truncated reminder answer exits with code 1", async (t) => {
  const f = await fake(t, [
    {
      stdout: "work done",
      reminder: { result: done, stopReason: "length" },
    },
  ]);
  const result = await runPiRpc({ ...f.options, remind: reminder().remind });
  assert.equal(result.exitCode, 1);
});

for (const [kind, step, extra] of [
  ["crash", { stdout: "work", exitCode: 3 }, {}],
  ["timeout", { stdout: "work", sleepMs: 500 }, { timeoutMs: 100 }],
  ["abort", { stdout: "work", sleepMs: 500 }, { abort: true }],
  ["error stop reason", { stdout: "work", stopReason: "error" }, {}],
] as const) {
  test(`abnormal end ${kind} is not reminded`, async (t) => {
    const f = await fake(t, [step]);
    const r = reminder();
    const controller = new AbortController();
    const session = startPiRpc({
      ...f.options,
      ...("timeoutMs" in extra ? { timeoutMs: extra.timeoutMs } : {}),
      signal: controller.signal,
      remind: r.remind,
    });
    if ("abort" in extra) {
      await waitFor(async () => (await f.log()).includes("work"));
      controller.abort();
    }
    await session.done;
    assert.equal(prompts(await f.commands()).length, 1);
    assert.equal(r.calls.length, 0);
  });
}

for (const [kind, step] of [
  ["failed", { promptError: "No model configured" }],
  ["handled", { handled: true }],
] as const) {
  test(`a ${kind} first prompt is not reminded`, async (t) => {
    const f = await fake(t, [step]);
    let calls = 0;
    await runPiRpc({
      ...f.options,
      reportWaitMs: 60_000,
      remind: () => {
        calls += 1;
        return "remind";
      },
    });
    assert.equal(prompts(await f.commands()).length, 1);
    assert.equal(calls, 0);
  });
}
