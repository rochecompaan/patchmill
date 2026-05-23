import { cwd } from "node:process";
import { join } from "node:path";
import { DEFAULT_PATCHMILL_CONFIG } from "../../src/config/defaults.ts";
import type { PatchmillConfig } from "../../src/config/types.ts";
import { createTriagePolicy } from "../../src/policy/triage.ts";
import { CROPRUN_COMPAT_POLICY } from "../../src/policy/defaults.ts";
import type { TriageConfig } from "./types.ts";

type Env = Record<string, string | undefined>;
const DEFAULT_TEA_LOGIN = "triage-agent";

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

function defaultTeaLogin(env: Env, normalizedConfig?: PatchmillConfig): string {
  if (env.PATCHMILL_HOST_LOGIN) return env.PATCHMILL_HOST_LOGIN;
  if (normalizedConfig?.host.login && normalizedConfig.host.login !== DEFAULT_TEA_LOGIN) {
    return normalizedConfig.host.login;
  }

  return env.CROPRUN_TRIAGE_TEA_LOGIN ?? normalizedConfig?.host.login ?? DEFAULT_TEA_LOGIN;
}

export function parseArgs(
  args: string[],
  repoRoot = cwd(),
  env: Env = process.env,
  normalizedConfig?: PatchmillConfig,
): TriageConfig {
  const config: TriageConfig = {
    repoRoot,
    dryRun: true,
    execute: false,
    showHelp: args.length === 0,
    teaLogin: defaultTeaLogin(env, normalizedConfig),
    logDir: normalizedConfig?.paths.triageLogDir ?? join(repoRoot, ".pi", "agent-issue", "triage-runs"),
    projectPolicy: normalizedConfig?.projectPolicy ?? CROPRUN_COMPAT_POLICY,
    triagePolicy: createTriagePolicy(normalizedConfig?.labels ?? DEFAULT_PATCHMILL_CONFIG.labels),
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--help" || arg === "-h") {
      config.showHelp = true;
    } else if (arg === "--execute") {
      config.dryRun = false;
      config.execute = true;
    } else if (arg === "--dry-run" || arg === "--dryrun") {
      config.dryRun = true;
      config.execute = false;
    } else if (arg === "--all") {
      config.all = true;
    } else if (arg === "--issue") {
      config.issueNumber = parsePositiveInteger(arg, requireValue(args, index, arg));
      index += 1;
    } else if (arg === "--limit") {
      config.limit = parsePositiveInteger(arg, requireValue(args, index, arg));
      index += 1;
    } else if (arg === "--log-dir") {
      config.logDir = requireValue(args, index, arg);
      index += 1;
    } else if (arg === "--tea-login" || arg === "--host-login") {
      config.teaLogin = requireValue(args, index, arg);
      index += 1;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return config;
}
