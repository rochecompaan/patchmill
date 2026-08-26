import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createSubagentProgressCorrelator,
  SUBAGENT_PROGRESS_APPEND_ERROR,
} from "./subagent-progress-correlation.ts";
import {
  SUBAGENT_PROGRESS_LIMITS,
  type PersistedSubagentProgress,
} from "./subagent-progress.ts";

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

test("restores an interrupted direct completion until its fallback persists", () => {
  const state = harness();
  state.correlator.observe({
    phase: "end",
    toolName: "subagent",
    toolCallId: "launch",
    result: { details: { mode: "single", asyncId: "async", results: [] } },
  });
  const completion = {
    phase: "end" as const,
    toolName: "subagent_wait",
    toolCallId: "wait",
    result: {
      details: {
        completions: [{ runId: "async", state: "complete", results: [{}] }],
      },
    },
  };
  state.failAfter(new Error("append"), 1);
  assert.throws(
    () => state.correlator.observe(completion),
    new RegExp(SUBAGENT_PROGRESS_APPEND_ERROR),
  );
  assert.deepEqual(
    state.entries.map((entry) => [entry.state, entry.unresolved]),
    [
      ["pending", undefined],
      ["completed", undefined],
    ],
  );

  const reloaded = harness();
  reloaded.correlator.restore(
    state.entries.map((data) => ({
      type: "custom",
      customType: "patchmill-subagent-progress",
      data,
    })),
  );
  reloaded.correlator.observe(completion);
  assert.deepEqual(reloaded.entries, [
    {
      version: 1,
      kind: "direct",
      toolCallId: "launch",
      runId: "async",
      childIndex: 0,
      state: "completed",
      unresolved: true,
    },
  ]);
});

test("rejects contradictory direct async run ownership on launch and restore", () => {
  const state = harness();
  const launch = (toolCallId: string) =>
    state.correlator.observe({
      phase: "end",
      toolName: "subagent",
      toolCallId,
      result: {
        details: { mode: "single", asyncId: "async", results: [] },
      },
    });
  launch("first");
  launch("second");
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
        ],
      },
    },
  });
  assert.deepEqual(
    state.entries.map((entry) => entry.toolCallId),
    ["first", "first"],
  );

  const reloaded = harness();
  reloaded.correlator.restore(
    ["first", "second"].map((toolCallId) => ({
      type: "custom",
      customType: "patchmill-subagent-progress",
      data: {
        version: 1,
        kind: "direct",
        toolCallId,
        runId: "conflicted",
        childIndex: 0,
        state: "pending",
      },
    })),
  );
  reloaded.correlator.observe({
    phase: "end",
    toolName: "subagent_wait",
    toolCallId: "wait",
    result: {
      details: {
        completions: [
          {
            runId: "conflicted",
            state: "complete",
            results: [{ agent: "worker" }],
          },
        ],
      },
    },
  });
  assert.deepEqual(reloaded.entries, []);
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
  const rows = (count: number) =>
    Array.from({ length: count }, (_, index) => ({
      type: "custom",
      customType: "patchmill-subagent-progress",
      data: {
        version: 1,
        kind: "workflow",
        toolCallId: "closed-launch",
        workflowRunId: "closed-run",
        childId: `child-${index}`,
        state: "completed",
        ...(index === 0 ? { inventoryClosed: true } : {}),
      },
    }));
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

test("restores only child zero async direct histories while retaining invalid tuples for deduplication", () => {
  const state = harness();
  state.correlator.restore(
    Array.from({ length: 256 }, (_, index) => ({
      type: "custom",
      customType: "patchmill-subagent-progress",
      data: {
        version: 1,
        kind: "direct",
        toolCallId: `invalid-launch-${index}`,
        runId: `invalid-async-${index}`,
        childIndex: 1,
        state: "pending",
      },
    })),
  );
  state.correlator.observe({
    phase: "end",
    toolName: "subagent_wait",
    toolCallId: "wait",
    result: {
      details: {
        completions: [{ runId: "invalid-async-0", state: "complete" }],
      },
    },
  });
  assert.deepEqual(state.entries, []);
  state.correlator.observe({
    phase: "end",
    toolName: "subagent",
    toolCallId: "launch",
    result: { details: { mode: "single", asyncId: "async", results: [] } },
  });
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

test("keeps malformed closed workflow groups open until their deterministic fallback closure is recoverable", () => {
  for (const seals of [["second"], ["first", "second"]]) {
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

test("rejects a combined workflow fallback and closure seal during restore", () => {
  const state = harness();
  state.correlator.restore([
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
        unresolved: true,
        inventoryClosed: true,
      },
    },
  ]);
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
          children: [{ childId: "child", state: "running" }],
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
      state: "running",
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

test("repairs an out-of-order restored closure seal durably before releasing", () => {
  const persisted = [
    {
      type: "custom",
      customType: "patchmill-subagent-progress",
      data: {
        version: 1,
        kind: "workflow",
        toolCallId: "launch",
        workflowRunId: "workflow",
        childId: "first",
        state: "completed",
        agent: "worker",
      },
    },
    {
      type: "custom",
      customType: "patchmill-subagent-progress",
      data: {
        version: 1,
        kind: "workflow",
        toolCallId: "launch",
        workflowRunId: "workflow",
        childId: "second",
        state: "completed",
      },
    },
    {
      type: "custom",
      customType: "patchmill-subagent-progress",
      data: {
        version: 1,
        kind: "workflow",
        toolCallId: "launch",
        workflowRunId: "workflow",
        childId: "first",
        state: "completed",
        agent: "worker",
        inventoryClosed: true,
      },
    },
    {
      type: "custom",
      customType: "patchmill-subagent-progress",
      data: {
        version: 1,
        kind: "workflow",
        toolCallId: "launch",
        workflowRunId: "workflow",
        childId: "second",
        state: "completed",
        unresolved: true,
      },
    },
  ];
  const summary = {
    version: 1,
    parentToolCallId: "launch",
    workflowRunId: "workflow",
    inventoryComplete: true,
    workflowState: "completed",
    children: [
      { childId: "first", state: "completed", agent: "worker" },
      { childId: "second", state: "completed" },
    ],
  };
  const state = harness();
  state.correlator.restore(persisted);
  state.correlator.observe({
    phase: "end",
    toolName: "subagent",
    toolCallId: "status",
    result: { details: { mode: "single", workflowChildren: summary } },
  });
  assert.deepEqual(state.entries, [
    {
      version: 1,
      kind: "workflow",
      toolCallId: "launch",
      workflowRunId: "workflow",
      childId: "first",
      state: "completed",
      agent: "worker",
      inventoryClosed: true,
    },
  ]);

  const reloaded = harness();
  reloaded.correlator.restore([
    ...persisted,
    ...state.entries.map((data) => ({
      type: "custom",
      customType: "patchmill-subagent-progress",
      data,
    })),
  ]);
  reloaded.correlator.observe({
    phase: "update",
    toolName: "subagent",
    toolCallId: "status",
    result: {
      details: {
        mode: "single",
        workflowChildren: {
          ...summary,
          inventoryComplete: false,
          workflowState: "running",
        },
      },
    },
  });
  assert.deepEqual(reloaded.entries, []);
});

test("restores a replacement closure seal after a fallback on the second reload", () => {
  const entry = (data: Record<string, unknown>) => ({
    type: "custom",
    customType: "patchmill-subagent-progress",
    data,
  });
  const persisted = [
    entry({
      version: 1,
      kind: "workflow",
      toolCallId: "launch",
      workflowRunId: "workflow",
      childId: "first",
      state: "completed",
      agent: "worker",
    }),
    entry({
      version: 1,
      kind: "workflow",
      toolCallId: "launch",
      workflowRunId: "workflow",
      childId: "second",
      state: "completed",
    }),
    entry({
      version: 1,
      kind: "workflow",
      toolCallId: "launch",
      workflowRunId: "workflow",
      childId: "first",
      state: "completed",
      agent: "worker",
      inventoryClosed: true,
    }),
    entry({
      version: 1,
      kind: "workflow",
      toolCallId: "launch",
      workflowRunId: "workflow",
      childId: "second",
      state: "completed",
      unresolved: true,
    }),
  ];
  const summary = {
    version: 1,
    parentToolCallId: "launch",
    workflowRunId: "workflow",
    inventoryComplete: true,
    workflowState: "completed",
    children: [
      { childId: "first", state: "completed", agent: "worker" },
      { childId: "second", state: "completed" },
    ],
  };
  const repaired = harness();
  repaired.correlator.restore(persisted);
  repaired.correlator.observe({
    phase: "end",
    toolName: "subagent",
    toolCallId: "status",
    result: { details: { mode: "single", workflowChildren: summary } },
  });
  assert.equal(repaired.entries.length, 1);

  const reloaded = harness();
  reloaded.correlator.restore([
    ...persisted,
    ...repaired.entries.map((data) => entry(data)),
  ]);
  reloaded.correlator.observe({
    phase: "update",
    toolName: "subagent",
    toolCallId: "status",
    result: {
      details: {
        mode: "single",
        workflowChildren: {
          ...summary,
          inventoryComplete: false,
          workflowState: "running",
          children: [
            ...summary.children,
            { childId: "later", state: "pending", agent: "worker" },
          ],
        },
      },
    },
  });
  assert.deepEqual(reloaded.entries, []);
});

test("restores a repaired closure after fallback and authoritative enrichment", () => {
  const entry = (data: Record<string, unknown>) => ({
    type: "custom",
    customType: "patchmill-subagent-progress",
    data,
  });
  const persisted = [
    entry({
      version: 1,
      kind: "workflow",
      toolCallId: "launch",
      workflowRunId: "workflow",
      childId: "first",
      state: "completed",
      agent: "worker",
    }),
    entry({
      version: 1,
      kind: "workflow",
      toolCallId: "launch",
      workflowRunId: "workflow",
      childId: "second",
      state: "completed",
    }),
    entry({
      version: 1,
      kind: "workflow",
      toolCallId: "launch",
      workflowRunId: "workflow",
      childId: "first",
      state: "completed",
      agent: "worker",
      inventoryClosed: true,
    }),
    entry({
      version: 1,
      kind: "workflow",
      toolCallId: "launch",
      workflowRunId: "workflow",
      childId: "second",
      state: "completed",
      unresolved: true,
    }),
  ];
  const summary = {
    version: 1,
    parentToolCallId: "launch",
    workflowRunId: "workflow",
    inventoryComplete: true,
    workflowState: "completed",
    children: [
      { childId: "first", state: "completed", agent: "worker" },
      { childId: "second", state: "completed", agent: "worker" },
    ],
  };
  const repaired = harness();
  repaired.correlator.restore(persisted);
  repaired.correlator.observe({
    phase: "end",
    toolName: "subagent",
    toolCallId: "status",
    result: { details: { mode: "single", workflowChildren: summary } },
  });
  assert.equal(repaired.entries.length, 2);

  const reloaded = harness();
  reloaded.correlator.restore([
    ...persisted,
    ...repaired.entries.map((data) => entry(data)),
  ]);
  reloaded.correlator.observe({
    phase: "update",
    toolName: "subagent",
    toolCallId: "status",
    result: {
      details: {
        mode: "single",
        workflowChildren: {
          ...summary,
          inventoryComplete: false,
          workflowState: "running",
          children: [
            ...summary.children,
            { childId: "later", state: "pending", agent: "worker" },
          ],
        },
      },
    },
  });
  assert.deepEqual(reloaded.entries, []);
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

test("keeps a restored workflow open when a child first appears after its seal", () => {
  const entry = (data: Record<string, unknown>) => ({
    type: "custom",
    customType: "patchmill-subagent-progress",
    data,
  });
  const state = harness();
  state.correlator.restore([
    entry({
      version: 1,
      kind: "workflow",
      toolCallId: "launch",
      workflowRunId: "workflow",
      childId: "first",
      state: "completed",
      agent: "worker",
    }),
    entry({
      version: 1,
      kind: "workflow",
      toolCallId: "launch",
      workflowRunId: "workflow",
      childId: "second",
      state: "completed",
      agent: "worker",
    }),
    entry({
      version: 1,
      kind: "workflow",
      toolCallId: "launch",
      workflowRunId: "workflow",
      childId: "first",
      state: "completed",
      agent: "worker",
      inventoryClosed: true,
    }),
    entry({
      version: 1,
      kind: "workflow",
      toolCallId: "launch",
      workflowRunId: "workflow",
      childId: "later",
      state: "completed",
      agent: "worker",
    }),
  ]);
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
          children: [
            { childId: "first", state: "failed", agent: "worker" },
            { childId: "second", state: "completed", agent: "worker" },
            { childId: "later", state: "completed", agent: "worker" },
          ],
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
      childId: "first",
      state: "failed",
      agent: "worker",
    },
    {
      version: 1,
      kind: "workflow",
      toolCallId: "launch",
      workflowRunId: "workflow",
      childId: "first",
      state: "failed",
      agent: "worker",
      inventoryClosed: true,
    },
  ]);
});

test("restores a closed workflow despite post-closure authoritative enrichment", () => {
  const entry = (data: Record<string, unknown>) => ({
    type: "custom",
    customType: "patchmill-subagent-progress",
    data,
  });
  const state = harness();
  state.correlator.restore([
    entry({
      version: 1,
      kind: "workflow",
      toolCallId: "launch",
      workflowRunId: "workflow",
      childId: "first",
      state: "completed",
      agent: "worker",
    }),
    entry({
      version: 1,
      kind: "workflow",
      toolCallId: "launch",
      workflowRunId: "workflow",
      childId: "second",
      state: "completed",
    }),
    entry({
      version: 1,
      kind: "workflow",
      toolCallId: "launch",
      workflowRunId: "workflow",
      childId: "second",
      state: "completed",
      unresolved: true,
    }),
    entry({
      version: 1,
      kind: "workflow",
      toolCallId: "launch",
      workflowRunId: "workflow",
      childId: "first",
      state: "completed",
      agent: "worker",
      inventoryClosed: true,
    }),
    entry({
      version: 1,
      kind: "workflow",
      toolCallId: "launch",
      workflowRunId: "workflow",
      childId: "second",
      state: "completed",
      agent: "worker",
    }),
  ]);
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
            { childId: "first", state: "completed", agent: "worker" },
            { childId: "second", state: "completed", agent: "worker" },
            { childId: "later", state: "pending", agent: "worker" },
          ],
        },
      },
    },
  });
  assert.deepEqual(state.entries, []);
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

test("emits unresolved direct fallbacks when a terminal result omits every active row", () => {
  const state = harness();
  state.correlator.observe({
    phase: "update",
    toolName: "subagent",
    toolCallId: "launch",
    result: {
      details: {
        mode: "single",
        runId: "run",
        results: [{ index: 0, stopped: true }],
      },
    },
  });
  state.correlator.observe({
    phase: "end",
    toolName: "subagent",
    toolCallId: "launch",
    result: { details: { mode: "single", runId: "run", results: [] } },
  });
  assert.deepEqual(state.entries, [
    {
      version: 1,
      kind: "direct",
      toolCallId: "launch",
      runId: "run",
      childIndex: 0,
      state: "stopped",
    },
    {
      version: 1,
      kind: "direct",
      toolCallId: "launch",
      runId: "run",
      childIndex: 0,
      state: "stopped",
      unresolved: true,
    },
  ]);
});

test("emits unresolved direct fallbacks for terminal rows omitted from a shrinking result", () => {
  const state = harness();
  state.correlator.observe({
    phase: "update",
    toolName: "subagent",
    toolCallId: "launch",
    result: {
      details: {
        mode: "single",
        runId: "run",
        results: [{ index: 0 }, { index: 1, stopped: true }],
      },
    },
  });
  state.correlator.observe({
    phase: "end",
    toolName: "subagent",
    toolCallId: "launch",
    result: {
      details: {
        mode: "single",
        runId: "run",
        results: [{ index: 0, agent: "worker", exitCode: 0 }],
      },
    },
  });
  assert.deepEqual(state.entries, [
    {
      version: 1,
      kind: "direct",
      toolCallId: "launch",
      runId: "run",
      childIndex: 0,
    },
    {
      version: 1,
      kind: "direct",
      toolCallId: "launch",
      runId: "run",
      childIndex: 1,
      state: "stopped",
    },
    {
      version: 1,
      kind: "direct",
      toolCallId: "launch",
      runId: "run",
      childIndex: 0,
      state: "completed",
      agent: "worker",
    },
    {
      version: 1,
      kind: "direct",
      toolCallId: "launch",
      runId: "run",
      childIndex: 1,
      state: "stopped",
      unresolved: true,
    },
  ]);
});
