import type { PatchmillHostConfig } from "../../../config/types.ts";
import type { PatchmillProjectPolicy } from "../../../policy/types.ts";
import type { PatchmillTriagePolicy } from "../../../policy/triage.ts";
import type { PatchmillTriageCanonicalBucket } from "../../../policy/triage-state.ts";
import type { PatchmillSkillsConfig } from "../../../workflow/skills.ts";

export type TriageProgressEvent =
  | { type: "selected"; total: number }
  | {
      type: "issue";
      issue: TriageLogIssueEntry;
      completed: number;
      total: number;
    };

export type TriageProgressHandler = (event: TriageProgressEvent) => void;

export type TriageToolCallEvent = {
  toolName?: string;
  toolCallId?: string;
  arguments?: Record<string, unknown>;
};

export type TriageToolCallHandler = (event: TriageToolCallEvent) => void;

export type TriageConfig = {
  repoRoot: string;
  dryRun: boolean;
  execute: boolean;
  triageThinking: string;
  showHelp?: boolean;
  host: PatchmillHostConfig;
  teaLogin?: string;
  issueNumber?: number;
  limit?: number;
  all?: boolean;
  logDir: string;
  projectPolicy?: PatchmillProjectPolicy;
  triagePolicy?: PatchmillTriagePolicy;
  skills: PatchmillSkillsConfig;
  onProgress?: TriageProgressHandler;
  onToolCall?: TriageToolCallHandler;
};

export type CommandResult = {
  code: number;
  stdout: string;
  stderr: string;
};

export type CommandRunOptions = {
  cwd?: string;
  env?: Record<string, string | undefined>;
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
  url?: string;
  author?: string;
  updated?: string;
  comments?: unknown[];
};

export type LabelDefinition = {
  name: string;
  color: string;
  description: string;
};

export type PrimaryBucket = PatchmillTriageCanonicalBucket;

export type HumanDecisionQuestion = {
  question: string;
  recommendedAnswer: string;
};

export type TriageQuestion = string | HumanDecisionQuestion;

export type RawTriagePreview = {
  issueNumber: unknown;
  currentLabels: unknown;
  proposedLabels: unknown;
  canonicalBucket: unknown;
  blockedBy?: unknown;
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
  blockedBy: number[];
  rationale: string;
  wouldComment: string | null;
  wouldClose: boolean;
  questions: string[];
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
  url?: string;
  previousLabels: string[];
  finalLabels: string[];
  primaryBucket?: PrimaryBucket;
  blockedBy?: number[];
  rationale?: string;
  questions: TriageQuestion[];
  comment: string | null;
  addedComments?: string[];
  previousState?: string;
  finalState?: string;
  wouldClose?: boolean;
  mutationStatus: "preview" | "observed" | "failed";
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
