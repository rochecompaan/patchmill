import type {
  ImplementationWorkspaceReadyPlanningPhase,
  PlanningStateV1,
} from "../../../workflow/planning-state-types.ts";
import { parseCanonicalPullRequestUrl } from "../../../host/pull-request-reference.ts";
import { reconcileImplementationPullRequest } from "../../../workflow/implementation-pr-reconciliation.ts";
import { PlanningWorkspaceConflictError } from "../../../git/planning-workspaces.ts";
import {
  changedImplementationPublication,
  invalidateImplementationChecks,
} from "./planning-implementation-revalidation.ts";
import { assertPlanningImplementationBase } from "./planning-implementation-base.ts";
import {
  blocked,
  replacePhase,
  runWorkspaceArtifacts,
  type PlanningPhaseRunnerInput,
  type PlanningPhaseRunnerOutcome,
} from "./planning-phase-runner-shared.ts";
import { runOnceFailure } from "./result-diagnostics.ts";

/** Decide on retries before execution, then converge on canonical workspace preparation. */
export async function preparePlanningImplementationRevalidation(
  input: PlanningPhaseRunnerInput,
  state: PlanningStateV1,
): Promise<
  | PlanningPhaseRunnerOutcome
  | {
      kind: "workspace-ready";
      state: PlanningStateV1;
      workspaceCreated: boolean;
    }
> {
  let phase = state.phases[input.phaseIndex];
  if (phase?.kind !== "implementation")
    throw new RangeError("Invalid implementation retry");
  if (phase.status === "workspace-ready" && phase.revalidation) {
    state = await replacePhase(input, state, {
      ...phase,
      status: "revalidation-pending",
      revalidation: phase.revalidation,
    });
    phase = state.phases[input.phaseIndex];
    if (phase?.kind !== "implementation")
      throw new RangeError("Invalid prepared retry");
  }
  if (phase.status === "branch-pushed") {
    const changed = await changedImplementationPublication(
      { workspaces: input.workspaces, git: input.publicationGit },
      phase,
    );
    if (!changed) return { kind: "advanced", state };
    state = await replacePhase(input, state, changed);
    phase = changed;
  } else if (phase.status === "pull-request-open") {
    const published = phase;
    const observed = await reconcileImplementationPullRequest({
      host: input.host,
      issueNumber: state.issueNumber,
      evidence: {
        ...phase.pullRequest,
        publication: phase.publication,
        ownershipMarkerRequired: true,
      },
      fetchBase: () =>
        input.remoteBase.fetch({
          issueNumber: state.issueNumber,
          remote: published.base.remote,
          baseBranch: published.base.baseBranch,
          targetRepository: published.publication.targetRepository,
        }),
      git: input.publicationGit,
    });
    if (observed.kind !== "open") return { kind: "advanced", state };
    if (observed.headOid === phase.publication.headOid) {
      const snapshot = await input.workspaces.inspect(phase.workspace.identity);
      if (
        snapshot.state !== "ready" ||
        snapshot.headOid === phase.workspace.headOid
      )
        return { kind: "advanced", state };
    }
    state = await replacePhase(
      input,
      state,
      invalidateImplementationChecks(phase),
    );
    phase = state.phases[input.phaseIndex];
  }
  if (
    phase?.kind !== "implementation" ||
    phase.status !== "revalidation-pending"
  )
    return { kind: "advanced", state };
  const receipt = phase.revalidation;
  const savedBase = phase.base;
  const pullRequest =
    receipt.pullRequest ??
    parseCanonicalPullRequestUrl(
      receipt.implementation.prUrl,
      receipt.publication.targetRepository,
    );
  const fail = (reason: string): PlanningPhaseRunnerOutcome => ({
    kind: "blocked",
    state,
    result: blocked(
      reason,
      runOnceFailure("implementation-evidence", {
        issueNumber: state.issueNumber,
        status: "blocked",
        validation: reason,
      }),
    ),
  });
  if (!pullRequest) return fail("Saved implementation PR cannot be identified");
  const observed = await reconcileImplementationPullRequest({
    host: input.host,
    issueNumber: state.issueNumber,
    evidence: {
      reference: pullRequest.reference,
      url: pullRequest.url,
      publication: receipt.publication,
      ownershipMarkerRequired: true,
    },
    fetchBase: () =>
      input.remoteBase.fetch({
        issueNumber: state.issueNumber,
        remote: savedBase.remote,
        baseBranch: receipt.publication.baseBranch,
        targetRepository: receipt.publication.targetRepository,
      }),
    git: input.publicationGit,
  });
  if (observed.kind === "blocked") return fail(observed.reason);
  if (observed.kind === "merged") {
    state = await replacePhase(input, state, {
      kind: "implementation",
      status: "pull-request-open",
      base: phase.base,
      workspace: phase.workspace,
      artifacts: phase.artifacts,
      publication: receipt.publication,
      implementation: receipt.implementation,
      pullRequest,
      finish: receipt.finish ?? {},
      observedHeadOid: observed.headOid,
      merge: {
        mergeOid: observed.mergeOid,
        mergedBaseOid: observed.mergedBaseOid,
      },
    });
    return { kind: "advanced", state };
  }
  if (input.issue.state !== "open")
    return fail("Issue is closed but its saved PR is unmerged");
  const expectedIdentity = input.config.workspaceIdentity(input.phase);
  if (
    expectedIdentity.branch !== phase.workspace.identity.branch ||
    expectedIdentity.worktreePath !== phase.workspace.identity.worktreePath
  )
    throw new PlanningWorkspaceConflictError(
      "invalid-saved-identity",
      phase.workspace.identity,
    );
  const remote = await input.publicationGit.inspectRemoteHead({
    remote: phase.base.remote,
    branch: phase.workspace.identity.branch,
  });
  if (remote.state !== "present" || remote.headOid !== observed.headOid)
    return fail("Implementation PR and remote branch disagree during recovery");
  if (receipt.observedHeadOid !== observed.headOid) {
    phase = {
      ...phase,
      revalidation: { ...receipt, observedHeadOid: observed.headOid },
    };
    state = await replacePhase(input, state, phase);
  }
  const base = await input.remoteBase.fetch({
    issueNumber: state.issueNumber,
    remote: phase.base.remote,
    baseBranch: phase.base.baseBranch,
    targetRepository: receipt.publication.targetRepository,
  });
  await assertPlanningImplementationBase({
    state,
    phaseIndex: input.phaseIndex,
    base,
    git: input.publicationGit,
  });
  const before = await input.workspaces.inspect(phase.workspace.identity);
  await input.workspaces.resume({
    runId: state.runId,
    phase: "implementation",
    identity: phase.workspace.identity,
    base: phase.base,
    saved: phase.workspace,
    restoreHeadOid: observed.headOid,
  });
  // This candidate is NOT persisted. Reconciliation keeps the old saved head until
  // ownership, clean status, and base ancestry are proved at the checkpoint edge.
  const ready: ImplementationWorkspaceReadyPlanningPhase = {
    ...phase,
    status: "workspace-ready",
    workspace: { ...phase.workspace, cleanup: { state: "ready" } },
  };
  const prepared = await runWorkspaceArtifacts(
    input,
    {
      ...state,
      phases: state.phases.map((entry, index) =>
        index === input.phaseIndex ? ready : entry,
      ),
    },
    state,
  );
  if (prepared.kind !== "workspace-ready") return prepared;
  state = prepared.state;
  // Re-read the owned PR at the last pre-agent boundary; restoration or artifact
  // recovery may have taken long enough for a human merge or another push.
  const latest = await reconcileImplementationPullRequest({
    host: input.host,
    issueNumber: state.issueNumber,
    evidence: {
      reference: pullRequest.reference,
      url: pullRequest.url,
      publication: receipt.publication,
      ownershipMarkerRequired: true,
    },
    fetchBase: () =>
      input.remoteBase.fetch({
        issueNumber: state.issueNumber,
        remote: savedBase.remote,
        baseBranch: savedBase.baseBranch,
        targetRepository: receipt.publication.targetRepository,
      }),
    git: input.publicationGit,
  });
  if (latest.kind === "blocked") return fail(latest.reason);
  if (latest.kind === "merged") {
    const readyPhase = state.phases[input.phaseIndex];
    if (
      readyPhase?.kind !== "implementation" ||
      readyPhase.status !== "workspace-ready" ||
      !readyPhase.revalidation
    )
      throw new RangeError("Missing prepared receipt");
    state = await replacePhase(input, state, {
      ...readyPhase,
      status: "revalidation-pending",
      revalidation: readyPhase.revalidation,
    });
    return preparePlanningImplementationRevalidation(input, state);
  }
  if (latest.headOid !== observed.headOid)
    return fail("Implementation PR changed during workspace preparation");
  return { ...prepared, workspaceCreated: before.state !== "ready" };
}
