import { join, relative } from "node:path";
import { runCleanupHookScript } from "../../../pi/hooks.ts";
import { localPiAgentDir } from "../init/pi-agent-settings.ts";
import {
  buildIssueBranchName,
  buildIssueWorktreePath,
} from "../../../git/worktree-strategy.ts";
import type { GitWorktreeStrategyConfig } from "../../../git/types.ts";
import { createIssueHostProvider } from "../../../host/factory.ts";
import type { IssueHostProvider } from "../../../host/types.ts";
import { skillInvocationPaths } from "../../../workflow/skills.ts";
import { DEFAULT_TRIAGE_POLICY, planLabelChange } from "../triage/labels.ts";
import { ensureAutomationLabel } from "./automation-labels.ts";
import {
  assertCleanWorktree,
  cleanStatusIgnoredPaths as buildCleanStatusIgnoredPaths,
  ensureIssueWorktree,
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
import { advancePlanningStages } from "./stage-advancement.ts";
import {
  ApprovalRequiredError,
  cleanupLabelsForImplementation,
  resolveWorkflowState,
  type RunOnceWorkflowState,
} from "./workflow-state.ts";
import type { ForgejoVisualEvidenceEnv } from "../../../host/forgejo-visual-evidence.ts";
import type { VisualEvidenceUploader } from "../../../host/visual-evidence.ts";
import {
  isResumableRunState,
  readRunState,
  runStatePath,
  writeRunState,
} from "./run-state.ts";
import {
  formatBlockedRunRecoveryReport,
  inspectBlockedRunRecovery,
} from "./recovery.ts";
import { selectIssue } from "./selection.ts";
import {
  defaultVisualEvidenceUploader,
  uploadPrVisualEvidence,
} from "./visual-evidence.ts";
import type { AgentIssueProgressEvent, ProgressReporter } from "./progress.ts";
import type {
  AgentIssueBlockedResult,
  AgentIssueBlockerQuestion,
  AgentIssueConfig,
  AgentIssueDevelopmentEnvironmentHandoff,
  AgentIssuePiResult,
  AgentIssuePipelineResult,
  AgentIssueVisualEvidence,
  AgentIssueRunCheckpoints,
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
  fetchImpl?: typeof fetch;
  visualEvidenceEnv?: ForgejoVisualEvidenceEnv;
  visualEvidenceUploader?: VisualEvidenceUploader;
};

async function progress(
  options: RunOneIssueOptions,
  level: AgentIssueProgressEvent["level"],
  stage: string,
  message: string,
  extras: Partial<
    Pick<AgentIssueProgressEvent, "issueNumber" | "elapsedSeconds" | "data">
  > = {},
): Promise<void> {
  await options.progress?.event({
    time: (options.now ?? new Date()).toISOString(),
    level,
    stage,
    message,
    ...extras,
  });
}

async function emitSimpleStep(
  options: RunOneIssueOptions,
  issueNumber: number,
  label: string,
): Promise<void> {
  const time = new Date().toISOString();
  await options.progress?.event({
    time,
    level: "info",
    stage: "step",
    message: label,
    issueNumber,
    step: { type: "step-start", label },
  });
  await options.progress?.event({
    time: new Date().toISOString(),
    level: "info",
    stage: "step",
    message: label,
    issueNumber,
    step: { type: "step-complete", label },
  });
}

function withLogPath<T extends AgentIssuePipelineResult>(
  result: T,
  options: RunOneIssueOptions,
): T {
  return options.logPath ? { ...result, logPath: options.logPath } : result;
}

function cleanStatusIgnoredPaths(
  config: Pick<
    AgentIssueConfig,
    "runStateDir" | "cleanStatusIgnorePrefixes" | "projectPolicy"
  >,
  options: Pick<RunOneIssueOptions, "logPath">,
): string[] {
  return buildCleanStatusIgnoredPaths({
    cleanStatusIgnorePrefixes: config.cleanStatusIgnorePrefixes,
    todoRoot: config.projectPolicy.pi.taskContract.todoRoot,
    runStateDir: config.runStateDir,
    additionalPaths: options.logPath ? [options.logPath] : [],
  });
}

function configuredWorktreeDir(
  config: Pick<AgentIssueConfig, "repoRoot" | "worktreeDir">,
): string {
  return relative(config.repoRoot, config.worktreeDir) || ".";
}

function configuredWorktreeStrategy(
  config: Pick<
    AgentIssueConfig,
    keyof GitWorktreeStrategyConfig | "repoRoot" | "worktreeDir"
  >,
): GitWorktreeStrategyConfig {
  return {
    baseBranch: config.baseBranch,
    baseRef: config.baseRef,
    remote: config.remote,
    branchPrefix: config.branchPrefix,
    worktreeDir: configuredWorktreeDir(config),
    worktreePrefix: config.worktreePrefix,
    slugLength: config.slugLength,
    allowDirectLand: config.allowDirectLand,
  };
}

function expectedIssueWorkspace(
  issueNumber: number,
  title: string,
  strategy: GitWorktreeStrategyConfig,
): {
  branch: string;
  worktreePath: string;
} {
  return {
    branch: buildIssueBranchName(issueNumber, title, strategy),
    worktreePath: buildIssueWorktreePath(issueNumber, title, strategy),
  };
}

function nextLabels(
  labels: string[],
  remove: string[],
  add: string[],
): string[] {
  const removed = new Set(remove);
  const kept = labels.filter((label) => !removed.has(label));
  return [...kept, ...add.filter((label) => !kept.includes(label))];
}

function workflowTransition(
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
    if (config.approvalPolicy.specApproval.required) {
      return "agent-ready -> spec-review";
    }
    if (config.approvalPolicy.planApproval.required) {
      return "agent-ready -> plan-review";
    }
    return "agent-ready -> agent-done";
  }

  return `${state.kind} -> no-issue`;
}

function hasBlockedSavedWorkspaceState(
  state: Awaited<ReturnType<typeof readRunState>>,
): boolean {
  return (
    state?.status === "blocked" &&
    (state.branch !== undefined || state.worktreePath !== undefined)
  );
}

function lifecycleLabels(
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
  "specReadyCommentPosted",
  "planReadyCommentPosted",
  "worktreeReady",
  "implementationCompleted",
  "visualEvidenceUploaded",
  "handoffCommentPosted",
  "doneLabelEnsured",
  "doneLabelApplied",
]);

function effectiveCheckpoints(
  checkpoints: AgentIssueRunCheckpoints | undefined,
  resumable: boolean,
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

function startedComment(issue: IssueSummary): string {
  return `Automation started for issue #${issue.number}.

The issue has been claimed for plan and implementation orchestration.`;
}

function handoffComment(
  planPath: string,
  result: Extract<AgentIssuePiResult, { status: "pr-created" | "merged" }>,
  baseBranch: string,
): string {
  const lines = [
    `Automation handoff ready.`,
    ``,
    `- Plan: \`${planPath}\``,
    `- Branch: \`${result.branch}\``,
  ];

  if (result.status === "pr-created") {
    lines.push(`- PR: ${result.prUrl}`);
  } else {
    lines.push(`- Merged to \`${baseBranch}\`: ${result.mergeCommit}`);
  }

  if (result.landingDecision) {
    lines.push(`- Landing decision: ${result.landingDecision}`);
  }
  if (result.reviewSummary) lines.push(`- Review: ${result.reviewSummary}`);
  if (result.validation.length > 0) {
    lines.push(`- Validation:`);
    lines.push(...result.validation.map((entry) => `  - ${entry}`));
  }

  return lines.join("\n");
}

function questionText(question: AgentIssueBlockerQuestion): string {
  return typeof question === "string"
    ? `- ${question}`
    : `- ${question.question}${question.recommendedAnswer ? `\n  Recommended: ${question.recommendedAnswer}` : ""}`;
}

function blockerComment(result: AgentIssueBlockedResult): string {
  return [
    `Automation blocked and needs more information.`,
    ``,
    result.reason,
    ...(result.questions.length > 0
      ? ["", "Questions:", ...result.questions.map(questionText)]
      : []),
  ].join("\n");
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

class AgentIssueSafetyError extends Error {
  readonly name = "AgentIssueSafetyError";
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

function successfulImplementationFromState(
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

function assertDirectLandAllowed(
  result: Extract<AgentIssuePiResult, { status: "pr-created" | "merged" }>,
  config: Pick<AgentIssueConfig, "allowDirectLand" | "skills">,
  source: string,
): void {
  if (result.status !== "merged") return;

  if (!config.allowDirectLand) {
    throw new AgentIssueSafetyError(
      `${source} returned merged while git.allowDirectLand is false`,
    );
  }

  if (!config.skills.landing) {
    throw new AgentIssueSafetyError(
      `${source} returned merged but direct landing requires git.allowDirectLand=true and configured skills.landing`,
    );
  }
}

async function selectResumableIssue(
  issues: IssueSummary[],
  config: AgentIssueConfig,
): Promise<{ issue: IssueSummary; resumed: boolean } | undefined> {
  const { inProgress, ready } = lifecycleLabels(config);
  const shouldResume = config.execute && !config.dryRun;
  const resumable: IssueSummary[] = [];
  if (shouldResume) {
    for (const issue of issues) {
      if (!issue.labels.includes(inProgress)) continue;
      const state = await readRunState(config.runStateDir, issue.number);
      if (
        state &&
        (isResumableRunState(state) || hasBlockedSavedWorkspaceState(state))
      )
        resumable.push(issue);
    }
  }

  if (resumable.length > 1) {
    throw new Error(
      `Multiple resumable ${inProgress} automation runs found: ${resumable.map((issue) => `#${issue.number}`).join(", ")}`,
    );
  }

  if (config.issueNumber !== undefined) {
    const resumableSelected = resumable.find(
      (issue) => issue.number === config.issueNumber,
    );
    if (resumableSelected) {
      return { issue: resumableSelected, resumed: true };
    }
    if (shouldResume) {
      const explicitIssue = issues.find(
        (candidate) =>
          candidate.number === config.issueNumber && candidate.state === "open",
      );
      const explicitState = explicitIssue
        ? await readRunState(config.runStateDir, explicitIssue.number)
        : undefined;
      if (explicitIssue && hasBlockedSavedWorkspaceState(explicitState)) {
        return { issue: explicitIssue, resumed: true };
      }
    }
    const selected = selectIssue(issues, {
      issueNumber: config.issueNumber,
      readyLabel: ready,
      triagePolicy: config.triagePolicy,
      approvalPolicy: config.approvalPolicy,
    });
    if (!selected) return undefined;
    if (resumable.length === 1 && resumable[0]?.number !== selected.number) {
      throw new Error(
        `Resumable ${inProgress} automation run #${resumable[0]?.number} exists; resume it before processing #${selected.number}`,
      );
    }
    return {
      issue: selected,
      resumed: resumable[0]?.number === selected.number,
    };
  }

  if (resumable.length === 1) {
    return { issue: resumable[0], resumed: true };
  }

  const selected = selectIssue(issues, {
    issueNumber: config.issueNumber,
    readyLabel: ready,
    triagePolicy: config.triagePolicy,
    approvalPolicy: config.approvalPolicy,
  });
  return selected ? { issue: selected, resumed: false } : undefined;
}

function mergeIssueLists(
  primary: IssueSummary[],
  secondary: IssueSummary[],
): IssueSummary[] {
  const issues = new Map<number, IssueSummary>();
  for (const issue of secondary) issues.set(issue.number, issue);
  for (const issue of primary) issues.set(issue.number, issue);
  return [...issues.values()];
}

async function loadSelectionIssues(
  host: IssueHostProvider,
  config: AgentIssueConfig,
  options: RunOneIssueOptions,
): Promise<IssueSummary[]> {
  if (config.issueNumber === undefined) {
    await progress(options, "info", "select", "listing open issues");
    return host.listOpenIssues();
  }

  await progress(
    options,
    "info",
    "select",
    `loading issue #${config.issueNumber}`,
    { issueNumber: config.issueNumber },
  );
  const requestedIssues = [await host.viewIssue(config.issueNumber)];
  const shouldResume = config.execute && !config.dryRun;
  if (!shouldResume) return requestedIssues;

  await progress(options, "info", "select", "listing open issues");
  const openIssues = await host.listOpenIssues();
  return mergeIssueLists(requestedIssues, openIssues);
}

function unexpectedFailureComment(
  reason: string,
  inProgressLabel: string,
): string {
  return [
    `Automation failed unexpectedly and remains ${inProgressLabel}.`,
    ``,
    reason,
    ``,
    `A human should inspect the run logs before re-running or relabeling this issue.`,
  ].join("\n");
}

function unexpectedFailureCommentKey(
  status: "claimed" | "planning" | "implementing",
): string {
  return `unexpected-failure:${status}`;
}

async function unexpectedFailure(
  host: IssueHostProvider,
  config: AgentIssueConfig,
  issue: IssueSummary,
  checkpoints: AgentIssueRunCheckpoints,
  details: {
    specPath?: string;
    specCommit?: string;
    planPath?: string;
    planCommit?: string;
    branch?: string;
    worktreePath?: string;
  },
  timestamp: string,
  error: unknown,
  options: RunOneIssueOptions,
): Promise<AgentIssuePipelineResult> {
  const reason = errorMessage(error);
  const status =
    details.branch ||
    details.worktreePath ||
    checkpoints.worktreeReady ||
    checkpoints.implementationCompleted
      ? "implementing"
      : details.specPath ||
          details.specCommit ||
          checkpoints.specPathResolved ||
          checkpoints.specCreated ||
          checkpoints.specReadyCommentPosted ||
          details.planPath ||
          details.planCommit ||
          checkpoints.planPathResolved ||
          checkpoints.planCreated ||
          checkpoints.planReadyCommentPosted ||
          checkpoints.readyLabelRestored
        ? "planning"
        : "claimed";
  await progress(options, "error", "blocked", `blocked: ${reason}`, {
    issueNumber: issue.number,
  });
  await writeRunState(
    config.runStateDir,
    {
      issueNumber: issue.number,
      title: issue.title,
      status,
      specPath: details.specPath,
      specCommit: details.specCommit,
      planPath: details.planPath,
      planCommit: details.planCommit,
      branch: details.branch,
      worktreePath: details.worktreePath,
      lastError: reason,
    },
    timestamp,
  );
  const state = await readRunState(config.runStateDir, issue.number);
  const failureCommentKey = unexpectedFailureCommentKey(status);
  if (!state?.failureCommentKeys?.includes(failureCommentKey)) {
    const { inProgress } = lifecycleLabels(config);
    const commented = await host
      .commentIssue(issue.number, unexpectedFailureComment(reason, inProgress))
      .then(() => true)
      .catch(() => false);
    if (commented) {
      await writeRunState(
        config.runStateDir,
        {
          issueNumber: issue.number,
          status,
          specPath: details.specPath,
          specCommit: details.specCommit,
          planPath: details.planPath,
          planCommit: details.planCommit,
          branch: details.branch,
          worktreePath: details.worktreePath,
          failureCommentKeys: [failureCommentKey],
        },
        timestamp,
      );
    }
  }

  await emitSimpleStep(options, issue.number, "final result blocked");

  return withLogPath(
    {
      status: "blocked",
      reason,
      questions: [],
      commits: [],
      validation: [],
      ...details,
      issue,
    },
    options,
  );
}

async function blockIssue(
  host: IssueHostProvider,
  config: AgentIssueConfig,
  issue: IssueSummary,
  labels: string[],
  result: AgentIssueBlockedResult,
  details: {
    specPath?: string;
    specCommit?: string;
    planPath?: string;
    planCommit?: string;
    branch?: string;
    worktreePath?: string;
  },
  timestamp: string,
  options: RunOneIssueOptions,
): Promise<AgentIssuePipelineResult> {
  const { inProgress, needsInfo } = lifecycleLabels(config);
  await progress(options, "error", "blocked", `blocked: ${result.reason}`, {
    issueNumber: issue.number,
  });
  const blockedLabels = nextLabels(labels, [inProgress], [needsInfo]);
  await ensureAutomationLabel(host, config, needsInfo);
  await host.applyLabels(planLabelChange(issue.number, labels, blockedLabels));
  await writeRunState(
    config.runStateDir,
    {
      issueNumber: issue.number,
      title: issue.title,
      status: "blocked",
      specPath: details.specPath,
      specCommit: details.specCommit,
      planPath: details.planPath,
      planCommit: details.planCommit,
      branch: details.branch,
      worktreePath: details.worktreePath,
      lastError: result.reason,
    },
    timestamp,
  );
  await host
    .commentIssue(issue.number, blockerComment(result))
    .catch(() => undefined);

  await emitSimpleStep(options, issue.number, "final result blocked");

  return withLogPath({ ...result, ...details, issue }, options);
}

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
    await progress(options, "info", "select", "no eligible issue found");
    return withLogPath({ status: "no-issue" }, options);
  }

  const existingState = await readRunState(config.runStateDir, issue.number);
  const piAgentDir = localPiAgentDir(config.repoRoot);
  const resumed = selected?.resumed ?? false;
  const ordinaryResumableState =
    resumed && !!existingState && isResumableRunState(existingState);
  const blockedRecoveryReport =
    existingState?.status === "blocked" &&
    (existingState.branch || existingState.worktreePath)
      ? await inspectBlockedRunRecovery({
          runner,
          repoRoot: config.repoRoot,
          runStatePath: runStatePath(config.runStateDir, issue.number),
          state: existingState,
          baseRef: config.baseRef,
        })
      : undefined;
  const blockedRecoveryResumable =
    blockedRecoveryReport?.kind === "recoverable-clean";
  const resumableState = ordinaryResumableState || blockedRecoveryResumable;
  const resetStaleCheckpoints = !!existingState && !resumableState;
  const checkpoints = {
    ...(effectiveCheckpoints(existingState?.checkpoints, resumableState) ?? {}),
  };

  await progress(
    options,
    "info",
    "select",
    `${resumed ? "resuming" : "selected"} #${issue.number} ${issue.title}`,
    { issueNumber: issue.number },
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
    (stage: "pi-plan" | "pi-development-environment" | "pi-implementation") =>
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
  await progress(options, "info", "git", "checking repository status", {
    issueNumber: issue.number,
  });
  const ignoredPaths = cleanStatusIgnoredPaths(config, options);
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

  try {
    if (!checkpoints.startedCommentPosted) {
      await host.commentIssue(issue.number, startedComment(issue));
      await writeRunState(
        config.runStateDir,
        {
          issueNumber: issue.number,
          title: issue.title,
          status: "claimed",
          checkpoints: { startedCommentPosted: true },
        },
        timestamp,
      );
      checkpoints.startedCommentPosted = true;
    }

    const planningStages = await advancePlanningStages({
      runner,
      host,
      config,
      issue,
      labels,
      ready,
      inProgress,
      needsInfo,
      existingState,
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
          issue,
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

    const worktreeStrategy = configuredWorktreeStrategy(config);
    const expectedWorkspace = expectedIssueWorkspace(
      issue.number,
      issue.title,
      worktreeStrategy,
    );
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
      !checkpoints.visualEvidenceUploaded
    ) {
      const visualEvidenceUploader =
        options.visualEvidenceUploader ??
        defaultVisualEvidenceUploader({
          runner,
          provider: config.host.provider,
          env: options.visualEvidenceEnv,
          fetchImpl: options.fetchImpl,
        });
      const uploadedEvidence = await uploadPrVisualEvidence({
        repoRoot: join(config.repoRoot, worktreePath),
        prUrl: implemented.prUrl,
        evidence: implemented.visualEvidence,
        uploader: visualEvidenceUploader,
        onProgress: async (message) => {
          await progress(options, "info", "visual-evidence", message, {
            issueNumber: issue.number,
          });
        },
      });
      implemented = { ...implemented, visualEvidence: uploadedEvidence };
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
          visualEvidence: uploadedEvidence,
          checkpoints: { visualEvidenceUploaded: true },
        },
        timestamp,
      );
      checkpoints.visualEvidenceUploaded = true;
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
      [inProgress],
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

    await runStep(`final result ${implemented.status}`, async () => undefined);

    return withLogPath(
      { ...implemented, issue, specPath, planPath, worktreePath },
      options,
    );
  } catch (error) {
    if (error instanceof AgentIssueSafetyError) {
      throw error;
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
