import type { IssueHostProvider } from "../../../host/types.ts";
import type { PatchmillTriageStateMap } from "../../../policy/triage-state.ts";
import {
  createUnblockedComment,
  replaceTriageStateLabels,
  resolveBlockedIssue,
} from "./blocked.ts";
import type { IssueSummary, TriageLogIssueEntry } from "./types.ts";

export type AutoUnblockContext = {
  issue: IssueSummary;
  blockedBy: number[];
  comment: string;
  finalLabels: string[];
};

export type BlockedPreprocessResult = {
  agentIssues: IssueSummary[];
  directEntries: TriageLogIssueEntry[];
};

type BlockedPreprocessOptions = {
  issues: IssueSummary[];
  host: Pick<IssueHostProvider, "viewIssue" | "trustedTriageCommentAuthors">;
  stateMap: PatchmillTriageStateMap;
  readyLabel: string;
  mutationStatus: "preview" | "observed";
  isBlockedIssue(issue: IssueSummary): boolean;
  onAutoUnblocked?: (
    context: AutoUnblockContext,
  ) => Promise<Partial<TriageLogIssueEntry> | void>;
  onDirectEntry?: (entry: TriageLogIssueEntry) => void;
};

function issueRefList(issueNumbers: readonly number[]): string {
  return issueNumbers.map((issueNumber) => `#${issueNumber}`).join(", ");
}

function autoUnblockEntry(
  issue: IssueSummary,
  stateMap: PatchmillTriageStateMap,
  readyLabel: string,
  blockedBy: number[],
  mutationStatus: "preview" | "observed",
  extra: Partial<TriageLogIssueEntry> = {},
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
    ...(mutationStatus === "preview" ? { wouldClose: false } : {}),
    mutationStatus,
    ...extra,
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

export async function preprocessBlockedIssues(
  options: BlockedPreprocessOptions,
): Promise<BlockedPreprocessResult> {
  const agentIssues: IssueSummary[] = [];
  const directEntries: TriageLogIssueEntry[] = [];
  let trustedCommentAuthors: string[] | undefined;

  async function trustedAuthors(): Promise<string[]> {
    trustedCommentAuthors ??= await options.host.trustedTriageCommentAuthors();
    return trustedCommentAuthors;
  }

  async function addDirectEntry(
    entry: TriageLogIssueEntry,
  ): Promise<TriageLogIssueEntry> {
    directEntries.push(entry);
    options.onDirectEntry?.(entry);
    return entry;
  }

  for (const issue of options.issues) {
    if (!options.isBlockedIssue(issue)) {
      agentIssues.push(issue);
      continue;
    }

    const resolution = await resolveBlockedIssue(
      options.host,
      issue,
      await trustedAuthors(),
    );

    if (resolution.status === "unblocked") {
      const comment = createUnblockedComment(resolution.blockedBy);
      const finalLabels = replaceTriageStateLabels(
        issue.labels,
        options.stateMap,
        options.readyLabel,
      );
      const extra = await options.onAutoUnblocked?.({
        issue,
        blockedBy: resolution.blockedBy,
        comment,
        finalLabels,
      });
      await addDirectEntry(
        autoUnblockEntry(
          issue,
          options.stateMap,
          options.readyLabel,
          resolution.blockedBy,
          options.mutationStatus,
          extra ?? {},
        ),
      );
      continue;
    }

    if (resolution.status === "still-blocked") {
      await addDirectEntry(
        stillBlockedEntry(
          issue,
          resolution.blockedBy,
          resolution.openBlockers,
          options.mutationStatus,
        ),
      );
      continue;
    }

    agentIssues.push(issue);
  }

  return { agentIssues, directEntries };
}
