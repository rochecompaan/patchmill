import { join } from "node:path";
import type { CommandRunner } from "../../scripts/agent-issue-triage/types.ts";

export type PiHookResult = {
  name: string;
  status: "cleaned" | "failed";
  message: string;
};

function failureMessage(step: string, stderr: string, stdout: string): string {
  const details = (stderr || stdout).trim();
  return details ? `${step}: ${details}` : step;
}

function hookLabel(cleanupHook: string): string {
  return `cleanup hook ${cleanupHook}`;
}

export async function runCleanupHookScript(
  runner: CommandRunner,
  repoRoot: string,
  worktreePath: string | undefined,
  cleanupHook: string | undefined,
): Promise<PiHookResult[]> {
  if (!cleanupHook) return [];

  if (!worktreePath) {
    return [
      {
        status: "failed",
        name: cleanupHook,
        message: `${hookLabel(cleanupHook)}: no worktree path`,
      },
    ];
  }

  const result = await runner.run("bash", [cleanupHook], {
    cwd: join(repoRoot, worktreePath),
  });

  if (result.code !== 0) {
    return [
      {
        status: "failed",
        name: cleanupHook,
        message: failureMessage(
          `${hookLabel(cleanupHook)}: command failed`,
          result.stderr,
          result.stdout,
        ),
      },
    ];
  }

  return [
    {
      status: "cleaned",
      name: cleanupHook,
      message: `${hookLabel(cleanupHook)}: completed for ${worktreePath}`,
    },
  ];
}
