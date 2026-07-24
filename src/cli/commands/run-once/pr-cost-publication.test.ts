import assert from "node:assert/strict";
import test from "node:test";
import type { PullRequestBodyHostProvider } from "../../../host/types.ts";
import { publishPrRunCost } from "./pr-cost-publication.ts";
import { renderRunCostSection } from "./pr-cost-summary.ts";
import type { RunCostReport } from "./run-cost.ts";

const report: RunCostReport = {
  stages: [
    {
      stage: "pi-plan",
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

test("publishPrRunCost updates a changed body and skips an already-current body", async () => {
  const updates: string[] = [];
  const host: PullRequestBodyHostProvider = {
    async readPullRequestBody() {
      return "Summary\n";
    },
    async updatePullRequestBody(_, body) {
      updates.push(body);
    },
  };
  assert.equal(
    await publishPrRunCost({
      host,
      prUrl: "https://github.com/acme/repo/pull/42",
      report,
    }),
    "updated",
  );
  assert.equal(updates.length, 1);
  assert.ok(updates[0]!.startsWith("Summary\n"));

  const currentHost: PullRequestBodyHostProvider = {
    async readPullRequestBody() {
      return `Summary\n\n${renderRunCostSection(report)}`;
    },
    async updatePullRequestBody() {
      assert.fail("already-current body must not be edited");
    },
  };
  assert.equal(
    await publishPrRunCost({
      host: currentHost,
      prUrl: "https://github.com/acme/repo/pull/42",
      report,
    }),
    "unchanged",
  );
});
