import type {
  PlanningHeadAdoptionFailure,
  PlanningWorkspaceCleanup,
} from "../../../git/planning-workspaces.ts";

export const RUN_ONCE_REASON_CODES = [
  "non-open-state",
  "blocking-labels",
  "not-actionable",
  "waiting-spec-approval",
  "waiting-plan-approval",
  "plan-only",
  "issue-locked",
  "ignored-worktree-content",
  "issue-lock-stale",
  "issue-lock-unverifiable",
  "issue-lock-malformed",
  "planning-state-invalid",
  "planning-identity-changed",
  "planning-run-id-mismatch",
  "planning-workspace-dirty",
  "ambiguous-base-artifact",
  "planning-pull-request-closed-unmerged",
  "planning-pull-request-missing",
  "planning-pull-request-ambiguous",
  "planning-merge-recovery-blocked",
  "planning-head-adoption-blocked",
  "implementation-configuration",
  "implementation-workspace",
  "implementation-direct-merge",
  "implementation-ancestry",
  "implementation-remote-head",
  "implementation-url",
  "implementation-branch",
  "implementation-evidence",
  "active-run",
  "dirty-worktree",
  "unmerged-commits",
  "workspace-unverifiable",
  "legacy-active-unfenced",
  "not-blocked",
  "agent-blocked",
  "development-environment-not-ready",
  "implementation-validation",
  "planning-workspace-conflict",
  "unexpected-error",
] as const;
export type RunOnceReasonCode = (typeof RUN_ONCE_REASON_CODES)[number];
export type IssueSelectionReasonCode = Extract<
  RunOnceReasonCode,
  | "non-open-state"
  | "blocking-labels"
  | "not-actionable"
  | "waiting-spec-approval"
  | "waiting-plan-approval"
>;
export type GeneralDiagnosticReasonCode = Extract<
  RunOnceReasonCode,
  | IssueSelectionReasonCode
  | "plan-only"
  | "issue-locked"
  | "ignored-worktree-content"
  | "agent-blocked"
  | "development-environment-not-ready"
  | "unexpected-error"
>;
export type PlanningDiagnosticReasonCode = Extract<
  RunOnceReasonCode,
  | "issue-lock-stale"
  | "issue-lock-unverifiable"
  | "issue-lock-malformed"
  | "planning-state-invalid"
  | "planning-identity-changed"
  | "planning-run-id-mismatch"
  | "planning-workspace-dirty"
  | "ambiguous-base-artifact"
  | "planning-pull-request-closed-unmerged"
  | "planning-pull-request-missing"
  | "planning-pull-request-ambiguous"
  | "planning-merge-recovery-blocked"
  | "planning-head-adoption-blocked"
  | "planning-workspace-conflict"
>;
export type ImplementationDiagnosticReasonCode = Extract<
  RunOnceReasonCode,
  | "implementation-configuration"
  | "implementation-workspace"
  | "implementation-direct-merge"
  | "implementation-ancestry"
  | "implementation-remote-head"
  | "implementation-url"
  | "implementation-branch"
  | "implementation-evidence"
  | "implementation-validation"
>;
export type RecoveryDiagnosticReasonCode = Extract<
  RunOnceReasonCode,
  | "active-run"
  | "dirty-worktree"
  | "unmerged-commits"
  | "workspace-unverifiable"
  | "legacy-active-unfenced"
  | "not-blocked"
>;

export type RunOnceDiagnostic = {
  summary: string;
  explanation: string;
  details: Array<{
    key: string;
    label: string;
    value: string | number | readonly string[];
  }>;
  actions: Array<{ description: string; command?: string }>;
  safety: readonly string[];
  retry: {
    kind: "retry-now" | "after-action" | "same-result" | "inspect-first";
    guidance: string;
  };
};
type Base = { issueNumber?: number; status?: string };
type Workspace = Base & {
  phase?: "spec" | "plan" | "implementation";
  branch?: string;
  worktreePath?: string;
  workspaceState?: string;
  statusEvidence?: string;
};
type Lock = Base & {
  lockPath: string;
  fingerprint: string;
  owner?: {
    issueNumber: number;
    runId: string;
    pid: number;
    hostname: string;
    acquiredAt: string;
  };
};
export type RunOnceDiagnosticContextByReason = {
  "non-open-state": Base & {
    issueState: string;
    labels: readonly string[];
    workflowState: string;
  };
  "blocking-labels": Base & {
    labels: readonly string[];
    blockingLabels: readonly string[];
    workflowState: string;
  };
  "not-actionable": Base & {
    labels: readonly string[];
    workflowState: string;
    readyLabel?: string;
  };
  "waiting-spec-approval": Base & {
    labels: readonly string[];
    workflowState: string;
    missingLabel?: string;
  };
  "waiting-plan-approval": Base & {
    labels: readonly string[];
    workflowState: string;
    missingLabel?: string;
  };
  "plan-only": Workspace & { nextPhase?: "implementation" };
  "issue-locked": Lock;
  "ignored-worktree-content": Workspace & {
    ignoredPaths: readonly string[];
    blockedAction?: string;
    guidance?: readonly string[];
  };
  "issue-lock-stale": Lock;
  "issue-lock-unverifiable": Lock;
  "issue-lock-malformed": Lock;
  "planning-state-invalid": Base & { statePath: string; validation: string };
  "planning-identity-changed": Base & {
    expectedIdentity?: readonly string[];
    observedIdentity?: readonly string[];
  };
  "planning-run-id-mismatch": Base & {
    statePath?: string;
    savedRunId?: string;
    lockRunId?: string;
  };
  "planning-workspace-dirty": Workspace;
  "ambiguous-base-artifact": Base & {
    phase?: "spec" | "plan" | "implementation";
    artifactKind?: "spec" | "plan";
    baseOid?: string;
    candidates?: readonly string[];
  };
  "planning-pull-request-closed-unmerged": Base & {
    phase?: "spec" | "plan";
    pullRequestUrl?: string;
    pullRequestReference?: string;
    observedStatus?: string;
  };
  "planning-pull-request-missing": Base & {
    phase?: "spec" | "plan";
    pullRequestUrl?: string;
    pullRequestReference?: string;
  };
  "planning-pull-request-ambiguous": Base & {
    phase?: "spec" | "plan";
    pullRequestUrls?: readonly string[];
  };
  "planning-head-adoption-blocked": Base & {
    phase: "spec" | "plan";
    pullRequestUrl?: string;
    recordedHeadOid: string;
    hostHeadOid?: string;
    fetchedHeadOid?: string;
    remoteHeadOid?: string;
    adoptionFailure: PlanningHeadAdoptionFailure;
    artifactPaths: readonly string[];
    unexpectedPaths?: readonly string[];
    cleanupState: PlanningWorkspaceCleanup["state"];
  };
  "planning-merge-recovery-blocked": Base & {
    phase: "spec" | "plan";
    pullRequestUrl: string;
    pullRequestReference: string;
    recordedHeadOid: string;
    hostHeadOid: string;
    baseBranch: string;
    forgeMergeOid: string;
    fetchedBaseOid: string;
    evidenceSource:
      | "merge-ancestry"
      | "merge-commit-tree"
      | "fetched-base-tree";
    evidenceFailure: "not-ancestor" | "non-regular-file";
    recoveryFailure:
      | "missing"
      | "ambiguous"
      | "path-mismatch"
      | "non-regular-file";
    artifactKinds: readonly ("spec" | "plan")[];
    expectedPaths: readonly string[];
    observedCandidates: readonly string[];
  };
  "implementation-configuration": Workspace & {
    expectedRemote?: string;
    observedRemote?: string;
    expectedBaseBranch?: string;
    observedBaseBranch?: string;
  };
  "implementation-workspace": Workspace & {
    expectedHeadOid?: string;
    observedHeadOid?: string;
  };
  "implementation-direct-merge": Workspace & {
    reportedBranch?: string;
    mergeCommit?: string;
  };
  "implementation-ancestry": Workspace & {
    baseOid?: string;
    savedHeadOid?: string;
    observedHeadOid?: string;
    commits?: readonly string[];
  };
  "implementation-remote-head": Workspace & {
    remote?: string;
    expectedHeadOid?: string;
    observedRemoteState?: string;
    observedHeadOid?: string;
  };
  "implementation-url": Workspace & {
    reportedUrl?: string;
    expectedRepository?: string;
  };
  "implementation-branch": Workspace & {
    expectedBranch?: string;
    reportedBranch?: string;
  };
  "implementation-evidence": Workspace & { validation?: string };
  "active-run": Base & {
    resource: "lease" | "lease-guard" | "repair-lock";
    leasePath: string;
    owner?: { pid: number; hostname: string; acquiredAt: string };
    guidance: readonly string[];
  };
  "dirty-worktree": Workspace & {
    runStatePath?: string;
    dirtyStatus?: string;
    guidance: readonly string[];
  };
  "unmerged-commits": Workspace & {
    runStatePath?: string;
    commits: readonly string[];
    guidance: readonly string[];
  };
  "workspace-unverifiable": Workspace & {
    runStatePath?: string;
    savedWorkspace?: readonly string[];
    expectedWorkspace?: readonly string[];
    guidance: readonly string[];
  };
  "legacy-active-unfenced": Base & {
    runStatePath?: string;
    guidance: readonly string[];
  };
  "not-blocked": Base & {
    runStatePath?: string;
    observedStatus?: string;
    guidance: readonly string[];
  };
  "agent-blocked": Workspace & {
    reportedReason: string;
    questions: readonly string[];
    evidence?: readonly string[];
    workspaceRecoveryReason?: "not-ready" | "dirty" | "not-descendant";
    expectedHeadOid?: string;
    observedHeadOid?: string;
  };
  "development-environment-not-ready": Workspace & {
    reportedReason: string;
    evidence: readonly string[];
    reportedRemediation: readonly string[];
    workspaceRecoveryReason?: "not-ready" | "dirty" | "not-descendant";
    expectedHeadOid?: string;
    observedHeadOid?: string;
  };
  "implementation-validation": Workspace & {
    validationReason: string;
    pullRequestUrl?: string;
    expected?: readonly string[];
    observed?: readonly string[];
  };
  "planning-workspace-conflict": Workspace & { conflictReason: string };
  "unexpected-error": Base & {
    error: string;
    causes?: readonly string[];
    logPath?: string;
  };
};
export type DiagnosticDefinition<R extends RunOnceReasonCode> = {
  summary: string;
  explanation: string;
  details: (
    context: RunOnceDiagnosticContextByReason[R],
  ) => RunOnceDiagnostic["details"];
  actions: (
    context: RunOnceDiagnosticContextByReason[R],
  ) => RunOnceDiagnostic["actions"];
  safety: RunOnceDiagnostic["safety"];
  retry: (
    context: RunOnceDiagnosticContextByReason[R],
  ) => RunOnceDiagnostic["retry"];
};
export type RunOnceDiagnosticCatalog = {
  [R in RunOnceReasonCode]: DiagnosticDefinition<R>;
};
export type RunOnceFailure<R extends RunOnceReasonCode> = {
  reason: R;
  diagnosticContext: RunOnceDiagnosticContextByReason[R];
};
export type AnyRunOnceFailure = {
  [R in RunOnceReasonCode]: RunOnceFailure<R>;
}[RunOnceReasonCode];
export function runOnceFailure<R extends RunOnceReasonCode>(
  reason: R,
  diagnosticContext: RunOnceDiagnosticContextByReason[R],
): RunOnceFailure<R> {
  return { reason, diagnosticContext };
}
