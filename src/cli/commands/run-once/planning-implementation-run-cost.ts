import type { RunCostReport } from "./run-cost.ts";

function finiteNonnegative(value: number, field: string): number {
  if (!Number.isFinite(value) || value < 0)
    throw new RangeError(`Invalid planning run-cost ${field}`);
  return value;
}

/** Retains only finite, nonnegative agent-reported cost evidence in planning state. */
export function planningRunCost(report: RunCostReport) {
  return {
    stages: report.stages.map((stage) => ({
      stage: stage.stage,
      models: stage.models.map((model) => ({
        model: model.model,
        promptTokens: finiteNonnegative(
          model.promptTokens,
          "model promptTokens",
        ),
        outputTokens: finiteNonnegative(
          model.outputTokens,
          "model outputTokens",
        ),
        estimatedCostUsd: finiteNonnegative(
          model.estimatedCostUsd,
          "model estimatedCostUsd",
        ),
      })),
      promptTokens: finiteNonnegative(stage.promptTokens, "stage promptTokens"),
      outputTokens: finiteNonnegative(stage.outputTokens, "stage outputTokens"),
      estimatedCostUsd: finiteNonnegative(
        stage.estimatedCostUsd,
        "stage estimatedCostUsd",
      ),
    })),
    promptTokens: finiteNonnegative(report.promptTokens, "promptTokens"),
    outputTokens: finiteNonnegative(report.outputTokens, "outputTokens"),
    estimatedCostUsd: finiteNonnegative(
      report.estimatedCostUsd,
      "estimatedCostUsd",
    ),
  };
}
