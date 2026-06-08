import { DEFAULT_PATCHMILL_CONFIG } from "../../../config/defaults.ts";
import { createIssueHostProvider } from "../../../host/factory.ts";
import {
  canonicalBucketForLabels,
  type PatchmillTriageStateMap,
} from "../../../policy/triage-state.ts";
import {
  createUnblockedComment,
  replaceTriageStateLabels,
  resolveBlockedIssue,
} from "./blocked.ts";
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

function selectIssues(
  issues: IssueSummary[],
  config: TriageConfig,
): IssueSummary[] {
  let selected = issues;
  const triagePolicy = config.triagePolicy ?? DEFAULT_TRIAGE_POLICY;
  const excludedLabels = new Set(
    triagePolicy.excludedLabels.filter(
      (label) => label !== triagePolicy.labels.blocked,
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

  if (config.limit !== undefined) {
    selected = selected.slice(0, config.limit);
  }

  return selected;
}

function issueRefList(issueNumbers: readonly number[]): string {
  return issueNumbers.map((issueNumber) => `#${issueNumber}`).join(", ");
}

function blockedBucket(issue: IssueSummary, config: TriageConfig): boolean {
  const triagePolicy = config.triagePolicy ?? DEFAULT_TRIAGE_POLICY;
  return (
    canonicalBucketForLabels(issue.labels, triagePolicy.stateMap) === "blocked"
  );
}

function autoUnblockPreviewEntry(
  issue: IssueSummary,
  stateMap: PatchmillTriageStateMap,
  readyLabel: string,
  blockedBy: number[],
): TriageLogIssueEntry {
  const comment = createUnblockedComment(blockedBy);
  return {
    issueNumber: issue.number,
    title: issue.title,
    ...(issue.url ? { url: issue.url } : {}),
    previousLabels: issue.labels,
    finalLabels: replaceTriageStateLabels(issue.labels, stateMap, readyLabel),
    primaryBucket: "agent-ready",
    blockedBy,
    rationale: `All blocking issues are closed: ${issueRefList(blockedBy)}.`,
    questions: [],
    comment,
    wouldClose: false,
    mutationStatus: "preview",
  };
}

function stillBlockedEntry(
  issue: IssueSummary,
  blockedBy: number[],
  openBlockers: number[],
  mutationStatus: "preview" | "observed",
): TriageLogIssueEntry {
  return {
    issueNumber: issue.number,
    title: issue.title,
    ...(issue.url ? { url: issue.url } : {}),
    previousLabels: issue.labels,
    finalLabels: issue.labels,
    primaryBucket: "blocked",
    blockedBy,
    rationale: `Still blocked by open issue${openBlockers.length === 1 ? "" : "s"}: ${issueRefList(openBlockers)}.`,
    questions: [],
    comment: null,
    mutationStatus,
  };
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
      const directLogIssues: TriageLogIssueEntry[] = [];
      const agentIssues: IssueSummary[] = [];
      for (const issue of issues) {
        if (!blockedBucket(issue, config)) {
          agentIssues.push(issue);
          continue;
        }

        const resolution = await resolveBlockedIssue(host, issue);
        if (resolution.status === "unblocked") {
          directLogIssues.push(
            autoUnblockPreviewEntry(
              issue,
              triagePolicy.stateMap,
              triagePolicy.labels.ready,
              resolution.blockedBy,
            ),
          );
          continue;
        }

        if (resolution.status === "still-blocked") {
          directLogIssues.push(
            stillBlockedEntry(
              issue,
              resolution.blockedBy,
              resolution.openBlockers,
              "preview",
            ),
          );
          continue;
        }

        agentIssues.push(issue);
      }

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
      const logIssues = [
        ...directLogIssues,
        ...createPreviewEntries(agentIssues, previews),
      ];
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
    const agentIssues: IssueSummary[] = [];
    for (const issue of issues) {
      if (!blockedBucket(issue, config)) {
        agentIssues.push(issue);
        continue;
      }

      const resolution = await resolveBlockedIssue(host, issue);
      if (resolution.status === "unblocked") {
        const comment = createUnblockedComment(resolution.blockedBy);
        const finalLabels = replaceTriageStateLabels(
          issue.labels,
          triagePolicy.stateMap,
          triagePolicy.labels.ready,
        );
        await host.applyLabels(
          planLabelChange(issue.number, issue.labels, finalLabels),
        );
        await host.commentIssue(issue.number, comment);
        const entry: TriageLogIssueEntry = {
          issueNumber: issue.number,
          title: issue.title,
          ...(issue.url ? { url: issue.url } : {}),
          previousLabels: issue.labels,
          finalLabels,
          primaryBucket: "agent-ready",
          blockedBy: resolution.blockedBy,
          rationale: `All blocking issues are closed: ${issueRefList(resolution.blockedBy)}.`,
          questions: [],
          comment,
          addedComments: [comment],
          previousState: issue.state,
          finalState: issue.state,
          mutationStatus: "observed",
        };
        logIssues.push(entry);
        config.onProgress?.({
          type: "issue",
          issue: entry,
          completed: logIssues.length,
          total: issues.length,
        });
        continue;
      }

      if (resolution.status === "still-blocked") {
        const entry = stillBlockedEntry(
          issue,
          resolution.blockedBy,
          resolution.openBlockers,
          "observed",
        );
        logIssues.push(entry);
        config.onProgress?.({
          type: "issue",
          issue: entry,
          completed: logIssues.length,
          total: issues.length,
        });
        continue;
      }

      agentIssues.push(issue);
    }

    const completedBeforeAgent = logIssues.length;
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
        onIssue(entry, completed) {
          logIssues.push(entry);
          config.onProgress?.({
            type: "issue",
            issue: entry,
            completed: completedBeforeAgent + completed,
            total: issues.length,
          });
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
