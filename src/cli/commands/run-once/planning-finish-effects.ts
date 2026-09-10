import { resolve } from "node:path";
import { runCleanupHookScript } from "../../../pi/hooks.ts";
import { renderPlanningPullRequestMarker } from "../../../workflow/planning-pull-request-markers.ts";
import { ensureAutomationLabel } from "./automation-labels.ts";
import { handoffComment } from "./pipeline-comments.ts";
import { nextLabels } from "./pipeline-lifecycle.ts";
import { publishPlanningPrRunCost } from "./pr-cost-publication.ts";
import { validateVisualEvidenceReferences } from "./visual-evidence.ts";
import { cleanupLabelsForImplementation } from "./workflow-state.ts";
import { planLabelChange } from "../triage/labels.ts";
import type { PlanningFinishInput } from "./planning-finish.ts";
import type { PlanningStateV1 } from "../../../workflow/planning-state-types.ts";
import type { RunOnceHostProvider } from "../../../host/types.ts";
import type { AgentIssueConfig, CommandRunner, IssueSummary } from "./types.ts";

function planPath(state: PlanningStateV1): string {
  for (const phase of state.phases)
    if ("artifacts" in phase) {
      const path = phase.artifacts.find(
        (artifact) => artifact.kind === "plan",
      )?.path;
      if (path) return path;
    }
  throw new Error("Planning implementation requires a durable plan path");
}

export type PlanningFinishEffectsInput = {
  runner: CommandRunner;
  config: AgentIssueConfig;
  issue: IssueSummary;
  labels: string[];
  readyLabel: string;
  inProgressLabel: string;
  doneLabel: string;
  needsInfoLabel: string;
  host: RunOnceHostProvider;
  phaseIndex: number;
  now?: (() => Date) | undefined;
};

/** Builds finish effects exclusively from durable implementation evidence. */
export function createPlanningFinishEffects(
  input: PlanningFinishEffectsInput,
): (
  state: PlanningStateV1,
) => Omit<
  PlanningFinishInput,
  "state" | "phaseIndex" | "lock" | "stateStore" | "workspaces"
> {
  return (durable) => ({
    effects: {
      publishCost: async () => {
        const implementation = durable.phases[input.phaseIndex];
        if (
          implementation?.kind !== "implementation" ||
          !("implementation" in implementation) ||
          implementation.implementation.runCostReport === undefined ||
          !("pullRequest" in implementation)
        )
          return;
        const report = implementation.implementation.runCostReport;
        await publishPlanningPrRunCost({
          host: input.host,
          prUrl: implementation.pullRequest.url,
          marker: renderPlanningPullRequestMarker({
            issueNumber: durable.issueNumber,
            phase: "implementation",
          }),
          report: {
            stages: report.stages.map((stage) => ({
              ...stage,
              models: stage.models.map((model) => ({ ...model })),
            })),
            promptTokens: report.promptTokens,
            outputTokens: report.outputTokens,
            estimatedCostUsd: report.estimatedCostUsd,
          },
        });
      },
      validateVisualEvidence: async () => {
        const implementation = durable.phases[input.phaseIndex];
        if (
          implementation?.kind !== "implementation" ||
          !("implementation" in implementation)
        )
          return;
        await validateVisualEvidenceReferences({
          repoRoot: resolve(
            input.config.repoRoot,
            implementation.workspace.identity.worktreePath,
          ),
          evidence: implementation.implementation.visualEvidence.map(
            (item) => ({
              screenshotPath: item.screenshotPath,
              ...(item.caption === undefined ? {} : { caption: item.caption }),
              ...(item.referencePaths === undefined
                ? {}
                : { referencePaths: [...item.referencePaths] }),
              ...(item.url === undefined ? {} : { url: item.url }),
            }),
          ),
          runner: input.runner,
          referenceScreenshotPaths:
            input.config.projectPolicy.visualEvidence.referenceScreenshotPaths,
        });
      },
      postHandoff: async (result) => {
        const body = handoffComment(
          planPath(durable),
          result,
          input.config.baseBranch,
        );
        const current = await input.host.viewIssue(input.issue.number);
        if (!current.comments?.some((comment) => comment.body === body))
          await input.host.commentIssue(input.issue.number, body);
      },
      cleanupHook: async () => {
        const implementation = durable.phases[input.phaseIndex];
        if (
          implementation?.kind !== "implementation" ||
          !("workspace" in implementation)
        )
          return;
        const results = await runCleanupHookScript(
          input.runner,
          input.config.repoRoot,
          implementation.workspace.identity.worktreePath,
          input.config.cleanupHook,
        );
        if (results.some((result) => result.status === "failed"))
          throw new Error("Planning cleanup hook failed");
      },
      ensureDoneLabel: () =>
        ensureAutomationLabel(input.host, input.config, input.doneLabel),
      applyDoneLabels: () =>
        input.host.applyLabels(
          planLabelChange(
            input.issue.number,
            input.labels,
            nextLabels(
              cleanupLabelsForImplementation(input.labels, {
                readyLabel: input.readyLabel,
                policy: input.config.approvalPolicy,
              }),
              [input.inProgressLabel, input.needsInfoLabel],
              [input.doneLabel],
            ),
          ),
        ),
    },
    ...(input.now === undefined ? {} : { now: input.now }),
  });
}
