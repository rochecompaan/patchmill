import assert from "node:assert/strict";
import { test } from "node:test";
import { SUBAGENT_PROGRESS_APPEND_ERROR } from "./subagent-progress-correlation.ts";
import { SUBAGENT_PROGRESS_LIMITS } from "./subagent-progress.ts";
import { harness } from "./subagent-progress-correlation-test-support.ts";

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
        mode: "workflow",
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
            runId: "workflow",
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
      toolCallId: "launch",
      result: {
        details: {
          mode: "workflow",
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
        ? [entry.childId, entry.state, entry.agent, entry.inventoryClosed]
        : [],
    ),
    [
      ["dynamic", "pending", undefined, undefined],
      ["dynamic", "running", undefined, undefined],
      ["dynamic", "completed", "worker", undefined],
      ["dynamic", "completed", "worker", true],
    ],
  );
});

test("seals workflow inventory after recoverable fallback appends", () => {
  const state = harness();
  const summary = (complete: boolean) => ({
    version: 1,
    parentToolCallId: "launch",
    workflowRunId: "workflow",
    inventoryComplete: complete,
    workflowState: complete ? "paused" : "running",
    children: [
      { childId: "first", state: "running" },
      { childId: "second", state: "running" },
    ],
  });
  state.correlator.observe({
    phase: "update",
    toolName: "subagent",
    toolCallId: "launch",
    result: { details: { mode: "workflow", workflowChildren: summary(false) } },
  });
  state.failAfter(new Error("append"), 1);
  assert.throws(
    () =>
      state.correlator.observe({
        phase: "end",
        toolName: "subagent",
        toolCallId: "launch",
        result: {
          details: { mode: "workflow", workflowChildren: summary(true) },
        },
      }),
    new RegExp(SUBAGENT_PROGRESS_APPEND_ERROR),
  );
  assert.equal(
    state.entries.some((entry) => entry.inventoryClosed === true),
    false,
  );

  const recovered = harness();
  recovered.correlator.restore(
    state.entries.map((data) => ({
      type: "custom",
      customType: "patchmill-subagent-progress",
      data,
    })),
  );
  recovered.correlator.observe({
    phase: "end",
    toolName: "subagent_wait",
    toolCallId: "wait",
    result: { details: { mode: "workflow", workflowChildren: summary(true) } },
  });
  assert.deepEqual(
    recovered.entries.map((entry) => [
      entry.childId,
      entry.unresolved,
      entry.inventoryClosed,
    ]),
    [
      ["second", true, undefined],
      ["first", undefined, true],
    ],
  );
});

test("rejects workflow launch-parent drift and stale closed replays", () => {
  const state = harness();
  const summary = (
    complete: boolean,
    workflowState = complete ? "completed" : "running",
  ) => ({
    version: 1,
    parentToolCallId: "launch",
    workflowRunId: "workflow",
    inventoryComplete: complete,
    workflowState,
    children: [
      {
        childId: "child",
        state: complete ? "completed" : "running",
        agent: "worker",
      },
    ],
  });
  state.correlator.observe({
    phase: "update",
    toolName: "subagent",
    toolCallId: "wrong",
    result: { details: { mode: "workflow", workflowChildren: summary(false) } },
  });
  assert.equal(state.entries.length, 0);
  state.correlator.observe({
    phase: "end",
    toolName: "subagent",
    toolCallId: "launch",
    result: { details: { mode: "workflow", workflowChildren: summary(true) } },
  });
  state.correlator.observe({
    phase: "update",
    toolName: "subagent_wait",
    toolCallId: "wait",
    result: { details: { mode: "workflow", workflowChildren: summary(false) } },
  });
  assert.equal(state.entries.length, 2);
});

test("adopts known status IDs and a reloaded empty workflow completion", () => {
  const state = harness();
  const summary = (complete: boolean, children: unknown[]) => ({
    version: 1,
    parentToolCallId: "launch",
    workflowRunId: "workflow",
    inventoryComplete: complete,
    workflowState: complete ? "completed" : "running",
    children,
  });
  state.correlator.observe({
    phase: "end",
    toolName: "subagent",
    toolCallId: "launch",
    result: {
      details: {
        mode: "workflow",
        workflowChildren: summary(false, [
          { childId: "child", state: "running", agent: "worker" },
        ]),
      },
    },
  });
  state.correlator.observe({
    phase: "update",
    toolName: "subagent",
    toolCallId: "status-event-id",
    result: {
      details: {
        mode: "single",
        workflowChildren: summary(false, [
          { childId: "child", state: "running", agent: "worker" },
        ]),
      },
    },
  });
  assert.equal(state.entries.length, 1);

  const reloaded = harness();
  reloaded.correlator.observe({
    phase: "end",
    toolName: "subagent",
    toolCallId: "launch",
    result: {
      details: { mode: "workflow", workflowChildren: summary(false, []) },
    },
  });
  assert.equal(reloaded.entries.length, 0);
  reloaded.correlator.restore([]);
  reloaded.correlator.observe({
    phase: "end",
    toolName: "subagent_wait",
    toolCallId: "wait-event-id",
    result: {
      details: {
        completions: [
          {
            runId: "workflow",
            workflowChildren: summary(true, [
              { childId: "child", state: "completed" },
            ]),
          },
        ],
      },
    },
  });
  assert.deepEqual(
    reloaded.entries.map((entry) => [entry.childId, entry.inventoryClosed]),
    [
      ["child", undefined],
      ["child", undefined],
      ["child", true],
    ],
  );
});

test("releases repeated terminal empty workflows before later valid correlation", () => {
  const state = harness();
  const empty = (
    parentToolCallId: string,
    workflowRunId: string,
    complete = true,
  ) => ({
    version: 1,
    parentToolCallId,
    workflowRunId,
    inventoryComplete: complete,
    workflowState: complete ? ("completed" as const) : ("running" as const),
    children: [],
  });
  state.correlator.observe({
    phase: "update",
    toolName: "subagent",
    toolCallId: "active-empty-launch",
    result: {
      details: {
        mode: "workflow",
        workflowChildren: empty(
          "active-empty-launch",
          "active-empty-run",
          false,
        ),
      },
    },
  });
  state.correlator.observe({
    phase: "end",
    toolName: "subagent",
    toolCallId: "active-empty-launch",
    result: {
      details: {
        mode: "workflow",
        workflowChildren: empty("active-empty-launch", "active-empty-run"),
      },
    },
  });
  const repeated = SUBAGENT_PROGRESS_LIMITS.maxActiveParents;
  for (let index = 0; index <= repeated; index += 1)
    state.correlator.observe({
      phase: "end",
      toolName: "subagent",
      toolCallId: `empty-launch-${index}`,
      result: {
        details: {
          mode: "workflow",
          workflowChildren: empty(
            `empty-launch-${index}`,
            `empty-run-${index}`,
          ),
        },
      },
    });

  for (const [toolCallId, workflowRunId] of [
    ["later-launch", `empty-run-${repeated}`],
    [`empty-launch-${repeated - 1}`, "later-run"],
    ["active-empty-launch", "active-later-run"],
  ])
    state.correlator.observe({
      phase: "end",
      toolName: "subagent",
      toolCallId,
      result: {
        details: {
          mode: "workflow",
          workflowChildren: {
            ...empty(toolCallId, workflowRunId),
            children: [
              { childId: "child", state: "completed", agent: "worker" },
            ],
          },
        },
      },
    });

  assert.deepEqual(
    state.entries.map((entry) => [
      entry.toolCallId,
      entry.workflowRunId,
      entry.inventoryClosed,
    ]),
    [
      ["later-launch", `empty-run-${repeated}`, undefined],
      ["later-launch", `empty-run-${repeated}`, true],
      [`empty-launch-${repeated - 1}`, "later-run", undefined],
      [`empty-launch-${repeated - 1}`, "later-run", true],
      ["active-empty-launch", "active-later-run", undefined],
      ["active-empty-launch", "active-later-run", true],
    ],
  );
});

test("restores an empty workflow launch for later async status children", () => {
  const state = harness();
  const summary = (children: unknown[]) => ({
    version: 1,
    parentToolCallId: "launch",
    workflowRunId: "workflow",
    inventoryComplete: false,
    workflowState: "running",
    children,
  });
  state.correlator.observe({
    phase: "end",
    toolName: "subagent",
    toolCallId: "launch",
    result: {
      details: { mode: "workflow", workflowChildren: summary([]) },
    },
  });
  assert.deepEqual(state.entries, []);

  const reloaded = harness();
  reloaded.correlator.restore([]);
  reloaded.correlator.observe({
    phase: "update",
    toolName: "subagent",
    toolCallId: "status-event-id",
    result: {
      details: {
        mode: "single",
        workflowChildren: summary([
          { childId: "child", state: "running", agent: "worker" },
        ]),
      },
    },
  });
  assert.deepEqual(reloaded.entries, [
    {
      version: 1,
      kind: "workflow",
      toolCallId: "launch",
      workflowRunId: "workflow",
      childId: "child",
      state: "running",
      agent: "worker",
    },
  ]);
});

test("rejects workflow parent/run drift and completion sibling corruption", () => {
  const state = harness();
  const summary = (parentToolCallId: string, workflowRunId: string) => ({
    version: 1,
    parentToolCallId,
    workflowRunId,
    inventoryComplete: false,
    workflowState: "running" as const,
    children: [
      { childId: "child", state: "running" as const, agent: "worker" },
    ],
  });
  const launch = (workflowRunId: string) =>
    state.correlator.observe({
      phase: "update",
      toolName: "subagent",
      toolCallId: "launch",
      result: {
        details: {
          mode: "workflow",
          workflowChildren: summary("launch", workflowRunId),
        },
      },
    });
  launch("workflow-one");
  launch("workflow-two");
  state.correlator.observe({
    phase: "update",
    toolName: "subagent",
    toolCallId: "status-event-id",
    result: {
      details: {
        mode: "single",
        workflowChildren: summary("sibling", "workflow-one"),
      },
    },
  });
  state.correlator.observe({
    phase: "end",
    toolName: "subagent_wait",
    toolCallId: "wait-event-id",
    result: {
      details: {
        completions: [
          {
            runId: "different-run",
            workflowChildren: summary("launch", "workflow-one"),
          },
        ],
      },
    },
  });
  assert.equal(state.entries.length, 1);
});

test("keeps workflow groups without a deterministic seal open until their fallback closure is recoverable", () => {
  for (const seals of [["second"]]) {
    const state = harness();
    state.correlator.restore(
      ["first", "second"].map((childId) => ({
        type: "custom",
        customType: "patchmill-subagent-progress",
        data: {
          version: 1,
          kind: "workflow",
          toolCallId: "launch",
          workflowRunId: "workflow",
          childId,
          state: "completed",
          agent: "worker",
          ...(seals.includes(childId) ? { inventoryClosed: true } : {}),
        },
      })),
    );
    state.correlator.observe({
      phase: "update",
      toolName: "subagent",
      toolCallId: "status",
      result: {
        details: {
          mode: "single",
          workflowChildren: {
            version: 1,
            parentToolCallId: "launch",
            workflowRunId: "workflow",
            inventoryComplete: false,
            workflowState: "running",
            children: [
              { childId: "first", state: "running", agent: "worker" },
              { childId: "second", state: "running", agent: "worker" },
            ],
          },
        },
      },
    });
    assert.equal(state.entries.length, 2);
  }

  const fallback = harness();
  fallback.correlator.restore([
    {
      type: "custom",
      customType: "patchmill-subagent-progress",
      data: {
        version: 1,
        kind: "workflow",
        toolCallId: "launch",
        workflowRunId: "workflow",
        childId: "child",
        state: "completed",
        inventoryClosed: true,
      },
    },
  ]);
  fallback.correlator.observe({
    phase: "end",
    toolName: "subagent",
    toolCallId: "launch",
    result: {
      details: {
        mode: "workflow",
        workflowChildren: {
          version: 1,
          parentToolCallId: "launch",
          workflowRunId: "workflow",
          inventoryComplete: true,
          workflowState: "completed",
          children: [{ childId: "child", state: "completed" }],
        },
      },
    },
  });
  assert.deepEqual(fallback.entries, [
    {
      version: 1,
      kind: "workflow",
      toolCallId: "launch",
      workflowRunId: "workflow",
      childId: "child",
      state: "completed",
    },
    {
      version: 1,
      kind: "workflow",
      toolCallId: "launch",
      workflowRunId: "workflow",
      childId: "child",
      state: "completed",
      unresolved: true,
    },
    {
      version: 1,
      kind: "workflow",
      toolCallId: "launch",
      workflowRunId: "workflow",
      childId: "child",
      state: "completed",
      inventoryClosed: true,
    },
  ]);
});

test("preserves every workflow child lifecycle state independently", () => {
  const states = [
    "pending",
    "running",
    "completed",
    "failed",
    "paused",
    "stopped",
    "rejected",
    "detached",
  ] as const;
  for (const lifecycleState of states) {
    const state = harness();
    state.correlator.observe({
      phase: "update",
      toolName: "subagent",
      toolCallId: "launch",
      result: {
        details: {
          mode: "workflow",
          workflowChildren: {
            version: 1,
            parentToolCallId: "launch",
            workflowRunId: `workflow-${lifecycleState}`,
            inventoryComplete: false,
            workflowState: "running",
            children: [{ childId: "child", state: lifecycleState }],
          },
        },
      },
    });
    assert.deepEqual(state.entries, [
      {
        version: 1,
        kind: "workflow",
        toolCallId: "launch",
        workflowRunId: `workflow-${lifecycleState}`,
        childId: "child",
        state: lifecycleState,
      },
    ]);
  }
});
