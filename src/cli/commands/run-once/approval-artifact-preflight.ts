import { assertIssueArtifactSourcesMaterializable } from "./artifact-source-materialization.ts";
import type { ResolvedIssueArtifactSources } from "./artifact-sources.ts";
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
  IssueSummary,
} from "./types.ts";

export type ApprovedArtifactPreflightOptions = {
  config: Pick<
    AgentIssueConfig,
    "repoRoot" | "specsDir" | "plansDir" | "approvalPolicy"
  >;
  issue: IssueSummary;
  existingState?: AgentIssueRunState;
  resolvedArtifacts: ResolvedIssueArtifactSources;
  now: Date;
  ensureArtifactWorkspace?: () => Promise<{ worktreePath: string }>;
};

export type ApprovedArtifactPreflight = {
  policy: PlanningArtifactPolicy;
  artifacts: ResolvedPlanningArtifacts;
};

async function approvedArtifactPolicy(input: {
  options: ApprovedArtifactPreflightOptions;
  requireSpec: boolean;
  requirePlan: boolean;
}): Promise<PlanningArtifactPolicy> {
  const { options, requireSpec, requirePlan } = input;
  const { config, existingState, resolvedArtifacts } = options;
  const hasApprovedSource =
    (requireSpec && !!resolvedArtifacts.spec) ||
    (requirePlan && !!resolvedArtifacts.plan);
  const needsSavedWorkspace = hasSavedPlanningArtifactWorkspace(existingState);

  if (needsSavedWorkspace || hasApprovedSource) {
    const workspace = options.ensureArtifactWorkspace
      ? await options.ensureArtifactWorkspace()
      : existingState?.worktreePath
        ? { worktreePath: existingState.worktreePath }
        : undefined;
    if (workspace) {
      return planningArtifactPolicyForWorkspace({
        config,
        existingState,
        resolvedArtifacts,
        worktreePath: workspace.worktreePath,
        allowGeneratedSpec: false,
        allowGeneratedPlan: false,
      });
    }
    if (needsSavedWorkspace) {
      throw new PlanningArtifactSafetyError(
        `Saved planning artifacts require an ensured workspace before approval preflight`,
      );
    }
  }

  return freshPlanningArtifactPolicy({
    config,
    existingState,
    resolvedArtifacts,
    allowGeneratedSpec: false,
    allowGeneratedPlan: false,
  });
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
      await assertIssueArtifactSourcesMaterializable({
        repoRoot: planningArtifactRoot(input.policy, entry.artifact).repoRoot,
        issueNumber: input.issue.number,
        sources: { [entry.kind]: entry.source },
      });
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

  const policy = await approvedArtifactPolicy({
    options,
    requireSpec,
    requirePlan,
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
  });

  return { policy, artifacts };
}
