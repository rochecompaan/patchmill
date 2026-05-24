import { DEFAULT_GIT_WORKTREE_STRATEGY_CONFIG } from "../git/worktree-strategy.ts";
import { DEFAULT_PATCHMILL_POLICY } from "../policy/defaults.ts";
import { DEFAULT_PATCHMILL_SKILLS } from "../workflow/skills.ts";
import type { PatchmillConfig } from "./types.ts";

export const DEFAULT_PATCHMILL_CONFIG: PatchmillConfig = {
  host: {
    provider: "forgejo-tea",
    login: "triage-agent",
  },
  pi: {
    triageThinking: "high",
  },
  labels: {
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
  },
  skills: DEFAULT_PATCHMILL_SKILLS,
  paths: {
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
  cleanupHooks: [],
  projectPolicy: DEFAULT_PATCHMILL_POLICY,
};
