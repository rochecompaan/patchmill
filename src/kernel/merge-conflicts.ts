import fs from "node:fs/promises";
import { basename, join } from "node:path";
import type { Host, PullRequest } from "../host/types.ts";
import { errorMessage } from "./errors.ts";
import type { Facts } from "./facts.ts";
import type { KernelGit, MergeConflict } from "./git.ts";
import { isIssueBranch, parsePlanningBranch } from "./names.ts";
import { ownsPullRequest } from "./pull-request.ts";
import type { TrackedIssue } from "./workflow-state.ts";

export type ConflictCandidate = {
  issue: TrackedIssue;
  pullRequest: PullRequest;
  conflict: MergeConflict;
};

export const ATTEMPT_FILE = "merge-conflict-attempt.json";
type Attempt = {
  runId: string;
  startedAt: string;
  headSha: string;
  baseSha: string;
};

/**
 * The open implementation pull requests of `candidates` that conflict with
 * `origin/<baseBranch>` now, oldest issue first, without those that the
 * attempt record backs off. It never throws; failures are reported.
 */
export async function findConflictingPullRequests(input: {
  host: Pick<Host, "listOpenPullRequests" | "pushRepository">;
  git: Pick<KernelGit, "fetch" | "mergeConflict">;
  /** Issues the caller owns. Local modes: open issues with status `done`. */
  candidates: TrackedIssue[];
  baseBranch: string;
  /** `<runsDir>/issue-N`, where the attempt record lives. */
  issueDir: (issue: number) => string;
  retryMinutes: number;
  now: () => Date;
  report: (line: string) => void;
}): Promise<ConflictCandidate[]> {
  const { candidates, baseBranch, report } = input;
  if (!candidates.length) return [];
  let pulls: PullRequest[];
  let repository: string;
  try {
    await input.git.fetch();
    [pulls, repository] = await Promise.all([
      input.host.listOpenPullRequests(),
      input.host.pushRepository(),
    ]);
  } catch (error) {
    report(`Merge conflict check failed: ${errorMessage(error)}`);
    return [];
  }
  const found: ConflictCandidate[] = [];
  const ordered = [...candidates].sort(
    (a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt),
  );
  for (const issue of ordered) {
    const n = issue.number;
    const ours = pulls.filter(
      (pr) =>
        pr.state === "open" &&
        ownsPullRequest(pr, pr.headBranch, repository) &&
        isIssueBranch(n, pr.headBranch) &&
        parsePlanningBranch(n, pr.headBranch) === undefined &&
        pr.baseBranch === baseBranch,
    );
    if (ours.length > 1) {
      report(
        `Issue #${n} conflict check skipped: several open pull requests: ${ours.map((pr) => `#${pr.number}`).join(", ")}`,
      );
      continue;
    }
    const pullRequest = ours[0];
    if (!pullRequest) continue;
    try {
      const conflict = await input.git.mergeConflict(
        `origin/${baseBranch}`,
        `origin/${pullRequest.headBranch}`,
      );
      if (!conflict) continue;
      const attempt = await readAttempt(input.issueDir(n), report);
      const skip = attempt && backoff(attempt, conflict, input);
      if (skip) {
        report(`Issue #${n} conflict resolution skipped: ${skip}`);
        continue;
      }
      found.push({ issue, pullRequest, conflict });
    } catch (error) {
      report(`Issue #${n} conflict check failed: ${errorMessage(error)}`);
    }
  }
  return found;
}

function backoff(
  attempt: Attempt,
  conflict: MergeConflict,
  input: { retryMinutes: number; now: () => Date },
): string | undefined {
  if (
    attempt.headSha === conflict.headSha &&
    attempt.baseSha === conflict.baseSha
  )
    return `already attempted at head ${short(conflict.headSha)} and base ${short(conflict.baseSha)}`;
  const retry = Date.parse(attempt.startedAt) + input.retryMinutes * 60_000;
  if (input.now().getTime() < retry)
    return `last attempt at ${attempt.startedAt}; retry after ${new Date(retry).toISOString()}`;
  return undefined;
}

/** Writes the last Conflict resolution of an issue: a temporary file, then a rename. */
export async function recordConflictAttempt(
  issueDir: string,
  attempt: { runId: string; startedAt: string; conflict: MergeConflict },
): Promise<void> {
  const record: Attempt = {
    runId: attempt.runId,
    startedAt: attempt.startedAt,
    headSha: attempt.conflict.headSha,
    baseSha: attempt.conflict.baseSha,
  };
  await fs.mkdir(issueDir, { recursive: true });
  const path = join(issueDir, ATTEMPT_FILE);
  const temporary = `${path}.${process.pid}.tmp`;
  await fs.writeFile(temporary, JSON.stringify(record, null, 2) + "\n");
  await fs.rename(temporary, path);
}

/** True when the record names this conflict's head and base. */
export async function isRecordedAttempt(
  issueDir: string,
  conflict: MergeConflict,
  report: (line: string) => void,
): Promise<boolean> {
  const attempt = await readAttempt(issueDir, report);
  return (
    attempt?.headSha === conflict.headSha &&
    attempt.baseSha === conflict.baseSha
  );
}

/** Undefined for a missing record; an unreadable one is reported and missing. */
async function readAttempt(
  issueDir: string,
  report: (line: string) => void,
): Promise<Attempt | undefined> {
  let text: string;
  try {
    text = await fs.readFile(join(issueDir, ATTEMPT_FILE), "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    return unreadable(issueDir, report, error);
  }
  try {
    const value = JSON.parse(text) as Partial<Attempt> | null;
    if (
      typeof value?.runId !== "string" ||
      typeof value.startedAt !== "string" ||
      Number.isNaN(Date.parse(value.startedAt)) ||
      typeof value.headSha !== "string" ||
      typeof value.baseSha !== "string"
    )
      throw new Error("the record has invalid fields");
    return value as Attempt;
  } catch (error) {
    return unreadable(issueDir, report, error);
  }
}

function unreadable(
  issueDir: string,
  report: (line: string) => void,
  error: unknown,
): undefined {
  const issue = /^issue-(\d+)$/.exec(basename(issueDir))?.[1] ?? "?";
  report(
    `Issue #${issue} conflict attempt record is unreadable: ${errorMessage(error)}`,
  );
  return undefined;
}

const short = (sha: string) => sha.slice(0, 7);
const list = (files: string[]) => files.join(", ");

/**
 * Checks that the pushed branch resolved `before`: it merges cleanly, still
 * contains its previous head, and contains the base commit of `before`.
 * Empty when all hold. A missing remote branch skips the ancestry checks,
 * because the pull request checks already report a pull request that is gone.
 */
export async function conflictResolutionGaps(
  git: Pick<KernelGit, "isAncestor">,
  before: MergeConflict,
  after: Facts,
): Promise<string[]> {
  const gaps: string[] = [];
  const base = `origin/${after.baseBranch}`;
  const now = after.mergeConflict;
  if (now)
    gaps.push(
      now.baseSha === before.baseSha
        ? `The pull request still conflicts with ${base} in: ${list(now.files)}.`
        : `The pull request conflicts with ${base} again at ${short(now.baseSha)} in: ${list(now.files)}; the base moved during the session.`,
    );
  if (!after.remoteBranchExists) return gaps;
  const head = `origin/${after.branch}`;
  if (!(await git.isAncestor(before.headSha, head)))
    gaps.push(
      `The pushed branch does not contain its previous head ${short(before.headSha)}; its history was rewritten.`,
    );
  if (!(await git.isAncestor(before.baseSha, head)))
    gaps.push(
      `The pushed branch does not contain ${base} at ${short(before.baseSha)}; merge the base branch.`,
    );
  return gaps;
}
