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
    priorities: ["priority:critical", "priority:high", "priority:medium", "priority:low"],
  },
  paths: {
    plansDir: "docs/plans",
    runStateDir: ".patchmill/runs",
    triageLogDir: ".patchmill/triage-runs",
    worktreeDir: ".worktrees",
    cleanStatusIgnorePrefixes: [".patchmill/runs/", ".patchmill/triage-runs/", ".pi/agent-issue/runs/"],
  },
  git: {
    baseBranch: "main",
    branchPrefix: "agent/issue-",
    worktreePrefix: "patchmill-issue-",
    allowDirectLand: true,
  },
  projectPolicy: {
    validationCommands: [],
    landingPolicy: "project-default",
    planRequiresApproval: false,
  },
};
