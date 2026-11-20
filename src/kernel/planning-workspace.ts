import type { PatchmillConfig } from "../config/config.ts";
import type { Host, Issue, PullRequest } from "../host/types.ts";
import {
  branchName,
  parsePlanningBranch,
  planningBranchName,
  slugify,
  type ArtifactKind,
} from "./names.ts";
import { findPullRequest, wrongTarget } from "./pull-request.ts";

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

type StageBranch = { branch: string; pullRequest?: PullRequest | undefined };

/**
 * Gate heads are stable across title edits and deletion of merged branches.
 * A planning branch keeps the slug it was created with: Patchmill finds it
 * again through remote branches, the other stage's slug, and the slugs of
 * the issue's artifacts on the base branch, never only through the title.
 */
export async function planningWorkspace(input: {
  host: Host;
  workflow: PatchmillConfig["workflow"];
  issue: Issue;
  branches: string[];
  baseBranch: string;
  /** Valid slugs of the newest spec and plan artifacts on base, spec first. */
  baseSlugs: string[];
  selected?: Pick<PlanningWorkspace, "stage" | "branch"> | undefined;
  implementationArtifacts?: Partial<Record<"spec" | "plan", boolean>>;
}): Promise<WorkspaceResult> {
  const { host, workflow, issue, branches, baseBranch, selected } = input;
  const pullRequest = (branch: string) =>
    findPullRequest(host, branch, baseBranch);
  const planningBranches = (stage: ArtifactKind) =>
    branches.filter(
      (b) => parsePlanningBranch(issue.number, b)?.stage === stage,
    );
  const implementation = branches.filter(
    (b) => parsePlanningBranch(issue.number, b) === undefined,
  );
  if (implementation.length > 1)
    return { kind: "ambiguous-branches", branches: implementation };
  for (const stage of ["spec", "plan"] as const) {
    const found = planningBranches(stage);
    if (found.length > 1)
      return { kind: "ambiguous-branches", branches: found };
  }
  const merged: PlanningWorkspace["merged"] = [];
  let chatApproved = false;
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
      await pullRequest(selected.branch),
    );
  const stageBranch = async (stage: ArtifactKind): Promise<StageBranch> => {
    const [existing] = planningBranches(stage);
    if (existing)
      return { branch: existing, pullRequest: await pullRequest(existing) };
    const otherSlugs = planningBranches(stage === "spec" ? "plan" : "spec").map(
      (b) => parsePlanningBranch(issue.number, b)!.slug,
    );
    const titleSlug = slugify(issue.title);
    const candidates = [
      ...new Set([...otherSlugs, ...input.baseSlugs, titleSlug, ""]),
    ].map((slug) => planningBranchName(issue.number, stage, slug));
    const found = await Promise.all(candidates.map(pullRequest));
    for (const state of ["open", "merged", "closed"] as const) {
      const index = found.findIndex((pr) => pr?.state === state);
      if (index >= 0)
        return { branch: candidates[index]!, pullRequest: found[index] };
    }
    const slug =
      [...otherSlugs, ...input.baseSlugs, titleSlug].find((s) => s !== "") ??
      "";
    return { branch: planningBranchName(issue.number, stage, slug) };
  };
  for (const [stage, required] of [
    ["spec", workflow.specApproval.required],
    ["plan", workflow.planApproval.required],
  ] as const) {
    if (!required) continue;
    const { branch, pullRequest: pr } = await stageBranch(stage);
    // A merge into another branch stays at this gate; derivePhase reports it.
    if (pr?.state === "merged" && !wrongTarget(pr, baseBranch)) {
      merged.push(stage);
    } else if (input.implementationArtifacts?.[stage]) {
      chatApproved = true;
    } else {
      return chatApproved
        ? workspace(stage, implementation[0]!)
        : workspace(stage, branch, pr);
    }
  }
  const branch = implementation[0] ?? branchName(issue.number, issue.title);
  return workspace("implementation", branch, await pullRequest(branch));
}
