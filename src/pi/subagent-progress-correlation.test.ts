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
  let successfulAppendsBeforeError = 0;
  const correlator = createSubagentProgressCorrelator({
    append(progress) {
      if (nextError && successfulAppendsBeforeError === 0) {
        const error = nextError;
        nextError = undefined;
        throw error;
      }
      if (nextError) successfulAppendsBeforeError -= 1;
      entries.push(progress);
    },
  });
  return {
    entries,
    correlator,
    fail(error: Error) {
      nextError = error;
      successfulAppendsBeforeError = 0;
    },
    failAfter(error: Error, successfulAppends: number) {
      nextError = error;
      successfulAppendsBeforeError = successfulAppends;
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

test("restores workflow closure seals but leaves open paused inventories active", () => {
  const state = harness();
  const entries = (inventoryClosed: boolean) =>
    Array.from({ length: 256 }, (_, index) => ({
      type: "custom",
      customType: "patchmill-subagent-progress",
      data: {
        version: 1,
        kind: "workflow",
        toolCallId: `launch-${index}`,
        workflowRunId: `workflow-${index}`,
        childId: "child",
        state: "paused",
        agent: "worker",
        ...(inventoryClosed ? { inventoryClosed: true } : {}),
      },
    }));
  const direct = () =>
    state.correlator.observe({
      phase: "end",
      toolName: "subagent",
      toolCallId: "new",
      result: {
        details: {
          mode: "single",
          runId: "new-run",
          results: [{ index: 0, agent: "worker", exitCode: 0 }],
        },
      },
    });
  state.correlator.restore(entries(false));
  assert.throws(
    direct,
    new RegExp("PATCHMILL_SUBAGENT_PROGRESS_LIMIT_EXCEEDED"),
  );
  state.correlator.restore(entries(true));
  direct();
  assert.equal(state.entries.length, 1);
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

test("restores only open state while preserving tuple and transition history", () => {
  const state = harness();
  const closed = Array.from({ length: 257 }, (_, index) => ({
    type: "custom",
    customType: "patchmill-subagent-progress",
    data: {
      version: 1,
      kind: "direct",
      toolCallId: `closed-${index}`,
      runId: `run-${index}`,
      childIndex: 0,
      state: "completed",
      agent: "worker",
    },
  }));
  state.correlator.restore(closed);
  state.correlator.observe({
    phase: "end",
    toolName: "subagent",
    toolCallId: "new",
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

test("restoration counts matching entries but deduplicates active tuple keys", () => {
  const state = harness();
  const entry = {
    type: "custom",
    customType: "patchmill-subagent-progress",
    data: {
      version: 1,
      kind: "direct",
      toolCallId: "open",
      runId: "run",
      childIndex: 0,
      state: "pending",
    },
  };
  state.correlator.restore([entry, entry]);
  state.correlator.observe({
    phase: "update",
    toolName: "subagent",
    toolCallId: "open",
    result: {
      details: {
        mode: "single",
        runId: "run",
        results: [{ index: 0, agent: "worker" }],
      },
    },
  });
  assert.equal(state.entries.length, 1);
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

test("rejects blank and oversized direct event identifiers", () => {
  const state = harness();
  for (const toolCallId of ["", " ", "x".repeat(1025)])
    state.correlator.observe({
      phase: "end",
      toolName: "subagent",
      toolCallId,
      result: {
        details: {
          mode: "single",
          runId: "run",
          results: [{ index: 0, agent: "worker", exitCode: 0 }],
        },
      },
    });
  assert.equal(state.entries.length, 0);
});

test("preflights restored active tuple keys without retaining partial state", () => {
  const state = harness();
  const entries = Array.from({ length: 256 }, (_, parent) =>
    Array.from({ length: parent === 0 ? 3 : 2 }, (_, childIndex) =>
      Array.from({ length: 32 }, (_, transition) => ({
        type: "custom",
        customType: "patchmill-subagent-progress",
        data: {
          version: 1,
          kind: "direct",
          toolCallId: `launch-${parent}`,
          runId: `run-${parent}`,
          childIndex,
          state: "pending",
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

test("does not restore paused direct histories as active parents but restores pending async", () => {
  const state = harness();
  state.correlator.restore(
    Array.from({ length: 257 }, (_, i) => ({
      type: "custom",
      customType: "patchmill-subagent-progress",
      data: {
        version: 1,
        kind: "direct",
        toolCallId: `paused${i}`,
        runId: `r${i}`,
        childIndex: 0,
        state: "paused",
      },
    })),
  );
  state.correlator.restore([
    {
      type: "custom",
      customType: "patchmill-subagent-progress",
      data: {
        version: 1,
        kind: "direct",
        toolCallId: "launch",
        runId: "async",
        childIndex: 0,
        state: "pending",
      },
    },
  ]);
  state.correlator.observe({
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
  assert.equal(state.entries.length, 1);
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
