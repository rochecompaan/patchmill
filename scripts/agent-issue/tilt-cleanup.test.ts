import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";
import test from "node:test";
import { runCleanupHooks } from "../../src/cleanup/hooks.ts";
import { TILT_JUST_CLEANUP_HOOK } from "./tilt-cleanup.ts";
import type { CommandRunOptions, CommandRunner, CommandResult } from "./types.ts";

type RecordedCall = {
  command: string;
  args: string[];
  cwd?: string;
};

function recordingRunner(): { runner: CommandRunner; calls: RecordedCall[] } {
  const calls: RecordedCall[] = [];
  const runner: CommandRunner = {
    async run(
      command: string,
      args: string[],
      options: CommandRunOptions = {},
    ): Promise<CommandResult> {
      calls.push({ command, args, cwd: options.cwd });
      return { code: 0, stdout: "", stderr: "" };
    },
  };
  return { runner, calls };
}

test("tilt-just cleanup hook runs process cleanup in a non-login shell", async () => {
  const repoRoot = await mkdtemp(join(tmpdir(), "agent-issue-tilt-cleanup-"));
  const worktreePath = ".worktrees/agent-issue-45-cleanup-tilt";
  const worktreeRoot = join(repoRoot, worktreePath);
  await mkdir(worktreeRoot, { recursive: true });
  await writeFile(join(worktreeRoot, ".env"), "TILT_PORT=10385\n", "utf8");

  const { runner, calls } = recordingRunner();

  const [result] = await runCleanupHooks(runner, repoRoot, worktreePath, [TILT_JUST_CLEANUP_HOOK]);

  assert.equal(result?.name, "tilt-just");
  assert.equal(result?.status, "cleaned");
  assert.equal(calls[0]?.command, "bash");
  assert.equal(calls[0]?.args[0], "-c");
  assert.equal(calls[0]?.cwd, repoRoot);
  assert.match(calls[0]?.args[1] ?? "", /current_pgid="\$\(ps -o pgid= -p "\$\$"/);
  assert.match(calls[0]?.args[1] ?? "", /Refusing to terminate process group \$pgid/);
  assert.equal(calls[0]?.args[2], "tilt-just");
  assert.equal(calls[0]?.args[3], worktreeRoot);
});
