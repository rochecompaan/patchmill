import type { GitWorktreeStrategyConfig } from "../../../git/types.ts";
import { parseCanonicalPullRequestUrl } from "../../../host/pull-request-reference.ts";
import type { PlanningPublicationOperations } from "../../../git/planning-publication-git.ts";
import type { PlanningWorkspaceLifecycle } from "../../../git/planning-workspaces.ts";
import type { PullRequestHost } from "../../../host/pull-requests.ts";
import { renderPlanningPullRequestMarker } from "../../../workflow/planning-pull-request-markers.ts";
import type { PlanningIssueLock } from "../../../workflow/planning-issue-lock.ts";
import { PlanningStateValidationError } from "../../../workflow/planning-state.ts";
import type { PlanningStateStore } from "../../../workflow/planning-state-store.ts";
import type {
  ImplementationBranchPushedPlanningPhase,
  ImplementationWorkspaceReadyPlanningPhase,
  PlanningStateV1,
} from "../../../workflow/planning-state-types.ts";
import type { RunCostReport } from "./run-cost.ts";
import { planningRunCost } from "./planning-implementation-run-cost.ts";
import { implementationPhaseReplacer } from "./planning-implementation-state.ts";
import type {
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
import {
  blockedAgentWorkspaceFailure,
  implementationBlocked,
  implementationDiagnosticBase,
  implementationFailure,
  unsafeWorkspaceEvidence,
} from "./planning-implementation-diagnostics.ts";
import type { AgentIssueInternalBlockedResult } from "./types.ts";

export type PlanningImplementationOutcome =
  | { kind: "validated"; state: PlanningStateV1 }
  | {
      kind: "blocked";
      state: PlanningStateV1;
      result: AgentIssueInternalBlockedResult;
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
    | AgentIssuePrCreatedResult
    | AgentIssueMergedResult
    | AgentIssueInternalBlockedResult
  >;
  resolveRunCost?: () => Promise<RunCostReport | undefined>;
  workspaceCreated?: boolean;
  now?: () => Date;
};

/** Runs the implementation agent only once, then durably validates its PR. */
export async function runPlanningImplementation(
  input: PlanningImplementationInput,
): Promise<PlanningImplementationOutcome> {
  const replace = implementationPhaseReplacer(input);
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
        result: implementationBlocked(
          "implementation-configuration",
          implementationFailure(
            implementationDiagnosticBase(state, phase),
            "implementation-configuration",
            {
              expectedRemote: phase.workspace.remote,
              observedRemote: input.configuredGit.remote,
              expectedBaseBranch: phase.base.baseBranch,
              observedBaseBranch: input.configuredGit.baseBranch,
            },
          ),
        ),
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
        checkpoint: (nextPhase) => replace(state, nextPhase),
      });
      throw error;
    }
    const recovered = await recoverPostAgentWorkspace({
      state,
      phaseIndex: input.phaseIndex,
      phase,
      workspaces: input.workspaces,
      git: input.git,
      checkpoint: (nextPhase) => replace(state, nextPhase),
    });
    if (recovered.kind === "unsafe") {
      const workspaceEvidence = unsafeWorkspaceEvidence(recovered);
      // The agent's own blocker explains why it stopped; the unsafe workspace
      // snapshot is retained as catalog details rather than merged into agent
      // supplied text.
      if (result.status === "blocked")
        return {
          kind: "blocked",
          state: recovered.state,
          result: {
            ...result,
            reason: `${result.reason}\n\nThe implementation workspace was left dirty or unproven; the worktree is preserved for inspection.`,
            publicFailure:
              result.publicFailure ??
              blockedAgentWorkspaceFailure({
                base: implementationDiagnosticBase(state, phase),
                expectedHeadOid: phase.workspace.headOid,
                evidence: workspaceEvidence,
                result,
              }),
          },
        };
      return {
        kind: "blocked",
        state: recovered.state,
        result: implementationBlocked(
          "implementation-workspace",
          implementationFailure(
            implementationDiagnosticBase(state, phase),
            "implementation-workspace",
            { ...workspaceEvidence, expectedHeadOid: phase.workspace.headOid },
          ),
        ),
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
        result: implementationBlocked(
          "implementation-direct-merge",
          implementationFailure(
            implementationDiagnosticBase(state, phase),
            "implementation-direct-merge",
            { reportedBranch: result.branch, mergeCommit: result.mergeCommit },
          ),
        ),
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
          result: implementationBlocked(
            "implementation-ancestry",
            implementationFailure(
              implementationDiagnosticBase(state, phase),
              "implementation-ancestry",
              {
                baseOid: phase.base.baseOid,
                savedHeadOid: phase.workspace.headOid,
                observedHeadOid: workspace.headOid,
                commits: result.commits,
              },
            ),
          ),
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
        result: implementationBlocked(
          "implementation-remote-head",
          implementationFailure(
            implementationDiagnosticBase(state, phase),
            "implementation-remote-head",
            {
              remote: phase.workspace.remote,
              expectedHeadOid: workspace.headOid,
              observedRemoteState: remote.state,
              ...(remote.state === "present"
                ? { observedHeadOid: remote.headOid }
                : {}),
            },
          ),
        ),
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
      return {
        kind: "blocked",
        state,
        result: implementationBlocked(
          "implementation-url",
          implementationFailure(
            implementationDiagnosticBase(state, phase),
            "implementation-url",
            {
              reportedUrl: result.prUrl,
              expectedRepository: `${targetRepository.host}/${targetRepository.owner}/${targetRepository.repository}`,
            },
          ),
        ),
      };
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
        result: implementationBlocked(
          "implementation-branch",
          implementationFailure(
            implementationDiagnosticBase(state, phase),
            "implementation-branch",
            {
              expectedBranch: phase.workspace.identity.branch,
              reportedBranch: branchPushed.implementation.branch,
            },
          ),
        ),
      };
    try {
      state = await replace(state, branchPushed);
    } catch (error) {
      if (error instanceof PlanningStateValidationError)
        return {
          kind: "blocked",
          state,
          result: implementationBlocked(
            "implementation-evidence",
            implementationFailure(
              implementationDiagnosticBase(state, phase),
              "implementation-evidence",
              { validation: error.message },
            ),
          ),
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
    state = await replace(state, {
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
        result: implementationBlocked(
          error.message,
          implementationFailure(
            implementationDiagnosticBase(state, phase),
            "implementation-validation",
            {
              validationReason: error.validationReason,
              pullRequestUrl: phase.implementation.prUrl,
              ...(error.facts.expected === undefined
                ? {}
                : { expected: error.facts.expected }),
              ...(error.facts.observed === undefined
                ? {}
                : { observed: error.facts.observed }),
            },
          ),
        ),
      };
    throw error;
  }
}
