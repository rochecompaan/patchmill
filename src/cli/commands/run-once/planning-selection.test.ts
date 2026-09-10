import assert from "node:assert/strict";
import test from "node:test";
import { selectRunOnceWorkflow } from "./planning-selection.ts";

const issue = (number: number, labels: string[]) => ({
  number,
  title: `Issue ${number}`,
  state: "open",
  labels,
});
const config = {
  runStateDir: "/tmp/no-planning-selection-state",
  readyLabel: "agent-ready",
  issueNumber: undefined,
  approvalPolicy: {
    specApproval: { required: false },
    planApproval: { required: false },
  },
  triagePolicy: {
    runOnceSelection: { priorityOrder: ["priority:high", "priority:low"] },
  },
} as never;

test("prioritizes active planning over fresh ready work and reuses label ordering", async () => {
  const active = { phases: [{ status: "pending" }] };
  const result = await selectRunOnceWorkflow(
    [issue(4, ["agent-ready", "priority:low"]), issue(3, ["priority:high"])],
    config,
    {
      path: () => "state",
      read: async (number) => (number === 3 ? active : undefined),
    } as never,
  );
  assert.equal(result.kind, "planning");
  if (result.kind === "planning") assert.equal(result.issue.number, 3);
});

test("excludes blocked fresh work and honors configured legacy in-progress labels", async () => {
  const custom = {
    ...config,
    triagePolicy: {
      labels: {
        ready: "queued",
        inProgress: "claimed",
        done: "closed",
        needsInfo: "blocked",
      },
      runOnceSelection: {
        priorityOrder: [],
        excludedLabels: ["unsuitable"],
      },
    },
  } as never;
  const result = await selectRunOnceWorkflow(
    [issue(1, ["queued", "unsuitable"]), issue(2, ["claimed"])],
    custom,
    { path: () => "state", read: async () => undefined } as never,
  );
  assert.equal(result.kind, "none");
});

test("returns malformed planning state rather than selecting fresh work", async () => {
  const result = await selectRunOnceWorkflow(
    [issue(3, ["agent-ready"])],
    config,
    {
      path: () => "state",
      read: async () => {
        throw new Error("invalid-json");
      },
    } as never,
  );
  assert.equal(result.kind, "invalid-planning-state");
});
