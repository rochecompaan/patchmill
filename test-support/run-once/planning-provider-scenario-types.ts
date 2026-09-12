import type { IssueSummary } from "../../src/cli/commands/run-once/types.ts";
import type { PlanningStateV1 } from "../../src/workflow/planning-state-store.ts";

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
export type PlanningScenarioOwnership = Readonly<{
  phase: PlanningScenarioPhase;
  branch: string;
  worktreePath: string;
}>;

type PlanningScenarioReadEffect = Readonly<{
  kind: "read";
  operation:
    | "issue-read"
    | "pull-request-read"
    | "remote-fetch"
    | "repository-read";
}>;
type PlanningScenarioIssueWriteEffect = Readonly<{
  kind: "write";
  operation:
    | "done-label"
    | "handoff-comment"
    | "issue-comment"
    | "issue-label-edit"
    | "pull-request-edit";
}>;
type PlanningScenarioPublicationWriteEffect = Readonly<{
  kind: "write";
  operation:
    | "implementation-push"
    | "phase-push"
    | "planning-pull-request-create";
  phase: PlanningScenarioPhase;
  branch: string;
  ref: string;
}>;
type PlanningScenarioWorkspaceWriteEffect = Readonly<{
  kind: "write";
  operation: "agent-run" | "cleanup-hook" | "workspace-remove";
  phase: PlanningScenarioPhase;
  branch: string;
  worktreePath: string;
}>;
type PlanningScenarioBranchWriteEffect = Readonly<{
  kind: "write";
  operation: "branch-remove";
  phase: PlanningScenarioPhase;
  branch: string;
}>;
type PlanningScenarioInterruptEffect = Readonly<{
  kind: "interrupt";
  operation: "persistence-interrupt";
  point: PlanningScenarioFailurePoint;
}>;

/** Semantic effects recorded at the provider scenario's process boundary. */
export type PlanningScenarioEffect =
  | PlanningScenarioReadEffect
  | PlanningScenarioIssueWriteEffect
  | PlanningScenarioPublicationWriteEffect
  | PlanningScenarioWorkspaceWriteEffect
  | PlanningScenarioBranchWriteEffect
  | PlanningScenarioInterruptEffect;

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
  ownershipForBranch(branch: string): Promise<PlanningScenarioOwnership>;
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
    ownership?: Readonly<{
      branch: string;
      worktreePath: string;
      cleanupState: "ready" | "worktree-removed" | "removed";
    }>;
  }>[];
}>;
