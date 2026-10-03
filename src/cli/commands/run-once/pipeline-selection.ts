import type { AgentIssueVisualEvidence } from "../../../issue-run/types.ts";
import type { IssueSummary } from "../../../issue/types.ts";
import type { IssueHostProvider } from "../../../host/types.ts";
import { isResumableRunState, readRunState } from "./run-state.ts";
import { selectIssue, selectIssueWithDiagnostics } from "./selection.ts";
import { DEFAULT_TRIAGE_POLICY } from "../triage/labels.ts";
import { workflowRolesFromLabels } from "../../../issue-state/labels.ts";
import { assertExplicitWorkflowState } from "./workflow-state.ts";
import type {
  AgentIssueConfig,
  IssueSelectionDiagnostics,
  IssueSelectionRejection,
} from "./types.ts";
import {
  automaticWorkflowRolesEligible,
  lifecycleLabels,
  hasBlockedRunRecoveryState,
  selectionBlockingLabels,
} from "./pipeline-lifecycle.ts";
import { progress, type PipelineProgressOptions } from "./pipeline-progress.ts";
import { rejectionMessage } from "./pipeline-comments.ts";
import { diagnosticFor, type RunOnceDiagnostic } from "./result-diagnostics.ts";

export function stringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const entries = value.filter(
    (entry): entry is string => typeof entry === "string",
  );
  return entries.length === value.length ? entries : undefined;
}

export function visualEvidenceArray(
  value: unknown,
): AgentIssueVisualEvidence[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const entries = value.flatMap((entry): AgentIssueVisualEvidence[] => {
    if (!entry || typeof entry !== "object") return [];
    const record = entry as Record<string, unknown>;
    if (typeof record.screenshotPath !== "string") return [];
    return [
      {
        screenshotPath: record.screenshotPath,
        caption:
          typeof record.caption === "string" ? record.caption : undefined,
        referencePaths: stringArray(record.referencePaths),
        url: typeof record.url === "string" ? record.url : undefined,
      },
    ];
  });
  return entries.length > 0 ? entries : undefined;
}

export function selectionDiagnostic(
  rejection: IssueSelectionRejection,
  readyLabel: string,
): RunOnceDiagnostic {
  const common = {
    issueNumber: rejection.issueNumber,
    issueState: rejection.state,
    labels: rejection.labels,
    workflowState: rejection.workflowState,
  };
  switch (rejection.reason) {
    case "non-open-state":
      return diagnosticFor("non-open-state", common);
    case "blocking-labels":
      return diagnosticFor("blocking-labels", {
        ...common,
        blockingLabels: rejection.blockingLabels ?? [],
      });
    case "not-actionable":
      return diagnosticFor("not-actionable", { ...common, readyLabel });
    case "waiting-spec-approval":
      return diagnosticFor("waiting-spec-approval", {
        ...common,
        ...(rejection.missingLabel
          ? { missingLabel: rejection.missingLabel }
          : {}),
      });
    case "waiting-plan-approval":
      return diagnosticFor("waiting-plan-approval", {
        ...common,
        ...(rejection.missingLabel
          ? { missingLabel: rejection.missingLabel }
          : {}),
      });
  }
}

export async function emitSelectionDiagnostics(
  rejections: IssueSelectionRejection[],
  options: PipelineProgressOptions,
  readyLabel: string,
): Promise<void> {
  for (const rejection of rejections) {
    await progress(
      options,
      "debug",
      "select",
      `skipped #${rejection.issueNumber}: ${rejectionMessage(rejection.reason)}`,
      {
        issueNumber: rejection.issueNumber,
        data: {
          ...rejection,
          diagnostic: selectionDiagnostic(rejection, readyLabel),
        },
      },
    );
  }
}

/** Computes and emits diagnostics for legacy selection without changing selection effects. */
function workflowRolesForIssue(
  issue: IssueSummary,
  config: AgentIssueConfig,
): string[] {
  if (config.issueStateProvider) {
    return config.issueStateProvider.resolveRoles(issue).roles;
  }
  return workflowRolesFromLabels(issue.labels, {
    triagePolicy: config.triagePolicy ?? DEFAULT_TRIAGE_POLICY,
    approvalPolicy: config.approvalPolicy,
  });
}

export async function legacySelectionDiagnostics(
  issues: IssueSummary[],
  config: AgentIssueConfig,
  options: PipelineProgressOptions,
): Promise<IssueSelectionDiagnostics> {
  const readyLabel = lifecycleLabels(config).ready;
  const diagnostics = selectIssueWithDiagnostics(issues, {
    readyLabel,
    triagePolicy: config.triagePolicy,
    approvalPolicy: config.approvalPolicy,
    issueState: config.issueState,
    issueStateProvider: config.issueStateProvider,
  });
  await emitSelectionDiagnostics(diagnostics.rejections, options, readyLabel);
  return diagnostics;
}

function assertBlockedRetryEligible(
  issue: IssueSummary,
  config: AgentIssueConfig,
): void {
  const lifecycle = lifecycleLabels(config);
  // Keep normal triage exclusions, except the lifecycle blocker that
  // agent-ready explicitly acknowledges for recovery.
  const excluded = (
    config.triagePolicy ?? DEFAULT_TRIAGE_POLICY
  ).runOnceSelection.excludedLabels.filter(
    (label) => label !== lifecycle.needsInfo,
  );
  const blocking = selectionBlockingLabels(issue.labels, excluded, config);
  if (blocking.length)
    throw new Error(
      `Issue #${issue.number} is open but not eligible because it has ${blocking.join(", ")}`,
    );
  assertExplicitWorkflowState(workflowRolesForIssue(issue, config), {
    readyLabel: lifecycle.ready,
    policy: config.approvalPolicy,
    issue,
  });
}

export type AutomaticLegacyCandidatePreparation = {
  issues: IssueSummary[];
  diagnosticIssues: IssueSummary[];
};

/** Separates automatic candidates from diagnostic-only approval waits before state reads. */
export async function prepareAutomaticLegacyCandidates(
  loadedIssues: IssueSummary[],
  config: AgentIssueConfig,
): Promise<AutomaticLegacyCandidatePreparation> {
  const automaticIneligibleIssues = loadedIssues.filter(
    (candidate) =>
      !automaticWorkflowRolesEligible(
        workflowRolesForIssue(candidate, config),
        config,
      ),
  );
  const issues = (
    await Promise.all(
      loadedIssues
        .filter((candidate) =>
          automaticWorkflowRolesEligible(
            workflowRolesForIssue(candidate, config),
            config,
          ),
        )
        .map(async (candidate) => ({
          candidate,
          state: await readRunState(config.runStateDir, candidate.number),
        })),
    )
  )
    .filter(({ state }) => !hasBlockedRunRecoveryState(state))
    .map(({ candidate }) => candidate);
  const diagnosticIssueNumbers = new Set(
    [...issues, ...automaticIneligibleIssues].map((issue) => issue.number),
  );
  return {
    issues,
    diagnosticIssues: loadedIssues.filter((issue) =>
      diagnosticIssueNumbers.has(issue.number),
    ),
  };
}

export async function selectResumableIssue(
  issues: IssueSummary[],
  config: AgentIssueConfig,
): Promise<{ issue: IssueSummary; resumed: boolean } | undefined> {
  const { inProgress, ready } = lifecycleLabels(config);
  const shouldResume = config.execute && !config.dryRun;
  const resumable: IssueSummary[] = [];
  if (shouldResume) {
    for (const issue of issues) {
      const roles = workflowRolesForIssue(issue, config);
      if (
        config.issueNumber === undefined &&
        !automaticWorkflowRolesEligible(roles, config)
      )
        continue;
      if (!roles.includes("in-progress")) continue;
      const state = await readRunState(config.runStateDir, issue.number);
      if (state && isResumableRunState(state)) resumable.push(issue);
    }
  }
  if (resumable.length > 1)
    throw new Error(
      `Multiple resumable ${inProgress} automation runs found: ${resumable.map((issue) => `#${issue.number}`).join(", ")}`,
    );
  if (config.issueNumber !== undefined) {
    const resumableSelected = resumable.find(
      (issue) => issue.number === config.issueNumber,
    );
    if (resumableSelected) return { issue: resumableSelected, resumed: true };
    if (shouldResume) {
      const explicitIssue = issues.find(
        (candidate) =>
          candidate.number === config.issueNumber && candidate.state === "open",
      );
      const explicitState = explicitIssue
        ? await readRunState(config.runStateDir, explicitIssue.number)
        : undefined;
      if (explicitIssue && hasBlockedRunRecoveryState(explicitState)) {
        if (
          resumable.length === 1 &&
          resumable[0]?.number !== explicitIssue.number
        )
          throw new Error(
            `Resumable ${inProgress} automation run #${resumable[0]?.number} exists; resume it before processing #${explicitIssue.number}`,
          );
        if (
          !workflowRolesForIssue(explicitIssue, config).includes("agent-ready")
        ) {
          throw new Error(
            `Issue #${explicitIssue.number} has a blocked Run recovery state but is not marked ${ready}`,
          );
        }
        assertBlockedRetryEligible(explicitIssue, config);
        return { issue: explicitIssue, resumed: true };
      }
    }
    const selected = selectIssue(issues, {
      issueNumber: config.issueNumber,
      readyLabel: ready,
      triagePolicy: config.triagePolicy,
      approvalPolicy: config.approvalPolicy,
      issueState: config.issueState,
      issueStateProvider: config.issueStateProvider,
    });
    if (!selected) return undefined;
    if (resumable.length === 1 && resumable[0]?.number !== selected.number)
      throw new Error(
        `Resumable ${inProgress} automation run #${resumable[0]?.number} exists; resume it before processing #${selected.number}`,
      );
    return {
      issue: selected,
      resumed: resumable[0]?.number === selected.number,
    };
  }
  const resumableIssue = resumable[0];
  if (resumable.length === 1 && resumableIssue !== undefined) {
    return { issue: resumableIssue, resumed: true };
  }
  const diagnostics = selectIssueWithDiagnostics(issues, {
    issueNumber: config.issueNumber,
    readyLabel: ready,
    triagePolicy: config.triagePolicy,
    approvalPolicy: config.approvalPolicy,
    issueState: config.issueState,
    issueStateProvider: config.issueStateProvider,
  });
  return diagnostics.issue
    ? { issue: diagnostics.issue, resumed: false }
    : undefined;
}

export function mergeIssueLists(
  primary: IssueSummary[],
  secondary: IssueSummary[],
): IssueSummary[] {
  const issues = new Map<number, IssueSummary>();
  for (const issue of secondary) issues.set(issue.number, issue);
  for (const issue of primary) issues.set(issue.number, issue);
  return [...issues.values()];
}

export async function loadSelectionIssues(
  host: IssueHostProvider,
  config: AgentIssueConfig,
  options: PipelineProgressOptions,
): Promise<IssueSummary[]> {
  if (config.issueNumber === undefined) {
    await progress(options, "info", "select", "listing open issues");
    const issues = await host.listOpenIssues();
    return config.issueState?.provider === "comments"
      ? host.hydrateIssueComments(issues)
      : issues;
  }
  await progress(
    options,
    "info",
    "select",
    `loading issue #${config.issueNumber}`,
    { issueNumber: config.issueNumber },
  );
  const requestedIssues =
    config.issueState?.provider === "comments"
      ? await host.hydrateIssueComments([
          await host.viewIssue(config.issueNumber),
        ])
      : [await host.viewIssue(config.issueNumber)];
  // Explicit attempts own only the requested Issue.  Cross-issue resume
  // precedence belongs to automatic selection and must not read other state.
  return requestedIssues;
}
