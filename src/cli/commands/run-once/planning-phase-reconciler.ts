import {
  PlanningPublicationGitError,
  type PlanningPublicationOperations,
} from "../../../git/planning-publication-git.ts";
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
  PlanningArtifactEvidence,
  PlanningPhaseStateV1,
  PlanningStateV1,
} from "../../../workflow/planning-state-types.ts";
import { validatePlanningPullRequestIdentity } from "../../../workflow/planning-pull-request-validation.ts";
import {
  verifyPlanningMergeRecoveryEvidence,
  type PlanningMergeRecoveryResult,
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
  evidence: Extract<PlanningMergeRecoveryResult, { kind: "blocked" }>;
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

export async function reconcilePlanningPhase(input: {
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
}): Promise<
  Readonly<{ state: PlanningStateV1; outcome: PlanningPhaseReconciliation }>
> {
  const now = input.now ?? (() => new Date());
  let state = input.state;
  let phase = state.phases[input.phaseIndex];
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
  let pullRequest: PullRequestSummary | undefined;
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
    let read: PullRequestSummary;
    try {
      read = await input.host.getPullRequest(found.reference);
    } catch (error) {
      if (error instanceof PullRequestNotFoundError)
        return {
          state,
          outcome: { kind: "missing", reference: found.reference },
        };
      throw error;
    }
    const confirmed = validatePlanningPullRequestIdentity({
      summary: read,
      issueNumber: state.issueNumber,
      phase: phaseKind,
      publication: phase.publication,
      expectedReference: found.reference,
    });
    const adoption = await adoptPlanningPullRequestHead({
      state,
      phaseIndex: input.phaseIndex,
      validated: confirmed,
      lock: input.lock,
      stateStore: input.stateStore,
      workspaces: input.workspaces,
      now,
    });
    if (adoption.kind === "head-adoption-blocked")
      return { state, outcome: adoption };
    state = adoption.state;
    phase = adoption.phase;
    pullRequest = confirmed.summary;
  }
  if (phase.status !== "pull-request-open")
    throw new Error("Planning phase is not reconcilable");
  if (pullRequest === undefined) {
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
    expectedReference: phase.pullRequest.reference,
  });
  const adoption = await adoptPlanningPullRequestHead({
    state,
    phaseIndex: input.phaseIndex,
    validated,
    lock: input.lock,
    stateStore: input.stateStore,
    workspaces: input.workspaces,
    now,
  });
  if (adoption.kind === "head-adoption-blocked")
    return { state, outcome: adoption };
  state = adoption.state;
  phase = adoption.phase;
  pullRequest = validated.summary;
  const cleanup = await finishPlanningPhaseCleanup({
    phase,
    workspaces: input.workspaces,
    remoteHead: (published) =>
      input.git.inspectRemoteHead({
        remote: published.base.remote,
        branch: published.workspace.identity.branch,
      }),
    checkpoint: async (next) => {
      state = await replace(
        state,
        input.phaseIndex,
        next,
        input.lock,
        input.stateStore,
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
        hostHeadOid: pullRequest.headSha,
        ...(cleanup.remoteHead.state === "present"
          ? { remoteHeadOid: cleanup.remoteHead.headOid }
          : {}),
        pullRequestUrl: phase.pullRequest.url,
      }),
    };
  if (cleanup.kind === "cleanup-pending")
    return {
      state,
      outcome: {
        kind: "cleanup-pending",
        prUrl: phase.pullRequest.url,
        reason: cleanup.reason,
        ignoredPaths: cleanup.ignoredPaths,
      },
    };
  phase = cleanup.phase;
  if (pullRequest.status === "open")
    return { state, outcome: { kind: "review-pending", pullRequest } };
  if (pullRequest.status === "closed-unmerged")
    return { state, outcome: { kind: "closed-unmerged", pullRequest } };
  const snapshot = await input.remoteBase.fetch({
    issueNumber: state.issueNumber,
    remote: phase.base.remote,
    baseBranch: phase.base.baseBranch,
  });
  let recoveredAtCurrentBase = false;
  try {
    await input.git.assertAncestor({
      ancestorOid: pullRequest.mergeCommit,
      descendantOid: snapshot.baseOid,
    });
  } catch (error) {
    if (
      !(error instanceof PlanningPublicationGitError) ||
      error.operation !== "ancestry" ||
      error.reason !== "not-ancestor"
    )
      throw error;
    const evidence = await verifyPlanningMergeRecoveryEvidence({
      artifacts: phase.artifacts,
      base: snapshot,
      git: input.git,
    });
    if (evidence.kind === "blocked")
      return {
        state,
        outcome: {
          kind: "merge-recovery-blocked",
          pullRequest,
          baseBranch: phase.base.baseBranch,
          baseOid: snapshot.baseOid,
          evidence,
        },
      };
    recoveredAtCurrentBase = true;
  }
  const paths = phase.artifacts.map((artifact) => artifact.path);
  if (!recoveredAtCurrentBase) {
    await input.git.assertRegularFiles({
      commitOid: pullRequest.mergeCommit,
      paths,
    });
    await input.git.assertRegularFiles({ commitOid: snapshot.baseOid, paths });
  }
  const completed = {
    ...phase,
    status: "complete" as const,
    artifacts: phase.artifacts.map((artifact) => ({
      ...artifact,
      source: "remote-base" as const,
      commitOid: snapshot.baseOid,
    })),
    completion: {
      kind: "merged-pull-request" as const,
      mergeOid: pullRequest.mergeCommit,
      mergedBaseOid: snapshot.baseOid,
    },
  } as PlanningPhaseStateV1;
  state = await replace(
    state,
    input.phaseIndex,
    completed,
    input.lock,
    input.stateStore,
    now,
  );
  return {
    state,
    outcome: { kind: "merged", pullRequest, baseOid: snapshot.baseOid },
  };
}
