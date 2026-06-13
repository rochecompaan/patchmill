import { DEFAULT_GIT_WORKTREE_STRATEGY_CONFIG } from "../git/worktree-strategy.ts";
import { DEFAULT_PATCHMILL_POLICY } from "../policy/defaults.ts";
import { defaultTriageStateMap } from "../policy/triage-state.ts";
import { DEFAULT_PATCHMILL_SKILLS } from "../workflow/skills.ts";
import type { PatchmillConfig } from "./types.ts";

const DEFAULT_PATCHMILL_LABELS = {
  ready: "agent-ready",
  needsInfo: "needs-info",
  unsuitable: "agent-unsuitable",
  inProgress: "in-progress",
  done: "agent-done",
  blocked: "blocked",
  types: ["bug", "enhancement", "docs", "chore", "test"],
  priorities: [
    "priority:critical",
    "priority:high",
    "priority:medium",
    "priority:low",
  ],
};

const DEFAULT_PATCHMILL_WORKFLOW = {
  specApproval: {
    required: false,
    reviewLabel: "spec-review",
    approvedLabel: "spec-approved",
  },
  planApproval: {
    required: false,
    reviewLabel: "plan-review",
    approvedLabel: "plan-approved",
  },
};

export const DEFAULT_PATCHMILL_CONFIG: PatchmillConfig = {
  host: {
    provider: "forgejo-tea",
    login: "triage-agent",
  },
  pi: {
    triageThinking: "high",
  },
  labels: DEFAULT_PATCHMILL_LABELS,
  triage: {
    stateMap: defaultTriageStateMap(DEFAULT_PATCHMILL_LABELS),
  },
  workflow: DEFAULT_PATCHMILL_WORKFLOW,
  skills: DEFAULT_PATCHMILL_SKILLS,
  paths: {
    specsDir: "docs/specs",
    plansDir: "docs/plans",
    runStateDir: ".patchmill/runs",
    triageLogDir: ".patchmill/triage-runs",
    worktreeDir: DEFAULT_GIT_WORKTREE_STRATEGY_CONFIG.worktreeDir,
    cleanStatusIgnorePrefixes: [".patchmill/runs/", ".patchmill/triage-runs/"],
  },
  git: {
    baseBranch: DEFAULT_GIT_WORKTREE_STRATEGY_CONFIG.baseBranch,
    baseRef: DEFAULT_GIT_WORKTREE_STRATEGY_CONFIG.baseRef,
    remote: DEFAULT_GIT_WORKTREE_STRATEGY_CONFIG.remote,
    branchPrefix: DEFAULT_GIT_WORKTREE_STRATEGY_CONFIG.branchPrefix,
    worktreePrefix: DEFAULT_GIT_WORKTREE_STRATEGY_CONFIG.worktreePrefix,
    slugLength: DEFAULT_GIT_WORKTREE_STRATEGY_CONFIG.slugLength,
    allowDirectLand: DEFAULT_GIT_WORKTREE_STRATEGY_CONFIG.allowDirectLand,
  },
  projectPolicy: DEFAULT_PATCHMILL_POLICY,
};
