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
  priorities: string[];
};

export type PatchmillPathsConfig = {
  plansDir: string;
  runStateDir: string;
  triageLogDir: string;
  worktreeDir: string;
  cleanStatusIgnorePrefixes: string[];
};

export type PatchmillGitConfig = {
  baseBranch: string;
  branchPrefix: string;
  worktreePrefix: string;
  allowDirectLand: boolean;
};

export type PatchmillProjectPolicyConfig = {
  validationCommands: string[];
  landingPolicy: "project-default";
  planRequiresApproval: boolean;
};

export type PatchmillConfig = {
  host: PatchmillHostConfig;
  pi: PatchmillPiConfig;
  labels: PatchmillLabelsConfig;
  paths: PatchmillPathsConfig;
  git: PatchmillGitConfig;
  projectPolicy: PatchmillProjectPolicyConfig;
};
