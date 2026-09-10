import type { PlanningPublicationOperations } from "../../../git/planning-publication-git.ts";
import type { PlanningRemoteBaseGit } from "../../../git/planning-remote-base.ts";
import type { PlanningWorkspaceLifecycle } from "../../../git/planning-workspaces.ts";
import type { PullRequestHost } from "../../../host/pull-requests.ts";
import type { PatchmillProjectPolicy } from "../../../policy/types.ts";
import type { PatchmillSkillsConfig } from "../../../workflow/skills.ts";
import type { PlanningIssueLock } from "../../../workflow/planning-issue-lock.ts";
import { replacePlanningPhase } from "../../../workflow/planning-phase-replacement.ts";
import type { PlanningStateStore } from "../../../workflow/planning-state-store.ts";
import type { PlanningStateV1 } from "../../../workflow/planning-state-types.ts";
import type { PlannedPhase } from "../../../workflow/planning-pull-requests.ts";
import {
  runPlanningImplementation,
  type PlanningImplementationInput,
} from "./planning-implementation.ts";
import {
  finishPlanningImplementation,
  type PlanningFinishInput,
} from "./planning-finish.ts";
import {
  reconcilePlanningPhase,
  type PlanningPhaseReconciliation,
} from "./planning-phase-reconciler.ts";
import {
  publishPlanningPhase,
  type PlanningPhasePublicationResult,
} from "./planning-phase-publisher.ts";
import {
  resolvePlanningPhaseArtifacts,
  runPlanningPhaseArtifacts,
} from "./planning-phase-artifacts.ts";
import type { PlanningArtifactAgent } from "./planning-phase-artifacts.ts";
import type { PromptTriageLabels } from "./prompts.ts";
import type {
  AgentIssueBlockedResult,
  AgentIssuePrCreatedResult,
  IssueSummary,
} from "./types.ts";

export type PlanningPhaseRunnerOutcome =
  | { kind: "review-pending"; state: PlanningStateV1; prUrl: string }
  | { kind: "stopped"; state: PlanningStateV1; reason: "plan-only" }
  | { kind: "blocked"; state: PlanningStateV1; result: AgentIssueBlockedResult }
  | {
      kind: "complete";
      state: PlanningStateV1;
      result: AgentIssuePrCreatedResult;
    }
  | { kind: "advanced"; state: PlanningStateV1 };

export type PlanningImplementationAdapter = Readonly<{
  implementation: Omit<
    PlanningImplementationInput,
    | "state"
    | "phaseIndex"
    | "lock"
    | "stateStore"
    | "host"
    | "workspaces"
    | "git"
  >;
  finish: (
    state: PlanningStateV1,
  ) => Omit<
    PlanningFinishInput,
    "state" | "phaseIndex" | "lock" | "stateStore" | "workspaces"
  >;
}>;

type RunnerConfig = {
  repoRoot: string;
  remote: string;
  baseBranch: string;
  specsDir: string;
  plansDir: string;
  projectPolicy: PatchmillProjectPolicy;
  skills: PatchmillSkillsConfig;
  triageLabels: PromptTriageLabels;
  workspaceIdentity?: (phase: PlannedPhase) => {
    branch: string;
    worktreePath: string;
  };
};

export type PlanningPhaseRunnerOperations = {
  reconcile: (
    input: Parameters<typeof reconcilePlanningPhase>[0],
  ) => Promise<
    Readonly<{ state: PlanningStateV1; outcome: PlanningPhaseReconciliation }>
  >;
  resolveArtifacts: typeof resolvePlanningPhaseArtifacts;
  runArtifacts: typeof runPlanningPhaseArtifacts;
  publish: (
    input: Parameters<typeof publishPlanningPhase>[0],
  ) => Promise<PlanningPhasePublicationResult>;
  runImplementation: (
    input: PlanningImplementationInput,
  ) => ReturnType<typeof runPlanningImplementation>;
  finishImplementation: (
    input: PlanningFinishInput,
  ) => ReturnType<typeof finishPlanningImplementation>;
};

export type PlanningPhaseRunnerInput = {
  state: PlanningStateV1;
  phaseIndex: number;
  phase: PlannedPhase;
  issue: IssueSummary;
  lock: PlanningIssueLock;
  config: RunnerConfig;
  stateStore: Pick<PlanningStateStore, "replace">;
  host: PullRequestHost;
  remoteBase: Pick<PlanningRemoteBaseGit, "fetch">;
  publicationGit: PlanningPublicationOperations;
  workspaces: PlanningWorkspaceLifecycle;
  artifactAgent: PlanningArtifactAgent;
  implementation: PlanningImplementationAdapter;
  planOnly?: boolean;
  artifactDate?: Date;
  now?: () => Date;
  operations?: Partial<PlanningPhaseRunnerOperations>;
};

export function operations(
  input: PlanningPhaseRunnerInput,
): PlanningPhaseRunnerOperations {
  return {
    reconcile: input.operations?.reconcile ?? reconcilePlanningPhase,
    resolveArtifacts:
      input.operations?.resolveArtifacts ?? resolvePlanningPhaseArtifacts,
    runArtifacts: input.operations?.runArtifacts ?? runPlanningPhaseArtifacts,
    publish: input.operations?.publish ?? publishPlanningPhase,
    runImplementation:
      input.operations?.runImplementation ?? runPlanningImplementation,
    finishImplementation:
      input.operations?.finishImplementation ?? finishPlanningImplementation,
  };
}

export function blocked(reason: string): AgentIssueBlockedResult {
  return {
    status: "blocked",
    reason,
    questions: [],
    commits: [],
    validation: [],
  };
}

export async function replacePhase(
  input: PlanningPhaseRunnerInput,
  state: PlanningStateV1,
  phase: PlanningStateV1["phases"][number],
): Promise<PlanningStateV1> {
  return replacePlanningPhase({
    stateStore: input.stateStore,
    lock: input.lock,
    state,
    phaseIndex: input.phaseIndex,
    phase,
    ...(input.now === undefined ? {} : { now: input.now }),
  });
}
