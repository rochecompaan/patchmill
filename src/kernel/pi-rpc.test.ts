import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, type TestContext } from "node:test";
import { piRpcArgs, runPiRpc, startPiRpc } from "./pi-rpc.ts";
import { jsonlRecords } from "./pi-rpc-protocol.ts";
import { signalGroup, type PiSessionOptions } from "./pi-supervisor.ts";
import { parseAgentResult } from "./result.ts";

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
