import assert from "node:assert/strict";
import { test } from "node:test";
import {
  parseDirectCompletionSnapshots,
  parseDirectSingleSnapshot,
  parsePersistedSubagentProgress,
  parseWorkflowChildSummaries,
  SUBAGENT_PROGRESS_LIMIT_ERROR,
  SUBAGENT_PROGRESS_LIMITS,
  subagentProgressKey,
} from "./subagent-progress.ts";

test("parses direct children by run id and non-positional upstream index", () => {
  assert.deepEqual(
    parseDirectSingleSnapshot({
      details: {
        mode: "single",
        runId: "run",
        results: [
          {
            index: 7,
            agent: "worker",
            model: "provider/model",
            thinking: "high",
            exitCode: 0,
            task: "SECRET",
          },
        ],
      },
    }),
    {
      runId: "run",
      pendingAsyncSingle: false,
      children: [
        {
          childIndex: 7,
          state: "completed",
          agent: "worker",
          model: "provider/model",
          thinking: "high",
        },
      ],
    },
  );
  assert.deepEqual(
    parseDirectSingleSnapshot({
      details: { mode: "single", asyncId: "async", results: [] },
    }),
    { runId: "async", children: [], pendingAsyncSingle: true },
  );
});

test("normalizes documented direct lifecycle precedence and completion slots", () => {
  const states = [
    [{ detached: true, stopped: true }, "detached"],
    [{ stopped: true }, "stopped"],
    [{ interrupted: true }, "paused"],
    [{ acceptance: { status: "rejected" } }, "rejected"],
    [{ exitCode: 0 }, "completed"],
    [{ exitCode: 1 }, "failed"],
  ] as const;
  for (const [row, state] of states) {
    assert.equal(
      parseDirectSingleSnapshot({
        details: {
          mode: "single",
          runId: "r",
          results: [{ index: 1, ...row }],
        },
      })?.children[0]?.state,
      state,
    );
  }
  assert.deepEqual(
    parseDirectCompletionSnapshots({
      details: {
        completions: [
          { runId: "r", state: "complete", results: [{ agent: "reviewer" }] },
        ],
      },
    }),
    [{ runId: "r", state: "completed", child: { agent: "reviewer" } }],
  );
});

test("reads workflow summaries only from documented slots and excludes secrets", () => {
  const summary = {
    version: 1,
    parentToolCallId: "call",
    workflowRunId: "workflow",
    inventoryComplete: false,
    workflowState: "running",
    children: [
      { childId: "build", state: "running", agent: "worker", task: "SECRET" },
    ],
  };
  const found = parseWorkflowChildSummaries({
    details: {
      workflowChildren: summary,
      results: [{ index: 0, task: "SECRET_RESULT" }],
      completions: [
        {
          workflowChildren: {
            ...summary,
            inventoryComplete: true,
            workflowState: "completed",
          },
        },
      ],
    },
    hidden: { workflowChildren: { ...summary, workflowRunId: "bad" } },
  });
  assert.equal(found.length, 2);
  assert.equal(JSON.stringify(found).includes("SECRET"), false);
});

test("fails closed for invalid workflow summaries and limits containers", () => {
  const base = {
    version: 1,
    parentToolCallId: "call",
    workflowRunId: "workflow",
    inventoryComplete: false,
    workflowState: "running",
    children: [{ childId: "one", state: "running" }],
  };
  for (const summary of [
    { ...base, version: 2 },
    {
      ...base,
      children: [
        { childId: "one", state: "running" },
        { childId: "one", state: "running" },
      ],
    },
    { ...base, children: [{ childId: "bad id", state: "running" }] },
  ])
    assert.deepEqual(
      parseWorkflowChildSummaries({ details: { workflowChildren: summary } }),
      [],
    );
  assert.throws(
    () =>
      parseWorkflowChildSummaries({
        details: {
          workflowChildren: {
            ...base,
            children: Array.from(
              { length: SUBAGENT_PROGRESS_LIMITS.maxResultRows + 1 },
              (_, index) => ({ childId: `x${index}`, state: "running" }),
            ),
          },
        },
      }),
    new RegExp(SUBAGENT_PROGRESS_LIMIT_ERROR),
  );
});

test("bounds completion child rows before accepting a fallback", () => {
  assert.throws(
    () =>
      parseDirectCompletionSnapshots({
        details: {
          completions: [
            {
              runId: "run",
              results: Array.from(
                { length: SUBAGENT_PROGRESS_LIMITS.maxResultRows + 1 },
                () => ({}),
              ),
            },
          ],
        },
      }),
    new RegExp(SUBAGENT_PROGRESS_LIMIT_ERROR),
  );
});

test("rebuilds persisted v1 allowlists and collision-safe keys", () => {
  const workflow = parsePersistedSubagentProgress({
    version: 1,
    kind: "workflow",
    toolCallId: "call",
    workflowRunId: "run",
    childId: "child",
    state: "failed",
    agent: "worker",
    task: "SECRET",
    unresolved: true,
  });
  assert.deepEqual(workflow, {
    version: 1,
    kind: "workflow",
    toolCallId: "call",
    workflowRunId: "run",
    childId: "child",
    state: "failed",
    agent: "worker",
    unresolved: true,
  });
  assert.equal(
    parsePersistedSubagentProgress({
      toolCallId: "call",
      childIndex: 0,
      agent: "worker",
    }),
    undefined,
  );
  const direct = parsePersistedSubagentProgress({
    version: 1,
    kind: "direct",
    toolCallId: "call",
    runId: "run",
    childIndex: 0,
  });
  assert.ok(direct);
  assert.notEqual(
    subagentProgressKey(direct),
    subagentProgressKey({ ...direct, state: "pending" }),
  );
  assert.notEqual(
    subagentProgressKey(direct),
    subagentProgressKey({ ...direct, unresolved: true }),
  );
});
