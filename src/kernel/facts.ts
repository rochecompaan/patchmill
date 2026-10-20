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

function assertContained(root: string, path: string): void {
  const delta = relative(root, path);
  if (delta === ".." || delta.startsWith(`..${sep}`) || isAbsolute(delta))
    throw new Error(`Artifact directory outside the worktree: ${path}`);
}

async function findArtifact(
  worktree: string,
  directory: string,
  kind: ArtifactKind,
  issue: number,
): Promise<string | undefined> {
  const path = resolve(worktree, directory);
  assertContained(worktree, path);
  const root = await fs.realpath(worktree);
  try {
    assertContained(root, await fs.realpath(path));
    const entries = await fs.readdir(path, { withFileTypes: true });
    const name = entries
      .filter(
        (entry) => entry.isFile() && isArtifactFile(kind, issue, entry.name),
      )
      .map((entry) => entry.name)
      .sort()
      .at(-1);
    return name === undefined
      ? undefined
      : relative(worktree, join(path, name));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

export async function collectFacts(
  deps: {
    git: KernelGit;
    host: Host;
    config: PatchmillConfig;
    repoRoot: string;
    now: () => Date;
  },
  issue: Issue,
  selected?: Pick<Facts, "stage" | "branch">,
): Promise<FactsResult> {
  const { git, host, config, repoRoot, now } = deps;
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
  const { stage, branch, pullRequest, merged } = selection.workspace;
  const remoteBranchExists = branches.includes(branch);
  const worktree = resolve(
    repoRoot,
    config.paths.worktreeDir,
    worktreeDirName(branch),
  );
  await git.ensureWorktree({
    path: worktree,
    branch,
    base: baseBranch,
    remoteExists: remoteBranchExists,
  });
  const today = now();
  const expectedPath = (directory: string, kind: ArtifactKind) =>
    relative(
      worktree,
      resolve(worktree, directory, artifactFileName(kind, today, issue.number)),
    );
  const specPath = await findArtifact(
    worktree,
    config.paths.specsDir,
    "spec",
    issue.number,
  );
  let planPath = await findArtifact(
    worktree,
    config.paths.plansDir,
    "plan",
    issue.number,
  );
  // A hardlink would otherwise let one document satisfy both gates.
  if (specPath && planPath) {
    const spec = await fs.stat(join(worktree, specPath));
    const plan = await fs.stat(join(worktree, planPath));
    if (spec.dev === plan.dev && spec.ino === plan.ino) planPath = undefined;
  }
  if (merged.length > 0) {
    const required = merged.includes("plan")
      ? [specPath, planPath]
      : [specPath];
    if (
      !required.every((path) => path !== undefined) ||
      !(await git.baseArtifactsMatch(worktree, baseBranch, required))
    )
      throw new Error(
        `A merged planning PR's artifact is missing from, or differs from, base ${baseBranch}. Reconcile the merged documents before continuing.`,
      );
  }
  return {
    kind: "facts",
    facts: {
      stage,
      branch,
      remoteBranchExists,
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
