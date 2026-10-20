import type { Host, PullRequest } from "../host/types.ts";

/**
 * The one rule for which pull request belongs to an issue branch: its head is
 * that branch in the repository Patchmill pushes to. Head commits are not part
 * of the identity, so later pushes keep the same pull request. Open beats
 * merged beats closed; within a state, a pull request into the base wins, so a
 * replacement for a mistargeted one is found. Callers still check the target
 * with wrongTarget, because a mistargeted pull request needs a person.
 */
export async function findPullRequest(
  host: Host,
  branch: string,
  baseBranch: string,
): Promise<PullRequest | undefined> {
  const [repository, candidates] = await Promise.all([
    host.pushRepository(),
    host.listPullRequests(branch),
  ]);
  const ours = candidates.filter(
    (pr) =>
      pr.headBranch === branch &&
      pr.headRepository?.toLowerCase() === repository.toLowerCase(),
  );
  for (const state of ["open", "merged", "closed"] as const) {
    const inState = ours.filter((pr) => pr.state === state);
    const found =
      inState.find((pr) => pr.baseBranch === baseBranch) ?? inState[0];
    if (found) return found;
  }
  return undefined;
}

/** An open or merged pull request into another branch can neither pass a gate nor finish the issue. */
export function wrongTarget(pr: PullRequest, baseBranch: string): boolean {
  return pr.state !== "closed" && pr.baseBranch !== baseBranch;
}
