import fs from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import {
  branchName,
  isPlanFile,
  isSpecFile,
  planFileName,
  specFileName,
  worktreeDirName,
} from "./names.ts";
import type { PatchmillConfig } from "../config/config.ts";
import type { Host, Issue, PullRequest } from "../host/types.ts";
import type { KernelGit } from "./git.ts";

export type Facts = {
  branch: string;
  remoteBranchExists: boolean;
  worktree: string;
  baseBranch: string;
  specPath?: string;
  planPath?: string;
  expectedSpecPath: string;
  expectedPlanPath: string;
  specApproved: boolean;
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
  matches: (name: string) => boolean,
): Promise<string | undefined> {
  const path = resolve(worktree, directory);
  assertContained(worktree, path);
  const root = await fs.realpath(worktree);
  try {
    assertContained(root, await fs.realpath(path));
    const entries = await fs.readdir(path, { withFileTypes: true });
    const name = entries
      .filter((entry) => entry.isFile() && matches(entry.name))
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
): Promise<FactsResult> {
  const { git, host, config, repoRoot, now } = deps;
  await git.fetch();
  const baseBranch =
    config.git.baseBranch ??
    (await git.remoteDefaultBranch()) ??
    (await host.repository()).defaultBranch;
  const branches = await git.remoteBranches(issue.number);
  if (branches.length > 1) return { kind: "ambiguous-branches", branches };
  const branch = branches[0] ?? branchName(issue.number, issue.title);
  const remoteBranchExists = branches.length === 1;
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
  const specName = specFileName(today, issue.number, issue.title);
  const planName = planFileName(today, issue.number, issue.title);
  const expectedPath = (directory: string, name: string) =>
    relative(worktree, resolve(worktree, directory, name));
  const canonicalPlan = (name: string) => name.slice(10) === planName.slice(10);
  const specPath = await findArtifact(
    worktree,
    config.paths.specsDir,
    (name) => isSpecFile(issue.number, name) && !canonicalPlan(name),
  );
  let planPath = await findArtifact(
    worktree,
    config.paths.plansDir,
    (name) =>
      isPlanFile(issue.number, name) &&
      (!isSpecFile(issue.number, name) || canonicalPlan(name)),
  );
  if (specPath && planPath) {
    const spec = await fs.stat(join(worktree, specPath));
    const plan = await fs.stat(join(worktree, planPath));
    if (spec.dev === plan.dev && spec.ino === plan.ino) planPath = undefined;
  }
  const pullRequest = await host.findPullRequestByHead(branch);
  return {
    kind: "facts",
    facts: {
      branch,
      remoteBranchExists,
      worktree,
      baseBranch,
      ...(specPath === undefined ? {} : { specPath }),
      ...(planPath === undefined ? {} : { planPath }),
      expectedSpecPath: expectedPath(config.paths.specsDir, specName),
      expectedPlanPath: expectedPath(config.paths.plansDir, planName),
      specApproved:
        !config.workflow.specApproval.required ||
        issue.labels.includes(config.labels.specApproved),
      ...(pullRequest === undefined ? {} : { pullRequest }),
    },
  };
}
