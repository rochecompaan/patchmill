import { readFile } from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";
import { DEFAULT_PATCHMILL_CONFIG } from "./defaults.ts";
import type { PatchmillConfig } from "./types.ts";

const CONFIG_FILE_NAME = "patchmill.config.json";

type Env = Record<string, string | undefined>;
type PartialConfig = Partial<{
  host: Partial<PatchmillConfig["host"]>;
  pi: Partial<PatchmillConfig["pi"]>;
  paths: Partial<PatchmillConfig["paths"]>;
  labels: Partial<PatchmillConfig["labels"]>;
  git: Partial<PatchmillConfig["git"]>;
  projectPolicy: Partial<PatchmillConfig["projectPolicy"]>;
}>;

function cloneStringArray(values: string[]): string[] {
  return [...values];
}

function mergeConfig(base: PatchmillConfig, update: PartialConfig): PatchmillConfig {
  const labels = { ...base.labels, ...update.labels };
  const paths = { ...base.paths, ...update.paths };
  const projectPolicy = { ...base.projectPolicy, ...update.projectPolicy };

  return {
    host: { ...base.host, ...update.host },
    pi: { ...base.pi, ...update.pi },
    labels: {
      ...labels,
      priorities: cloneStringArray(update.labels?.priorities ?? base.labels.priorities),
    },
    paths: {
      ...paths,
      cleanStatusIgnorePrefixes: cloneStringArray(
        update.paths?.cleanStatusIgnorePrefixes ?? base.paths.cleanStatusIgnorePrefixes,
      ),
    },
    git: { ...base.git, ...update.git },
    projectPolicy: {
      ...projectPolicy,
      validationCommands: cloneStringArray(
        update.projectPolicy?.validationCommands ?? base.projectPolicy.validationCommands,
      ),
    },
  };
}

function absolutize(root: string, value: string): string {
  return isAbsolute(value) ? value : resolve(root, value);
}

function absolutizePaths(root: string, config: PatchmillConfig): PatchmillConfig {
  return {
    ...config,
    paths: {
      plansDir: absolutize(root, config.paths.plansDir),
      runStateDir: absolutize(root, config.paths.runStateDir),
      triageLogDir: absolutize(root, config.paths.triageLogDir),
      worktreeDir: absolutize(root, config.paths.worktreeDir),
      cleanStatusIgnorePrefixes: cloneStringArray(config.paths.cleanStatusIgnorePrefixes),
    },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function describeValue(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "string") return JSON.stringify(value);
  if (Array.isArray(value)) return "an array";
  if (typeof value === "object") return "an object";
  return String(value);
}

function configError(path: string, expected: string, value: unknown): Error {
  return new Error(`Invalid ${CONFIG_FILE_NAME}: ${path} must be ${expected}; received ${describeValue(value)}`);
}

function readOptionalSection(source: Record<string, unknown>, key: string): Record<string, unknown> | undefined {
  const value = source[key];
  if (value === undefined) return undefined;
  if (!isRecord(value)) throw configError(key, "an object", value);
  return value;
}

function readOptionalString(source: Record<string, unknown>, key: string, path: string): string | undefined {
  const value = source[key];
  if (value === undefined) return undefined;
  if (typeof value !== "string") throw configError(path, "a string", value);
  return value;
}

function readOptionalBoolean(source: Record<string, unknown>, key: string, path: string): boolean | undefined {
  const value = source[key];
  if (value === undefined) return undefined;
  if (typeof value !== "boolean") throw configError(path, "a boolean", value);
  return value;
}

function readOptionalStringArray(source: Record<string, unknown>, key: string, path: string): string[] | undefined {
  const value = source[key];
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw configError(path, "an array of strings", value);
  }
  return cloneStringArray(value);
}

function readOptionalLiteral<T extends string>(
  source: Record<string, unknown>,
  key: string,
  path: string,
  allowed: readonly [T, ...T[]],
): T | undefined {
  const value = source[key];
  if (value === undefined) return undefined;
  if (typeof value !== "string" || !allowed.includes(value as T)) {
    const expected =
      allowed.length === 1
        ? `the literal ${JSON.stringify(allowed[0])}`
        : `one of ${allowed.map((entry) => JSON.stringify(entry)).join(", ")}`;
    throw configError(path, expected, value);
  }
  return value as T;
}

function hasEntries(value: object): boolean {
  return Object.keys(value).length > 0;
}

function parseConfigFile(data: unknown): PartialConfig {
  if (!isRecord(data)) {
    throw new Error(`Invalid ${CONFIG_FILE_NAME}: top-level value must be an object`);
  }

  const config: PartialConfig = {};

  const host = readOptionalSection(data, "host");
  if (host) {
    const parsed: Partial<PatchmillConfig["host"]> = {};
    const provider = readOptionalLiteral(host, "provider", "host.provider", ["forgejo-tea"]);
    const login = readOptionalString(host, "login", "host.login");
    if (provider !== undefined) parsed.provider = provider;
    if (login !== undefined) parsed.login = login;
    if (hasEntries(parsed)) config.host = parsed;
  }

  const pi = readOptionalSection(data, "pi");
  if (pi) {
    const parsed: Partial<PatchmillConfig["pi"]> = {};
    const team = readOptionalString(pi, "team", "pi.team");
    const triageThinking = readOptionalString(pi, "triageThinking", "pi.triageThinking");
    if (team !== undefined) parsed.team = team;
    if (triageThinking !== undefined) parsed.triageThinking = triageThinking;
    if (hasEntries(parsed)) config.pi = parsed;
  }

  const labels = readOptionalSection(data, "labels");
  if (labels) {
    const parsed: Partial<PatchmillConfig["labels"]> = {};
    const ready = readOptionalString(labels, "ready", "labels.ready");
    const needsInfo = readOptionalString(labels, "needsInfo", "labels.needsInfo");
    const unsuitable = readOptionalString(labels, "unsuitable", "labels.unsuitable");
    const inProgress = readOptionalString(labels, "inProgress", "labels.inProgress");
    const done = readOptionalString(labels, "done", "labels.done");
    const blocked = readOptionalString(labels, "blocked", "labels.blocked");
    const priorities = readOptionalStringArray(labels, "priorities", "labels.priorities");
    if (ready !== undefined) parsed.ready = ready;
    if (needsInfo !== undefined) parsed.needsInfo = needsInfo;
    if (unsuitable !== undefined) parsed.unsuitable = unsuitable;
    if (inProgress !== undefined) parsed.inProgress = inProgress;
    if (done !== undefined) parsed.done = done;
    if (blocked !== undefined) parsed.blocked = blocked;
    if (priorities !== undefined) parsed.priorities = priorities;
    if (hasEntries(parsed)) config.labels = parsed;
  }

  const paths = readOptionalSection(data, "paths");
  if (paths) {
    const parsed: Partial<PatchmillConfig["paths"]> = {};
    const plansDir = readOptionalString(paths, "plansDir", "paths.plansDir");
    const runStateDir = readOptionalString(paths, "runStateDir", "paths.runStateDir");
    const triageLogDir = readOptionalString(paths, "triageLogDir", "paths.triageLogDir");
    const worktreeDir = readOptionalString(paths, "worktreeDir", "paths.worktreeDir");
    const cleanStatusIgnorePrefixes = readOptionalStringArray(
      paths,
      "cleanStatusIgnorePrefixes",
      "paths.cleanStatusIgnorePrefixes",
    );
    if (plansDir !== undefined) parsed.plansDir = plansDir;
    if (runStateDir !== undefined) parsed.runStateDir = runStateDir;
    if (triageLogDir !== undefined) parsed.triageLogDir = triageLogDir;
    if (worktreeDir !== undefined) parsed.worktreeDir = worktreeDir;
    if (cleanStatusIgnorePrefixes !== undefined) parsed.cleanStatusIgnorePrefixes = cleanStatusIgnorePrefixes;
    if (hasEntries(parsed)) config.paths = parsed;
  }

  const git = readOptionalSection(data, "git");
  if (git) {
    const parsed: Partial<PatchmillConfig["git"]> = {};
    const baseBranch = readOptionalString(git, "baseBranch", "git.baseBranch");
    const branchPrefix = readOptionalString(git, "branchPrefix", "git.branchPrefix");
    const worktreePrefix = readOptionalString(git, "worktreePrefix", "git.worktreePrefix");
    const allowDirectLand = readOptionalBoolean(git, "allowDirectLand", "git.allowDirectLand");
    if (baseBranch !== undefined) parsed.baseBranch = baseBranch;
    if (branchPrefix !== undefined) parsed.branchPrefix = branchPrefix;
    if (worktreePrefix !== undefined) parsed.worktreePrefix = worktreePrefix;
    if (allowDirectLand !== undefined) parsed.allowDirectLand = allowDirectLand;
    if (hasEntries(parsed)) config.git = parsed;
  }

  const projectPolicy = readOptionalSection(data, "projectPolicy");
  if (projectPolicy) {
    const parsed: Partial<PatchmillConfig["projectPolicy"]> = {};
    const validationCommands = readOptionalStringArray(
      projectPolicy,
      "validationCommands",
      "projectPolicy.validationCommands",
    );
    const landingPolicy = readOptionalLiteral(
      projectPolicy,
      "landingPolicy",
      "projectPolicy.landingPolicy",
      ["project-default"],
    );
    const planRequiresApproval = readOptionalBoolean(
      projectPolicy,
      "planRequiresApproval",
      "projectPolicy.planRequiresApproval",
    );
    if (validationCommands !== undefined) parsed.validationCommands = validationCommands;
    if (landingPolicy !== undefined) parsed.landingPolicy = landingPolicy;
    if (planRequiresApproval !== undefined) parsed.planRequiresApproval = planRequiresApproval;
    if (hasEntries(parsed)) config.projectPolicy = parsed;
  }

  return config;
}

type LoadedConfigFile = {
  config: PartialConfig;
  hasConfigFile: boolean;
};

async function readConfigFile(repoRoot: string): Promise<LoadedConfigFile> {
  let text: string;
  try {
    text = await readFile(join(repoRoot, CONFIG_FILE_NAME), "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return { config: {}, hasConfigFile: false };
    }
    throw error;
  }

  try {
    return {
      config: parseConfigFile(JSON.parse(text) as unknown),
      hasConfigFile: true,
    };
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new Error(`Invalid ${CONFIG_FILE_NAME}: ${error.message}`);
    }
    throw error;
  }
}

function envConfig(env: Env): PartialConfig {
  return {
    host: env.PATCHMILL_HOST_LOGIN ? { login: env.PATCHMILL_HOST_LOGIN } : {},
    pi: env.PATCHMILL_AGENT_TEAM ? { team: env.PATCHMILL_AGENT_TEAM } : {},
  };
}

function cliConfig(args: string[]): PartialConfig {
  const config: PartialConfig = {};
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === "--host-login" || args[index] === "--tea-login") {
      const flag = args[index]!;
      const value = args[index + 1];
      if (!value || value.startsWith("--")) throw new Error(`${flag} requires a value`);
      config.host = { ...(config.host ?? {}), login: value };
      index += 1;
    } else if (args[index] === "--agent-team") {
      const value = args[index + 1];
      if (!value || value.startsWith("--")) throw new Error("--agent-team requires a value");
      config.pi = { ...(config.pi ?? {}), team: value };
      index += 1;
    }
  }
  return config;
}

export async function loadPatchmillConfigState(
  repoRoot: string,
  env: Env = process.env,
  args: string[] = [],
): Promise<{ config: PatchmillConfig; hasConfigFile: boolean }> {
  const { config: fromFile, hasConfigFile } = await readConfigFile(repoRoot);
  const merged = mergeConfig(mergeConfig(mergeConfig(DEFAULT_PATCHMILL_CONFIG, fromFile), envConfig(env)), cliConfig(args));
  return {
    config: absolutizePaths(repoRoot, merged),
    hasConfigFile,
  };
}

export async function loadPatchmillConfig(repoRoot: string, env: Env = process.env, args: string[] = []): Promise<PatchmillConfig> {
  return (await loadPatchmillConfigState(repoRoot, env, args)).config;
}
