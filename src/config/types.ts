import type { GitWorktreeStrategyConfig } from "../git/types.ts";
import type { PatchmillTriageStateMap } from "../policy/triage-state.ts";
import type { PatchmillProjectPolicy } from "../policy/types.ts";
import type { PatchmillSkillsConfig } from "../workflow/skills.ts";

export type PatchmillHostProviderId = "forgejo-tea" | "github-gh";

export type PatchmillHostConfig = {
  provider: PatchmillHostProviderId;
  login: string;
};

export type PatchmillPiConfig = {
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

export type PatchmillTriageConfig = {
  stateMap: PatchmillTriageStateMap;
};

export type PatchmillWorkflowApprovalConfig = {
  required: boolean;
  reviewLabel: string;
  approvedLabel: string;
};

export type PatchmillWorkflowConfig = {
  specApproval: PatchmillWorkflowApprovalConfig;
  planApproval: PatchmillWorkflowApprovalConfig;
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
  triage: PatchmillTriageConfig;
  workflow: PatchmillWorkflowConfig;
  skills: PatchmillSkillsConfig;
  paths: PatchmillPathsConfig;
  git: PatchmillGitConfig;
  cleanupHook?: string;
  projectPolicy: PatchmillProjectPolicyConfig;
};
