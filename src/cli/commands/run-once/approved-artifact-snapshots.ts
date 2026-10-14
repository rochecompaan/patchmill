import { readFile } from "node:fs/promises";
import type { ResolvedIssueArtifactSource } from "./artifact-sources.ts";
import type {
  PlanningArtifactPolicy,
  ResolvedPlanningArtifact,
} from "./planning-artifacts.ts";
import { assertExecutionArtifactDestination } from "./execution-artifact-destination.ts";

export async function snapshotApprovedArtifact(input: {
  policy: PlanningArtifactPolicy;
  artifact: ResolvedPlanningArtifact;
  kind: "spec" | "plan";
  issueNumber: number;
}): Promise<ResolvedIssueArtifactSource | undefined> {
  const { artifact, policy, kind } = input;
  if (!artifact.exists || !artifact.path) return undefined;
  const explicit = policy.explicit?.[kind];
  if (explicit && explicit.path === artifact.path && !artifact.fromState)
    return {
      ...explicit,
      ...(artifact.commit ? { commit: artifact.commit } : {}),
    };
  const root =
    [policy.primary, ...(policy.fallbacks ?? [])].find(
      (candidate) => candidate.source === artifact.rootSource,
    ) ?? policy.primary;
  const absolutePath = await assertExecutionArtifactDestination({
    repoRoot: root.repoRoot,
    issueNumber: input.issueNumber,
    kind,
    path: artifact.path,
  });
  return {
    path: artifact.path,
    absolutePath,
    content: await readFile(absolutePath, "utf8"),
    ...(artifact.commit ? { commit: artifact.commit } : {}),
    evidence: `approved ${kind} selected from ${root.source}`,
  };
}
