import type { PatchmillHostConfig } from "../../../config/types.ts";
import type { PatchmillTriagePolicy } from "../../../policy/triage.ts";
import type { PatchmillProjectPolicy } from "../../../policy/types.ts";
import type { PatchmillLabelCatalog } from "../../../policy/label-catalog.ts";
import type { WorkflowApprovalPolicy } from "../../../workflow/approval-policy.ts";
import type { PatchmillSkillsConfig } from "../../../workflow/skills.ts";

export type {
  CommandResult,
  CommandRunOptions,
  CommandRunner,
  HumanDecisionQuestion,
  IssueSummary,
} from "../triage/types.ts";
export type { AgentIssueProgressEvent, ProgressReporter } from "./progress.ts";

export type AgentIssueConfig = {
  repoRoot: string;
  dryRun: boolean;
  execute: boolean;
  showHelp?: boolean;
  quiet?: boolean;
  verbosePiOutput?: boolean;
  issueNumber?: number;
  planOnly: boolean;
  host: PatchmillHostConfig;
  teaLogin?: string;
  specsDir: string;
  plansDir: string;
  runStateDir: string;
  worktreeDir: string;
  cleanStatusIgnorePrefixes?: string[];
  cleanupHook?: string;
  projectPolicy: PatchmillProjectPolicy;
  skills: PatchmillSkillsConfig;
  triagePolicy?: PatchmillTriagePolicy;
  readyLabel: string;
  issueLimit: 1;
  labelCatalog: PatchmillLabelCatalog;
  approvalPolicy: WorkflowApprovalPolicy;
  baseBranch: string;
  baseRef: string;
  remote: string;
  branchPrefix: string;
  worktreePrefix: string;
  slugLength: number;
  allowDirectLand: boolean;
};

export type IssueSelectionOptions = Pick<
  AgentIssueConfig,
  "issueNumber" | "readyLabel" | "triagePolicy"
> & {
  approvalPolicy?: AgentIssueConfig["approvalPolicy"];
  priorityLabels?: readonly string[];
  excludedLabels?: readonly string[];
};

export type AgentIssuePlan = {
  issueNumber: number;
  path: string;
};

export type AgentIssueRunStateStatus =
  | "claimed"
  | "planning"
  | "implementing"
  | "blocked"
  | "finished";

export type AgentIssueRunCheckpoint =
  | "claimed"
  | "startedCommentPosted"
  | "specPathResolved"
  | "specCreated"
  | "specReadyCommentPosted"
  | "planPathResolved"
  | "planCreated"
  | "planReadyCommentPosted"
  | "readyLabelRestored"
  | "worktreeReady"
  | "implementationCompleted"
  | "visualEvidenceUploaded"
  | "handoffCommentPosted"
  | "doneLabelEnsured"
  | "doneLabelApplied";

export type AgentIssueRunCheckpoints = Partial<
  Record<AgentIssueRunCheckpoint, true>
>;

export type AgentIssueRunState = {
  issueNumber: number;
  title: string;
  status: AgentIssueRunStateStatus;
  branch?: string;
  worktreePath?: string;
  specPath?: string;
  specCommit?: string;
  planPath?: string;
  planCommit?: string;
  checkpoints?: AgentIssueRunCheckpoints;
  implementationStatus?: "pr-created" | "merged";
  prUrl?: string;
  mergeCommit?: string;
  commits?: string[];
  validation?: string[];
  reviewSummary?: string;
  landingDecision?: string;
  visualEvidence?: AgentIssueVisualEvidence[];
  handoffCommentPosted?: boolean;
  failureCommentKeys?: string[];
  createdAt: string;
  updatedAt: string;
  claimedAt?: string;
  planningAt?: string;
  implementingAt?: string;
  blockedAt?: string;
  finishedAt?: string;
  lastError?: string;
};

export type AgentIssueRunStateUpdate = {
  issueNumber: number;
  status: AgentIssueRunStateStatus;
  title?: string;
  branch?: string;
  worktreePath?: string;
  specPath?: string;
  specCommit?: string;
  planPath?: string;
  planCommit?: string;
  checkpoints?: AgentIssueRunCheckpoints;
  resetCheckpoints?: boolean;
  implementationStatus?: "pr-created" | "merged";
  prUrl?: string;
  mergeCommit?: string;
  commits?: string[];
  validation?: string[];
  reviewSummary?: string;
  landingDecision?: string;
  visualEvidence?: AgentIssueVisualEvidence[];
  handoffCommentPosted?: boolean;
  failureCommentKeys?: string[];
  lastError?: string;
};

export type AgentIssueImplementationResumeContext = {
  resumed: boolean;
  worktreeCreated: boolean;
  existingCommits: string[];
};

export type AgentIssueBlockerQuestion =
  | string
  | import("../triage/types.ts").HumanDecisionQuestion;

export type AgentIssueBlockedResult = {
  status: "blocked";
  reason: string;
  questions: AgentIssueBlockerQuestion[];
  commits: string[];
  validation: string[];
};

export type AgentIssueSpecCreatedResult = {
  status: "spec-created";
  specPath: string;
  commit?: string;
};

export type AgentIssuePlanCreatedResult = {
  status: "plan-created";
  planPath: string;
  commit?: string;
};

export type AgentIssueApprovalRequiredResult = {
  status: "approval-required";
  issue: IssueSummary;
  approvalKind: "spec" | "plan";
  missingLabel: string;
};

export type AgentIssueDevelopmentEnvironmentReadyResult = {
  status: "ready";
  summary: string;
  evidence: string[];
  environment?: Record<string, string>;
};

export type AgentIssueDevelopmentEnvironmentNotReadyResult = {
  status: "not-ready";
  reason: string;
  evidence: string[];
  remediation: string[];
};

export type AgentIssueDevelopmentEnvironmentResult =
  | AgentIssueDevelopmentEnvironmentReadyResult
  | AgentIssueDevelopmentEnvironmentNotReadyResult;

export type AgentIssueDevelopmentEnvironmentHandoff =
  AgentIssueDevelopmentEnvironmentReadyResult & {
    completedAt: string;
  };

export type AgentIssueVisualEvidence = {
  screenshotPath: string;
  caption?: string;
  referencePaths?: string[];
  url?: string;
};

export type AgentIssuePrCreatedResult = {
  status: "pr-created";
  prUrl: string;
  branch: string;
  commits: string[];
  validation: string[];
  reviewSummary?: string;
  landingDecision?: string;
  visualEvidence?: AgentIssueVisualEvidence[];
};

export type AgentIssueMergedResult = {
  status: "merged";
  branch: string;
  mergeCommit: string;
  commits: string[];
  validation: string[];
  reviewSummary?: string;
  landingDecision?: string;
};

export type AgentIssuePiResult =
  | AgentIssueBlockedResult
  | AgentIssueSpecCreatedResult
  | AgentIssuePlanCreatedResult
  | AgentIssuePrCreatedResult
  | AgentIssueMergedResult;

type AgentIssuePipelineResultLog = { logPath?: string };

export type AgentIssuePipelineResult = AgentIssuePipelineResultLog &
  (
    | { status: "no-issue" }
    | { status: "dry-run"; issue: IssueSummary; transition: string }
    | {
        status: "spec-created" | "spec-found";
        issue: IssueSummary;
        specPath: string;
      }
    | {
        status: "plan-created" | "plan-found";
        issue: IssueSummary;
        specPath?: string;
        planPath: string;
      }
    | AgentIssueApprovalRequiredResult
    | {
        status: "development-environment-not-ready";
        issue: IssueSummary;
        specPath?: string;
        planPath: string;
        branch?: string;
        worktreePath?: string;
        reason: string;
        evidence: string[];
        remediation: string[];
      }
    | ({
        issue: IssueSummary;
        specPath?: string;
        planPath: string;
        worktreePath: string;
      } & (AgentIssuePrCreatedResult | AgentIssueMergedResult))
    | ({
        issue: IssueSummary;
        specPath?: string;
        planPath?: string;
        worktreePath?: string;
        branch?: string;
      } & AgentIssueBlockedResult)
  );
