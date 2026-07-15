import type { AgentIssuePipelineResult } from "./types.ts";

export type PipelineFinishStageResult =
  | { kind: "finished"; result: AgentIssuePipelineResult }
  | { kind: "unexpected"; error: Error };

export type PipelineFinishStageOptions = {
  run: () => Promise<PipelineFinishStageResult>;
};

export async function runPipelineFinishStage(
  options: PipelineFinishStageOptions,
): Promise<PipelineFinishStageResult> {
  return options.run();
}
