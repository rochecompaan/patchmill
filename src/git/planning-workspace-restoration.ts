import type { PlanningWorkspaceRepositoryGit } from "./planning-workspace-inspection.ts";
import { planningOid } from "./planning-git-validation.ts";
import {
  PlanningWorkspaceConflictError,
  type PlanningWorkspaceLifecycle,
} from "./planning-workspaces.ts";

/** Restore only the saved implementation branch; never reset surviving local work. */
export async function restorePlanningImplementationWorkspace(
  repository: PlanningWorkspaceRepositoryGit,
  input: Parameters<PlanningWorkspaceLifecycle["resume"]>[0],
) {
  const conflict = (
    reason: ConstructorParameters<typeof PlanningWorkspaceConflictError>[0],
  ): never => {
    throw new PlanningWorkspaceConflictError(reason, input.identity);
  };
  const restoreHeadOid = input.restoreHeadOid;
  if (
    input.phase !== "implementation" ||
    !restoreHeadOid ||
    !planningOid.test(restoreHeadOid)
  )
    return conflict("invalid-saved-identity");
  const path = repository.path(input.identity);
  const before = await repository.inspect(input.identity);
  if (before.state === "ready") return before;
  if (await repository.existing(path)) conflict("path-collision");
  await repository.run(
    [
      "fetch",
      "--no-tags",
      input.saved.remote,
      `refs/heads/${input.identity.branch}`,
    ],
    "fetch",
  );
  const fetched = await repository.run(
    ["rev-parse", "--verify", "FETCH_HEAD^{commit}"],
    "ref-resolution",
  );
  if (fetched.stdout.trim() !== restoreHeadOid)
    conflict("remote-head-mismatch");
  const ancestry = await repository.runner.run(
    "git",
    ["merge-base", "--is-ancestor", input.saved.baseOid, restoreHeadOid],
    { cwd: repository.repoRoot },
  );
  if (ancestry.code !== 0) conflict("base-oid-mismatch");
  const latest = await repository.inspect(input.identity);
  if (
    latest.state === "ready" ||
    latest.state !== before.state ||
    (latest.state === "branch-only" && latest.headOid !== restoreHeadOid)
  )
    conflict("remote-head-mismatch");
  if (await repository.existing(path)) conflict("path-collision");
  await repository.run(
    latest.state === "branch-only"
      ? ["worktree", "add", "--", path, input.identity.branch]
      : [
          "worktree",
          "add",
          "-b",
          input.identity.branch,
          "--",
          path,
          restoreHeadOid,
        ],
    "worktree-add",
  );
  const restored = await repository.inspect(input.identity);
  if (restored.state !== "ready" || restored.headOid !== restoreHeadOid)
    conflict("head-oid-mismatch");
  return restored;
}
