import type { PlanningPublicationOperations } from "../../../git/planning-publication-git.ts";
import type { PlanningWorkspaceLifecycle } from "../../../git/planning-workspaces.ts";
import type { PullRequestHost } from "../../../host/pull-requests.ts";
import { renderPlanningPullRequestMarker } from "../../../workflow/planning-pull-request-markers.ts";
import type { PlanningIssueLock } from "../../../workflow/planning-issue-lock.ts";
import type { PlanningStateStore } from "../../../workflow/planning-state-store.ts";
import type {
  ImplementationBranchPushedPlanningPhase,
  ImplementationWorkspaceReadyPlanningPhase,
  PlanningStateV1,
} from "../../../workflow/planning-state-types.ts";
import type {
  AgentIssueBlockedResult,
  AgentIssueMergedResult,
  AgentIssuePrCreatedResult,
} from "./types.ts";
import {
  PlanningImplementationValidationError,
  validatePlanningImplementation,
} from "./planning-implementation-validation.ts";

export type PlanningImplementationOutcome =
  | { kind: "validated"; state: PlanningStateV1 }
  | {
      kind: "blocked";
      state: PlanningStateV1;
      result: AgentIssueBlockedResult;
    };

export type PlanningImplementationInput = {
  state: PlanningStateV1;
  phaseIndex: number;
  lock: PlanningIssueLock;
  stateStore: Pick<PlanningStateStore, "replace">;
  host: PullRequestHost;
  workspaces: Pick<PlanningWorkspaceLifecycle, "inspect">;
  git: Pick<
    PlanningPublicationOperations,
    "inspectRemoteHead" | "assertAncestor"
  >;
  configuredGit: Record<string, unknown>;
  runAgent(input: {
    state: PlanningStateV1;
    phase: ImplementationWorkspaceReadyPlanningPhase;
    git: Record<string, unknown>;
    requiredPullRequestMarker: string;
  }): Promise<
    AgentIssuePrCreatedResult | AgentIssueMergedResult | AgentIssueBlockedResult
  >;
  now?: () => Date;
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

async function replace(
  input: PlanningImplementationInput,
  state: PlanningStateV1,
  phase: PlanningStateV1["phases"][number],
): Promise<PlanningStateV1> {
  return input.stateStore.replace({
    issueNumber: state.issueNumber,
    expectedRunId: state.runId,
    expectedRevision: state.revision,
    lock: input.lock,
    next: {
      ...state,
      revision: state.revision + 1,
      updatedAt: (input.now ?? (() => new Date()))().toISOString(),
      phases: state.phases.map((item, index) =>
        index === input.phaseIndex ? phase : item,
      ),
    },
  });
}

/** Runs the implementation agent only once, then durably validates its PR. */
export async function runPlanningImplementation(
  input: PlanningImplementationInput,
): Promise<PlanningImplementationOutcome> {
  let state = input.state;
  let phase = state.phases[input.phaseIndex];
  if (phase?.kind !== "implementation")
    throw new RangeError("Invalid implementation phase");
  if (phase.status === "workspace-ready") {
    const result = await input.runAgent({
      state,
      phase,
      git: { ...input.configuredGit, allowDirectLand: false },
      requiredPullRequestMarker: renderPlanningPullRequestMarker({
        issueNumber: state.issueNumber,
        phase: "implementation",
      }),
    });
    if (result.status === "blocked") return { kind: "blocked", state, result };
    if (result.status === "merged")
      return {
        kind: "blocked",
        state,
        result: blocked("implementation-direct-merge"),
      };
    const workspace = await input.workspaces.inspect(phase.workspace.identity);
    if (workspace.state !== "ready" || !workspace.clean)
      return {
        kind: "blocked",
        state,
        result: blocked("implementation-workspace"),
      };
    const remote = await input.git.inspectRemoteHead({
      remote: phase.workspace.remote,
      branch: phase.workspace.identity.branch,
    });
    if (remote.state !== "present" || remote.headOid !== workspace.headOid)
      return {
        kind: "blocked",
        state,
        result: blocked("implementation-remote-head"),
      };
    const [targetRepository, headRepository] = await Promise.all([
      input.host.resolveTargetRepositoryIdentity(),
      input.host.resolveRemoteRepositoryIdentity(phase.workspace.remote),
    ]);
    const branchPushed: ImplementationBranchPushedPlanningPhase = {
      ...phase,
      status: "branch-pushed",
      workspace: { ...phase.workspace, headOid: workspace.headOid },
      publication: {
        targetRepository,
        headRepository,
        baseBranch: phase.base.baseBranch,
        headBranch: phase.workspace.identity.branch,
        headOid: workspace.headOid,
      },
      implementation: {
        status: "pr-created",
        prUrl: result.prUrl,
        branch: result.branch,
        commits: result.commits,
        validation: result.validation,
        ...(result.reviewSummary === undefined
          ? {}
          : { reviewSummary: result.reviewSummary }),
        ...(result.landingDecision === undefined
          ? {}
          : { landingDecision: result.landingDecision }),
        visualEvidence: (result.visualEvidence ?? []).map((evidence) => ({
          screenshotPath: evidence.screenshotPath,
          ...(evidence.caption === undefined
            ? {}
            : { caption: evidence.caption }),
          ...(evidence.referencePaths === undefined
            ? {}
            : { referencePaths: evidence.referencePaths }),
          ...(evidence.url === undefined ? {} : { url: evidence.url }),
        })),
      },
    };
    if (
      branchPushed.implementation.branch !==
      branchPushed.workspace.identity.branch
    )
      return {
        kind: "blocked",
        state,
        result: blocked("implementation-branch"),
      };
    state = await replace(input, state, branchPushed);
    phase = state.phases[input.phaseIndex];
  }
  if (phase?.kind !== "implementation" || phase.status !== "branch-pushed")
    throw new RangeError("Implementation phase is not ready for validation");
  try {
    const validated = await validatePlanningImplementation({
      state,
      phase,
      host: input.host,
      workspaces: input.workspaces,
      git: input.git,
    });
    state = await replace(input, state, {
      ...phase,
      status: "pull-request-open",
      publication: validated.publication,
      pullRequest: validated.pullRequest,
      finish: {},
    });
    return { kind: "validated", state };
  } catch (error) {
    if (error instanceof PlanningImplementationValidationError)
      return {
        kind: "blocked",
        state,
        result: blocked(error.message),
      };
    throw error;
  }
}
