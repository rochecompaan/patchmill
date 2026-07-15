import type {
  AgentIssueMergedResult,
  AgentIssuePipelineResult,
  AgentIssuePrCreatedResult,
} from "./types.ts";

export type PipelineSuccessfulImplementationResult =
  | AgentIssuePrCreatedResult
  | AgentIssueMergedResult;

export type PipelineImplementationStageResult =
  | { kind: "implemented"; result: PipelineSuccessfulImplementationResult }
  | {
      kind: "already-implemented";
      result: PipelineSuccessfulImplementationResult;
    }
  | { kind: "blocked"; result: AgentIssuePipelineResult }
  | { kind: "unexpected"; error: Error };

export type PipelineImplementationStageOptions = {
  run: () => Promise<PipelineImplementationStageResult>;
};

export async function runPipelineImplementationStage(
  options: PipelineImplementationStageOptions,
): Promise<PipelineImplementationStageResult> {
  return options.run();
}
