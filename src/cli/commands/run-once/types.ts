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
  blockingLabels?: string[];
  missingLabel?: string;
};

export type IssueSelectionDiagnostics = {
  issue?: IssueSummary;
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
  runCostReport?: RunCostReport;
  visualEvidence?: AgentIssueVisualEvidence[];
  handoffCommentPosted?: boolean;
  failureCommentKeys?: string[];
  blockerCommentKeys?: string[];
  leaseProtocolVersion?: 1;
  blockerQuestions?: AgentIssueBlockerQuestion[];
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
  runCostReport?: RunCostReport;
  visualEvidence?: AgentIssueVisualEvidence[];
  handoffCommentPosted?: boolean;
  failureCommentKeys?: string[];
  blockerCommentKeys?: string[];
  leaseProtocolVersion?: 1;
  blockerQuestions?: AgentIssueBlockerQuestion[];
  lastError?: string;
  clearLastError?: boolean;
  clearBlockerQuestions?: boolean;
};

export type AgentIssueImplementationResumeContext = {
  resumed: boolean;
  worktreeCreated: boolean;
  existingCommits: string[];
  priorBlockerReason?: string;
  priorBlockerQuestions?: AgentIssueBlockerQuestion[];
  priorValidation?: string[];
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

type AgentIssuePipelineResultLog = {
  logPath?: string;
  piSessionPath?: string;
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
  specPath?: string;
  specCommit?: string;
  planPath?: string;
  planCommit?: string;
  startedCommentPosted?: true;
};
export type RunRecoveryArtifactAssessment = {
  path?: string;
  commit?: string;
  valid: boolean;
  source?: "base" | "published";
};
export type RunRecoveryAssessment = {
  runStatePath: string;
  issueNumber: number;
  title: string;
  status: AgentIssueRunStateStatus;
  lease: { status: "owned"; ownerToken: string };
  leaseProtocolVersion?: 1;
  legacyMigrationFenceValid: boolean;
  blocked: boolean;
  startedCommentPosted?: true;
  blockerReason?: string;
  blockerQuestions?: AgentIssueBlockerQuestion[];
  expectedWorkspace: { branch: string; worktreePath: string };
  savedWorkspace: { branch?: string; worktreePath?: string };
  baseOid: string;
  branch: { exists: boolean; oid?: string; checkedOutAt?: string };
  worktree: {
    exists: boolean;
    registered: boolean;
    registeredBranch?: string;
    clean?: boolean;
    dirtyStatus?: string;
    ignoredStatus?: string;
    ignoredEntries: string[];
  };
  divergence?: { ahead: number; behind: number };
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
  expectedBranchOid?: string;
  targetOid: string;
  pruneStaleRegistration: boolean;
  stagingPath: string;
};
export type RunRecoveryCleanupPlan = {
  branch?: string;
  expectedWorktreePath?: string;
  expectedBranchOid?: string;
  quarantinePath?: string;
  pruneStaleRegistration: boolean;
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
      owner?: RunRecoveryLeaseOwner;
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
  ignoredPaths?: string[];
  resolvedArtifacts?: import("./artifact-sources.ts").ResolvedIssueArtifactSources;
  leaseOwnerToken: string;
  snapshotRaw: string;
  legacyMigrationFence?: RunLegacyMigrationFence;
  /** Reused across reassessment so one Run attempt never changes mutation paths. */
  recoveryPaths?: { quarantinePath: string; stagingPath: string };
};
export type IssueRunLease = { path: string; record: RunRecoveryLeaseOwner };
export type RunStateSnapshot = {
  path: string;
  raw: string;
  state: AgentIssueRunState;
};
export type RunResetContext = {
  lease: IssueRunLease;
  archivePath: string;
  quarantinePaths: string[];
  seed: RunResetSeed;
};
