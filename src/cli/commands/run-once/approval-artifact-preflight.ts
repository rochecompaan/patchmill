import { basename, join } from "node:path";
import { findIssueArtifacts } from "./artifacts.ts";
import type { ResolvedIssueArtifactSources } from "./artifact-sources.ts";
import {
  PlanningArtifactSafetyError,
  resolvePlanningArtifacts,
  type PlanningArtifactPolicy,
  type ResolvedPlanningArtifacts,
} from "./planning-artifacts.ts";
import { mirrorConfiguredPathInWorktree } from "./pipeline-workspace.ts";
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
};

function preflightPolicy(
  options: ApprovedArtifactPreflightOptions,
): PlanningArtifactPolicy {
  const { config, existingState } = options;
  const worktreeRoot = existingState?.worktreePath
    ? join(config.repoRoot, existingState.worktreePath)
    : undefined;
  const primaryRoot = worktreeRoot ?? config.repoRoot;

  return {
    kind: "fresh",
    primary: {
      repoRoot: primaryRoot,
      specsDir: mirrorConfiguredPathInWorktree(
        config.repoRoot,
        primaryRoot,
        config.specsDir,
      ),
      plansDir: mirrorConfiguredPathInWorktree(
        config.repoRoot,
        primaryRoot,
        config.plansDir,
      ),
      source: worktreeRoot ? "resume-worktree" : "primary-repo",
    },
    fallbacks: worktreeRoot
      ? [
          {
            repoRoot: config.repoRoot,
            specsDir: config.specsDir,
            plansDir: config.plansDir,
            source: "primary-repo",
          },
        ]
      : undefined,
    explicit: options.resolvedArtifacts,
    saved: {
      specPath: existingState?.specPath,
      specCommit: existingState?.specCommit,
      planPath: existingState?.planPath,
      planCommit: existingState?.planCommit,
      specCreated: existingState?.checkpoints?.specCreated,
      planCreated: existingState?.checkpoints?.planCreated,
    },
    allowGeneratedSpec: false,
    allowGeneratedPlan: false,
  };
}

function artifactDirs(
  options: ApprovedArtifactPreflightOptions,
  kind: "spec" | "plan",
): string[] {
  const configuredDir =
    kind === "spec" ? options.config.specsDir : options.config.plansDir;
  if (!options.existingState?.worktreePath) return [configuredDir];

  const worktreeRoot = join(
    options.config.repoRoot,
    options.existingState.worktreePath,
  );
  return [
    mirrorConfiguredPathInWorktree(
      options.config.repoRoot,
      worktreeRoot,
      configuredDir,
    ),
    configuredDir,
  ];
}

async function assertUnambiguousDiscovery(
  options: ApprovedArtifactPreflightOptions,
  kind: "spec" | "plan",
  label: string,
): Promise<void> {
  if (options.resolvedArtifacts[kind]) return;
  const savedPath =
    kind === "spec"
      ? options.existingState?.specPath
      : options.existingState?.planPath;
  if (savedPath) return;

  const candidates = (
    await Promise.all(
      artifactDirs(options, kind).map((dir) =>
        findIssueArtifacts(dir, options.issue.number),
      ),
    )
  ).flat();
  const names = [
    ...new Set(candidates.map((candidate) => basename(candidate))),
  ];
  if (names.length <= 1) return;

  throw new PlanningArtifactSafetyError(
    `Issue #${options.issue.number} has approval label ${label}, but multiple ${kind} artifacts could be resolved: ${names.join(", ")}`,
  );
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

export async function assertApprovedArtifactsResolvable(
  options: ApprovedArtifactPreflightOptions,
): Promise<void> {
  const specLabel = options.config.approvalPolicy.specApproval.approvedLabel;
  const planLabel = options.config.approvalPolicy.planApproval.approvedLabel;
  const requiresSpec = options.issue.labels.includes(specLabel);
  const requiresPlan = options.issue.labels.includes(planLabel);
  if (!requiresSpec && !requiresPlan) return;

  if (requiresSpec) {
    await assertUnambiguousDiscovery(options, "spec", specLabel);
  }
  if (requiresPlan) {
    await assertUnambiguousDiscovery(options, "plan", planLabel);
  }

  let artifacts: ResolvedPlanningArtifacts;
  try {
    artifacts = await resolvePlanningArtifacts({
      policy: preflightPolicy(options),
      issue: options.issue,
      now: options.now,
    });
  } catch (error) {
    if (error instanceof PlanningArtifactSafetyError) {
      const labels = [
        ...(requiresSpec ? [specLabel] : []),
        ...(requiresPlan ? [planLabel] : []),
      ].join(", ");
      throw new PlanningArtifactSafetyError(
        `Issue #${options.issue.number} has approval label ${labels}, but approved artifacts could not be resolved: ${error.message}`,
      );
    }
    throw error;
  }

  if (requiresSpec && !artifacts.spec.exists) {
    throw missingApprovedArtifact(options.issue, specLabel, "spec");
  }
  if (requiresPlan && !artifacts.plan.exists) {
    throw missingApprovedArtifact(options.issue, planLabel, "plan");
  }
}
