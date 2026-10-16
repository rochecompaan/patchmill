import fs from "node:fs/promises";
import { join, relative, resolve } from "node:path";
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

async function findArtifact(
  worktree: string,
  directory: string,
  matches: (name: string) => boolean,
): Promise<string | undefined> {
  const path = resolve(worktree, directory);
  const entries = await fs
    .readdir(path, { withFileTypes: true })
    .catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return [];
      throw error;
    });
  const name = entries
    .filter((entry) => entry.isFile() && matches(entry.name))
    .map((entry) => entry.name)
    .sort()
    .at(-1);
  return name === undefined ? undefined : relative(worktree, join(path, name));
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
  const specPath = await findArtifact(worktree, config.paths.specsDir, (name) =>
    isSpecFile(issue.number, name),
  );
  const planPath = await findArtifact(worktree, config.paths.plansDir, (name) =>
    isPlanFile(issue.number, name),
  );
  const today = now();
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
      expectedSpecPath: relative(
        worktree,
        resolve(
          worktree,
          config.paths.specsDir,
          specFileName(today, issue.number, issue.title),
        ),
      ),
      expectedPlanPath: relative(
        worktree,
        resolve(
          worktree,
          config.paths.plansDir,
          planFileName(today, issue.number, issue.title),
        ),
      ),
      specApproved:
        !config.workflow.specApproval.required ||
        issue.labels.includes(config.labels.specApproved),
      ...(pullRequest === undefined ? {} : { pullRequest }),
    },
  };
}
