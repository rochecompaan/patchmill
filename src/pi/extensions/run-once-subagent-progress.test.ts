import assert from "node:assert/strict";
import { test } from "node:test";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
  SUBAGENT_PROGRESS_CUSTOM_TYPE,
  SUBAGENT_PROGRESS_LIMIT_ERROR,
  SUBAGENT_PROGRESS_LIMITS,
} from "../subagent-progress.ts";
import runOnceSubagentProgressExtension, {
  SUBAGENT_PROGRESS_APPEND_ERROR,
} from "./run-once-subagent-progress.ts";

type ObserverPi = Pick<ExtensionAPI, "on" | "appendEntry">;
type ObserverHandler = (event: any, context: any) => unknown;
type AppendedEntry = { customType: string; data: unknown };

function isLimitError(error: unknown): boolean {
  return (
    error instanceof Error && error.message === SUBAGENT_PROGRESS_LIMIT_ERROR
  );
}

function subagentResult(rows: unknown[]): unknown {
  return { details: { results: rows } };
}

function createHarness() {
  const handlers = new Map<string, ObserverHandler>();
  const entries: AppendedEntry[] = [];
  const existingSessionEntries: unknown[] = [];
  let nextAppendError: Error | undefined;
  const pi = {
    on(event: string, handler: ObserverHandler) {
      handlers.set(event, handler);
    },
    appendEntry(customType: string, data?: unknown) {
      if (nextAppendError) {
        const error = nextAppendError;
        nextAppendError = undefined;
        throw error;
      }
      entries.push({ customType, data });
    },
  } as unknown as ObserverPi;

  runOnceSubagentProgressExtension(pi);
  return {
    entries,
    existingSessionEntries,
    handlers,
    failNextAppend(error: Error) {
      nextAppendError = error;
    },
    async emit(name: string, event: unknown) {
      const handler = handlers.get(name);
      assert.ok(handler, `missing ${name} handler`);
      await handler(event, {
        sessionManager: { getEntries: () => existingSessionEntries },
      });
    },
  };
}

test("registers only the required lifecycle handlers", () => {
  assert.deepEqual(
    [...createHarness().handlers.keys()],
    ["session_start", "tool_execution_update", "tool_execution_end"],
  );
});

test("persists authoritative partials immediately and terminal fallback on errors", async () => {
  const harness = createHarness();
  await harness.emit("tool_execution_update", {
    toolName: "subagent",
    toolCallId: "call-partial",
    partialResult: subagentResult([
      { index: 4, agent: "worker", model: "provider/model", thinking: "high" },
    ]),
  });
  await harness.emit("tool_execution_end", {
    toolName: "subagent",
    toolCallId: "call-terminal",
    isError: true,
    result: subagentResult([{ index: 1, agent: "reviewer" }]),
  });
  assert.deepEqual(harness.entries, [
    {
      customType: SUBAGENT_PROGRESS_CUSTOM_TYPE,
      data: {
        toolCallId: "call-partial",
        childIndex: 4,
        agent: "worker",
        model: "provider/model",
        thinking: "high",
      },
    },
    {
      customType: SUBAGENT_PROGRESS_CUSTOM_TYPE,
      data: { toolCallId: "call-terminal", childIndex: 1, agent: "reviewer" },
    },
  ]);
});

test("suppresses exact tuples while preserving changed metadata and isolation", async () => {
  const harness = createHarness();
  for (const toolCallId of ["call-a", "call-b"]) {
    await harness.emit("tool_execution_update", {
      toolName: "subagent",
      toolCallId,
      partialResult: subagentResult([
        { index: 0, agent: "worker", model: "model-a" },
        { index: 1, agent: "reviewer" },
      ]),
    });
  }
  await harness.emit("tool_execution_update", {
    toolName: "subagent",
    toolCallId: "call-a",
    partialResult: subagentResult([
      { index: 0, agent: "worker", model: "model-a" },
    ]),
  });
  await harness.emit("tool_execution_end", {
    toolName: "subagent",
    toolCallId: "call-a",
    isError: false,
    result: subagentResult([
      { index: 0, agent: "worker", model: "model-a", thinking: "high" },
    ]),
  });
  assert.deepEqual(
    harness.entries.map((entry) => entry.data),
    [
      {
        toolCallId: "call-a",
        childIndex: 0,
        agent: "worker",
        model: "model-a",
      },
      { toolCallId: "call-a", childIndex: 1, agent: "reviewer" },
      {
        toolCallId: "call-b",
        childIndex: 0,
        agent: "worker",
        model: "model-a",
      },
      { toolCallId: "call-b", childIndex: 1, agent: "reviewer" },
      {
        toolCallId: "call-a",
        childIndex: 0,
        agent: "worker",
        model: "model-a",
        thinking: "high",
      },
    ],
  );
});

test("resets session deduplication and restores persisted entry capacity", async () => {
  const harness = createHarness();
  const event = {
    toolName: "subagent",
    toolCallId: "call-1",
    partialResult: subagentResult([{ index: 0, agent: "worker" }]),
  };
  await harness.emit("tool_execution_update", event);
  await harness.emit("session_start", {
    type: "session_start",
    reason: "reload",
  });
  await harness.emit("tool_execution_update", event);
  assert.equal(harness.entries.length, 2);

  const capacity = createHarness();
  for (
    let entry = 1;
    entry < SUBAGENT_PROGRESS_LIMITS.maxEntriesPerSession;
    entry += 1
  ) {
    capacity.existingSessionEntries.push({
      type: "custom",
      customType: SUBAGENT_PROGRESS_CUSTOM_TYPE,
    });
  }
  await capacity.emit("session_start", {
    type: "session_start",
    reason: "reload",
  });
  await capacity.emit("tool_execution_update", {
    toolName: "subagent",
    toolCallId: "capacity",
    partialResult: subagentResult([
      { index: 0, agent: "worker", model: "first" },
    ]),
  });
  await assert.rejects(
    capacity.emit("tool_execution_update", {
      toolName: "subagent",
      toolCallId: "capacity",
      partialResult: subagentResult([
        { index: 0, agent: "worker", model: "second" },
      ]),
    }),
    isLimitError,
  );
});

test("rejects append errors without recording retry state", async () => {
  const harness = createHarness();
  const cause = new Error("unstable storage detail");
  harness.failNextAppend(cause);
  const event = {
    toolName: "subagent",
    toolCallId: "call-retry",
    partialResult: subagentResult([{ index: 0, agent: "worker" }]),
  };
  await assert.rejects(
    harness.emit("tool_execution_update", event),
    (error: unknown) =>
      error instanceof Error &&
      error.message === SUBAGENT_PROGRESS_APPEND_ERROR &&
      error.cause === cause,
  );
  await harness.emit("tool_execution_end", {
    toolName: "subagent",
    toolCallId: "call-retry",
    result: event.partialResult,
    isError: false,
  });
  assert.deepEqual(harness.entries, [
    {
      customType: SUBAGENT_PROGRESS_CUSTOM_TYPE,
      data: { toolCallId: "call-retry", childIndex: 0, agent: "worker" },
    },
  ]);
});

test("ignores malformed events and bounds state before append", async () => {
  const harness = createHarness();
  await harness.emit("tool_execution_update", {
    toolName: "bash",
    toolCallId: "call-1",
    partialResult: subagentResult([{ index: 0, agent: "worker" }]),
  });
  await harness.emit("tool_execution_update", {
    toolName: "subagent",
    toolCallId: " ",
    partialResult: { details: { results: "not-an-array" } },
  });
  assert.deepEqual(harness.entries, []);

  for (
    let transition = 0;
    transition < SUBAGENT_PROGRESS_LIMITS.maxTransitionsPerChild;
    transition += 1
  ) {
    await harness.emit("tool_execution_update", {
      toolName: "subagent",
      toolCallId: "churn",
      partialResult: subagentResult([
        { index: 0, agent: "worker", model: `model-${transition}` },
      ]),
    });
  }
  await assert.rejects(
    harness.emit("tool_execution_update", {
      toolName: "subagent",
      toolCallId: "churn",
      partialResult: subagentResult([
        { index: 0, agent: "worker", model: "over" },
      ]),
    }),
    isLimitError,
  );
});

test("bounds active parents and releases state after successful terminal processing", async () => {
  const harness = createHarness();
  for (
    let parent = 0;
    parent < SUBAGENT_PROGRESS_LIMITS.maxActiveParents;
    parent += 1
  ) {
    await harness.emit("tool_execution_update", {
      toolName: "subagent",
      toolCallId: `parent-${parent}`,
      partialResult: subagentResult([{ index: 0, agent: "worker" }]),
    });
  }
  await assert.rejects(
    harness.emit("tool_execution_update", {
      toolName: "subagent",
      toolCallId: "parent-over",
      partialResult: subagentResult([{ index: 0, agent: "worker" }]),
    }),
    isLimitError,
  );
  await harness.emit("tool_execution_end", {
    toolName: "subagent",
    toolCallId: "parent-0",
    result: subagentResult([{ index: 0, agent: "worker" }]),
    isError: false,
  });
  await harness.emit("tool_execution_update", {
    toolName: "subagent",
    toolCallId: "parent-new",
    partialResult: subagentResult([{ index: 0, agent: "worker" }]),
  });
});
