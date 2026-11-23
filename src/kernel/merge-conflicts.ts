import type { Facts } from "./facts.ts";
import type { KernelGit, MergeConflict } from "./git.ts";

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
