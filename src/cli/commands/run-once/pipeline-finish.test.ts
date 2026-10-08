import test from "node:test";
import assert from "node:assert/strict";
import { readFile, rm } from "node:fs/promises";
import { runPipelineFinishStage } from "./pipeline-finish.ts";
import {
  acquireIssueRunLease,
  releaseIssueRunLease,
} from "./recovery-lease.ts";
import { writeRunState, readRunState } from "./run-state.ts";
import { makeConfig } from "../../../../test-support/run-once/pipeline-fixtures.ts";
import { issue } from "../../../../test-support/run-once/issue-fixtures.ts";
const repository = {
  provider: "forgejo-tea" as const,
  host: "forgejo.test",
  owner: "test-owner",
  repository: "test-repo",
};
const branch = "agent/issue-226-legacy",
  worktreePath = ".worktrees/patchmill-issue-226-legacy";
const prUrl = "https://forgejo.test/test-owner/test-repo/pulls/17";
const evidence = {
  reference: { targetRepository: repository, number: 17 },
  url: prUrl,
  publication: {
    targetRepository: repository,
    headRepository: repository,
    baseBranch: "main",
    headBranch: branch,
    headOid: "b".repeat(40),
  },
  ownershipMarkerRequired: true,
};

test("legacy PR handoff retains in-progress and cannot apply done labels or target mutations", async () => {
  const config = await makeConfig({ dryRun: false, execute: true });
  const lease = await acquireIssueRunLease(config.runStateDir, 226);
  const events: string[] = [];
  try {
    await writeRunState(
      config.runStateDir,
      { issueNumber: 226, title: "Legacy", status: "implementing" },
      lease,
    );
    const other = await writeRunState(
      config.runStateDir,
      { issueNumber: 226, status: "implementing" },
      lease,
    );
    const result = await runPipelineFinishStage({
      lease,
      config,
      runner: { run: async () => assert.fail("open PR must not mutate Git") },
      host: {
        commentIssue: async () => {
          events.push("handoff");
        },
        applyLabels: async () => {
          events.push("done");
        },
        ensureLabel: async () => {
          events.push("ensure-done");
        },
      } as never,
      issue: issue(226, ["in-progress"], "Legacy"),
      labels: ["in-progress"],
      readyLabel: "agent-ready",
      inProgressLabel: "in-progress",
      doneLabel: "agent-done",
      needsInfoLabel: "needs-info",
      checkpoints: {},
      implemented: {
        status: "pr-created",
        prUrl,
        branch,
        commits: ["b".repeat(40)],
        validation: ["npm test"],
      },
      implementationPr: evidence,
      specPath: undefined,
      specCommit: undefined,
      planPath: "docs/plans/issue-226.md",
      planCommit: undefined,
      branch,
      worktreePath,
      timestamp: other.updatedAt,
      runOptions: {},
      runStep: async (_label, action) => action(),
    });
    assert.equal(result.kind, "finished", JSON.stringify(result));
    const state = await readRunState(config.runStateDir, 226);
    assert.equal(state?.status, "implementing");
    assert.deepEqual(state?.implementationPr, evidence);
    assert.equal(state?.checkpoints?.doneLabelApplied, undefined);
    assert.deepEqual(events, ["handoff"]);
    assert.ok(await readFile(`${config.runStateDir}/issue-226.json`, "utf8"));
  } finally {
    await releaseIssueRunLease(lease);
    await rm(config.repoRoot, { recursive: true, force: true });
  }
});
