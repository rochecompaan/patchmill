import { basename, isAbsolute, join, relative } from "node:path";
import { findIssueArtifacts } from "./artifacts.ts";
import type { ResolvedIssueArtifactSources } from "./artifact-sources.ts";
import { pathExists } from "./paths.ts";
import { buildPlanPath, findIssuePlan } from "./plans.ts";
import { buildSpecPath, findIssueSpec } from "./specs.ts";
import type { IssueSummary } from "./types.ts";

export type PlanningArtifactRoot = {
  repoRoot: string;
  specsDir: string;
  plansDir: string;
  source: "primary-repo" | "resume-worktree";
};

export type ResolvedPlanningArtifact = {
  path?: string;
  commit?: string;
  exists: boolean;
  fromState: boolean;
  created: boolean;
  generated: boolean;
  rootSource?: PlanningArtifactRoot["source"];
};

export type PlanningArtifactPolicy =
  | {
      kind: "fresh";
      primary: PlanningArtifactRoot;
      fallbacks?: PlanningArtifactRoot[];
      explicit?: ResolvedIssueArtifactSources;
      saved?: {
        specPath?: string;
        specCommit?: string;
        planPath?: string;
        planCommit?: string;
        specCreated?: boolean;
        planCreated?: boolean;
      };
      allowGeneratedSpec: boolean;
      allowGeneratedPlan: boolean;
    }
  | {
      kind: "implementation-resume";
      primary: PlanningArtifactRoot;
      fallbacks: PlanningArtifactRoot[];
      saved: {
        specPath?: string;
        specCommit?: string;
        planPath?: string;
        planCommit?: string;
        specCreated?: boolean;
        planCreated?: boolean;
      };
      explicit?: ResolvedIssueArtifactSources;
    };

export type ResolvedPlanningArtifacts = {
  spec: ResolvedPlanningArtifact;
  plan: ResolvedPlanningArtifact;
};

export class PlanningArtifactSafetyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PlanningArtifactSafetyError";
  }
}

function unresolvedArtifact(): ResolvedPlanningArtifact {
  return { exists: false, fromState: false, created: false, generated: false };
}

function repoPath(
  repoRoot: string,
  path: string,
): { absolute: string; relative: string } {
  if (isAbsolute(path)) {
    return { absolute: path, relative: relative(repoRoot, path) };
  }

  return { absolute: join(repoRoot, path), relative: path };
}

function promptBodyPath(
  repoRoot: string,
  absoluteArtifactPath: string,
): string {
  return relative(repoRoot, absoluteArtifactPath);
}

function roots(policy: PlanningArtifactPolicy): PlanningArtifactRoot[] {
  return [policy.primary, ...(policy.fallbacks ?? [])];
}

export function planningArtifactRoot(
  policy: PlanningArtifactPolicy,
  artifact: ResolvedPlanningArtifact,
): PlanningArtifactRoot {
  return (
    roots(policy).find((root) => root.source === artifact.rootSource) ??
    policy.primary
  );
}

function explicitMatchesSaved(input: {
  kind: "spec" | "plan";
  explicit?: { path: string; commit?: string };
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

async function findSaved(input: {
  roots: PlanningArtifactRoot[];
  savedPath?: string;
  savedCommit?: string;
  savedCreated?: boolean;
}): Promise<ResolvedPlanningArtifact> {
  if (!input.savedPath) return unresolvedArtifact();

  for (const root of input.roots) {
    const savedPath = repoPath(root.repoRoot, input.savedPath);
    if (await pathExists(savedPath.absolute)) {
      return {
        path: savedPath.relative,
        commit: input.savedCommit,
        exists: true,
        fromState: true,
        created: input.savedCreated === true,
        generated: false,
        rootSource: root.source,
      };
    }
  }

  return {
    path: input.savedPath,
    commit: input.savedCommit,
    exists: false,
    fromState: true,
    created: input.savedCreated === true,
    generated: false,
  };
}

async function findDiscovered(input: {
  roots: PlanningArtifactRoot[];
  issue: IssueSummary;
  kind: "spec" | "plan";
}): Promise<ResolvedPlanningArtifact> {
  for (const root of input.roots) {
    const artifactDir = input.kind === "spec" ? root.specsDir : root.plansDir;
    const found =
      input.kind === "spec"
        ? await findIssueSpec(artifactDir, input.issue.number)
        : await findIssuePlan(artifactDir, input.issue.number);
    if (found) {
      return {
        path: repoPath(root.repoRoot, found).relative,
        exists: true,
        fromState: false,
        created: false,
        generated: false,
        rootSource: root.source,
      };
    }
  }

  return unresolvedArtifact();
}

function generated(input: {
  policy: PlanningArtifactPolicy;
  issue: IssueSummary;
  kind: "spec" | "plan";
  now: Date;
}): ResolvedPlanningArtifact {
  const allowed =
    input.policy.kind === "fresh"
      ? input.kind === "spec"
        ? input.policy.allowGeneratedSpec
        : input.policy.allowGeneratedPlan
      : true;
  if (!allowed) return unresolvedArtifact();

  const artifactDir =
    input.kind === "spec"
      ? input.policy.primary.specsDir
      : input.policy.primary.plansDir;
  const path =
    input.kind === "spec"
      ? buildSpecPath(
          artifactDir,
          input.issue.number,
          input.issue.title,
          input.now,
        )
      : buildPlanPath(
          artifactDir,
          input.issue.number,
          input.issue.title,
          input.now,
        );
  return {
    path: promptBodyPath(input.policy.primary.repoRoot, path),
    exists: false,
    fromState: false,
    created: false,
    generated: true,
    rootSource: input.policy.primary.source,
  };
}

export async function resolvePlanningArtifacts(input: {
  policy: PlanningArtifactPolicy;
  issue: IssueSummary;
  now: Date;
}): Promise<ResolvedPlanningArtifacts> {
  const policyRoots = roots(input.policy);

  if (input.policy.kind === "implementation-resume") {
    explicitMatchesSaved({
      kind: "spec",
      explicit: input.policy.explicit?.spec,
      savedPath: input.policy.saved.specPath,
      savedCommit: input.policy.saved.specCommit,
    });
    explicitMatchesSaved({
      kind: "plan",
      explicit: input.policy.explicit?.plan,
      savedPath: input.policy.saved.planPath,
      savedCommit: input.policy.saved.planCommit,
    });

    const spec = await findSaved({
      roots: policyRoots,
      savedPath: input.policy.saved.specPath,
      savedCommit: input.policy.saved.specCommit,
      savedCreated: input.policy.saved.specCreated,
    });
    const plan = await findSaved({
      roots: policyRoots,
      savedPath: input.policy.saved.planPath,
      savedCommit: input.policy.saved.planCommit,
      savedCreated: input.policy.saved.planCreated,
    });
    const explicitArtifact = (artifact: {
      path: string;
      commit?: string;
    }): ResolvedPlanningArtifact => ({
      path: artifact.path,
      commit: artifact.commit,
      exists: true,
      fromState: false,
      created: false,
      generated: false,
      rootSource: input.policy.primary.source,
    });

    const discoveredPlan = input.policy.saved.planPath
      ? plan
      : input.policy.explicit?.plan
        ? explicitArtifact(input.policy.explicit.plan)
        : await findDiscovered({
            roots: policyRoots,
            issue: input.issue,
            kind: "plan",
          });
    const resolvedPlan = plan.exists
      ? plan
      : discoveredPlan.exists
        ? discoveredPlan
        : generated({
            policy: input.policy,
            issue: input.issue,
            now: input.now,
            kind: "plan",
          });
    const resolvedSpec = spec.exists
      ? spec
      : input.policy.saved.specPath
        ? unresolvedArtifact()
        : input.policy.explicit?.spec
          ? explicitArtifact(input.policy.explicit.spec)
          : await findDiscovered({
              roots: policyRoots,
              issue: input.issue,
              kind: "spec",
            });

    if (input.policy.saved.planPath && !resolvedPlan.exists) {
      throw new PlanningArtifactSafetyError(
        `Saved plan ${input.policy.saved.planPath} was not found in the saved resume workspace or fallback repository`,
      );
    }

    return { spec: resolvedSpec, plan: resolvedPlan };
  }

  const explicitSpec = input.policy.explicit?.spec;
  const explicitPlan = input.policy.explicit?.plan;
  const savedPlan = await findSaved({
    roots: policyRoots,
    savedPath: input.policy.saved?.planPath,
    savedCommit: input.policy.saved?.planCommit,
    savedCreated: input.policy.saved?.planCreated,
  });
  const savedSpec = await findSaved({
    roots: policyRoots,
    savedPath: input.policy.saved?.specPath,
    savedCommit: input.policy.saved?.specCommit,
    savedCreated: input.policy.saved?.specCreated,
  });
  const discoveredPlan = explicitPlan
    ? {
        path: explicitPlan.path,
        commit: explicitPlan.commit,
        exists: true,
        fromState: false,
        created: false,
        generated: false,
      }
    : savedPlan.exists
      ? savedPlan
      : await findDiscovered({
          roots: policyRoots,
          issue: input.issue,
          kind: "plan",
        });
  const discoveredSpec = explicitSpec
    ? {
        path: explicitSpec.path,
        commit: explicitSpec.commit,
        exists: true,
        fromState: false,
        created: false,
        generated: false,
      }
    : savedSpec.exists
      ? savedSpec
      : await findDiscovered({
          roots: policyRoots,
          issue: input.issue,
          kind: "spec",
        });

  return {
    spec: discoveredSpec.exists
      ? discoveredSpec
      : generated({
          policy: input.policy,
          issue: input.issue,
          kind: "spec",
          now: input.now,
        }),
    plan: discoveredPlan.exists
      ? discoveredPlan
      : generated({
          policy: input.policy,
          issue: input.issue,
          kind: "plan",
          now: input.now,
        }),
  };
}

async function assertUnambiguousApprovedArtifact(input: {
  policy: PlanningArtifactPolicy;
  issue: IssueSummary;
  kind: "spec" | "plan";
  artifact: ResolvedPlanningArtifact;
}): Promise<void> {
  const explicit = input.policy.explicit?.[input.kind];
  if (explicit || (input.artifact.fromState && input.artifact.exists)) return;

  const candidates = (
    await Promise.all(
      roots(input.policy).map((root) =>
        findIssueArtifacts(
          input.kind === "spec" ? root.specsDir : root.plansDir,
          input.issue.number,
        ),
      ),
    )
  ).flat();
  const names = [
    ...new Set(candidates.map((candidate) => basename(candidate))),
  ];
  if (names.length <= 1) return;

  throw new PlanningArtifactSafetyError(
    `Issue #${input.issue.number} has multiple ${input.kind} artifacts that could be resolved: ${names.join(", ")}`,
  );
}

export async function resolveApprovedPlanningArtifacts(input: {
  policy: PlanningArtifactPolicy;
  issue: IssueSummary;
  now: Date;
  requireSpec: boolean;
  requirePlan: boolean;
}): Promise<ResolvedPlanningArtifacts> {
  const artifacts = await resolvePlanningArtifacts(input);
  if (input.requireSpec) {
    await assertUnambiguousApprovedArtifact({
      policy: input.policy,
      issue: input.issue,
      kind: "spec",
      artifact: artifacts.spec,
    });
  }
  if (input.requirePlan) {
    await assertUnambiguousApprovedArtifact({
      policy: input.policy,
      issue: input.issue,
      kind: "plan",
      artifact: artifacts.plan,
    });
  }
  return artifacts;
}
