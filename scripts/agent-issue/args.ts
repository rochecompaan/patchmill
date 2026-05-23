import { cwd } from "node:process";
import { join } from "node:path";
import { LEGACY_CROPRUN_CLEANUP_HOOKS } from "../../src/cleanup/hooks.ts";
import type { CleanupHookConfig } from "../../src/cleanup/types.ts";
import { DEFAULT_PATCHMILL_CONFIG } from "../../src/config/defaults.ts";
import {
  DEFAULT_GIT_WORKTREE_STRATEGY_CONFIG,
  LEGACY_AGENT_ISSUE_WORKTREE_STRATEGY_CONFIG,
} from "../../src/git/worktree-strategy.ts";
import { CROPRUN_COMPAT_POLICY } from "../../src/policy/defaults.ts";
import type { PatchmillConfig } from "../../src/config/types.ts";
import type { AgentIssueConfig } from "./types.ts";

type Env = Record<string, string | undefined>;
const DEFAULT_TEA_LOGIN = "triage-agent";
const DEFAULT_CLEAN_STATUS_IGNORE_PREFIXES = DEFAULT_PATCHMILL_CONFIG.paths.cleanStatusIgnorePrefixes;

function cloneCleanupHooks(hooks: CleanupHookConfig[]): CleanupHookConfig[] {
  return hooks.map((hook) => ({
    name: hook.name,
    ...(hook.whenPathExists !== undefined ? { whenPathExists: hook.whenPathExists } : {}),
    ...(hook.terminateProcessPatterns !== undefined
      ? { terminateProcessPatterns: [...hook.terminateProcessPatterns] }
      : {}),
    ...(hook.command !== undefined ? { command: hook.command } : {}),
    ...(hook.args !== undefined ? { args: [...hook.args] } : {}),
  }));
}

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

  return env.CROPRUN_AGENT_ISSUE_TEA_LOGIN
    ?? env.CROPRUN_TRIAGE_TEA_LOGIN
    ?? normalizedConfig?.host.login
    ?? DEFAULT_TEA_LOGIN;
}

function defaultAgentTeam(
  env: Env,
  normalizedConfig?: PatchmillConfig,
): string | undefined {
  return normalizedConfig?.pi.team ?? env.PATCHMILL_AGENT_TEAM ?? env.CROPRUN_AGENT_ISSUE_AGENT_TEAM;
}

export function parseArgs(
  args: string[],
  repoRoot = cwd(),
  env: Env = process.env,
  normalizedConfig?: PatchmillConfig,
): AgentIssueConfig {
  const fallbackStrategy = normalizedConfig
    ? DEFAULT_GIT_WORKTREE_STRATEGY_CONFIG
    : LEGACY_AGENT_ISSUE_WORKTREE_STRATEGY_CONFIG;
  const projectPolicy = normalizedConfig?.projectPolicy ?? CROPRUN_COMPAT_POLICY;
  const config: AgentIssueConfig = {
    repoRoot,
    dryRun: true,
    execute: false,
    showHelp: args.length === 0,
    planOnly: false,
    teaLogin: defaultTeaLogin(env, normalizedConfig),
    agentTeamName: defaultAgentTeam(env, normalizedConfig),
    plansDir: normalizedConfig?.paths.plansDir ?? join(repoRoot, "docs", "plans"),
    runStateDir: normalizedConfig?.paths.runStateDir ?? join(repoRoot, ".pi", "agent-issue", "runs"),
    worktreeDir: normalizedConfig?.paths.worktreeDir ?? join(repoRoot, ".worktrees"),
    cleanStatusIgnorePrefixes: [...(normalizedConfig?.paths.cleanStatusIgnorePrefixes ?? DEFAULT_CLEAN_STATUS_IGNORE_PREFIXES)],
    cleanupHooks: cloneCleanupHooks(normalizedConfig?.cleanupHooks ?? LEGACY_CROPRUN_CLEANUP_HOOKS),
    projectPolicy,
    readyLabel: normalizedConfig?.labels.ready ?? "agent-ready",
    issueLimit: 1,
    requirePlanApproval: projectPolicy.planRequiresApproval,
    baseBranch: normalizedConfig?.git.baseBranch ?? fallbackStrategy.baseBranch,
    baseRef: normalizedConfig?.git.baseRef ?? fallbackStrategy.baseRef,
    remote: normalizedConfig?.git.remote ?? fallbackStrategy.remote,
    branchPrefix: normalizedConfig?.git.branchPrefix ?? fallbackStrategy.branchPrefix,
    worktreePrefix: normalizedConfig?.git.worktreePrefix ?? fallbackStrategy.worktreePrefix,
    slugLength: normalizedConfig?.git.slugLength ?? fallbackStrategy.slugLength,
    allowDirectLand: normalizedConfig?.git.allowDirectLand ?? fallbackStrategy.allowDirectLand,
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
      config.showHelp = false;
    } else if (arg === "--quiet") {
      config.quiet = true;
      config.showHelp = false;
    } else if (arg === "--verbose-pi-output") {
      config.verbosePiOutput = true;
      config.showHelp = false;
    } else if (arg === "--issue") {
      config.issueNumber = parsePositiveInteger(
        arg,
        requireValue(args, index, arg),
      );
      index += 1;
    } else if (arg === "--plan-only") {
      config.planOnly = true;
    } else if (arg === "--tea-login" || arg === "--host-login") {
      config.teaLogin = requireValue(args, index, arg);
      index += 1;
    } else if (arg === "--agent-team") {
      config.agentTeamName = requireValue(args, index, arg);
      index += 1;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return config;
}
