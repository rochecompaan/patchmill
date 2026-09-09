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

export type WorkspaceReadyPlanningPhase = Readonly<{
  kind: PlanningPhaseKind;
  status: "workspace-ready";
  base: PlanningBaseEvidence;
  workspace: PlanningWorkspaceOwnership<{ state: "ready" }>;
  artifacts: readonly PlanningArtifactEvidence[];
}>;
export type BranchPushedPlanningPhase = Readonly<{
  kind: PlanningPhaseKind;
  status: "branch-pushed";
  base: PlanningBaseEvidence;
  workspace: PlanningWorkspaceOwnership<{ state: "ready" }>;
  artifacts: readonly PlanningArtifactEvidence[];
  publication: PlanningPublicationEvidence;
}>;
export type PullRequestOpenPlanningPhase = Readonly<{
  kind: PlanningPhaseKind;
  status: "pull-request-open";
  base: PlanningBaseEvidence;
  workspace: PlanningWorkspaceOwnership;
  artifacts: readonly PlanningArtifactEvidence[];
  publication: PlanningPublicationEvidence;
  pullRequest: PlanningPullRequestEvidence;
}>;
export type RemoteBaseCompletePlanningPhase = Readonly<{
  kind: PlanningPhaseKind;
  status: "complete";
  base: PlanningBaseEvidence;
  artifacts: readonly PlanningArtifactEvidence[];
  completion: Readonly<{ kind: "remote-base" }>;
}>;
export type MergedPullRequestCompletePlanningPhase = Readonly<{
  kind: PlanningPhaseKind;
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
export type PlanningPhaseStateV1 =
  | Readonly<{ kind: PlanningPhaseKind; status: "pending" }>
  | WorkspaceReadyPlanningPhase
  | BranchPushedPlanningPhase
  | PullRequestOpenPlanningPhase
  | RemoteBaseCompletePlanningPhase
  | MergedPullRequestCompletePlanningPhase;
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
