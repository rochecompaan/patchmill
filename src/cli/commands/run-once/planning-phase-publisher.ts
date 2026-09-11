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
  validatePlanningPullRequestSummary,
} from "../../../workflow/planning-pull-request-validation.ts";
import { finishPlanningPhaseCleanup } from "./planning-phase-cleanup.ts";

export type PlanningPhasePublicationResult =
  | Readonly<{
      kind: "published";
      state: PlanningStateV1;
      pullRequest: PullRequestSummary;
    }>
  | Readonly<{
      kind: "ambiguous";
      state: PlanningStateV1;
      pullRequests: readonly PullRequestSummary[];
    }>;
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
  const phaseKind = phase.kind as "spec" | "plan";
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
    const targetRepository = await input.host.resolveTargetRepositoryIdentity();
    const headRepository = await input.host.resolveRemoteRepositoryIdentity(
      phase.base.remote,
    );
    const publication = {
      targetRepository,
      headRepository,
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
    const remoteHead = await input.git.inspectRemoteHead({
      remote: phase.base.remote,
      branch: phase.workspace.identity.branch,
    });
    if (
      remoteHead.state !== "present" ||
      remoteHead.headOid !== phase.publication.headOid
    )
      throw new Error("Planning remote head changed");
    const matches = await input.host.findPullRequests({
      targetRepository: phase.publication.targetRepository,
      baseBranch: phase.publication.baseBranch,
      headRepository: phase.publication.headRepository,
      headBranch: phase.publication.headBranch,
    });
    if (matches.length > 1)
      return { kind: "ambiguous", state, pullRequests: matches };
    let summary: PullRequestSummary;
    if (matches.length === 1) summary = matches[0]!;
    else
      summary = await input.host.createPullRequest({
        title: planningPullRequestTitle({
          issueNumber: state.issueNumber,
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
    const validated = validatePlanningPullRequestSummary({
      summary,
      issueNumber: state.issueNumber,
      phase: phaseKind,
      publication: phase.publication,
    });
    const readBack = await input.host.getPullRequest(validated.reference);
    const confirmed = validatePlanningPullRequestSummary({
      summary: readBack,
      issueNumber: state.issueNumber,
      phase: phaseKind,
      publication: phase.publication,
      expectedReference: validated.reference,
    });
    phase = {
      ...phase,
      status: "pull-request-open",
      pullRequest: { reference: confirmed.reference, url: confirmed.url },
    };
    state = await replace({
      state,
      phaseIndex: input.phaseIndex,
      phase,
      lock: input.lock,
      stateStore: input.stateStore,
      now,
    });
  }
  if (phase.status !== "pull-request-open")
    throw new Error("Planning phase publication state is invalid");
  let pullRequest = await input.host.getPullRequest(
    phase.pullRequest.reference,
  );
  validatePlanningPullRequestSummary({
    summary: pullRequest,
    issueNumber: state.issueNumber,
    phase: phaseKind,
    publication: phase.publication,
    expectedReference: phase.pullRequest.reference,
  });
  phase = await finishPlanningPhaseCleanup({
    phase,
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
  pullRequest = await input.host.getPullRequest(phase.pullRequest.reference);
  validatePlanningPullRequestSummary({
    summary: pullRequest,
    issueNumber: state.issueNumber,
    phase: phaseKind,
    publication: phase.publication,
    expectedReference: phase.pullRequest.reference,
  });
  return { kind: "published", state, pullRequest };
}
