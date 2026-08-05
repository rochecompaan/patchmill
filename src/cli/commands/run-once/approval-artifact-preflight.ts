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
  resumePlanningArtifactPolicy,
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
  ensureArtifactWorkspace?: () => Promise<void>;
};

export type ApprovedArtifactPreflight = {
  policy: PlanningArtifactPolicy;
  artifacts: ResolvedPlanningArtifacts;
};

function hasSavedArtifacts(state: AgentIssueRunState | undefined): boolean {
  return !!(state?.specPath || state?.planPath);
}

function approvedArtifactPolicy(
  options: ApprovedArtifactPreflightOptions,
): PlanningArtifactPolicy {
  const { config, existingState, resolvedArtifacts } = options;
  if (existingState?.worktreePath && hasSavedArtifacts(existingState)) {
    return resumePlanningArtifactPolicy({
      config,
      worktreePath: existingState.worktreePath,
      existingState,
      resolvedArtifacts,
    });
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

  if (
    options.ensureArtifactWorkspace &&
    options.existingState?.branch &&
    options.existingState.worktreePath &&
    hasSavedArtifacts(options.existingState)
  ) {
    await options.ensureArtifactWorkspace();
  }

  const policy = approvedArtifactPolicy(options);
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
