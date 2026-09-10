import type { GitWorktreeStrategyConfig } from "../../../git/types.ts";
import {
  PlanningPublicationGitError,
  type PlanningPublicationOperations,
} from "../../../git/planning-publication-git.ts";
import type { PlanningWorkspaceLifecycle } from "../../../git/planning-workspaces.ts";
import type { PullRequestHost } from "../../../host/pull-requests.ts";
import { renderPlanningPullRequestMarker } from "../../../workflow/planning-pull-request-markers.ts";
import type { PlanningIssueLock } from "../../../workflow/planning-issue-lock.ts";
import { replacePlanningPhase } from "../../../workflow/planning-phase-replacement.ts";
import type { PlanningStateStore } from "../../../workflow/planning-state-store.ts";
import type {
  ImplementationBranchPushedPlanningPhase,
  ImplementationWorkspaceReadyPlanningPhase,
  PlanningStateV1,
} from "../../../workflow/planning-state-types.ts";
import type { RunCostReport } from "./run-cost.ts";
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
  configuredGit: GitWorktreeStrategyConfig;
  runAgent(input: {
    state: PlanningStateV1;
    phase: ImplementationWorkspaceReadyPlanningPhase;
    git: GitWorktreeStrategyConfig;
    requiredPullRequestMarker: string;
    workspaceCreated: boolean;
  }): Promise<
    AgentIssuePrCreatedResult | AgentIssueMergedResult | AgentIssueBlockedResult
  >;
  resolveRunCost?: () => Promise<RunCostReport | undefined>;
  workspaceCreated?: boolean;
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

function finiteNonnegative(value: number, field: string): number {
  if (!Number.isFinite(value) || value < 0)
    throw new RangeError(`Invalid planning run-cost ${field}`);
  return value;
}

function planningRunCost(report: RunCostReport) {
  return {
    stages: report.stages.map((stage) => ({
      stage: stage.stage,
      models: stage.models.map((model) => ({
        model: model.model,
        promptTokens: finiteNonnegative(
          model.promptTokens,
          "model promptTokens",
        ),
        outputTokens: finiteNonnegative(
          model.outputTokens,
          "model outputTokens",
        ),
        estimatedCostUsd: finiteNonnegative(
          model.estimatedCostUsd,
          "model estimatedCostUsd",
        ),
      })),
      promptTokens: finiteNonnegative(stage.promptTokens, "stage promptTokens"),
      outputTokens: finiteNonnegative(stage.outputTokens, "stage outputTokens"),
      estimatedCostUsd: finiteNonnegative(
        stage.estimatedCostUsd,
        "stage estimatedCostUsd",
      ),
    })),
    promptTokens: finiteNonnegative(report.promptTokens, "promptTokens"),
    outputTokens: finiteNonnegative(report.outputTokens, "outputTokens"),
    estimatedCostUsd: finiteNonnegative(
      report.estimatedCostUsd,
      "estimatedCostUsd",
    ),
  };
}

async function replace(
  input: PlanningImplementationInput,
  state: PlanningStateV1,
  phase: PlanningStateV1["phases"][number],
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
      workspaceCreated: input.workspaceCreated ?? false,
      requiredPullRequestMarker: renderPlanningPullRequestMarker({
        issueNumber: state.issueNumber,
        phase: "implementation",
      }),
    });
    if (result.status === "blocked") {
      const workspace = await input.workspaces.inspect(
        phase.workspace.identity,
      );
      if (workspace.state !== "ready" || !workspace.clean)
        return {
          kind: "blocked",
          state,
          result: blocked("implementation-workspace"),
        };
      if (workspace.headOid !== phase.workspace.headOid) {
        try {
          await input.git.assertAncestor({
            ancestorOid: phase.workspace.headOid,
            descendantOid: workspace.headOid,
          });
        } catch (error) {
          if (
            error instanceof PlanningPublicationGitError &&
            error.reason === "not-ancestor"
          )
            return {
              kind: "blocked",
              state,
              result: blocked("implementation-workspace"),
            };
          throw error;
        }
        state = await replace(input, state, {
          ...phase,
          workspace: { ...phase.workspace, headOid: workspace.headOid },
        });
      }
      return { kind: "blocked", state, result };
    }
    if (result.status === "merged")
      return {
        kind: "blocked",
        state,
        result: blocked("implementation-direct-merge"),
      };
    const runCostReport = await input.resolveRunCost?.();
    const workspace = await input.workspaces.inspect(phase.workspace.identity);
    if (workspace.state !== "ready" || !workspace.clean)
      return {
        kind: "blocked",
        state,
        result: blocked("implementation-workspace"),
      };
    if (workspace.headOid !== phase.workspace.headOid) {
      try {
        await input.git.assertAncestor({
          ancestorOid: phase.workspace.headOid,
          descendantOid: workspace.headOid,
        });
      } catch (error) {
        if (
          error instanceof PlanningPublicationGitError &&
          error.reason === "not-ancestor"
        )
          return {
            kind: "blocked",
            state,
            result: blocked("implementation-workspace"),
          };
        throw error;
      }
    }
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
        ...(runCostReport === undefined
          ? {}
          : { runCostReport: planningRunCost(runCostReport) }),
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
