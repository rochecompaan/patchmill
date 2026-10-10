import type { IssueSummary } from "../../../issue/types.ts";
import type { CommandRunner } from "../../../command/types.ts";
import { join } from "node:path";
import { captureLegacyImplementationPr } from "./legacy-pr-evidence.ts";
import { cleanupLegacyPublishedWorkspace } from "./legacy-pr-cleanup.ts";
import { planLabelChange } from "../triage/labels.ts";
import { ensureAutomationLabel } from "./automation-labels.ts";
import { handoffComment } from "./pipeline-comments.ts";
import { nextLabels } from "./pipeline-lifecycle.ts";
import {
  progress as emitProgress,
  type PipelineProgressOptions,
  withLogPath,
} from "./pipeline-progress.ts";
import { validateVisualEvidenceReferences } from "./visual-evidence.ts";
import { cleanupLabelsForImplementation } from "./workflow-state.ts";
import { writeRunState } from "./run-state.ts";
import type { AgentIssueConfig, AgentIssuePipelineResult } from "./types.ts";
import type { RunOnceHostProvider } from "../../../host/types.ts";
import type { RunCostReport } from "./run-cost.ts";
import { publishPrRunCost } from "./pr-cost-publication.ts";
import type { PipelineSuccessfulImplementationResult } from "./pipeline-implementation.ts";

export type PipelineFinishStageResult =
  | { kind: "finished"; result: AgentIssuePipelineResult }
  | { kind: "unexpected"; error: Error };

export type PipelineFinishStageOptions = {
  lease: import("./types.ts").IssueRunLease;
  mutation?: import("../../../git/repository-mutation.ts").RepositoryMutationContext;
  runner: CommandRunner;
  host: RunOnceHostProvider;
  config: AgentIssueConfig;
  issue: IssueSummary;
  labels: string[];
  readyLabel: string;
  inProgressLabel: string;
  doneLabel: string;
  needsInfoLabel: string;
  checkpoints: Record<string, boolean | undefined>;
  implemented: PipelineSuccessfulImplementationResult;
  implementationPr?: import("../../../workflow/implementation-pr-reconciliation.ts").ImplementationPrEvidence;
  merge?: { mergeOid: string; mergedBaseOid: string };
  runCostReport?: RunCostReport | undefined;
  specPath: string | undefined;
  specCommit: string | undefined;
  planPath: string | undefined;
  planCommit: string | undefined;
  branch: string | undefined;
  worktreePath: string;
  timestamp: string;
  runOptions: PipelineProgressOptions;
  runStep: <T>(label: string, fn: () => Promise<T>) => Promise<T>;
};

function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

export async function runPipelineFinishStage(
  options: PipelineFinishStageOptions,
): Promise<PipelineFinishStageResult> {
  try {
    const {
      runner,
      host,
      config,
      issue,
      readyLabel,
      inProgressLabel,
      doneLabel,
      needsInfoLabel,
      checkpoints,
      specPath,
      specCommit,
      planPath,
      planCommit,
      branch,
      worktreePath,
      timestamp,
      runOptions,
      runStep,
    } = options;
    let { implemented } = options;
    let labels = options.labels;
    if (!planPath || !branch || !worktreePath) {
      throw new Error(
        `Finishing implementation requires plan, branch, and worktree for issue #${issue.number}`,
      );
    }

    if (implemented.status !== "pr-created")
      throw new Error(
        "Agent direct landing cannot authorize legacy completion",
      );
    const captured = options.implementationPr
      ? undefined
      : await captureLegacyImplementationPr({
          runner,
          config,
          state: {
            issueNumber: issue.number,
            title: issue.title,
            status: "implementing",
            branch,
            worktreePath,
            prUrl: implemented.prUrl,
            commits: implemented.commits,
            createdAt: timestamp,
            updatedAt: timestamp,
          },
          ...(options.mutation ? { mutation: options.mutation } : {}),
        });
    const implementationPr = options.implementationPr ?? captured!.evidence;
    const merge =
      options.merge ??
      (captured?.kind === "merged"
        ? { mergeOid: captured.mergeOid, mergedBaseOid: captured.mergedBaseOid }
        : undefined);
    const ownedOptions = {
      ...options,
      implementationPr,
      ...(merge ? { merge } : {}),
    };
    await writeRunState(
      config.runStateDir,
      {
        issueNumber: issue.number,
        status: "implementing",
        specPath,
        specCommit,
        planPath,
        planCommit,
        branch,
        worktreePath,
        implementationStatus: "pr-created",
        implementationPr,
        merge,
        prUrl:
          implemented.status === "pr-created" ? implemented.prUrl : undefined,
        mergeCommit: merge?.mergeOid,
        commits: implemented.commits,
        validation: implemented.validation,
        reviewSummary: implemented.reviewSummary,
        landingDecision: implemented.landingDecision,
        runCostReport: options.runCostReport,
        visualEvidence:
          implemented.status === "pr-created"
            ? implemented.visualEvidence
            : undefined,
        handoffCommentPosted: checkpoints.handoffCommentPosted === true,
        checkpoints: { implementationCompleted: true },
      },
      options.lease,
      timestamp,
    );
    checkpoints.implementationCompleted = true;

    if (
      implemented.status === "pr-created" &&
      options.runCostReport &&
      !checkpoints.prCostSummaryUpdated
    ) {
      try {
        const publication = await publishPrRunCost({
          host,
          prUrl: implemented.prUrl,
          report: options.runCostReport,
        });
        await writeRunState(
          config.runStateDir,
          {
            issueNumber: issue.number,
            status: "implementing",
            checkpoints: { prCostSummaryUpdated: true },
          },
          options.lease,
          timestamp,
        );
        checkpoints.prCostSummaryUpdated = true;
        await emitProgress(
          runOptions,
          "info",
          "run-cost",
          `PR run-cost summary ${publication}`,
          { issueNumber: issue.number, data: options.runCostReport },
        );
      } catch (error) {
        await emitProgress(
          runOptions,
          "warning",
          "run-cost",
          "Patchmill could not update the PR run-cost summary",
          {
            issueNumber: issue.number,
            data: error instanceof Error ? error.message : String(error),
            consoleMessage:
              "Warning: Patchmill could not update the PR run-cost summary",
          },
        );
      }
    }

    if (
      implemented.status === "pr-created" &&
      (implemented.visualEvidence?.length ?? 0) > 0 &&
      !checkpoints.visualEvidenceValidated
    ) {
      const validatedEvidence = await validateVisualEvidenceReferences({
        repoRoot: join(config.repoRoot, worktreePath),
        evidence: implemented.visualEvidence,
        runner,
        referenceScreenshotPaths:
          config.projectPolicy.visualEvidence.referenceScreenshotPaths,
        onProgress: async (message) => {
          await emitProgress(runOptions, "info", "visual-evidence", message, {
            issueNumber: issue.number,
          });
        },
      });
      implemented = { ...implemented, visualEvidence: validatedEvidence };
      await writeRunState(
        config.runStateDir,
        {
          issueNumber: issue.number,
          status: "implementing",
          specPath,
          specCommit,
          planPath,
          planCommit,
          branch,
          worktreePath,
          implementationStatus: implemented.status,
          prUrl: implemented.prUrl,
          commits: implemented.commits,
          validation: implemented.validation,
          reviewSummary: implemented.reviewSummary,
          landingDecision: implemented.landingDecision,
          runCostReport: options.runCostReport,
          visualEvidence: validatedEvidence,
          checkpoints: { visualEvidenceValidated: true },
        },
        options.lease,
        timestamp,
      );
      checkpoints.visualEvidenceValidated = true;
    }

    if (!checkpoints.handoffCommentPosted) {
      await host.commentIssue(
        issue.number,
        handoffComment(planPath, implemented, config.baseBranch),
      );
      await writeRunState(
        config.runStateDir,
        {
          issueNumber: issue.number,
          status: "implementing",
          specPath,
          specCommit,
          planPath,
          planCommit,
          branch,
          worktreePath,
          handoffCommentPosted: true,
          checkpoints: { handoffCommentPosted: true },
        },
        options.lease,
        timestamp,
      );
      checkpoints.handoffCommentPosted = true;
    }
    // Publication is a durable unfinished checkpoint, never completion authority.
    if (merge === undefined) {
      await writeRunState(
        config.runStateDir,
        {
          issueNumber: issue.number,
          status: "implementing",
          clearLastError: true,
          clearBlockerQuestions: true,
        },
        options.lease,
        timestamp,
      );
      await emitProgress(
        runOptions,
        "info",
        "pr",
        `PR created: ${implemented.prUrl}`,
        { issueNumber: issue.number },
      );
      await runStep("final result pr-created", async () => undefined);
      return {
        kind: "finished",
        result: withLogPath(
          { ...implemented, issue, specPath, planPath, worktreePath },
          runOptions,
        ),
      };
    }
    await cleanupLegacyPublishedWorkspace(ownedOptions);
    if (!checkpoints.doneLabelEnsured) {
      if (config.issueState?.provider !== "comments") {
        await ensureAutomationLabel(host, config, doneLabel);
      }
      await writeRunState(
        config.runStateDir,
        {
          issueNumber: issue.number,
          status: "implementing",
          specPath,
          specCommit,
          planPath,
          planCommit,
          branch,
          worktreePath,
          checkpoints: { doneLabelEnsured: true },
        },
        options.lease,
        timestamp,
      );
      checkpoints.doneLabelEnsured = true;
    }
    const doneLabels = nextLabels(
      cleanupLabelsForImplementation(labels, {
        readyLabel,
        policy: config.approvalPolicy,
      }),
      [inProgressLabel, needsInfoLabel],
      [doneLabel],
    );
    if (!checkpoints.doneLabelApplied) {
      if (
        config.issueState?.provider === "comments" &&
        config.issueStateProvider
      ) {
        await config.issueStateProvider.setRoles({
          issue,
          roles: ["agent-done"],
        });
      } else {
        await host.applyLabels(
          planLabelChange(issue.number, labels, doneLabels),
        );
      }
      await writeRunState(
        config.runStateDir,
        {
          issueNumber: issue.number,
          status: "finished",
          specPath,
          specCommit,
          planPath,
          planCommit,
          branch,
          worktreePath,
          checkpoints: { doneLabelApplied: true },
        },
        options.lease,
        timestamp,
      );
      checkpoints.doneLabelApplied = true;
    }
    labels = doneLabels;
    await emitProgress(
      runOptions,
      "info",
      "merge",
      `Merged to ${config.baseBranch}: ${merge.mergeOid}`,
      { issueNumber: issue.number },
    );
    await writeRunState(
      config.runStateDir,
      {
        issueNumber: issue.number,
        status: "finished",
        specPath,
        specCommit,
        planPath,
        planCommit,
        branch,
        worktreePath,
        clearLastError: true,
      },
      options.lease,
      timestamp,
    );

    await runStep("final result merged", async () => undefined);

    return {
      kind: "finished",
      result: withLogPath(
        {
          status: "merged",
          mergeCommit: merge.mergeOid,
          branch,
          commits: implemented.commits,
          validation: implemented.validation,
          reviewSummary: implemented.reviewSummary,
          landingDecision: implemented.landingDecision,
          issue,
          specPath,
          planPath,
          worktreePath,
        },
        runOptions,
      ),
    };
  } catch (error) {
    return { kind: "unexpected", error: asError(error) };
  }
}
