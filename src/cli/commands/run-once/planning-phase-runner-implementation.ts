import type {
  ImplementationWorkspaceReadyPlanningPhase,
  PlanningStateV1,
} from "../../../workflow/planning-state-types.ts";
import { PlanningPhaseArtifactError } from "./planning-phase-artifacts.ts";
import { phaseWorkspaceIdentity } from "../../../workflow/planning-pull-requests.ts";
import {
  blocked,
  operations,
  replacePhase,
  type PlanningPhaseRunnerInput,
  type PlanningPhaseRunnerOutcome,
} from "./planning-phase-runner-shared.ts";

function identity(input: PlanningPhaseRunnerInput) {
  return (
    input.config.workspaceIdentity?.(input.phase) ??
    phaseWorkspaceIdentity({
      issueNumber: input.issue.number,
      title: input.issue.title,
      phase: "implementation",
      strategy: {
        baseBranch: input.config.baseBranch,
        baseRef: input.config.baseBranch,
        remote: input.config.remote,
        branchPrefix: "agent/issue",
        worktreeDir: ".worktrees",
        worktreePrefix: "issue",
        slugLength: 48,
        allowDirectLand: false,
      },
    })
  );
}

async function prepare(
  input: PlanningPhaseRunnerInput,
  state: PlanningStateV1,
): Promise<PlanningStateV1> {
  const base = await input.remoteBase.fetch({
    issueNumber: state.issueNumber,
    remote: input.config.remote,
    baseBranch: input.config.baseBranch,
  });
  const resolution = operations(input).resolveArtifacts({
    phase: input.phase,
    base,
  });
  if (resolution.kind === "satisfied-by-base" && input.planOnly) return state;
  const workspace = await input.workspaces.prepare({
    runId: state.runId,
    phase: "implementation",
    identity: identity(input),
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

async function artifacts(
  input: PlanningPhaseRunnerInput,
  state: PlanningStateV1,
): Promise<PlanningPhaseRunnerOutcome | PlanningStateV1> {
  const current = state.phases[input.phaseIndex];
  if (
    current?.kind !== "implementation" ||
    current.status !== "workspace-ready"
  )
    throw new RangeError("Planning implementation workspace is not ready");
  await input.workspaces.resume({
    runId: state.runId,
    phase: "implementation",
    identity: current.workspace.identity,
    base: current.base,
    saved: current.workspace,
  });
  const result = await operations(input).runArtifacts({
    issue: input.issue,
    phase: input.phase,
    current,
    repoRoot: input.config.repoRoot,
    specsDir: input.config.specsDir,
    plansDir: input.config.plansDir,
    artifactDate: input.artifactDate ?? (input.now ?? (() => new Date()))(),
    agent: input.artifactAgent,
    git: input.publicationGit,
    checkpoint: async (next) => {
      state = await replacePhase(input, state, next);
    },
    projectPolicy: input.config.projectPolicy,
    skills: input.config.skills,
    triageLabels: input.config.triageLabels,
  });
  return result.kind === "blocked"
    ? { kind: "blocked", state, result: result.result }
    : state;
}

export async function runPlanningImplementationPhase(
  input: PlanningPhaseRunnerInput,
): Promise<PlanningPhaseRunnerOutcome> {
  let state = input.state;
  let phase = state.phases[input.phaseIndex];
  if (phase?.kind !== "implementation" || input.phase.kind !== "implementation")
    throw new RangeError(
      "Planning phase does not match durable implementation state",
    );
  if (phase.status === "pending") {
    try {
      state = await prepare(input, state);
    } catch (error) {
      if (
        error instanceof PlanningPhaseArtifactError &&
        error.reason === "ambiguous-base-artifact"
      )
        return { kind: "blocked", state, result: blocked(error.reason) };
      throw error;
    }
    phase = state.phases[input.phaseIndex];
    if (input.planOnly && phase?.status === "pending")
      return { kind: "stopped", state, reason: "plan-only" };
  }
  if (phase?.kind !== "implementation")
    throw new RangeError("Planning implementation state changed");
  if (phase.status === "workspace-ready") {
    const result = await artifacts(input, state);
    if ("kind" in result) return result;
    state = result;
    if (input.planOnly) return { kind: "stopped", state, reason: "plan-only" };
  }
  phase = state.phases[input.phaseIndex];
  if (phase?.kind !== "implementation")
    throw new RangeError("Planning implementation state changed");
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
  });
  return { kind: "complete", state: finished.state, result: finished.result };
}
