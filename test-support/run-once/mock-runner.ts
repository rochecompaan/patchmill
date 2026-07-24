import assert from "node:assert/strict";
import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type {
  CommandRunner,
  CommandResult,
} from "../../src/cli/commands/run-once/types.ts";
import { gitBaseContainmentResult } from "./assertions.ts";

export type Call = {
  command: string;
  args: string[];
  cwd?: string;
  env?: Record<string, string | undefined>;
  onStdout?: (chunk: string) => void;
  onStderr?: (chunk: string) => void;
};

export type MockRunner = CommandRunner & { calls: Call[] };

export function normalizeRecordedPiCall(call: Call): Call {
  if (
    call.command === process.execPath &&
    /@earendil-works[/\\]pi-coding-agent[/\\]dist[/\\]cli\.js$/.test(
      call.args[0] ?? "",
    )
  ) {
    return { ...call, command: "pi", args: call.args.slice(1) };
  }
  return call;
}

export function workflowPiCalls(calls: Call[]): Call[] {
  return calls.filter((call) => call.command === "pi");
}

function defaultGitPreflightResult(call: Call): CommandResult | undefined {
  if (call.command === "git" && call.args[0] === "cat-file") {
    return { code: 0, stdout: "", stderr: "" };
  }
  if (
    call.command === "git" &&
    call.args[0] === "worktree" &&
    call.args[1] === "list"
  ) {
    return { code: 0, stdout: "", stderr: "" };
  }
  if (call.command === "git" && call.args[0] === "show-ref") {
    return { code: 1, stdout: "", stderr: "" };
  }
  if (
    call.command === "git" &&
    call.args[0] === "worktree" &&
    call.args[1] === "add"
  ) {
    return { code: 0, stdout: "", stderr: "" };
  }
  return undefined;
}

export function createMockRunner(
  handler: (call: Call) => Promise<CommandResult> | CommandResult,
): MockRunner {
  const calls: Call[] = [];
  return {
    calls,
    async run(command, args, options = {}) {
      const call = normalizeRecordedPiCall({
        command,
        args: [...args],
        cwd: options.cwd,
        ...(options.env ? { env: options.env } : {}),
        onStdout: options.onStdout,
        onStderr: options.onStderr,
      });
      calls.push(call);
      if (call.command === "pi") {
        try {
          return await normalizePiResult(call, await handler(call));
        } catch (error) {
          const fallback = await fallbackPiResultForError(call);
          if (fallback) return fallback;
          throw error;
        }
      }
      const baseContainment = gitBaseContainmentResult(call);
      if (baseContainment) {
        try {
          const result = await handler(call);
          if (result.stdout.includes("abc1234 chore: initialize Patchmill")) {
            return result;
          }
        } catch {
          // Most existing tests predate this preflight and throw on the new git
          // commands. Treat those as a clean base unless a test explicitly
          // returns the unsafe marker above.
        }
        return baseContainment;
      }
      try {
        return await handler(call);
      } catch (error) {
        const gitFallback = defaultGitPreflightResult(call);
        if (
          gitFallback &&
          error instanceof Error &&
          /^unexpected command:/u.test(error.message)
        ) {
          return gitFallback;
        }
        throw error;
      }
    },
  };
}

export function promptPath(args: string[]): string {
  const promptArg = args.find((arg) => arg.startsWith("@"));
  assert.ok(promptArg, `expected prompt path in ${args.join(" ")}`);
  return promptArg.slice(1);
}

export function jsonStatus(stdout: string): string | undefined {
  return stdout.match(/"status"\s*:\s*"([^"]+)"/)?.[1];
}

export function promptJsonPath(
  prompt: string,
  key: "specPath" | "planPath",
): string {
  const match = prompt.match(new RegExp(`"${key}"\\s*:\\s*"([^"]+)"`));
  assert.ok(match?.[1], `expected ${key} in prompt`);
  return match[1];
}

export function defaultWorkflowPromptResult(
  prompt: string,
): CommandResult | undefined {
  if (/Create a design spec/.test(prompt)) {
    return {
      code: 0,
      stdout: JSON.stringify({
        status: "spec-created",
        specPath: promptJsonPath(prompt, "specPath"),
        commit: "spec123",
      }),
      stderr: "",
    };
  }

  if (/Create an implementation plan/.test(prompt)) {
    return {
      code: 0,
      stdout: JSON.stringify({
        status: "plan-created",
        planPath: promptJsonPath(prompt, "planPath"),
        commit: "abc123",
      }),
      stderr: "",
    };
  }

  return undefined;
}

export async function normalizePiResult(
  call: Call,
  result: CommandResult,
): Promise<CommandResult> {
  const prompt = await readFile(promptPath(call.args), "utf8");
  const fallback = defaultWorkflowPromptResult(prompt);
  if (!fallback) return result;

  if (result.code !== 0) return result;

  const status = jsonStatus(result.stdout);
  if (status === "blocked") return result;
  if (/Create a design spec/.test(prompt)) {
    return status === "spec-created" ? result : fallback;
  }
  if (/Create an implementation plan/.test(prompt)) {
    return status === "plan-created" ? result : fallback;
  }

  return result;
}

export async function fallbackPiResultForError(
  call: Call,
): Promise<CommandResult | undefined> {
  const prompt = await readFile(promptPath(call.args), "utf8");
  return defaultWorkflowPromptResult(prompt);
}

export async function writePiSessionMessage(
  call: Call,
  text: string,
  usage?: { input: number; output: number; totalTokens: number },
): Promise<void> {
  const sessionDirIndex = call.args.indexOf("--session-dir");
  assert.ok(
    sessionDirIndex >= 0,
    `expected --session-dir in ${call.args.join(" ")}`,
  );
  const sessionDir = call.args[sessionDirIndex + 1];
  assert.ok(sessionDir);
  const sessionSubdir = join(sessionDir, "--repo--");
  await mkdir(sessionSubdir, { recursive: true });
  await writeFile(
    join(sessionSubdir, "session.jsonl"),
    [
      JSON.stringify({
        type: "session",
        version: 3,
        id: "session-1",
        cwd: call.cwd,
      }),
      JSON.stringify({
        type: "message",
        id: "assistant-1",
        parentId: null,
        timestamp: "2026-05-09T12:00:00.000Z",
        message: {
          role: "assistant",
          content: [{ type: "text", text }],
          usage,
        },
      }),
    ].join("\n") + "\n",
    "utf8",
  );
}

export async function writePiPricedSessionMessage(
  call: Call,
  input: {
    id: string;
    model: string;
    input: number;
    cacheRead: number;
    cacheWrite: number;
    output: number;
    estimatedCostUsd: number;
  },
): Promise<void> {
  const sessionDirIndex = call.args.indexOf("--session-dir");
  assert.ok(
    sessionDirIndex >= 0,
    `expected --session-dir in ${call.args.join(" ")}`,
  );
  const sessionDir = call.args[sessionDirIndex + 1];
  assert.ok(sessionDir);
  const sessionSubdir = join(sessionDir, "--repo--");
  await mkdir(sessionSubdir, { recursive: true });
  await writeFile(
    join(sessionSubdir, "priced-session.jsonl"),
    `${JSON.stringify({ type: "session", id: "session-priced", timestamp: "2026-07-19T12:00:00.000Z" })}\n${JSON.stringify({ type: "message", id: input.id, message: { role: "assistant", model: input.model, usage: { input: input.input, cacheRead: input.cacheRead, cacheWrite: input.cacheWrite, output: input.output, cost: { total: input.estimatedCostUsd } } } })}\n`,
    "utf8",
  );
}

export async function piSessionPath(call: Call): Promise<string> {
  const sessionDirIndex = call.args.indexOf("--session-dir");
  assert.ok(
    sessionDirIndex >= 0,
    `expected --session-dir in ${call.args.join(" ")}`,
  );
  const sessionDir = call.args[sessionDirIndex + 1];
  assert.ok(sessionDir);
  const sessionSubdir = join(sessionDir, "--repo--");
  await mkdir(sessionSubdir, { recursive: true });
  return join(sessionSubdir, "session.jsonl");
}

export async function appendPiSessionEntry(
  call: Call,
  entry: unknown,
): Promise<void> {
  await appendFile(
    await piSessionPath(call),
    `${JSON.stringify(entry)}\n`,
    "utf8",
  );
}

export async function initializePiSession(call: Call): Promise<void> {
  await writeFile(
    await piSessionPath(call),
    `${JSON.stringify({ type: "session", version: 3, id: "session-1", cwd: call.cwd })}\n`,
    "utf8",
  );
}

export function assistantToolCall(
  toolCallId: string,
  toolName: string,
  args: Record<string, unknown>,
): unknown {
  return {
    type: "message",
    id: `assistant-${toolCallId}`,
    parentId: null,
    timestamp: "2026-05-09T12:00:00.000Z",
    message: {
      role: "assistant",
      content: [
        { type: "toolCall", id: toolCallId, name: toolName, arguments: args },
      ],
    },
  };
}

export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function waitForCondition(
  condition: () => boolean,
  failureMessage: () => string,
  timeoutMs = 1_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (condition()) return;
    await delay(5);
  }
  assert.ok(condition(), failureMessage());
}
