import type { IssueHostProvider } from "../../../host/types.ts";
import { extractPublishedArtifactResult } from "../set-artifact/published-artifacts.ts";
import {
  validateExtractedArtifactSources,
  type ResolvedIssueArtifactSources,
} from "./artifact-sources.ts";
import type {
  AgentIssueConfig,
  AgentIssueProgressEvent,
  IssueSummary,
} from "./types.ts";

export type ArtifactExtractionStageResult = {
  issue: IssueSummary;
  resolvedArtifacts: ResolvedIssueArtifactSources;
};

type ArtifactExtractionStageOptions = {
  host: IssueHostProvider;
  config: AgentIssueConfig;
  issue: IssueSummary;
  now: Date;
  progress: (
    level: AgentIssueProgressEvent["level"],
    stage: string,
    message: string,
    extras?: Partial<
      Pick<AgentIssueProgressEvent, "issueNumber" | "elapsedSeconds" | "data">
    >,
  ) => Promise<void>;
  runStep: <T>(label: string, fn: () => Promise<T>) => Promise<T>;
};

async function hydrateIssueForArtifactExtraction(
  options: ArtifactExtractionStageOptions,
): Promise<IssueSummary> {
  await options.progress(
    "info",
    "artifact-extraction",
    "hydrating issue artifact content",
    { issueNumber: options.issue.number },
  );
  if (options.issue.comments !== undefined) return options.issue;
  const hydrated = await options.host.hydrateIssueComments([options.issue]);
  return hydrated[0] ?? options.issue;
}

export async function runArtifactExtractionStage(
  options: ArtifactExtractionStageOptions,
): Promise<ArtifactExtractionStageResult> {
  const issue = await hydrateIssueForArtifactExtraction(options);
  const extraction = await options.runStep(
    "extract issue artifact sources",
    async () => {
      await options.progress(
        "info",
        "artifact-extraction",
        "reading deterministic issue artifact sources",
        { issueNumber: issue.number },
      );
      return extractPublishedArtifactResult(issue);
    },
  );

  return {
    issue,
    resolvedArtifacts: await validateExtractedArtifactSources({
      issue,
      repoRoot: options.config.repoRoot,
      specsDir: options.config.specsDir,
      plansDir: options.config.plansDir,
      now: options.now,
      extraction,
    }),
  };
}
