import { cwd } from "node:process";
import { join } from "node:path";
import { DEFAULT_PATCHMILL_CONFIG } from "../../../config/defaults.ts";
import type { PatchmillConfig } from "../../../config/types.ts";
import { createTriagePolicy } from "../../../policy/triage.ts";
import type { TriageConfig } from "./types.ts";

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
): TriageConfig {
  const patchmillConfig = normalizedConfig ?? DEFAULT_PATCHMILL_CONFIG;
  const host = hostConfig(env, patchmillConfig);
  const config: TriageConfig = {
    repoRoot,
    dryRun: false,
    execute: true,
    triageThinking: patchmillConfig.pi.triageThinking,
    showHelp: false,
    host,
    teaLogin: host.login,
    logDir: normalizedConfig
      ? patchmillConfig.paths.triageLogDir
      : join(repoRoot, patchmillConfig.paths.triageLogDir),
    projectPolicy: patchmillConfig.projectPolicy,
    triagePolicy: createTriagePolicy(
      patchmillConfig.labels,
      patchmillConfig.triage,
    ),
    skills: patchmillConfig.skills,
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--help" || arg === "-h") {
      config.showHelp = true;
    } else if (arg === "--dry-run" || arg === "--dryrun") {
      config.dryRun = true;
      config.execute = false;
    } else if (arg === "--all") {
      config.all = true;
    } else if (arg === "--issue") {
      config.issueNumber = parsePositiveInteger(
        arg,
        requireValue(args, index, arg),
      );
      index += 1;
    } else if (arg === "--limit") {
      config.limit = parsePositiveInteger(arg, requireValue(args, index, arg));
      index += 1;
    } else if (arg === "--log-dir") {
      config.logDir = requireValue(args, index, arg);
      index += 1;
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
