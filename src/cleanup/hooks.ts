import { access } from "node:fs/promises";
import { join } from "node:path";
import type { CleanupHookConfig, CleanupHookResult } from "./types.ts";

type CommandResult = {
  code: number;
  stdout: string;
  stderr: string;
};

type CommandRunner = {
  run(
    command: string,
    args: string[],
    options?: { cwd?: string },
  ): Promise<CommandResult>;
};

const TERMINATE_PROCESSES_BY_CWD_AND_PATTERN_SCRIPT = String.raw`set -euo pipefail
target="$(cd "$1" && pwd -P)"
shift
current_pgid="$(ps -o pgid= -p "$$" | tr -d ' ')"
pgids="$({
  ps -eo pid=,args= | while read -r pid args; do
    matched=0
    for pattern in "$@"; do
      case "$args" in
        *"$pattern"*) matched=1; break ;;
      esac
    done
    if [ "$matched" -ne 1 ]; then
      continue
    fi
    cwd="$(readlink "/proc/$pid/cwd" 2>/dev/null || true)"
    if [ "$cwd" = "$target" ]; then
      ps -o pgid= -p "$pid" | tr -d ' '
    fi
  done
} | sort -u)"
if [ -z "$pgids" ]; then
  exit 0
fi
for pgid in $pgids; do
  if [ "$pgid" = "$current_pgid" ]; then
    echo "Refusing to terminate process group $pgid for cleanup hook $0 because it matches the current cleanup shell process group" >&2
    exit 1
  fi
done
for pgid in $pgids; do
  kill -TERM -- "-$pgid" 2>/dev/null || true
done
sleep 2
for pgid in $pgids; do
  if ps -o pid= -g "$pgid" >/dev/null 2>&1; then
    kill -KILL -- "-$pgid" 2>/dev/null || true
  fi
done
`;

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function failureMessage(step: string, stderr: string, stdout: string): string {
  const details = (stderr || stdout).trim();
  return details ? `${step}: ${details}` : step;
}

function hookLabel(hook: CleanupHookConfig): string {
  return `cleanup hook ${hook.name}`;
}

function skippedNoWorktree(hook: CleanupHookConfig): CleanupHookResult {
  return { status: "skipped", name: hook.name, message: `${hookLabel(hook)}: no worktree path` };
}

function skippedMissingPath(hook: CleanupHookConfig): CleanupHookResult {
  return {
    status: "skipped",
    name: hook.name,
    message: `${hookLabel(hook)}: ${hook.whenPathExists} not found`,
  };
}

function cleanedMessage(hook: CleanupHookConfig, worktreePath: string): string {
  return `${hookLabel(hook)}: completed for ${worktreePath}`;
}

async function terminateMatchingProcesses(
  runner: CommandRunner,
  repoRoot: string,
  worktreeRoot: string,
  patterns: string[],
  hook: CleanupHookConfig,
): Promise<CleanupHookResult | undefined> {
  if (patterns.length === 0) return undefined;

  const result = await runner.run(
    "bash",
    ["-c", TERMINATE_PROCESSES_BY_CWD_AND_PATTERN_SCRIPT, hook.name, worktreeRoot, ...patterns],
    { cwd: repoRoot },
  );
  if (result.code === 0) return undefined;

  return {
    status: "failed",
    name: hook.name,
    message: failureMessage(`${hookLabel(hook)}: process cleanup failed`, result.stderr, result.stdout),
  };
}

async function runHookCommand(
  runner: CommandRunner,
  worktreeRoot: string,
  hook: CleanupHookConfig,
): Promise<CleanupHookResult | undefined> {
  if (!hook.command) return undefined;

  const result = await runner.run(hook.command, hook.args ?? [], { cwd: worktreeRoot });
  if (result.code === 0) return undefined;

  return {
    status: "failed",
    name: hook.name,
    message: failureMessage(`${hookLabel(hook)}: command failed`, result.stderr, result.stdout),
  };
}

async function runCleanupHook(
  runner: CommandRunner,
  repoRoot: string,
  worktreePath: string | undefined,
  hook: CleanupHookConfig,
): Promise<CleanupHookResult> {
  if (!worktreePath) return skippedNoWorktree(hook);

  const worktreeRoot = join(repoRoot, worktreePath);
  if (hook.whenPathExists && !(await pathExists(join(worktreeRoot, hook.whenPathExists)))) {
    return skippedMissingPath(hook);
  }

  const terminateFailure = await terminateMatchingProcesses(
    runner,
    repoRoot,
    worktreeRoot,
    hook.terminateProcessPatterns ?? [],
    hook,
  );
  if (terminateFailure) return terminateFailure;

  const commandFailure = await runHookCommand(runner, worktreeRoot, hook);
  if (commandFailure) return commandFailure;

  return {
    status: "cleaned",
    name: hook.name,
    message: cleanedMessage(hook, worktreePath),
  };
}

export async function runCleanupHooks(
  runner: CommandRunner,
  repoRoot: string,
  worktreePath: string | undefined,
  hooks: CleanupHookConfig[],
): Promise<CleanupHookResult[]> {
  const results: CleanupHookResult[] = [];
  for (const hook of hooks) {
    results.push(await runCleanupHook(runner, repoRoot, worktreePath, hook));
  }
  return results;
}
