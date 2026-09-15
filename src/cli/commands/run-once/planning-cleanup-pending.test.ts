import assert from "node:assert/strict";
import test from "node:test";
import type { AgentIssueCleanupPendingResult } from "./types.ts";
import {
  formatPlanningCleanupPath,
  publishPlanningCleanupPending,
} from "./planning-cleanup-pending.ts";

test("cleanup path diagnostics escape terminal control characters", () => {
  const path = formatPlanningCleanupPath("line\nbreak\t\u001b[31m\u007f\u0080");
  assert.equal(path, '"line\\nbreak\\t\\u001b[31m\\u007f\\u0080"');
  assert.doesNotMatch(path, /\n|\t|\u001b/u);
});

test("cleanup-pending publication removes a ready label added with its comment", async () => {
  const calls: Array<{ oldLabels: string[]; newLabels: string[] }> = [];
  let reads = 0;
  await publishPlanningCleanupPending({
    host: {
      viewIssue: async () => {
        reads += 1;
        return {
          labels:
            reads === 1
              ? ["agent-in-progress"]
              : ["agent-in-progress", "agent-ready"],
          comments: [],
        };
      },
      commentIssue: async () => undefined,
      applyLabels: async (change) => calls.push(change),
    } as never,
    config: {} as never,
    result: {
      status: "cleanup-pending",
      issue: {
        number: 243,
        title: "Cleanup",
        body: "",
        labels: ["agent-in-progress"],
        state: "open",
      },
      phase: "implementation",
      prUrl: "https://github.com/acme/patchmill/pull/243",
      branch: "agent/issue-243",
      worktreePath: "/worktree",
      reason: "ignored-worktree-content",
      ignoredPaths: [".env"],
      remediation: ["preserve .env"],
    } satisfies AgentIssueCleanupPendingResult,
    labels: {
      ready: "agent-ready",
      inProgress: "agent-in-progress",
      needsInfo: "needs-info",
    },
  });
  assert.equal(reads, 2);
  assert.deepEqual(calls, [
    {
      issueNumber: 243,
      oldLabels: ["agent-in-progress", "agent-ready"],
      newLabels: ["needs-info"],
      addLabels: ["needs-info"],
      removeLabels: ["agent-in-progress", "agent-ready"],
    },
  ]);
});
