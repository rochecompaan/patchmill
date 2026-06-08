import { cwd } from "node:process";
import { join } from "node:path";
import { DEFAULT_PATCHMILL_CONFIG } from "../../../config/defaults.ts";
import { createTriagePolicy } from "../../../policy/triage.ts";
import type { PatchmillConfig } from "../../../config/types.ts";
import type { AgentIssueConfig } from "./types.ts";

type Env = Record<string, string | undefined>;

function requireValue(args: string[], index: number, flag: string): string {
  const value = args[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`${flag} requires a value`);
  }
  return value;
}

function parsePositiveInteger(flag: string, value: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${flag} must be a positive integer`);
  }
  return parsed;
}

function hostConfig(
  env: Env,
  normalizedConfig: PatchmillConfig,
): PatchmillConfig["host"] {
  return {
    ...normalizedConfig.host,
    login: env.PATCHMILL_HOST_LOGIN ?? normalizedConfig.host.login,
  };
}

export function parseArgs(
  args: string[],
  repoRoot = cwd(),
  env: Env = process.env,
  normalizedConfig?: PatchmillConfig,
): AgentIssueConfig {
  const patchmillConfig = normalizedConfig ?? DEFAULT_PATCHMILL_CONFIG;
  const host = hostConfig(env, patchmillConfig);
  const projectPolicy = patchmillConfig.projectPolicy;
  const config: AgentIssueConfig = {
    repoRoot,
    dryRun: false,
    execute: true,
    showHelp: false,
    planOnly: false,
    host,
    teaLogin: host.login,
    plansDir:
      normalizedConfig?.paths.plansDir ??
      join(repoRoot, patchmillConfig.paths.plansDir),
    runStateDir:
      normalizedConfig?.paths.runStateDir ??
      join(repoRoot, patchmillConfig.paths.runStateDir),
    worktreeDir:
      normalizedConfig?.paths.worktreeDir ??
      join(repoRoot, patchmillConfig.paths.worktreeDir),
    cleanStatusIgnorePrefixes: [
      ...patchmillConfig.paths.cleanStatusIgnorePrefixes,
    ],
    ...(patchmillConfig.cleanupHook !== undefined
      ? { cleanupHook: patchmillConfig.cleanupHook }
      : {}),
    projectPolicy,
    skills: patchmillConfig.skills,
    triagePolicy: createTriagePolicy(
      patchmillConfig.labels,
      patchmillConfig.triage,
    ),
    readyLabel: patchmillConfig.labels.ready,
    issueLimit: 1,
    requirePlanApproval: projectPolicy.planRequiresApproval,
    baseBranch: patchmillConfig.git.baseBranch,
    baseRef: patchmillConfig.git.baseRef,
    remote: patchmillConfig.git.remote,
    branchPrefix: patchmillConfig.git.branchPrefix,
    worktreePrefix: patchmillConfig.git.worktreePrefix,
    slugLength: patchmillConfig.git.slugLength,
    allowDirectLand: patchmillConfig.git.allowDirectLand,
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--help" || arg === "-h") {
      config.showHelp = true;
    } else if (arg === "--dry-run" || arg === "--dryrun") {
      config.dryRun = true;
      config.execute = false;
    } else if (arg === "--quiet") {
      config.quiet = true;
    } else if (arg === "--verbose-pi-output") {
      config.verbosePiOutput = true;
    } else if (arg === "--issue") {
      config.issueNumber = parsePositiveInteger(
        arg,
        requireValue(args, index, arg),
      );
      index += 1;
    } else if (arg === "--plan-only") {
      config.planOnly = true;
    } else if (arg === "--tea-login" || arg === "--host-login") {
      config.host.login = requireValue(args, index, arg);
      config.teaLogin = config.host.login;
      index += 1;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return config;
}
