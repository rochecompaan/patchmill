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
import type { AgentIssueConfig, AgentIssueRunState } from "./types.ts";

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

export function hasSavedPlanningArtifactWorkspace(
  state: AgentIssueRunState | undefined,
): state is AgentIssueRunState {
  return !!(
    state &&
    (state.branch || state.worktreePath) &&
    (state.specPath || state.planPath)
  );
}

export function planningArtifactPolicyForWorkspace(input: {
  config: Pick<AgentIssueConfig, "repoRoot" | "specsDir" | "plansDir">;
  existingState?: AgentIssueRunState;
  resolvedArtifacts: ResolvedIssueArtifactSources;
  worktreePath: string;
  allowGeneratedSpec: boolean;
  allowGeneratedPlan: boolean;
}): PlanningArtifactPolicy {
  if (hasSavedPlanningArtifactWorkspace(input.existingState)) {
    return resumePlanningArtifactPolicy({
      config: input.config,
      worktreePath: input.worktreePath,
      existingState: input.existingState,
      resolvedArtifacts: input.resolvedArtifacts,
    });
  }

  return freshPlanningArtifactPolicy({
    config: input.config,
    existingState: input.existingState,
    resolvedArtifacts: input.resolvedArtifacts,
    allowGeneratedSpec: input.allowGeneratedSpec,
    allowGeneratedPlan: input.allowGeneratedPlan,
    workspaceRoot: join(input.config.repoRoot, input.worktreePath),
  });
}

export function freshPlanningArtifactPolicy(input: {
  config: Pick<AgentIssueConfig, "repoRoot" | "specsDir" | "plansDir">;
  existingState?: AgentIssueRunState;
  resolvedArtifacts: ResolvedIssueArtifactSources;
  allowGeneratedSpec: boolean;
  allowGeneratedPlan: boolean;
  workspaceRoot?: string;
}): PlanningArtifactPolicy {
  const worktreeRoot =
    input.workspaceRoot ??
    (input.existingState?.worktreePath
      ? join(input.config.repoRoot, input.existingState.worktreePath)
      : undefined);
  const primaryRoot = worktreeRoot ?? input.config.repoRoot;

  return {
    kind: "fresh",
    primary: {
      repoRoot: primaryRoot,
      specsDir: mirrorConfiguredPathInWorktree(
        input.config.repoRoot,
        primaryRoot,
        input.config.specsDir,
      ),
      plansDir: mirrorConfiguredPathInWorktree(
        input.config.repoRoot,
        primaryRoot,
        input.config.plansDir,
      ),
      source: worktreeRoot ? "resume-worktree" : "primary-repo",
    },
    fallbacks: worktreeRoot
      ? [
          {
            repoRoot: input.config.repoRoot,
            specsDir: input.config.specsDir,
            plansDir: input.config.plansDir,
            source: "primary-repo",
          },
        ]
      : undefined,
    explicit: input.resolvedArtifacts,
    saved: {
      specPath: input.existingState?.specPath,
      specCommit: input.existingState?.specCommit,
      planPath: input.existingState?.planPath,
      planCommit: input.existingState?.planCommit,
      specCreated: input.existingState?.checkpoints?.specCreated,
      planCreated: input.existingState?.checkpoints?.planCreated,
    },
    allowGeneratedSpec: input.allowGeneratedSpec,
    allowGeneratedPlan: input.allowGeneratedPlan,
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
