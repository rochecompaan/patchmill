import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_PI_TASK_CONTRACT } from "../../src/policy/task-contract.ts";
import { parsePiResult, runPiPrompt } from "./pi.ts";
import {
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
  onStdout?: (chunk: string) => void;
  onStderr?: (chunk: string) => void;
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
        onStdout: options.onStdout,
        onStderr: options.onStderr,
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

function promptPath(args: string[]): string {
  const promptArg = args.find((arg) => arg.startsWith("@"));
  assert.ok(promptArg, `expected prompt path in ${args.join(" ")}`);
  return promptArg.slice(1);
}

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

test("parsePiResult extracts a supported status from fenced JSON output", () => {
  const result = parsePiResult(`planning complete\n\n\`\`\`json
{"status":"plan-created","planPath":"docs/plans/plan.md","commit":"abc123"}
\`\`\``);

  assert.deepEqual(result, {
    status: "plan-created",
    planPath: "docs/plans/plan.md",
    commit: "abc123",
  });
});

test("parsePiResult extracts a merged implementation result", () => {
  const result = parsePiResult(
    'done\n{"status":"merged","branch":"agent/issue-42-add-once-runner-helpers","mergeCommit":"abc123","commits":["def456"],"validation":["just issue-runner-test ok"],"reviewSummary":"reviewed","landingDecision":"direct squash-landed: simple localized bug fix"}',
  );

  assert.deepEqual(result, {
    status: "merged",
    branch: "agent/issue-42-add-once-runner-helpers",
    mergeCommit: "abc123",
    commits: ["def456"],
    validation: ["just issue-runner-test ok"],
    reviewSummary: "reviewed",
    landingDecision: "direct squash-landed: simple localized bug fix",
  });
});

test("parsePiResult extracts visual evidence from a pr-created result", () => {
  const result = parsePiResult(
    'done\n{"status":"pr-created","prUrl":"https://forgejo.example/pulls/42","branch":"agent/issue-42-dashboard","commits":["def456"],"validation":["just playwright-test ok"],"visualEvidence":[{"screenshotPath":".tmp/issue-42-dashboard.png","caption":"Dashboard after selecting last 8 weeks","referencePaths":["docs/visual-baselines/web/01-dashboard.png"]}]}',
  );

  assert.deepEqual(result, {
    status: "pr-created",
    prUrl: "https://forgejo.example/pulls/42",
    branch: "agent/issue-42-dashboard",
    commits: ["def456"],
    validation: ["just playwright-test ok"],
    reviewSummary: undefined,
    landingDecision: undefined,
    visualEvidence: [
      {
        screenshotPath: ".tmp/issue-42-dashboard.png",
        caption: "Dashboard after selecting last 8 weeks",
        referencePaths: ["docs/visual-baselines/web/01-dashboard.png"],
      },
    ],
  });
});

test("parsePiResult rejects malformed fenced JSON when no supported final object exists", () => {
  assert.throws(
    () =>
      parsePiResult(`\`\`\`json
{"status":"plan-created","planPath":"docs/plans/plan.md"
\`\`\``),
    /supported final JSON status|final JSON object/,
  );
});

test("parsePiResult rejects unsupported final JSON statuses", () => {
  assert.throws(
    () => parsePiResult('{"status":"unknown"}'),
    /supported final JSON status/,
  );
});

test("runPiPrompt writes the prompt to a temp file and surfaces nonzero pi failures", async () => {
  const runner = createMockRunner(async (call) => {
    assert.equal(call.command, "pi");
    assert.equal(call.cwd, "/repo/worktree");
    const prompt = await readFile(promptPath(call.args), "utf8");
    assert.equal(prompt, "prompt body");
    return { code: 9, stdout: "", stderr: "pi exploded" };
  });

  await assert.rejects(
    () => runPiPrompt(runner, "/repo/worktree", "prompt body"),
    /pi failed: pi exploded/,
  );
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
    assert.equal(call.args[0], "-p");
    assert.equal(call.args.includes("--mode"), false);
    const sessionDirIndex = call.args.indexOf("--session-dir");
    assert.ok(
      sessionDirIndex >= 0,
      `expected --session-dir in ${call.args.join(" ")}`,
    );
    const sessionDir = call.args[sessionDirIndex + 1];
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

test("runPiPrompt emits structured observations and suppresses raw text unless streamOutput is provided", async () => {
  const observations: Array<{
    type: string;
    outputTokens?: number;
    toolName?: string;
    text?: string;
  }> = [];
  const streamed: string[] = [];
  const runner = createMockRunner(async (call) => {
    const sessionDirIndex = call.args.indexOf("--session-dir");
    assert.ok(
      sessionDirIndex >= 0,
      `expected --session-dir in ${call.args.join(" ")}`,
    );
    const sessionDir = call.args[sessionDirIndex + 1];
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
    const sessionDirIndex = call.args.indexOf("--session-dir");
    assert.ok(sessionDirIndex >= 0);
    const sessionDir = call.args[sessionDirIndex + 1];
    assert.ok(sessionDir);
    await mkdir(join(sessionDir, "--repo--"), { recursive: true });
    await writeFile(
      join(sessionDir, "--repo--", "session.jsonl"),
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
    const sessionDirIndex = call.args.indexOf("--session-dir");
    assert.ok(sessionDirIndex >= 0);
    const sessionDir = call.args[sessionDirIndex + 1];
    assert.ok(sessionDir);
    await mkdir(join(sessionDir, "--repo--"), { recursive: true });
    await writeFile(
      join(sessionDir, "--repo--", "session.jsonl"),
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
