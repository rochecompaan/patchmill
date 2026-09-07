import type {
  PlanningRemoteBaseSnapshot,
  PlanningWorkspaceOwnership,
} from "../git/planning-workspaces.ts";
import type { PullRequestReference } from "../host/pull-requests.ts";
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
export type PlanningPullRequestEvidence = Readonly<{
  reference: PullRequestReference;
  baseBranch: string;
  headBranch: string;
  headOid: string;
}>;
export type PlanningPhaseStateV1 =
  | Readonly<{ kind: PlanningPhaseKind; status: "pending" }>
  | Readonly<{
      kind: PlanningPhaseKind;
      status: "workspace-ready";
      base: PlanningBaseEvidence;
      workspace: PlanningWorkspaceEvidence;
    }>
  | Readonly<{
      kind: PlanningPhaseKind;
      status: "pull-request-open";
      base: PlanningBaseEvidence;
      workspace: PlanningWorkspaceEvidence;
      artifacts: readonly PlanningArtifactEvidence[];
      pullRequest: PlanningPullRequestEvidence;
    }>
  | Readonly<{
      kind: PlanningPhaseKind;
      status: "complete";
      base: PlanningBaseEvidence;
      artifacts: readonly PlanningArtifactEvidence[];
      completion: Readonly<{ kind: "remote-base" }>;
    }>
  | Readonly<{
      kind: PlanningPhaseKind;
      status: "complete";
      base: PlanningBaseEvidence;
      workspace: PlanningWorkspaceEvidence;
      artifacts: readonly PlanningArtifactEvidence[];
      pullRequest: PlanningPullRequestEvidence;
      completion: Readonly<{ kind: "merged-pull-request"; mergeOid: string }>;
    }>;
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
