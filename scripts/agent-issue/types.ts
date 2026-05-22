import type { ResolvedAgentTeam } from "./agent-team.ts";

export type {
  CommandResult,
  CommandRunOptions,
  CommandRunner,
  HumanDecisionQuestion,
  IssueSummary,
} from "../agent-issue-triage/types.ts";
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
  teaLogin?: string;
  agentTeamName?: string;
  agentTeam?: ResolvedAgentTeam;
  plansDir: string;
  runStateDir: string;
  readyLabel: "agent-ready";
  issueLimit: 1;
  requirePlanApproval: false;
};

export type IssueSelectionOptions = Pick<
  AgentIssueConfig,
  "issueNumber" | "readyLabel"
>;

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

export type AgentIssueRunCheckpoints = Partial<Record<AgentIssueRunCheckpoint, true>>;

export type AgentIssueRunState = {
  issueNumber: number;
  title: string;
  status: AgentIssueRunStateStatus;
  branch?: string;
  worktreePath?: string;
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

export type AgentIssueQuestion =
  | string
  | import("../agent-issue-triage/types.ts").HumanDecisionQuestion;

export type AgentIssueBlockedResult = {
  status: "blocked";
  reason: string;
  questions: AgentIssueQuestion[];
  commits: string[];
  validation: string[];
};

export type AgentIssuePlanCreatedResult = {
  status: "plan-created";
  planPath: string;
  commit?: string;
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
  | AgentIssuePlanCreatedResult
  | AgentIssuePrCreatedResult
  | AgentIssueMergedResult;

type AgentIssuePipelineResultLog = { logPath?: string };

export type AgentIssuePipelineResult = AgentIssuePipelineResultLog &
  (
    | { status: "no-issue" }
    | { status: "dry-run"; issue: IssueSummary }
    | {
        status: "plan-created" | "plan-found";
        issue: IssueSummary;
        planPath: string;
      }
    | ({
        issue: IssueSummary;
        planPath: string;
        worktreePath: string;
      } & (AgentIssuePrCreatedResult | AgentIssueMergedResult))
    | ({
        issue: IssueSummary;
        planPath?: string;
        worktreePath?: string;
        branch?: string;
      } & AgentIssueBlockedResult)
  );
