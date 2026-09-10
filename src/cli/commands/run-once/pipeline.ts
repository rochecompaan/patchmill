import {
  runLegacyOneIssue,
  runLegacyOneIssueAfterReset,
  type RunOneIssueOptions,
} from "./pipeline-legacy.ts";
import type {
  AgentIssueConfig,
  AgentIssuePipelineResult,
  CommandRunner,
} from "./types.ts";

export type { RunOneIssueOptions } from "./pipeline-legacy.ts";

/** Public run-once facade for the legacy workflow. */
export async function runOneIssue(
  runner: CommandRunner,
  config: AgentIssueConfig,
  options: RunOneIssueOptions = {},
): Promise<AgentIssuePipelineResult> {
  return runLegacyOneIssue(runner, config, options);
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
