import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createSubagentProgressCorrelator,
  SUBAGENT_PROGRESS_APPEND_ERROR,
} from "./subagent-progress-correlation.ts";
import type { PersistedSubagentProgress } from "./subagent-progress.ts";

function harness() {
  const entries: PersistedSubagentProgress[] = [];
  let nextError: Error | undefined;
  const correlator = createSubagentProgressCorrelator({
    append(progress) {
      if (nextError) {
        const error = nextError;
        nextError = undefined;
        throw error;
      }
      entries.push(progress);
    },
  });
  return {
    entries,
    correlator,
    fail(error: Error) {
      nextError = error;
    },
  };
}

test("correlates direct rows by run id and upstream index", () => {
  const state = harness();
  state.correlator.observe({
    phase: "end",
    toolName: "subagent",
    toolCallId: "launch",
    result: {
      details: {
        mode: "single",
        runId: "direct",
        results: [{ index: 9, agent: "worker", exitCode: 0 }],
      },
    },
  });
  assert.deepEqual(state.entries, [
    {
      version: 1,
      kind: "direct",
      toolCallId: "launch",
      runId: "direct",
      childIndex: 9,
      state: "completed",
      agent: "worker",
    },
  ]);
});

test("retains an async direct child under its launch parent until completion", () => {
  const state = harness();
  state.correlator.observe({
    phase: "end",
    toolName: "subagent",
    toolCallId: "launch",
    result: { details: { mode: "single", asyncId: "async", results: [] } },
  });
  state.correlator.observe({
    phase: "end",
    toolName: "subagent_wait",
    toolCallId: "wait",
    result: {
      details: {
        completions: [
          {
            runId: "async",
            state: "complete",
            results: [{ agent: "reviewer" }],
          },
        ],
      },
    },
  });
  assert.deepEqual(
    state.entries.map((entry) => entry.toolCallId),
    ["launch", "launch"],
  );
  assert.deepEqual(
    state.entries.map((entry) => entry.state),
    ["pending", "completed"],
  );
});

test("keeps colliding workflow result indexes independently visible and delays fallback", () => {
  const state = harness();
  const summary = (complete: boolean, rows: unknown[]) => ({
    version: 1,
    parentToolCallId: "launch",
    workflowRunId: "workflow",
    inventoryComplete: complete,
    workflowState: complete ? "completed" : "running",
    children: rows,
  });
  state.correlator.observe({
    phase: "update",
    toolName: "subagent",
    toolCallId: "launch",
    result: {
      details: {
        results: [
          { index: 0, task: "SECRET" },
          { index: 0, task: "SECRET2" },
        ],
        workflowChildren: summary(false, [
          { childId: "build", state: "running" },
          { childId: "review", state: "pending", agent: "reviewer" },
        ]),
      },
    },
  });
  assert.equal(state.entries.filter((entry) => entry.unresolved).length, 0);
  state.correlator.observe({
    phase: "end",
    toolName: "subagent_wait",
    toolCallId: "wait",
    result: {
      details: {
        completions: [
          {
            workflowChildren: summary(true, [
              { childId: "build", state: "completed" },
              { childId: "review", state: "failed", agent: "reviewer" },
            ]),
          },
        ],
      },
    },
  });
  assert.equal(
    state.entries.filter(
      (entry) => entry.kind === "workflow" && entry.unresolved,
    ).length,
    1,
  );
  assert.equal(JSON.stringify(state.entries).includes("SECRET"), false);
  assert.deepEqual(
    [
      ...new Set(
        state.entries
          .filter((entry) => entry.kind === "workflow")
          .map((entry) => entry.childId),
      ),
    ],
    ["build", "review"],
  );
});

test("uses workflow stable child IDs through changed metadata and terminal replay", () => {
  const state = harness();
  const emit = (
    stateName: "pending" | "running" | "completed",
    complete = false,
  ) =>
    state.correlator.observe({
      phase: complete ? "end" : "update",
      toolName: "subagent",
      toolCallId: "call",
      result: {
        details: {
          workflowChildren: {
            version: 1,
            parentToolCallId: "launch",
            workflowRunId: "workflow",
            inventoryComplete: complete,
            workflowState: complete ? "completed" : "running",
            children: [
              {
                childId: "dynamic",
                state: stateName,
                ...(stateName === "completed"
                  ? { agent: "worker", model: "provider/model" }
                  : {}),
              },
            ],
          },
        },
      },
    });
  emit("pending");
  emit("running");
  emit("completed", true);
  emit("completed", true);
  assert.deepEqual(
    state.entries.map((entry) =>
      entry.kind === "workflow"
        ? [entry.childId, entry.state, entry.agent]
        : [],
    ),
    [
      ["dynamic", "pending", undefined],
      ["dynamic", "running", undefined],
      ["dynamic", "completed", "worker"],
    ],
  );
});

test("suppresses exact tuples and retries failed appends", () => {
  const state = harness();
  const cause = new Error("append");
  state.fail(cause);
  const event = {
    phase: "update" as const,
    toolName: "subagent",
    toolCallId: "launch",
    result: {
      details: {
        mode: "single",
        runId: "run",
        results: [{ index: 0, agent: "worker" }],
      },
    },
  };
  assert.throws(
    () => state.correlator.observe(event),
    (error: unknown) =>
      error instanceof Error &&
      error.message === SUBAGENT_PROGRESS_APPEND_ERROR &&
      error.cause === cause,
  );
  state.correlator.observe(event);
  state.correlator.observe(event);
  assert.equal(state.entries.length, 1);
});
