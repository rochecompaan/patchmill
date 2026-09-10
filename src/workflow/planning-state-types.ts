import type {
  PlanningRemoteBaseSnapshot,
  PlanningWorkspaceOwnership,
} from "../git/planning-workspaces.ts";
import type {
  PullRequestReference,
  RepositoryIdentity,
} from "../host/pull-requests.ts";
import type {
  PlanningArtifactKind,
  PlanningGateSnapshot,
} from "./planning-pull-requests.ts";
import type { PlanningPhaseKind } from "./planning-pull-request-markers.ts";

export type PlanningBaseEvidence = PlanningRemoteBaseSnapshot;
export type PlanningWorkspaceEvidence = PlanningWorkspaceOwnership;
export type PlanningArtifactEvidence = Readonly<{
  kind: PlanningArtifactKind;
  path: string;
  commitOid: string;
  source: "remote-base" | "workspace";
}>;
export type PlanningPublicationEvidence = Readonly<{
  targetRepository: RepositoryIdentity;
  headRepository: RepositoryIdentity;
  baseBranch: string;
  headBranch: string;
  headOid: string;
}>;
export type PlanningPullRequestEvidence = Readonly<{
  reference: PullRequestReference;
  url: string;
}>;

export type PlanningImplementationVisualEvidence = Readonly<{
  screenshotPath: string;
  caption?: string;
  referencePaths?: readonly string[];
  url?: string;
}>;
export type PlanningRunCostEvidence = Readonly<{
  stages: readonly Readonly<{
    stage: string;
    models: readonly Readonly<{
      model: string;
      promptTokens: number;
      outputTokens: number;
      estimatedCostUsd: number;
    }>[];
    promptTokens: number;
    outputTokens: number;
    estimatedCostUsd: number;
  }>[];
  promptTokens: number;
  outputTokens: number;
  estimatedCostUsd: number;
}>;
export type PlanningImplementationAgentEvidence = Readonly<{
  status: "pr-created";
  prUrl: string;
  branch: string;
  commits: readonly string[];
  validation: readonly string[];
  reviewSummary?: string;
  landingDecision?: string;
  visualEvidence: readonly PlanningImplementationVisualEvidence[];
  runCostReport?: PlanningRunCostEvidence;
}>;
export type PlanningImplementationFinishCheckpoints = Readonly<{
  costPublicationCompleted?: true;
  visualEvidenceValidated?: true;
  handoffCommentPosted?: true;
  cleanupHookStarted?: true;
  cleanupHookCompleted?: true;
  doneLabelEnsured?: true;
  doneLabelApplied?: true;
}>;
type PlanningPhasePullRequestKind = "spec" | "plan";

export type WorkspaceReadyPlanningPhase = Readonly<{
  kind: PlanningPhasePullRequestKind;
  status: "workspace-ready";
  base: PlanningBaseEvidence;
  workspace: PlanningWorkspaceOwnership<{ state: "ready" }>;
  artifacts: readonly PlanningArtifactEvidence[];
}>;
export type BranchPushedPlanningPhase = Readonly<{
  kind: PlanningPhasePullRequestKind;
  status: "branch-pushed";
  base: PlanningBaseEvidence;
  workspace: PlanningWorkspaceOwnership<{ state: "ready" }>;
  artifacts: readonly PlanningArtifactEvidence[];
  publication: PlanningPublicationEvidence;
}>;
export type PullRequestOpenPlanningPhase = Readonly<{
  kind: PlanningPhasePullRequestKind;
  status: "pull-request-open";
  base: PlanningBaseEvidence;
  workspace: PlanningWorkspaceOwnership;
  artifacts: readonly PlanningArtifactEvidence[];
  publication: PlanningPublicationEvidence;
  pullRequest: PlanningPullRequestEvidence;
}>;
export type RemoteBaseCompletePlanningPhase = Readonly<{
  kind: PlanningPhasePullRequestKind;
  status: "complete";
  base: PlanningBaseEvidence;
  artifacts: readonly PlanningArtifactEvidence[];
  completion: Readonly<{ kind: "remote-base" }>;
}>;
export type MergedPullRequestCompletePlanningPhase = Readonly<{
  kind: PlanningPhasePullRequestKind;
  status: "complete";
  base: PlanningBaseEvidence;
  workspace: PlanningWorkspaceOwnership<{
    state: "removed";
    pushedHeadOid: string;
  }>;
  artifacts: readonly PlanningArtifactEvidence[];
  publication: PlanningPublicationEvidence;
  pullRequest: PlanningPullRequestEvidence;
  completion: Readonly<{
    kind: "merged-pull-request";
    mergeOid: string;
    mergedBaseOid: string;
  }>;
}>;
export type ImplementationWorkspaceReadyPlanningPhase = Readonly<{
  kind: "implementation";
  status: "workspace-ready";
  base: PlanningBaseEvidence;
  workspace: PlanningWorkspaceOwnership<{ state: "ready" }>;
  artifacts: readonly PlanningArtifactEvidence[];
}>;
export type ImplementationBranchPushedPlanningPhase = Readonly<{
  kind: "implementation";
  status: "branch-pushed";
  base: PlanningBaseEvidence;
  workspace: PlanningWorkspaceOwnership<{ state: "ready" }>;
  artifacts: readonly PlanningArtifactEvidence[];
  publication: PlanningPublicationEvidence;
  implementation: PlanningImplementationAgentEvidence;
}>;
export type ImplementationPullRequestOpenPlanningPhase = Readonly<{
  kind: "implementation";
  status: "pull-request-open";
  base: PlanningBaseEvidence;
  workspace: PlanningWorkspaceOwnership;
  artifacts: readonly PlanningArtifactEvidence[];
  publication: PlanningPublicationEvidence;
  pullRequest: PlanningPullRequestEvidence;
  implementation: PlanningImplementationAgentEvidence;
  finish: PlanningImplementationFinishCheckpoints;
}>;
export type ImplementationCompletePlanningPhase = Readonly<{
  kind: "implementation";
  status: "complete";
  base: PlanningBaseEvidence;
  workspace: PlanningWorkspaceOwnership<{
    state: "removed";
    pushedHeadOid: string;
  }>;
  artifacts: readonly PlanningArtifactEvidence[];
  publication: PlanningPublicationEvidence;
  pullRequest: PlanningPullRequestEvidence;
  implementation: PlanningImplementationAgentEvidence;
  finish: Required<PlanningImplementationFinishCheckpoints>;
  completion: Readonly<{ kind: "implementation-pull-request" }>;
}>;
export type PlanningPhaseStateV1 =
  | Readonly<{ kind: PlanningPhaseKind; status: "pending" }>
  | WorkspaceReadyPlanningPhase
  | BranchPushedPlanningPhase
  | PullRequestOpenPlanningPhase
  | RemoteBaseCompletePlanningPhase
  | MergedPullRequestCompletePlanningPhase
  | ImplementationWorkspaceReadyPlanningPhase
  | ImplementationBranchPushedPlanningPhase
  | ImplementationPullRequestOpenPlanningPhase
  | ImplementationCompletePlanningPhase;
export type PlanningStateV1 = Readonly<{
  version: 1;
  workflowVersion: "planning-pr-v1";
  runId: string;
  issueNumber: number;
  issueTitle: string;
  gates: PlanningGateSnapshot;
  phases: readonly PlanningPhaseStateV1[];
  revision: number;
  createdAt: string;
  updatedAt: string;
}>;
