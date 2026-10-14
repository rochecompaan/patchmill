import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { CommandRunner } from "../../../command/types.ts";
import type { ResolvedIssueArtifactSources } from "./artifact-sources.ts";
import type { ApprovedArtifactPreflight } from "./approval-artifact-preflight.ts";
import type { PlanningArtifactPolicy } from "./planning-artifacts.ts";
import { assertExecutionArtifactDestination } from "./execution-artifact-destination.ts";
import {
  materializeIssueArtifactSources,
  artifactSourceContentMatches,
} from "./artifact-source-materialization.ts";

export async function materializeExecutionPlanningArtifacts(input: {
  repoRoot: string;
  runner: CommandRunner;
  issueNumber: number;
  sources: ResolvedIssueArtifactSources;
  policy?: PlanningArtifactPolicy | undefined;
  approvedArtifactPreflight?: ApprovedArtifactPreflight | undefined;
}): Promise<ResolvedIssueArtifactSources> {
  const sources = {
    ...input.sources,
    ...input.approvedArtifactPreflight?.sources,
  };
  let materialized: ResolvedIssueArtifactSources;
  try {
    const missingSources = { ...sources };
    if (input.policy?.kind === "implementation-resume") {
      for (const kind of ["spec", "plan"] as const) {
        const source = sources[kind];
        if (!source || input.policy.saved[`${kind}Path`] !== source.path)
          continue;
        const path = await assertExecutionArtifactDestination({
          repoRoot: input.repoRoot,
          issueNumber: input.issueNumber,
          kind,
          path: source.path,
        });
        try {
          const content = await readFile(path, "utf8");
          if (artifactSourceContentMatches(source.content, content))
            delete missingSources[kind];
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        }
      }
    }
    materialized = {
      ...sources,
      ...(await materializeIssueArtifactSources({
        ...input,
        sources: missingSources,
      })),
    };
  } catch (error) {
    const destinations = (["spec", "plan"] as const).flatMap((kind) => {
      const source = sources[kind];
      return source
        ? [
            `${kind} ${source.path} at execution destination ${resolve(input.repoRoot, source.path)}`,
          ]
        : [];
    });
    throw new Error(
      `Issue #${input.issueNumber} could not materialize ${destinations.join(", ")}: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  }
  for (const kind of ["spec", "plan"] as const) {
    const source = sources[kind];
    const artifact = materialized[kind];
    if (!source || !artifact) continue;
    const absolutePath = resolve(input.repoRoot, source.path);
    try {
      await assertExecutionArtifactDestination({
        repoRoot: input.repoRoot,
        issueNumber: input.issueNumber,
        kind,
        path: source.path,
      });
      const content = await readFile(absolutePath, "utf8");
      if (!artifactSourceContentMatches(source.content, content))
        throw new Error(
          "destination content differs from the approved selection",
        );
    } catch (error) {
      throw new Error(
        `Issue #${input.issueNumber} ${kind} artifact ${source.path} is unavailable at execution destination ${absolutePath}: ${error instanceof Error ? error.message : String(error)}`,
        { cause: error },
      );
    }
    const executionArtifact = { ...artifact, absolutePath };
    const savedCommit = input.policy?.saved?.[`${kind}Commit`];
    if (
      input.policy?.kind === "implementation-resume" &&
      input.policy.saved[`${kind}Path`] === source.path &&
      savedCommit
    )
      executionArtifact.commit = savedCommit;
    materialized[kind] = executionArtifact;
  }
  return materialized;
}
