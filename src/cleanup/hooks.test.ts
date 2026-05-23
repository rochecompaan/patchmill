import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";
import test from "node:test";
import { runCleanupHooks } from "./hooks.ts";
import type { CleanupHookConfig } from "./types.ts";

type RecordedCall = {
  command: string;
  args: string[];
  cwd?: string;
};

type CommandResult = {
  code: number;
  stdout: string;
  stderr: string;
};

function recordingRunner(results: CommandResult[] = []): {
  runner: {
    run(command: string, args: string[], options?: { cwd?: string }): Promise<CommandResult>;
  };
  calls: RecordedCall[];
} {
  const calls: RecordedCall[] = [];
  let resultIndex = 0;

  return {
    calls,
    runner: {
      async run(command, args, options = {}) {
        calls.push({ command, args, cwd: options.cwd });
        const result = results[resultIndex] ?? { code: 0, stdout: "", stderr: "" };
        resultIndex += 1;
        return result;
      },
    },
  };
}

test("runCleanupHooks is a no-op when no cleanup hooks are configured", async () => {
  const repoRoot = await mkdtemp(join(tmpdir(), "patchmill-cleanup-hooks-"));
  const { runner, calls } = recordingRunner();

  const result = await runCleanupHooks(runner, repoRoot, ".worktrees/issue-45", []);

  assert.deepEqual(result, []);
  assert.deepEqual(calls, []);
});

test("runCleanupHooks skips hooks whose probe path is missing", async () => {
  const repoRoot = await mkdtemp(join(tmpdir(), "patchmill-cleanup-hooks-"));
  const worktreePath = ".worktrees/issue-45";
  await mkdir(join(repoRoot, worktreePath), { recursive: true });
  const { runner, calls } = recordingRunner();
  const hooks: CleanupHookConfig[] = [
    {
      name: "custom-cleanup",
      whenPathExists: ".env",
      command: "just",
      args: ["cleanup"],
    },
  ];

  const [result] = await runCleanupHooks(runner, repoRoot, worktreePath, hooks);

  assert.equal(result?.name, "custom-cleanup");
  assert.equal(result?.status, "skipped");
  assert.match(result?.message ?? "", /custom-cleanup/);
  assert.equal(calls.length, 0);
});

test("runCleanupHooks runs generic command hooks from the worktree root", async () => {
  const repoRoot = await mkdtemp(join(tmpdir(), "patchmill-cleanup-hooks-"));
  const worktreePath = ".worktrees/issue-45";
  const worktreeRoot = join(repoRoot, worktreePath);
  await mkdir(worktreeRoot, { recursive: true });
  await writeFile(join(worktreeRoot, ".env"), "READY=1\n", "utf8");
  const { runner, calls } = recordingRunner();
  const hooks: CleanupHookConfig[] = [
    {
      name: "custom-cleanup",
      whenPathExists: ".env",
      command: "just",
      args: ["cleanup"],
    },
  ];

  const [result] = await runCleanupHooks(runner, repoRoot, worktreePath, hooks);

  assert.equal(result?.name, "custom-cleanup");
  assert.equal(result?.status, "cleaned");
  assert.match(result?.message ?? "", /custom-cleanup/);
  assert.deepEqual(calls, [{ command: "just", args: ["cleanup"], cwd: worktreeRoot }]);
});

test("runCleanupHooks runs terminate-pattern cleanup before the hook command", async () => {
  const repoRoot = await mkdtemp(join(tmpdir(), "patchmill-cleanup-hooks-"));
  const worktreePath = ".worktrees/issue-45";
  const worktreeRoot = join(repoRoot, worktreePath);
  await mkdir(worktreeRoot, { recursive: true });
  await writeFile(join(worktreeRoot, ".env"), "READY=1\n", "utf8");
  const { runner, calls } = recordingRunner();
  const hooks: CleanupHookConfig[] = [
    {
      name: "custom-cleanup",
      whenPathExists: ".env",
      terminateProcessPatterns: ["tilt up"],
      command: "just",
      args: ["cleanup"],
    },
  ];

  const [result] = await runCleanupHooks(runner, repoRoot, worktreePath, hooks);

  assert.equal(result?.name, "custom-cleanup");
  assert.equal(result?.status, "cleaned");
  assert.equal(calls[0]?.command, "bash");
  assert.equal(calls[0]?.args[0], "-c");
  assert.equal(calls[0]?.args[2], "custom-cleanup");
  assert.equal(calls[0]?.args[3], worktreeRoot);
  assert.deepEqual(calls[1], { command: "just", args: ["cleanup"], cwd: worktreeRoot });
});

test("runCleanupHooks reports process cleanup failures with hook context", async () => {
  const repoRoot = await mkdtemp(join(tmpdir(), "patchmill-cleanup-hooks-"));
  const worktreePath = ".worktrees/issue-45";
  const worktreeRoot = join(repoRoot, worktreePath);
  await mkdir(worktreeRoot, { recursive: true });
  await writeFile(join(worktreeRoot, ".env"), "READY=1\n", "utf8");
  const { runner, calls } = recordingRunner([
    {
      code: 1,
      stdout: "",
      stderr: "Refusing to terminate process group 4321 for cleanup hook custom-cleanup because it matches the current cleanup shell process group",
    },
  ]);
  const hooks: CleanupHookConfig[] = [
    {
      name: "custom-cleanup",
      whenPathExists: ".env",
      terminateProcessPatterns: ["tilt up"],
      command: "just",
      args: ["cleanup"],
    },
  ];

  const [result] = await runCleanupHooks(runner, repoRoot, worktreePath, hooks);

  assert.equal(result?.name, "custom-cleanup");
  assert.equal(result?.status, "failed");
  assert.match(result?.message ?? "", /cleanup hook custom-cleanup: process cleanup failed/);
  assert.match(result?.message ?? "", /Refusing to terminate process group 4321/);
  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.command, "bash");
});
