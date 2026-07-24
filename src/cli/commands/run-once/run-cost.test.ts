import assert from "node:assert/strict";
import test from "node:test";
import { aggregateRunCost, parseRunCostReport } from "./run-cost.ts";
const entry = (id: string, model: string, input: number, cost: number) => ({
  type: "message",
  id,
  message: {
    role: "assistant",
    model,
    usage: {
      input,
      cacheRead: 2,
      cacheWrite: 3,
      output: 4,
      cost: { total: cost },
    },
  },
});
test("aggregates copied session history once at its earliest stage", () => {
  const planning = entry("a", "gpt", 1, 0.1);
  const report = aggregateRunCost([
    {
      relativePath: "pi-plan/a.jsonl",
      startedAtMs: 1,
      content: `${JSON.stringify(planning)}\n`,
    },
    {
      relativePath: "pi-implementation/b.jsonl",
      startedAtMs: 2,
      content: `${JSON.stringify(planning)}\n${JSON.stringify(entry("b", "terra", 5, 0.2))}\n`,
    },
  ]);
  assert.deepEqual(
    report.stages.map((stage) => [stage.stage, stage.promptTokens]),
    [
      ["pi-plan", 6],
      ["pi-implementation", 10],
    ],
  );
  assert.equal(report.estimatedCostUsd, 0.30000000000000004);
});
test("rejects conflicting accounting and invalid persisted totals", () => {
  assert.throws(
    () =>
      aggregateRunCost([
        {
          relativePath: "pi-plan/a",
          startedAtMs: 1,
          content: `${JSON.stringify(entry("a", "gpt", 1, 1))}\n`,
        },
        {
          relativePath: "pi-plan/b",
          startedAtMs: 2,
          content: `${JSON.stringify(entry("a", "gpt", 1, 2))}\n`,
        },
      ]),
    /Conflicting/u,
  );
  assert.equal(
    parseRunCostReport({
      stages: [],
      promptTokens: 1,
      outputTokens: 0,
      estimatedCostUsd: 0,
    }),
    undefined,
  );
});
