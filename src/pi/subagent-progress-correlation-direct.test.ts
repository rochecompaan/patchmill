import assert from "node:assert/strict";
import { test } from "node:test";
import { SUBAGENT_PROGRESS_APPEND_ERROR } from "./subagent-progress-correlation.ts";
import { harness } from "./subagent-progress-correlation-test-support.ts";

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

test("rejects foreground snapshots for an active async direct run", () => {
  const state = harness();
  state.correlator.observe({
    phase: "end",
    toolName: "subagent",
    toolCallId: "launch",
    result: { details: { mode: "single", asyncId: "async", results: [] } },
  });
  state.correlator.observe({
    phase: "end",
    toolName: "subagent",
    toolCallId: "launch",
    result: {
      details: {
        mode: "single",
        runId: "async",
        results: [{ index: 1, agent: "worker", exitCode: 0 }],
      },
    },
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
  assert.deepEqual(state.entries, [
    {
      version: 1,
      kind: "direct",
      toolCallId: "launch",
      runId: "async",
      childIndex: 0,
      state: "pending",
    },
    {
      version: 1,
      kind: "direct",
      toolCallId: "launch",
      runId: "async",
      childIndex: 0,
      state: "completed",
      agent: "reviewer",
    },
  ]);
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
