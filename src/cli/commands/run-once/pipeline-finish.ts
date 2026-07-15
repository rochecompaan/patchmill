import { join } from "node:path";
import { runCleanupHookScript } from "../../../pi/hooks.ts";
import { planLabelChange } from "../triage/labels.ts";
import { ensureAutomationLabel } from "./automation-labels.ts";
import { cleanupIssueWorkspace } from "./git.ts";
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
import type {
  AgentIssueConfig,
  AgentIssuePipelineResult,
  CommandRunner,
  IssueSummary,
} from "./types.ts";
import type { IssueHostProvider } from "../../../host/types.ts";
import type { PipelineSuccessfulImplementationResult } from "./pipeline-implementation.ts";

export type PipelineFinishStageResult =
  | { kind: "finished"; result: AgentIssuePipelineResult }
  | { kind: "unexpected"; error: Error };

export type PipelineFinishStageOptions = {
  runner: CommandRunner;
  host: IssueHostProvider;
  config: AgentIssueConfig;
  issue: IssueSummary;
  labels: string[];
  readyLabel: string;
  inProgressLabel: string;
  doneLabel: string;
  needsInfoLabel: string;
  checkpoints: Record<string, boolean | undefined>;
  implemented: PipelineSuccessfulImplementationResult;
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
        prUrl:
          implemented.status === "pr-created" ? implemented.prUrl : undefined,
        mergeCommit:
          implemented.status === "merged" ? implemented.mergeCommit : undefined,
        commits: implemented.commits,
        validation: implemented.validation,
        reviewSummary: implemented.reviewSummary,
        landingDecision: implemented.landingDecision,
        visualEvidence:
          implemented.status === "pr-created"
            ? implemented.visualEvidence
            : undefined,
        handoffCommentPosted: checkpoints.handoffCommentPosted === true,
        checkpoints: { implementationCompleted: true },
      },
      timestamp,
    );
    checkpoints.implementationCompleted = true;

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
          visualEvidence: validatedEvidence,
          checkpoints: { visualEvidenceValidated: true },
        },
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
        timestamp,
      );
      checkpoints.handoffCommentPosted = true;
    }
    if (!checkpoints.doneLabelEnsured) {
      await ensureAutomationLabel(host, config, doneLabel);
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
      await host.applyLabels(planLabelChange(issue.number, labels, doneLabels));
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
        timestamp,
      );
      checkpoints.doneLabelApplied = true;
    }
    labels = doneLabels;
    await emitProgress(
      runOptions,
      "info",
      implemented.status === "pr-created" ? "pr" : "merge",
      implemented.status === "pr-created"
        ? `PR created: ${implemented.prUrl}`
        : `Merged to ${config.baseBranch}: ${implemented.mergeCommit}`,
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
      timestamp,
    );

    const cleanupResults = await runCleanupHookScript(
      runner,
      config.repoRoot,
      worktreePath,
      config.cleanupHook,
    );
    for (const cleanup of cleanupResults) {
      await emitProgress(
        runOptions,
        cleanup.status === "failed" ? "error" : "info",
        "cleanup",
        cleanup.message,
        {
          issueNumber: issue.number,
          data: { hook: cleanup.name, status: cleanup.status },
        },
      );
    }

    if (implemented.status === "pr-created") {
      const workspaceCleanupResults = await cleanupIssueWorkspace(
        runner,
        config.repoRoot,
        {
          branch,
          worktreePath,
        },
      );
      for (const cleanup of workspaceCleanupResults) {
        await emitProgress(
          runOptions,
          cleanup.status === "failed" ? "error" : "info",
          "cleanup",
          cleanup.message,
          {
            issueNumber: issue.number,
            data: {
              step: cleanup.step,
              status: cleanup.status,
              command: cleanup.command,
              args: cleanup.args,
              cwd: cleanup.cwd,
              code: cleanup.code,
              stdout: cleanup.stdout,
              stderr: cleanup.stderr,
            },
          },
        );
      }
    }

    await runStep(`final result ${implemented.status}`, async () => undefined);

    return {
      kind: "finished",
      result: withLogPath(
        { ...implemented, issue, specPath, planPath, worktreePath },
        runOptions,
      ),
    };
  } catch (error) {
    return { kind: "unexpected", error: asError(error) };
  }
}
