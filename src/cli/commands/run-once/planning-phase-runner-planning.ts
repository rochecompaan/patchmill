import type {
  PlanningStateV1,
  WorkspaceReadyPlanningPhase,
} from "../../../workflow/planning-state-types.ts";
import type { PlanningHeadAdoptionBlockedOutcome } from "./planning-head-adoption.ts";
import { PlanningPhaseArtifactError } from "./planning-phase-artifacts.ts";
import { runOnceFailure } from "./result-diagnostics.ts";
import {
  blocked,
  operations,
  replacePhase,
  runWorkspaceArtifacts,
  type PlanningPhaseRunnerInput,
  type PlanningPhaseRunnerOutcome,
} from "./planning-phase-runner-shared.ts";

function adoptionBlocked(
  state: PlanningStateV1,
  phase: "spec" | "plan",
  outcome: PlanningHeadAdoptionBlockedOutcome,
): PlanningPhaseRunnerOutcome {
  return {
    kind: "blocked",
    state,
    result: blocked(
      "planning-head-adoption-blocked",
      runOnceFailure("planning-head-adoption-blocked", {
        issueNumber: state.issueNumber,
        status: "blocked",
        phase,
        ...(outcome.pullRequestUrl === undefined
          ? {}
          : { pullRequestUrl: outcome.pullRequestUrl }),
        recordedHeadOid: outcome.evidence.recordedHeadOid,
        ...(outcome.evidence.hostHeadOid === undefined
          ? {}
          : { hostHeadOid: outcome.evidence.hostHeadOid }),
        ...(outcome.evidence.fetchedHeadOid === undefined
          ? {}
          : { fetchedHeadOid: outcome.evidence.fetchedHeadOid }),
        ...(outcome.evidence.remoteHeadOid === undefined
          ? {}
          : { remoteHeadOid: outcome.evidence.remoteHeadOid }),
        adoptionFailure: outcome.evidence.failure,
        artifactPaths: outcome.evidence.artifactPaths,
        ...(outcome.evidence.unexpectedPaths.length === 0
          ? {}
          : { unexpectedPaths: outcome.evidence.unexpectedPaths }),
        cleanupState: outcome.evidence.cleanupState,
      }),
    ),
  };
}

async function reconcile(
  input: PlanningPhaseRunnerInput,
  state: PlanningStateV1,
): Promise<PlanningPhaseRunnerOutcome> {
  const phase = input.phase.kind;
  if (phase === "implementation")
    throw new RangeError(
      "Planning reconciliation requires a spec or plan phase",
    );
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
    case "cleanup-pending":
      return {
        kind: "cleanup-pending",
        state: result.state,
        phase,
        prUrl: result.outcome.prUrl,
        reason: result.outcome.reason,
        ignoredPaths: result.outcome.ignoredPaths,
      };
    case "review-pending":
      return {
        kind: "review-pending",
        state: result.state,
        prUrl: result.outcome.pullRequest.url,
      };
    case "merged":
    case "satisfied-by-base":
      return { kind: "advanced", state: result.state };
    case "head-adoption-blocked":
      return adoptionBlocked(result.state, phase, result.outcome);
    case "merge-recovery-blocked":
      return {
        kind: "blocked",
        state: result.state,
        result: blocked(
          "planning-merge-recovery-blocked",
          runOnceFailure("planning-merge-recovery-blocked", {
            issueNumber: result.state.issueNumber,
            status: "blocked",
            phase,
            pullRequestUrl: result.outcome.pullRequest.url,
            pullRequestReference: `#${result.outcome.pullRequest.number}`,
            recordedHeadOid: result.outcome.recordedHeadOid,
            hostHeadOid: result.outcome.pullRequest.headSha,
            baseBranch: result.outcome.baseBranch,
            forgeMergeOid: result.outcome.pullRequest.mergeCommit,
            fetchedBaseOid: result.outcome.baseOid,
            evidenceSource: result.outcome.evidence.trigger.source,
            evidenceFailure: result.outcome.evidence.trigger.failure,
            recoveryFailure: result.outcome.evidence.recovery.failure,
            artifactKinds: result.outcome.evidence.recovery.artifactKinds,
            expectedPaths: result.outcome.evidence.recovery.expectedPaths,
            observedCandidates:
              result.outcome.evidence.recovery.observedCandidates.length === 0
                ? ["(none)"]
                : result.outcome.evidence.recovery.observedCandidates,
          }),
        ),
      };
    case "closed-unmerged":
      return {
        kind: "blocked",
        state: result.state,
        result: blocked(
          "planning-pull-request-closed-unmerged",
          runOnceFailure("planning-pull-request-closed-unmerged", {
            issueNumber: result.state.issueNumber,
            status: "blocked",
            phase,
            pullRequestUrl: result.outcome.pullRequest.url,
            pullRequestReference: `#${result.outcome.pullRequest.number}`,
            observedStatus: result.outcome.pullRequest.status,
          }),
        ),
      };
    case "missing":
      return {
        kind: "blocked",
        state: result.state,
        result: blocked(
          "planning-pull-request-missing",
          runOnceFailure("planning-pull-request-missing", {
            issueNumber: result.state.issueNumber,
            status: "blocked",
            phase,
            ...(result.outcome.reference
              ? { pullRequestReference: `#${result.outcome.reference.number}` }
              : {}),
          }),
        ),
      };
    case "ambiguous":
      return {
        kind: "blocked",
        state: result.state,
        result: blocked(
          "planning-pull-request-ambiguous",
          runOnceFailure("planning-pull-request-ambiguous", {
            issueNumber: result.state.issueNumber,
            status: "blocked",
            phase,
            pullRequestUrls: result.outcome.pullRequests.map(
              (pullRequest) => pullRequest.url,
            ),
          }),
        ),
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
  if (published.kind === "cleanup-pending") return published;
  if (published.kind === "head-adoption-blocked")
    return adoptionBlocked(published.state, phase.kind, published);
  if (published.kind === "ambiguous")
    return {
      kind: "blocked",
      state: published.state,
      result: blocked(
        "planning-pull-request-ambiguous",
        runOnceFailure("planning-pull-request-ambiguous", {
          issueNumber: published.state.issueNumber,
          status: "blocked",
          phase: phase.kind,
          pullRequestUrls: published.pullRequests.map(
            (pullRequest) => pullRequest.url,
          ),
        }),
      ),
    };
  return published.pullRequest.status === "open"
    ? {
        kind: "review-pending",
        state: published.state,
        prUrl: published.pullRequest.url,
      }
    : reconcile(input, published.state);
}
