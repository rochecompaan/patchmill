import type {
  DiagnosticDefinition,
  RunOnceDiagnostic,
  RunOnceDiagnosticContextByReason,
  RunOnceReasonCode,
} from "./result-diagnostic-types.ts";

const LABELS: Record<string, string> = {
  issueNumber: "Issue",
  issueState: "Issue state",
  labels: "Labels",
  blockingLabels: "Blocking labels",
  workflowState: "Workflow state",
  missingLabel: "Missing label",
  phase: "Phase",
  branch: "Branch",
  worktreePath: "Worktree",
  workspaceState: "Workspace state",
  workspaceRecoveryReason: "Workspace recovery",
  statusEvidence: "Status",
  lockPath: "Planning lock",
  fingerprint: "SHA-256 fingerprint",
  statePath: "State file",
  validation: "Validation",
  expectedIdentity: "Expected identity",
  observedIdentity: "Observed identity",
  savedRunId: "Saved Run ID",
  lockRunId: "Lock Run ID",
  artifactKind: "Artifact kind",
  baseOid: "Base OID",
  candidates: "Candidates",
  pullRequestUrl: "Pull request",
  pullRequestReference: "Pull request reference",
  pullRequestUrls: "Pull requests",
  observedStatus: "Observed status",
  expectedRemote: "Expected remote",
  observedRemote: "Observed remote",
  expectedBaseBranch: "Expected base branch",
  observedBaseBranch: "Observed base branch",
  expectedHeadOid: "Expected head OID",
  observedHeadOid: "Observed head OID",
  reportedBranch: "Reported branch",
  mergeCommit: "Merge commit",
  savedHeadOid: "Saved head OID",
  commits: "Commits",
  remote: "Remote",
  observedRemoteState: "Remote state",
  reportedUrl: "Reported URL",
  expectedRepository: "Expected repository",
  expectedBranch: "Expected branch",
  reportedReason: "Reported reason",
  questions: "Questions",
  evidence: "Evidence",
  reportedRemediation: "Agent remediation",
  validationReason: "Validation reason",
  expected: "Expected",
  observed: "Observed",
  conflictReason: "Conflict reason",
  error: "Error",
  causes: "Causes",
  logPath: "Log",
  leasePath: "Issue run lease",
  resource: "Resource",
  runStatePath: "Run recovery state",
  dirtyStatus: "Workspace status",
  savedWorkspace: "Saved workspace",
  expectedWorkspace: "Expected workspace",
  ignoredPaths: "Ignored paths",
  blockedAction: "Blocked action",
  guidance: "Assessment guidance",
  owner: "Recorded owner",
};
function detailValue(
  value: unknown,
): string | number | readonly string[] | undefined {
  if (typeof value === "string") return value.trim() ? value : undefined;
  if (typeof value === "number") return value;
  if (
    Array.isArray(value) &&
    value.every((entry) => typeof entry === "string") &&
    value.length
  )
    return value;
  if (value && typeof value === "object")
    return Object.entries(value as Record<string, unknown>)
      .flatMap(([key, entry]) =>
        typeof entry === "string" || typeof entry === "number"
          ? [`${key}=${entry}`]
          : [],
      )
      .filter(Boolean);
  return undefined;
}
export function contextDetails(context: object): RunOnceDiagnostic["details"] {
  return Object.entries(context).flatMap(([key, raw]) => {
    if (key === "status") return [];
    const value = detailValue(raw);
    return value === undefined
      ? []
      : [{ key, label: LABELS[key] ?? key, value }];
  });
}
export function issueCommand(
  kind: "run-once" | "lease-repair",
  issueNumber: number | undefined,
): string | undefined {
  if (
    !Number.isSafeInteger(issueNumber) ||
    issueNumber === undefined ||
    issueNumber < 1
  )
    return undefined;
  return kind === "run-once"
    ? `patchmill run-once --issue ${issueNumber}`
    : `patchmill run lease repair --issue ${issueNumber}`;
}
type Policy = {
  summary: string;
  explanation: string;
  action: string;
  command?: "run-once" | "lease-repair";
  safety: string;
  retry: RunOnceDiagnostic["retry"];
};
export function definition<R extends RunOnceReasonCode>(
  policy: Policy,
): DiagnosticDefinition<R> {
  return {
    summary: policy.summary,
    explanation: policy.explanation,
    details: (context) => contextDetails(context),
    actions: (context) => {
      const command = policy.command
        ? issueCommand(
            policy.command,
            (context as RunOnceDiagnosticContextByReason[R]).issueNumber,
          )
        : undefined;
      return [{ description: policy.action, ...(command ? { command } : {}) }];
    },
    safety: [policy.safety],
    retry: () => policy.retry,
  };
}
