import { cwd } from "node:process";
import { join } from "node:path";
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

export function parseArgs(args: string[], repoRoot = cwd(), env: Env = process.env): TriageConfig {
  const config: TriageConfig = {
    repoRoot,
    dryRun: true,
    execute: false,
    showHelp: args.length === 0,
    teaLogin: env.PATCHMILL_HOST_LOGIN ?? env.CROPRUN_TRIAGE_TEA_LOGIN ?? "triage-agent",
    logDir: join(repoRoot, ".pi", "agent-issue", "triage-runs"),
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
    } else if (arg === "--tea-login") {
      config.teaLogin = requireValue(args, index, arg);
      index += 1;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return config;
}
