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
  const laterGate =
    input.facts.stage !== "implementation" &&
    input.facts.branch !== planningBranchName(issue.number, input.facts.stage);
  if (input.uncommitted || (!laterGate && input.unpushed !== 0))
    return {
      kind: "stop" as const,
      label: "needsInfo" as const,
      comment: laterGate
        ? "Commit the approved planning documents before submitting again. Do not push; Patchmill publishes them after approval."
        : "Commit and push the approved planning documents before submitting again.",
      warnings: [],
    };
  if (input.facts.stage !== "implementation") {
    try {
      await git.pushPlanningHead(
        input.facts.worktree,
        laterGate ? input.facts.branch : branchName(issue.number, issue.title),
      );
    } catch (error) {
      const reason = (error instanceof Error ? error.message : String(error))
        .replace(/\s+/g, " ")
        .trim();
      return {
        kind: "stop" as const,
        label: "needsInfo" as const,
        comment: `Could not publish the approved planning head: ${reason}`,
        warnings: [],
      };
    }
  }
  return verified;
}
