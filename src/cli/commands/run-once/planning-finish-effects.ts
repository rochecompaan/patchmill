import { resolve } from "node:path";
import { runCleanupHookScript } from "../../../pi/hooks.ts";
import { renderPlanningPullRequestMarker } from "../../../workflow/planning-pull-request-markers.ts";
import { ensureAutomationLabel } from "./automation-labels.ts";
import { handoffComment } from "./pipeline-comments.ts";
import { progress } from "./pipeline-progress.ts";
import { applyPlanningDoneLabels } from "./planning-lifecycle-labels.ts";
import { publishPlanningPrRunCost } from "./pr-cost-publication.ts";
import { validateVisualEvidenceReferences } from "./visual-evidence.ts";
import type { PlanningFinishInput } from "./planning-finish.ts";
import type { PlanningStateV1 } from "../../../workflow/planning-state-types.ts";
import type { RunOnceHostProvider } from "../../../host/types.ts";
import {
  artifactPath,
  requiredImplementationFinishContext,
} from "./planning-runtime-state.ts";
import type { AgentIssueConfig, CommandRunner, IssueSummary } from "./types.ts";

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
  progressReporter?: Parameters<typeof progress>[0]["progress"];
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
  return (durable) => {
    const implementation = requiredImplementationFinishContext(
      durable,
      input.phaseIndex,
    );
    return {
      effects: {
        publishCost: async () => {
          const report = implementation.implementation.runCostReport;
          if (report === undefined) return;
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
          await validateVisualEvidenceReferences({
            repoRoot: resolve(
              input.config.repoRoot,
              implementation.workspace.identity.worktreePath,
            ),
            evidence: implementation.implementation.visualEvidence.map(
              (item) => ({
                screenshotPath: item.screenshotPath,
                ...(item.caption === undefined
                  ? {}
                  : { caption: item.caption }),
                ...(item.referencePaths === undefined
                  ? {}
                  : { referencePaths: [...item.referencePaths] }),
                ...(item.url === undefined ? {} : { url: item.url }),
              }),
            ),
            runner: input.runner,
            referenceScreenshotPaths:
              input.config.projectPolicy.visualEvidence
                .referenceScreenshotPaths,
          });
        },
        postHandoff: async (result) => {
          const body = handoffComment(
            artifactPath(durable, "plan"),
            result,
            input.config.baseBranch,
          );
          const current = await input.host.viewIssue(input.issue.number);
          if (!current.comments?.some((comment) => comment.body === body))
            await input.host.commentIssue(input.issue.number, body);
        },
        cleanupHook: async () => {
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
          applyPlanningDoneLabels({
            host: input.host,
            issueNumber: input.issue.number,
            labels: {
              ready: input.readyLabel,
              inProgress: input.inProgressLabel,
              needsInfo: input.needsInfoLabel,
              done: input.doneLabel,
            },
          }),
      },
      onCostPublicationFailure: async (error) =>
        progress(
          { progress: input.progressReporter },
          "warning",
          "run-cost",
          "Patchmill could not update the PR run-cost summary",
          {
            issueNumber: input.issue.number,
            data: error instanceof Error ? error.message : String(error),
            consoleMessage:
              "Warning: Patchmill could not update the PR run-cost summary",
          },
        ),
      ...(input.now === undefined ? {} : { now: input.now }),
    };
  };
}
