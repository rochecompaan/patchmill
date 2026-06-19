import { DEFAULT_PATCHMILL_CONFIG } from "../../../config/defaults.ts";
import { createIssueHostProvider } from "../../../host/factory.ts";
import { canonicalBucketForLabels } from "../../../policy/triage-state.ts";
import { preprocessBlockedIssues } from "./blocked-preprocessor.ts";
import { runTriageDryRunAgent } from "./dry-run-agent.ts";
import { executeTriageIssues } from "./execute-issues.ts";
import { DEFAULT_TRIAGE_POLICY, planLabelChange } from "./labels.ts";
import { writeTriageLog } from "./log.ts";
import { createPreviewEntries } from "./reporting.ts";
import type {
  CommandRunner,
  IssueSummary,
  TriageConfig,
  TriageLogIssueEntry,
  TriageResult,
} from "./types.ts";

function createdMillis(issue: IssueSummary): number | undefined {
  if (!issue.created) return undefined;
  const millis = Date.parse(issue.created);
  return Number.isFinite(millis) ? millis : undefined;
}

function compareTriageIssueOrder(
  left: IssueSummary,
  right: IssueSummary,
): number {
  const leftCreated = createdMillis(left);
  const rightCreated = createdMillis(right);
  if (
    leftCreated !== undefined &&
    rightCreated !== undefined &&
    leftCreated !== rightCreated
  ) {
    return leftCreated - rightCreated;
  }
  return left.number - right.number;
}

function orderTriageIssues(issues: IssueSummary[]): IssueSummary[] {
  return [...issues].sort(compareTriageIssueOrder);
}

function selectIssues(
  issues: IssueSummary[],
  config: TriageConfig,
): IssueSummary[] {
  let selected = issues;
  const triagePolicy = config.triagePolicy ?? DEFAULT_TRIAGE_POLICY;
  const excludedLabels = new Set(
    triagePolicy.excludedLabels.filter(
      (label) => triagePolicy.stateMap[label] !== "blocked",
    ),
  );

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

  selected = orderTriageIssues(selected);

  if (config.limit !== undefined) {
    selected = selected.slice(0, config.limit);
  }

  return selected;
}

function blockedBucket(issue: IssueSummary, config: TriageConfig): boolean {
  const triagePolicy = config.triagePolicy ?? DEFAULT_TRIAGE_POLICY;
  return (
    canonicalBucketForLabels(issue.labels, triagePolicy.stateMap) === "blocked"
  );
}

function logMode(config: TriageConfig): "dry-run" | "execute" {
  return config.execute ? "execute" : "dry-run";
}

function entriesBySelectedIssueOrder(
  selectedIssues: readonly IssueSummary[],
  entries: readonly TriageLogIssueEntry[],
): TriageLogIssueEntry[] {
  const entriesByIssueNumber = new Map(
    entries.map((entry) => [entry.issueNumber, entry]),
  );
  return selectedIssues.flatMap((issue) => {
    const entry = entriesByIssueNumber.get(issue.number);
    return entry ? [entry] : [];
  });
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
      const { agentIssues, directEntries } = await preprocessBlockedIssues({
        issues,
        host,
        stateMap: triagePolicy.stateMap,
        readyLabel: triagePolicy.labels.ready,
        mutationStatus: "preview",
        isBlockedIssue: (issue) => blockedBucket(issue, config),
      });

      const previews =
        agentIssues.length === 0
          ? []
          : await runTriageDryRunAgent(runner, config.repoRoot, {
              issues: agentIssues,
              projectPolicy,
              stateMap: triagePolicy.stateMap,
              skills: config.skills,
              thinking:
                config.triageThinking ??
                DEFAULT_PATCHMILL_CONFIG.pi.triageThinking,
              onToolCall: config.onToolCall,
            });
      const logIssues = entriesBySelectedIssueOrder(issues, [
        ...directEntries,
        ...createPreviewEntries(agentIssues, previews),
      ]);
      logIssues.forEach((issue, index) => {
        config.onProgress?.({
          type: "issue",
          issue,
          completed: index + 1,
          total: issues.length,
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
    const pendingEntries = new Map<number, TriageLogIssueEntry>();
    let nextProgressIndex = 0;

    function flushPendingEntries(): void {
      while (nextProgressIndex < issues.length) {
        const issueNumber = issues[nextProgressIndex]?.number;
        if (issueNumber === undefined) return;
        const entry = pendingEntries.get(issueNumber);
        if (!entry) return;
        pendingEntries.delete(issueNumber);
        logIssues.push(entry);
        config.onProgress?.({
          type: "issue",
          issue: entry,
          completed: logIssues.length,
          total: issues.length,
        });
        nextProgressIndex += 1;
      }
    }

    const { agentIssues } = await preprocessBlockedIssues({
      issues,
      host,
      stateMap: triagePolicy.stateMap,
      readyLabel: triagePolicy.labels.ready,
      mutationStatus: "observed",
      isBlockedIssue: (issue) => blockedBucket(issue, config),
      async onAutoUnblocked({ issue, comment, finalLabels }) {
        await host.applyLabels(
          planLabelChange(issue.number, issue.labels, finalLabels),
        );
        await host.commentIssue(issue.number, comment);
        return {
          addedComments: [comment],
          previousState: issue.state,
          finalState: issue.state,
        };
      },
      onDirectEntry(entry) {
        pendingEntries.set(entry.issueNumber, entry);
        flushPendingEntries();
      },
    });

    if (agentIssues.length > 0) {
      await executeTriageIssues({
        runner,
        repoRoot: config.repoRoot,
        host,
        hostConfig: config.host,
        issues: agentIssues,
        projectPolicy,
        stateMap: triagePolicy.stateMap,
        skills: config.skills,
        thinking:
          config.triageThinking ?? DEFAULT_PATCHMILL_CONFIG.pi.triageThinking,
        onToolCall: config.onToolCall,
        onIssue(entry) {
          pendingEntries.set(entry.issueNumber, entry);
          flushPendingEntries();
        },
      });
    }
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
