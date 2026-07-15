import { isAbsolute, join, relative } from "node:path";
import {
  buildIssueBranchName,
  buildIssueWorktreePath,
} from "../../../git/worktree-strategy.ts";
import type { GitWorktreeStrategyConfig } from "../../../git/types.ts";
import { cleanStatusIgnoredPaths as buildCleanStatusIgnoredPaths } from "./git.ts";
import type { PlanningArtifactPolicy } from "./planning-artifacts.ts";
import type { ResolvedIssueArtifactSources } from "./artifact-sources.ts";
import type { readRunState } from "./run-state.ts";
import type { AgentIssueConfig } from "./types.ts";

export function cleanStatusIgnoredPaths(
  config: Pick<
    AgentIssueConfig,
    "runStateDir" | "cleanStatusIgnorePrefixes" | "projectPolicy"
  >,
  options: Pick<{ logPath?: string }, "logPath">,
): string[] {
  return buildCleanStatusIgnoredPaths({
    cleanStatusIgnorePrefixes: config.cleanStatusIgnorePrefixes,
    todoRoot: config.projectPolicy.pi.taskContract.todoRoot,
    runStateDir: config.runStateDir,
    additionalPaths: options.logPath ? [options.logPath] : [],
  });
}

export function configuredWorktreeDir(
  config: Pick<AgentIssueConfig, "repoRoot" | "worktreeDir">,
): string {
  return relative(config.repoRoot, config.worktreeDir) || ".";
}

export function configuredPathRelativeToRepo(
  repoRoot: string,
  path: string,
): string {
  return isAbsolute(path) ? relative(repoRoot, path) : path;
}

export function mirrorConfiguredPathInWorktree(
  repoRoot: string,
  worktreeRoot: string,
  path: string,
): string {
  return join(worktreeRoot, configuredPathRelativeToRepo(repoRoot, path));
}

export function resumePlanningArtifactPolicy(input: {
  config: Pick<AgentIssueConfig, "repoRoot" | "specsDir" | "plansDir">;
  worktreePath: string;
  existingState: NonNullable<Awaited<ReturnType<typeof readRunState>>>;
  resolvedArtifacts: ResolvedIssueArtifactSources;
}): PlanningArtifactPolicy {
  const worktreeRoot = join(input.config.repoRoot, input.worktreePath);
  return {
    kind: "implementation-resume",
    primary: {
      repoRoot: worktreeRoot,
      specsDir: mirrorConfiguredPathInWorktree(
        input.config.repoRoot,
        worktreeRoot,
        input.config.specsDir,
      ),
      plansDir: mirrorConfiguredPathInWorktree(
        input.config.repoRoot,
        worktreeRoot,
        input.config.plansDir,
      ),
      source: "resume-worktree",
    },
    fallbacks: [
      {
        repoRoot: input.config.repoRoot,
        specsDir: input.config.specsDir,
        plansDir: input.config.plansDir,
        source: "primary-repo",
      },
    ],
    saved: {
      specPath: input.existingState.specPath,
      specCommit: input.existingState.specCommit,
      planPath: input.existingState.planPath,
      planCommit: input.existingState.planCommit,
      specCreated: input.existingState.checkpoints?.specCreated,
      planCreated: input.existingState.checkpoints?.planCreated,
    },
    explicit: input.resolvedArtifacts,
  };
}

export function configuredWorktreeStrategy(
  config: Pick<
    AgentIssueConfig,
    keyof GitWorktreeStrategyConfig | "repoRoot" | "worktreeDir"
  >,
): GitWorktreeStrategyConfig {
  return {
    baseBranch: config.baseBranch,
    baseRef: config.baseRef,
    remote: config.remote,
    branchPrefix: config.branchPrefix,
    worktreeDir: configuredWorktreeDir(config),
    worktreePrefix: config.worktreePrefix,
    slugLength: config.slugLength,
    allowDirectLand: config.allowDirectLand,
  };
}

export function expectedIssueWorkspace(
  issueNumber: number,
  title: string,
  strategy: GitWorktreeStrategyConfig,
): { branch: string; worktreePath: string } {
  return {
    branch: buildIssueBranchName(issueNumber, title, strategy),
    worktreePath: buildIssueWorktreePath(issueNumber, title, strategy),
  };
}
