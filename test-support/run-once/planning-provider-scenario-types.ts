import type { PlanningStateV1 } from "../../src/workflow/planning-state-store.ts";
import type { IssueSummary } from "../../src/cli/commands/run-once/types.ts";

export type PlanningScenarioProvider = "github-gh" | "forgejo-tea";
export type PlanningScenarioGates = Readonly<{
  specRequired: boolean;
  planRequired: boolean;
}>;
export type PlanningScenarioFailurePoint =
  | "after-phase-push"
  | "after-planning-pull-request-create"
  | "after-worktree-remove"
  | "after-local-branch-remove"
  | "after-planning-merge-observation"
  | "after-implementation-pull-request-validation"
  | "after-handoff-comment"
  | "after-cleanup-hook"
  | "after-implementation-worktree-remove"
  | "after-done-label";
export type PlanningScenarioPhase = "spec" | "plan" | "implementation";
export type PlanningScenarioEffectOperation =
  | "agent-run"
  | "branch-remove"
  | "cleanup-hook"
  | "done-label"
  | "handoff-comment"
  | "implementation-push"
  | "issue-comment"
  | "issue-label-edit"
  | "issue-read"
  | "phase-push"
  | "planning-pull-request-create"
  | "pull-request-edit"
  | "pull-request-read"
  | "remote-fetch"
  | "repository-read"
  | "workspace-remove";
export type PlanningScenarioEffect = Readonly<{
  kind: "read" | "write" | "interrupt";
  operation: PlanningScenarioEffectOperation | "persistence-interrupt";
  phase?: PlanningScenarioPhase;
  point?: PlanningScenarioFailurePoint;
}>;
export type PlanningScenarioPull = {
  number: number;
  branch: string;
  body: string;
  headOid: string;
  headRepository: string;
  merged?: boolean;
  closed?: boolean;
  mergeOid?: string;
};
export type RecordedScenarioPullRequest = Readonly<{
  number: number;
  phase: PlanningScenarioPhase;
  targetRepository: string;
  headRepository: string;
  baseBranch: string;
  headBranch: string;
  headOid: string;
  body: string;
  status: "open" | "merged" | "closed-unmerged";
  mergeOid?: string;
}>;

export type PlanningProviderFixtureInput = {
  issue: IssueSummary;
  pulls: PlanningScenarioPull[];
  nextPull(): number;
  headOid(branch: string): Promise<string>;
  implementationFinish(): Promise<boolean>;
  interrupt(point: PlanningScenarioFailurePoint): Promise<void>;
  consumeHostReadFailure(): boolean;
  addIssueComment(body: string): void;
  updateIssueLabels(add: readonly string[], remove: readonly string[]): void;
  record(effect: PlanningScenarioEffect): void;
};

export type PlanningStateSnapshot = Readonly<{
  revision: number;
  phases: readonly Readonly<{
    kind: PlanningScenarioPhase;
    status: PlanningStateV1["phases"][number]["status"];
    finish?: readonly string[];
  }>[];
}>;
