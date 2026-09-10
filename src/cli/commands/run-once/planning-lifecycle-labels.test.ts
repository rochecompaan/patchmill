import assert from "node:assert/strict";
import test from "node:test";
import { applyPlanningBlockedLabels } from "./planning-lifecycle-labels.ts";

test("planning blocker labels are calculated from a fresh issue read", async () => {
  const applied: string[][] = [];
  await applyPlanningBlockedLabels({
    host: {
      viewIssue: async () => ({
        labels: [
          "agent-ready",
          "agent-in-progress",
          "needs-info",
          "spec-review",
          "spec-approved",
          "plan-review",
          "plan-approved",
          "bug",
        ],
      }),
      applyLabels: async (change) => {
        applied.push(change.newLabels);
      },
    },
    issueNumber: 189,
    labels: {
      ready: "agent-ready",
      inProgress: "agent-in-progress",
      needsInfo: "needs-info",
    },
  });
  assert.deepEqual(applied, [
    [
      "needs-info",
      "spec-review",
      "spec-approved",
      "plan-review",
      "plan-approved",
      "bug",
    ].sort(),
  ]);
});
