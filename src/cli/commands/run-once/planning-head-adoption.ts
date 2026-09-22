import type {
  PlanningHeadAdoptionBlockedEvidence,
  PlanningHeadAdoptionFailure,
  PlanningWorkspaceLifecycle,
} from "../../../git/planning-workspaces.ts";
import type { PlanningIssueLock } from "../../../workflow/planning-issue-lock.ts";
import { replacePlanningPhase } from "../../../workflow/planning-phase-replacement.ts";
import type { PlanningStateStore } from "../../../workflow/planning-state-store.ts";
import type {
  BranchPushedPlanningPhase,
  PlanningStateV1,
  PullRequestOpenPlanningPhase,
} from "../../../workflow/planning-state-types.ts";
import type { ValidatedPlanningPullRequest } from "../../../workflow/planning-pull-request-validation.ts";

export type PlanningHeadAdoptionBlockedOutcome = Readonly<{
  kind: "head-adoption-blocked";
  pullRequestUrl?: string;
  evidence: PlanningHeadAdoptionBlockedEvidence;
}>;

export type PlanningPullRequestHeadOutcome =
  | Readonly<{
      kind: "ready";
      state: PlanningStateV1;
      phase: PullRequestOpenPlanningPhase;
      adopted: boolean;
    }>
  | (PlanningHeadAdoptionBlockedOutcome & Readonly<{ state: PlanningStateV1 }>);

/** Builds a typed blocker from a bounded remote observation without inventing Git evidence. */
export function planningHeadObservationBlocked(input: {
  phase: BranchPushedPlanningPhase | PullRequestOpenPlanningPhase;
  failure: Extract<
    PlanningHeadAdoptionFailure,
    "remote-missing" | "head-disagreement" | "head-moved"
  >;
  hostHeadOid?: string;
  remoteHeadOid?: string;
  pullRequestUrl?: string;
}): PlanningHeadAdoptionBlockedOutcome {
  return {
    kind: "head-adoption-blocked",
    ...(input.pullRequestUrl === undefined
      ? {}
      : { pullRequestUrl: input.pullRequestUrl }),
    evidence: {
      failure: input.failure,
      recordedHeadOid: input.phase.publication.headOid,
      ...(input.hostHeadOid === undefined
        ? {}
        : { hostHeadOid: input.hostHeadOid }),
      ...(input.remoteHeadOid === undefined
        ? {}
        : { remoteHeadOid: input.remoteHeadOid }),
      artifactPaths: input.phase.artifacts.map((artifact) => artifact.path),
      unexpectedPaths: [],
      cleanupState: input.phase.workspace.cleanup.state,
    },
  };
}

/** Coordinates one complete, revision-checked durable head evidence replacement. */
export async function adoptPlanningPullRequestHead(input: {
  state: PlanningStateV1;
  phaseIndex: number;
  validated: ValidatedPlanningPullRequest;
  lock: PlanningIssueLock;
  stateStore: Pick<PlanningStateStore, "replace">;
  workspaces: Pick<PlanningWorkspaceLifecycle, "adoptPlanningHead">;
  now?: () => Date;
}): Promise<PlanningPullRequestHeadOutcome> {
  const current = input.state.phases[input.phaseIndex];
  if (
    current === undefined ||
    current.kind === "implementation" ||
    (current.status !== "branch-pushed" &&
      current.status !== "pull-request-open")
  )
    throw new RangeError("Planning phase cannot adopt a pull request head");
  const phase = current;
  const changed = input.validated.summary.headSha !== phase.publication.headOid;
  if (!changed && phase.status === "pull-request-open")
    return { kind: "ready", state: input.state, phase, adopted: false };
  if (changed) {
    const adoption = await input.workspaces.adoptPlanningHead({
      issueNumber: input.state.issueNumber,
      runId: input.state.runId,
      phase: phase.kind,
      workspace: phase.workspace,
      hostHeadOid: input.validated.summary.headSha,
      artifactPaths: phase.artifacts.map((artifact) => artifact.path),
    });
    if (adoption.kind === "blocked")
      return {
        kind: "head-adoption-blocked",
        state: input.state,
        pullRequestUrl: input.validated.url,
        evidence: adoption.evidence,
      };
    const workspace = {
      ...phase.workspace,
      headOid: adoption.headOid,
      cleanup:
        phase.workspace.cleanup.state === "ready" ||
        phase.workspace.cleanup.state === "cleanup-pending"
          ? phase.workspace.cleanup
          : { ...phase.workspace.cleanup, pushedHeadOid: adoption.headOid },
    };
    const next: PullRequestOpenPlanningPhase = {
      ...phase,
      status: "pull-request-open",
      workspace,
      publication: { ...phase.publication, headOid: adoption.headOid },
      artifacts: phase.artifacts.map((artifact) => ({
        ...artifact,
        source: "workspace",
        commitOid: adoption.headOid,
      })),
      pullRequest: {
        reference: input.validated.reference,
        url: input.validated.url,
      },
    };
    const state = await replacePlanningPhase({
      stateStore: input.stateStore,
      lock: input.lock,
      state: input.state,
      phaseIndex: input.phaseIndex,
      phase: next,
      ...(input.now === undefined ? {} : { now: input.now }),
    });
    const durable = state.phases[input.phaseIndex];
    if (
      durable === undefined ||
      durable.kind === "implementation" ||
      durable.status !== "pull-request-open"
    )
      throw new Error(
        "Planning head adoption replacement returned an invalid phase",
      );
    return { kind: "ready", state, phase: durable, adopted: true };
  }
  const next: PullRequestOpenPlanningPhase = {
    ...phase,
    status: "pull-request-open",
    pullRequest: {
      reference: input.validated.reference,
      url: input.validated.url,
    },
  };
  const state = await replacePlanningPhase({
    stateStore: input.stateStore,
    lock: input.lock,
    state: input.state,
    phaseIndex: input.phaseIndex,
    phase: next,
    ...(input.now === undefined ? {} : { now: input.now }),
  });
  const durable = state.phases[input.phaseIndex];
  if (
    durable === undefined ||
    durable.kind === "implementation" ||
    durable.status !== "pull-request-open"
  )
    throw new Error(
      "Planning head adoption replacement returned an invalid phase",
    );
  return { kind: "ready", state, phase: durable, adopted: false };
}
