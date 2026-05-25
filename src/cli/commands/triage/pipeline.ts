import { DEFAULT_PATCHMILL_CONFIG } from "../../../config/defaults.ts";
import { runTriageDryRunAgent } from "./dry-run-agent.ts";
import { runTriageExecuteAgent } from "./execute-agent.ts";
import {
  hydrateIssueComments,
  listIssuesByNumbers,
  listOpenIssues,
} from "./forgejo.ts";
import { DEFAULT_TRIAGE_POLICY } from "./labels.ts";
import { writeTriageLog } from "./log.ts";
import {
  createObservedChangeEntries,
  createPreviewEntries,
} from "./reporting.ts";
import type {
  CommandRunner,
  IssueSummary,
  TriageConfig,
  TriageLogIssueEntry,
  TriageResult,
} from "./types.ts";

function selectIssues(
  issues: IssueSummary[],
  config: TriageConfig,
): IssueSummary[] {
  let selected = issues;
  const triagePolicy = config.triagePolicy ?? DEFAULT_TRIAGE_POLICY;
  const excludedLabels = new Set(triagePolicy.excludedLabels);

  if (config.issueNumber !== undefined) {
    selected = selected.filter((issue) => issue.number === config.issueNumber);
  } else if (!config.all) {
    selected = selected.filter(
      (issue) => !issue.labels.some((label) => excludedLabels.has(label)),
    );
  }

  if (config.limit !== undefined) {
    selected = selected.slice(0, config.limit);
  }

  return selected;
}

function logMode(config: TriageConfig): "dry-run" | "execute" {
  return config.execute ? "execute" : "dry-run";
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

export async function runTriage(
  runner: CommandRunner,
  config: TriageConfig,
): Promise<TriageResult> {
  const createdAt = new Date().toISOString();
  const projectPolicy =
    config.projectPolicy ?? DEFAULT_PATCHMILL_CONFIG.projectPolicy;
  const triagePolicy = config.triagePolicy ?? DEFAULT_TRIAGE_POLICY;

  let listedIssues: IssueSummary[];
  try {
    listedIssues = await listOpenIssues(
      runner,
      config.repoRoot,
      config.teaLogin,
    );
  } catch (error) {
    await tryWriteFailureLog(config, createdAt, [], error);
    throw error;
  }

  const issues = selectIssues(listedIssues, config);

  if (config.issueNumber !== undefined && issues.length === 0) {
    const error = new Error(
      `Issue #${config.issueNumber} is not open or was not found`,
    );
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
    await hydrateIssueComments(
      runner,
      config.repoRoot,
      issues,
      config.teaLogin,
    );
  } catch (error) {
    await tryWriteFailureLog(config, createdAt, [], error);
    throw error;
  }

  if (config.dryRun) {
    try {
      const previews = await runTriageDryRunAgent(runner, config.repoRoot, {
        issues,
        projectPolicy,
        stateMap: triagePolicy.stateMap,
        skills: config.skills,
        thinking:
          config.triageThinking ?? DEFAULT_PATCHMILL_CONFIG.pi.triageThinking,
      });
      const logIssues = createPreviewEntries(issues, previews);
      const logPath = await writeTriageLog(config.logDir, {
        mode: "dry-run",
        createdAt,
        issues: logIssues,
      });

      return {
        status: "dry-run",
        issueCount: issues.length,
        logPath,
        issues: logIssues,
      };
    } catch (error) {
      await tryWriteFailureLog(config, createdAt, [], error);
      throw error;
    }
  }

  const beforeIssues = issues.map((issue) => ({
    ...issue,
    labels: [...issue.labels],
    comments: Array.isArray(issue.comments)
      ? [...issue.comments]
      : issue.comments,
  }));

  try {
    await runTriageExecuteAgent(runner, config.repoRoot, {
      issues,
      projectPolicy,
      skills: config.skills,
      thinking:
        config.triageThinking ?? DEFAULT_PATCHMILL_CONFIG.pi.triageThinking,
    });
  } catch (error) {
    await tryWriteFailureLog(config, createdAt, [], error);
    throw error;
  }

  let afterIssues: IssueSummary[];
  try {
    afterIssues = await listIssuesByNumbers(
      runner,
      config.repoRoot,
      beforeIssues.map((issue) => issue.number),
      config.teaLogin,
    );
    await hydrateIssueComments(
      runner,
      config.repoRoot,
      afterIssues,
      config.teaLogin,
    );
  } catch (error) {
    await tryWriteFailureLog(config, createdAt, [], error);
    throw error;
  }

  let logIssues: TriageLogIssueEntry[];
  try {
    logIssues = createObservedChangeEntries(
      beforeIssues,
      afterIssues,
      triagePolicy.stateMap,
    );
  } catch (error) {
    await tryWriteFailureLog(config, createdAt, [], error);
    throw error;
  }

  const logPath = await writeTriageLog(config.logDir, {
    mode: "execute",
    createdAt,
    issues: logIssues,
  });

  return {
    status: "applied",
    issueCount: issues.length,
    logPath,
    issues: logIssues,
  };
}
