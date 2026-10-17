import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { HostProviderId } from "../host/types.ts";

export const CONFIG_FILE = "patchmill.config.json";
export type LabelsConfig = {
  ready: string;
  inProgress: string;
  specReview: string;
  specApproved: string;
  needsInfo: string;
  done: string;
  unsuitable: string;
  blocked: string;
};
export type PatchmillConfig = {
  host: { provider: HostProviderId; login: string; trustedAuthors: string[] };
  labels: LabelsConfig;
  paths: {
    specsDir: string;
    plansDir: string;
    worktreeDir: string;
    runsDir: string;
  };
  git: { baseBranch: string | null };
  skills: { triage: string; planning: string; implementation: string };
  pi: { agentDir: string; timeoutMinutes: number };
  workflow: { specApproval: { required: boolean } };
};
export const DEFAULT_CONFIG: PatchmillConfig = {
  host: { provider: "github-gh", login: "", trustedAuthors: [] },
  labels: {
    ready: "agent-ready",
    inProgress: "in-progress",
    specReview: "spec-review",
    specApproved: "spec-approved",
    needsInfo: "needs-info",
    done: "agent-done",
    unsuitable: "agent-unsuitable",
    blocked: "blocked",
  },
  paths: {
    specsDir: "docs/specs",
    plansDir: "docs/plans",
    worktreeDir: ".worktrees",
    runsDir: ".patchmill/runs",
  },
  git: { baseBranch: null },
  skills: {
    triage: ".patchmill/skills/patchmill-issue-triage",
    planning: ".patchmill/skills/patchmill-planning",
    implementation: ".patchmill/skills/patchmill-implementation",
  },
  pi: { agentDir: ".patchmill/pi-agent", timeoutMinutes: 90 },
  workflow: { specApproval: { required: true } },
};
export class ConfigError extends Error {}

type Kind = "string" | "number" | "boolean" | "string[]" | "string|null";
const schema: { path: string; kind: Kind }[] = [
  { path: "host.provider", kind: "string" },
  { path: "host.login", kind: "string" },
  { path: "host.trustedAuthors", kind: "string[]" },
  { path: "labels.ready", kind: "string" },
  { path: "labels.inProgress", kind: "string" },
  { path: "labels.specReview", kind: "string" },
  { path: "labels.specApproved", kind: "string" },
  { path: "labels.needsInfo", kind: "string" },
  { path: "labels.done", kind: "string" },
  { path: "labels.unsuitable", kind: "string" },
  { path: "labels.blocked", kind: "string" },
  { path: "paths.specsDir", kind: "string" },
  { path: "paths.plansDir", kind: "string" },
  { path: "paths.worktreeDir", kind: "string" },
  { path: "paths.runsDir", kind: "string" },
  { path: "git.baseBranch", kind: "string|null" },
  { path: "skills.triage", kind: "string" },
  { path: "skills.planning", kind: "string" },
  { path: "skills.implementation", kind: "string" },
  { path: "pi.agentDir", kind: "string" },
  { path: "pi.timeoutMinutes", kind: "number" },
  { path: "workflow.specApproval.required", kind: "boolean" },
];

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function matches(value: unknown, kind: Kind): boolean {
  if (kind === "string[]") {
    return (
      Array.isArray(value) && value.every((item) => typeof item === "string")
    );
  }
  if (kind === "string|null")
    return value === null || typeof value === "string";
  return typeof value === kind;
}

export function parseConfig(raw: unknown): PatchmillConfig {
  if (!isObject(raw)) throw new ConfigError("Config must be an object");
  const config = structuredClone(DEFAULT_CONFIG);
  function walk(
    input: Record<string, unknown>,
    target: Record<string, unknown>,
    prefix: string,
  ) {
    for (const [key, value] of Object.entries(input)) {
      const path = prefix ? `${prefix}.${key}` : key;
      if (key.includes("."))
        throw new ConfigError(`Unknown config key: ${path}`);
      const leaf = schema.find((entry) => entry.path === path);
      if (leaf) {
        if (!matches(value, leaf.kind))
          throw new ConfigError(`Invalid type for ${path}`);
        if (
          path === "host.provider" &&
          value !== "github-gh" &&
          value !== "forgejo-tea"
        ) {
          throw new ConfigError(`Invalid value for ${path}`);
        }
        target[key] = structuredClone(value);
      } else if (schema.some((entry) => entry.path.startsWith(`${path}.`))) {
        if (!isObject(value))
          throw new ConfigError(`Expected object for ${path}`);
        walk(value, target[key] as Record<string, unknown>, path);
      } else {
        throw new ConfigError(`Unknown config key: ${path}`);
      }
    }
  }
  walk(raw, config, "");
  return config;
}

export async function loadConfig(repoRoot: string): Promise<PatchmillConfig> {
  const file = join(repoRoot, CONFIG_FILE);
  let text: string;
  try {
    text = await readFile(file, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new ConfigError(`Missing ${file}; run patchmill init`);
    }
    throw new ConfigError(`Cannot read ${file}: ${String(error)}`);
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new ConfigError(`Invalid JSON in ${file}`);
  }
  if (!isObject(raw)) throw new ConfigError(`Expected an object in ${file}`);
  return parseConfig(raw);
}

export function trustedAuthors(config: PatchmillConfig, login = ""): string[] {
  const identities = [login];
  if (config.host.provider === "github-gh") identities.push(config.host.login);
  return [
    ...new Set([...identities.filter(Boolean), ...config.host.trustedAuthors]),
  ];
}
