import assert from "node:assert/strict";
import { test } from "node:test";
import { harness } from "./subagent-progress-correlation-test-support.ts";
import { SUBAGENT_PROGRESS_LIMITS } from "./subagent-progress.ts";

test("preflights restored active tuple keys without retaining partial state", () => {
  const state = harness();
  const entries = Array.from({ length: 256 }, (_, parent) =>
    Array.from({ length: parent === 0 ? 3 : 2 }, (_, childIndex) =>
      Array.from({ length: 32 }, (_, transition) => ({
        type: "custom",
        customType: "patchmill-subagent-progress",
        data: {
          version: 1,
          kind: "workflow",
          toolCallId: `launch-${parent}`,
          workflowRunId: `run-${parent}`,
          childId: `child-${childIndex}`,
          state: "running",
          model: `model-${transition}`,
        },
      })),
    ).flat(),
  ).flat();
  assert.equal(entries.length, 16416);
  assert.throws(
    () => state.correlator.restore(entries),
    /PATCHMILL_SUBAGENT_PROGRESS_LIMIT_EXCEEDED/u,
  );
  state.correlator.observe({
    phase: "end",
    toolName: "subagent",
    toolCallId: "new-launch",
    result: {
      details: {
        mode: "single",
        runId: "new-run",
        results: [{ index: 0, agent: "worker", exitCode: 0 }],
      },
    },
  });
  assert.equal(state.entries.length, 1);
});

test("preflights workflow batches before an over-limit append", () => {
  const state = harness();
  const entries = Array.from({ length: 65535 }, (_, index) => ({
    type: "custom",
    customType: "patchmill-subagent-progress",
    data: {
      version: 1,
      kind: "direct",
      toolCallId: `old-${index}`,
      runId: `run-${index}`,
      childIndex: 0,
      state: "completed",
      agent: "worker",
    },
  }));
  state.correlator.restore(entries);
  assert.throws(
    () =>
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
              workflowRunId: "workflow",
              inventoryComplete: false,
              workflowState: "running",
              children: [
                { childId: "one", state: "running" },
                { childId: "two", state: "running" },
              ],
            },
          },
        },
      }),
    /PATCHMILL_SUBAGENT_PROGRESS_LIMIT_EXCEEDED/u,
  );
  assert.equal(state.entries.length, 0);
});

test("preflights direct terminal tuple and fallback atomically", () => {
  const state = harness();
  state.correlator.restore(
    Array.from({ length: 65535 }, (_, i) => ({
      type: "custom",
      customType: "patchmill-subagent-progress",
      data: {
        version: 1,
        kind: "direct",
        toolCallId: `old${i}`,
        runId: `r${i}`,
        childIndex: 0,
        state: "completed",
        agent: "worker",
      },
    })),
  );
  assert.throws(
    () =>
      state.correlator.observe({
        phase: "end",
        toolName: "subagent",
        toolCallId: "launch",
        result: {
          details: {
            mode: "single",
            runId: "direct",
            results: [{ index: 0, exitCode: 0 }],
          },
        },
      }),
    /PATCHMILL_SUBAGENT_PROGRESS_LIMIT_EXCEEDED/u,
  );
  assert.equal(state.entries.length, 0);
});

test("restoration rejects 33 unique child transitions", () => {
  const state = harness();
  assert.throws(
    () =>
      state.correlator.restore(
        Array.from({ length: 33 }, (_, i) => ({
          type: "custom",
          customType: "patchmill-subagent-progress",
          data: {
            version: 1,
            kind: "workflow",
            toolCallId: "launch",
            workflowRunId: "workflow",
            childId: "child",
            state: "running",
            agent: `worker-${i}`,
          },
        })),
      ),
    /PATCHMILL_SUBAGENT_PROGRESS_LIMIT_EXCEEDED/u,
  );
  state.correlator.observe({
    phase: "end",
    toolName: "subagent",
    toolCallId: "new",
    result: {
      details: {
        mode: "single",
        runId: "new",
        results: [{ index: 0, agent: "worker", exitCode: 0 }],
      },
    },
  });
  assert.equal(state.entries.length, 1);
});

test("replays closed workflow batches without charging active keys or partially appending", () => {
  const inactive = harness();
  const activeRows = Array.from({ length: 512 }, (_, childIndex) =>
    Array.from({ length: 32 }, (_, transition) => ({
      type: "custom",
      customType: "patchmill-subagent-progress",
      data: {
        version: 1,
        kind: "direct",
        toolCallId: "active",
        runId: "active-run",
        childIndex,
        state: "pending",
        model: `model-${transition}`,
      },
    })),
  ).flat();
  inactive.correlator.restore([
    ...activeRows,
    {
      type: "custom",
      customType: "patchmill-subagent-progress",
      data: {
        version: 1,
        kind: "workflow",
        toolCallId: "closed-launch",
        workflowRunId: "closed-run",
        childId: "child",
        state: "completed",
        agent: "worker",
        inventoryClosed: true,
      },
    },
  ]);
  inactive.correlator.observe({
    phase: "end",
    toolName: "subagent",
    toolCallId: "closed-launch",
    result: {
      details: {
        mode: "workflow",
        workflowChildren: {
          version: 1,
          parentToolCallId: "closed-launch",
          workflowRunId: "closed-run",
          inventoryComplete: true,
          workflowState: "completed",
          children: [{ childId: "child", state: "completed", agent: "worker" }],
        },
      },
    },
  });
  assert.equal(inactive.entries.length, 1);

  const atomic = harness();
  atomic.correlator.restore([
    ...Array.from({ length: 65533 }, (_, index) => ({
      type: "custom",
      customType: "patchmill-subagent-progress",
      data: {
        version: 1,
        kind: "direct",
        toolCallId: `old-${index}`,
        runId: `old-run-${index}`,
        childIndex: 0,
        state: "completed",
      },
    })),
    ...["one", "two"].map((childId, index) => ({
      type: "custom",
      customType: "patchmill-subagent-progress",
      data: {
        version: 1,
        kind: "workflow",
        toolCallId: "closed-launch",
        workflowRunId: "closed-run",
        childId,
        state: "completed",
        ...(index === 0 ? { inventoryClosed: true } : {}),
      },
    })),
  ]);
  assert.throws(
    () =>
      atomic.correlator.observe({
        phase: "end",
        toolName: "subagent",
        toolCallId: "closed-launch",
        result: {
          details: {
            mode: "workflow",
            workflowChildren: {
              version: 1,
              parentToolCallId: "closed-launch",
              workflowRunId: "closed-run",
              inventoryComplete: true,
              workflowState: "completed",
              children: [
                { childId: "one", state: "completed", agent: "worker" },
                { childId: "two", state: "completed", agent: "worker" },
              ],
            },
          },
        },
      }),
    /PATCHMILL_SUBAGENT_PROGRESS_LIMIT_EXCEEDED/u,
  );
  assert.equal(atomic.entries.length, 0);
});

test("excludes every workflow group participating in ownership conflicts", () => {
  const state = harness();
  const row = (toolCallId: string, workflowRunId: string) => ({
    type: "custom",
    customType: "patchmill-subagent-progress",
    data: {
      version: 1,
      kind: "workflow",
      toolCallId,
      workflowRunId,
      childId: "child",
      state: "running",
    },
  });
  state.correlator.restore(
    Array.from({ length: 128 }, (_, index) => [
      row(`run-parent-${index}-a`, `shared-run-${index}`),
      row(`run-parent-${index}-b`, `shared-run-${index}`),
      row(`shared-parent-${index}`, `parent-run-${index}-a`),
      row(`shared-parent-${index}`, `parent-run-${index}-b`),
    ]).flat(),
  );
  state.correlator.observe({
    phase: "end",
    toolName: "subagent",
    toolCallId: "new-launch",
    result: {
      details: {
        mode: "single",
        runId: "new-run",
        results: [{ index: 0, agent: "worker", exitCode: 0 }],
      },
    },
  });
  assert.equal(state.entries.length, 1);
});

test("enforces closed workflow child cardinality before restoring state", () => {
  const rows = (count: number) => [
    ...Array.from({ length: count }, (_, index) => ({
      type: "custom",
      customType: "patchmill-subagent-progress",
      data: {
        version: 1,
        kind: "workflow",
        toolCallId: "closed-launch",
        workflowRunId: "closed-run",
        childId: `child-${index}`,
        state: "completed",
        agent: "worker",
      },
    })),
    {
      type: "custom",
      customType: "patchmill-subagent-progress",
      data: {
        version: 1,
        kind: "workflow",
        toolCallId: "closed-launch",
        workflowRunId: "closed-run",
        childId: "child-0",
        state: "completed",
        agent: "worker",
        inventoryClosed: true,
      },
    },
  ];
  const state = harness();
  state.correlator.restore(rows(1024));
  assert.throws(
    () => state.correlator.restore(rows(1025)),
    /PATCHMILL_SUBAGENT_PROGRESS_LIMIT_EXCEEDED/u,
  );
  state.correlator.observe({
    phase: "end",
    toolName: "subagent",
    toolCallId: "new-launch",
    result: {
      details: {
        mode: "single",
        runId: "new-run",
        results: [{ index: 0, agent: "worker", exitCode: 0 }],
      },
    },
  });
  assert.equal(state.entries.length, 1);
});

test("accepts 32 workflow children with a second transition and rejects accumulated direct children", () => {
  const state = harness();
  const rows = (state: "pending" | "running") =>
    Array.from({ length: 32 }, (_, i) => ({
      childId: `child-${i}`,
      state,
      agent: "worker",
    }));
  for (const stateName of ["pending", "running"] as const)
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
            workflowRunId: "workflow",
            inventoryComplete: false,
            workflowState: "running",
            children: rows(stateName),
          },
        },
      },
    });
  assert.equal(state.entries.length, 64);
  const direct = harness();
  assert.throws(
    () =>
      direct.correlator.observe({
        phase: "update",
        toolName: "subagent",
        toolCallId: "launch",
        result: {
          details: {
            mode: "single",
            runId: "direct",
            results: Array.from({ length: 1025 }, (_, i) => ({
              index: i,
              agent: "worker",
            })),
          },
        },
      }),
    /PATCHMILL_SUBAGENT_PROGRESS_LIMIT_EXCEEDED/u,
  );
});

test("allows an exact 32-transition workflow closure retry without charging a skipped fallback", () => {
  const state = harness();
  state.correlator.restore(
    Array.from(
      { length: SUBAGENT_PROGRESS_LIMITS.maxTransitionsPerChild - 2 },
      (_, index) => ({
        type: "custom",
        customType: "patchmill-subagent-progress",
        data: {
          version: 1,
          kind: "workflow",
          toolCallId: "launch",
          workflowRunId: "workflow",
          childId: "child",
          state: "pending",
          model: `history-${index}`,
          ...(index === SUBAGENT_PROGRESS_LIMITS.maxTransitionsPerChild - 3
            ? { unresolved: true }
            : {}),
        },
      }),
    ),
  );
  state.correlator.observe({
    phase: "end",
    toolName: "subagent",
    toolCallId: "status",
    result: {
      details: {
        mode: "single",
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
  assert.deepEqual(state.entries, [
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
      inventoryClosed: true,
    },
  ]);
});

test("validates oversized workflow siblings before mutating direct completions", () => {
  const state = harness();
  state.correlator.observe({
    phase: "end",
    toolName: "subagent",
    toolCallId: "launch",
    result: { details: { mode: "single", asyncId: "async", results: [] } },
  });
  assert.throws(
    () =>
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
                results: [{ agent: "worker" }],
              },
              {
                runId: "workflow",
                workflowChildren: {
                  version: 1,
                  parentToolCallId: "workflow-launch",
                  workflowRunId: "workflow",
                  inventoryComplete: false,
                  workflowState: "running",
                  children: Array.from({ length: 1025 }, (_, index) => ({
                    childId: `child-${index}`,
                    state: "running",
                  })),
                },
              },
            ],
          },
        },
      }),
    /PATCHMILL_SUBAGENT_PROGRESS_LIMIT_EXCEEDED/u,
  );
  assert.deepEqual(state.entries, [
    {
      version: 1,
      kind: "direct",
      toolCallId: "launch",
      runId: "async",
      childIndex: 0,
      state: "pending",
    },
  ]);
});

test("allows exactly 65536 matching restored entries and rejects one over without replacing initialized state", () => {
  const entries = (count: number) =>
    Array.from({ length: count }, (_, index) => ({
      type: "custom",
      customType: "patchmill-subagent-progress",
      data: {
        version: 1,
        kind: "direct",
        toolCallId: `old-${index}`,
        runId: `run-${index}`,
        childIndex: 0,
        state: "completed",
      },
    }));
  const exact = harness();
  exact.correlator.restore(entries(65536));

  const initialized = harness();
  initialized.correlator.observe({
    phase: "end",
    toolName: "subagent",
    toolCallId: "launch",
    result: { details: { mode: "single", asyncId: "async", results: [] } },
  });
  assert.throws(
    () => initialized.correlator.restore(entries(65537)),
    /PATCHMILL_SUBAGENT_PROGRESS_LIMIT_EXCEEDED/u,
  );
  initialized.correlator.observe({
    phase: "end",
    toolName: "subagent_wait",
    toolCallId: "wait",
    result: {
      details: {
        completions: [
          { runId: "async", state: "complete", results: [{ agent: "worker" }] },
        ],
      },
    },
  });
  assert.equal(initialized.entries.length, 2);
});

test("preflights mixed subagent_wait transitions before direct completion mutation", () => {
  const entry = (data: Record<string, unknown>) => ({
    type: "custom",
    customType: "patchmill-subagent-progress",
    data,
  });
  const state = harness();
  state.correlator.restore(
    Array.from(
      { length: SUBAGENT_PROGRESS_LIMITS.maxTransitionsPerChild },
      (_, index) =>
        entry({
          version: 1,
          kind: "workflow",
          toolCallId: "workflow-launch",
          workflowRunId: "workflow",
          childId: "child",
          state: "running",
          model: `history-${index}`,
        }),
    ),
  );
  state.correlator.observe({
    phase: "end",
    toolName: "subagent",
    toolCallId: "direct-launch",
    result: { details: { mode: "single", asyncId: "async", results: [] } },
  });
  assert.throws(
    () =>
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
                results: [{ agent: "worker" }],
              },
              {
                runId: "workflow",
                workflowChildren: {
                  version: 1,
                  parentToolCallId: "workflow-launch",
                  workflowRunId: "workflow",
                  inventoryComplete: false,
                  workflowState: "running",
                  children: [
                    { childId: "child", state: "running", model: "new" },
                  ],
                },
              },
            ],
          },
        },
      }),
    /PATCHMILL_SUBAGENT_PROGRESS_LIMIT_EXCEEDED/u,
  );
  assert.deepEqual(state.entries, [
    {
      version: 1,
      kind: "direct",
      toolCallId: "direct-launch",
      runId: "async",
      childIndex: 0,
      state: "pending",
    },
  ]);
});

test("preflights malformed mixed-sibling nested arrays before direct completion mutation", () => {
  const event = (length: number, kind: "direct" | "workflow") => ({
    phase: "end" as const,
    toolName: "subagent_wait",
    toolCallId: "wait",
    result: {
      details: {
        completions: [
          {
            runId: "async",
            state: "complete",
            results: [{ agent: "worker" }],
          },
          kind === "direct"
            ? { runId: "", results: Array.from({ length }, () => ({})) }
            : {
                workflowChildren: {
                  version: 1,
                  parentToolCallId: "",
                  workflowRunId: "workflow",
                  inventoryComplete: false,
                  workflowState: "running",
                  children: Array.from({ length }, (_, index) => ({
                    childId: `child-${index}`,
                    state: "running",
                  })),
                },
              },
        ],
      },
    },
  });
  for (const kind of ["direct", "workflow"] as const) {
    const exact = harness();
    exact.correlator.observe({
      phase: "end",
      toolName: "subagent",
      toolCallId: "launch",
      result: { details: { mode: "single", asyncId: "async", results: [] } },
    });
    exact.correlator.observe(
      event(SUBAGENT_PROGRESS_LIMITS.maxResultRows, kind),
    );
    assert.equal(exact.entries.length, 2);

    const over = harness();
    over.correlator.observe({
      phase: "end",
      toolName: "subagent",
      toolCallId: "launch",
      result: { details: { mode: "single", asyncId: "async", results: [] } },
    });
    assert.throws(
      () =>
        over.correlator.observe(
          event(SUBAGENT_PROGRESS_LIMITS.maxResultRows + 1, kind),
        ),
      /PATCHMILL_SUBAGENT_PROGRESS_LIMIT_EXCEEDED/u,
    );
    assert.deepEqual(over.entries, [
      {
        version: 1,
        kind: "direct",
        toolCallId: "launch",
        runId: "async",
        childIndex: 0,
        state: "pending",
      },
    ]);
  }
});
