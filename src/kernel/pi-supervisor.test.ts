import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { getEventListeners } from "node:events";
import { setTimeout as delay } from "node:timers/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mock, test, type TestContext } from "node:test";
import { piArgs, supervisePi, type PiSessionOptions } from "./pi-supervisor.ts";

async function setup(t: TestContext): Promise<PiSessionOptions> {
  const dir = await fs.mkdtemp(join(tmpdir(), "patchmill-pi-"));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  return {
    command: {
      command: process.execPath,
      argsPrefix: [
        "-e",
        "process.stdout.write('ok'); process.stderr.write('warning');",
        "--",
      ],
    },
    cwd: dir,
    agentDir: join(dir, "agent"),
    sessionDir: join(dir, "sessions"),
    promptPath: join(dir, "prompt.md"),
    logPath: join(dir, "pi.log"),
    extensionPaths: [],
    timeoutMs: 3000,
    graceMs: 100,
  };
}

test("piArgs preserves exact public argv including optional skill and ordered extensions", async (t) => {
  const options = await setup(t);
  assert.deepEqual(
    piArgs({
      ...options,
      sessionDir: "/sessions",
      skillPath: "/skill",
      promptPath: "/prompt",
      extensionPaths: ["/one", "/two"],
    }),
    [
      "-p",
      "--session-dir",
      "/sessions",
      "--skill",
      "/skill",
      "-e",
      "/one",
      "-e",
      "/two",
      "@/prompt",
    ],
  );
  assert.deepEqual(
    piArgs({ ...options, sessionDir: "/sessions", promptPath: "/prompt" }),
    ["-p", "--session-dir", "/sessions", "@/prompt"],
  );
});

test("returns stdout only, tees both streams, and reports an ordinary exit", async (t) => {
  const options = await setup(t);
  const chunks: string[] = [];
  const result = await supervisePi({
    ...options,
    onOutput: (chunk) => chunks.push(chunk),
  });
  assert.equal(result.exitCode, 0);
  assert.equal(result.signal, null);
  assert.equal(result.timedOut, false);
  assert.equal(result.aborted, false);
  assert.equal(result.stdout, "ok");
  assert.ok(result.durationMs >= 0);
  const log = await fs.readFile(options.logPath, "utf8");
  assert.ok(log.includes("ok"));
  assert.ok(log.includes("warning"));
  assert.equal(chunks.join(""), log);
});

const fakePiPath = new URL("../../test-support/fake-pi.mjs", import.meta.url)
  .pathname;

async function fake(t: TestContext, steps: unknown[]) {
  const options = await setup(t);
  const script = join(options.cwd, "script.json");
  await fs.writeFile(script, JSON.stringify(steps));
  return {
    ...options,
    command: { command: process.execPath, argsPrefix: [fakePiPath] },
    env: { PATCHMILL_FAKE_PI_SCRIPT: script },
  };
}

test("fake Pi sequences steps, emits environment/result, and persists usage", async (t) => {
  const options = await fake(t, [
    {
      stdout: "ok",
      printEnv: ["PI_CODING_AGENT_DIR", "PATCHMILL_TEST_VALUE"],
      result: { done: true },
      writeFiles: { "nested/file": "first" },
    },
    { stdout: "second", result: null, exitCode: 7 },
  ]);
  const first = await supervisePi({
    ...options,
    env: {
      ...options.env,
      PI_CODING_AGENT_DIR: "wrong",
      PATCHMILL_TEST_VALUE: "inherited override",
    },
  });
  assert.equal(first.exitCode, 0);
  assert.equal(
    first.stdout,
    `ok\n${options.agentDir}\ninherited override\n\`\`\`json\n{"done":true}\n\`\`\`\n`,
  );
  assert.equal(
    await fs.readFile(join(options.cwd, "nested/file"), "utf8"),
    "first",
  );
  assert.equal(
    await fs.readFile(join(options.sessionDir, "fake.jsonl"), "utf8"),
    '{"usage":{"input":100,"output":20,"cost":{"total":0.05}}}\n',
  );
  const second = await supervisePi(options);
  assert.equal(second.stdout, "second\n");
  assert.equal(second.exitCode, 7);
  assert.equal(
    await fs.readFile(
      `${options.env.PATCHMILL_FAKE_PI_SCRIPT}.counter`,
      "utf8",
    ),
    "2",
  );
});

for (const ignoreSigterm of [false, true]) {
  test(
    `timeout terminates fake Pi ${ignoreSigterm ? "with escalation" : "gracefully"}`,
    { timeout: 5000 },
    async (t) => {
      const options = await fake(t, [
        { stdout: "ready", sleepMs: 5000, ignoreSigterm },
      ]);
      const started = performance.now();
      const result = await supervisePi({
        ...options,
        timeoutMs: 300,
        graceMs: 100,
      });
      assert.equal(result.timedOut, true);
      assert.equal(result.aborted, false);
      assert.equal(result.signal, ignoreSigterm ? "SIGKILL" : "SIGTERM");
      assert.ok(result.stdout.includes("ready"));
      assert.ok(performance.now() - started < 1400);
    },
  );
}

test(
  "pre-abort never invokes Pi, and live abort terminates after readiness",
  { timeout: 5000 },
  async (t) => {
    const options = await fake(t, [{ stdout: "ready", sleepMs: 5000 }]);
    const pre = await supervisePi({ ...options, signal: AbortSignal.abort() });
    assert.equal(pre.aborted, true);
    assert.equal(pre.exitCode, null);
    assert.equal(pre.signal, null);
    assert.equal(pre.stdout, "");
    await assert.rejects(
      fs.stat(`${options.env.PATCHMILL_FAKE_PI_SCRIPT}.counter`),
      { code: "ENOENT" },
    );
    const controller = new AbortController();
    const result = await supervisePi({
      ...options,
      signal: controller.signal,
      onOutput: (chunk) => {
        if (chunk.includes("ready")) controller.abort();
      },
    });
    assert.equal(result.aborted, true);
    assert.equal(result.timedOut, false);
    assert.equal(result.signal, "SIGTERM");
  },
);

test(
  "abort escalates the group even after its leader exits and closes its pipes",
  { timeout: 5000 },
  async (t) => {
    const options = await setup(t);
    const controller = new AbortController();
    // The descendant closes IPC before readiness. It cannot hold the leader's pipes open.
    const descendant = `process.on('SIGTERM', () => {}); process.send(process.pid); process.disconnect(); setInterval(() => {}, 1000);`;
    const leader = `const {spawn}=require('node:child_process'); const c=spawn(process.execPath,['-e',${JSON.stringify(descendant)}],{stdio:['ignore','ignore','ignore','ipc']}); c.on('message',pid=>{c.once('disconnect',()=>process.stdout.write(JSON.stringify({leader:process.pid,child:pid})+'\\n'));}); setInterval(()=>{},1000);`;
    let pids: { leader: number; child: number } | undefined;
    t.after(() => {
      if (!pids) return;
      try {
        process.kill(-pids.leader, "SIGKILL");
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
      }
    });
    const result = await supervisePi({
      ...options,
      command: { command: process.execPath, argsPrefix: ["-e", leader, "--"] },
      signal: controller.signal,
      graceMs: 100,
      onOutput: (chunk) => {
        pids = JSON.parse(chunk);
        controller.abort();
      },
    });
    assert.equal(result.aborted, true);
    assert.ok(pids);
    assert.throws(() => process.kill(pids.leader, 0), { code: "ESRCH" });
    // An orphan zombie may await init reaping, but must not remain runnable.
    const deadline = performance.now() + 1000;
    while (true) {
      const stat = await fs
        .readFile(`/proc/${pids.child}/stat`, "utf8")
        .catch((error: NodeJS.ErrnoException) => {
          if (error.code === "ENOENT") return "";
          throw error;
        });
      if (stat === "" || stat.split(") ")[1]?.startsWith("Z")) break;
      assert.ok(
        performance.now() < deadline,
        `descendant still running: ${stat}`,
      );
      await delay(10);
    }
  },
);

test(
  "spawn, log-open, runtime log, and callback failures reject without hiding the cause",
  { timeout: 5000 },
  async (t) => {
    const controller = new AbortController();
    const options = { ...(await setup(t)), signal: controller.signal };
    await assert.rejects(
      supervisePi({
        ...options,
        command: { command: "\u0000", argsPrefix: [] },
      }),
      { code: "ERR_INVALID_ARG_VALUE" },
    );
    await assert.rejects(
      supervisePi({
        ...options,
        command: { command: join(options.cwd, "absent"), argsPrefix: [] },
      }),
      { code: "ENOENT" },
    );
    await assert.rejects(supervisePi({ ...options, logPath: options.cwd }), {
      code: "EISDIR",
    });
    await assert.rejects(supervisePi({ ...options, logPath: "/dev/full" }), {
      code: "ENOSPC",
    });
    const failure = new Error("output callback failed");
    await assert.rejects(
      supervisePi({
        ...options,
        onOutput: () => {
          throw failure;
        },
      }),
      (error: unknown) => error === failure,
    );
    assert.equal(getEventListeners(controller.signal, "abort").length, 0);
  },
);

test("fake Pi commits and pushes sequenced file changes only to a local bare repo", async (t) => {
  const options = await fake(t, [
    {
      writeFiles: { "tracked.txt": "one" },
      commit: "first change",
      push: true,
    },
    {
      writeFiles: { "tracked.txt": "two" },
      commit: "second change",
      push: true,
    },
  ]);
  const git = promisify(execFile);
  const remote = join(
    options.cwd,
    "..",
    `${options.cwd.split("/").at(-1)}-remote.git`,
  );
  t.after(() => fs.rm(remote, { recursive: true, force: true }));
  const env = {
    ...process.env,
    GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_AUTHOR_NAME: "Fixture",
    GIT_AUTHOR_EMAIL: "fixture@example.invalid",
    GIT_COMMITTER_NAME: "Fixture",
    GIT_COMMITTER_EMAIL: "fixture@example.invalid",
  };
  const run = (...args: string[]) =>
    git("git", args, { cwd: options.cwd, env });
  await run("init", "--initial-branch=main");
  await run("init", "--bare", remote);
  await run("remote", "add", "origin", remote);
  const running = { ...options, env: { ...env, ...options.env } };
  assert.equal((await supervisePi(running)).exitCode, 0);
  assert.equal(
    (await run("log", "-1", "--format=%s")).stdout.trim(),
    "first change",
  );
  assert.equal((await supervisePi(running)).exitCode, 0);
  assert.equal(
    (await run("--git-dir", remote, "show", "main:tracked.txt")).stdout,
    "two",
  );
  assert.equal((await run("rev-list", "--count", "HEAD")).stdout.trim(), "2");
});

test("a log-close failure preserves the primary failure and releases the descriptor", async (t) => {
  const options = await setup(t);
  const primary = new Error("callback failed");
  const cleanup = new Error("close failed");
  const open = fs.open;
  let handle: Awaited<ReturnType<typeof fs.open>> | undefined;
  mock.method(fs, "open", async (...args: Parameters<typeof fs.open>) => {
    handle = await open(...args);
    const close = handle.close.bind(handle);
    mock.method(handle, "close", async () => {
      await close();
      throw cleanup;
    });
    return handle;
  });
  t.after(() => mock.restoreAll());
  await assert.rejects(
    supervisePi({
      ...options,
      onOutput: () => {
        throw primary;
      },
    }),
    (error: unknown) => {
      assert.ok(error instanceof AggregateError);
      assert.deepEqual(error.errors, [primary, cleanup]);
      return true;
    },
  );
  assert.equal(handle?.fd, -1);
});
