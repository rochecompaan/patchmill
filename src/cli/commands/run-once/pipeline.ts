import { join } from "node:path";
import { runCleanupHookScript } from "../../../pi/hooks.ts";
import { localPiAgentDir } from "../init/pi-agent-settings.ts";

import { createIssueHostProvider } from "../../../host/factory.ts";
import { skillInvocationPaths } from "../../../workflow/skills.ts";
import { planLabelChange } from "../triage/labels.ts";
import { materializeIssueArtifactSources } from "./artifact-source-materialization.ts";
import { runArtifactSourceStage } from "./artifact-source-stage.ts";
import type { ResolvedIssueArtifactSources } from "./artifact-sources.ts";
import { ensureAutomationLabel } from "./automation-labels.ts";
import {
  assertCleanWorktree,
  assertIssueBaseContainedInPrBase,
  cleanupIssueWorkspace,
  ensureIssueWorktree,
  type IssueWorktreeResult,
} from "./git.ts";
import {
  assertIssueTodosComplete,
  issueTodoProgress,
  readIssueTodoTasks,
} from "./issue-todos.ts";
import { runPiPrompt } from "./pi.ts";
import { readPlanTaskLabels } from "./plan-tasks.ts";
import { buildImplementationPrompt } from "./prompts.ts";
import { runDevelopmentEnvironmentStage } from "./development-environment-stage.ts";
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
import { emitSimpleStep, progress, withLogPath } from "./pipeline-progress.ts";
import {
  AgentIssueSafetyError,
  assertDirectLandAllowed,
  effectiveCheckpoints,
  lifecycleLabels,
  nextLabels,
  successfulImplementationFromState,
  workflowTransition,
} from "./pipeline-lifecycle.ts";
import { handoffComment, startedComment } from "./pipeline-comments.ts";
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
import { validateVisualEvidenceReferences } from "./visual-evidence.ts";
import type { AgentIssueProgressEvent, ProgressReporter } from "./progress.ts";
import type {
  AgentIssueConfig,
  AgentIssueDevelopmentEnvironmentHandoff,
  AgentIssuePiResult,
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
  const runStartedAtMs = (options.now ?? new Date()).getTime();
  const stepAccounting: {
    current?: {
      label: string;
      startOutputTokens: number;
      toolCalls: number;
      startedAt: number;
    };
    totalOutputTokens: number;
  } = { totalOutputTokens: 0 };
  const stepStart = async (label: string): Promise<void> => {
    stepAccounting.current = {
      label,
      startOutputTokens: stepAccounting.totalOutputTokens,
      toolCalls: 0,
      startedAt: Date.now(),
    };
    await options.progress?.event({
      time: new Date().toISOString(),
      level: "info",
      stage: "step",
      message: label,
      issueNumber: issue.number,
      data: { stepLabel: label },
      step: { type: "step-start", label },
    });
  };
  const stepComplete = async (label: string): Promise<void> => {
    const current =
      stepAccounting.current?.label === label
        ? stepAccounting.current
        : undefined;
    const taskOutputTokens = current
      ? stepAccounting.totalOutputTokens - current.startOutputTokens
      : 0;
    const toolCalls = current?.toolCalls ?? 0;
    const elapsedSeconds = Math.max(
      0,
      Math.round((Date.now() - runStartedAtMs) / 1000),
    );
    await options.progress?.event({
      time: new Date().toISOString(),
      level: "info",
      stage: "step",
      message: label,
      issueNumber: issue.number,
      elapsedSeconds,
      taskOutputTokens,
      totalOutputTokens: stepAccounting.totalOutputTokens,
      toolCalls,
      step: {
        type: "step-complete",
        label,
        taskOutputTokens,
        totalOutputTokens: stepAccounting.totalOutputTokens,
        toolCalls,
        elapsedSeconds,
      },
    });
    if (current) stepAccounting.current = undefined;
  };
  const runStep = async <T>(
    label: string,
    fn: () => Promise<T>,
  ): Promise<T> => {
    await stepStart(label);
    try {
      return await fn();
    } finally {
      await stepComplete(label);
    }
  };
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
      if (!observation) return;
      if (observation.type === "assistant-usage")
        stepAccounting.totalOutputTokens += observation.outputTokens;
      if (observation.type === "tool-call" && stepAccounting.current)
        stepAccounting.current.toolCalls += 1;
      await options.progress?.event({
        time: new Date().toISOString(),
        level: "debug",
        stage,
        message: observation.type,
        issueNumber: issue.number,
        observation,
      });
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

    let implemented =
      resumableState && checkpoints.implementationCompleted
        ? successfulImplementationFromState(
            existingState as
              | (typeof existingState & {
                  prUrl?: string;
                  mergeCommit?: string;
                  commits?: unknown;
                  validation?: unknown;
                  reviewSummary?: unknown;
                  landingDecision?: unknown;
                })
              | undefined,
          )
        : undefined;
    if (implemented) {
      assertDirectLandAllowed(
        implemented,
        config,
        "Saved implementation state",
      );
    }

    const worktree = await ensureIssueWorkspace();
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
        checkpoints: { worktreeReady: true },
      },
      timestamp,
    );
    checkpoints.worktreeReady = true;

    const worktreeRoot = join(config.repoRoot, worktreePath);
    let developmentEnvironment:
      | AgentIssueDevelopmentEnvironmentHandoff
      | undefined;
    if (!implemented && config.skills.developmentEnvironment) {
      const developmentEnvironmentStage = await runDevelopmentEnvironmentStage({
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
        timestamp,
        logPath: options.logPath,
        streamPiOutput: options.streamPiOutput,
        verbosePiOutput: options.verbosePiOutput,
        heartbeatMs: options.heartbeatMs,
        piAgentDir,
        tokenUsageState,
        progressReporter: options.progress,
        progress: (level, stage, message, extras) =>
          progress(options, level, stage, message, extras),
        runStep,
        observePi,
        emitSimpleStep: (issueNumber, label) =>
          emitSimpleStep(options, issueNumber, label),
      });

      if (developmentEnvironmentStage.kind === "not-ready") {
        return developmentEnvironmentStage.result;
      }

      developmentEnvironment = developmentEnvironmentStage.handoff;
    }

    if (!implemented) {
      await progress(
        options,
        "info",
        "pi-implementation",
        "running implementation with pi",
        { issueNumber: issue.number },
      );
      const taskContract = config.projectPolicy.pi.taskContract;
      const planTaskLabels = await readPlanTaskLabels(
        config.repoRoot,
        planPath,
        taskContract,
      );
      let activeImplementationTask:
        | { current: number; total: number; label: string }
        | undefined;
      let finalImplementationStepActive = false;
      const finalImplementationStepLabel = "final review and landing";

      const labelForTask = (current: number, runtimeLabel?: string): string => {
        const planLabel = planTaskLabels.find(
          (task) => task.number === current,
        )?.label;
        return planLabel ?? runtimeLabel ?? `task ${current}`;
      };

      const normalizeImplementationTaskProgress = (
        current: number,
        total: number,
      ): { current: number; total: number } => {
        if (planTaskLabels.length === 0) return { current, total };
        return {
          current: Math.min(Math.max(current, 1), planTaskLabels.length),
          total: planTaskLabels.length,
        };
      };

      const switchImplementationTask = async (
        rawCurrent: number,
        rawTotal: number,
        runtimeLabel?: string,
      ): Promise<void> => {
        const { current, total } = normalizeImplementationTaskProgress(
          rawCurrent,
          rawTotal,
        );
        const label = labelForTask(current, runtimeLabel);
        if (
          activeImplementationTask?.current === current &&
          activeImplementationTask.total === total &&
          activeImplementationTask.label === label
        ) {
          return;
        }
        if (finalImplementationStepActive) return;
        if (activeImplementationTask) {
          await stepComplete(
            `implement task ${activeImplementationTask.current}/${activeImplementationTask.total} ${activeImplementationTask.label}`,
          );
        }
        activeImplementationTask = { current, total, label };
        await stepStart(`implement task ${current}/${total} ${label}`);
      };

      const startFinalImplementationStep = async (): Promise<void> => {
        if (finalImplementationStepActive) return;
        if (activeImplementationTask) {
          await stepComplete(
            `implement task ${activeImplementationTask.current}/${activeImplementationTask.total} ${activeImplementationTask.label}`,
          );
          activeImplementationTask = undefined;
        }
        finalImplementationStepActive = true;
        await stepStart(finalImplementationStepLabel);
      };

      const issueTasksComplete = async (): Promise<boolean> => {
        const tasks = await readIssueTodoTasks(
          worktreeRoot,
          issue.number,
          taskContract,
        );
        return tasks.length > 0 && tasks.every((task) => task.done);
      };

      const refreshImplementationTask = async (
        options: { startFinalWhenComplete?: boolean } = {},
      ): Promise<void> => {
        if (options.startFinalWhenComplete && (await issueTasksComplete())) {
          await startFinalImplementationStep();
          return;
        }
        const runtimeProgress = await issueTodoProgress(
          worktreeRoot,
          issue.number,
          taskContract,
        );
        if (runtimeProgress) {
          await switchImplementationTask(
            runtimeProgress.current,
            runtimeProgress.total,
            runtimeProgress.label,
          );
        }
      };

      const observeImplementation = async (
        observation: AgentIssueProgressEvent["observation"],
      ): Promise<void> => {
        if (observation?.type === "tool-call")
          await refreshImplementationTask({ startFinalWhenComplete: true });
        await observePi("pi-implementation")(observation);
      };

      let piResult: AgentIssuePiResult | undefined;
      try {
        if (planTaskLabels.length > 0) {
          await switchImplementationTask(
            1,
            planTaskLabels.length,
            planTaskLabels[0]?.label,
          );
        }

        const projectPolicy = {
          ...config.projectPolicy,
          directLand: {
            ...config.projectPolicy.directLand,
            targetBranch: worktreeStrategy.baseBranch,
          },
        };

        piResult = await runPiPrompt(
          runner,
          worktreeRoot,
          buildImplementationPrompt({
            issue: { ...issue, labels },
            planPath,
            branch,
            worktreePath,
            git: worktreeStrategy,
            projectPolicy,
            skills: config.skills,
            resume: {
              resumed: resumableState,
              worktreeCreated: worktree.created,
              existingCommits: worktree.existingCommits,
              priorBlockerReason: existingState?.lastError,
              priorBlockerQuestions: existingState?.blockerQuestions,
              priorValidation: existingState?.validation,
            },
            developmentEnvironment,
          }),
          {
            progress: options.progress,
            stage: "pi-implementation",
            skillPaths: skillInvocationPaths(
              [
                config.skills.toolchain,
                config.skills.implementation,
                config.skills.review,
                config.skills.visualEvidence,
                config.skills.landing,
              ],
              config.repoRoot,
            ),
            streamOutput: options.streamPiOutput,
            issueNumber: issue.number,
            repoRoot: worktreeRoot,
            heartbeatMs: options.heartbeatMs,
            tokenUsageState,
            observeSession: true,
            verbosePiOutput: options.verbosePiOutput,
            onObservation: observeImplementation,
            taskContract: projectPolicy.pi.taskContract,
            piAgentDir,
            onTaskProgress: async (progress) => {
              await switchImplementationTask(
                progress.current,
                progress.total,
                progress.label,
              );
            },
          },
        );

        await refreshImplementationTask();
      } finally {
        if (activeImplementationTask) {
          await stepComplete(
            `implement task ${activeImplementationTask.current}/${activeImplementationTask.total} ${activeImplementationTask.label}`,
          );
          activeImplementationTask = undefined;
        }
        if (finalImplementationStepActive) {
          await stepComplete(finalImplementationStepLabel);
          finalImplementationStepActive = false;
        }
      }

      if (!piResult)
        throw new Error("Pi implementation completed without a result");
      if (piResult.status === "blocked") {
        return blockIssue(
          host,
          config,
          issue,
          labels,
          piResult,
          { specPath, specCommit, planPath, planCommit, branch, worktreePath },
          timestamp,
          options,
        );
      }
      if (piResult.status !== "pr-created" && piResult.status !== "merged") {
        throw new Error(
          `Expected pr-created or merged from Pi but received ${piResult.status}`,
        );
      }

      assertDirectLandAllowed(piResult, config, "Pi");
      implemented = piResult;
    }

    await assertIssueTodosComplete(
      join(config.repoRoot, worktreePath),
      issue.number,
      config.projectPolicy.pi.taskContract,
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
          await progress(options, "info", "visual-evidence", message, {
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
      await ensureAutomationLabel(host, config, done);
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
        readyLabel: ready,
        policy: config.approvalPolicy,
      }),
      [inProgress, needsInfo],
      [done],
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
    await progress(
      options,
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
      await progress(
        options,
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
        { branch, worktreePath },
      );
      for (const cleanup of workspaceCleanupResults) {
        await progress(
          options,
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

    return withLogPath(
      { ...implemented, issue, specPath, planPath, worktreePath },
      options,
    );
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
