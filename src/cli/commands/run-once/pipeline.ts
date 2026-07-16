import { join } from "node:path";
import { localPiAgentDir } from "../init/pi-agent-settings.ts";

import { createIssueHostProvider } from "../../../host/factory.ts";
import { planLabelChange } from "../triage/labels.ts";
import { materializeIssueArtifactSources } from "./artifact-source-materialization.ts";
import { runArtifactSourceStage } from "./artifact-source-stage.ts";
import type { ResolvedIssueArtifactSources } from "./artifact-sources.ts";
import { ensureAutomationLabel } from "./automation-labels.ts";
import {
  assertCleanWorktree,
  assertIssueBaseContainedInPrBase,
  ensureIssueWorktree,
  type IssueWorktreeResult,
} from "./git.ts";
import {
  PlanningArtifactSafetyError,
  resolvePlanningArtifacts,
  type PlanningArtifactPolicy,
} from "./planning-artifacts.ts";
import { advancePlanningStages } from "./stage-advancement.ts";
import {
  ApprovalRequiredError,
  cleanupLabelsForImplementation,
  resolveWorkflowState,
} from "./workflow-state.ts";
import {
  isResumableRunState,
  readRunState,
  runStatePath,
  writeRunState,
} from "./run-state.ts";
import {
  formatBlockedRunRecoveryReport,
  hasBlockedRunRecoveryState,
  inspectBlockedRunRecovery,
} from "./recovery.ts";
import { selectIssueWithDiagnostics } from "./selection.ts";
import {
  createStepAccounting,
  emitSimpleStep,
  progress,
  withLogPath,
} from "./pipeline-progress.ts";
import {
  AgentIssueSafetyError,
  effectiveCheckpoints,
  lifecycleLabels,
  nextLabels,
  workflowTransition,
} from "./pipeline-lifecycle.ts";
import { startedComment } from "./pipeline-comments.ts";
import {
  cleanStatusIgnoredPaths,
  configuredWorktreeStrategy,
  expectedIssueWorkspace,
  resumePlanningArtifactPolicy,
} from "./pipeline-workspace.ts";
import {
  emitSelectionDiagnostics,
  loadSelectionIssues,
  selectResumableIssue,
} from "./pipeline-selection.ts";
import { blockIssue, unexpectedFailure } from "./pipeline-failures.ts";
import { runPipelineImplementationStage } from "./pipeline-implementation.ts";
import { runPipelineFinishStage } from "./pipeline-finish.ts";
import type { AgentIssueProgressEvent, ProgressReporter } from "./progress.ts";
import type {
  AgentIssueConfig,
  AgentIssuePipelineResult,
  CommandRunner,
  IssueSummary,
} from "./types.ts";

export type RunOneIssueOptions = {
  now?: Date;
  progress?: ProgressReporter;
  logPath?: string;
  streamPiOutput?: (chunk: string) => void;
  verbosePiOutput?: boolean;
  heartbeatMs?: number;
};

export async function runOneIssue(
  runner: CommandRunner,
  config: AgentIssueConfig,
  options: RunOneIssueOptions = {},
): Promise<AgentIssuePipelineResult> {
  const host = createIssueHostProvider({
    runner,
    repoRoot: config.repoRoot,
    host: config.host,
  });
  const issues = await loadSelectionIssues(host, config, options);
  let selected: { issue: IssueSummary; resumed: boolean } | undefined;
  try {
    selected = await selectResumableIssue(issues, config);
  } catch (error) {
    if (error instanceof ApprovalRequiredError) {
      return withLogPath(
        {
          status: "approval-required",
          issue: error.issue,
          approvalKind: error.approvalKind,
          missingLabel: error.missingLabel,
        },
        options,
      );
    }
    throw error;
  }
  const issue = selected?.issue;

  if (!issue) {
    if (config.issueNumber === undefined) {
      const diagnostics = selectIssueWithDiagnostics(issues, {
        readyLabel: lifecycleLabels(config).ready,
        triagePolicy: config.triagePolicy,
        approvalPolicy: config.approvalPolicy,
      });
      await emitSelectionDiagnostics(diagnostics.rejections, options);
      await progress(
        options,
        "info",
        "select",
        `no eligible issue found after considering ${diagnostics.consideredCount} open issues; see run log for skip details`,
      );
    } else {
      await progress(options, "info", "select", "no eligible issue found");
    }
    return withLogPath({ status: "no-issue" }, options);
  }

  const existingState = await readRunState(config.runStateDir, issue.number);
  const piAgentDir = localPiAgentDir(config.repoRoot);
  const resumed = selected?.resumed ?? false;
  const ordinaryResumableState =
    resumed && !!existingState && isResumableRunState(existingState);

  await progress(
    options,
    "info",
    "select",
    `${resumed ? "resuming" : "selected"} #${issue.number} ${issue.title}`,
    { issueNumber: issue.number },
  );
  await progress(
    options,
    "info",
    "git",
    "checking issue branch base containment",
    { issueNumber: issue.number },
  );
  await assertIssueBaseContainedInPrBase(
    runner,
    config.repoRoot,
    config.baseRef,
    config.remote,
    config.baseBranch,
  );
  if (config.dryRun) {
    const { ready } = lifecycleLabels(config);
    const state = resolveWorkflowState(issue.labels, {
      readyLabel: ready,
      policy: config.approvalPolicy,
    });
    return withLogPath(
      {
        status: "dry-run",
        issue,
        transition: workflowTransition(state, config),
      },
      options,
    );
  }

  const ignoredPaths = cleanStatusIgnoredPaths(config, options);
  const blockedRecoveryReport = hasBlockedRunRecoveryState(existingState)
    ? await inspectBlockedRunRecovery({
        runner,
        repoRoot: config.repoRoot,
        runStatePath: runStatePath(config.runStateDir, issue.number),
        state: existingState,
        baseRef: config.baseRef,
        ignoredPaths,
      })
    : undefined;
  const blockedRecoveryResumable =
    blockedRecoveryReport?.kind === "recoverable-clean";
  const resumableState = ordinaryResumableState || blockedRecoveryResumable;
  const resetStaleCheckpoints = !!existingState && !resumableState;
  const checkpoints = {
    ...(effectiveCheckpoints(existingState?.checkpoints, resumableState) ?? {}),
  };

  if (blockedRecoveryReport && !blockedRecoveryResumable) {
    throw new AgentIssueSafetyError(
      formatBlockedRunRecoveryReport(blockedRecoveryReport),
    );
  }

  if (
    resetStaleCheckpoints &&
    (existingState?.branch || existingState?.worktreePath)
  ) {
    throw new AgentIssueSafetyError(
      `Non-resumable run state for issue #${issue.number} has stale branch/worktree; clean up before starting a fresh run`,
    );
  }

  const timestamp = (options.now ?? new Date()).toISOString();
  const tokenUsageState = { total: 0 };
  let issueForRun = issue;
  let resolvedArtifacts: ResolvedIssueArtifactSources = {};
  const stepAccounting = createStepAccounting({
    progress: options.progress,
    issueNumber: issue.number,
    runStartedAtMs: (options.now ?? new Date()).getTime(),
  });
  const stepStart = stepAccounting.start;
  const stepComplete = stepAccounting.complete;
  const runStep = stepAccounting.run;
  const observePi =
    (
      stage:
        | "pi-artifact-extraction"
        | "pi-plan"
        | "pi-development-environment"
        | "pi-implementation",
    ) =>
    async (
      observation: AgentIssueProgressEvent["observation"],
    ): Promise<void> => {
      await stepAccounting.observe(stage, observation);
    };
  await options.progress?.event({
    time: timestamp,
    level: "info",
    stage: "run",
    message: `issue #${issue.number} · ${issue.title}`,
    issueNumber: issue.number,
    step: { type: "run-start", issueNumber: issue.number, title: issue.title },
  });
  await emitSimpleStep(options, issue.number, "select issue");
  const artifactSources = await runArtifactSourceStage({
    host,
    config,
    issue,
    now: options.now ?? new Date(),
    progress: (level, stage, message, extras) =>
      progress(options, level, stage, message, extras),
    runStep,
  });
  issueForRun = artifactSources.issue;
  resolvedArtifacts = artifactSources.resolvedArtifacts;

  await progress(options, "info", "git", "checking repository status", {
    issueNumber: issue.number,
  });
  await assertCleanWorktree(runner, config.repoRoot, ignoredPaths);
  const { ready, inProgress, done, needsInfo } = lifecycleLabels(config);
  let labels = resumed
    ? issue.labels.includes(inProgress)
      ? issue.labels
      : nextLabels(issue.labels, [ready], [inProgress])
    : nextLabels(issue.labels, [ready], [inProgress]);
  if (!checkpoints.claimed) {
    await runStep("claim issue", async () => {
      await progress(
        options,
        "info",
        "labels",
        `ensuring ${inProgress} label exists`,
        { issueNumber: issue.number },
      );
      await ensureAutomationLabel(host, config, inProgress);
      await host.applyLabels(
        planLabelChange(issue.number, issue.labels, labels),
      );
      await progress(
        options,
        "info",
        "claim",
        `claimed #${issue.number}: ${ready} -> ${inProgress}`,
        { issueNumber: issue.number },
      );
      await writeRunState(
        config.runStateDir,
        {
          issueNumber: issue.number,
          title: issue.title,
          status: "claimed",
          checkpoints: { claimed: true },
          resetCheckpoints: resetStaleCheckpoints,
        },
        timestamp,
      );
      checkpoints.claimed = true;
    });
  }
  let specPath: string | undefined;
  let specCommit: string | undefined;
  let planPath: string | undefined;
  let planCommit: string | undefined;
  let branch: string | undefined;
  let worktreePath: string | undefined;
  let ensuredWorktree: IssueWorktreeResult | undefined;
  let artifactPolicy: PlanningArtifactPolicy | undefined;
  const worktreeStrategy = configuredWorktreeStrategy(config);
  const expectedWorkspace = expectedIssueWorkspace(
    issue.number,
    issue.title,
    worktreeStrategy,
  );
  const ensureIssueWorkspace = async (): Promise<IssueWorktreeResult> => {
    if (ensuredWorktree) return ensuredWorktree;
    if (
      resumableState &&
      existingState?.branch &&
      existingState.branch !== expectedWorkspace.branch
    ) {
      throw new AgentIssueSafetyError(
        `Saved branch ${existingState.branch} does not match expected branch ${expectedWorkspace.branch}`,
      );
    }
    if (
      resumableState &&
      existingState?.worktreePath &&
      existingState.worktreePath !== expectedWorkspace.worktreePath
    ) {
      throw new AgentIssueSafetyError(
        `Saved worktree ${existingState.worktreePath} does not match expected worktree path ${expectedWorkspace.worktreePath}`,
      );
    }

    const worktree = await ensureIssueWorktree(
      runner,
      config.repoRoot,
      issue.number,
      issue.title,
      worktreeStrategy,
      undefined,
      ignoredPaths,
    );
    await emitSimpleStep(
      options,
      issue.number,
      worktree.created ? "create worktree" : "reuse worktree",
    );
    if (
      resumableState &&
      existingState?.branch &&
      existingState.branch !== worktree.branch
    ) {
      throw new AgentIssueSafetyError(
        `Saved branch ${existingState.branch} does not match ensured worktree branch ${worktree.branch}`,
      );
    }
    if (
      resumableState &&
      existingState?.worktreePath &&
      existingState.worktreePath !== worktree.worktreePath
    ) {
      throw new AgentIssueSafetyError(
        `Saved worktree ${existingState.worktreePath} does not match ensured worktree path ${worktree.worktreePath}`,
      );
    }
    branch = resumableState
      ? (existingState?.branch ?? worktree.branch)
      : worktree.branch;
    worktreePath = resumableState
      ? (existingState?.worktreePath ?? worktree.worktreePath)
      : worktree.worktreePath;
    await progress(
      options,
      "info",
      "worktree",
      `${worktree.created ? "creating" : "reusing"} worktree ${worktreePath}`,
      { issueNumber: issue.number },
    );
    ensuredWorktree = worktree;
    return worktree;
  };

  try {
    if (!checkpoints.startedCommentPosted) {
      await host.commentIssue(issueForRun.number, startedComment(issueForRun));
      await writeRunState(
        config.runStateDir,
        {
          issueNumber: issueForRun.number,
          title: issueForRun.title,
          status: "claimed",
          checkpoints: { startedCommentPosted: true },
        },
        timestamp,
      );
      checkpoints.startedCommentPosted = true;
    }

    if (
      resumableState &&
      existingState &&
      (existingState.branch || existingState.worktreePath)
    ) {
      const resumeWorktree = await ensureIssueWorkspace();
      const savedWorktreePath =
        existingState.worktreePath ?? resumeWorktree.worktreePath;
      artifactPolicy = resumePlanningArtifactPolicy({
        config,
        worktreePath: savedWorktreePath,
        existingState,
        resolvedArtifacts,
      });
      await progress(
        options,
        "info",
        "resume",
        `reusing saved worktree for artifact lookup: ${savedWorktreePath}`,
        { issueNumber: issue.number },
      );
    }

    if (artifactPolicy?.kind === "implementation-resume") {
      await resolvePlanningArtifacts({
        policy: artifactPolicy,
        issue: issueForRun,
        now: options.now ?? new Date(),
      });
    } else {
      const artifactWorktree =
        resolvedArtifacts.spec || resolvedArtifacts.plan
          ? await ensureIssueWorkspace()
          : undefined;
      const artifactRepoRoot = artifactWorktree
        ? join(config.repoRoot, artifactWorktree.worktreePath)
        : config.repoRoot;
      const materializedArtifacts = await runStep(
        "materialize issue artifact sources",
        async () =>
          materializeIssueArtifactSources({
            repoRoot: artifactRepoRoot,
            runner,
            issueNumber: issueForRun.number,
            sources: resolvedArtifacts,
          }),
      );
      resolvedArtifacts = materializedArtifacts;
    }

    if (!artifactPolicy && (resolvedArtifacts.spec || resolvedArtifacts.plan)) {
      await writeRunState(
        config.runStateDir,
        {
          issueNumber: issueForRun.number,
          title: issueForRun.title,
          status: "planning",
          specPath: resolvedArtifacts.spec?.path,
          specCommit: resolvedArtifacts.spec?.commit,
          planPath: resolvedArtifacts.plan?.path,
          planCommit: resolvedArtifacts.plan?.commit,
        },
        timestamp,
      );
    }

    const planningStages = await advancePlanningStages({
      runner,
      host,
      config,
      issue: issueForRun,
      labels,
      ready,
      inProgress,
      needsInfo,
      existingState,
      resolvedArtifacts,
      artifactPolicy,
      ensurePlanningArtifactWorkspace: async () => {
        const workspace = await ensureIssueWorkspace();
        return {
          repoRoot: join(config.repoRoot, workspace.worktreePath),
          branch: workspace.branch,
          worktreePath: workspace.worktreePath,
        };
      },
      checkpoints,
      timestamp,
      now: options.now ?? new Date(),
      runOptions: options,
      piAgentDir,
      tokenUsageState,
      progress: (level, stage, message, extras) =>
        progress(options, level, stage, message, extras),
      runStep,
      observePi,
      emitSimpleStep: (issueNumber, label) =>
        emitSimpleStep(options, issueNumber, label),
      blockIssue: (result, details) =>
        blockIssue(
          host,
          config,
          issueForRun,
          labels,
          result,
          details,
          timestamp,
          options,
        ),
    });
    if (planningStages.kind === "finished") {
      return withLogPath(planningStages.result, options);
    }

    labels = planningStages.labels;
    specPath = planningStages.specPath;
    specCommit = planningStages.specCommit;
    planPath = planningStages.planPath;
    planCommit = planningStages.planCommit;

    const implementationLabels = nextLabels(
      cleanupLabelsForImplementation(labels, {
        readyLabel: ready,
        policy: config.approvalPolicy,
      }),
      [],
      [inProgress],
    );
    if (implementationLabels.join("\0") !== labels.join("\0")) {
      await host.applyLabels(
        planLabelChange(issue.number, labels, implementationLabels),
      );
      labels = implementationLabels;
    }

    const worktree = await ensureIssueWorkspace();
    const implementationStage = await runPipelineImplementationStage({
      runner,
      host,
      config,
      issue,
      labels,
      readyLabel: ready,
      inProgressLabel: inProgress,
      specPath,
      specCommit,
      planPath,
      planCommit,
      branch,
      worktreePath,
      worktree,
      worktreeStrategy,
      existingState,
      resumableState,
      implementationCompleted: checkpoints.implementationCompleted,
      checkpoints,
      timestamp,
      runOptions: options,
      piAgentDir,
      tokenUsageState,
      progressReporter: options.progress,
      runStep,
      stepStart,
      stepComplete,
      observePi,
      emitSimpleStep: (issueNumber, label) =>
        emitSimpleStep(options, issueNumber, label),
      blockIssue: (result, details) =>
        blockIssue(
          host,
          config,
          issue,
          labels,
          result,
          details,
          timestamp,
          options,
        ),
    });

    if (implementationStage.kind === "blocked") {
      return withLogPath(implementationStage.result, options);
    }
    if (implementationStage.kind === "unexpected") {
      throw implementationStage.error;
    }
    labels = implementationStage.labels;
    checkpoints.worktreeReady = true;

    const finishStage = await runPipelineFinishStage({
      runner,
      host,
      config,
      issue,
      labels,
      readyLabel: ready,
      inProgressLabel: inProgress,
      doneLabel: done,
      needsInfoLabel: needsInfo,
      checkpoints,
      implemented: implementationStage.result,
      specPath,
      specCommit,
      planPath,
      planCommit,
      branch,
      worktreePath,
      timestamp,
      runOptions: options,
      runStep,
    });

    if (finishStage.kind === "unexpected") {
      throw finishStage.error;
    }

    return finishStage.result;
  } catch (error) {
    if (error instanceof AgentIssueSafetyError) {
      throw error;
    }
    if (error instanceof PlanningArtifactSafetyError) {
      throw new AgentIssueSafetyError(error.message);
    }
    return unexpectedFailure(
      host,
      config,
      issue,
      checkpoints,
      { specPath, specCommit, planPath, planCommit, branch, worktreePath },
      timestamp,
      error,
      options,
    );
  }
}
