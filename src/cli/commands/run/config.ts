import { cwd } from "node:process";
import { isAbsolute, join } from "node:path";
import { loadPatchmillConfigState } from "../../../config/load.ts";
export type RunStateCommandConfig = { repoRoot: string; runStateDir: string };
/** Loads only filesystem configuration: lease repair intentionally has no Git or host boundary. */
export async function loadRunStateCommandConfig(
  _args: string[],
  repoRoot = cwd(),
  env = process.env,
): Promise<RunStateCommandConfig> {
  const { config } = await loadPatchmillConfigState(repoRoot, env, _args);
  const configured = config.paths.runStateDir;
  return {
    repoRoot,
    runStateDir: configured
      ? isAbsolute(configured)
        ? configured
        : join(repoRoot, configured)
      : join(repoRoot, ".patchmill", "runs"),
  };
}
