import { DEFAULT_PATCHMILL_CONFIG } from "../../../config/defaults.ts";
import { createIssueHostProvider } from "../../../host/factory.ts";
import { runTriageDryRunAgent } from "./dry-run-agent.ts";
import { executeTriageIssues } from "./execute-issues.ts";
import { DEFAULT_TRIAGE_POLICY } from "./labels.ts";
import { writeTriageLog } from "./log.ts";
import { createPreviewEntries } from "./reporting.ts";
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
    selected = selected.filter(
      (issue) =>
        issue.number === config.issueNumber &&
        issue.state.toLowerCase() === "open",
    );
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
  const host = createIssueHostProvider({
    runner,
    repoRoot: config.repoRoot,
    host: config.host,
  });
  const createdAt = new Date().toISOString();
  const projectPolicy =
    config.projectPolicy ?? DEFAULT_PATCHMILL_CONFIG.projectPolicy;
  const triagePolicy = config.triagePolicy ?? DEFAULT_TRIAGE_POLICY;

  let listedIssues: IssueSummary[];
  try {
    listedIssues =
      config.issueNumber === undefined
        ? await host.listOpenIssues()
        : [await host.viewIssue(config.issueNumber)];
  } catch (error) {
    await tryWriteFailureLog(config, createdAt, [], error);
    throw error;
  }

  if (config.issueNumber !== undefined) {
    try {
      await host.hydrateIssueComments(listedIssues);
    } catch (error) {
      await tryWriteFailureLog(config, createdAt, [], error);
      throw error;
    }
  }

  const issues = selectIssues(listedIssues, config);

  if (config.issueNumber !== undefined && issues.length === 0) {
    const error = new Error(
      `Issue #${config.issueNumber} is not open or was not found`,
    );
    await tryWriteFailureLog(config, createdAt, [], error);
    throw error;
  }

  config.onProgress?.({ type: "selected", total: issues.length });

  if (issues.length === 0) {
    const logPath = await writeTriageLog(config.logDir, {
      mode: logMode(config),
      createdAt,
      issues: [],
    });

    return { status: "no-issues", issueCount: 0, logPath, issues: [] };
  }

  if (config.issueNumber === undefined) {
    try {
      await host.hydrateIssueComments(issues);
    } catch (error) {
      await tryWriteFailureLog(config, createdAt, [], error);
      throw error;
    }
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
        onToolCall: config.onToolCall,
      });
      const logIssues = createPreviewEntries(issues, previews);
      logIssues.forEach((issue, index) => {
        config.onProgress?.({
          type: "issue",
          issue,
          completed: index + 1,
          total: logIssues.length,
        });
      });
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

  const logIssues: TriageLogIssueEntry[] = [];

  try {
    await executeTriageIssues({
      runner,
      repoRoot: config.repoRoot,
      host,
      hostConfig: config.host,
      issues,
      projectPolicy,
      stateMap: triagePolicy.stateMap,
      skills: config.skills,
      thinking:
        config.triageThinking ?? DEFAULT_PATCHMILL_CONFIG.pi.triageThinking,
      onToolCall: config.onToolCall,
      onIssue(entry, completed, total) {
        logIssues.push(entry);
        config.onProgress?.({ type: "issue", issue: entry, completed, total });
      },
    });
  } catch (error) {
    await tryWriteFailureLog(config, createdAt, logIssues, error);
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
