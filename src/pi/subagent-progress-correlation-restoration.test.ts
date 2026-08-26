import assert from "node:assert/strict";
import { test } from "node:test";
import { harness } from "./subagent-progress-correlation-test-support.ts";

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
    phase: "end",
    toolName: "subagent_wait",
    toolCallId: "wait",
    result: {
      details: {
        completions: [
          { runId: "run", state: "complete", results: [{ agent: "worker" }] },
        ],
      },
    },
  });
  assert.equal(state.entries.length, 1);
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

test("retains the pre-seal fingerprint despite a malformed post-seal child", () => {
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
      childId: "aardvark",
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
            { childId: "aardvark", state: "completed", agent: "worker" },
          ],
        },
      },
    },
  });
  assert.deepEqual(state.entries, []);
});

test("restores the first durable seal despite a later malformed seal on an existing child", () => {
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
      childId: "second",
      state: "completed",
      agent: "worker",
      inventoryClosed: true,
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
