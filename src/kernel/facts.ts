import { relative, resolve } from "node:path";
import {
  artifactFileName,
  worktreeDirName,
  type ArtifactKind,
  planningBranchName,
} from "./names.ts";
import type { PatchmillConfig } from "../config/config.ts";
import type { Host, Issue, PullRequest } from "../host/types.ts";
import { refArtifacts, worktreeArtifacts } from "./artifact-source.ts";
import type { KernelGit } from "./git.ts";
import { planningWorkspace, type WorkflowStage } from "./planning-workspace.ts";

export type Facts = {
  stage: WorkflowStage;
  branch: string;
  remoteBranchExists: boolean;
  worktree: string;
  baseBranch: string;
  specPath?: string;
  planPath?: string;
  expectedSpecPath: string;
  expectedPlanPath: string;
  pullRequest?: PullRequest;
};
export type FactsResult =
  | { kind: "facts"; facts: Facts }
  | { kind: "ambiguous-branches"; branches: string[] };

type Deps = {
  git: KernelGit;
  host: Host;
  config: PatchmillConfig;
  repoRoot: string;
  now: () => Date;
};
type Workspace = Pick<
  Facts,
  | "stage"
  | "branch"
  | "remoteBranchExists"
  | "worktree"
  | "baseBranch"
  | "pullRequest"
> & { merged: ("spec" | "plan")[] };
type WorkspaceResult =
  | { kind: "workspace"; workspace: Workspace }
  | { kind: "ambiguous-branches"; branches: string[] };
/** Observes facts without creating branches or worktrees. */
export async function collectFacts(
  deps: Deps,
  issue: Issue,
  selected?: Pick<Facts, "stage" | "branch">,
): Promise<FactsResult> {
  const selection = await selectWorkspace(deps, issue, selected);
  if (selection.kind === "ambiguous-branches") return selection;
  return observe(deps, issue, selection.workspace);
}

/** Creates the selected worktree, then observes it. Hold the issue lock. */
export async function provisionWorkspace(
  deps: Deps,
  issue: Issue,
): Promise<FactsResult> {
  const selection = await selectWorkspace(deps, issue);
  if (selection.kind === "ambiguous-branches") return selection;
  await deps.git.ensureWorktree(worktreeInput(selection.workspace));
  return observe(deps, issue, selection.workspace);
}

async function selectWorkspace(
  deps: Deps,
  issue: Issue,
  selected?: Pick<Facts, "stage" | "branch">,
): Promise<WorkspaceResult> {
  const { git, host, config, repoRoot } = deps;
  await git.fetch();
  const baseBranch =
    config.git.baseBranch ??
    (await git.remoteDefaultBranch()) ??
    (await host.repository()).defaultBranch;
  const branches = await git.remoteBranches(issue.number);
  const implementation = branches.filter(
    (branch) =>
      !["spec", "plan"].some(
        (stage) =>
          branch === planningBranchName(issue.number, stage as ArtifactKind),
      ),
  );
  const approved =
    implementation.length === 1
      ? refArtifacts(git, repoRoot, `origin/${implementation[0]}`, issue.number)
      : undefined;
  const selection = await planningWorkspace({
    host,
    workflow: config.workflow,
    issue,
    branches,
    baseBranch,
    selected,
    implementationArtifacts: {
      spec: !!(await approved?.find(config.paths.specsDir, "spec")),
      plan: !!(await approved?.find(config.paths.plansDir, "plan")),
    },
  });
  if (selection.kind === "ambiguous-branches") return selection;
  const { branch } = selection.workspace;
  return {
    kind: "workspace",
    workspace: {
      ...selection.workspace,
      remoteBranchExists: branches.includes(branch),
      worktree: resolve(
        repoRoot,
        config.paths.worktreeDir,
        worktreeDirName(branch),
      ),
      baseBranch,
    },
  };
}

function worktreeInput(workspace: Workspace) {
  return {
    path: workspace.worktree,
    branch: workspace.branch,
    base: workspace.baseBranch,
    remoteExists: workspace.remoteBranchExists,
  };
}

async function observe(
  deps: Deps,
  issue: Issue,
  workspace: Workspace,
): Promise<FactsResult> {
  const { git, config, now } = deps;
  const { merged, worktree, baseBranch, pullRequest, ...rest } = workspace;
  const source = await git.workspaceSource(worktreeInput(workspace));
  const artifacts =
    source.kind === "worktree"
      ? worktreeArtifacts(git, worktree, issue.number)
      : refArtifacts(git, worktree, source.ref, issue.number);
  const today = now();
  const expectedPath = (directory: string, kind: ArtifactKind) =>
    relative(
      worktree,
      resolve(
        worktree,
        directory,
        artifactFileName(kind, today, issue.number, issue.title),
      ),
    );
  const specPath = await artifacts.find(config.paths.specsDir, "spec");
  let planPath = await artifacts.find(config.paths.plansDir, "plan");
  // A hardlink would otherwise let one document satisfy both gates.
  if (specPath && planPath && (await artifacts.sameFile(specPath, planPath)))
    planPath = undefined;
  if (merged.length > 0) {
    const required = merged.includes("plan")
      ? [specPath, planPath]
      : [specPath];
    if (
      !required.every((path) => path !== undefined) ||
      !(await artifacts.matchBase(baseBranch, required))
    )
      throw new Error(
        `A merged planning PR's artifact is missing from, or differs from, base ${baseBranch}. Reconcile the merged documents before continuing.`,
      );
  }
  return {
    kind: "facts",
    facts: {
      ...rest,
      worktree,
      baseBranch,
      ...(specPath === undefined ? {} : { specPath }),
      ...(planPath === undefined ? {} : { planPath }),
      expectedSpecPath: expectedPath(config.paths.specsDir, "spec"),
      expectedPlanPath: expectedPath(config.paths.plansDir, "plan"),
      ...(pullRequest === undefined ? {} : { pullRequest }),
    },
  };
}
