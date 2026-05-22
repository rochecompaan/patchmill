import { access } from "node:fs/promises";
import { join } from "node:path";
import type { CommandRunner } from "./types.ts";

export type TiltCleanupResult =
  | { status: "skipped"; message: string }
  | { status: "cleaned"; message: string }
  | { status: "failed"; message: string };

const TERMINATE_TILT_BY_CWD_SCRIPT = String.raw`set -euo pipefail
target="$(cd "$0" && pwd -P)"
pgids="$({
  ps -eo pid=,args= | while read -r pid args; do
    case "$args" in
      *"tilt up"*|*"just tilt-up"*) ;;
      *) continue ;;
    esac
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
  kill -TERM -- "-$pgid" 2>/dev/null || true
done
sleep 2
for pgid in $pgids; do
  if ps -o pid= -g "$pgid" >/dev/null 2>&1; then
    kill -KILL -- "-$pgid" 2>/dev/null || true
  fi
done
`;

async function hasTiltEnv(worktreeRoot: string): Promise<boolean> {
  try {
    await access(join(worktreeRoot, ".env"));
    return true;
  } catch {
    return false;
  }
}

function failureMessage(step: string, stderr: string, stdout: string): string {
  const details = (stderr || stdout).trim();
  return details ? `${step}: ${details}` : step;
}

export async function cleanupIssueTilt(
  runner: CommandRunner,
  repoRoot: string,
  worktreePath: string | undefined,
): Promise<TiltCleanupResult> {
  if (!worktreePath) {
    return { status: "skipped", message: "skipped Tilt cleanup: no worktree path" };
  }

  const worktreeRoot = join(repoRoot, worktreePath);
  if (!(await hasTiltEnv(worktreeRoot))) {
    return { status: "skipped", message: "skipped Tilt cleanup: worktree has no .env" };
  }

  const stopResult = await runner.run(
    "bash",
    ["-c", TERMINATE_TILT_BY_CWD_SCRIPT, worktreeRoot],
    { cwd: repoRoot },
  );
  if (stopResult.code !== 0) {
    return {
      status: "failed",
      message: failureMessage("Tilt process cleanup failed", stopResult.stderr, stopResult.stdout),
    };
  }

  const downResult = await runner.run("just", ["tilt-down"], { cwd: worktreeRoot });
  if (downResult.code !== 0) {
    return {
      status: "failed",
      message: failureMessage("Tilt namespace cleanup failed", downResult.stderr, downResult.stdout),
    };
  }

  return { status: "cleaned", message: `stopped Tilt and removed namespace for ${worktreePath}` };
}
