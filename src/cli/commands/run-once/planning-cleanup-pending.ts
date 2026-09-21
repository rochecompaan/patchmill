import type { RunOnceHostProvider } from "../../../host/types.ts";
import { ensureAutomationLabel } from "./automation-labels.ts";
import { runOnceFailure } from "./result-diagnostics.ts";
import type { IssueSummary } from "../../../issue/types.ts";
import type { PlanningStateV1 } from "../../../workflow/planning-state-types.ts";
import { applyPlanningCleanupPendingLabels } from "./planning-lifecycle-labels.ts";
import type { PlanningCleanupPendingOutcome } from "./planning-phase-runner-shared.ts";
import type {
  AgentIssueConfig,
  AgentIssueCleanupPendingResult,
} from "./types.ts";

/** Quotes repository-relative path diagnostics without admitting terminal controls. */
export function formatPlanningCleanupPath(path: string): string {
  return JSON.stringify(path).replace(
    /[\x7f-\x9f]/gu,
    (character) =>
      `\\u${character.charCodeAt(0).toString(16).padStart(4, "0")}`,
  );
}

function artifactPath(state: PlanningStateV1, kind: "spec" | "plan") {
  return state.phases
    .flatMap((phase) => ("artifacts" in phase ? phase.artifacts : []))
    .find((artifact) => artifact.kind === kind)?.path;
}

export function planningCleanupPendingResult(
  issue: IssueSummary,
  outcome: PlanningCleanupPendingOutcome,
  readyLabel: string,
): AgentIssueCleanupPendingResult {
  const phase = outcome.state.phases.find(
    (item) => item.kind === outcome.phase,
  );
  if (!phase || !("workspace" in phase) || !("pullRequest" in phase))
    throw new Error(
      "Cleanup pending outcome is missing phase workspace evidence",
    );
  const result: AgentIssueCleanupPendingResult = {
    status: "cleanup-pending",
    issue,
    phase: outcome.phase,
    prUrl: outcome.prUrl,
    branch: phase.workspace.identity.branch,
    worktreePath: phase.workspace.identity.worktreePath,
    reason: outcome.reason,
    publicFailure: runOnceFailure("ignored-worktree-content", {
      issueNumber: issue.number,
      status: "cleanup-pending",
      phase: outcome.phase,
      branch: phase.workspace.identity.branch,
      worktreePath: phase.workspace.identity.worktreePath,
      ignoredPaths: outcome.ignoredPaths,
    }),
    ignoredPaths: [...outcome.ignoredPaths],
    remediation: [
      `Inspect and preserve or remove the listed ignored paths in ${phase.workspace.identity.worktreePath}.`,
      `After every blocker is handled, apply \`${readyLabel}\` to issue #${issue.number}.`,
      `Rerun \`patchmill run-once --issue ${issue.number}\`.`,
    ],
  };
  const specPath = artifactPath(outcome.state, "spec");
  const planPath = artifactPath(outcome.state, "plan");
  if (specPath) result.specPath = specPath;
  if (planPath) result.planPath = planPath;
  if (outcome.phase === "implementation" && "implementation" in phase) {
    result.commits = [...phase.implementation.commits];
    result.validation = [...phase.implementation.validation];
  }
  return result;
}

function cleanupPendingComment(result: AgentIssueCleanupPendingResult): string {
  return [
    "Patchmill cleanup pending",
    "",
    `Phase: ${result.phase}`,
    `Pull request: ${result.prUrl}`,
    `Worktree: ${result.worktreePath}`,
    "Ignored paths requiring operator handling:",
    ...result.ignoredPaths.map(
      (path) => `- ${formatPlanningCleanupPath(path)}`,
    ),
    "",
    ...result.remediation,
  ].join("\n");
}

export async function publishPlanningCleanupPending(input: {
  host: Pick<
    RunOnceHostProvider,
    "viewIssue" | "applyLabels" | "commentIssue" | "listLabels" | "createLabel"
  >;
  config: AgentIssueConfig;
  result: AgentIssueCleanupPendingResult;
  labels: { ready: string; inProgress: string; needsInfo: string };
}): Promise<void> {
  const current = await input.host.viewIssue(input.result.issue.number);
  const body = cleanupPendingComment(input.result);
  if (!current.comments?.some((comment) => comment.body === body))
    await input.host.commentIssue(input.result.issue.number, body);
  await ensureAutomationLabel(input.host, input.config, input.labels.needsInfo);
  await applyPlanningCleanupPendingLabels({
    host: input.host,
    issueNumber: input.result.issue.number,
    labels: input.labels,
  });
}
