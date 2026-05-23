import { ApplyDecisionError, applyDecisions, createLogEntries } from "./apply.ts";
import { runTriageAgent } from "./agent.ts";
import { createLabel, hydrateIssueComments, listLabels, listOpenIssues } from "./forgejo.ts";
import { DEFAULT_TRIAGE_POLICY, missingLabelDefinitions } from "./labels.ts";
import { DEFAULT_PATCHMILL_CONFIG } from "../../src/config/defaults.ts";
import { CROPRUN_COMPAT_POLICY } from "../../src/policy/defaults.ts";
import { writeTriageLog } from "./log.ts";
import { validateTriageDocument } from "./validation.ts";
import type { CommandRunner, IssueSummary, TriageConfig, TriageDecision, TriageLogIssueEntry, TriageResult } from "./types.ts";

function selectIssues(issues: IssueSummary[], config: TriageConfig): IssueSummary[] {
  let selected = issues;
  const triagePolicy = config.triagePolicy ?? DEFAULT_TRIAGE_POLICY;
  const excludedLabels = new Set(triagePolicy.excludedLabels);

  if (config.issueNumber !== undefined) {
    selected = selected.filter((issue) => issue.number === config.issueNumber);
  } else if (!config.all) {
    selected = selected.filter((issue) => !issue.labels.some((label) => excludedLabels.has(label)));
  }

  if (config.limit !== undefined) {
    selected = selected.slice(0, config.limit);
  }

  return selected;
}

function logMode(config: TriageConfig): "dry-run" | "execute" {
  return config.execute ? "execute" : "dry-run";
}

function decisionsThroughFailure(decisions: TriageDecision[], issueNumber: number): TriageDecision[] {
  const failedIndex = decisions.findIndex((decision) => decision.issueNumber === issueNumber);
  if (failedIndex < 0) return decisions;
  return decisions.slice(0, failedIndex + 1);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function tryWriteFailureLog(
  config: TriageConfig,
  createdAt: string,
  issues: TriageLogIssueEntry[],
  error: unknown,
): Promise<void> {
  await writeTriageLog(config.logDir, {
    mode: logMode(config),
    createdAt,
    issues,
    error: errorMessage(error),
  }).catch(() => undefined);
}

export async function runTriage(runner: CommandRunner, config: TriageConfig): Promise<TriageResult> {
  const createdAt = new Date().toISOString();
  const projectPolicy = config.projectPolicy ?? CROPRUN_COMPAT_POLICY;
  const triagePolicy = config.triagePolicy ?? DEFAULT_TRIAGE_POLICY;

  let listedIssues: IssueSummary[];
  try {
    listedIssues = await listOpenIssues(runner, config.repoRoot, config.teaLogin);
  } catch (error) {
    await tryWriteFailureLog(config, createdAt, [], error);
    throw error;
  }

  const issues = selectIssues(listedIssues, config);

  if (config.issueNumber !== undefined && issues.length === 0) {
    const error = new Error(`Issue #${config.issueNumber} is not open or was not found`);
    await tryWriteFailureLog(config, createdAt, [], error);
    throw error;
  }

  if (issues.length === 0) {
    const logPath = await writeTriageLog(config.logDir, {
      mode: logMode(config),
      createdAt,
      issues: [],
    });

    return { status: "no-issues", issueCount: 0, logPath, issues: [] };
  }

  try {
    await hydrateIssueComments(runner, config.repoRoot, issues, config.teaLogin);
  } catch (error) {
    await tryWriteFailureLog(config, createdAt, [], error);
    throw error;
  }

  let existingLabels: string[];
  try {
    existingLabels = await listLabels(runner, config.repoRoot, config.teaLogin);
  } catch (error) {
    await tryWriteFailureLog(config, createdAt, [], error);
    throw error;
  }

  const missingLabels = missingLabelDefinitions(existingLabels, triagePolicy);

  if (config.execute) {
    try {
      for (const label of missingLabels) {
        await createLabel(runner, config.repoRoot, label, config.teaLogin);
      }
    } catch (error) {
      await tryWriteFailureLog(config, createdAt, [], error);
      throw error;
    }
  }

  let decisions: TriageDecision[];
  try {
    decisions = validateTriageDocument(await runTriageAgent(runner, config.repoRoot, {
      issues,
      projectPolicy,
      triagePolicy,
      thinking: config.triageThinking ?? DEFAULT_PATCHMILL_CONFIG.pi.triageThinking,
    }), issues, triagePolicy);
  } catch (error) {
    await tryWriteFailureLog(config, createdAt, [], error);
    throw error;
  }

  if (!config.execute) {
    const logIssues = createLogEntries(issues, decisions, "planned", new Map(), triagePolicy);
    const logPath = await writeTriageLog(config.logDir, {
      mode: "dry-run",
      createdAt,
      issues: logIssues,
    });

    return { status: "dry-run", issueCount: issues.length, logPath, issues: logIssues };
  }

  try {
    await applyDecisions(runner, config.repoRoot, issues, decisions, config.teaLogin, triagePolicy);
  } catch (error) {
    if (error instanceof ApplyDecisionError) {
      await tryWriteFailureLog(
        config,
        createdAt,
        createLogEntries(
          issues,
          decisionsThroughFailure(decisions, error.issueNumber),
          "applied",
          new Map([[error.issueNumber, error.message]]),
          triagePolicy,
        ),
        error,
      );
    } else {
      await tryWriteFailureLog(config, createdAt, [], error);
    }

    throw error;
  }

  const logIssues = createLogEntries(issues, decisions, "applied", new Map(), triagePolicy);
  const logPath = await writeTriageLog(config.logDir, {
    mode: "execute",
    createdAt,
    issues: logIssues,
  });

  return { status: "applied", issueCount: issues.length, logPath, issues: logIssues };
}
