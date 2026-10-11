import type {
  ImplementationWorkspaceReadyPlanningPhase,
  PlanningStateV1,
} from "../../../workflow/planning-state-types.ts";
import { assertPlanningImplementationBase } from "./planning-implementation-base.ts";
import { PlanningPhaseArtifactError } from "./planning-phase-artifacts.ts";
import { runOnceFailure } from "./result-diagnostics.ts";
import { durableMergedImplementationResult } from "./planning-runtime-state.ts";
import { reconcileImplementationPullRequest } from "../../../workflow/implementation-pr-reconciliation.ts";
import {
  blocked,
  operations,
  replacePhase,
  runWorkspaceArtifacts,
  type PlanningPhaseRunnerInput,
  type PlanningPhaseRunnerOutcome,
} from "./planning-phase-runner-shared.ts";

async function fetchVerifiedBase(
  input: PlanningPhaseRunnerInput,
  state: PlanningStateV1,
) {
  const base = await input.remoteBase.fetch({
    issueNumber: state.issueNumber,
    remote: input.config.remote,
    baseBranch: input.config.baseBranch,
  });
  await assertPlanningImplementationBase({
    state,
    phaseIndex: input.phaseIndex,
    base,
    git: input.publicationGit,
  });
  return base;
}

async function prepare(
  input: PlanningPhaseRunnerInput,
  state: PlanningStateV1,
): Promise<PlanningStateV1> {
  const base = await fetchVerifiedBase(input, state);
  const resolution = operations(input).resolveArtifacts({
    phase: input.phase,
    base,
  });
  if (resolution.kind === "satisfied-by-base" && input.planOnly) return state;
  const workspace = await input.workspaces.prepare({
    runId: state.runId,
    phase: "implementation",
    identity: input.config.workspaceIdentity(input.phase),
    base,
  });
  const phase: ImplementationWorkspaceReadyPlanningPhase = {
    kind: "implementation",
    status: "workspace-ready",
    base: workspace.base,
    workspace: workspace.workspace,
    artifacts: resolution.artifacts,
  };
  return replacePhase(input, state, phase);
}

export async function runPlanningImplementationPhase(
  input: PlanningPhaseRunnerInput,
): Promise<PlanningPhaseRunnerOutcome> {
  let state = input.state;
  let workspaceCreated = false;
  let phase = state.phases[input.phaseIndex];
  if (phase?.kind !== "implementation" || input.phase.kind !== "implementation")
    throw new RangeError(
      "Planning phase does not match durable implementation state",
    );
  if (phase.status === "complete")
    return {
      kind: "complete",
      state,
      result: durableMergedImplementationResult(phase),
    };
  if (phase.status === "pending") {
    try {
      state = await prepare(input, state);
      workspaceCreated = true;
    } catch (error) {
      if (
        error instanceof PlanningPhaseArtifactError &&
        error.reason === "ambiguous-base-artifact"
      ) {
        if (!error.diagnosticContext)
          throw new Error("Ambiguous planning artifact is missing evidence", {
            cause: error,
          });
        return {
          kind: "blocked",
          state,
          result: blocked(
            "ambiguous-base-artifact",
            runOnceFailure("ambiguous-base-artifact", {
              issueNumber: state.issueNumber,
              status: "blocked",
              ...error.diagnosticContext,
            }),
          ),
        };
      }
      throw error;
    }
    phase = state.phases[input.phaseIndex];
    if (input.planOnly && phase?.status === "pending")
      return { kind: "stopped", state, reason: "plan-only" };
  }
  if (phase?.kind !== "implementation")
    throw new RangeError("Planning implementation state changed");
  if (phase.status === "workspace-ready") {
    await fetchVerifiedBase(input, state);
    const result = await runWorkspaceArtifacts(input, state);
    if (result.kind !== "workspace-ready") return result;
    state = result.state;
    if (input.planOnly) return { kind: "stopped", state, reason: "plan-only" };
  }
  phase = state.phases[input.phaseIndex];
  if (phase?.kind !== "implementation")
    throw new RangeError("Planning implementation state changed");
  if (input.planOnly) return { kind: "stopped", state, reason: "plan-only" };
  if (phase.status === "workspace-ready" || phase.status === "branch-pushed") {
    const implemented = await operations(input).runImplementation({
      ...input.implementation.implementation,
      state,
      phaseIndex: input.phaseIndex,
      lock: input.lock,
      stateStore: input.stateStore,
      host: input.host,
      workspaces: input.workspaces,
      git: input.publicationGit,
      workspaceCreated,
    });
    if (implemented.kind === "blocked")
      return {
        kind: "blocked",
        state: implemented.state,
        result: implemented.result,
      };
    state = implemented.state;
  }
  const finished = await operations(input).finishImplementation({
    ...input.implementation.finish(state),
    state,
    phaseIndex: input.phaseIndex,
    lock: input.lock,
    stateStore: input.stateStore,
    workspaces: input.workspaces,
    git: input.publicationGit,
    reconcilePr: async (published) => {
      const reconciliation = await reconcileImplementationPullRequest({
        host: input.host,
        issueNumber: state.issueNumber,
        evidence: {
          ...published.pullRequest,
          publication: published.publication,
          ownershipMarkerRequired: true,
        },
        fetchBase: () =>
          input.remoteBase.fetch({
            issueNumber: state.issueNumber,
            remote: input.config.remote,
            baseBranch: published.publication.baseBranch,
            targetRepository: published.publication.targetRepository,
          }),
        git: input.publicationGit,
      });
      if (input.issue.state !== "open" && reconciliation.kind === "open")
        return {
          kind: "blocked",
          reason: "Issue is closed but its saved PR is unmerged",
        };
      return reconciliation;
    },
  });
  if (finished.kind === "blocked")
    return {
      kind: "blocked",
      state: finished.state,
      result: blocked(
        finished.reason,
        runOnceFailure("implementation-evidence", {
          issueNumber: state.issueNumber,
          status: "blocked",
          validation: finished.reason,
        }),
      ),
    };
  if (finished.kind === "implementation-published") return finished;
  return { kind: "complete", state: finished.state, result: finished.result };
}
