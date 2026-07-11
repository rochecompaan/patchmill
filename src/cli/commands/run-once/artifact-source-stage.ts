import type { IssueHostProvider } from "../../../host/types.ts";
import {
  extractPublishedArtifactsFromIssue,
  findUntrustedPublishedArtifactDiagnostics,
  issueHasPublishedArtifactMarker,
} from "../../../workflow/artifacts/published-artifacts.ts";
import {
  validateIssueArtifactSources,
  type ResolvedIssueArtifactSources,
} from "./artifact-sources.ts";
import type {
  AgentIssueConfig,
  AgentIssueProgressEvent,
  IssueSummary,
} from "./types.ts";

export type ArtifactSourceStageResult = {
  issue: IssueSummary;
  resolvedArtifacts: ResolvedIssueArtifactSources;
};

type ArtifactSourceStageOptions = {
  host: IssueHostProvider;
  config: AgentIssueConfig;
  issue: IssueSummary;
  now: Date;
  progress: (
    level: AgentIssueProgressEvent["level"],
    stage: string,
    message: string,
    extras?: Partial<
      Pick<
        AgentIssueProgressEvent,
        "issueNumber" | "elapsedSeconds" | "data" | "consoleMessage"
      >
    >,
  ) => Promise<void>;
  runStep: <T>(label: string, fn: () => Promise<T>) => Promise<T>;
};

async function hydrateIssueForArtifactSources(
  options: ArtifactSourceStageOptions,
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

export async function runArtifactSourceStage(
  options: ArtifactSourceStageOptions,
): Promise<ArtifactSourceStageResult> {
  const issue = await hydrateIssueForArtifactSources(options);
  const artifacts = await options.runStep(
    "extract issue artifact sources",
    async () => {
      await options.progress(
        "info",
        "artifact-extraction",
        "reading deterministic issue artifact sources",
        { issueNumber: issue.number },
      );
      const trustedAuthors = issueHasPublishedArtifactMarker(issue)
        ? await options.host.trustedTriageCommentAuthors()
        : [];
      for (const diagnostic of findUntrustedPublishedArtifactDiagnostics(
        issue,
        { trustedAuthors },
      )) {
        await options.progress(
          "info",
          "artifact-extraction",
          "untrusted deterministic issue artifact source",
          {
            issueNumber: issue.number,
            consoleMessage: `⚠ found ${diagnostic.kind} artifact from ${diagnostic.authorLogin}, but ${diagnostic.authorLogin} is not a trusted artifact author`,
          },
        );
      }
      return extractPublishedArtifactsFromIssue(issue, { trustedAuthors });
    },
  );

  return {
    issue,
    resolvedArtifacts: await validateIssueArtifactSources({
      issue,
      repoRoot: options.config.repoRoot,
      specsDir: options.config.specsDir,
      plansDir: options.config.plansDir,
      artifacts,
    }),
  };
}
