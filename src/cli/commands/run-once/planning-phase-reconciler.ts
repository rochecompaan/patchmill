import type { PlanningPublicationOperations } from "../../../git/planning-publication-git.ts";
import type { PlanningRemoteBaseGit } from "../../../git/planning-remote-base.ts";
import type { PlanningWorkspaceLifecycle } from "../../../git/planning-workspaces.ts";
import {
  PullRequestNotFoundError,
  type PullRequestHost,
  type PullRequestReference,
  type PullRequestSummary,
} from "../../../host/pull-requests.ts";
import type { PlanningIssueLock } from "../../../workflow/planning-issue-lock.ts";
import { replacePlanningPhase } from "../../../workflow/planning-phase-replacement.ts";
import type { PlanningStateStore } from "../../../workflow/planning-state-store.ts";
import type {
  BranchPushedPlanningPhase,
  PlanningArtifactEvidence,
  PlanningPhaseStateV1,
  PlanningStateV1,
  PullRequestOpenPlanningPhase,
} from "../../../workflow/planning-state-types.ts";
import {
  validatePlanningPullRequestIdentity,
  type ValidatedPlanningPullRequest,
} from "../../../workflow/planning-pull-request-validation.ts";
import {
  verifyPlanningMergedArtifacts,
  type PlanningMergedArtifactProof,
} from "./planning-merge-recovery.ts";
import {
  adoptPlanningPullRequestHead,
  planningHeadObservationBlocked,
  type PlanningHeadAdoptionBlockedOutcome,
} from "./planning-head-adoption.ts";
import { finishPlanningPhaseCleanup } from "./planning-phase-cleanup.ts";

export type PlanningMergeRecoveryBlockedOutcome = Readonly<{
  kind: "merge-recovery-blocked";
  pullRequest: Extract<PullRequestSummary, { status: "merged" }>;
  baseBranch: string;
  baseOid: string;
  recordedHeadOid: string;
  evidence: Extract<PlanningMergedArtifactProof, { kind: "blocked" }>;
}>;
export type PlanningPhaseReconciliation =
  | PlanningMergeRecoveryBlockedOutcome
  | PlanningHeadAdoptionBlockedOutcome
  | {
      kind: "cleanup-pending";
      prUrl: string;
      reason: "ignored-worktree-content";
      ignoredPaths: readonly string[];
    }
  | { kind: "review-pending"; pullRequest: PullRequestSummary }
  | { kind: "merged"; pullRequest: PullRequestSummary; baseOid: string }
  | {
      kind: "satisfied-by-base";
      artifacts: readonly PlanningArtifactEvidence[];
    }
  | { kind: "closed-unmerged"; pullRequest: PullRequestSummary }
  | { kind: "missing"; reference?: PullRequestReference }
  | { kind: "ambiguous"; pullRequests: readonly PullRequestSummary[] };

async function replace(
  state: PlanningStateV1,
  index: number,
  phase: PlanningPhaseStateV1,
  lock: PlanningIssueLock,
  stateStore: Pick<PlanningStateStore, "replace">,
  now: () => Date,
): Promise<PlanningStateV1> {
  return replacePlanningPhase({
    stateStore,
    lock,
    state,
    phaseIndex: index,
    phase,
    now,
  });
}

type PlanningPhaseReconcilerInput = Readonly<{
  state: PlanningStateV1;
  phaseIndex: number;
  lock: PlanningIssueLock;
  stateStore: Pick<PlanningStateStore, "replace">;
  host: PullRequestHost;
  remoteBase: Pick<PlanningRemoteBaseGit, "fetch">;
  git: Pick<
    PlanningPublicationOperations,
    "inspectRemoteHead" | "assertAncestor" | "assertRegularFiles"
  >;
  workspaces: PlanningWorkspaceLifecycle;
  now?: () => Date;
}>;

type ReconciliablePlanningPhase =
  | BranchPushedPlanningPhase
  | PullRequestOpenPlanningPhase;
type PlanningReconciliationResult = Readonly<{
  state: PlanningStateV1;
  outcome: PlanningPhaseReconciliation;
}>;

async function reconcileOpenPlanningPullRequest(input: {
  reconciler: PlanningPhaseReconcilerInput;
  state: PlanningStateV1;
  phase: ReconciliablePlanningPhase;
  validated: ValidatedPlanningPullRequest;
  now: () => Date;
}): Promise<PlanningReconciliationResult> {
  const { reconciler, validated, now } = input;
  const adoption = await adoptPlanningPullRequestHead({
    state: input.state,
    phaseIndex: reconciler.phaseIndex,
    validated,
    lock: reconciler.lock,
    stateStore: reconciler.stateStore,
    workspaces: reconciler.workspaces,
    now,
  });
  if (adoption.kind === "head-adoption-blocked")
    return { state: input.state, outcome: adoption };
  let state = adoption.state;
  const cleanup = await finishPlanningPhaseCleanup({
    phase: adoption.phase,
    workspaces: reconciler.workspaces,
    authorization: {
      kind: "publication",
      remoteHead: (published) =>
        reconciler.git.inspectRemoteHead({
          remote: published.base.remote,
          branch: published.workspace.identity.branch,
        }),
    },
    checkpoint: async (next) => {
      state = await replace(
        state,
        reconciler.phaseIndex,
        next,
        reconciler.lock,
        reconciler.stateStore,
        now,
      );
    },
  });
  if (cleanup.kind === "remote-head-changed")
    return {
      state,
      outcome: planningHeadObservationBlocked({
        phase: cleanup.phase,
        failure:
          cleanup.remoteHead.state === "missing"
            ? "remote-missing"
            : "head-moved",
        hostHeadOid: validated.summary.headSha,
        ...(cleanup.remoteHead.state === "present"
          ? { remoteHeadOid: cleanup.remoteHead.headOid }
          : {}),
        pullRequestUrl: validated.url,
      }),
    };
  if (cleanup.kind === "cleanup-pending")
    return {
      state,
      outcome: {
        kind: "cleanup-pending",
        prUrl: validated.url,
        reason: cleanup.reason,
        ignoredPaths: cleanup.ignoredPaths,
      },
    };
  return {
    state,
    outcome: { kind: "review-pending", pullRequest: validated.summary },
  };
}

async function reconcileMergedPlanningPullRequest(input: {
  reconciler: PlanningPhaseReconcilerInput;
  state: PlanningStateV1;
  phase: ReconciliablePlanningPhase;
  validated: ValidatedPlanningPullRequest;
  now: () => Date;
}): Promise<PlanningReconciliationResult> {
  const { reconciler, validated, now } = input;
  const summary = validated.summary;
  if (summary.status !== "merged")
    throw new RangeError("Planning pull request is not merged");
  const snapshot = await reconciler.remoteBase.fetch({
    issueNumber: input.state.issueNumber,
    remote: input.phase.base.remote,
    baseBranch: input.phase.base.baseBranch,
  });
  const evidence = await verifyPlanningMergedArtifacts({
    mergeOid: summary.mergeCommit,
    artifacts: input.phase.artifacts,
    base: snapshot,
    git: reconciler.git,
  });
  if (evidence.kind === "blocked")
    return {
      state: input.state,
      outcome: {
        kind: "merge-recovery-blocked",
        pullRequest: summary,
        recordedHeadOid: input.phase.publication.headOid,
        baseBranch: input.phase.base.baseBranch,
        baseOid: snapshot.baseOid,
        evidence,
      },
    };
  let state = input.state;
  let phase: PullRequestOpenPlanningPhase;
  if (input.phase.status === "branch-pushed") {
    phase = {
      ...input.phase,
      status: "pull-request-open",
      pullRequest: { reference: validated.reference, url: validated.url },
    };
    state = await replace(
      state,
      reconciler.phaseIndex,
      phase,
      reconciler.lock,
      reconciler.stateStore,
      now,
    );
  } else phase = input.phase;
  const cleanup = await finishPlanningPhaseCleanup({
    phase,
    workspaces: reconciler.workspaces,
    authorization: { kind: "merged-terminal" },
    checkpoint: async (next) => {
      state = await replace(
        state,
        reconciler.phaseIndex,
        next,
        reconciler.lock,
        reconciler.stateStore,
        now,
      );
    },
  });
  if (cleanup.kind === "cleanup-pending")
    return {
      state,
      outcome: {
        kind: "cleanup-pending",
        prUrl: validated.url,
        reason: cleanup.reason,
        ignoredPaths: cleanup.ignoredPaths,
      },
    };
  const completed = {
    ...cleanup.phase,
    status: "complete" as const,
    artifacts: cleanup.phase.artifacts.map((artifact) => ({
      ...artifact,
      source: "remote-base" as const,
      commitOid: snapshot.baseOid,
    })),
    completion: {
      kind: "merged-pull-request" as const,
      mergeOid: summary.mergeCommit,
      mergedBaseOid: snapshot.baseOid,
    },
  } as PlanningPhaseStateV1;
  state = await replace(
    state,
    reconciler.phaseIndex,
    completed,
    reconciler.lock,
    reconciler.stateStore,
    now,
  );
  return {
    state,
    outcome: {
      kind: "merged",
      pullRequest: summary,
      baseOid: snapshot.baseOid,
    },
  };
}

export async function reconcilePlanningPhase(
  input: PlanningPhaseReconcilerInput,
): Promise<PlanningReconciliationResult> {
  const now = input.now ?? (() => new Date());
  const state = input.state;
  const phase = state.phases[input.phaseIndex];
  if (phase === undefined)
    throw new RangeError("Planning phase index is invalid");
  if (phase.kind === "implementation")
    throw new RangeError("Planning phase is not reconcilable");
  if (phase.status === "complete" && phase.completion.kind === "remote-base")
    return {
      state,
      outcome: { kind: "satisfied-by-base", artifacts: phase.artifacts },
    };
  const phaseKind = phase.kind;
  let pullRequest: PullRequestSummary;
  let expectedReference: PullRequestReference | undefined;
  if (phase.status === "branch-pushed") {
    const matches = await input.host.findPullRequests({
      targetRepository: phase.publication.targetRepository,
      baseBranch: phase.publication.baseBranch,
      headRepository: phase.publication.headRepository,
      headBranch: phase.publication.headBranch,
    });
    if (matches.length === 0) {
      const remote = await input.git.inspectRemoteHead({
        remote: phase.base.remote,
        branch: phase.workspace.identity.branch,
      });
      if (
        remote.state === "present" &&
        remote.headOid === phase.publication.headOid
      )
        return { state, outcome: { kind: "missing" } };
      return {
        state,
        outcome: planningHeadObservationBlocked({
          phase,
          failure:
            remote.state === "missing" ? "remote-missing" : "head-disagreement",
          ...(remote.state === "present"
            ? { remoteHeadOid: remote.headOid }
            : {}),
        }),
      };
    }
    if (matches.length > 1)
      return { state, outcome: { kind: "ambiguous", pullRequests: matches } };
    const found = validatePlanningPullRequestIdentity({
      summary: matches[0]!,
      issueNumber: state.issueNumber,
      phase: phaseKind,
      publication: phase.publication,
    });
    expectedReference = found.reference;
    try {
      pullRequest = await input.host.getPullRequest(found.reference);
    } catch (error) {
      if (error instanceof PullRequestNotFoundError)
        return {
          state,
          outcome: { kind: "missing", reference: found.reference },
        };
      throw error;
    }
  } else {
    if (phase.status !== "pull-request-open")
      throw new Error("Planning phase is not reconcilable");
    try {
      pullRequest = await input.host.getPullRequest(
        phase.pullRequest.reference,
      );
    } catch (error) {
      if (error instanceof PullRequestNotFoundError)
        return {
          state,
          outcome: { kind: "missing", reference: phase.pullRequest.reference },
        };
      throw error;
    }
  }
  const validated = validatePlanningPullRequestIdentity({
    summary: pullRequest,
    issueNumber: state.issueNumber,
    phase: phaseKind,
    publication: phase.publication,
    ...(phase.status === "pull-request-open"
      ? { expectedReference: phase.pullRequest.reference }
      : expectedReference === undefined
        ? {}
        : { expectedReference }),
  });
  switch (validated.summary.status) {
    case "closed-unmerged":
      return {
        state,
        outcome: { kind: "closed-unmerged", pullRequest: validated.summary },
      };
    case "open":
      return reconcileOpenPlanningPullRequest({
        reconciler: input,
        state,
        phase,
        validated,
        now,
      });
    case "merged":
      return reconcileMergedPlanningPullRequest({
        reconciler: input,
        state,
        phase,
        validated,
        now,
      });
  }
}
