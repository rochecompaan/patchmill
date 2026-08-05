import { join } from "node:path";
import {
  assertIssueArtifactSourcesMaterializable,
  assertIssueArtifactSourcesMaterializableInBranch,
} from "./artifact-source-materialization.ts";
import type {
  ResolvedIssueArtifactSource,
  ResolvedIssueArtifactSources,
} from "./artifact-sources.ts";
import {
  PlanningArtifactSafetyError,
  planningArtifactRoot,
  resolveApprovedPlanningArtifacts,
  type PlanningArtifactPolicy,
  type ResolvedPlanningArtifacts,
} from "./planning-artifacts.ts";
import {
  freshPlanningArtifactPolicy,
  hasSavedPlanningArtifactWorkspace,
  planningArtifactPolicyForWorkspace,
} from "./pipeline-workspace.ts";
import type {
  AgentIssueConfig,
  AgentIssueRunState,
  CommandRunner,
  IssueSummary,
} from "./types.ts";
import type { ReadOnlyIssueWorkspace } from "./git.ts";

export type ApprovedArtifactPreflightOptions = {
  config: Pick<
    AgentIssueConfig,
    "repoRoot" | "specsDir" | "plansDir" | "approvalPolicy"
  >;
  issue: IssueSummary;
  existingState?: AgentIssueRunState;
  resolvedArtifacts: ResolvedIssueArtifactSources;
  now: Date;
  artifactWorkspace?: ReadOnlyIssueWorkspace;
  runner?: CommandRunner;
};

export type ApprovedArtifactPreflight = {
  policy: PlanningArtifactPolicy;
  artifacts: ResolvedPlanningArtifacts;
};

async function approvedArtifactPolicy(input: {
  options: ApprovedArtifactPreflightOptions;
  requireSpec: boolean;
  requirePlan: boolean;
  resolvedArtifacts: ResolvedIssueArtifactSources;
}): Promise<PlanningArtifactPolicy> {
  const { options, requireSpec, requirePlan, resolvedArtifacts } = input;
  const { config, existingState } = options;
  const hasApprovedSource =
    (requireSpec && !!resolvedArtifacts.spec) ||
    (requirePlan && !!resolvedArtifacts.plan);
  const needsSavedWorkspace = hasSavedPlanningArtifactWorkspace(existingState);

  if (needsSavedWorkspace || hasApprovedSource) {
    if (options.artifactWorkspace?.kind === "worktree") {
      return planningArtifactPolicyForWorkspace({
        config,
        existingState,
        resolvedArtifacts,
        worktreePath: options.artifactWorkspace.worktreePath,
        allowGeneratedSpec: false,
        allowGeneratedPlan: false,
      });
    }

    if (!options.artifactWorkspace && existingState?.worktreePath) {
      return planningArtifactPolicyForWorkspace({
        config,
        existingState,
        resolvedArtifacts,
        worktreePath: existingState.worktreePath,
        allowGeneratedSpec: false,
        allowGeneratedPlan: false,
      });
    }
  }

  return freshPlanningArtifactPolicy({
    config,
    existingState:
      options.artifactWorkspace && existingState
        ? { ...existingState, worktreePath: undefined }
        : existingState,
    resolvedArtifacts,
    allowGeneratedSpec: false,
    allowGeneratedPlan: false,
  });
}

function assertExplicitMatchesSaved(input: {
  kind: "spec" | "plan";
  explicit?: ResolvedIssueArtifactSource;
  savedPath?: string;
  savedCommit?: string;
}): void {
  if (!input.explicit || !input.savedPath) return;
  if (input.explicit.path !== input.savedPath) {
    throw new PlanningArtifactSafetyError(
      `Explicit ${input.kind} artifact ${input.explicit.path} does not match saved ${input.kind} ${input.savedPath}`,
    );
  }
  if (
    input.explicit.commit &&
    input.savedCommit &&
    input.explicit.commit !== input.savedCommit
  ) {
    throw new PlanningArtifactSafetyError(
      `Explicit ${input.kind} artifact commit ${input.explicit.commit} does not match saved ${input.kind} commit ${input.savedCommit}`,
    );
  }
}

async function branchSavedArtifact(input: {
  options: ApprovedArtifactPreflightOptions;
  kind: "spec" | "plan";
  required: boolean;
}): Promise<ResolvedIssueArtifactSource | undefined> {
  const { options, kind, required } = input;
  if (!required || options.artifactWorkspace?.kind !== "branch") {
    return undefined;
  }
  if (!options.runner) {
    throw new PlanningArtifactSafetyError(
      "Approved branch preflight requires a command runner",
    );
  }
  const path =
    kind === "spec"
      ? options.existingState?.specPath
      : options.existingState?.planPath;
  if (!path) return undefined;
  const commit =
    kind === "spec"
      ? options.existingState?.specCommit
      : options.existingState?.planCommit;
  const explicit = options.resolvedArtifacts[kind];
  assertExplicitMatchesSaved({
    kind,
    explicit,
    savedPath: path,
    savedCommit: commit,
  });

  const object = `${options.artifactWorkspace.branch}:${path}`;
  const type = await options.runner.run("git", ["cat-file", "-t", object], {
    cwd: options.config.repoRoot,
  });
  if (type.code === 1 || type.code === 128) {
    throw new PlanningArtifactSafetyError(
      `Saved ${kind} ${path} does not exist on issue branch ${options.artifactWorkspace.branch}`,
    );
  }
  if (type.code !== 0) {
    throw new PlanningArtifactSafetyError(
      `git cat-file failed while resolving saved ${kind} ${path} from ${options.artifactWorkspace.branch}`,
    );
  }
  if (type.stdout.trim() !== "blob") {
    throw new PlanningArtifactSafetyError(
      `Saved ${kind} ${path} is not a regular file on issue branch ${options.artifactWorkspace.branch}`,
    );
  }
  const content = await options.runner.run("git", ["show", object], {
    cwd: options.config.repoRoot,
  });
  if (content.code !== 0) {
    throw new PlanningArtifactSafetyError(
      `git show failed while resolving saved ${kind} ${path} from ${options.artifactWorkspace.branch}`,
    );
  }
  return {
    path,
    absolutePath: join(options.config.repoRoot, path),
    content: content.stdout,
    evidence: `saved ${kind} from ${options.artifactWorkspace.branch}`,
    ...(commit ? { commit } : {}),
  };
}

function missingApprovedArtifact(
  issue: IssueSummary,
  label: string,
  kind: "spec" | "plan",
): PlanningArtifactSafetyError {
  return new PlanningArtifactSafetyError(
    `Issue #${issue.number} has approval label ${label}, but no ${kind} artifact could be resolved; remove ${label} before creating a new ${kind}`,
  );
}

async function assertApprovedSourcesMaterializable(input: {
  issue: IssueSummary;
  policy: PlanningArtifactPolicy;
  artifacts: ResolvedPlanningArtifacts;
  sources: ResolvedIssueArtifactSources;
  requireSpec: boolean;
  requirePlan: boolean;
  specLabel: string;
  planLabel: string;
  artifactWorkspace?: ReadOnlyIssueWorkspace;
  runner?: CommandRunner;
}): Promise<void> {
  const approved = [
    ...(input.requireSpec && input.sources.spec
      ? [
          {
            kind: "spec" as const,
            source: input.sources.spec,
            artifact: input.artifacts.spec,
            label: input.specLabel,
          },
        ]
      : []),
    ...(input.requirePlan && input.sources.plan
      ? [
          {
            kind: "plan" as const,
            source: input.sources.plan,
            artifact: input.artifacts.plan,
            label: input.planLabel,
          },
        ]
      : []),
  ];

  for (const entry of approved) {
    try {
      const sources = { [entry.kind]: entry.source };
      if (input.artifactWorkspace?.kind === "branch") {
        if (!input.runner) {
          throw new Error(
            "Approved branch preflight requires a command runner",
          );
        }
        await assertIssueArtifactSourcesMaterializableInBranch({
          repoRoot: input.policy.primary.repoRoot,
          runner: input.runner,
          branch: input.artifactWorkspace.branch,
          issueNumber: input.issue.number,
          sources,
        });
      } else {
        await assertIssueArtifactSourcesMaterializable({
          repoRoot: planningArtifactRoot(input.policy, entry.artifact).repoRoot,
          issueNumber: input.issue.number,
          sources,
        });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new PlanningArtifactSafetyError(
        `Issue #${input.issue.number} has approval label ${entry.label}, but its approved artifact cannot be materialized: ${message}`,
      );
    }
  }
}

export async function assertApprovedArtifactsResolvable(
  options: ApprovedArtifactPreflightOptions,
): Promise<ApprovedArtifactPreflight | undefined> {
  const specLabel = options.config.approvalPolicy.specApproval.approvedLabel;
  const planLabel = options.config.approvalPolicy.planApproval.approvedLabel;
  const requireSpec = options.issue.labels.includes(specLabel);
  const requirePlan = options.issue.labels.includes(planLabel);
  if (!requireSpec && !requirePlan) return undefined;

  const branchSpec = await branchSavedArtifact({
    options,
    kind: "spec",
    required: requireSpec,
  });
  const branchPlan = await branchSavedArtifact({
    options,
    kind: "plan",
    required: requirePlan,
  });
  const branchSavedArtifacts: ResolvedIssueArtifactSources = {
    ...(branchSpec ? { spec: branchSpec } : {}),
    ...(branchPlan ? { plan: branchPlan } : {}),
  };
  const preflightArtifacts = {
    ...options.resolvedArtifacts,
    ...branchSavedArtifacts,
  };
  const policy = await approvedArtifactPolicy({
    options,
    requireSpec,
    requirePlan,
    resolvedArtifacts: preflightArtifacts,
  });
  let artifacts: ResolvedPlanningArtifacts;
  try {
    artifacts = await resolveApprovedPlanningArtifacts({
      policy,
      issue: options.issue,
      now: options.now,
      requireSpec,
      requirePlan,
    });
  } catch (error) {
    if (error instanceof PlanningArtifactSafetyError) {
      const labels = [
        ...(requireSpec ? [specLabel] : []),
        ...(requirePlan ? [planLabel] : []),
      ].join(", ");
      throw new PlanningArtifactSafetyError(
        `Issue #${options.issue.number} has approval label ${labels}, but approved artifacts could not be resolved: ${error.message}`,
      );
    }
    throw error;
  }

  if (requireSpec && !artifacts.spec.exists) {
    throw missingApprovedArtifact(options.issue, specLabel, "spec");
  }
  if (requirePlan && !artifacts.plan.exists) {
    throw missingApprovedArtifact(options.issue, planLabel, "plan");
  }

  await assertApprovedSourcesMaterializable({
    issue: options.issue,
    policy,
    artifacts,
    sources: options.resolvedArtifacts,
    requireSpec,
    requirePlan,
    specLabel,
    planLabel,
    artifactWorkspace: options.artifactWorkspace,
    runner: options.runner,
  });

  return { policy, artifacts };
}
