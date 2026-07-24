import { DEFAULT_TRIAGE_POLICY } from "../triage/labels.ts";
import type { RunOnceWorkflowState } from "./workflow-state.ts";
import type {
  AgentIssueConfig,
  AgentIssuePiResult,
  AgentIssueRunCheckpoints,
  AgentIssueVisualEvidence,
} from "./types.ts";
import type { readRunState } from "./run-state.ts";

export class AgentIssueSafetyError extends Error {
  readonly name = "AgentIssueSafetyError";
}

export function nextLabels(
  labels: string[],
  remove: string[],
  add: string[],
): string[] {
  const removed = new Set(remove);
  const kept = labels.filter((label) => !removed.has(label));
  return [...kept, ...add.filter((label) => !kept.includes(label))];
}

export function workflowTransition(
  state: RunOnceWorkflowState,
  config: Pick<AgentIssueConfig, "approvalPolicy">,
): string {
  if (state.kind === "plan-approved") return "plan-approved -> agent-done";
  if (state.kind === "spec-approved") {
    return config.approvalPolicy.planApproval.required
      ? "spec-approved -> plan-review"
      : "spec-approved -> agent-done";
  }
  if (state.kind === "agent-ready") {
    if (config.approvalPolicy.specApproval.required)
      return "agent-ready -> spec-review";
    if (config.approvalPolicy.planApproval.required)
      return "agent-ready -> plan-review";
    return "agent-ready -> agent-done";
  }
  return `${state.kind} -> no-issue`;
}

export function hasBlockedSavedWorkspaceState(
  state: Awaited<ReturnType<typeof readRunState>>,
): boolean {
  return (
    state?.status === "blocked" &&
    (state.branch !== undefined || state.worktreePath !== undefined)
  );
}

export function lifecycleLabels(
  config: Pick<AgentIssueConfig, "readyLabel" | "triagePolicy">,
): {
  ready: string;
  inProgress: string;
  done: string;
  needsInfo: string;
} {
  const triagePolicy = config.triagePolicy ?? DEFAULT_TRIAGE_POLICY;
  return {
    ready: config.triagePolicy?.labels.ready ?? config.readyLabel,
    inProgress: triagePolicy.labels.inProgress,
    done: triagePolicy.labels.done,
    needsInfo: triagePolicy.labels.needsInfo,
  };
}

const RESUME_ONLY_SIDE_EFFECT_CHECKPOINTS = new Set<
  keyof AgentIssueRunCheckpoints
>([
  "claimed",
  "startedCommentPosted",
  "readyLabelRestored",
  "specPublished",
  "specReadyCommentPosted",
  "planPublished",
  "planReadyCommentPosted",
  "worktreeReady",
  "implementationCompleted",
  "prCostSummaryUpdated",
  "visualEvidenceValidated",
  "handoffCommentPosted",
  "doneLabelEnsured",
  "doneLabelApplied",
]);

export function effectiveCheckpoints(
  checkpoints: AgentIssueRunCheckpoints | undefined,
  resumable = false,
): AgentIssueRunCheckpoints | undefined {
  if (resumable || !checkpoints) return checkpoints;
  const filtered = Object.fromEntries(
    Object.entries(checkpoints).filter(
      ([checkpoint]) =>
        !RESUME_ONLY_SIDE_EFFECT_CHECKPOINTS.has(
          checkpoint as keyof AgentIssueRunCheckpoints,
        ),
    ),
  ) as AgentIssueRunCheckpoints;
  return Object.keys(filtered).length > 0 ? filtered : undefined;
}

function stringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const entries = value.filter(
    (entry): entry is string => typeof entry === "string",
  );
  return entries.length === value.length ? entries : undefined;
}

function visualEvidenceArray(
  value: unknown,
): AgentIssueVisualEvidence[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const entries = value.flatMap((entry): AgentIssueVisualEvidence[] => {
    if (!entry || typeof entry !== "object") return [];
    const record = entry as Record<string, unknown>;
    if (typeof record.screenshotPath !== "string") return [];
    return [
      {
        screenshotPath: record.screenshotPath,
        caption:
          typeof record.caption === "string" ? record.caption : undefined,
        referencePaths: stringArray(record.referencePaths),
        url: typeof record.url === "string" ? record.url : undefined,
      },
    ];
  });
  return entries.length > 0 ? entries : undefined;
}

export function successfulImplementationFromState(
  state:
    | {
        implementationStatus?: "pr-created" | "merged";
        branch?: string;
        prUrl?: string;
        mergeCommit?: string;
        commits?: unknown;
        validation?: unknown;
        reviewSummary?: unknown;
        landingDecision?: unknown;
        visualEvidence?: unknown;
      }
    | undefined,
):
  | Extract<AgentIssuePiResult, { status: "pr-created" | "merged" }>
  | undefined {
  if (!state?.implementationStatus || !state.branch) return undefined;
  const commits = stringArray(state.commits);
  const validation = stringArray(state.validation);
  if (!commits || !validation) return undefined;
  const reviewSummary =
    typeof state.reviewSummary === "string" ? state.reviewSummary : undefined;
  const landingDecision =
    typeof state.landingDecision === "string"
      ? state.landingDecision
      : undefined;
  const visualEvidence = visualEvidenceArray(state.visualEvidence);
  if (
    state.implementationStatus === "pr-created" &&
    typeof state.prUrl === "string"
  ) {
    return {
      status: "pr-created",
      prUrl: state.prUrl,
      branch: state.branch,
      commits,
      validation,
      reviewSummary,
      landingDecision,
      visualEvidence,
    };
  }
  if (
    state.implementationStatus === "merged" &&
    typeof state.mergeCommit === "string"
  ) {
    return {
      status: "merged",
      branch: state.branch,
      mergeCommit: state.mergeCommit,
      commits,
      validation,
      reviewSummary,
      landingDecision,
    };
  }
  return undefined;
}

export function assertDirectLandAllowed(
  result: Extract<AgentIssuePiResult, { status: "pr-created" | "merged" }>,
  config: Pick<AgentIssueConfig, "allowDirectLand" | "skills">,
  source: string,
): void {
  if (result.status !== "merged") return;
  if (!config.allowDirectLand)
    throw new AgentIssueSafetyError(
      `${source} returned merged while git.allowDirectLand is false`,
    );
  if (!config.skills.landing)
    throw new AgentIssueSafetyError(
      `${source} returned merged but direct landing requires git.allowDirectLand=true and configured skills.landing`,
    );
}
