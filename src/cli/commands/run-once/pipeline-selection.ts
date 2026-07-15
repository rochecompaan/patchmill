import type { IssueHostProvider } from "../../../host/types.ts";
import { isResumableRunState, readRunState } from "./run-state.ts";
import { selectIssue, selectIssueWithDiagnostics } from "./selection.ts";
import type {
  AgentIssueConfig,
  AgentIssueVisualEvidence,
  IssueSelectionRejection,
  IssueSummary,
} from "./types.ts";
import {
  lifecycleLabels,
  hasBlockedSavedWorkspaceState,
} from "./pipeline-lifecycle.ts";
import { progress, type PipelineProgressOptions } from "./pipeline-progress.ts";
import { rejectionMessage } from "./pipeline-comments.ts";

export function stringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const entries = value.filter(
    (entry): entry is string => typeof entry === "string",
  );
  return entries.length === value.length ? entries : undefined;
}

export function visualEvidenceArray(
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

export async function emitSelectionDiagnostics(
  rejections: IssueSelectionRejection[],
  options: PipelineProgressOptions,
): Promise<void> {
  for (const rejection of rejections) {
    await progress(
      options,
      "debug",
      "select",
      `skipped #${rejection.issueNumber}: ${rejectionMessage(rejection.reason)}`,
      { issueNumber: rejection.issueNumber, data: rejection },
    );
  }
}

export async function selectResumableIssue(
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
  if (resumable.length > 1)
    throw new Error(
      `Multiple resumable ${inProgress} automation runs found: ${resumable.map((issue) => `#${issue.number}`).join(", ")}`,
    );
  if (config.issueNumber !== undefined) {
    const resumableSelected = resumable.find(
      (issue) => issue.number === config.issueNumber,
    );
    if (resumableSelected) return { issue: resumableSelected, resumed: true };
    if (shouldResume) {
      const explicitIssue = issues.find(
        (candidate) =>
          candidate.number === config.issueNumber && candidate.state === "open",
      );
      const explicitState = explicitIssue
        ? await readRunState(config.runStateDir, explicitIssue.number)
        : undefined;
      if (explicitIssue && hasBlockedSavedWorkspaceState(explicitState)) {
        if (
          resumable.length === 1 &&
          resumable[0]?.number !== explicitIssue.number
        )
          throw new Error(
            `Resumable ${inProgress} automation run #${resumable[0]?.number} exists; resume it before processing #${explicitIssue.number}`,
          );
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
    if (resumable.length === 1 && resumable[0]?.number !== selected.number)
      throw new Error(
        `Resumable ${inProgress} automation run #${resumable[0]?.number} exists; resume it before processing #${selected.number}`,
      );
    return {
      issue: selected,
      resumed: resumable[0]?.number === selected.number,
    };
  }
  if (resumable.length === 1) return { issue: resumable[0], resumed: true };
  const diagnostics = selectIssueWithDiagnostics(issues, {
    issueNumber: config.issueNumber,
    readyLabel: ready,
    triagePolicy: config.triagePolicy,
    approvalPolicy: config.approvalPolicy,
  });
  return diagnostics.issue
    ? { issue: diagnostics.issue, resumed: false }
    : undefined;
}

export function mergeIssueLists(
  primary: IssueSummary[],
  secondary: IssueSummary[],
): IssueSummary[] {
  const issues = new Map<number, IssueSummary>();
  for (const issue of secondary) issues.set(issue.number, issue);
  for (const issue of primary) issues.set(issue.number, issue);
  return [...issues.values()];
}

export async function loadSelectionIssues(
  host: IssueHostProvider,
  config: AgentIssueConfig,
  options: PipelineProgressOptions,
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
