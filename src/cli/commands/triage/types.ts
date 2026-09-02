import type { HumanDecisionQuestion } from "../../../workflow/decisions.ts";
import type { PatchmillHostConfig } from "../../../config/types.ts";
import type { PatchmillProjectPolicy } from "../../../policy/types.ts";
import type { PatchmillTriagePolicy } from "../../../policy/triage.ts";
import type { PatchmillTriageCanonicalBucket } from "../../../policy/triage-state.ts";
import type { PatchmillSkillsConfig } from "../../../workflow/skills.ts";

export type {
  CommandResult,
  CommandRunOptions,
  CommandRunner,
} from "../../../command/types.ts";

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

export type {
  IssueCommentSummary,
  IssueSummary,
  LabelChangePlan,
  LabelDefinition,
} from "../../../issue/types.ts";

export type PrimaryBucket = PatchmillTriageCanonicalBucket;

export type { HumanDecisionQuestion } from "../../../workflow/decisions.ts";

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

export type TriageLogIssueEntry = {
  issueNumber: number;
  title: string;
  url?: string | undefined;
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
