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
  const closure = parsePersistedSubagentProgress({
    version: 1,
    kind: "workflow",
    toolCallId: "call",
    workflowRunId: "run",
    childId: "child",
    state: "paused",
    inventoryClosed: true,
  });
  assert.deepEqual(closure, {
    version: 1,
    kind: "workflow",
    toolCallId: "call",
    workflowRunId: "run",
    childId: "child",
    state: "paused",
    inventoryClosed: true,
  });
  assert.equal(
    parsePersistedSubagentProgress({
      version: 1,
      kind: "workflow",
      toolCallId: "call",
      workflowRunId: "run",
      childId: "child",
      state: "paused",
      inventoryClosed: false,
    }),
    undefined,
  );
  assert.equal(
    parsePersistedSubagentProgress({
      version: 1,
      kind: "workflow",
      toolCallId: "call",
      workflowRunId: "run",
      childId: "child",
      state: "paused",
      unresolved: true,
      inventoryClosed: true,
    }),
    undefined,
  );
  assert.equal(
    parsePersistedSubagentProgress({
      version: 1,
      kind: "direct",
      toolCallId: "call",
      runId: "run",
      childIndex: 0,
      inventoryClosed: true,
    }),
    undefined,
  );
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
  assert.ok(closure);
  assert.notEqual(
    subagentProgressKey(closure),
    subagentProgressKey({ ...closure, inventoryClosed: undefined }),
  );
});

test("rejects duplicate direct result indexes without returning a partial snapshot", () => {
  assert.equal(
    parseDirectSingleSnapshot({
      details: {
        mode: "single",
        runId: "run",
        results: [
          { index: 0, agent: "first" },
          { index: 0, agent: "second" },
        ],
      },
    }),
    undefined,
  );
});

test("enforces direct safe-integer and container boundaries", () => {
  const snapshot = (index: number) =>
    parseDirectSingleSnapshot({
      details: { mode: "single", runId: "run", results: [{ index }] },
    });
  for (const [index, accepted] of [
    [0, true],
    [Number.MAX_SAFE_INTEGER, true],
    [-1, false],
    [1.5, false],
    [Number.MAX_SAFE_INTEGER + 1, false],
  ] as const) {
    assert.equal(snapshot(index)?.children.length === 1, accepted);
    assert.equal(
      parsePersistedSubagentProgress({
        version: 1,
        kind: "direct",
        toolCallId: "call",
        runId: "run",
        childIndex: index,
      }) !== undefined,
      accepted,
    );
  }
  const rows = (length: number) =>
    Array.from({ length }, (_, index) => ({ index }));
  assert.equal(
    parseDirectSingleSnapshot({
      details: {
        mode: "single",
        runId: "run",
        results: rows(SUBAGENT_PROGRESS_LIMITS.maxResultRows),
      },
    })?.children.length,
    SUBAGENT_PROGRESS_LIMITS.maxResultRows,
  );
  assert.throws(
    () =>
      parseDirectSingleSnapshot({
        details: {
          mode: "single",
          runId: "run",
          results: rows(SUBAGENT_PROGRESS_LIMITS.maxResultRows + 1),
        },
      }),
    new RegExp(SUBAGENT_PROGRESS_LIMIT_ERROR),
  );
  const completions = (length: number) =>
    Array.from({ length }, (_, index) => ({ runId: `run-${index}` }));
  assert.equal(
    parseDirectCompletionSnapshots({
      details: {
        completions: completions(SUBAGENT_PROGRESS_LIMITS.maxResultRows),
      },
    }).length,
    SUBAGENT_PROGRESS_LIMITS.maxResultRows,
  );
  assert.throws(
    () =>
      parseDirectCompletionSnapshots({
        details: {
          completions: completions(SUBAGENT_PROGRESS_LIMITS.maxResultRows + 1),
        },
      }),
    new RegExp(SUBAGENT_PROGRESS_LIMIT_ERROR),
  );
});

test("accepts exact direct and workflow parser boundaries and drops one-over metadata", () => {
  const direct = (field: "agent" | "model" | "thinking", value: string) =>
    parseDirectSingleSnapshot({
      details: {
        mode: "single",
        runId: "r".repeat(SUBAGENT_PROGRESS_LIMITS.maxToolCallIdCodeUnits),
        results: [{ index: 0, [field]: value }],
      },
    });
  for (const [field, limit] of [
    ["agent", SUBAGENT_PROGRESS_LIMITS.maxAgentCodeUnits],
    ["model", SUBAGENT_PROGRESS_LIMITS.maxModelCodeUnits],
    ["thinking", SUBAGENT_PROGRESS_LIMITS.maxThinkingCodeUnits],
  ] as const) {
    assert.equal(
      direct(field, "x".repeat(limit))?.children[0]?.[field],
      "x".repeat(limit),
    );
    assert.equal(
      direct(field, "x".repeat(limit + 1))?.children[0]?.[field],
      undefined,
    );
  }
  for (const field of ["runId", "asyncId"] as const) {
    const exact = "r".repeat(SUBAGENT_PROGRESS_LIMITS.maxToolCallIdCodeUnits);
    const details =
      field === "runId"
        ? { mode: "single", runId: exact, results: [{ index: 0 }] }
        : { mode: "single", asyncId: exact, results: [] };
    assert.ok(parseDirectSingleSnapshot({ details }));
    const tooLong = "r".repeat(
      SUBAGENT_PROGRESS_LIMITS.maxToolCallIdCodeUnits + 1,
    );
    const overDetails =
      field === "runId"
        ? { mode: "single", runId: tooLong, results: [{ index: 0 }] }
        : { mode: "single", asyncId: tooLong, results: [] };
    assert.equal(
      parseDirectSingleSnapshot({ details: overDetails }),
      undefined,
    );
  }

  const workflow = (
    overrides: Record<string, unknown> = {},
    childOverrides: Record<string, unknown> = {},
  ) =>
    parseWorkflowChildSummaries({
      details: {
        workflowChildren: {
          version: 1,
          parentToolCallId: "p".repeat(
            SUBAGENT_PROGRESS_LIMITS.maxWorkflowBytes,
          ),
          workflowRunId: "r".repeat(SUBAGENT_PROGRESS_LIMITS.maxWorkflowBytes),
          inventoryComplete: false,
          workflowState: "running",
          children: [
            {
              childId: "c".repeat(
                SUBAGENT_PROGRESS_LIMITS.maxWorkflowChildIdBytes,
              ),
              state: "running",
              ...childOverrides,
            },
          ],
          ...overrides,
        },
      },
    });
  assert.equal(workflow().length, 1);
  const utf8Boundary = (limit: number) => "é".repeat(limit / 2);
  for (const [field, limit] of [
    ["parentToolCallId", SUBAGENT_PROGRESS_LIMITS.maxWorkflowBytes],
    ["workflowRunId", SUBAGENT_PROGRESS_LIMITS.maxWorkflowBytes],
  ] as const) {
    assert.equal(workflow({ [field]: utf8Boundary(limit) }).length, 1);
    assert.deepEqual(workflow({ [field]: `${utf8Boundary(limit)}x` }), []);
  }
  for (const field of ["parentToolCallId", "workflowRunId"] as const)
    assert.deepEqual(
      workflow({
        [field]: "x".repeat(SUBAGENT_PROGRESS_LIMITS.maxWorkflowBytes + 1),
      }),
      [],
    );
  assert.deepEqual(
    workflow(
      {},
      {
        childId: "c".repeat(
          SUBAGENT_PROGRESS_LIMITS.maxWorkflowChildIdBytes + 1,
        ),
      },
    ),
    [],
  );
  for (const [field, limit] of [
    ["agent", SUBAGENT_PROGRESS_LIMITS.maxWorkflowBytes],
    ["model", SUBAGENT_PROGRESS_LIMITS.maxWorkflowBytes],
    ["thinking", SUBAGENT_PROGRESS_LIMITS.maxWorkflowThinkingBytes],
  ] as const) {
    assert.equal(
      workflow({}, { [field]: "x".repeat(limit) })[0]?.children[0]?.[field],
      "x".repeat(limit),
    );
    assert.equal(
      workflow({}, { [field]: "x".repeat(limit + 1) })[0]?.children[0]?.[field],
      undefined,
    );
    assert.equal(
      workflow({}, { [field]: utf8Boundary(limit) })[0]?.children[0]?.[field],
      utf8Boundary(limit),
    );
    assert.equal(
      workflow({}, { [field]: `${utf8Boundary(limit)}x` })[0]?.children[0]?.[
        field
      ],
      undefined,
    );
  }
});
