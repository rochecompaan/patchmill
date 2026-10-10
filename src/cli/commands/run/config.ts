import { cwd } from "node:process";
import { isAbsolute, join } from "node:path";
import { loadPatchmillConfigState } from "../../../config/load.ts";
import { createCommandRunner } from "../triage/command.ts";
import { loadCliConfig } from "../run-once/main.ts";
import { withRunRecoveryAdmission } from "../run-once/repository-admission.ts";
export type RunStateCommandConfig = { repoRoot: string; runStateDir: string };
export async function withRunStateMutationAdmission<T>(
  config: RunStateCommandConfig,
  issueNumber: number,
  action: () => Promise<T>,
): Promise<T> {
  const runner = createCommandRunner();
  const runtime = await loadCliConfig(
    ["--issue", String(issueNumber)],
    config.repoRoot,
    process.env,
    runner,
  );
  if (runtime.runStateDir !== config.runStateDir)
    throw new Error("Recovery configuration changed before mutation admission");
  return withRunRecoveryAdmission(runner, runtime, issueNumber, async () =>
    action(),
  );
}
/** Read-only lease inspection loads only filesystem configuration. */
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
