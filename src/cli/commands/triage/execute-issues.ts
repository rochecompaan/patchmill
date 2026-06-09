import type { PatchmillHostConfig } from "../../../config/types.ts";
import {
  canonicalBucketForLabels,
  type PatchmillTriageStateMap,
} from "../../../policy/triage-state.ts";
import type { PatchmillProjectPolicy } from "../../../policy/types.ts";
import type { IssueHostProvider } from "../../../host/types.ts";
import type { PatchmillSkillsConfig } from "../../../workflow/skills.ts";
import { runTriageExecuteAgent } from "./execute-agent.ts";
import { createObservedChangeEntries } from "./reporting.ts";
import type {
  CommandRunner,
  IssueSummary,
  TriageLogIssueEntry,
  TriageToolCallHandler,
} from "./types.ts";

export type ExecuteTriageIssuesOptions = {
  runner: CommandRunner;
  repoRoot: string;
  host: Pick<
    IssueHostProvider,
    "viewIssue" | "hydrateIssueComments" | "trustedTriageCommentAuthors"
  >;
  hostConfig: PatchmillHostConfig;
  issues: IssueSummary[];
  projectPolicy: PatchmillProjectPolicy;
  stateMap: PatchmillTriageStateMap;
  skills: PatchmillSkillsConfig;
  thinking: string;
  onToolCall?: TriageToolCallHandler;
  onIssue?: (
    entry: TriageLogIssueEntry,
    completed: number,
    total: number,
  ) => void;
};

function cloneIssue(issue: IssueSummary): IssueSummary {
  return {
    ...issue,
    labels: [...issue.labels],
    comments: Array.isArray(issue.comments)
      ? [...issue.comments]
      : issue.comments,
  };
}

async function snapshotIssue(
  host: Pick<IssueHostProvider, "viewIssue" | "hydrateIssueComments">,
  issueNumber: number,
): Promise<IssueSummary> {
  const afterIssue = await host.viewIssue(issueNumber);
  if (afterIssue.number !== issueNumber) {
    throw new Error(
      `Issue snapshot for #${issueNumber} returned issue #${afterIssue.number}`,
    );
  }
  await host.hydrateIssueComments([afterIssue]);
  return afterIssue;
}

export async function executeTriageIssues(
  options: ExecuteTriageIssuesOptions,
): Promise<TriageLogIssueEntry[]> {
  const beforeIssues = options.issues.map(cloneIssue);
  const entries: TriageLogIssueEntry[] = [];
  let trustedCommentAuthors: string[] | undefined;

  async function trustedAuthorsForBlockedIssue(
    issue: IssueSummary,
  ): Promise<readonly string[]> {
    if (
      canonicalBucketForLabels(issue.labels, options.stateMap) !== "blocked"
    ) {
      return [];
    }
    trustedCommentAuthors ??= await options.host.trustedTriageCommentAuthors();
    return trustedCommentAuthors;
  }

  for (const [index, beforeIssue] of beforeIssues.entries()) {
    await runTriageExecuteAgent(options.runner, options.repoRoot, {
      issues: [beforeIssue],
      projectPolicy: options.projectPolicy,
      stateMap: options.stateMap,
      host: options.hostConfig,
      skills: options.skills,
      thinking: options.thinking,
      onToolCall: options.onToolCall,
    });

    const afterIssue = await snapshotIssue(options.host, beforeIssue.number);
    const [entry] = createObservedChangeEntries(
      [beforeIssue],
      [afterIssue],
      options.stateMap,
      await trustedAuthorsForBlockedIssue(afterIssue),
    );
    if (!entry) {
      throw new Error(
        `No observed change entry for issue #${beforeIssue.number}`,
      );
    }

    entries.push(entry);
    options.onIssue?.(entry, index + 1, beforeIssues.length);
  }

  return entries;
}
