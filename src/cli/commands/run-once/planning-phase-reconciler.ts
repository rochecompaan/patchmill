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
import type { PlanningStateStore } from "../../../workflow/planning-state-store.ts";
import type {
  PlanningArtifactEvidence,
  PlanningPhaseStateV1,
  PlanningStateV1,
  PullRequestOpenPlanningPhase,
} from "../../../workflow/planning-state-types.ts";
import { validatePlanningPullRequestSummary } from "../../../workflow/planning-pull-request-validation.ts";
import { finishPlanningPhaseCleanup } from "./planning-phase-cleanup.ts";

export type PlanningPhaseReconciliation =
  | { kind: "review-pending"; pullRequest: PullRequestSummary }
  | { kind: "merged"; pullRequest: PullRequestSummary; baseOid: string }
  | {
      kind: "satisfied-by-base";
      artifacts: readonly PlanningArtifactEvidence[];
    }
  | { kind: "closed-unmerged"; pullRequest: PullRequestSummary }
  | { kind: "missing"; reference?: PullRequestReference }
  | { kind: "ambiguous"; pullRequests: readonly PullRequestSummary[] };
function nextState(
  state: PlanningStateV1,
  index: number,
  phase: PlanningPhaseStateV1,
  now: () => Date,
): PlanningStateV1 {
  return {
    ...state,
    revision: state.revision + 1,
    updatedAt: now().toISOString(),
    phases: state.phases.map((item, offset) =>
      offset === index ? phase : item,
    ),
  };
}
async function replace(
  state: PlanningStateV1,
  index: number,
  phase: PlanningPhaseStateV1,
  lock: PlanningIssueLock,
  stateStore: Pick<PlanningStateStore, "replace">,
  now: () => Date,
): Promise<PlanningStateV1> {
  const next = nextState(state, index, phase, now);
  return stateStore.replace({
    issueNumber: state.issueNumber,
    expectedRunId: state.runId,
    expectedRevision: state.revision,
    next,
    lock,
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
  let pullRequest: PullRequestSummary | undefined;
  if (phase.status === "branch-pushed") {
    const matches = await input.host.findPullRequests({
      targetRepository: phase.publication.targetRepository,
      baseBranch: phase.publication.baseBranch,
      headRepository: phase.publication.headRepository,
      headBranch: phase.publication.headBranch,
    });
    if (matches.length === 0) return { state, outcome: { kind: "missing" } };
    if (matches.length > 1)
      return { state, outcome: { kind: "ambiguous", pullRequests: matches } };
    const phaseKind = phase.kind as "spec" | "plan";
    const found = validatePlanningPullRequestSummary({
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
    const confirmed = validatePlanningPullRequestSummary({
      summary: read,
      issueNumber: state.issueNumber,
      phase: phaseKind,
      publication: phase.publication,
      expectedReference: found.reference,
    });
    pullRequest = confirmed.summary;
    phase = {
      ...phase,
      status: "pull-request-open",
      pullRequest: { reference: confirmed.reference, url: confirmed.url },
    };
    state = await replace(
      state,
      input.phaseIndex,
      phase,
      input.lock,
      input.stateStore,
      now,
    );
  }
  if (phase.status !== "pull-request-open")
    throw new Error("Planning phase is not reconcilable");
  const phaseKind = phase.kind as "spec" | "plan";
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
  validatePlanningPullRequestSummary({
    summary: pullRequest,
    issueNumber: state.issueNumber,
    phase: phaseKind,
    publication: phase.publication,
    expectedReference: phase.pullRequest.reference,
  });
  phase = await finishPlanningPhaseCleanup({
    phase: phase as PullRequestOpenPlanningPhase,
    workspaces: input.workspaces,
    remoteHead: async (published) => {
      const head = await input.git.inspectRemoteHead({
        remote: published.base.remote,
        branch: published.workspace.identity.branch,
      });
      if (
        head.state !== "present" ||
        head.headOid !== published.publication.headOid
      )
        throw new Error("Planning remote head changed");
    },
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
  if (pullRequest.status === "open")
    return { state, outcome: { kind: "review-pending", pullRequest } };
  if (pullRequest.status === "closed-unmerged")
    return { state, outcome: { kind: "closed-unmerged", pullRequest } };
  const snapshot = await input.remoteBase.fetch({
    issueNumber: state.issueNumber,
    remote: phase.base.remote,
    baseBranch: phase.base.baseBranch,
  });
  await input.git.assertAncestor({
    ancestorOid: pullRequest.mergeCommit,
    descendantOid: snapshot.baseOid,
  });
  const paths = phase.artifacts.map((artifact) => artifact.path);
  await input.git.assertRegularFiles({
    commitOid: pullRequest.mergeCommit,
    paths,
  });
  await input.git.assertRegularFiles({ commitOid: snapshot.baseOid, paths });
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
