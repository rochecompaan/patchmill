import type { AgentIssuePipelineResult } from "./types.ts";
import type { ProgressReporter } from "./progress.ts";

type PiOutputStream = (chunk: string) => void;

export type RunOneIssueOptions = {
  now?: Date | undefined;
  progress?: ProgressReporter | undefined;
  logPath?: string | undefined;
  streamPiOutput?: PiOutputStream | undefined;
  verbosePiOutput?: boolean | undefined;
  heartbeatMs?: number | undefined;
};

export type LegacySelectionRunResult =
  | { kind: "pipeline-result"; result: AgentIssuePipelineResult }
  | {
      kind: "selection-rejected";
      result: AgentIssuePipelineResult & {
        status: "no-issue" | "approval-required";
      };
    };

export type LeasedRunOneIssueOptions = RunOneIssueOptions & {
  lease?: import("./types.ts").IssueRunLease;
  /** Internal selection pin; never exposed to ordinary callers. */
  leasedIssueNumber?: number;
  /** Distinguishes a pinned rejection before any Issue effect begins. */
  classifySelectionRejection?: boolean;
  reset?: { seed: import("./types.ts").RunResetSeed };
};

export class LegacySelectionRejected extends Error {
  readonly result: AgentIssuePipelineResult & {
    status: "no-issue" | "approval-required";
  };

  constructor(
    result: AgentIssuePipelineResult & {
      status: "no-issue" | "approval-required";
    },
  ) {
    super(`Pinned legacy selection rejected: ${result.status}`);
    this.result = result;
  }
}
