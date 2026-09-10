import type { PlanningPublicationOperations } from "../../../git/planning-publication-git.ts";
import type { PlanningRemoteBaseGit } from "../../../git/planning-remote-base.ts";
import type { PlanningWorkspaceLifecycle } from "../../../git/planning-workspaces.ts";
import type { PullRequestHost } from "../../../host/pull-requests.ts";
import {
  phaseWorkspaceIdentity,
  type PlannedPhase,
} from "../../../workflow/planning-pull-requests.ts";
import type { PlanningIssueLock } from "../../../workflow/planning-issue-lock.ts";
import { replacePlanningPhase } from "../../../workflow/planning-phase-replacement.ts";
import type { PlanningStateStore } from "../../../workflow/planning-state-store.ts";
import type {
  PlanningPhaseStateV1,
  PlanningStateV1,
} from "../../../workflow/planning-state-types.ts";
import type { PatchmillProjectPolicy } from "../../../policy/types.ts";
import type { PatchmillSkillsConfig } from "../../../workflow/skills.ts";
import {
  PlanningPhaseArtifactError,
  resolvePlanningPhaseArtifacts,
  runPlanningPhaseArtifacts,
  type PlanningArtifactAgent,
  type PlanningPhaseArtifactResolution,
} from "./planning-phase-artifacts.ts";
import {
  publishPlanningPhase,
  type PlanningPhasePublicationResult,
} from "./planning-phase-publisher.ts";
import {
  reconcilePlanningPhase,
  type PlanningPhaseReconciliation,
} from "./planning-phase-reconciler.ts";
import {
  finishPlanningImplementation,
  type PlanningFinishInput,
} from "./planning-finish.ts";
import {
  runPlanningImplementation,
  type PlanningImplementationInput,
} from "./planning-implementation.ts";
import type { PromptTriageLabels } from "./prompts.ts";
import type {
  AgentIssueBlockedResult,
  AgentIssuePrCreatedResult,
  IssueSummary,
} from "./types.ts";

export type PlanningPhaseRunnerOutcome =
  | { kind: "review-pending"; state: PlanningStateV1; prUrl: string }
  | { kind: "stopped"; state: PlanningStateV1; reason: "plan-only" }
  | { kind: "blocked"; state: PlanningStateV1; result: AgentIssueBlockedResult }
  | {
      kind: "complete";
      state: PlanningStateV1;
      result: AgentIssuePrCreatedResult;
    }
  | { kind: "advanced"; state: PlanningStateV1 };

type RunnerConfig = {
  repoRoot: string;
  remote: string;
  baseBranch: string;
  specsDir: string;
  plansDir: string;
  projectPolicy: PatchmillProjectPolicy;
  skills: PatchmillSkillsConfig;
  triageLabels: PromptTriageLabels;
  workspaceIdentity?: (phase: PlannedPhase) => {
    branch: string;
    worktreePath: string;
  };
};

type RunnerOperations = {
  reconcile: typeof reconcilePlanningPhase;
  resolveArtifacts: typeof resolvePlanningPhaseArtifacts;
  runArtifacts: typeof runPlanningPhaseArtifacts;
  publish: typeof publishPlanningPhase;
  runImplementation: (
    input: PlanningImplementationInput,
  ) => ReturnType<typeof runPlanningImplementation>;
  finishImplementation: (
    input: PlanningFinishInput,
  ) => ReturnType<typeof finishPlanningImplementation>;
};

export type PlanningPhaseRunnerInput = {
  state: PlanningStateV1;
  phaseIndex: number;
  phase: PlannedPhase;
  issue: IssueSummary;
  lock: PlanningIssueLock;
  config: RunnerConfig;
  stateStore: Pick<PlanningStateStore, "replace">;
  host: PullRequestHost;
  remoteBase: Pick<PlanningRemoteBaseGit, "fetch">;
  publicationGit: PlanningPublicationOperations;
  workspaces: PlanningWorkspaceLifecycle;
  artifactAgent: PlanningArtifactAgent;
  implementationInput?: Omit<
    PlanningImplementationInput,
    | "state"
    | "phaseIndex"
    | "lock"
    | "stateStore"
    | "host"
    | "workspaces"
    | "git"
  >;
  finishInput?: Omit<
    PlanningFinishInput,
    "state" | "phaseIndex" | "lock" | "stateStore" | "workspaces"
  >;
  finishInputForState?: (
    state: PlanningStateV1,
  ) => Omit<
    PlanningFinishInput,
    "state" | "phaseIndex" | "lock" | "stateStore" | "workspaces"
  >;
  planOnly?: boolean;
  artifactDate?: Date;
  now?: () => Date;
  operations?: Partial<RunnerOperations>;
};

function blocked(reason: string): AgentIssueBlockedResult {
  return {
    status: "blocked",
    reason,
    questions: [],
    commits: [],
    validation: [],
  };
}

function operations(input: PlanningPhaseRunnerInput): RunnerOperations {
  return {
    reconcile: input.operations?.reconcile ?? reconcilePlanningPhase,
    resolveArtifacts:
      input.operations?.resolveArtifacts ?? resolvePlanningPhaseArtifacts,
    runArtifacts: input.operations?.runArtifacts ?? runPlanningPhaseArtifacts,
    publish: input.operations?.publish ?? publishPlanningPhase,
    runImplementation:
      input.operations?.runImplementation ?? runPlanningImplementation,
    finishImplementation:
      input.operations?.finishImplementation ?? finishPlanningImplementation,
  };
}

async function replace(
  input: PlanningPhaseRunnerInput,
  state: PlanningStateV1,
  phase: PlanningPhaseStateV1,
): Promise<PlanningStateV1> {
  return replacePlanningPhase({
    stateStore: input.stateStore,
    lock: input.lock,
    state,
    phaseIndex: input.phaseIndex,
    phase,
    ...(input.now === undefined ? {} : { now: input.now }),
  });
}

function reconcileOutcome(
  state: PlanningStateV1,
  outcome: PlanningPhaseReconciliation,
): PlanningPhaseRunnerOutcome {
  switch (outcome.kind) {
    case "review-pending":
      return { kind: "review-pending", state, prUrl: outcome.pullRequest.url };
    case "merged":
    case "satisfied-by-base":
      return { kind: "advanced", state };
    case "closed-unmerged":
    case "missing":
    case "ambiguous":
      return {
        kind: "blocked",
        state,
        result: blocked(`planning-pull-request-${outcome.kind}`),
      };
  }
}

async function reconcile(
  input: PlanningPhaseRunnerInput,
  state: PlanningStateV1,
  run: RunnerOperations,
): Promise<PlanningPhaseRunnerOutcome> {
  const result = await run.reconcile({
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
  return reconcileOutcome(result.state, result.outcome);
}

function workspaceIdentity(input: PlanningPhaseRunnerInput) {
  return (
    input.config.workspaceIdentity?.(input.phase) ??
    phaseWorkspaceIdentity({
      issueNumber: input.issue.number,
      title: input.issue.title,
      phase: input.phase.kind,
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

async function preparePending(
  input: PlanningPhaseRunnerInput,
  state: PlanningStateV1,
  run: RunnerOperations,
): Promise<{
  state: PlanningStateV1;
  resolution: PlanningPhaseArtifactResolution;
}> {
  const base = await input.remoteBase.fetch({
    issueNumber: state.issueNumber,
    remote: input.config.remote,
    baseBranch: input.config.baseBranch,
  });
  const resolution = run.resolveArtifacts({ phase: input.phase, base });
  if (resolution.kind === "satisfied-by-base") {
    if (input.phase.kind === "implementation" && input.planOnly)
      return { state, resolution };
    if (input.phase.kind !== "implementation")
      return {
        state: await replace(input, state, {
          kind: input.phase.kind,
          status: "complete",
          base,
          artifacts: resolution.artifacts,
          completion: { kind: "remote-base" },
        }),
        resolution,
      };
  }
  const prepared = await input.workspaces.prepare({
    runId: state.runId,
    phase: input.phase.kind,
    identity: workspaceIdentity(input),
    base,
  });
  return {
    state: await replace(input, state, {
      kind: input.phase.kind,
      status: "workspace-ready",
      base: prepared.base,
      workspace: prepared.workspace,
      artifacts: resolution.artifacts,
    } as PlanningPhaseStateV1),
    resolution,
  };
}

async function runArtifacts(
  input: PlanningPhaseRunnerInput,
  state: PlanningStateV1,
  run: RunnerOperations,
): Promise<
  | PlanningPhaseRunnerOutcome
  | { kind: "workspace-ready"; state: PlanningStateV1 }
> {
  const current = state.phases[input.phaseIndex];
  if (current?.status !== "workspace-ready")
    throw new RangeError("Planning phase workspace is not ready");
  await input.workspaces.resume({
    runId: state.runId,
    phase: current.kind,
    identity: current.workspace.identity,
    base: current.base,
    saved: current.workspace,
  });
  const artifacts = await run.runArtifacts({
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
      state = await replace(input, state, next as PlanningPhaseStateV1);
    },
    projectPolicy: input.config.projectPolicy,
    skills: input.config.skills,
    triageLabels: input.config.triageLabels,
  });
  if (artifacts.kind === "blocked")
    return { kind: "blocked", state, result: artifacts.result };
  return { kind: "workspace-ready", state };
}

async function publish(
  input: PlanningPhaseRunnerInput,
  state: PlanningStateV1,
  run: RunnerOperations,
): Promise<PlanningPhaseRunnerOutcome> {
  const result: PlanningPhasePublicationResult = await run.publish({
    state,
    phaseIndex: input.phaseIndex,
    lock: input.lock,
    stateStore: input.stateStore,
    host: input.host,
    git: input.publicationGit,
    workspaces: input.workspaces,
    ...(input.now === undefined ? {} : { now: input.now }),
  });
  if (result.kind === "ambiguous")
    return {
      kind: "blocked",
      state: result.state,
      result: blocked("planning-pull-request-ambiguous"),
    };
  if (result.pullRequest.status === "open")
    return {
      kind: "review-pending",
      state: result.state,
      prUrl: result.pullRequest.url,
    };
  return reconcile(input, result.state, run);
}

async function implementation(
  input: PlanningPhaseRunnerInput,
  state: PlanningStateV1,
  run: RunnerOperations,
  workspaceCreated = false,
): Promise<PlanningPhaseRunnerOutcome> {
  const current = state.phases[input.phaseIndex];
  if (current?.kind !== "implementation")
    throw new RangeError("Planning phase is not implementation");
  if (current.status === "workspace-ready") {
    const artifacts = await runArtifacts(input, state, run);
    if (artifacts.kind !== "workspace-ready") return artifacts;
    state = artifacts.state;
    if (input.planOnly) return { kind: "stopped", state, reason: "plan-only" };
  }
  let phase = state.phases[input.phaseIndex];
  if (phase?.kind !== "implementation")
    throw new RangeError("Planning implementation state changed");
  if (phase.status === "workspace-ready" || phase.status === "branch-pushed") {
    if (input.implementationInput === undefined)
      throw new Error("Planning implementation runner is not configured");
    const implemented = await run.runImplementation({
      ...input.implementationInput,
      workspaceCreated,
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
    phase = state.phases[input.phaseIndex];
  }
  if (phase?.kind !== "implementation" || phase.status !== "pull-request-open")
    throw new RangeError("Planning implementation is not validated");
  const finishInput = input.finishInputForState?.(state) ?? input.finishInput;
  if (finishInput === undefined)
    throw new Error("Planning implementation finish runner is not configured");
  const finished = await run.finishImplementation({
    ...finishInput,
    state,
    phaseIndex: input.phaseIndex,
    lock: input.lock,
    stateStore: input.stateStore,
    workspaces: input.workspaces,
  });
  return { kind: "complete", state: finished.state, result: finished.result };
}

/** Runs one strict planning phase without embedding provider or Git commands. */
export async function runPlanningPhase(
  input: PlanningPhaseRunnerInput,
): Promise<PlanningPhaseRunnerOutcome> {
  let state = input.state;
  const phase = state.phases[input.phaseIndex];
  if (phase === undefined || phase.kind !== input.phase.kind)
    throw new RangeError("Planning phase does not match durable state");
  const run = operations(input);
  if (
    phase.kind !== "implementation" &&
    (phase.status === "branch-pushed" ||
      phase.status === "pull-request-open" ||
      phase.status === "complete")
  )
    return reconcile(input, state, run);
  if (phase.status === "pending") {
    let prepared: Awaited<ReturnType<typeof preparePending>>;
    try {
      prepared = await preparePending(input, state, run);
    } catch (error) {
      if (
        error instanceof PlanningPhaseArtifactError &&
        error.reason === "ambiguous-base-artifact"
      )
        return {
          kind: "blocked",
          state,
          result: blocked(error.reason),
        };
      throw error;
    }
    state = prepared.state;
    if (
      prepared.resolution.kind === "satisfied-by-base" &&
      input.phase.kind !== "implementation"
    )
      return { kind: "advanced", state };
    if (
      prepared.resolution.kind === "satisfied-by-base" &&
      input.phase.kind === "implementation" &&
      input.planOnly
    )
      return { kind: "stopped", state, reason: "plan-only" };
  }
  if (input.phase.kind === "implementation")
    return implementation(input, state, run, phase.status === "pending");
  const artifacts = await runArtifacts(input, state, run);
  if (artifacts.kind !== "workspace-ready") return artifacts;
  return publish(input, artifacts.state, run);
}
