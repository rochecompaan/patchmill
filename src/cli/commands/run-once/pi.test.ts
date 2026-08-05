import test from "node:test";
import assert from "node:assert/strict";
import type { Stats } from "node:fs";
import {
  appendFile,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  utimes,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { DEFAULT_PI_TASK_CONTRACT } from "../../../policy/task-contract.ts";
import { parseDevelopmentEnvironmentResult, runPiPrompt } from "./pi.ts";
import {
  createExactPiSessionObservationStreamer,
  sessionEntryToObservations,
  sessionEntryToStreamText,
} from "./pi-session-stream.ts";
import type {
  AgentIssueProgressEvent,
  CommandRunner,
  CommandResult,
} from "./types.ts";

type Call = {
  command: string;
  args: string[];
  cwd?: string;
  env?: Record<string, string | undefined>;
  onStdout?: (chunk: string) => void;
  onStderr?: (chunk: string) => void;
  signal?: AbortSignal;
};

function createMockRunner(
  handler: (call: Call) => Promise<CommandResult> | CommandResult,
): CommandRunner {
  return {
    async run(command, args, options = {}) {
      return await handler({
        command,
        args: [...args],
        cwd: options.cwd,
        env: (options as { env?: Record<string, string | undefined> }).env,
        onStdout: options.onStdout,
        onStderr: options.onStderr,
        signal: options.signal,
      });
    },
  };
}

function createStaticCommandRunner(results: CommandResult[]): CommandRunner {
  let index = 0;
  return createMockRunner(() => {
    const result = results[index];
    index += 1;
    if (!result) throw new Error("unexpected command");
    return result;
  });
}

function assertBundledPiCall(call: Call): string[] {
  assert.equal(call.command, process.execPath);
  assert.match(
    call.args[0] ?? "",
    /@earendil-works[/\\]pi-coding-agent[/\\]dist[/\\]cli\.js$/,
  );
  return call.args.slice(1);
}

function promptPath(args: string[]): string {
  const promptArg = args.find((arg) => arg.startsWith("@"));
  assert.ok(promptArg, `expected prompt path in ${args.join(" ")}`);
  return promptArg.slice(1);
}

const runOnceExtensionArgs = [
  "-e",
  "/repo/node_modules/pi-subagents",
  "-e",
  "/repo/extensions/todos.ts",
];

async function writeTodo(
  repoRoot: string,
  id: string,
  title: string,
  status: string,
): Promise<void> {
  const dir = join(repoRoot, ".pi", "todos");
  await mkdir(dir, { recursive: true });
  await writeFile(
    join(dir, `${id}.md`),
    `${JSON.stringify({ id, title, status })}\n\nbody\n`,
    "utf8",
  );
}

test("runPiPrompt writes the prompt to a temp file and surfaces nonzero pi failures", async () => {
  const runner = createMockRunner(async (call) => {
    const args = assertBundledPiCall(call);
    assert.equal(call.cwd, "/repo/worktree");
    assert.deepEqual(args.slice(0, 5), ["-e", args[1], "-e", args[3], "-p"]);
    assert.match(args[1] ?? "", /node_modules\/pi-subagents$/);
    assert.match(args[3] ?? "", /extensions\/todos\.ts$/);
    const prompt = await readFile(promptPath(args), "utf8");
    assert.equal(prompt, "prompt body");
    return { code: 9, stdout: "", stderr: "pi exploded" };
  });

  await assert.rejects(
    () =>
      runPiPrompt(runner, "/repo/worktree", "prompt body", {
        extensionArgs: runOnceExtensionArgs,
      }),
    /pi failed: pi exploded/,
  );
});

test("runPiPrompt loads bundled Pi extensions before the prompt argument", async () => {
  const runner = createMockRunner(async (call) => {
    const args = assertBundledPiCall(call);
    assert.deepEqual(args.slice(0, 5), ["-e", args[1], "-e", args[3], "-p"]);
    assert.match(args[1] ?? "", /node_modules\/pi-subagents$/);
    assert.match(args[3] ?? "", /extensions\/todos\.ts$/);
    assert.equal(args[5]?.startsWith("@"), true);
    return {
      code: 0,
      stdout: '{"status":"plan-created","planPath":"docs/plans/p.md"}',
      stderr: "",
    };
  });

  await runPiPrompt(runner, "/repo", "prompt", {
    stage: "pi-plan",
    extensionArgs: runOnceExtensionArgs,
  });
});

test("runPiPrompt can parse development environment results", async () => {
  const runner = createMockRunner(() => ({
    code: 0,
    stdout: '{"status":"ready","summary":"ready","evidence":["check passed"]}',
    stderr: "",
  }));

  const result = await runPiPrompt(
    runner,
    "/repo/worktree",
    "development environment prompt",
    {
      stage: "pi-development-environment",
      parseResult: parseDevelopmentEnvironmentResult,
    },
  );

  assert.deepEqual(result, {
    status: "ready",
    summary: "ready",
    evidence: ["check passed"],
  });
});

test("runPiPrompt passes configured skill files before the prompt argument", async () => {
  const runner = createMockRunner(async (call) => {
    const args = assertBundledPiCall(call);
    assert.deepEqual(args.slice(0, 9), [
      "-e",
      args[1],
      "-e",
      args[3],
      "--skill",
      "/repo/.patchmill/skills/writing-plans/SKILL.md",
      "--skill",
      "/repo/.patchmill/skills/review/SKILL.md",
      "-p",
    ]);
    assert.match(args[1] ?? "", /node_modules\/pi-subagents$/);
    assert.match(args[3] ?? "", /extensions\/todos\.ts$/);
    assert.equal(args[9]?.startsWith("@"), true);
    return {
      code: 0,
      stdout: '{"status":"plan-created","planPath":"docs/plans/p.md"}',
      stderr: "",
    };
  });

  await runPiPrompt(runner, "/repo", "prompt", {
    stage: "pi-plan",
    skillPaths: [
      "/repo/.patchmill/skills/writing-plans/SKILL.md",
      "/repo/.patchmill/skills/review/SKILL.md",
    ],
    extensionArgs: runOnceExtensionArgs,
  });
});

test("runPiPrompt passes the configured todo root to Pi", async () => {
  const runner = createMockRunner((call) => {
    assert.equal(call.env?.PI_TODO_PATH, ".patchmill/todos");
    return {
      code: 0,
      stdout: '{"status":"plan-created","planPath":"docs/plans/p.md"}',
      stderr: "",
    };
  });

  await runPiPrompt(runner, "/repo", "prompt", {
    stage: "pi-plan",
    taskContract: {
      ...DEFAULT_PI_TASK_CONTRACT,
      todoRoot: ".patchmill/todos",
    },
  });
});

test("runPiPrompt passes resolved todo done statuses to Pi", async () => {
  const runner = createMockRunner((call) => {
    assert.equal(call.env?.PI_TODO_DONE_STATUSES, JSON.stringify(["shipped"]));
    return {
      code: 0,
      stdout: '{"status":"plan-created","planPath":"docs/plans/p.md"}',
      stderr: "",
    };
  });

  await runPiPrompt(runner, "/repo", "prompt", {
    stage: "pi-plan",
    taskContract: {
      ...DEFAULT_PI_TASK_CONTRACT,
      doneStatuses: [" Shipped ", "shipped"],
    },
  });
});

test("runPiPrompt passes the local Pi agent dir to Pi", async () => {
  const runner = createMockRunner((call) => {
    assert.equal(call.env?.PI_CODING_AGENT_DIR, "/repo/.patchmill/pi-agent");
    assert.equal(call.env?.PI_TODO_PATH, DEFAULT_PI_TASK_CONTRACT.todoRoot);
    assert.equal(
      call.env?.PI_TODO_DONE_STATUSES,
      JSON.stringify(["closed", "completed", "complete", "done"]),
    );
    return {
      code: 0,
      stdout: '{"status":"plan-created","planPath":"docs/plans/p.md"}',
      stderr: "",
    };
  });

  await runPiPrompt(runner, "/repo", "prompt", {
    stage: "pi-plan",
  });
});

test("runPiPrompt logs pi stdout and stderr chunks", async () => {
  const events: AgentIssueProgressEvent[] = [];
  const runner = createStaticCommandRunner([
    {
      code: 0,
      stdout: '{"status":"plan-created","planPath":"docs/plans/p.md"}',
      stderr: "warning",
    },
  ]);

  await runPiPrompt(runner, "/repo", "prompt", {
    progress: {
      event: (event) => {
        events.push(event);
      },
    },
    stage: "pi-plan",
    heartbeatMs: 10_000,
  });

  assert.ok(
    events.some(
      (event) => event.level === "debug" && event.message === "pi stdout",
    ),
  );
  assert.ok(
    events.some(
      (event) => event.level === "debug" && event.message === "pi stderr",
    ),
  );
});

test("runPiPrompt streams messages appended to the prompted pi session JSONL", async () => {
  const streamed: string[] = [];
  const runner = createMockRunner(async (call) => {
    const args = assertBundledPiCall(call);
    assert.deepEqual(args.slice(0, 5), ["-e", args[1], "-e", args[3], "-p"]);
    assert.match(args[1] ?? "", /node_modules\/pi-subagents$/);
    assert.match(args[3] ?? "", /extensions\/todos\.ts$/);
    assert.equal(args.includes("--mode"), false);
    const sessionDirIndex = args.indexOf("--session-dir");
    assert.ok(
      sessionDirIndex >= 0,
      `expected --session-dir in ${args.join(" ")}`,
    );
    const sessionDir = args[sessionDirIndex + 1];
    assert.ok(sessionDir);

    const sessionPath = join(sessionDir, "--repo--", "session.jsonl");
    await mkdir(join(sessionDir, "--repo--"), { recursive: true });
    await writeFile(
      sessionPath,
      [
        JSON.stringify({
          type: "session",
          version: 3,
          id: "session-1",
          cwd: "/repo",
        }),
        JSON.stringify({
          type: "message",
          id: "user-1",
          parentId: null,
          timestamp: "2026-05-09T12:00:00.000Z",
          message: { role: "user", content: "prompt" },
        }),
        JSON.stringify({
          type: "message",
          id: "tool-1",
          parentId: "user-1",
          timestamp: "2026-05-09T12:00:01.000Z",
          message: {
            role: "toolResult",
            toolName: "bash",
            toolCallId: "call-1",
            isError: false,
            content: [{ type: "text", text: "meaningful tool output\n" }],
          },
        }),
        JSON.stringify({
          type: "message",
          id: "assistant-1",
          parentId: "tool-1",
          timestamp: "2026-05-09T12:00:02.000Z",
          message: {
            role: "assistant",
            provider: "openai-codex",
            model: "gpt-5.5",
            usage: {
              input: 45123,
              output: 321,
              cacheRead: 0,
              cacheWrite: 0,
              totalTokens: 45444,
              cost: {
                input: 0,
                output: 0,
                cacheRead: 0,
                cacheWrite: 0,
                total: 0,
              },
            },
            content: [
              {
                type: "text",
                text: "initial progress",
              },
            ],
          },
        }),
        JSON.stringify({
          type: "message",
          id: "assistant-2",
          parentId: "assistant-1",
          timestamp: "2026-05-09T12:00:03.000Z",
          message: {
            role: "assistant",
            provider: "openai-codex",
            model: "gpt-5.5",
            usage: {
              input: 45123,
              output: 321,
              cacheRead: 0,
              cacheWrite: 0,
              totalTokens: 45444,
              cost: {
                input: 0,
                output: 0,
                cacheRead: 0,
                cacheWrite: 0,
                total: 0,
              },
            },
            content: [
              {
                type: "text",
                text: 'planning output\n{"status":"plan-created","planPath":"docs/plans/p.md"}',
              },
            ],
          },
        }),
      ].join("\n") + "\n",
      "utf8",
    );
    call.onStderr?.("planning warning\n");
    return {
      code: 0,
      stdout:
        'planning output\n{"status":"plan-created","planPath":"docs/plans/p.md"}',
      stderr: "",
    };
  });

  const result = await runPiPrompt(runner, "/repo", "prompt", {
    stage: "pi-plan",
    extensionArgs: runOnceExtensionArgs,
    streamOutput: (chunk) => streamed.push(chunk),
  });

  assert.deepEqual(result, {
    status: "plan-created",
    planPath: "docs/plans/p.md",
    commit: undefined,
  });
  assert.deepEqual(streamed, [
    "meaningful tool output\n",
    "initial progress\ntok: task=45k total=45k\n",
    'planning output\n{"status":"plan-created","planPath":"docs/plans/p.md"}\ntok: task=45k total=91k\n',
  ]);
});

test("runPiPrompt creates a fresh durable invocation leaf and ignores stale JSONL", async (t) => {
  const repoRoot = await mkdtemp(join(tmpdir(), "patchmill-pi-session-"));
  t.after(async () => {
    await rm(repoRoot, { recursive: true, force: true });
  });

  const sessionRoot = join(
    repoRoot,
    ".patchmill",
    "runs",
    "issue-92",
    "run-2026-07-16T09-00-00-000Z-pi-sessions",
  );
  const staleLeaf = join(sessionRoot, "pi-plan", "invocation-stale");
  await mkdir(join(staleLeaf, "--repo--"), { recursive: true });
  await writeFile(
    join(staleLeaf, "--repo--", "session.jsonl"),
    JSON.stringify({
      type: "message",
      message: {
        role: "assistant",
        content: [{ type: "text", text: "stale progress" }],
      },
    }) + "\n",
    "utf8",
  );

  const streamed: string[] = [];
  let capturedPromptPath = "";
  let capturedSessionDir = "";

  const runner = createMockRunner(async (call) => {
    const args = assertBundledPiCall(call);
    capturedPromptPath = promptPath(args);
    const sessionDirIndex = args.indexOf("--session-dir");
    assert.ok(
      sessionDirIndex >= 0,
      `expected --session-dir in ${args.join(" ")}`,
    );
    capturedSessionDir = args[sessionDirIndex + 1] ?? "";

    assert.equal(dirname(capturedSessionDir), join(sessionRoot, "pi-plan"));
    assert.match(basename(capturedSessionDir), /^invocation-/);
    assert.notEqual(capturedSessionDir, staleLeaf);

    await mkdir(join(capturedSessionDir, "--repo--"), { recursive: true });
    await writeFile(
      join(capturedSessionDir, "--repo--", "session.jsonl"),
      JSON.stringify({
        type: "message",
        message: {
          role: "assistant",
          content: [{ type: "text", text: "current progress" }],
        },
      }) + "\n",
      "utf8",
    );

    return {
      code: 0,
      stdout: '{"status":"plan-created","planPath":"docs/plans/p.md"}',
      stderr: "",
    };
  });

  await runPiPrompt(runner, "/repo", "prompt", {
    stage: "pi-plan",
    sessionRoot,
    streamOutput: (chunk) => streamed.push(chunk),
  });

  assert.deepEqual(streamed, ["current progress\n"]);
  await assert.rejects(readFile(capturedPromptPath, "utf8"), {
    code: "ENOENT",
  });
  assert.equal(
    await readFile(
      join(capturedSessionDir, "--repo--", "session.jsonl"),
      "utf8",
    ),
    JSON.stringify({
      type: "message",
      message: {
        role: "assistant",
        content: [{ type: "text", text: "current progress" }],
      },
    }) + "\n",
  );
});

test("runPiPrompt pre-creates and passes an exact observed parent session", async (t) => {
  const repoRoot = await mkdtemp(join(tmpdir(), "patchmill-exact-session-"));
  t.after(async () => rm(repoRoot, { recursive: true, force: true }));
  const sessionRoot = join(
    repoRoot,
    ".patchmill",
    "runs",
    "issue-123",
    "sessions",
  );
  const events: AgentIssueProgressEvent[] = [];
  let sessionPath = "";
  const runner = createMockRunner(async (call) => {
    const args = assertBundledPiCall(call);
    const sessionIndex = args.indexOf("--session");
    assert.ok(sessionIndex >= 0, `expected --session in ${args.join(" ")}`);
    assert.equal(args.includes("--session-dir"), false);
    sessionPath = args[sessionIndex + 1] ?? "";
    assert.equal(await readFile(sessionPath, "utf8"), "");
    assert.equal(dirname(dirname(sessionPath)), join(sessionRoot, "pi-plan"));
    assert.match(basename(sessionPath), /^parent-[0-9a-f-]+\.jsonl$/);
    await writeFile(
      sessionPath,
      JSON.stringify({ type: "session", id: "parent" }) + "\n",
    );
    return {
      code: 0,
      stdout: '{"status":"plan-created","planPath":"docs/plans/p.md"}',
      stderr: "",
    };
  });

  await runPiPrompt(runner, "/repo", "prompt", {
    progress: { event: (event) => events.push(event) },
    stage: "pi-plan",
    observeSession: true,
    sessionRoot,
  });

  assert.ok(
    events.some(
      (event) =>
        event.message === "pi session path" && event.data === sessionPath,
    ),
  );
});

test("runPiPrompt preserves an exact sessionDir override and logs the actual session dir", async (t) => {
  const repoRoot = await mkdtemp(
    join(tmpdir(), "patchmill-pi-session-override-"),
  );
  t.after(async () => {
    await rm(repoRoot, { recursive: true, force: true });
  });

  const events: AgentIssueProgressEvent[] = [];
  const exactSessionDir = join(repoRoot, "exact-session-dir");
  let capturedPromptPath = "";
  let capturedSessionPath = "";

  const runner = createMockRunner(async (call) => {
    const args = assertBundledPiCall(call);
    capturedPromptPath = promptPath(args);
    const sessionIndex = args.indexOf("--session");
    assert.ok(sessionIndex >= 0, `expected --session in ${args.join(" ")}`);
    const sessionPath = args[sessionIndex + 1] ?? "";
    capturedSessionPath = sessionPath;
    assert.equal(dirname(sessionPath), exactSessionDir);
    assert.match(basename(sessionPath), /^parent-[0-9a-f-]+\.jsonl$/);
    assert.equal(await readFile(sessionPath, "utf8"), "");

    await writeFile(
      sessionPath,
      JSON.stringify({ type: "session", id: "session-1", cwd: "/repo" }) + "\n",
      "utf8",
    );

    return {
      code: 0,
      stdout: '{"status":"plan-created","planPath":"docs/plans/p.md"}',
      stderr: "",
    };
  });

  await runPiPrompt(runner, "/repo", "prompt", {
    progress: { event: (event) => events.push(event) },
    stage: "pi-plan",
    observeSession: true,
    sessionDir: exactSessionDir,
  });

  await assert.rejects(readFile(capturedPromptPath, "utf8"), {
    code: "ENOENT",
  });
  assert.equal(
    await readFile(capturedSessionPath, "utf8"),
    JSON.stringify({ type: "session", id: "session-1", cwd: "/repo" }) + "\n",
  );
  assert.ok(
    events.some(
      (event) =>
        event.level === "debug" &&
        event.stage === "pi-plan" &&
        event.message === "pi session dir" &&
        event.data === exactSessionDir,
    ),
  );
});

test("runPiPrompt emits structured observations and suppresses raw text unless streamOutput is provided", async () => {
  const observations: Array<{
    type: string;
    outputTokens?: number;
    toolName?: string;
    text?: string;
  }> = [];
  const streamed: string[] = [];
  const runner = createMockRunner(async (call) => {
    const sessionIndex = call.args.indexOf("--session");
    assert.ok(
      sessionIndex >= 0,
      `expected --session in ${call.args.join(" ")}`,
    );
    const sessionPath = call.args[sessionIndex + 1] ?? "";
    assert.equal(await readFile(sessionPath, "utf8"), "");
    await writeFile(
      sessionPath,
      [
        JSON.stringify({
          type: "session",
          version: 3,
          id: "session-1",
          cwd: "/repo",
        }),
        JSON.stringify({
          type: "message",
          message: {
            role: "toolResult",
            toolName: "read",
            content: [{ type: "text", text: "large file body" }],
          },
        }),
        JSON.stringify({
          type: "message",
          message: {
            role: "assistant",
            usage: {
              input: 90000,
              output: 1234,
              cacheRead: 80000,
              cacheWrite: 70000,
              totalTokens: 241234,
            },
            content: [{ type: "text", text: "assistant narration" }],
          },
        }),
      ].join("\n") + "\n",
      "utf8",
    );
    return {
      code: 0,
      stdout: '{"status":"plan-created","planPath":"docs/plans/p.md"}',
      stderr: "",
    };
  });

  await runPiPrompt(runner, "/repo", "prompt", {
    stage: "pi-plan",
    observeSession: true,
    onObservation: (observation) => observations.push(observation),
    streamOutput: (chunk) => streamed.push(chunk),
  });

  assert.deepEqual(observations, [
    { type: "tool-call", toolName: "read" },
    { type: "assistant-usage", outputTokens: 1234 },
    { type: "text", text: "assistant narration" },
  ]);
  assert.deepEqual(streamed, []);
});

test("runPiPrompt streams raw text in verbose mode", async () => {
  const streamed: string[] = [];
  const runner = createMockRunner(async (call) => {
    const sessionIndex = call.args.indexOf("--session");
    assert.ok(sessionIndex >= 0);
    const sessionPath = call.args[sessionIndex + 1] ?? "";
    await writeFile(
      sessionPath,
      JSON.stringify({
        type: "message",
        message: {
          role: "assistant",
          content: [{ type: "text", text: "verbose narration" }],
        },
      }) + "\n",
      "utf8",
    );
    return {
      code: 0,
      stdout: '{"status":"plan-created","planPath":"docs/plans/p.md"}',
      stderr: "",
    };
  });

  await runPiPrompt(runner, "/repo", "prompt", {
    stage: "pi-plan",
    observeSession: true,
    verbosePiOutput: true,
    streamOutput: (chunk) => streamed.push(chunk),
  });

  assert.deepEqual(streamed, ["verbose narration\n"]);
});

test("runPiPrompt verbose mode does not append synthetic token lines", async () => {
  const streamed: string[] = [];
  const runner = createMockRunner(async (call) => {
    const sessionIndex = call.args.indexOf("--session");
    assert.ok(sessionIndex >= 0);
    const sessionPath = call.args[sessionIndex + 1] ?? "";
    await writeFile(
      sessionPath,
      JSON.stringify({
        type: "message",
        message: {
          role: "assistant",
          usage: { input: 90000, output: 1234, totalTokens: 91234 },
          content: [{ type: "text", text: "verbose narration" }],
        },
      }) + "\n",
      "utf8",
    );
    return {
      code: 0,
      stdout: '{"status":"plan-created","planPath":"docs/plans/p.md"}',
      stderr: "",
    };
  });

  await runPiPrompt(runner, "/repo", "prompt", {
    stage: "pi-plan",
    observeSession: true,
    verbosePiOutput: true,
    streamOutput: (chunk) => streamed.push(chunk),
  });

  assert.deepEqual(streamed, ["verbose narration\n"]);
});

test("runPiPrompt reports cleanup failure after a successful Pi result", async () => {
  const runner = createMockRunner(() => ({
    code: 0,
    stdout: '{"status":"plan-created","planPath":"docs/plans/p.md"}',
    stderr: "",
  }));

  await assert.rejects(
    () =>
      runPiPrompt(runner, "/repo", "prompt", {
        stage: "pi-plan",
        cleanupPromptTempDir: async () => {
          throw new Error("cleanup exploded");
        },
      }),
    /cleanup exploded/,
  );
});

test("runPiPrompt ignores newer sibling and nested JSONL when observing an exact parent", async (t) => {
  const repoRoot = await mkdtemp(join(tmpdir(), "patchmill-exact-ignore-"));
  t.after(async () => rm(repoRoot, { recursive: true, force: true }));
  const observations: string[] = [];
  const runner = createMockRunner(async (call) => {
    const sessionPath = call.args[call.args.indexOf("--session") + 1] ?? "";
    const invocationDir = dirname(sessionPath);
    await mkdir(join(invocationDir, "nested"), { recursive: true });
    const entry = (text: string) =>
      JSON.stringify({
        type: "message",
        message: { role: "assistant", content: [{ type: "text", text }] },
      }) + "\n";
    await writeFile(sessionPath, entry("parent"));
    const nestedPath = join(invocationDir, "nested", "session.jsonl");
    const siblingPath = join(invocationDir, "sibling.jsonl");
    await writeFile(nestedPath, entry("nested"));
    await writeFile(siblingPath, entry("sibling"));
    await utimes(sessionPath, new Date(1_000), new Date(1_000));
    await utimes(nestedPath, new Date(2_000), new Date(2_000));
    await utimes(siblingPath, new Date(3_000), new Date(3_000));
    assert.ok(
      (await stat(nestedPath)).mtimeMs > (await stat(sessionPath)).mtimeMs,
    );
    assert.ok(
      (await stat(siblingPath)).mtimeMs > (await stat(sessionPath)).mtimeMs,
    );
    return {
      code: 0,
      stdout: '{"status":"plan-created","planPath":"docs/plans/p.md"}',
      stderr: "",
    };
  });

  await runPiPrompt(runner, "/repo", "prompt", {
    stage: "pi-plan",
    observeSession: true,
    sessionRoot: repoRoot,
    onObservation: (observation) => {
      if (observation.type === "text") observations.push(observation.text);
    },
  });
  assert.deepEqual(observations, ["parent"]);
});

test("concurrent observed Pi prompts receive isolated exact parent sessions", async (t) => {
  const repoRoot = await mkdtemp(join(tmpdir(), "patchmill-exact-concurrent-"));
  t.after(async () => rm(repoRoot, { recursive: true, force: true }));
  const sessionPaths: string[] = [];
  let bothStarted!: () => void;
  const started = new Promise<void>((resolve) => {
    bothStarted = resolve;
  });
  let arrivals = 0;
  let release!: () => void;
  const released = new Promise<void>((resolve) => {
    release = resolve;
  });
  const runner = createMockRunner(async (call) => {
    const sessionPath = call.args[call.args.indexOf("--session") + 1] ?? "";
    const prompt = await readFile(promptPath(call.args), "utf8");
    const text =
      prompt === "first"
        ? "first parent"
        : prompt === "second"
          ? "second parent"
          : undefined;
    assert.ok(text, `unexpected concurrent prompt: ${prompt}`);
    sessionPaths.push(sessionPath);
    arrivals += 1;
    if (arrivals === 2) bothStarted();
    await released;
    await writeFile(
      sessionPath,
      JSON.stringify({
        type: "message",
        message: { role: "assistant", content: [{ type: "text", text }] },
      }) + "\n",
      "utf8",
    );
    return {
      code: 0,
      stdout: '{"status":"plan-created","planPath":"docs/plans/p.md"}',
      stderr: "",
    };
  });
  const first: string[] = [];
  const second: string[] = [];
  const firstRun = runPiPrompt(runner, "/repo", "first", {
    stage: "pi-plan",
    observeSession: true,
    sessionRoot: repoRoot,
    onObservation: (observation) => {
      if (observation.type === "text") first.push(observation.text);
    },
  });
  const secondRun = runPiPrompt(runner, "/repo", "second", {
    stage: "pi-plan",
    observeSession: true,
    sessionRoot: repoRoot,
    onObservation: (observation) => {
      if (observation.type === "text") second.push(observation.text);
    },
  });
  await started;
  release();
  await Promise.all([firstRun, secondRun]);
  assert.notEqual(sessionPaths[0], sessionPaths[1]);
  assert.deepEqual(first, ["first parent"]);
  assert.deepEqual(second, ["second parent"]);
});

test("runPiPrompt aborts the runner when exact observation fails", async (t) => {
  const repoRoot = await mkdtemp(join(tmpdir(), "patchmill-observe-abort-"));
  t.after(async () => rm(repoRoot, { recursive: true, force: true }));
  let abortObserved = false;
  let allowClose!: () => void;
  const closeAllowed = new Promise<void>((resolve) => {
    allowClose = resolve;
  });
  const runner = createMockRunner(async (call) => {
    const args = assertBundledPiCall(call);
    const sessionPath = args[args.indexOf("--session") + 1] ?? "";
    await writeFile(sessionPath, "{bad json\n", "utf8");
    call.signal?.addEventListener("abort", () => {
      abortObserved = true;
      allowClose();
    });
    await closeAllowed;
    return {
      code: 1,
      stdout: "partial stdout",
      stderr: "runner closed after abort",
    };
  });

  await assert.rejects(
    () =>
      runPiPrompt(runner, "/repo", "prompt", {
        stage: "pi-plan",
        observeSession: true,
        sessionRoot: repoRoot,
      }),
    (error) => error instanceof AggregateError && error.errors.length >= 2,
  );
  assert.equal(abortObserved, true);
});

test("runPiPrompt preserves observation, runner, and cleanup failures", async (t) => {
  const repoRoot = await mkdtemp(join(tmpdir(), "patchmill-observe-causes-"));
  t.after(async () => rm(repoRoot, { recursive: true, force: true }));
  let allowClose!: () => void;
  const closeAllowed = new Promise<void>((resolve) => {
    allowClose = resolve;
  });
  const runner = createMockRunner(async (call) => {
    const sessionPath = call.args[call.args.indexOf("--session") + 1] ?? "";
    await writeFile(
      sessionPath,
      JSON.stringify({
        type: "message",
        message: {
          role: "assistant",
          content: [{ type: "text", text: "progress" }],
        },
      }) + "\n",
      "utf8",
    );
    call.signal?.addEventListener("abort", allowClose);
    await closeAllowed;
    return { code: 1, stdout: "", stderr: "runner failed" };
  });

  await assert.rejects(
    () =>
      runPiPrompt(runner, "/repo", "prompt", {
        stage: "pi-plan",
        observeSession: true,
        sessionRoot: repoRoot,
        onObservation: () => Promise.reject(new Error("callback exploded")),
        cleanupPromptTempDir: async () => {
          throw new Error("cleanup exploded");
        },
      }),
    (error) => {
      assert.equal(error instanceof AggregateError, true);
      assert.deepEqual(
        (error as AggregateError).errors.map(
          (cause) => (cause as Error).message,
        ),
        [
          "observation: callback exploded",
          "runner: pi failed: runner failed",
          "cleanup: cleanup exploded",
        ],
      );
      return true;
    },
  );
});

test("exact session observation awaits callbacks in file order", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "patchmill-exact-stream-"));
  t.after(async () => rm(dir, { recursive: true, force: true }));
  const sessionPath = join(dir, "parent.jsonl");
  await writeFile(
    sessionPath,
    ["first", "second"]
      .map((text) =>
        JSON.stringify({
          type: "message",
          message: { role: "assistant", content: [{ type: "text", text }] },
        }),
      )
      .join("\n") + "\n",
    "utf8",
  );
  const delivered: string[] = [];
  let releaseFirst!: () => void;
  const firstCanFinish = new Promise<void>((resolve) => {
    releaseFirst = resolve;
  });
  let firstStarted!: () => void;
  const firstWasDelivered = new Promise<void>((resolve) => {
    firstStarted = resolve;
  });
  const streamer = createExactPiSessionObservationStreamer(
    sessionPath,
    async (observation) => {
      if (observation.type !== "text") return;
      delivered.push(observation.text);
      if (observation.text === "first") {
        firstStarted();
        await firstCanFinish;
      }
    },
    { pollMs: 60_000 },
  );

  streamer.start();
  await firstWasDelivered;
  assert.deepEqual(delivered, ["first"]);
  releaseFirst();
  await streamer.stop();
  assert.deepEqual(delivered, ["first", "second"]);
});

test("exact session observation de-duplicates matching tool call IDs", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "patchmill-exact-tool-call-"));
  t.after(async () => rm(dir, { recursive: true, force: true }));
  const sessionPath = join(dir, "parent.jsonl");
  await writeFile(
    sessionPath,
    [
      {
        type: "message",
        message: {
          role: "assistant",
          content: [{ type: "toolCall", id: "call-1", name: "bash" }],
        },
      },
      {
        type: "message",
        message: { role: "toolResult", toolCallId: "call-1", toolName: "bash" },
      },
    ]
      .map((entry) => JSON.stringify(entry))
      .join("\n") + "\n",
    "utf8",
  );
  const observed: Array<{ toolName?: string; toolCallId?: string }> = [];
  const streamer = createExactPiSessionObservationStreamer(
    sessionPath,
    (observation) => {
      if (observation.type === "tool-call") observed.push(observation);
    },
  );

  streamer.start();
  await streamer.stop();

  assert.deepEqual(observed, [
    { type: "tool-call", toolName: "bash", toolCallId: "call-1" },
  ]);
});

test("exact session observation preserves UTF-8 split across byte-range polls", async () => {
  const line = `${JSON.stringify({
    type: "message",
    message: {
      role: "assistant",
      content: [{ type: "text", text: "café" }],
    },
  })}\n`;
  const bytes = new TextEncoder().encode(line);
  const accentedCharacter = new TextEncoder().encode("é");
  const accentedStart = bytes.findIndex(
    (_byte, index) =>
      bytes[index] === accentedCharacter[0] &&
      bytes[index + 1] === accentedCharacter[1],
  );
  assert.ok(accentedStart >= 0);
  const split = accentedStart + 1;
  let statCalls = 0;
  let firstReadComplete!: () => void;
  const firstReadCompleted = new Promise<void>((resolve) => {
    firstReadComplete = resolve;
  });
  const delivered: string[] = [];
  const streamer = createExactPiSessionObservationStreamer(
    "parent.jsonl",
    (observation) => {
      if (observation.type === "text") delivered.push(observation.text);
    },
    {
      statFile: async () => {
        statCalls += 1;
        return { size: statCalls === 1 ? split : bytes.length } as Stats;
      },
      readRange: async (_path, start, end) => {
        const chunk = bytes.slice(start, end);
        if (start === 0) firstReadComplete();
        return chunk;
      },
    },
  );

  streamer.start();
  await firstReadCompleted;
  await streamer.stop();

  assert.deepEqual(delivered, ["café"]);
});

test("exact session observation retains an undefined callback rejection", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "patchmill-exact-undefined-"));
  t.after(async () => rm(dir, { recursive: true, force: true }));
  const sessionPath = join(dir, "parent.jsonl");
  await writeFile(
    sessionPath,
    `${JSON.stringify({
      type: "message",
      message: { role: "assistant", content: [{ type: "text", text: "boom" }] },
    })}\n`,
    "utf8",
  );
  const streamer = createExactPiSessionObservationStreamer(sessionPath, () =>
    Promise.reject(),
  );

  streamer.start();
  await assert.rejects(streamer.stop(), (error) => error === undefined);
});

test("exact session observation performs a final read after an active poll", async () => {
  const first = `${JSON.stringify({
    type: "message",
    message: { role: "assistant", content: [{ type: "text", text: "first" }] },
  })}\n`;
  const second = `${JSON.stringify({
    type: "message",
    message: { role: "assistant", content: [{ type: "text", text: "second" }] },
  })}\n`;
  let releaseFirstRead!: () => void;
  const firstReadCanFinish = new Promise<void>((resolve) => {
    releaseFirstRead = resolve;
  });
  let firstReadStarted!: () => void;
  const firstReadHasStarted = new Promise<void>((resolve) => {
    firstReadStarted = resolve;
  });
  let statCalls = 0;
  const delivered: string[] = [];
  const streamer = createExactPiSessionObservationStreamer(
    "parent.jsonl",
    (observation) => {
      if (observation.type === "text") delivered.push(observation.text);
    },
    {
      statFile: async () => {
        statCalls += 1;
        return {
          size: statCalls === 1 ? first.length : first.length + second.length,
        } as Stats;
      },
      readRange: async (_path, start) => {
        if (start === 0) {
          firstReadStarted();
          await firstReadCanFinish;
          return new TextEncoder().encode(first);
        }
        return new TextEncoder().encode(second);
      },
    },
  );

  streamer.start();
  await firstReadHasStarted;
  const stopped = streamer.stop();
  releaseFirstRead();
  await stopped;

  assert.deepEqual(delivered, ["first", "second"]);
});

test("exact session observation rejects malformed JSON and I/O errors", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "patchmill-exact-error-"));
  t.after(async () => rm(dir, { recursive: true, force: true }));
  const sessionPath = join(dir, "parent.jsonl");
  await writeFile(sessionPath, "{bad json\n", "utf8");
  const malformed = createExactPiSessionObservationStreamer(
    sessionPath,
    () => undefined,
  );
  malformed.start();
  await assert.rejects(malformed.stop(), SyntaxError);

  const ioError = new Error("injected stat failure");
  const io = createExactPiSessionObservationStreamer(
    sessionPath,
    () => undefined,
    {
      statFile: async () => {
        throw ioError;
      },
    },
  );
  io.start();
  await assert.rejects(io.stop(), (error) => error === ioError);
});

test("runPiPrompt emits heartbeat events while pi is pending", async () => {
  const events: AgentIssueProgressEvent[] = [];
  let finishRun: (result: CommandResult) => void = () => undefined;
  const runner = createMockRunner(
    () =>
      new Promise<CommandResult>((resolve) => {
        finishRun = resolve;
      }),
  );

  const run = runPiPrompt(runner, "/repo", "prompt", {
    progress: {
      event: (event) => {
        events.push(event);
      },
    },
    stage: "pi-implementation",
    heartbeatMs: 10,
    issueNumber: 45,
    taskProgress: () => ({ current: 3, total: 7 }),
    tokenUsage: () => "tok: task=45k total=272k",
  });

  await new Promise((resolve) => setTimeout(resolve, 25));
  finishRun({
    code: 0,
    stdout: '{"status":"plan-created","planPath":"docs/plans/p.md"}',
    stderr: "",
  });
  await run;

  assert.ok(
    events.some(
      (event) =>
        event.level === "heartbeat" &&
        /^\[issue #45\] implementing task 3\/7 \| tok: task=45k total=272k \| elapsed \d+s$/.test(
          event.message,
        ),
    ),
  );
});

test("runPiPrompt aggregates heartbeat failures while Pi is pending", async () => {
  const heartbeatError = new Error("heartbeat exploded");
  let heartbeatFailed = false;
  let finishRun!: () => void;
  let runnerStarted!: () => void;
  const runnerHasStarted = new Promise<void>((resolve) => {
    runnerStarted = resolve;
  });
  const runner = createMockRunner(
    () =>
      new Promise<CommandResult>((resolve) => {
        finishRun = () =>
          resolve({
            code: 0,
            stdout: '{"status":"plan-created","planPath":"docs/plans/p.md"}',
            stderr: "",
          });
        runnerStarted();
      }),
  );

  const run = runPiPrompt(runner, "/repo", "prompt", {
    progress: {
      event: (event) => {
        if (event.level !== "heartbeat" || heartbeatFailed) return;
        heartbeatFailed = true;
        return runnerHasStarted.then(() => {
          finishRun();
          throw heartbeatError;
        });
      },
    },
    stage: "pi-plan",
    heartbeatMs: 1,
  });

  await assert.rejects(
    run,
    (error) => error instanceof Error && error.message === "heartbeat exploded",
  );
});

test("sessionEntryToObservations reports assistant output usage only", () => {
  const observations = sessionEntryToObservations({
    type: "message",
    message: {
      role: "assistant",
      usage: {
        input: 45123,
        output: 987,
        cacheRead: 12000,
        cacheWrite: 34000,
        totalTokens: 92110,
      },
      content: [{ type: "text", text: "progress text" }],
    },
  });

  assert.deepEqual(observations, [
    { type: "assistant-usage", outputTokens: 987 },
    { type: "text", text: "progress text" },
  ]);
});

test("sessionEntryToObservations reports assistant tool calls with arguments", () => {
  const observations = sessionEntryToObservations({
    type: "message",
    message: {
      role: "assistant",
      content: [
        {
          type: "toolCall",
          id: "call-1",
          name: "bash",
          arguments: {
            command:
              'rg -n "Picking Log|Trimming Log|Container Assignments" mobile',
            timeout: 15,
          },
        },
        {
          type: "toolCall",
          id: "call-2",
          name: "read",
          arguments: {
            path: "mobile/app/src/main/java/com/patchmill/PickingLogRepository.kt",
            offset: 500,
            limit: 35,
          },
        },
      ],
    },
  });

  assert.deepEqual(observations, [
    {
      type: "tool-call",
      toolName: "bash",
      toolCallId: "call-1",
      arguments: {
        command:
          'rg -n "Picking Log|Trimming Log|Container Assignments" mobile',
        timeout: 15,
      },
    },
    {
      type: "tool-call",
      toolName: "read",
      toolCallId: "call-2",
      arguments: {
        path: "mobile/app/src/main/java/com/patchmill/PickingLogRepository.kt",
        offset: 500,
        limit: 35,
      },
    },
  ]);
});

test("sessionEntryToObservations reports tool calls without streaming tool results", () => {
  const observations = sessionEntryToObservations({
    type: "message",
    message: {
      role: "toolResult",
      toolName: "bash",
      toolCallId: "call-1",
      content: [{ type: "text", text: "large tool output" }],
    },
  });

  assert.deepEqual(observations, [
    { type: "tool-call", toolName: "bash", toolCallId: "call-1" },
  ]);
});

test("sessionEntryToObservations ignores input-only usage for token accounting", () => {
  const observations = sessionEntryToObservations({
    type: "message",
    message: {
      role: "assistant",
      usage: { input: 45123, cacheRead: 12000, cacheWrite: 34000 },
      content: [{ type: "text", text: "progress text" }],
    },
  });

  assert.deepEqual(observations, [{ type: "text", text: "progress text" }]);
});

test("sessionEntryToStreamText reports task and total tokens", () => {
  const text = sessionEntryToStreamText({
    type: "message",
    message: {
      role: "assistant",
      provider: "openai-codex",
      model: "gpt-5.5:high",
      usage: { input: 45123, totalTokens: 45987 },
      content: [{ type: "text", text: "progress\n" }],
    },
  });

  assert.equal(text, "progress\ntok: task=45k total=46k\n");
});

test("sessionEntryToStreamText falls back to input and output when total tokens are absent", () => {
  const text = sessionEntryToStreamText({
    type: "message",
    message: {
      role: "assistant",
      usage: { input: 45123, output: 987 },
      content: [{ type: "text", text: "progress\n" }],
    },
  });

  assert.equal(text, "progress\ntok: task=45k total=46k\n");
});

test("runPiPrompt reads issue task progress from the configured worktree root", async () => {
  const repoRoot = await mkdtemp(join(tmpdir(), "patchmill-issue-main-"));
  const worktreeRoot = join(
    repoRoot,
    ".worktrees",
    "patchmill-issue-14-example",
  );

  for (let index = 1; index <= 8; index += 1) {
    await writeTodo(
      repoRoot,
      `main-${index}`,
      `issue-14-task-${String(index).padStart(2, "0")}-planned`,
      "completed",
    );
    await writeTodo(
      worktreeRoot,
      `worktree-${index}`,
      `issue-14-task-${String(index).padStart(2, "0")}-planned`,
      index < 7 ? "closed" : "open",
    );
  }

  const events: AgentIssueProgressEvent[] = [];
  let finishRun: (result: CommandResult) => void = () => undefined;
  const runner = createMockRunner(
    () =>
      new Promise<CommandResult>((resolve) => {
        finishRun = resolve;
      }),
  );

  const run = runPiPrompt(runner, worktreeRoot, "prompt", {
    progress: {
      event: (event) => {
        events.push(event);
      },
    },
    stage: "pi-implementation",
    heartbeatMs: 10,
    issueNumber: 14,
    repoRoot: worktreeRoot,
  });

  await new Promise((resolve) => setTimeout(resolve, 25));
  finishRun({
    code: 0,
    stdout:
      '{"status":"pr-created","prUrl":"https://forgejo.example/pr/14","branch":"agent/issue-14-example","commits":[],"validation":[]}',
    stderr: "",
  });
  await run;

  assert.ok(
    events.some(
      (event) =>
        event.level === "heartbeat" &&
        event.message.includes("implementing task 7/8"),
    ),
  );
});

test("runPiPrompt reads planning task progress from the configured task contract", async () => {
  const repoRoot = await mkdtemp(
    join(tmpdir(), "patchmill-issue-plan-progress-"),
  );
  const contract = {
    ...DEFAULT_PI_TASK_CONTRACT,
    todoRoot: ".patchmill/todos",
    todoTitlePattern: "work-<number>-step-<two-digit-number>-<slug>",
    doneStatuses: ["shipped"],
  };
  await mkdir(join(repoRoot, ".patchmill", "todos"), { recursive: true });
  await writeFile(
    join(repoRoot, ".patchmill", "todos", "a.md"),
    `${JSON.stringify({ id: "a", title: "work-14-step-01-date-range-model", status: "shipped" })}\n\nbody\n`,
    "utf8",
  );
  await writeFile(
    join(repoRoot, ".patchmill", "todos", "b.md"),
    `${JSON.stringify({ id: "b", title: "work-14-step-02-dashboard-wiring", status: "started" })}\n\nbody\n`,
    "utf8",
  );

  const events: AgentIssueProgressEvent[] = [];
  const taskProgress: Array<{
    current: number;
    total: number;
    label?: string;
  }> = [];
  let finishRun: (result: CommandResult) => void = () => undefined;
  const runner = createMockRunner(
    () =>
      new Promise<CommandResult>((resolve) => {
        finishRun = resolve;
      }),
  );

  const run = runPiPrompt(runner, repoRoot, "prompt", {
    progress: {
      event: (event) => {
        events.push(event);
      },
    },
    stage: "pi-plan",
    heartbeatMs: 10,
    issueNumber: 14,
    repoRoot,
    taskContract: contract,
    onTaskProgress: (progress) => {
      taskProgress.push(progress);
    },
  });

  await new Promise((resolve) => setTimeout(resolve, 25));
  finishRun({
    code: 0,
    stdout: '{"status":"plan-created","planPath":"docs/plans/p.md"}',
    stderr: "",
  });
  await run;

  assert.ok(
    events.some(
      (event) =>
        event.level === "heartbeat" &&
        /^\[issue #14\] planning \| tok: task=\? total=\? \| elapsed \d+s$/.test(
          event.message,
        ),
    ),
  );
  assert.ok(
    taskProgress.some(
      (progress) =>
        progress.current === 2 &&
        progress.total === 2 &&
        progress.label === "dashboard wiring",
    ),
  );
});

test("createExactPiSessionObservationStreamer starts at a caller-provided byte offset", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "patchmill-exact-offset-"));
  t.after(async () => rm(dir, { recursive: true, force: true }));
  const sessionPath = join(dir, "parent.jsonl");
  const oldEntry = `${JSON.stringify({ type: "message", message: { role: "assistant", content: [{ type: "text", text: "old progress" }] } })}\n`;
  await writeFile(sessionPath, oldEntry, "utf8");
  const observations: string[] = [];
  const streamer = createExactPiSessionObservationStreamer(
    sessionPath,
    (observation) => {
      if (observation.type === "text") observations.push(observation.text);
    },
    { startOffset: Buffer.byteLength(oldEntry) },
  );
  streamer.start();
  await writeFile(
    sessionPath,
    `${oldEntry}${JSON.stringify({ type: "message", message: { role: "assistant", content: [{ type: "text", text: "new progress" }] } })}\n`,
    "utf8",
  );
  await streamer.stop();
  assert.deepEqual(observations, ["new progress"]);
});

test("runPiPrompt repairs a parse failure by resuming the same exact session", async () => {
  const prompts: string[] = [];
  const sessions: string[] = [];
  const observations: string[] = [];
  const runner = createMockRunner(async (call) => {
    const args = assertBundledPiCall(call);
    prompts.push(await readFile(promptPath(args), "utf8"));
    const sessionPath = args[args.indexOf("--session") + 1] ?? "";
    sessions.push(sessionPath);
    if (prompts.length === 1) {
      await writeFile(
        sessionPath,
        [
          {
            type: "message",
            message: {
              role: "assistant",
              content: [
                {
                  type: "toolCall",
                  id: "review",
                  name: "subagent",
                  arguments: { async: true },
                },
              ],
            },
          },
          {
            type: "message",
            message: {
              role: "toolResult",
              toolName: "subagent",
              toolCallId: "review",
              content: [
                {
                  type: "text",
                  text: '{"id":"pm-subagents-abc123","state":"running"}',
                },
              ],
            },
          },
          {
            type: "message",
            message: {
              role: "assistant",
              content: [
                {
                  type: "text",
                  text: "Final review is running: pm-subagents-abc123.",
                },
              ],
            },
          },
        ]
          .map((entry) => JSON.stringify(entry))
          .join("\n") + "\n",
        "utf8",
      );
      return {
        code: 0,
        stdout: "Final review is running: pm-subagents-abc123.",
        stderr: "",
      };
    }
    await appendFile(
      sessionPath,
      `${JSON.stringify({ type: "message", message: { role: "assistant", content: [{ type: "text", text: "repair progress" }] } })}\n`,
      "utf8",
    );
    return {
      code: 0,
      stdout: '{"status":"plan-created","planPath":"docs/plans/p.md"}',
      stderr: "",
    };
  });

  const result = await runPiPrompt(runner, "/repo/worktree", "primary prompt", {
    stage: "pi-implementation",
    observeSession: true,
    skillPaths: ["/repo/.patchmill/skills/impl/SKILL.md"],
    extensionArgs: runOnceExtensionArgs,
    onObservation: (observation) => {
      if (observation.type === "text") observations.push(observation.text);
    },
    repair: {
      maxAttempts: 2,
      buildPrompt: ({ attempt, facts }) =>
        `repair attempt ${attempt}: ${facts.unresolvedSummary}`,
    },
  });

  assert.equal(result.status, "plan-created");
  assert.equal(prompts[0], "primary prompt");
  assert.match(
    prompts[1] ?? "",
    /repair attempt 1: 1 unresolved async subagent run/,
  );
  assert.equal(sessions[0], sessions[1]);
  assert.deepEqual(observations, [
    "Final review is running: pm-subagents-abc123.",
    "repair progress",
  ]);
});

test("runPiPrompt does not repair a nonzero Pi exit or an unobserved parse failure", async () => {
  let calls = 0;
  const failed = createMockRunner(() => {
    calls += 1;
    return { code: 1, stdout: "progress", stderr: "boom" };
  });
  await assert.rejects(
    () =>
      runPiPrompt(failed, "/repo", "prompt", {
        stage: "pi-implementation",
        observeSession: true,
        repair: { maxAttempts: 2, buildPrompt: () => "repair" },
      }),
    /pi failed: boom/,
  );
  assert.equal(calls, 1);

  calls = 0;
  const prose = createMockRunner(() => {
    calls += 1;
    return { code: 0, stdout: "progress", stderr: "" };
  });
  await assert.rejects(
    () =>
      runPiPrompt(prose, "/repo", "prompt", {
        stage: "pi-implementation",
        repair: { maxAttempts: 2, buildPrompt: () => "repair" },
      }),
    /supported final JSON status/,
  );
  assert.equal(calls, 1);
});

test("runPiPrompt enriches parse errors after exhausted repair attempts", async () => {
  let calls = 0;
  const runner = createMockRunner(async (call) => {
    calls += 1;
    const sessionPath = call.args[call.args.indexOf("--session") + 1] ?? "";
    await writeFile(
      sessionPath,
      `${JSON.stringify({ type: "message", message: { role: "assistant", content: [{ type: "text", text: "Final review is running: pm-subagents-abc123." }] } })}\n`,
      "utf8",
    );
    return { code: 0, stdout: "Final review is running", stderr: "" };
  });
  await assert.rejects(
    () =>
      runPiPrompt(runner, "/repo", "prompt", {
        stage: "pi-implementation",
        observeSession: true,
        repair: { maxAttempts: 2, buildPrompt: () => "repair" },
      }),
    /Pi repair attempts exhausted after 2 attempts.*no unresolved async subagent runs detected.*Final review is running/s,
  );
  assert.equal(calls, 3);
});

test("runPiPrompt accepts a terminal result on the second repair attempt", async () => {
  let calls = 0;
  const runner = createMockRunner((call) => {
    calls += 1;
    const sessionPath = call.args[call.args.indexOf("--session") + 1] ?? "";
    const stdout =
      calls === 3
        ? '{"status":"plan-created","planPath":"docs/plans/p.md"}'
        : "progress prose";
    return appendFile(
      sessionPath,
      `${JSON.stringify({ type: "message", message: { role: "assistant", content: [{ type: "text", text: stdout }] } })}\n`,
      "utf8",
    ).then(() => ({ code: 0, stdout, stderr: "" }));
  });
  const result = await runPiPrompt(runner, "/repo", "prompt", {
    stage: "pi-implementation",
    observeSession: true,
    repair: {
      maxAttempts: 2,
      buildPrompt: ({ attempt }) => `repair ${attempt}`,
    },
  });
  assert.equal(result.status, "plan-created");
  assert.equal(calls, 3);
});
