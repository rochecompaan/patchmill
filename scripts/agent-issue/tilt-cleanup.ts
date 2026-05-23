import {
  runCleanupHooks,
  TILT_JUST_CLEANUP_HOOK,
} from "../../src/cleanup/hooks.ts";
import type { CleanupHookResult } from "../../src/cleanup/types.ts";
import type { CommandRunner } from "./types.ts";

export { TILT_JUST_CLEANUP_HOOK };

export type TiltCleanupResult = CleanupHookResult;

export async function cleanupIssueTilt(
  runner: CommandRunner,
  repoRoot: string,
  worktreePath: string | undefined,
): Promise<TiltCleanupResult> {
  const [result] = await runCleanupHooks(runner, repoRoot, worktreePath, [TILT_JUST_CLEANUP_HOOK]);
  return result!;
}
