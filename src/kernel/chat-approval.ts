import type { Issue } from "../host/types.ts";
import type { KernelGit } from "./git.ts";
import type { PhaseRun } from "./launch.ts";
import { branchName, planningBranchName } from "./names.ts";
import { verifyOutcome, type VerifyInput } from "./verify.ts";

/** Approval is a live, confirmed action. Only pushed git facts survive it. */
export async function verifyPlanningApproval(
  input: VerifyInput,
  run: PhaseRun,
  human: boolean,
  git: KernelGit,
  issue: Issue,
) {
  const chatApproval =
    human && input.phase === "planning" && run.planningApproval === "no-pr";
  const verified = verifyOutcome({ ...input, chatApproval });
  if (
    human &&
    run.planningApproval === "pr" &&
    verified.kind === "stop" &&
    verified.label === "needsInfo"
  )
    return {
      ...verified,
      comment: `The maintainer chose PR. ${verified.comment}`,
    };
  if (!chatApproval || verified.kind !== "advance") return verified;
  if (input.uncommitted || input.unpushed !== 0)
    return {
      kind: "stop" as const,
      label: "needsInfo" as const,
      comment:
        "Commit and push the approved planning documents before submitting again.",
      warnings: [],
    };
  if (
    input.facts.stage !== "implementation" &&
    input.facts.branch === planningBranchName(issue.number, input.facts.stage)
  )
    await git.pushPlanningHead(
      input.facts.worktree,
      branchName(issue.number, issue.title),
    );
  return verified;
}
