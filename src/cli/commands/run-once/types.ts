import type { CommandRunner, IssueSummary } from "../triage/types.ts";
import type { PatchmillHostConfig } from "../../../config/types.ts";
import type { PatchmillTriagePolicy } from "../../../policy/triage.ts";
import type { PatchmillProjectPolicy } from "../../../policy/types.ts";
import type { PatchmillLabelCatalog } from "../../../policy/label-catalog.ts";
import type { WorkflowApprovalPolicy } from "../../../workflow/approval-policy.ts";
import type { PatchmillSkillsConfig } from "../../../workflow/skills.ts";
import type { RunCostReport } from "./run-cost.ts";

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
  showHelp?: boolean | undefined;
  quiet?: boolean | undefined;
  verbosePiOutput?: boolean | undefined;
  issueNumber?: number | undefined;
  planOnly: boolean;
  host: PatchmillHostConfig;
  teaLogin?: string | undefined;
  specsDir: string;
  plansDir: string;
  runStateDir: string;
  worktreeDir: string;
  cleanStatusIgnorePrefixes?: string[] | undefined;
  cleanupHook?: string | undefined;
  projectPolicy: PatchmillProjectPolicy;
  skills: PatchmillSkillsConfig;
  triagePolicy?: PatchmillTriagePolicy | undefined;
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
  approvalPolicy?: AgentIssueConfig["approvalPolicy"] | undefined;
  priorityLabels?: readonly string[] | undefined;
  excludedLabels?: readonly string[] | undefined;
};

export type IssueSelectionRejectionReason =
  | "non-open-state"
  | "blocking-labels"
  | "not-actionable"
  | "waiting-spec-approval"
  | "waiting-plan-approval";

export type IssueSelectionRejection = {
  issueNumber: number;
  title: string;
  state: string;
  labels: string[];
  workflowState: string;
  reason: IssueSelectionRejectionReason;
  blockingLabels?: string[] | undefined;
  missingLabel?: string | undefined;
};

export type IssueSelectionDiagnostics = {
  issue?: IssueSummary | undefined;
  rejections: IssueSelectionRejection[];
  consideredCount: number;
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
  | "specPublished"
  | "specReadyCommentPosted"
  | "planPathResolved"
  | "planCreated"
  | "planPublished"
  | "planReadyCommentPosted"
  | "readyLabelRestored"
  | "worktreeReady"
  | "implementationCompleted"
  | "prCostSummaryUpdated"
  | "visualEvidenceValidated"
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
  branch?: string | undefined;
  worktreePath?: string | undefined;
  specPath?: string | undefined;
  specCommit?: string | undefined;
  planPath?: string | undefined;
  planCommit?: string | undefined;
  checkpoints?: AgentIssueRunCheckpoints | undefined;
  implementationStatus?: "pr-created" | "merged" | undefined;
  prUrl?: string | undefined;
  mergeCommit?: string | undefined;
  commits?: string[] | undefined;
  validation?: string[] | undefined;
  reviewSummary?: string | undefined;
  landingDecision?: string | undefined;
  runCostReport?: RunCostReport | undefined;
  visualEvidence?: AgentIssueVisualEvidence[] | undefined;
  handoffCommentPosted?: boolean | undefined;
  failureCommentKeys?: string[] | undefined;
  blockerCommentKeys?: string[] | undefined;
  leaseProtocolVersion?: 1 | undefined;
  blockerQuestions?: AgentIssueBlockerQuestion[] | undefined;
  createdAt: string;
  updatedAt: string;
  claimedAt?: string | undefined;
  planningAt?: string | undefined;
  implementingAt?: string | undefined;
  blockedAt?: string | undefined;
  finishedAt?: string | undefined;
  lastError?: string | undefined;
};

export type AgentIssueRunStateUpdate = {
  issueNumber: number;
  status: AgentIssueRunStateStatus;
  title?: string | undefined;
  branch?: string | undefined;
  worktreePath?: string | undefined;
  specPath?: string | undefined;
  specCommit?: string | undefined;
  planPath?: string | undefined;
  planCommit?: string | undefined;
  checkpoints?: AgentIssueRunCheckpoints | undefined;
  resetCheckpoints?: boolean | undefined;
  implementationStatus?: "pr-created" | "merged" | undefined;
  prUrl?: string | undefined;
  mergeCommit?: string | undefined;
  commits?: string[] | undefined;
  validation?: string[] | undefined;
  reviewSummary?: string | undefined;
  landingDecision?: string | undefined;
  runCostReport?: RunCostReport | undefined;
  visualEvidence?: AgentIssueVisualEvidence[] | undefined;
  handoffCommentPosted?: boolean | undefined;
  failureCommentKeys?: string[] | undefined;
  blockerCommentKeys?: string[] | undefined;
  leaseProtocolVersion?: 1 | undefined;
  blockerQuestions?: AgentIssueBlockerQuestion[] | undefined;
  lastError?: string | undefined;
  clearLastError?: boolean | undefined;
  clearBlockerQuestions?: boolean | undefined;
};

export type AgentIssueImplementationResumeContext = {
  resumed: boolean;
  worktreeCreated: boolean;
  existingCommits: string[];
  priorBlockerReason?: string | undefined;
  priorBlockerQuestions?: AgentIssueBlockerQuestion[] | undefined;
  priorValidation?: string[] | undefined;
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
  commit?: string | undefined;
};

export type AgentIssuePlanCreatedResult = {
  status: "plan-created";
  planPath: string;
  commit?: string | undefined;
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

type AgentIssuePipelineResultLog = {
  logPath?: string | undefined;
  piSessionPath?: string | undefined;
};

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
        specPath?: string | undefined;
        planPath: string;
      }
    | AgentIssueApprovalRequiredResult
    | {
        status: "development-environment-not-ready";
        issue: IssueSummary;
        specPath?: string | undefined;
        planPath: string;
        branch?: string | undefined;
        worktreePath?: string | undefined;
        reason: string;
        evidence: string[];
        remediation: string[];
      }
    | ({
        issue: IssueSummary;
        specPath?: string | undefined;
        planPath: string;
        worktreePath: string;
      } & (AgentIssuePrCreatedResult | AgentIssueMergedResult))
    | ({
        issue: IssueSummary;
        specPath?: string | undefined;
        planPath?: string | undefined;
        worktreePath?: string | undefined;
        branch?: string | undefined;
      } & AgentIssueBlockedResult)
  );

// Recovery is deliberately modelled separately from persisted run status. A Run
// attempt can recover any existing status without inventing a transient status.
export type RunRecoveryIntent = "retry" | "reset";
export type RunRecoveryClassification =
  | "resumable-current"
  | "resumable-stale-base"
  | "resumable-with-commits"
  | "recreatable-clean"
  | "dirty-worktree"
  | "ignored-worktree-content"
  | "unmerged-commits"
  | "workspace-unverifiable"
  | "legacy-active-unfenced";
export type RunRecoveryLeaseOwner = {
  version: 1;
  issueNumber: number;
  pid: number;
  hostname: string;
  ownerToken: string;
  acquiredAt: string;
};
export type RunLegacyMigrationFence = {
  version: 1;
  issueNumber: number;
  status: "claimed" | "planning" | "implementing";
  stateSha256: string;
  repairedAt: string;
};
export type RunResetSeed = {
  issueNumber: number;
  title: string;
  specPath?: string | undefined;
  specCommit?: string | undefined;
  planPath?: string | undefined;
  planCommit?: string | undefined;
  startedCommentPosted?: true | undefined;
};
export type RunRecoveryArtifactAssessment = {
  path?: string | undefined;
  commit?: string | undefined;
  valid: boolean;
  source?: "base" | "published" | undefined;
};
export type RunRecoveryAssessment = {
  runStatePath: string;
  issueNumber: number;
  title: string;
  status: AgentIssueRunStateStatus;
  lease: { status: "owned"; ownerToken: string };
  leaseProtocolVersion?: 1 | undefined;
  legacyMigrationFenceValid: boolean;
  blocked: boolean;
  startedCommentPosted?: true | undefined;
  blockerReason?: string | undefined;
  blockerQuestions?: AgentIssueBlockerQuestion[] | undefined;
  expectedWorkspace: { branch: string; worktreePath: string };
  savedWorkspace: {
    branch?: string | undefined;
    worktreePath?: string | undefined;
  };
  baseOid: string;
  branch: {
    exists: boolean;
    oid?: string | undefined;
    checkedOutAt?: string | undefined;
  };
  worktree: {
    exists: boolean;
    registered: boolean;
    registeredBranch?: string | undefined;
    clean?: boolean | undefined;
    dirtyStatus?: string | undefined;
    ignoredStatus?: string | undefined;
    ignoredEntries: string[];
  };
  divergence?: { ahead: number; behind: number } | undefined;
  actualUniqueCommits: string[];
  savedCommits: string[];
  artifacts: {
    spec: RunRecoveryArtifactAssessment;
    plan: RunRecoveryArtifactAssessment;
  };
  classification: RunRecoveryClassification;
};
export type RunRecoveryRefreshPlan = {
  branch: string;
  expectedWorktreePath: string;
  expectedBranchOid: string;
  baseOid: string;
  quarantinePath: string;
  stagingPath: string;
};
export type RunRecoveryRecreationPlan = {
  branch: string;
  expectedWorktreePath: string;
  mode: "reuse-existing" | "create-from-base" | "advance-to-base";
  expectedBranchOid?: string | undefined;
  targetOid: string;
  stagingPath: string;
};
export type RunRecoveryCleanupPlan = {
  branch?: string | undefined;
  expectedWorktreePath?: string | undefined;
  expectedBranchOid?: string | undefined;
  quarantinePath?: string | undefined;
};
export type RunRecoveryDecision =
  | { action: "resume"; assessment: RunRecoveryAssessment }
  | {
      action: "refresh-and-resume";
      assessment: RunRecoveryAssessment;
      refresh: RunRecoveryRefreshPlan;
    }
  | {
      action: "recreate-and-resume";
      assessment: RunRecoveryAssessment;
      recreation: RunRecoveryRecreationPlan;
    }
  | {
      action: "archive-reset-and-start";
      assessment: RunRecoveryAssessment;
      seed: RunResetSeed;
      cleanup: RunRecoveryCleanupPlan;
    }
  | {
      action: "refuse";
      assessment: RunRecoveryAssessment;
      reason: RunRecoveryClassification | "not-blocked";
      guidance: string[];
    }
  | {
      action: "refuse";
      reason: "active-run";
      resource: "lease" | "lease-guard" | "repair-lock";
      leasePath: string;
      owner?: RunRecoveryLeaseOwner | undefined;
      guidance: string[];
    };
export type PlanRunRecoveryInput = {
  intent: RunRecoveryIntent;
  runner: CommandRunner;
  repoRoot: string;
  runStatePath: string;
  state: AgentIssueRunState;
  baseRef: string;
  expectedWorkspace: { branch: string; worktreePath: string };
  ignoredPaths?: string[] | undefined;
  resolvedArtifacts?:
    | import("./artifact-sources.ts").ResolvedIssueArtifactSources
    | undefined;
  leaseOwnerToken: string;
  snapshotRaw: string;
  legacyMigrationFence?: RunLegacyMigrationFence | undefined;
  /** Allocated once by orchestration and reused across every reassessment. */
  recoveryPaths: { quarantinePath: string; stagingPath: string };
};
export type IssueRunLease = { path: string; record: RunRecoveryLeaseOwner };
export type RunStateSnapshot = {
  path: string;
  raw: string;
  state: AgentIssueRunState;
};
