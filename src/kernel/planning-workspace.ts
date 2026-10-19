import type { PatchmillConfig } from "../config/config.ts";
import type { Host, Issue, PullRequest } from "../host/types.ts";
import { branchName } from "./names.ts";

export type WorkflowStage = "spec" | "plan" | "implementation";
export type PlanningWorkspace = {
  stage: WorkflowStage;
  branch: string;
  pullRequest?: PullRequest;
  merged: ("spec" | "plan")[];
};
export type WorkspaceResult =
  | { kind: "workspace"; workspace: PlanningWorkspace }
  | { kind: "ambiguous-branches"; branches: string[] };

/** Gate heads are stable across title edits and deletion of merged branches. */
export async function planningWorkspace(
  host: Host,
  workflow: PatchmillConfig["workflow"],
  issue: Issue,
  branches: string[],
  selected?: Pick<PlanningWorkspace, "stage" | "branch">,
): Promise<WorkspaceResult> {
  const specBranch = `agent/issue-${issue.number}--spec`;
  const planBranch = `agent/issue-${issue.number}--plan`;
  const implementation = branches.filter(
    (b) => b !== specBranch && b !== planBranch,
  );
  if (implementation.length > 1)
    return { kind: "ambiguous-branches", branches: implementation };
  const merged: PlanningWorkspace["merged"] = [];
  const workspace = async (
    stage: WorkflowStage,
    branch: string,
    pr?: PullRequest,
  ): Promise<WorkspaceResult> => ({
    kind: "workspace",
    workspace: { stage, branch, merged, ...(pr ? { pullRequest: pr } : {}) },
  });
  // Post-session verification must inspect the same head the agent was given,
  // not silently switch to a later branch if a PR merged during its session.
  if (selected)
    return workspace(
      selected.stage,
      selected.branch,
      await host.findPullRequestByHead(selected.branch),
    );
  for (const [stage, required, branch] of [
    ["spec", workflow.specApproval.required, specBranch],
    ["plan", workflow.planApproval.required, planBranch],
  ] as const) {
    if (!required) continue;
    const pr = await host.findPullRequestByHead(branch);
    if (pr?.state !== "merged") return workspace(stage, branch, pr);
    merged.push(stage);
  }
  const branch = implementation[0] ?? branchName(issue.number, issue.title);
  return workspace(
    "implementation",
    branch,
    await host.findPullRequestByHead(branch),
  );
}
