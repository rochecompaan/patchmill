import { access } from "node:fs/promises";
import { isAbsolute, join, relative } from "node:path";
import { runCleanupHooks } from "../../src/cleanup/hooks.ts";
import {
  buildIssueBranchName,
  buildIssueWorktreePath,
} from "../../src/git/worktree-strategy.ts";
import type { GitWorktreeStrategyConfig } from "../../src/git/types.ts";
import {
  applyIssueLabels,
  commentIssue,
  createLabel,
  listLabels,
  listOpenIssues,
} from "../agent-issue-triage/forgejo.ts";
import {
  DEFAULT_TRIAGE_POLICY,
  missingLabelDefinitions,
  planLabelChange,
} from "../agent-issue-triage/labels.ts";
import { resolveAgentTeam } from "./agent-team.ts";
import type { ResolvedAgentTeam } from "./agent-team.ts";
import {
  assertCleanWorktree,
  ensureIssueWorktree,
} from "./git.ts";
import { assertIssueTodosComplete, issueTodoProgress, readIssueTodoTasks } from "./issue-todos.ts";
import { runPiPrompt } from "./pi.ts";
import { readPlanTaskLabels } from "./plan-tasks.ts";
import { buildPlanPath, findIssuePlan } from "./plans.ts";
import {
  buildImplementationPrompt,
  buildPlanCreationPrompt,
} from "./prompts.ts";
import type { ForgejoVisualEvidenceEnv } from "../../src/host/forgejo-visual-evidence.ts";
import type { VisualEvidenceUploader } from "../../src/host/visual-evidence.ts";
import { isResumableRunState, readRunState, writeRunState } from "./run-state.ts";
import { selectIssue } from "./selection.ts";
import { defaultVisualEvidenceUploader, uploadPrVisualEvidence } from "./visual-evidence.ts";
import type { AgentIssueProgressEvent, ProgressReporter } from "./progress.ts";
import type {
  AgentIssueBlockedResult,
  AgentIssueConfig,
  AgentIssuePiResult,
  AgentIssuePipelineResult,
  AgentIssueQuestion,
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
  config: Pick<AgentIssueConfig, "runStateDir" | "cleanStatusIgnorePrefixes" | "projectPolicy">,
  options: Pick<RunOneIssueOptions, "logPath">,
): string[] {
  return [...new Set([
    ...(config.cleanStatusIgnorePrefixes ?? []),
    config.projectPolicy.pi.taskContract.todoRoot,
    config.runStateDir,
    ...(options.logPath ? [options.logPath] : []),
  ])];
}

function repoPath(
  repoRoot: string,
  path: string,
): { absolute: string; relative: string } {
  if (isAbsolute(path)) {
    return { absolute: path, relative: relative(repoRoot, path) };
  }

  return { absolute: join(repoRoot, path), relative: path };
}

function configuredWorktreeDir(config: Pick<AgentIssueConfig, "repoRoot" | "worktreeDir">): string {
  return relative(config.repoRoot, config.worktreeDir) || ".";
}

function configuredWorktreeStrategy(
  config: Pick<AgentIssueConfig, keyof GitWorktreeStrategyConfig | "repoRoot" | "worktreeDir">,
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

function expectedIssueWorkspace(issueNumber: number, title: string, strategy: GitWorktreeStrategyConfig): {
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

function lifecycleLabels(config: Pick<AgentIssueConfig, "readyLabel" | "triagePolicy">): {
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

const RESUME_ONLY_SIDE_EFFECT_CHECKPOINTS = new Set<keyof AgentIssueRunCheckpoints>([
  "claimed",
  "startedCommentPosted",
  "readyLabelRestored",
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
      ([checkpoint]) => !RESUME_ONLY_SIDE_EFFECT_CHECKPOINTS.has(checkpoint as keyof AgentIssueRunCheckpoints),
    ),
  ) as AgentIssueRunCheckpoints;

  return Object.keys(filtered).length > 0 ? filtered : undefined;
}

function promptBodyPath(repoRoot: string, absolutePlanPath: string): string {
  return relative(repoRoot, absolutePlanPath);
}

function startedComment(issue: IssueSummary): string {
  return `Automation started for issue #${issue.number}.

The issue has been claimed for plan and implementation orchestration.`;
}

function planComment(planPath: string, created: boolean): string {
  return `${created ? "Plan ready" : "Existing plan ready"}: \`${planPath}\``;
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

function questionText(question: AgentIssueQuestion): string {
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
  const entries = value.filter((entry): entry is string => typeof entry === "string");
  return entries.length === value.length ? entries : undefined;
}

function visualEvidenceArray(value: unknown): AgentIssueVisualEvidence[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const entries = value.flatMap((entry): AgentIssueVisualEvidence[] => {
    if (!entry || typeof entry !== "object") return [];
    const record = entry as Record<string, unknown>;
    if (typeof record.screenshotPath !== "string") return [];
    return [{
      screenshotPath: record.screenshotPath,
      caption: typeof record.caption === "string" ? record.caption : undefined,
      referencePaths: stringArray(record.referencePaths),
      url: typeof record.url === "string" ? record.url : undefined,
    }];
  });
  return entries.length > 0 ? entries : undefined;
}

function successfulImplementationFromState(
  state: {
    implementationStatus?: "pr-created" | "merged";
    branch?: string;
    prUrl?: string;
    mergeCommit?: string;
    commits?: unknown;
    validation?: unknown;
    reviewSummary?: unknown;
    landingDecision?: unknown;
    visualEvidence?: unknown;
  } | undefined,
): Extract<AgentIssuePiResult, { status: "pr-created" | "merged" }> | undefined {
  if (!state?.implementationStatus || !state.branch) return undefined;

  const commits = stringArray(state.commits);
  const validation = stringArray(state.validation);
  if (!commits || !validation) return undefined;
  const reviewSummary = typeof state.reviewSummary === "string" ? state.reviewSummary : undefined;
  const landingDecision = typeof state.landingDecision === "string" ? state.landingDecision : undefined;
  const visualEvidence = visualEvidenceArray(state.visualEvidence);

  if (state.implementationStatus === "pr-created" && typeof state.prUrl === "string") {
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

  if (state.implementationStatus === "merged" && typeof state.mergeCommit === "string") {
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
  config: Pick<AgentIssueConfig, "allowDirectLand">,
  source: string,
): void {
  if (result.status === "merged" && !config.allowDirectLand) {
    throw new AgentIssueSafetyError(
      `${source} returned merged while git.allowDirectLand is false`,
    );
  }
}

function agentTeamQuestion(): AgentIssueQuestion {
  return {
    question:
      "Which agent-team preset should agent-issue-once use for worker and reviewer subagents?",
    recommendedAnswer:
      "Run with --agent-team <name> or set CROPRUN_AGENT_ISSUE_AGENT_TEAM=<name> so worker/reviewer model and thinking are explicit.",
  };
}

async function implementationAgentTeam(
  config: AgentIssueConfig,
): Promise<ResolvedAgentTeam | AgentIssueBlockedResult> {
  if (config.agentTeam) return config.agentTeam;
  if (!config.agentTeamName) {
    return {
      status: "blocked",
      reason: "Agent team is required for implementation runs.",
      questions: [agentTeamQuestion()],
      commits: [],
      validation: [],
    };
  }

  try {
    return await resolveAgentTeam(config.repoRoot, config.agentTeamName);
  } catch (error) {
    return {
      status: "blocked",
      reason: `Configured agent team could not be resolved: ${errorMessage(error)}`,
      questions: [agentTeamQuestion()],
      commits: [],
      validation: [],
    };
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
      if (state && isResumableRunState(state)) resumable.push(issue);
    }
  }

  if (resumable.length > 1) {
    throw new Error(
      `Multiple resumable ${inProgress} automation runs found: ${resumable.map((issue) => `#${issue.number}`).join(", ")}`,
    );
  }

  if (config.issueNumber !== undefined) {
    const resumableSelected = resumable.find((issue) => issue.number === config.issueNumber);
    if (resumableSelected) {
      return { issue: resumableSelected, resumed: true };
    }
    const selected = selectIssue(issues, {
      issueNumber: config.issueNumber,
      readyLabel: ready,
      triagePolicy: config.triagePolicy,
    });
    if (!selected) return undefined;
    if (resumable.length === 1 && resumable[0]?.number !== selected.number) {
      throw new Error(
        `Resumable ${inProgress} automation run #${resumable[0]?.number} exists; resume it before processing #${selected.number}`,
      );
    }
    return { issue: selected, resumed: resumable[0]?.number === selected.number };
  }

  if (resumable.length === 1) {
    return { issue: resumable[0], resumed: true };
  }

  const selected = selectIssue(issues, {
    issueNumber: config.issueNumber,
    readyLabel: ready,
    triagePolicy: config.triagePolicy,
  });
  return selected ? { issue: selected, resumed: false } : undefined;
}

function unexpectedFailureComment(reason: string, inProgressLabel: string): string {
  return [
    `Automation failed unexpectedly and remains ${inProgressLabel}.`,
    ``,
    reason,
    ``,
    `A human should inspect the run logs before re-running or relabeling this issue.`,
  ].join("\n");
}

function unexpectedFailureCommentKey(status: "claimed" | "planning" | "implementing"): string {
  return `unexpected-failure:${status}`;
}

async function ensureAutomationLabel(
  runner: CommandRunner,
  config: AgentIssueConfig,
  name: string,
): Promise<void> {
  const missing = missingLabelDefinitions(
    await listLabels(runner, config.repoRoot, config.teaLogin),
    config.triagePolicy ?? DEFAULT_TRIAGE_POLICY,
  );
  const label = missing.find((definition) => definition.name === name);
  if (!label) return;
  await createLabel(runner, config.repoRoot, label, config.teaLogin);
}

async function unexpectedFailure(
  runner: CommandRunner,
  config: AgentIssueConfig,
  issue: IssueSummary,
  checkpoints: AgentIssueRunCheckpoints,
  details: {
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
  const status = details.branch || details.worktreePath || checkpoints.worktreeReady || checkpoints.implementationCompleted
    ? "implementing"
    : details.planPath || details.planCommit || checkpoints.planPathResolved || checkpoints.planCreated
      || checkpoints.planReadyCommentPosted || checkpoints.readyLabelRestored
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
    const commented = await commentIssue(
      runner,
      config.repoRoot,
      issue.number,
      unexpectedFailureComment(reason, inProgress),
      config.teaLogin,
    ).then(() => true).catch(() => false);
    if (commented) {
      await writeRunState(
        config.runStateDir,
        {
          issueNumber: issue.number,
          status,
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
  runner: CommandRunner,
  config: AgentIssueConfig,
  issue: IssueSummary,
  labels: string[],
  result: AgentIssueBlockedResult,
  details: {
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
  await ensureAutomationLabel(runner, config, needsInfo);
  await applyIssueLabels(
    runner,
    config.repoRoot,
    planLabelChange(issue.number, labels, blockedLabels),
    config.teaLogin,
  );
  await writeRunState(
    config.runStateDir,
    {
      issueNumber: issue.number,
      title: issue.title,
      status: "blocked",
      planPath: details.planPath,
      planCommit: details.planCommit,
      branch: details.branch,
      worktreePath: details.worktreePath,
      lastError: result.reason,
    },
    timestamp,
  );
  await commentIssue(
    runner,
    config.repoRoot,
    issue.number,
    blockerComment(result),
    config.teaLogin,
  ).catch(() => undefined);

  await emitSimpleStep(options, issue.number, "final result blocked");

  return withLogPath({ ...result, ...details, issue }, options);
}

export async function runOneIssue(
  runner: CommandRunner,
  config: AgentIssueConfig,
  options: RunOneIssueOptions = {},
): Promise<AgentIssuePipelineResult> {
  await progress(options, "info", "select", "listing open issues");
  const issues = await listOpenIssues(runner, config.repoRoot, config.teaLogin);
  const selected = await selectResumableIssue(issues, config);
  const issue = selected?.issue;

  if (!issue) {
    await progress(options, "info", "select", "no eligible issue found");
    return withLogPath({ status: "no-issue" }, options);
  }

  const existingState = await readRunState(config.runStateDir, issue.number);
  const resumed = selected?.resumed ?? false;
  const resumableState = resumed && !!existingState && isResumableRunState(existingState);
  const resetStaleCheckpoints = !!existingState && !resumableState;
  const checkpoints = { ...(effectiveCheckpoints(existingState?.checkpoints, resumableState) ?? {}) };

  await progress(
    options,
    "info",
    "select",
    `${resumed ? "resuming" : "selected"} #${issue.number} ${issue.title}`,
    { issueNumber: issue.number },
  );
  if (config.dryRun) return withLogPath({ status: "dry-run", issue }, options);

  if (resetStaleCheckpoints && (existingState?.branch || existingState?.worktreePath)) {
    throw new AgentIssueSafetyError(
      `Non-resumable run state for issue #${issue.number} has stale branch/worktree; clean up before starting a fresh run`,
    );
  }

  const timestamp = (options.now ?? new Date()).toISOString();
  const tokenUsageState = { total: 0 };
  const runStartedAtMs = (options.now ?? new Date()).getTime();
  const stepAccounting: {
    current?: { label: string; startOutputTokens: number; toolCalls: number; startedAt: number };
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
    const current = stepAccounting.current?.label === label ? stepAccounting.current : undefined;
    const taskOutputTokens = current
      ? stepAccounting.totalOutputTokens - current.startOutputTokens
      : 0;
    const toolCalls = current?.toolCalls ?? 0;
    const elapsedSeconds = Math.max(0, Math.round((Date.now() - runStartedAtMs) / 1000));
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
  const runStep = async <T>(label: string, fn: () => Promise<T>): Promise<T> => {
    await stepStart(label);
    try {
      return await fn();
    } finally {
      await stepComplete(label);
    }
  };
  const observePi = (stage: "pi-plan" | "pi-implementation") => async (observation: AgentIssueProgressEvent["observation"]): Promise<void> => {
    if (!observation) return;
    if (observation.type === "assistant-usage") stepAccounting.totalOutputTokens += observation.outputTokens;
    if (observation.type === "tool-call" && stepAccounting.current) stepAccounting.current.toolCalls += 1;
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
  await assertCleanWorktree(
    runner,
    config.repoRoot,
    ignoredPaths,
  );
  const { ready, inProgress, done, needsInfo } = lifecycleLabels(config);
  let labels = resumed
    ? (issue.labels.includes(inProgress)
      ? issue.labels
      : nextLabels(issue.labels, [ready], [inProgress]))
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
      await ensureAutomationLabel(runner, config, inProgress);
      await applyIssueLabels(
        runner,
        config.repoRoot,
        planLabelChange(issue.number, issue.labels, labels),
        config.teaLogin,
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
  let planPath: string | undefined;
  let planCommit: string | undefined;
  let branch: string | undefined;
  let worktreePath: string | undefined;
  let planCreated = false;

  try {
    if (!checkpoints.startedCommentPosted) {
      await commentIssue(
        runner,
        config.repoRoot,
        issue.number,
        startedComment(issue),
        config.teaLogin,
      );
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

    await progress(options, "info", "plan", "finding plan", {
      issueNumber: issue.number,
    });
    let savedPlanExists = false;
    if (existingState?.planPath) {
      const savedPlanPath = repoPath(config.repoRoot, existingState.planPath);
      try {
        await access(savedPlanPath.absolute);
        planPath = savedPlanPath.relative;
        savedPlanExists = true;
        planCreated = existingState.checkpoints?.planCreated === true;
      } catch {
        planPath = undefined;
      }
    }

    const foundPlan = planPath
      ? undefined
      : await findIssuePlan(config.plansDir, issue.number);
    planPath ??= foundPlan
      ? repoPath(config.repoRoot, foundPlan).relative
      : promptBodyPath(
          config.repoRoot,
          buildPlanPath(
            config.plansDir,
            issue.number,
            issue.title,
            options.now ?? new Date(),
          ),
        );
    const hasExistingPlan = savedPlanExists || foundPlan !== undefined;
    await writeRunState(
      config.runStateDir,
      {
        issueNumber: issue.number,
        status: "planning",
        planPath,
        checkpoints: {
          planPathResolved: true,
          ...(planCreated ? { planCreated: true } : {}),
        },
      },
      timestamp,
    );
    checkpoints.planPathResolved = true;
    if (planCreated) checkpoints.planCreated = true;

    if (!hasExistingPlan) {
      const planned = await runStep("create plan", async () => {
        await progress(options, "info", "pi-plan", "creating plan with pi", {
          issueNumber: issue.number,
        });
        return await runPiPrompt(
          runner,
          config.repoRoot,
          buildPlanCreationPrompt({
            issue,
            planPath,
            projectPolicy: config.projectPolicy,
            triageLabels: { ready, needsInfo },
          }),
          {
            progress: options.progress,
            stage: "pi-plan",
            streamOutput: options.streamPiOutput,
            issueNumber: issue.number,
            repoRoot: config.repoRoot,
            heartbeatMs: options.heartbeatMs,
            tokenUsageState,
            observeSession: true,
            verbosePiOutput: options.verbosePiOutput,
            onObservation: observePi("pi-plan"),
            taskContract: config.projectPolicy.pi.taskContract,
          },
        );
      });
      if (planned.status === "blocked") {
        return blockIssue(
          runner,
          config,
          issue,
          labels,
          planned,
          { planPath },
          timestamp,
          options,
        );
      }
      if (planned.status !== "plan-created") {
        throw new Error(
          `Expected plan-created from Pi but received ${planned.status}`,
        );
      }

      planPath = repoPath(config.repoRoot, planned.planPath).relative;
      planCommit = planned.commit;
      planCreated = true;
      await writeRunState(
        config.runStateDir,
        {
          issueNumber: issue.number,
          status: "planning",
          planPath,
          planCommit,
          checkpoints: { planCreated: true },
        },
        timestamp,
      );
      checkpoints.planCreated = true;
      if (planCommit) await emitSimpleStep(options, issue.number, "commit plan");
    } else {
      await runStep("use existing plan", async () => {
        await progress(
          options,
          "info",
          "plan",
          `using existing plan ${planPath}`,
          { issueNumber: issue.number },
        );
      });
    }

    if (config.planOnly) {
      const finalLabels = nextLabels(
        labels,
        [inProgress],
        [ready],
      );
      if (!checkpoints.planReadyCommentPosted) {
        await commentIssue(
          runner,
          config.repoRoot,
          issue.number,
          planComment(planPath, planCreated),
          config.teaLogin,
        );
        await writeRunState(
          config.runStateDir,
          {
            issueNumber: issue.number,
            status: "planning",
            planPath,
            planCommit,
            checkpoints: { planReadyCommentPosted: true },
          },
          timestamp,
        );
        checkpoints.planReadyCommentPosted = true;
      }
      if (!checkpoints.readyLabelRestored) {
        await applyIssueLabels(
          runner,
          config.repoRoot,
          planLabelChange(issue.number, labels, finalLabels),
          config.teaLogin,
        );
        labels = finalLabels;
        await writeRunState(
          config.runStateDir,
          {
            issueNumber: issue.number,
            status: "finished",
            planPath,
            planCommit,
            checkpoints: { readyLabelRestored: true },
          },
          timestamp,
        );
        checkpoints.readyLabelRestored = true;
      }
      await writeRunState(
        config.runStateDir,
        {
          issueNumber: issue.number,
          status: "finished",
          planPath,
          planCommit,
        },
        timestamp,
      );
      await emitSimpleStep(options, issue.number, `final result ${planCreated ? "plan-created" : "plan-found"}`);
      return withLogPath(
        {
          status: planCreated ? "plan-created" : "plan-found",
          issue,
          planPath,
        },
        options,
      );
    }

    let implemented = resumableState && checkpoints.implementationCompleted
      ? successfulImplementationFromState(existingState as (typeof existingState & {
        prUrl?: string;
        mergeCommit?: string;
        commits?: unknown;
        validation?: unknown;
        reviewSummary?: unknown;
        landingDecision?: unknown;
      }) | undefined)
      : undefined;
    if (implemented) {
      assertDirectLandAllowed(implemented, config, "Saved implementation state");
    }

    let agentTeam: ResolvedAgentTeam | undefined;
    if (!implemented) {
      agentTeam = await implementationAgentTeam(config);
      if ("status" in agentTeam && agentTeam.status === "blocked") {
        return blockIssue(
          runner,
          config,
          issue,
          labels,
          agentTeam,
          { planPath, planCommit },
          timestamp,
          options,
        );
      }
    }
    const worktreeStrategy = configuredWorktreeStrategy(config);
    const expectedWorkspace = expectedIssueWorkspace(issue.number, issue.title, worktreeStrategy);
    if (resumableState && existingState?.branch && existingState.branch !== expectedWorkspace.branch) {
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
    await emitSimpleStep(options, issue.number, worktree.created ? "create worktree" : "reuse worktree");
    if (resumableState && existingState?.branch && existingState.branch !== worktree.branch) {
      throw new AgentIssueSafetyError(
        `Saved branch ${existingState.branch} does not match ensured worktree branch ${worktree.branch}`,
      );
    }
    if (resumableState && existingState?.worktreePath && existingState.worktreePath !== worktree.worktreePath) {
      throw new AgentIssueSafetyError(
        `Saved worktree ${existingState.worktreePath} does not match ensured worktree path ${worktree.worktreePath}`,
      );
    }
    branch = resumableState ? (existingState?.branch ?? worktree.branch) : worktree.branch;
    worktreePath = resumableState ? (existingState?.worktreePath ?? worktree.worktreePath) : worktree.worktreePath;
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
        planPath,
        planCommit,
        branch,
        worktreePath,
        checkpoints: { worktreeReady: true },
      },
      timestamp,
    );
    checkpoints.worktreeReady = true;

    if (!implemented) {
      await progress(
        options,
        "info",
        "pi-implementation",
        "running implementation with pi",
        { issueNumber: issue.number },
      );
      const worktreeRoot = join(config.repoRoot, worktreePath);
      const taskContract = config.projectPolicy.pi.taskContract;
      const planTaskLabels = await readPlanTaskLabels(config.repoRoot, planPath, taskContract);
      let activeImplementationTask: { current: number; total: number; label: string } | undefined;
      let finalImplementationStepActive = false;
      const finalImplementationStepLabel = "final review and landing";

      const labelForTask = (current: number, runtimeLabel?: string): string => {
        const planLabel = planTaskLabels.find((task) => task.number === current)?.label;
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
        const { current, total } = normalizeImplementationTaskProgress(rawCurrent, rawTotal);
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
          await stepComplete(`implement task ${activeImplementationTask.current}/${activeImplementationTask.total} ${activeImplementationTask.label}`);
        }
        activeImplementationTask = { current, total, label };
        await stepStart(`implement task ${current}/${total} ${label}`);
      };

      const startFinalImplementationStep = async (): Promise<void> => {
        if (finalImplementationStepActive) return;
        if (activeImplementationTask) {
          await stepComplete(`implement task ${activeImplementationTask.current}/${activeImplementationTask.total} ${activeImplementationTask.label}`);
          activeImplementationTask = undefined;
        }
        finalImplementationStepActive = true;
        await stepStart(finalImplementationStepLabel);
      };

      const issueTasksComplete = async (): Promise<boolean> => {
        const tasks = await readIssueTodoTasks(worktreeRoot, issue.number, taskContract);
        return tasks.length > 0 && tasks.every((task) => task.done);
      };

      const refreshImplementationTask = async (options: { startFinalWhenComplete?: boolean } = {}): Promise<void> => {
        if (options.startFinalWhenComplete && await issueTasksComplete()) {
          await startFinalImplementationStep();
          return;
        }
        const runtimeProgress = await issueTodoProgress(worktreeRoot, issue.number, taskContract);
        if (runtimeProgress) {
          await switchImplementationTask(runtimeProgress.current, runtimeProgress.total, runtimeProgress.label);
        }
      };

      const observeImplementation = async (observation: AgentIssueProgressEvent["observation"]): Promise<void> => {
        if (observation?.type === "tool-call") await refreshImplementationTask({ startFinalWhenComplete: true });
        await observePi("pi-implementation")(observation);
      };

      let piResult: AgentIssuePiResult | undefined;
      try {
        if (planTaskLabels.length > 0) {
          await switchImplementationTask(1, planTaskLabels.length, planTaskLabels[0]?.label);
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
            agentTeam,
            git: worktreeStrategy,
            projectPolicy,
            resume: {
              resumed: resumableState,
              worktreeCreated: worktree.created,
              existingCommits: worktree.existingCommits,
            },
          }),
          {
            progress: options.progress,
            stage: "pi-implementation",
            streamOutput: options.streamPiOutput,
            issueNumber: issue.number,
            repoRoot: worktreeRoot,
            heartbeatMs: options.heartbeatMs,
            tokenUsageState,
            observeSession: true,
            verbosePiOutput: options.verbosePiOutput,
            onObservation: observeImplementation,
            taskContract: projectPolicy.pi.taskContract,
            onTaskProgress: async (progress) => {
              await switchImplementationTask(progress.current, progress.total, progress.label);
            },
          },
        );

        await refreshImplementationTask();
      } finally {
        if (activeImplementationTask) {
          await stepComplete(`implement task ${activeImplementationTask.current}/${activeImplementationTask.total} ${activeImplementationTask.label}`);
          activeImplementationTask = undefined;
        }
        if (finalImplementationStepActive) {
          await stepComplete(finalImplementationStepLabel);
          finalImplementationStepActive = false;
        }
      }

      if (!piResult) throw new Error("Pi implementation completed without a result");
      if (piResult.status === "blocked") {
        return blockIssue(
          runner,
          config,
          issue,
          labels,
          piResult,
          { planPath, planCommit, branch, worktreePath },
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
        planPath,
        planCommit,
        branch,
        worktreePath,
        implementationStatus: implemented.status,
        prUrl: implemented.status === "pr-created" ? implemented.prUrl : undefined,
        mergeCommit: implemented.status === "merged" ? implemented.mergeCommit : undefined,
        commits: implemented.commits,
        validation: implemented.validation,
        reviewSummary: implemented.reviewSummary,
        landingDecision: implemented.landingDecision,
        visualEvidence: implemented.status === "pr-created" ? implemented.visualEvidence : undefined,
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
      const visualEvidenceUploader = options.visualEvidenceUploader
        ?? defaultVisualEvidenceUploader({
          runner,
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
      await commentIssue(
        runner,
        config.repoRoot,
        issue.number,
        handoffComment(planPath, implemented, config.baseBranch),
        config.teaLogin,
      );
      await writeRunState(
        config.runStateDir,
        {
          issueNumber: issue.number,
          status: "implementing",
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
      await ensureAutomationLabel(runner, config, done);
      await writeRunState(
        config.runStateDir,
        {
          issueNumber: issue.number,
          status: "implementing",
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
    const doneLabels = nextLabels(labels, [inProgress], [done]);
    if (!checkpoints.doneLabelApplied) {
      await applyIssueLabels(
        runner,
        config.repoRoot,
        planLabelChange(issue.number, labels, doneLabels),
        config.teaLogin,
      );
      await writeRunState(
        config.runStateDir,
        {
          issueNumber: issue.number,
          status: "finished",
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
        planPath,
        planCommit,
        branch,
        worktreePath,
      },
      timestamp,
    );

    const cleanupResults = await runCleanupHooks(
      runner,
      config.repoRoot,
      worktreePath,
      config.cleanupHooks,
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
      { ...implemented, issue, planPath, worktreePath },
      options,
    );
  } catch (error) {
    if (error instanceof AgentIssueSafetyError) {
      throw error;
    }
    return unexpectedFailure(
      runner,
      config,
      issue,
      checkpoints,
      { planPath, planCommit, branch, worktreePath },
      timestamp,
      error,
      options,
    );
  }
}
