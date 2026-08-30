import { createRunOnceHostProvider } from "../../../../host/factory.ts";
import { runArtifactSourceStage } from "../../run-once/artifact-source-stage.ts";
import {
  configuredWorktreeStrategy,
  expectedIssueWorkspace,
} from "../../run-once/pipeline-workspace.ts";
import {
  runOneIssue,
  type RunOneIssueOptions,
} from "../../run-once/pipeline.ts";
import { readRunStateSnapshot } from "../../run-once/run-state.ts";
import { archiveRunRecovery } from "../../run-once/recovery-archive.ts";
import { withIssueRunLease } from "../../run-once/recovery-lease.ts";
import { readRunLegacyMigrationFence } from "../../run-once/recovery-lease-repair.ts";
import {
  executeRunRecoveryMutation,
  RunRecoveryMutationError,
} from "../../run-once/recovery-mutation.ts";
import {
  formatRunRecoveryDecision,
  planRunRecovery,
} from "../../run-once/recovery.ts";
import { lifecycleLabels } from "../../run-once/pipeline-lifecycle.ts";
import type {
  AgentIssueConfig,
  AgentIssuePipelineResult,
  AgentIssueRunState,
  CommandRunner,
  IssueSummary,
} from "../../run-once/types.ts";
export class ResetIssueRunRecoveryError extends Error {
  readonly archivePath: string;
  constructor(cause: RunRecoveryMutationError, archivePath: string) {
    super(
      `${cause.message}\nArchive: ${archivePath}\nPreserved paths: ${[...cause.quarantinePaths, ...cause.stagingPaths].join(", ") || "none"}`,
    );
    this.name = "ResetIssueRunRecoveryError";
    this.cause = cause;
    this.archivePath = archivePath;
  }
}
export type ResetIssueRunResult =
  | { status: "nothing-to-reset"; issueNumber: number; guidance: string }
  | {
      status: "reset-started";
      issueNumber: number;
      archivePath: string;
      recoveryAction: "archive-reset-and-start";
      quarantinePaths: string[];
      pipelineResult: AgentIssuePipelineResult;
    };
export function validateResetIssueEligibility(input: {
  issue: IssueSummary;
  state?: AgentIssueRunState;
  config: AgentIssueConfig;
}): void {
  if (input.issue.state !== "open")
    throw new Error(`Issue #${input.issue.number} is not open`);
  const approval = input.config.approvalPolicy;
  const labels = input.issue.labels;
  if (
    (approval.planApproval.required &&
      !labels.includes(approval.planApproval.approvedLabel)) ||
    (approval.specApproval.required &&
      !labels.includes(approval.specApproval.approvedLabel) &&
      !labels.includes(approval.planApproval.approvedLabel))
  )
    throw new Error(
      `Issue #${input.issue.number} is missing required approval labels for reset`,
    );
  if (!input.state) return;
  const lifecycle = lifecycleLabels(input.config);
  const allowed =
    input.state.status === "blocked" ||
    (input.state.status === "finished" &&
      input.state.blockedAt &&
      input.state.lastError)
      ? labels.includes(lifecycle.ready)
      : input.state.status === "finished"
        ? labels.includes(lifecycle.ready) ||
          labels.includes(lifecycle.inProgress)
        : labels.includes(lifecycle.inProgress);
  if (!allowed)
    throw new Error(
      `Issue #${input.issue.number} labels are not eligible for reset recovery`,
    );
}
export async function resetIssueRun(
  runner: CommandRunner,
  config: AgentIssueConfig & { issueNumber: number },
  options: RunOneIssueOptions = {},
): Promise<ResetIssueRunResult> {
  const host = createRunOnceHostProvider({
    runner,
    repoRoot: config.repoRoot,
    host: config.host,
  });
  const initialIssue = await host.viewIssue(config.issueNumber);
  const initial = await readRunStateSnapshot(
    config.runStateDir,
    config.issueNumber,
  );
  validateResetIssueEligibility({
    issue: initialIssue,
    state: initial?.state,
    config,
  });
  return withIssueRunLease(
    { runStateDir: config.runStateDir, issueNumber: config.issueNumber },
    async (lease) => {
      const issue = await host.viewIssue(config.issueNumber);
      const snapshot = await readRunStateSnapshot(
        config.runStateDir,
        config.issueNumber,
      );
      validateResetIssueEligibility({ issue, state: snapshot?.state, config });
      if (!snapshot)
        return {
          status: "nothing-to-reset",
          issueNumber: config.issueNumber,
          guidance: `No saved Run recovery state exists for issue #${config.issueNumber}. Run: patchmill run-once --issue ${config.issueNumber}`,
        };
      const artifactSources = await runArtifactSourceStage({
        host,
        config,
        issue,
        now: options.now ?? new Date(),
        progress: async () => undefined,
        runStep: async (_name, action) => action(),
      });
      const expectedWorkspace = expectedIssueWorkspace(
        issue.number,
        issue.title,
        configuredWorktreeStrategy(config),
      );
      const recoveryInput = async () =>
        planRunRecovery({
          intent: "reset",
          runner,
          repoRoot: config.repoRoot,
          runStatePath: snapshot.path,
          state: snapshot.state,
          baseRef: config.baseRef,
          expectedWorkspace,
          resolvedArtifacts: artifactSources.resolvedArtifacts,
          leaseOwnerToken: lease.record.ownerToken,
          snapshotRaw: snapshot.raw,
          legacyMigrationFence: await readRunLegacyMigrationFence(
            config.runStateDir,
            issue.number,
          ),
        });
      const decision = await recoveryInput();
      if (decision.action === "refuse")
        throw new Error(formatRunRecoveryDecision(decision));
      if (decision.action !== "archive-reset-and-start")
        throw new Error("Recovery policy did not produce a reset action");
      const archive = await archiveRunRecovery({
        runStateDir: config.runStateDir,
        snapshot,
        assessment: decision.assessment,
        decision,
        command: "patchmill run reset",
        baseRef: config.baseRef,
        now: options.now ?? new Date(),
      });
      let mutation;
      try {
        mutation = await executeRunRecoveryMutation({
          decision,
          runner,
          repoRoot: config.repoRoot,
          reassess: async () => {
            const current = await readRunStateSnapshot(
              config.runStateDir,
              issue.number,
            );
            if (!current || current.raw !== snapshot.raw)
              throw new Error("Run recovery state changed after archival");
            return recoveryInput();
          },
        });
      } catch (error) {
        if (error instanceof RunRecoveryMutationError)
          throw new ResetIssueRunRecoveryError(error, archive.path);
        throw error;
      }
      const pipelineResult = await runOneIssue(runner, config, {
        ...options,
        lease,
        reset: {
          lease,
          archivePath: archive.path,
          quarantinePaths: mutation.quarantinePaths,
          seed: decision.seed,
        },
      });
      return {
        status: "reset-started",
        issueNumber: issue.number,
        archivePath: archive.path,
        recoveryAction: "archive-reset-and-start",
        quarantinePaths: mutation.quarantinePaths,
        pipelineResult,
      };
    },
  );
}
