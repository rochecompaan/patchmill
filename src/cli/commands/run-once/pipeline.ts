import type { CommandRunner } from "../../../command/types.ts";
import { createRunOnceHostProvider } from "../../../host/factory.ts";
import { createIssueStateProvider } from "../../../issue-state/index.ts";
import { PlanningStateStore } from "../../../workflow/planning-state-store.ts";
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
import { runOnceFailure } from "./result-diagnostics.ts";
import type { AgentIssueConfig, AgentIssuePipelineResult } from "./types.ts";

export type { RunOneIssueOptions } from "./pipeline-legacy.ts";

/** Public facade that safely reselects rejected legacy candidates before one substantive workflow. */
export async function runOneIssue(
  runner: CommandRunner,
  config: AgentIssueConfig,
  options: RunOneIssueOptions = {},
): Promise<AgentIssuePipelineResult> {
  // Preserve legacy dry-run output and its non-mutating diagnostic contract.
  if (config.dryRun) return runLegacyOneIssue(runner, config, options);
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
  const labels = lifecycleLabels(runtimeConfig);
  const issues = await loadSelectionIssues(host, runtimeConfig, options);
  const planningState = new PlanningStateStore(config.runStateDir);
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
        const diagnosticCandidates = issues.filter(
          (issue) =>
            (runtimeConfig.issueNumber === undefined ||
              issue.number === runtimeConfig.issueNumber) &&
            !rejectedIssueNumbers.has(issue.number),
        );
        const diagnostics = selectIssueWithDiagnostics(diagnosticCandidates, {
          readyLabel: labels.ready,
          triagePolicy: runtimeConfig.triagePolicy,
          approvalPolicy: runtimeConfig.approvalPolicy,
          issueStateProvider,
        });
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
        if (legacy.kind === "pipeline-result") return legacy.result;
        if (runtimeConfig.issueNumber !== undefined) return legacy.result;
        rejectedIssueNumbers.add(selected.issue.number);
        continue;
      }
      case "planning":
        return runPlanningWorkflow({
          runner,
          config: runtimeConfig,
          options,
          issue: selected.issue,
          state: selected.state,
          expectedStatePresence: "present",
          host,
        });
      case "fresh-planning":
        return runPlanningWorkflow({
          runner,
          config: runtimeConfig,
          options,
          issue: selected.issue,
          state: selected.initialState,
          expectedStatePresence: "absent",
          host,
        });
    }
  }
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
