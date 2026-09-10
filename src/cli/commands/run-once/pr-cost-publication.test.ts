import assert from "node:assert/strict";
import test from "node:test";
import type { PullRequestBodyHostProvider } from "../../../host/types.ts";
import {
  publishPlanningPrRunCost,
  publishPrRunCost,
} from "./pr-cost-publication.ts";
import { renderRunCostSection } from "./pr-cost-summary.ts";
import type { RunCostReport } from "./run-cost.ts";

const report: RunCostReport = {
  stages: [
    {
      stage: "pi-plan",
      models: [
        {
          model: "gpt",
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

test("publishPrRunCost retains legacy update and unchanged behavior", async () => {
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
      prUrl: "https://github.com/a/b/pull/1",
      report,
    }),
    "updated",
  );
  assert.ok(updates[0]?.startsWith("Summary\n"));
  const currentHost: PullRequestBodyHostProvider = {
    async readPullRequestBody() {
      return `Summary\n\n${renderRunCostSection(report)}`;
    },
    async updatePullRequestBody() {
      assert.fail("unchanged");
    },
  };
  assert.equal(
    await publishPrRunCost({
      host: currentHost,
      prUrl: "https://github.com/a/b/pull/1",
      report,
    }),
    "unchanged",
  );
});

test("planning cost publication inserts and replaces before its final marker", async () => {
  const marker =
    "<!-- patchmill:planning-pr-v1 issue=189 phase=implementation -->";
  let body = `Summary\n\n${marker}\n`;
  const updates: string[] = [];
  const host: PullRequestBodyHostProvider = {
    async readPullRequestBody() {
      return body;
    },
    async updatePullRequestBody(_, next) {
      updates.push(next);
      body = next;
    },
  };
  await publishPlanningPrRunCost({
    host,
    prUrl: "https://github.com/a/b/pull/1",
    report,
    marker,
  });
  await publishPlanningPrRunCost({
    host,
    prUrl: "https://github.com/a/b/pull/1",
    report,
    marker,
  });
  assert.equal(body.trimEnd().split("\n").at(-1), marker);
  assert.equal((body.match(/planning-pr-v1/g) ?? []).length, 1);
  assert.equal((body.match(/patchmill-run-cost:start/g) ?? []).length, 1);
  assert.equal(updates.length, 1);
});
