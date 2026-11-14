import { resolve, join } from "node:path";
import { readCleanupReceipt } from "./cleanup-state.ts";
import { cleanupGit, readCleanupWorktrees } from "./cleanup-workspaces.ts";
import { errorMessage } from "./errors.ts";
import { acquireLock, LockHeldError, type IssueLock } from "./lock.ts";
import {
  cleanupMergedIssue,
  type CleanupCandidate,
  type CleanupServices,
} from "./merged-cleanup.ts";
import { planningBranchName } from "./names.ts";

type DiscoveryInput = Pick<
  CleanupServices,
  "config" | "runner" | "repoRoot" | "report"
>;
/** Local observations are hints only; locked cleanup verifies the host again. */
export async function discoverCleanupCandidates(
  input: DiscoveryInput,
): Promise<CleanupCandidate[]> {
  const git = cleanupGit(input.runner, input.repoRoot);
  const heads = (
    await git(["for-each-ref", "--format=%(refname:short)", "refs/heads"])
  )
    .trim()
    .split("\n");
  const worktrees = await readCleanupWorktrees(git);
  const groups = new Map<number, Set<string>>();
  for (const branch of new Set([
    ...heads,
    ...worktrees.flatMap((workspace) =>
      workspace.branch ? [workspace.branch] : [],
    ),
  ])) {
    const match = /^agent\/issue-([1-9]\d*)(?:-(.*))?$/.exec(branch);
    if (!match) continue;
    const issue = Number(match[1]);
    const slug = match[2];
    if (
      !Number.isSafeInteger(issue) ||
      (slug !== undefined &&
        slug !== "-spec" &&
        slug !== "-plan" &&
        (slug.length > 48 || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)))
    )
      continue;
    const group = groups.get(issue) ?? new Set<string>();
    group.add(branch);
    groups.set(issue, group);
  }
  const result: CleanupCandidate[] = [];
  for (const [issue, branches] of [...groups].sort(([a], [b]) => a - b)) {
    const implementation = [...branches].filter(
      (branch) =>
        branch !== planningBranchName(issue, "spec") &&
        branch !== planningBranchName(issue, "plan"),
    );
    if (implementation.length > 1) {
      input.report(
        `Issue #${issue} cleanup skipped: several implementation branches exist: ${implementation.join(", ")}`,
      );
      continue;
    }
    if (implementation.length === 1) {
      result.push({ issue, branch: implementation[0]! });
      continue;
    }
    try {
      const receipt = await readCleanupReceipt(
        resolve(input.repoRoot, input.config.paths.runsDir, `issue-${issue}`),
      );
      if (!receipt) continue;
      if (receipt.identity.issue !== issue)
        throw new Error("Cleanup receipt belongs to another issue.");
      result.push({ issue, branch: receipt.identity.branch });
    } catch (error) {
      input.report(
        `Issue #${issue} cleanup discovery failed: ${errorMessage(error)}`,
      );
    }
  }
  return result;
}

export async function sweepMergedIssues(input: CleanupServices): Promise<void> {
  if (input.signal?.aborted) return;
  let candidates: CleanupCandidate[];
  try {
    candidates = await discoverCleanupCandidates(input);
  } catch (error) {
    input.report(
      `Merged issue cleanup discovery failed: ${errorMessage(error)}`,
    );
    return;
  }
  for (const candidate of candidates) {
    if (input.signal?.aborted) return;
    let lock: IssueLock | undefined;
    try {
      lock = await acquireLock(
        join(
          resolve(input.repoRoot, input.config.paths.runsDir),
          `issue-${candidate.issue}`,
          "lock",
        ),
        { now: input.now },
      );
      await cleanupMergedIssue({ ...input, ...candidate, lock });
    } catch (error) {
      input.report(
        `Issue #${candidate.issue} cleanup ${error instanceof LockHeldError ? "skipped (active issue lock)" : "failed"}: ${errorMessage(error)}`,
      );
    } finally {
      try {
        await lock?.release();
      } catch (error) {
        input.report(
          `Issue #${candidate.issue} cleanup lock release failed: ${errorMessage(error)}`,
        );
      }
    }
  }
}
