import { randomUUID } from "node:crypto";
import type { CommandRunner } from "../../../command/types.ts";
import {
  createPullRequestHost,
  createRunOnceHostProvider,
} from "../../../host/factory.ts";
import type { RunOnceHostProvider } from "../../../host/types.ts";
import { createIssueStateProvider } from "../../../issue-state/index.ts";
import { PlanningStateStore } from "../../../workflow/planning-state-store.ts";
import { withRunAdmission } from "../../../workflow/run-admission.ts";
import { resolveRunRepositoryNamespace } from "../../../workflow/run-repository-namespace.ts";
import {
  runLegacyOneIssue,
  runLegacyOneIssueAfterReset,
  runLegacyOneIssueForSelection,
  type RunOneIssueOptions,
} from "./pipeline-legacy.ts";
import { runPlanningWorkflow } from "./planning-pipeline.ts";
import { selectRunOnceWorkflow } from "./planning-selection.ts";
import {
  emitSelectionDiagnostics,
  loadSelectionIssues,
} from "./pipeline-selection.ts";
import { selectIssueWithDiagnostics } from "./selection.ts";
import { withLogPath } from "./pipeline-progress.ts";
import { lifecycleLabels } from "./pipeline-lifecycle.ts";
import { withIssueRunLease } from "./recovery-lease.ts";
import { runOnceFailure } from "./result-diagnostics.ts";
import type { AgentIssueConfig, AgentIssuePipelineResult } from "./types.ts";

export type { RunOneIssueOptions } from "./pipeline-legacy.ts";

/** Public facade that admits a Run attempt before non-dry-run selection. */
export async function runOneIssue(
  runner: CommandRunner,
  config: AgentIssueConfig,
  options: RunOneIssueOptions = {},
): Promise<AgentIssuePipelineResult> {
  const attemptId = options.attemptId ?? randomUUID();
  const attemptOptions = { ...options, attemptId };
  const host = createRunOnceHostProvider({
    runner,
    repoRoot: config.repoRoot,
    host: config.host,
  });
  const issueStateProvider = await createIssueStateProvider(
    host,
    config,
    config.labelCatalog,
  );
  const runtimeConfig: AgentIssueConfig = { ...config, issueStateProvider };
  if (config.dryRun)
    return runLegacyOneIssue(runner, runtimeConfig, attemptOptions);
  const hostRepository = await createPullRequestHost({
    runner,
    repoRoot: config.repoRoot,
    remote: config.remote,
    host: config.host,
  }).resolveTargetRepositoryIdentity();
  const namespace = await resolveRunRepositoryNamespace(runner, {
    repoRoot: runtimeConfig.repoRoot,
    hostRepository,
    runStateDir: runtimeConfig.runStateDir,
    worktreeRoot: runtimeConfig.worktreeDir,
    todoRoot: runtimeConfig.projectPolicy.pi.taskContract.todoRoot,
  });
  return withRunAdmission(
    {
      namespace,
      attemptId,
      mode: runtimeConfig.issueNumber === undefined ? "automatic" : "explicit",
      ...(runtimeConfig.issueNumber === undefined
        ? {}
        : { issueNumber: runtimeConfig.issueNumber }),
    },
    () =>
      runAdmittedOneIssue(
        runner,
        runtimeConfig,
        attemptOptions,
        host,
        issueStateProvider,
      ),
  );
}

async function runAdmittedOneIssue(
  runner: CommandRunner,
  runtimeConfig: AgentIssueConfig,
  options: RunOneIssueOptions,
  host: RunOnceHostProvider,
  issueStateProvider: NonNullable<AgentIssueConfig["issueStateProvider"]>,
): Promise<AgentIssuePipelineResult> {
  if (runtimeConfig.issueNumber !== undefined && options.lease === undefined)
    return withIssueRunLease(
      {
        runStateDir: runtimeConfig.runStateDir,
        issueNumber: runtimeConfig.issueNumber,
        ...(options.attemptId === undefined
          ? {}
          : { ownerToken: options.attemptId }),
      },
      (lease) =>
        runAdmittedOneIssue(
          runner,
          runtimeConfig,
          { ...options, lease },
          host,
          issueStateProvider,
        ),
    );
  const labels = lifecycleLabels(runtimeConfig);
  const issues = await loadSelectionIssues(host, runtimeConfig, options);
  const planningState = new PlanningStateStore(runtimeConfig.runStateDir);
  const rejectedIssueNumbers = new Set<number>();
  while (true) {
    const selected = await selectRunOnceWorkflow(
      issues.filter((issue) => !rejectedIssueNumbers.has(issue.number)),
      runtimeConfig,
      planningState,
      options.now?.toISOString(),
    );
    switch (selected.kind) {
      case "none": {
        const diagnostics = selectIssueWithDiagnostics(
          issues.filter(
            (issue) =>
              (runtimeConfig.issueNumber === undefined ||
                issue.number === runtimeConfig.issueNumber) &&
              !rejectedIssueNumbers.has(issue.number),
          ),
          {
            readyLabel: labels.ready,
            triagePolicy: runtimeConfig.triagePolicy,
            approvalPolicy: runtimeConfig.approvalPolicy,
            issueState: runtimeConfig.issueState,
            issueStateProvider,
          },
        );
        await emitSelectionDiagnostics(
          diagnostics.rejections,
          options,
          labels.ready,
        );
        return withLogPath({ status: "no-issue" }, options);
      }
      case "invalid-planning-state":
        return withLogPath(
          {
            status: "blocked",
            issue: selected.issue,
            reason: "planning-state-invalid",
            publicFailure: runOnceFailure("planning-state-invalid", {
              issueNumber: selected.issue.number,
              status: "blocked",
              statePath: planningState.path(selected.issue.number),
              validation: selected.reason,
            }),
            questions: [],
            commits: [],
            validation: [],
          },
          options,
        );
      case "legacy": {
        const legacy = await runLegacyOneIssueForSelection(
          runner,
          runtimeConfig,
          selected.issue.number,
          options,
        );
        if (
          legacy.kind === "pipeline-result" ||
          runtimeConfig.issueNumber !== undefined
        )
          return legacy.result;
        rejectedIssueNumbers.add(selected.issue.number);
        continue;
      }
      case "planning":
        return withPlanningLease(
          runner,
          runtimeConfig,
          options,
          selected.issue,
          selected.state,
          "present",
          host,
        );
      case "fresh-planning":
        return withPlanningLease(
          runner,
          runtimeConfig,
          options,
          selected.issue,
          selected.initialState,
          "absent",
          host,
        );
    }
  }
}

function withPlanningLease(
  runner: CommandRunner,
  config: AgentIssueConfig,
  options: RunOneIssueOptions,
  issue: import("../../../issue/types.ts").IssueSummary,
  state: import("../../../workflow/planning-state.ts").PlanningStateV1,
  expectedStatePresence: "present" | "absent",
  host: RunOnceHostProvider,
): Promise<AgentIssuePipelineResult> {
  return withIssueRunLease(
    {
      runStateDir: config.runStateDir,
      issueNumber: issue.number,
      ...(options.lease === undefined ? {} : { lease: options.lease }),
      ...(options.attemptId === undefined
        ? {}
        : { ownerToken: options.attemptId }),
    },
    (lease) =>
      runPlanningWorkflow({
        runner,
        config,
        options: { ...options, lease },
        issue,
        state,
        expectedStatePresence,
        host,
      }),
  );
}

/** Reset is intentionally pinned to the legacy recovery contract. */
export async function runOneIssueAfterReset(
  runner: CommandRunner,
  config: AgentIssueConfig,
  options: RunOneIssueOptions,
  reset: {
    lease: import("./types.ts").IssueRunLease;
    seed: import("./types.ts").RunResetSeed;
  },
): Promise<AgentIssuePipelineResult> {
  return runLegacyOneIssueAfterReset(runner, config, options, reset);
}
