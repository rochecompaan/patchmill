import assert from "node:assert/strict";
import test from "node:test";
import { resolvePipelineRunCost } from "./pipeline-run-cost.ts";
import type { RunCostReport } from "./run-cost.ts";

const report: RunCostReport = {
  stages: [
    {
      stage: "pi-implementation",
      models: [
        {
          model: "gpt-5.5",
          promptTokens: 6,
          outputTokens: 4,
          estimatedCostUsd: 0.1,
        },
      ],
      promptTokens: 6,
      outputTokens: 4,
      estimatedCostUsd: 0.1,
    },
  ],
  promptTokens: 6,
  outputTokens: 4,
  estimatedCostUsd: 0.1,
};

test("resolvePipelineRunCost resumes from a persisted report without recalculating", async () => {
  let calculated = false;
  const warnings: string[] = [];
  const result = await resolvePipelineRunCost({
    implementationKind: "already-implemented",
    implementationStatus: "pr-created",
    persistedReport: report,
    calculate: async () => {
      calculated = true;
      return report;
    },
    warn(message) {
      warnings.push(message);
    },
  });

  assert.deepEqual(result, report);
  assert.equal(calculated, false);
  assert.deepEqual(warnings, []);
});

test("resolvePipelineRunCost warns without calculating legacy resumptions", async () => {
  const warnings: string[] = [];
  const result = await resolvePipelineRunCost({
    implementationKind: "already-implemented",
    implementationStatus: "pr-created",
    calculate: async () => {
      assert.fail("legacy resume must not calculate from a new session");
    },
    warn(message) {
      warnings.push(message);
    },
  });

  assert.equal(result, undefined);
  assert.deepEqual(warnings, [
    "Patchmill cannot publish a run-cost summary from legacy or invalid saved state",
  ]);
});
