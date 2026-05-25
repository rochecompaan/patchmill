import { mkdtemp, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";
import test from "node:test";
import { runCleanupHookScript } from "./hooks.ts";

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
    run(
      command: string,
      args: string[],
      options?: { cwd?: string },
    ): Promise<CommandResult>;
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
        const result = results[resultIndex] ?? {
          code: 0,
          stdout: "",
          stderr: "",
        };
        resultIndex += 1;
        return result;
      },
    },
  };
}

test("runCleanupHookScript is a no-op when no cleanup hook is configured", async () => {
  const repoRoot = await mkdtemp(join(tmpdir(), "patchmill-pi-hooks-"));
  const { runner, calls } = recordingRunner();

  const result = await runCleanupHookScript(
    runner,
    repoRoot,
    ".worktrees/issue-45",
    undefined,
  );

  assert.deepEqual(result, []);
  assert.deepEqual(calls, []);
});

test("runCleanupHookScript runs the configured shell script from the worktree root", async () => {
  const repoRoot = await mkdtemp(join(tmpdir(), "patchmill-pi-hooks-"));
  const worktreePath = ".worktrees/patchmill-issue-45-cleanup-example";
  const worktreeRoot = join(repoRoot, worktreePath);
  await mkdir(worktreeRoot, { recursive: true });
  const { runner, calls } = recordingRunner();

  const [result] = await runCleanupHookScript(
    runner,
    repoRoot,
    worktreePath,
    "./scripts/cleanup.sh",
  );

  assert.equal(result?.name, "./scripts/cleanup.sh");
  assert.equal(result?.status, "cleaned");
  assert.equal(
    result?.message,
    "cleanup hook ./scripts/cleanup.sh: completed for .worktrees/patchmill-issue-45-cleanup-example",
  );
  assert.deepEqual(calls, [
    { command: "bash", args: ["./scripts/cleanup.sh"], cwd: worktreeRoot },
  ]);
});

test("runCleanupHookScript reports script failures with hook context", async () => {
  const repoRoot = await mkdtemp(join(tmpdir(), "patchmill-pi-hooks-"));
  const worktreePath = ".worktrees/patchmill-issue-45-cleanup-example";
  await mkdir(join(repoRoot, worktreePath), { recursive: true });
  const { runner, calls } = recordingRunner([
    {
      code: 1,
      stdout: "",
      stderr: "cleanup refused: missing .env",
    },
  ]);

  const [result] = await runCleanupHookScript(
    runner,
    repoRoot,
    worktreePath,
    "./scripts/cleanup.sh",
  );

  assert.equal(result?.name, "./scripts/cleanup.sh");
  assert.equal(result?.status, "failed");
  assert.equal(
    result?.message,
    "cleanup hook ./scripts/cleanup.sh: command failed: cleanup refused: missing .env",
  );
  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.command, "bash");
});

test("runCleanupHookScript reports a configured hook without a worktree path as failed", async () => {
  const repoRoot = await mkdtemp(join(tmpdir(), "patchmill-pi-hooks-"));
  const { runner, calls } = recordingRunner();

  const [result] = await runCleanupHookScript(
    runner,
    repoRoot,
    undefined,
    "./scripts/cleanup.sh",
  );

  assert.equal(result?.name, "./scripts/cleanup.sh");
  assert.equal(result?.status, "failed");
  assert.equal(
    result?.message,
    "cleanup hook ./scripts/cleanup.sh: no worktree path",
  );
  assert.deepEqual(calls, []);
});
