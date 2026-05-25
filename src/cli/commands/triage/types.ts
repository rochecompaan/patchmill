import type { PatchmillProjectPolicy } from "../../../policy/types.ts";
import type {
  PatchmillTriageConfidence,
  PatchmillTriagePolicy,
  PatchmillTriagePrimaryBucketStatus,
} from "../../../policy/triage.ts";
import type { PatchmillTriageCanonicalBucket } from "../../../policy/triage-state.ts";
import type { PatchmillSkillsConfig } from "../../../workflow/skills.ts";

export type TriageConfig = {
  repoRoot: string;
  dryRun: boolean;
  execute: boolean;
  triageThinking: string;
  showHelp?: boolean;
  teaLogin?: string;
  issueNumber?: number;
  limit?: number;
  all?: boolean;
  logDir: string;
  projectPolicy?: PatchmillProjectPolicy;
  triagePolicy?: PatchmillTriagePolicy;
  skills: PatchmillSkillsConfig;
};

export type CommandResult = {
  code: number;
  stdout: string;
  stderr: string;
};

export type CommandRunOptions = {
  cwd?: string;
  onStdout?: (chunk: string) => void;
  onStderr?: (chunk: string) => void;
};

export type CommandRunner = {
  run(
    command: string,
    args: string[],
    options?: CommandRunOptions,
  ): Promise<CommandResult>;
};

export type IssueSummary = {
  number: number;
  title: string;
  body: string;
  labels: string[];
  state: string;
  author?: string;
  updated?: string;
  comments?: unknown[];
};

export type LabelDefinition = {
  name: string;
  color: string;
  description: string;
};

export type PrimaryBucket = PatchmillTriagePrimaryBucketStatus;

export type Confidence = PatchmillTriageConfidence;

export type RawTriageDecision = {
  issueNumber: unknown;
  primaryBucket: unknown;
  labels: unknown;
  confidence: unknown;
  rationale: unknown;
  questions: unknown;
  comment: unknown;
};

export type HumanDecisionQuestion = {
  question: string;
  recommendedAnswer: string;
};

export type TriageQuestion = string | HumanDecisionQuestion;

export type RawTriageDocument = {
  decisions: unknown;
};

export type RawTriagePreview = {
  issueNumber: unknown;
  currentLabels: unknown;
  proposedLabels: unknown;
  canonicalBucket: unknown;
  rationale: unknown;
  wouldComment?: unknown;
  wouldClose?: unknown;
  questions?: unknown;
};

export type RawTriagePreviewDocument = {
  previews: unknown;
};

export type TriagePreview = {
  issueNumber: number;
  currentLabels: string[];
  proposedLabels: string[];
  canonicalBucket: PatchmillTriageCanonicalBucket;
  rationale: string;
  wouldComment: string | null;
  wouldClose: boolean;
  questions: string[];
};

export type TriageDecision = {
  issueNumber: number;
  primaryBucket: PrimaryBucket;
  labels: string[];
  confidence: Confidence;
  rationale: string;
  questions: TriageQuestion[];
  comment: string | null;
};

export type LabelChangePlan = {
  issueNumber: number;
  oldLabels: string[];
  newLabels: string[];
  addLabels: string[];
  removeLabels: string[];
};

export type TriageLogIssueEntry = {
  issueNumber: number;
  title: string;
  previousLabels: string[];
  finalLabels: string[];
  primaryBucket: PrimaryBucket;
  confidence: Confidence;
  rationale: string;
  questions: TriageQuestion[];
  comment: string | null;
  mutationStatus: "planned" | "applied" | "failed";
  error?: string;
};

export type TriageLog = {
  mode: "dry-run" | "execute";
  createdAt: string;
  issues: TriageLogIssueEntry[];
  error?: string;
};

export type TriageResult = {
  status: "no-issues" | "dry-run" | "applied";
  issueCount: number;
  logPath: string;
  issues: TriageLogIssueEntry[];
};
