import fs from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import {
  artifactFileName,
  isArtifactFile,
  worktreeDirName,
  type ArtifactKind,
} from "./names.ts";
import type { PatchmillConfig } from "../config/config.ts";
import type { Host, Issue, PullRequest } from "../host/types.ts";
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
// Artifacts come from the worktree when it exists, otherwise from the ref
// provisioning would check out, so observing never creates either.
type ArtifactSource = {
  find(directory: string, kind: ArtifactKind): Promise<string | undefined>;
  sameFile(a: string, b: string): Promise<boolean>;
  matchBase(base: string, paths: string[]): Promise<boolean>;
};

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
  const selection = await planningWorkspace(
    host,
    config.workflow,
    issue,
    branches,
    selected,
  );
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
      resolve(worktree, directory, artifactFileName(kind, today, issue.number)),
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

function assertContained(root: string, path: string): void {
  const delta = relative(root, path);
  if (delta === ".." || delta.startsWith(`..${sep}`) || isAbsolute(delta))
    throw new Error(`Artifact directory outside the worktree: ${path}`);
}

function newest(
  names: string[],
  kind: ArtifactKind,
  issue: number,
): string | undefined {
  return names
    .filter((name) => isArtifactFile(kind, issue, name))
    .sort()
    .at(-1);
}

function worktreeArtifacts(
  git: KernelGit,
  worktree: string,
  issue: number,
): ArtifactSource {
  return {
    async find(directory, kind) {
      const path = resolve(worktree, directory);
      assertContained(worktree, path);
      const root = await fs.realpath(worktree);
      try {
        assertContained(root, await fs.realpath(path));
        const entries = await fs.readdir(path, { withFileTypes: true });
        const name = newest(
          entries.filter((entry) => entry.isFile()).map((entry) => entry.name),
          kind,
          issue,
        );
        return name === undefined
          ? undefined
          : relative(worktree, join(path, name));
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT")
          return undefined;
        throw error;
      }
    },
    async sameFile(a, b) {
      const [first, second] = await Promise.all(
        [a, b].map((path) => fs.stat(join(worktree, path))),
      );
      return first!.dev === second!.dev && first!.ino === second!.ino;
    },
    matchBase: (base, paths) =>
      git.baseArtifactsMatch({ worktree }, base, paths),
  };
}

function refArtifacts(
  git: KernelGit,
  worktree: string,
  ref: string,
  issue: number,
): ArtifactSource {
  return {
    async find(directory, kind) {
      const path = resolve(worktree, directory);
      assertContained(worktree, path);
      const tree = relative(worktree, path);
      const name = newest(await git.treeFiles(ref, tree), kind, issue);
      return name === undefined ? undefined : join(tree, name);
    },
    // Git trees cannot hardlink two paths to one file.
    sameFile: async () => false,
    matchBase: (base, paths) => git.baseArtifactsMatch({ ref }, base, paths),
  };
}
