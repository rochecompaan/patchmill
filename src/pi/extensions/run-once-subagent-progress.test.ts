import assert from "node:assert/strict";
import { test } from "node:test";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { SUBAGENT_PROGRESS_CUSTOM_TYPE } from "../subagent-progress.ts";
import runOnceSubagentProgressExtension, {
  SUBAGENT_PROGRESS_APPEND_ERROR,
} from "./run-once-subagent-progress.ts";

type Handler = (event: any, context: any) => unknown;
function harness() {
  const handlers = new Map<string, Handler>();
  const entries: Array<{ customType: string; data: unknown }> = [];
  const existing: unknown[] = [];
  let failure: Error | undefined;
  runOnceSubagentProgressExtension({
    on(name: string, handler: Handler) {
      handlers.set(name, handler);
    },
    appendEntry(customType: string, data?: unknown) {
      if (failure) {
        const error = failure;
        failure = undefined;
        throw error;
      }
      entries.push({ customType, data });
    },
  } as unknown as Pick<ExtensionAPI, "on" | "appendEntry">);
  return {
    entries,
    existing,
    fail(error: Error) {
      failure = error;
    },
    async emit(name: string, event: unknown) {
      await handlers.get(name)?.(event, {
        sessionManager: { getEntries: () => existing },
      });
    },
    handlers,
  };
}

test("registers exactly session/update/end handlers", () => {
  assert.deepEqual(
    [...harness().handlers.keys()],
    ["session_start", "tool_execution_update", "tool_execution_end"],
  );
});

test("forwards subagent updates and waits as v1 custom projections", async () => {
  const state = harness();
  await state.emit("session_start", { reason: "startup" });
  await state.emit("tool_execution_update", {
    toolName: "subagent",
    toolCallId: "launch",
    partialResult: {
      details: {
        mode: "workflow",
        workflowChildren: {
          version: 1,
          parentToolCallId: "launch",
          workflowRunId: "workflow",
          inventoryComplete: false,
          workflowState: "running",
          children: [{ childId: "build", state: "running", agent: "worker" }],
        },
      },
    },
  });
  await state.emit("tool_execution_end", {
    toolName: "subagent_wait",
    toolCallId: "wait",
    result: {
      details: {
        completions: [
          {
            runId: "workflow",
            workflowChildren: {
              version: 1,
              parentToolCallId: "launch",
              workflowRunId: "workflow",
              inventoryComplete: true,
              workflowState: "completed",
              children: [
                { childId: "build", state: "completed", agent: "worker" },
              ],
            },
          },
        ],
      },
    },
  });
  assert.deepEqual(
    state.entries.map((entry) => entry.customType),
    [
      SUBAGENT_PROGRESS_CUSTOM_TYPE,
      SUBAGENT_PROGRESS_CUSTOM_TYPE,
      SUBAGENT_PROGRESS_CUSTOM_TYPE,
    ],
  );
  assert.deepEqual(
    state.entries.map((entry) => entry.data),
    [
      {
        version: 1,
        kind: "workflow",
        toolCallId: "launch",
        workflowRunId: "workflow",
        childId: "build",
        state: "running",
        agent: "worker",
      },
      {
        version: 1,
        kind: "workflow",
        toolCallId: "launch",
        workflowRunId: "workflow",
        childId: "build",
        state: "completed",
        agent: "worker",
      },
      {
        version: 1,
        kind: "workflow",
        toolCallId: "launch",
        workflowRunId: "workflow",
        childId: "build",
        state: "completed",
        agent: "worker",
        inventoryClosed: true,
      },
    ],
  );
});

test("retries append failure and ignores unrelated tools", async () => {
  const state = harness();
  await state.emit("session_start", { reason: "startup" });
  const cause = new Error("disk");
  state.fail(cause);
  const event = {
    toolName: "subagent",
    toolCallId: "launch",
    partialResult: {
      details: {
        mode: "single",
        runId: "run",
        results: [{ index: 0, agent: "worker", exitCode: 0 }],
      },
    },
  };
  await assert.rejects(
    state.emit("tool_execution_update", event),
    (error: unknown) =>
      error instanceof Error &&
      error.message === SUBAGENT_PROGRESS_APPEND_ERROR &&
      error.cause === cause,
  );
  await state.emit("tool_execution_end", {
    ...event,
    result: event.partialResult,
  });
  await state.emit("tool_execution_update", { ...event, toolName: "bash" });
  assert.equal(state.entries.length, 1);
});

test("does not observe tool events until session restoration succeeds", async () => {
  const state = harness();
  state.existing.push(
    ...Array.from({ length: 65537 }, (_, index) => ({
      type: "custom",
      customType: SUBAGENT_PROGRESS_CUSTOM_TYPE,
      data: {
        version: 1,
        kind: "direct",
        toolCallId: `old-${index}`,
        runId: `run-${index}`,
        childIndex: 0,
        state: "completed",
      },
    })),
  );
  await assert.rejects(
    state.emit("session_start", { reason: "over-limit" }),
    /PATCHMILL_SUBAGENT_PROGRESS_LIMIT_EXCEEDED/u,
  );
  const event = {
    toolName: "subagent",
    toolCallId: "launch",
    partialResult: {
      details: {
        mode: "single",
        runId: "run",
        results: [{ index: 0, agent: "worker", exitCode: 0 }],
      },
    },
  };
  await state.emit("tool_execution_update", event);
  assert.deepEqual(state.entries, []);

  state.existing.splice(0);
  await state.emit("session_start", { reason: "retry" });
  await state.emit("tool_execution_update", event);
  assert.equal(state.entries.length, 1);
});
