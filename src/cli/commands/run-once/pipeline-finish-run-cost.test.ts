import assert from "node:assert/strict";
import { mkdir, readFile } from "node:fs/promises";
import test from "node:test";
import type { RunOnceHostProvider } from "../../../host/types.ts";
import { collectProgressEvents } from "../../../../test-support/run-once/assertions.ts";
import { issue } from "../../../../test-support/run-once/issue-fixtures.ts";
import { makeConfig } from "../../../../test-support/run-once/pipeline-fixtures.ts";
import { resolvePipelineRunCost } from "./pipeline-run-cost.ts";
import { runPipelineFinishStage } from "./pipeline-finish.ts";
import { renderRunCostSection } from "./pr-cost-summary.ts";
import { runStatePath, writeRunState } from "./run-state.ts";
import type { RunCostReport } from "./run-cost.ts";

const NOW = "2026-07-24T12:00:00.000Z";
const REPORT: RunCostReport = {
  stages: [
    {
      stage: "pi-implementation",
      models: [
        {
          model: "gpt-5.5",
          promptTokens: 60,
          outputTokens: 4,
          estimatedCostUsd: 0.1,
        },
      ],
      promptTokens: 60,
      outputTokens: 4,
      estimatedCostUsd: 0.1,
    },
  ],
  promptTokens: 60,
  outputTokens: 4,
  estimatedCostUsd: 0.1,
};

function hostWithBody(
  body: string,
  failUpdate = false,
): {
  host: RunOnceHostProvider;
  updates: string[];
} {
  const updates: string[] = [];
  return {
    updates,
    host: {
      id: "forgejo-tea",
      displayName: "Forgejo",
      async checkCli() {
        return { ok: true, message: "ready" };
      },
      missingLabelRemediation() {
        return "";
      },
      async listOpenIssues() {
        return [];
      },
      async viewIssue() {
        throw new Error("not used");
      },
      async hydrateIssueComments(issues) {
        return issues;
      },
      async trustedTriageCommentAuthors() {
        return [];
      },
      async listLabels() {
        return [];
      },
      async createLabel() {},
      async applyLabels() {},
      async commentIssue() {},
      async readPullRequestBody() {
        return body;
      },
      async updatePullRequestBody(_prUrl, updated) {
        if (failUpdate) throw new Error("host update failed");
        updates.push(updated);
      },
    },
  };
}

async function finishWithCost(options: {
  body: string;
  report?: RunCostReport;
  failUpdate?: boolean;
}) {
  const config = await makeConfig({ dryRun: false, execute: true });
  await mkdir(config.runStateDir, { recursive: true });
  await writeRunState(
    config.runStateDir,
    { issueNumber: 45, title: "Cost summary", status: "implementing" },
    NOW,
  );
  const { host, updates } = hostWithBody(options.body, options.failUpdate);
  const { events, progress } = collectProgressEvents();
  const checkpoints: Record<string, boolean | undefined> = {};
  const result = await runPipelineFinishStage({
    runner: {
      async run() {
        return { code: 0, stdout: "", stderr: "" };
      },
    },
    host,
    config,
    issue: issue(45, ["in-progress"], "Cost summary"),
    labels: ["in-progress"],
    readyLabel: "agent-ready",
    inProgressLabel: "in-progress",
    doneLabel: "completed-by-bot",
    needsInfoLabel: "needs-info",
    checkpoints,
    implemented: {
      status: "pr-created",
      prUrl: "https://forgejo.example/acme/repo/pulls/45",
      branch: "agent/issue-45-cost-summary",
      commits: ["abc123"],
      validation: ["npm test"],
    },
    runCostReport: options.report,
    specPath: undefined,
    specCommit: undefined,
    planPath: "docs/plans/cost-summary.md",
    planCommit: "plan123",
    branch: "agent/issue-45-cost-summary",
    worktreePath: ".worktrees/patchmill-issue-45-cost-summary",
    timestamp: NOW,
    runOptions: { progress },
    runStep: async (_label, fn) => fn(),
  });
  if (result.kind === "unexpected") throw result.error;
  const state = JSON.parse(
    await readFile(runStatePath(config.runStateDir, 45), "utf8"),
  ) as { checkpoints?: Record<string, boolean>; runCostReport?: RunCostReport };
  return { result, state, checkpoints, events, updates };
}

test("finish publishes one cost section and checkpoints a successful update", async () => {
  const finished = await finishWithCost({ body: "Summary\n", report: REPORT });

  assert.equal(finished.result.kind, "finished");
  assert.equal(finished.updates.length, 1);
  assert.match(finished.updates[0], /patchmill-run-cost:start/u);
  assert.deepEqual(finished.state.runCostReport, REPORT);
  assert.equal(finished.state.checkpoints?.prCostSummaryUpdated, true);
});

test("finish treats malformed markers and host update failures as nonfatal warnings", async () => {
  for (const options of [
    { body: "Summary\n<!-- patchmill-run-cost:start -->", failUpdate: false },
    { body: "Summary\n", failUpdate: true },
  ]) {
    const finished = await finishWithCost({ ...options, report: REPORT });

    assert.equal(finished.result.kind, "finished");
    assert.equal(
      finished.result.kind === "finished" && finished.result.result.status,
      "pr-created",
    );
    assert.equal(finished.updates.length, 0);
    assert.deepEqual(finished.state.runCostReport, REPORT);
    assert.equal(finished.state.checkpoints?.prCostSummaryUpdated, undefined);
    assert.ok(
      finished.events.some(
        (event) =>
          event.level === "warning" &&
          event.message ===
            "Patchmill could not update the PR run-cost summary",
      ),
    );
  }
});

test("finish checkpoints an already-current section without adding a duplicate", async () => {
  const body = `Summary\n\n${renderRunCostSection(REPORT)}`;
  const finished = await finishWithCost({ body, report: REPORT });

  assert.equal(finished.result.kind, "finished");
  assert.deepEqual(finished.updates, []);
  assert.equal(finished.state.checkpoints?.prCostSummaryUpdated, true);
});

test("a resumed finish publishes the validated saved report without recalculating", async () => {
  let calculated = false;
  const report = await resolvePipelineRunCost({
    implementationKind: "already-implemented",
    implementationStatus: "pr-created",
    persistedReport: REPORT,
    calculate: async () => {
      calculated = true;
      return REPORT;
    },
    warn() {},
  });
  const finished = await finishWithCost({ body: "Summary\n", report });

  assert.equal(calculated, false);
  assert.equal(finished.updates.length, 1);
  assert.equal(finished.state.checkpoints?.prCostSummaryUpdated, true);
});
