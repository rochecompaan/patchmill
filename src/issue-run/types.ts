import type { HumanDecisionQuestion } from "../workflow/decisions.ts";

export type AgentIssueImplementationResumeContext = {
  resumed: boolean;
  worktreeCreated: boolean;
  existingCommits: string[];
  priorBlockerReason?: string | undefined;
  priorBlockerQuestions?: AgentIssueBlockerQuestion[] | undefined;
  priorValidation?: string[] | undefined;
};

export type AgentIssueBlockerQuestion = string | HumanDecisionQuestion;

export type PromptTriageLabels = {
  ready: string;
  needsInfo: string;
};

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
  commit?: string | undefined;
};

export type AgentIssuePlanCreatedResult = {
  status: "plan-created";
  planPath: string;
  commit?: string | undefined;
};

export type AgentIssueDevelopmentEnvironmentReadyResult = {
  status: "ready";
  summary: string;
  evidence: string[];
  environment?: Record<string, string> | undefined;
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
  caption?: string | undefined;
  referencePaths?: string[] | undefined;
  url?: string | undefined;
};

export type AgentIssuePrCreatedResult = {
  status: "pr-created";
  prUrl: string;
  branch: string;
  commits: string[];
  validation: string[];
  reviewSummary?: string | undefined;
  landingDecision?: string | undefined;
  visualEvidence?: AgentIssueVisualEvidence[] | undefined;
};

export type AgentIssueMergedResult = {
  status: "merged";
  branch: string;
  mergeCommit: string;
  commits: string[];
  validation: string[];
  reviewSummary?: string | undefined;
  landingDecision?: string | undefined;
};

export type AgentIssuePiResult =
  | AgentIssueBlockedResult
  | AgentIssueSpecCreatedResult
  | AgentIssuePlanCreatedResult
  | AgentIssuePrCreatedResult
  | AgentIssueMergedResult;
