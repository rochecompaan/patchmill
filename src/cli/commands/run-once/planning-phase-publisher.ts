import type { PlanningPublicationOperations } from "../../../git/planning-publication-git.ts";
import type { PlanningWorkspaceLifecycle } from "../../../git/planning-workspaces.ts";
import type {
  PullRequestHost,
  PullRequestSummary,
} from "../../../host/pull-requests.ts";
import {
  planningPhasePlan,
  planningPullRequestBody,
  planningPullRequestTitle,
} from "../../../workflow/planning-pull-requests.ts";
import type { PlanningIssueLock } from "../../../workflow/planning-issue-lock.ts";
import { replacePlanningPhase } from "../../../workflow/planning-phase-replacement.ts";
import type { PlanningStateStore } from "../../../workflow/planning-state-store.ts";
import type {
  PlanningPhaseStateV1,
  PlanningStateV1,
} from "../../../workflow/planning-state-types.ts";
import {
  assertPlanningPublicationRepositories,
  validatePlanningPullRequestIdentity,
} from "../../../workflow/planning-pull-request-validation.ts";
import {
  adoptPlanningPullRequestHead,
  planningHeadObservationBlocked,
  type PlanningHeadAdoptionBlockedOutcome,
} from "./planning-head-adoption.ts";
import { finishPlanningPhaseCleanup } from "./planning-phase-cleanup.ts";

export type PlanningPhasePublicationResult =
  | Readonly<{
      kind: "cleanup-pending";
      state: PlanningStateV1;
      phase: "spec" | "plan";
      prUrl: string;
      reason: "ignored-worktree-content";
      ignoredPaths: readonly string[];
    }>
  | Readonly<{
      kind: "published";
      state: PlanningStateV1;
      pullRequest: PullRequestSummary;
    }>
  | Readonly<{
      kind: "ambiguous";
      state: PlanningStateV1;
      pullRequests: readonly PullRequestSummary[];
    }>
  | (PlanningHeadAdoptionBlockedOutcome & Readonly<{ state: PlanningStateV1 }>);

async function replace(input: {
  state: PlanningStateV1;
  phaseIndex: number;
  phase: PlanningPhaseStateV1;
  lock: PlanningIssueLock;
  stateStore: Pick<PlanningStateStore, "replace">;
  now: () => Date;
}): Promise<PlanningStateV1> {
  return replacePlanningPhase(input);
}

export async function publishPlanningPhase(input: {
  state: PlanningStateV1;
  phaseIndex: number;
  lock: PlanningIssueLock;
  stateStore: Pick<PlanningStateStore, "replace">;
  host: PullRequestHost;
  git: Pick<
    PlanningPublicationOperations,
    "verifyWorkspace" | "inspectRemoteHead" | "ensureRemoteHead"
  >;
  workspaces: PlanningWorkspaceLifecycle;
  now?: () => Date;
}): Promise<PlanningPhasePublicationResult> {
  const now = input.now ?? (() => new Date());
  let state = input.state;
  let phase = state.phases[input.phaseIndex];
  if (phase === undefined || phase.kind === "implementation")
    throw new RangeError("Planning phase is not publishable");
  const phaseKind = phase.kind;
  const assignedArtifacts = planningPhasePlan(state.gates)[input.phaseIndex]!
    .artifactKinds;
  if (phase.status === "workspace-ready") {
    if (
      phase.artifacts.length !== assignedArtifacts.length ||
      phase.artifacts.some(
        (artifact, index) => artifact.kind !== assignedArtifacts[index],
      )
    )
      throw new Error("Planning workspace artifacts are incomplete");
    await input.workspaces.resume({
      runId: state.runId,
      phase: phase.kind,
      identity: phase.workspace.identity,
      base: phase.base,
      saved: phase.workspace,
    });
    await input.git.verifyWorkspace({
      workspacePath: phase.workspace.identity.worktreePath,
      baseOid: phase.base.baseOid,
      headOid: phase.workspace.headOid,
      artifactPaths: phase.artifacts.map((artifact) => artifact.path),
    });
    const publication = {
      targetRepository: await input.host.resolveTargetRepositoryIdentity(),
      headRepository: await input.host.resolveRemoteRepositoryIdentity(
        phase.base.remote,
      ),
      baseBranch: phase.base.baseBranch,
      headBranch: phase.workspace.identity.branch,
      headOid: phase.workspace.headOid,
    };
    assertPlanningPublicationRepositories(publication);
    await input.git.ensureRemoteHead({
      remote: phase.base.remote,
      branch: phase.workspace.identity.branch,
      headOid: phase.workspace.headOid,
    });
    phase = { ...phase, status: "branch-pushed", publication };
    state = await replace({
      state,
      phaseIndex: input.phaseIndex,
      phase,
      lock: input.lock,
      stateStore: input.stateStore,
      now,
    });
  }
  if (phase.status === "branch-pushed") {
    const remote = await input.git.inspectRemoteHead({
      remote: phase.base.remote,
      branch: phase.workspace.identity.branch,
    });
    const matches = await input.host.findPullRequests({
      targetRepository: phase.publication.targetRepository,
      baseBranch: phase.publication.baseBranch,
      headRepository: phase.publication.headRepository,
      headBranch: phase.publication.headBranch,
    });
    if (matches.length > 1)
      return { kind: "ambiguous", state, pullRequests: matches };
    let observed: PullRequestSummary;
    if (matches.length === 0) {
      if (
        remote.state !== "present" ||
        remote.headOid !== phase.publication.headOid
      )
        return {
          state,
          ...planningHeadObservationBlocked({
            phase,
            failure:
              remote.state === "missing"
                ? "remote-missing"
                : "head-disagreement",
            ...(remote.state === "present"
              ? { remoteHeadOid: remote.headOid }
              : {}),
          }),
        };
      observed = await input.host.createPullRequest({
        title: planningPullRequestTitle({
          issueNumber: state.issueNumber,
          issueTitle: state.issueTitle,
          phase: phaseKind,
        }),
        body: planningPullRequestBody({
          issueNumber: state.issueNumber,
          phase: phaseKind,
          artifactPaths: phase.artifacts.map((artifact) => artifact.path),
        }),
        baseBranch: phase.publication.baseBranch,
        headBranch: phase.publication.headBranch,
      });
    } else observed = matches[0]!;
    const found = validatePlanningPullRequestIdentity({
      summary: observed,
      issueNumber: state.issueNumber,
      phase: phaseKind,
      publication: phase.publication,
    });
    const confirmed = validatePlanningPullRequestIdentity({
      summary: await input.host.getPullRequest(found.reference),
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
    if (adoption.kind === "head-adoption-blocked") return adoption;
    state = adoption.state;
    phase = adoption.phase;
  }
  if (phase.status !== "pull-request-open")
    throw new Error("Planning phase publication state is invalid");
  let pullRequest = await input.host.getPullRequest(
    phase.pullRequest.reference,
  );
  let validated = validatePlanningPullRequestIdentity({
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
  if (adoption.kind === "head-adoption-blocked") return adoption;
  state = adoption.state;
  phase = adoption.phase;
  const cleanup = await finishPlanningPhaseCleanup({
    phase,
    workspaces: input.workspaces,
    remoteHead: (published) =>
      input.git.inspectRemoteHead({
        remote: published.base.remote,
        branch: published.workspace.identity.branch,
      }),
    checkpoint: async (next) => {
      state = await replace({
        state,
        phaseIndex: input.phaseIndex,
        phase: next,
        lock: input.lock,
        stateStore: input.stateStore,
        now,
      });
    },
  });
  if (cleanup.kind === "remote-head-changed")
    return {
      state,
      ...planningHeadObservationBlocked({
        phase: cleanup.phase,
        failure:
          cleanup.remoteHead.state === "missing"
            ? "remote-missing"
            : "head-moved",
        hostHeadOid: validated.summary.headSha,
        ...(cleanup.remoteHead.state === "present"
          ? { remoteHeadOid: cleanup.remoteHead.headOid }
          : {}),
        pullRequestUrl: phase.pullRequest.url,
      }),
    };
  if (cleanup.kind === "cleanup-pending")
    return {
      kind: "cleanup-pending",
      state,
      phase: phase.kind,
      prUrl: phase.pullRequest.url,
      reason: cleanup.reason,
      ignoredPaths: cleanup.ignoredPaths,
    };
  phase = cleanup.phase;
  pullRequest = await input.host.getPullRequest(phase.pullRequest.reference);
  validated = validatePlanningPullRequestIdentity({
    summary: pullRequest,
    issueNumber: state.issueNumber,
    phase: phaseKind,
    publication: phase.publication,
    expectedReference: phase.pullRequest.reference,
  });
  const finalAdoption = await adoptPlanningPullRequestHead({
    state,
    phaseIndex: input.phaseIndex,
    validated,
    lock: input.lock,
    stateStore: input.stateStore,
    workspaces: input.workspaces,
    now,
  });
  if (finalAdoption.kind === "head-adoption-blocked") return finalAdoption;
  return {
    kind: "published",
    state: finalAdoption.state,
    pullRequest: validated.summary,
  };
}
