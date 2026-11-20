import type { PatchmillConfig } from "../config/config.ts";
import type { Issue } from "../host/types.ts";
import { refArtifacts } from "./artifact-source.ts";
import type { Facts } from "./facts.ts";
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
  const stage = input.facts.stage;
  const implementation = stage === "implementation";
  const laterGate =
    stage !== "implementation" &&
    input.facts.branch !== planningBranchName(issue.number, stage);
  const held = laterGate || implementation;
  if (input.uncommitted || (!held && input.unpushed !== 0))
    return {
      kind: "stop" as const,
      label: "needsInfo" as const,
      comment: held
        ? "Commit the approved planning documents before submitting again. Do not push; Patchmill publishes them after approval."
        : "Commit and push the approved planning documents before submitting again.",
      warnings: [],
    };
  try {
    await git.pushPlanningHead(
      input.facts.worktree,
      held ? input.facts.branch : branchName(issue.number, issue.title),
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
  return verified;
}

/**
 * In an interactive run, the spec and plan are reviewed once they are pushed:
 * Patchmill pushes them only after the maintainer confirms. Local documents,
 * committed or not, are drafts left by a pause and go back to planning.
 */
export async function reviewedDocuments(
  git: KernelGit,
  config: Pick<PatchmillConfig, "paths">,
  facts: Facts,
  issue: number,
): Promise<boolean> {
  const ref = `origin/${facts.remoteBranchExists ? facts.branch : facts.baseBranch}`;
  const pushed = refArtifacts(git, facts.worktree, ref, issue);
  return (
    !!(await pushed.find(config.paths.specsDir, "spec")) &&
    !!(await pushed.find(config.paths.plansDir, "plan"))
  );
}
