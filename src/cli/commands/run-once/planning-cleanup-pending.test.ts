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

test("cleanup-pending publication comments before ensuring its label and clearing retry labels", async () => {
  const calls: Array<{ oldLabels: string[]; newLabels: string[] }> = [];
  const effects: string[] = [];
  let reads = 0;
  await publishPlanningCleanupPending({
    host: {
      viewIssue: async () => {
        reads += 1;
        effects.push("view");
        return {
          labels:
            reads === 1
              ? ["agent-in-progress"]
              : ["agent-in-progress", "agent-ready"],
          comments: [],
        };
      },
      commentIssue: async () => effects.push("comment"),
      listLabels: async () => {
        effects.push("list-labels");
        return [];
      },
      createLabel: async () => effects.push("create-label"),
      applyLabels: async (change) => {
        effects.push("apply-labels");
        calls.push(change);
      },
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
  assert.deepEqual(effects, [
    "view",
    "comment",
    "list-labels",
    "create-label",
    "view",
    "apply-labels",
  ]);
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

test("cleanup-pending publication completes after each transient operator effect failure", async () => {
  for (const failure of ["comment", "label-ensure", "label-apply"] as const) {
    let labels = ["agent-in-progress"];
    const comments: Array<{ body: string }> = [];
    let fail = true;
    const result = {
      status: "cleanup-pending" as const,
      issue: {
        number: 243,
        title: "Cleanup",
        body: "",
        labels,
        state: "open" as const,
      },
      phase: "implementation" as const,
      prUrl: "https://github.com/acme/patchmill/pull/243",
      branch: "agent/issue-243",
      worktreePath: "/worktree",
      reason: "ignored-worktree-content" as const,
      ignoredPaths: [".env"],
      remediation: ["preserve .env"],
    } satisfies AgentIssueCleanupPendingResult;
    const host = {
      viewIssue: async () => ({ labels, comments }),
      commentIssue: async (_issueNumber: number, body: string) => {
        if (failure === "comment" && fail) throw new Error("comment failed");
        comments.push({ body });
      },
      listLabels: async () => [],
      createLabel: async () => {
        if (failure === "label-ensure" && fail)
          throw new Error("label ensure failed");
      },
      applyLabels: async (change: { newLabels: string[] }) => {
        if (failure === "label-apply" && fail)
          throw new Error("label apply failed");
        labels = change.newLabels;
      },
    };
    const input = {
      host: host as never,
      config: {} as never,
      result,
      labels: {
        ready: "agent-ready",
        inProgress: "agent-in-progress",
        needsInfo: "needs-info",
      },
    };

    await assert.rejects(publishPlanningCleanupPending(input));
    fail = false;
    await publishPlanningCleanupPending(input);
    assert.deepEqual(labels, ["needs-info"], failure);
    assert.equal(comments.length, 1, failure);
  }
});
