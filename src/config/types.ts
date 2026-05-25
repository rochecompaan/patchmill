import type { GitWorktreeStrategyConfig } from "../git/types.ts";
import type { PatchmillProjectPolicy } from "../policy/types.ts";
import type { PatchmillSkillsConfig } from "../workflow/skills.ts";

export type PatchmillHostConfig = {
  provider: "forgejo-tea";
  login: string;
};

export type PatchmillPiConfig = {
  team?: string;
  triageThinking: string;
};

export type PatchmillLabelsConfig = {
  ready: string;
  needsInfo: string;
  unsuitable: string;
  inProgress: string;
  done: string;
  blocked: string;
  types: string[];
  priorities: string[];
};

export type PatchmillPathsConfig = {
  plansDir: string;
  runStateDir: string;
  triageLogDir: string;
  worktreeDir: string;
  cleanStatusIgnorePrefixes: string[];
};

export type PatchmillGitConfig = Omit<GitWorktreeStrategyConfig, "worktreeDir">;

export type PatchmillProjectPolicyConfig = PatchmillProjectPolicy;

export type PatchmillConfig = {
  host: PatchmillHostConfig;
  pi: PatchmillPiConfig;
  labels: PatchmillLabelsConfig;
  skills: PatchmillSkillsConfig;
  paths: PatchmillPathsConfig;
  git: PatchmillGitConfig;
  cleanupHook?: string;
  projectPolicy: PatchmillProjectPolicyConfig;
};
