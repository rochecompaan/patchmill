import assert from "node:assert/strict";
import test from "node:test";
import {
  PrCostSummaryError,
  renderRunCostSection,
  upsertRunCostSection,
} from "./pr-cost-summary.ts";
const report = {
  stages: [
    {
      stage: "pi-implementation",
      models: [
        {
          model: "bad|model\nrow",
          promptTokens: 10,
          outputTokens: 2,
          estimatedCostUsd: 0,
        },
      ],
      promptTokens: 10,
      outputTokens: 2,
      estimatedCostUsd: 0,
    },
  ],
  promptTokens: 10,
  outputTokens: 2,
  estimatedCostUsd: 0,
};
test("renders escaped aggregate rows and replaces an existing generated region", () => {
  const rendered = renderRunCostSection(report);
  assert.match(rendered, /bad\\\|model row/u);
  assert.match(rendered, /\$0\.0000/u);
  const body =
    "before\n<!-- patchmill-run-cost:start -->old<!-- patchmill-run-cost:end -->after";
  const result = upsertRunCostSection(body, report);
  assert.ok(result.startsWith("before\n"));
  assert.ok(result.endsWith("after"));
  assert.equal(upsertRunCostSection(result, report), result);
});
test("does not emit injected markers from table cells on retry", () => {
  const maliciousReport = {
    ...report,
    stages: [
      {
        ...report.stages[0],
        models: [
          {
            ...report.stages[0].models[0],
            model: "<!-- patchmill-run-cost:start -->",
          },
        ],
      },
    ],
  };

  const once = upsertRunCostSection("Summary\n", maliciousReport);
  assert.equal(upsertRunCostSection(once, maliciousReport), once);
  assert.equal(
    once.includes("| Implementation | <!-- patchmill-run-cost:start --> |"),
    false,
  );
});

test("rejects unsafe marker shapes", () => {
  assert.throws(
    () => upsertRunCostSection("<!-- patchmill-run-cost:start -->", report),
    PrCostSummaryError,
  );
});
