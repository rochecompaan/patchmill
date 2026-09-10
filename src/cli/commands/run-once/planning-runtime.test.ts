import assert from "node:assert/strict";
import test from "node:test";
import { makeConfig } from "../../../../test-support/run-once/pipeline-fixtures.ts";
import { createMockRunner } from "../../../../test-support/run-once/mock-runner.ts";
import { createPlanningFinishEffects } from "./planning-finish-effects.ts";
import { createPlanningRuntime } from "./planning-runtime.ts";

test("constructs a production planning coordinator callback without legacy state wiring", async () => {
  const config = await makeConfig({ dryRun: false, execute: true });
  const runtime = createPlanningRuntime({
    runner: createMockRunner(async () => ({ code: 0, stdout: "", stderr: "" })),
    config,
    issue: {
      number: 189,
      title: "Runtime",
      body: "",
      labels: [],
      state: "open",
    },
    labels: ["agent-ready"],
    readyLabel: "agent-ready",
    inProgressLabel: "agent-in-progress",
    doneLabel: "agent-done",
    needsInfoLabel: "needs-info",
    piAgentDir: ".patchmill/pi-agent",
    tokenUsageState: { total: 0 },
  });
  assert.equal(typeof runtime.coordinate, "function");
});

test("finish effects deduplicate a durable implementation handoff", async () => {
  const config = await makeConfig({ dryRun: false, execute: true });
  const comments: string[] = [];
  const host = {
    viewIssue: async () => ({ comments: comments.map((body) => ({ body })) }),
    commentIssue: async (_issue: number, body: string) => {
      comments.push(body);
    },
    applyLabels: async () => {},
    listLabels: async () => [],
  } as never;
  const state = {
    issueNumber: 189,
    phases: [
      {
        kind: "implementation",
        workspace: { identity: { worktreePath: ".worktrees/issue-189" } },
        artifacts: [{ kind: "plan", path: "docs/plans/issue-189.md" }],
      },
    ],
  } as never;
  const effects = createPlanningFinishEffects({
    runner: createMockRunner(async () => ({ code: 0, stdout: "", stderr: "" })),
    config,
    issue: {
      number: 189,
      title: "Runtime",
      body: "",
      labels: [],
      state: "open",
    },
    labels: ["agent-ready"],
    readyLabel: "agent-ready",
    inProgressLabel: "agent-in-progress",
    doneLabel: "agent-done",
    needsInfoLabel: "needs-info",
    host,
    phaseIndex: 0,
  })(state);
  await effects.effects.postHandoff({
    status: "pr-created",
    prUrl: "https://example.test/pull/189",
    branch: "agent/issue-189",
    commits: [],
    validation: [],
  });
  await effects.effects.postHandoff({
    status: "pr-created",
    prUrl: "https://example.test/pull/189",
    branch: "agent/issue-189",
    commits: [],
    validation: [],
  });
  assert.equal(comments.length, 1);
});
