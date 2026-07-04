import type { IssueHostProvider } from "../../../host/types.ts";
import {
  extractIssueArtifactsWithPi,
  type ArtifactExtractionResult,
} from "./artifact-source-extraction.ts";
import {
  validateExtractedArtifactSources,
  type ResolvedIssueArtifactSources,
} from "./artifact-sources.ts";
import type {
  AgentIssueConfig,
  AgentIssueProgressEvent,
  CommandRunner,
  IssueSummary,
  ProgressReporter,
} from "./types.ts";

export type ArtifactExtractionStageResult = {
  issue: IssueSummary;
  resolvedArtifacts: ResolvedIssueArtifactSources;
};

type ArtifactExtractionStageOptions = {
  runner: CommandRunner;
  host: IssueHostProvider;
  config: AgentIssueConfig;
  issue: IssueSummary;
  now: Date;
  heartbeatMs?: number;
  streamPiOutput?: (chunk: string) => void;
  verbosePiOutput?: boolean;
  piAgentDir: string;
  tokenUsageState: { total: number };
  progressReporter?: ProgressReporter;
  progress: (
    level: AgentIssueProgressEvent["level"],
    stage: string,
    message: string,
    extras?: Partial<
      Pick<AgentIssueProgressEvent, "issueNumber" | "elapsedSeconds" | "data">
    >,
  ) => Promise<void>;
  runStep: <T>(label: string, fn: () => Promise<T>) => Promise<T>;
  observePi: (
    stage: "pi-artifact-extraction",
  ) => (observation: AgentIssueProgressEvent["observation"]) => Promise<void>;
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
    async (): Promise<ArtifactExtractionResult> => {
      await options.progress(
        "info",
        "artifact-extraction",
        "extracting issue artifact sources",
        { issueNumber: issue.number },
      );
      return await extractIssueArtifactsWithPi({
        runner: options.runner,
        repoRoot: options.config.repoRoot,
        issue,
        specsDir: options.config.specsDir,
        plansDir: options.config.plansDir,
        artifactExtractionSkill: options.config.skills.artifactExtraction,
        heartbeatMs: options.heartbeatMs,
        streamOutput: options.streamPiOutput,
        verbosePiOutput: options.verbosePiOutput,
        tokenUsageState: options.tokenUsageState,
        progress: options.progressReporter,
        observeSession: true,
        onObservation: options.observePi("pi-artifact-extraction"),
        piAgentDir: options.piAgentDir,
      });
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
