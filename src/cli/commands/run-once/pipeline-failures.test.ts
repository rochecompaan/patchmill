import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { blockIssue, unexpectedFailure } from "./pipeline-failures.ts";
import { issue } from "../../../../test-support/run-once/issue-fixtures.ts";
import { collectProgressEvents } from "../../../../test-support/run-once/assertions.ts";
import { makeConfig } from "../../../../test-support/run-once/pipeline-fixtures.ts";
import { runStatePath } from "./run-state.ts";
import type { IssueHostProvider } from "../../../host/types.ts";

function host(): IssueHostProvider & { comments: string[] } {
  const comments: string[] = [];
  return {
    comments,
    listOpenIssues: async () => [],
    viewIssue: async () => issue(1, []),
    listLabels: async () => ["needs-info"],
    createLabel: async () => undefined,
    commentIssue: async (_issueNumber, body) => {
      comments.push(body);
    },
    applyLabels: async () => undefined,
  } as IssueHostProvider & { comments: string[] };
}

test("blockIssue writes blocked state and returns blocked result", async () => {
  const config = await makeConfig();
  const issueSummary = issue(1, ["in-progress"]);
  const fakeHost = host();
  const result = await blockIssue(
    fakeHost,
    config,
    issueSummary,
    issueSummary.labels,
    {
      status: "blocked",
      reason: "need info",
      questions: [],
      commits: [],
      validation: [],
    },
    {},
    new Date().toISOString(),
    {},
  );
  assert.equal(result.status, "blocked");
  assert.match(
    await readFile(runStatePath(config.runStateDir, 1), "utf8"),
    /need info/,
  );
});

test("unexpectedFailure comments once and records blocked result", async () => {
  const config = await makeConfig();
  const { progress } = collectProgressEvents();
  const fakeHost = host();
  const result = await unexpectedFailure(
    fakeHost,
    config,
    issue(2, ["in-progress"]),
    {},
    {},
    new Date().toISOString(),
    new Error("boom"),
    { progress },
  );
  assert.equal(result.status, "blocked");
  assert.equal(fakeHost.comments.length, 1);
});
