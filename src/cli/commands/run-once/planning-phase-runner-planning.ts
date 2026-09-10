import type {
  PlanningStateV1,
  WorkspaceReadyPlanningPhase,
} from "../../../workflow/planning-state-types.ts";
import { PlanningPhaseArtifactError } from "./planning-phase-artifacts.ts";
import {
  blocked,
  operations,
  replacePhase,
  runWorkspaceArtifacts,
  type PlanningPhaseRunnerInput,
  type PlanningPhaseRunnerOutcome,
} from "./planning-phase-runner-shared.ts";

async function reconcile(
  input: PlanningPhaseRunnerInput,
  state: PlanningStateV1,
): Promise<PlanningPhaseRunnerOutcome> {
  const result = await operations(input).reconcile({
    state,
    phaseIndex: input.phaseIndex,
    lock: input.lock,
    stateStore: input.stateStore,
    host: input.host,
    remoteBase: input.remoteBase,
    git: input.publicationGit,
    workspaces: input.workspaces,
    ...(input.now === undefined ? {} : { now: input.now }),
  });
  switch (result.outcome.kind) {
    case "review-pending":
      return {
        kind: "review-pending",
        state: result.state,
        prUrl: result.outcome.pullRequest.url,
      };
    case "merged":
    case "satisfied-by-base":
      return { kind: "advanced", state: result.state };
    case "closed-unmerged":
    case "missing":
    case "ambiguous":
      return {
        kind: "blocked",
        state: result.state,
        result: blocked(`planning-pull-request-${result.outcome.kind}`),
      };
  }
}

async function prepare(
  input: PlanningPhaseRunnerInput,
  state: PlanningStateV1,
): Promise<{ state: PlanningStateV1; satisfied: boolean }> {
  const base = await input.remoteBase.fetch({
    issueNumber: state.issueNumber,
    remote: input.config.remote,
    baseBranch: input.config.baseBranch,
  });
  const resolution = operations(input).resolveArtifacts({
    phase: input.phase,
    base,
  });
  if (resolution.kind === "satisfied-by-base")
    return {
      state: await replacePhase(input, state, {
        kind: input.phase.kind as "spec" | "plan",
        status: "complete",
        base,
        artifacts: resolution.artifacts,
        completion: { kind: "remote-base" },
      }),
      satisfied: true,
    };
  const prepared = await input.workspaces.prepare({
    runId: state.runId,
    phase: input.phase.kind,
    identity: input.config.workspaceIdentity(input.phase),
    base,
  });
  const phase: WorkspaceReadyPlanningPhase = {
    kind: input.phase.kind as "spec" | "plan",
    status: "workspace-ready",
    base: prepared.base,
    workspace: prepared.workspace,
    artifacts: resolution.artifacts,
  };
  return { state: await replacePhase(input, state, phase), satisfied: false };
}

export async function runPlanningSpecPlanPhase(
  input: PlanningPhaseRunnerInput,
): Promise<PlanningPhaseRunnerOutcome> {
  let state = input.state;
  const phase = state.phases[input.phaseIndex];
  if (
    phase === undefined ||
    phase.kind !== input.phase.kind ||
    phase.kind === "implementation"
  )
    throw new RangeError("Planning phase does not match durable state");
  if (
    phase.status === "branch-pushed" ||
    phase.status === "pull-request-open" ||
    phase.status === "complete"
  )
    return reconcile(input, state);
  if (phase.status === "pending") {
    try {
      const prepared = await prepare(input, state);
      state = prepared.state;
      if (prepared.satisfied) return { kind: "advanced", state };
    } catch (error) {
      if (
        error instanceof PlanningPhaseArtifactError &&
        error.reason === "ambiguous-base-artifact"
      )
        return { kind: "blocked", state, result: blocked(error.reason) };
      throw error;
    }
  }
  const artifacts = await runWorkspaceArtifacts(input, state);
  if (artifacts.kind !== "workspace-ready") return artifacts;
  const published = await operations(input).publish({
    state: artifacts.state,
    phaseIndex: input.phaseIndex,
    lock: input.lock,
    stateStore: input.stateStore,
    host: input.host,
    git: input.publicationGit,
    workspaces: input.workspaces,
    ...(input.now === undefined ? {} : { now: input.now }),
  });
  if (published.kind === "ambiguous")
    return {
      kind: "blocked",
      state: published.state,
      result: blocked("planning-pull-request-ambiguous"),
    };
  return published.pullRequest.status === "open"
    ? {
        kind: "review-pending",
        state: published.state,
        prUrl: published.pullRequest.url,
      }
    : reconcile(input, published.state);
}
