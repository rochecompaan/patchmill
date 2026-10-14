import type { CommandRunner } from "../../../command/types.ts";
import type {
  ImplementationBranchPushedPlanningPhase,
  ImplementationPullRequestOpenPlanningPhase,
  ImplementationRevalidationPendingPlanningPhase,
} from "../../../workflow/planning-state-types.ts";
import { implementationRecoveryReceipt } from "../../../workflow/planning-state-implementation-revalidation.ts";
import type { PlanningImplementationInput } from "./planning-implementation.ts";

export function invalidateImplementationChecks(
  phase:
    | ImplementationBranchPushedPlanningPhase
    | ImplementationPullRequestOpenPlanningPhase,
): ImplementationRevalidationPendingPlanningPhase {
  return {
    kind: "implementation",
    status: "revalidation-pending",
    base: phase.base,
    workspace: phase.workspace,
    artifacts: phase.artifacts,
    revalidation: implementationRecoveryReceipt(phase),
  };
}

/** A preserved local branch can move before its PR is pushed. */
export async function implementationChecksChanged(input: {
  runner: CommandRunner;
  repoRoot: string;
  branch: string;
  savedHeadOid: string | undefined;
  remoteHeadOid: string;
}): Promise<boolean> {
  if (input.remoteHeadOid !== input.savedHeadOid) return true;
  const head = await input.runner.run(
    "git",
    ["rev-parse", "--verify", `refs/heads/${input.branch}^{commit}`],
    { cwd: input.repoRoot },
  );
  return (
    head.code === 0 &&
    /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u.test(head.stdout.trim()) &&
    head.stdout.trim() !== input.savedHeadOid
  );
}

/** Changed publication heads need fresh agents, not a replay of old checks. */
export async function changedImplementationPublication(
  input: Pick<PlanningImplementationInput, "workspaces" | "git">,
  phase: ImplementationBranchPushedPlanningPhase,
): Promise<ImplementationRevalidationPendingPlanningPhase | undefined> {
  const snapshot = await input.workspaces.inspect(phase.workspace.identity);
  if (snapshot.state !== "ready") return invalidateImplementationChecks(phase);
  const remote = await input.git.inspectRemoteHead({
    remote: phase.base.remote,
    branch: phase.workspace.identity.branch,
  });
  if (
    snapshot.headOid === phase.publication.headOid &&
    (remote.state !== "present" || remote.headOid === phase.publication.headOid)
  )
    return undefined;
  return invalidateImplementationChecks(phase);
}
