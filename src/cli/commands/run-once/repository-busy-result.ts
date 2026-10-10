import type { IssueSummary } from "../../../issue/types.ts";
import {
  withLogPath,
  type PipelineProgressOptions,
} from "./pipeline-progress.ts";
import { runOnceFailure } from "./result-diagnostics.ts";
import type { AgentIssueStoppedResult } from "./types.ts";

export function repositoryBusyResult(
  issue: IssueSummary,
  options: PipelineProgressOptions,
): AgentIssueStoppedResult {
  return withLogPath(
    {
      status: "stopped",
      issue,
      reason: "repository-busy",
      publicFailure: runOnceFailure("repository-busy", {
        issueNumber: issue.number,
        status: "stopped",
      }),
    },
    options,
  );
}
