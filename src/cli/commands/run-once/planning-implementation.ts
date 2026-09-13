import type { GitWorktreeStrategyConfig } from "../../../git/types.ts";
import { parseCanonicalPullRequestUrl } from "../../../host/pull-request-reference.ts";
import type { PlanningPublicationOperations } from "../../../git/planning-publication-git.ts";
import type { PlanningWorkspaceLifecycle } from "../../../git/planning-workspaces.ts";
import type { PullRequestHost } from "../../../host/pull-requests.ts";
import { renderPlanningPullRequestMarker } from "../../../workflow/planning-pull-request-markers.ts";
import type { PlanningIssueLock } from "../../../workflow/planning-issue-lock.ts";
import { replacePlanningPhase } from "../../../workflow/planning-phase-replacement.ts";
import { PlanningStateValidationError } from "../../../workflow/planning-state.ts";
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
} from "../../../issue-run/types.ts";
import {
  assertPlanningImplementationAncestry,
  PlanningImplementationAncestryError,
} from "./planning-implementation-ancestry.ts";
import {
  PlanningImplementationValidationError,
  validatePlanningImplementation,
} from "./planning-implementation-validation.ts";
import { recoverPostAgentWorkspace } from "./planning-implementation-workspace-recovery.ts";

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
    if (
      input.configuredGit.remote !== phase.workspace.remote ||
      input.configuredGit.baseBranch !== phase.base.baseBranch
    )
      return {
        kind: "blocked",
        state,
        result: blocked("implementation-configuration"),
      };
    let result: Awaited<ReturnType<PlanningImplementationInput["runAgent"]>>;
    try {
      result = await input.runAgent({
        state,
        phase,
        git: {
          ...input.configuredGit,
          remote: phase.workspace.remote,
          baseBranch: phase.base.baseBranch,
          allowDirectLand: false,
        },
        workspaceCreated: input.workspaceCreated ?? false,
        requiredPullRequestMarker: renderPlanningPullRequestMarker({
          issueNumber: state.issueNumber,
          phase: "implementation",
        }),
      });
    } catch (error) {
      await recoverPostAgentWorkspace({
        state,
        phaseIndex: input.phaseIndex,
        phase,
        workspaces: input.workspaces,
        git: input.git,
        checkpoint: (nextPhase) => replace(input, state, nextPhase),
      });
      throw error;
    }
    const recovered = await recoverPostAgentWorkspace({
      state,
      phaseIndex: input.phaseIndex,
      phase,
      workspaces: input.workspaces,
      git: input.git,
      checkpoint: (nextPhase) => replace(input, state, nextPhase),
    });
    if (recovered.kind === "unsafe") {
      // The agent's own blocker explains why it stopped; the unsafe
      // workspace is evidence it left behind. Surface both rather than
      // masking the agent's reason behind a generic workspace code.
      if (result.status === "blocked")
        return {
          kind: "blocked",
          state: recovered.state,
          result: {
            ...result,
            reason: `${result.reason}\n\nThe implementation workspace was left dirty or unproven; the worktree is preserved for inspection.`,
          },
        };
      return {
        kind: "blocked",
        state: recovered.state,
        result: blocked("implementation-workspace"),
      };
    }
    state = recovered.state;
    phase = recovered.phase;
    const workspace = recovered.workspace;
    if (result.status === "blocked") return { kind: "blocked", state, result };
    if (result.status === "merged")
      return {
        kind: "blocked",
        state,
        result: blocked("implementation-direct-merge"),
      };
    const runCostReport = await input.resolveRunCost?.();
    try {
      await assertPlanningImplementationAncestry({
        state,
        baseOid: phase.base.baseOid,
        savedHeadOid: phase.workspace.headOid,
        headOid: workspace.headOid,
        commits: result.commits,
        git: input.git,
      });
    } catch (error) {
      if (error instanceof PlanningImplementationAncestryError)
        return {
          kind: "blocked",
          state,
          result: blocked("implementation-ancestry"),
        };
      throw error;
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
    const canonicalPrUrl = parseCanonicalPullRequestUrl(
      result.prUrl,
      targetRepository,
    );
    if (canonicalPrUrl === undefined)
      return { kind: "blocked", state, result: blocked("implementation-url") };
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
        prUrl: canonicalPrUrl.url,
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
    try {
      state = await replace(input, state, branchPushed);
    } catch (error) {
      if (error instanceof PlanningStateValidationError)
        return {
          kind: "blocked",
          state,
          result: blocked("implementation-evidence"),
        };
      throw error;
    }
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
