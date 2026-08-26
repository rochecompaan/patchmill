import assert from "node:assert/strict";
import { test } from "node:test";
import {
  collectSubagentEvents,
  reportedThinkingModel,
  validateShapeContract,
  validateDirectAsyncShapeContract,
  validateDirectShapeContract,
  validateWorkflowShapeContract,
} from "./verify-pi-subagents-child-metadata.mjs";

const finalResult = {
  details: {
    runId: "run-a",
    results: [
      { index: 0, model: "provider/model-a", thinking: "low", content: "ok" },
      { index: 1, model: "provider/model-a", thinking: "low", content: "ok" },
    ],
  },
};

test("validateWorkflowShapeContract uses stable workflow child IDs rather than result indexes", () => {
  const summary = (complete, children) => ({
    version: 1,
    parentToolCallId: "launch",
    workflowRunId: "workflow",
    inventoryComplete: complete,
    workflowState: complete ? "completed" : "running",
    children,
  });
  validateWorkflowShapeContract({
    label: "workflow",
    parentToolCallId: "launch",
    expectedChildIds: ["build", "review"],
    expectedModel: "provider/model",
    expectedThinking: "low",
    events: [
      {
        type: "tool_execution_update",
        partialResult: {
          details: {
            results: [{ index: 0 }, { index: 0 }],
            workflowChildren: summary(false, [
              {
                childId: "build",
                state: "running",
                model: "provider/model",
                thinking: "low",
              },
            ]),
          },
        },
      },
      {
        type: "tool_execution_end",
        result: {
          details: {
            completions: [
              {
                workflowChildren: summary(true, [
                  {
                    childId: "build",
                    state: "completed",
                    agent: "worker",
                    model: "provider/model",
                    thinking: "low",
                  },
                  {
                    childId: "review",
                    state: "completed",
                    agent: "reviewer",
                    model: "provider/model",
                    thinking: "low",
                  },
                ]),
              },
            ],
          },
        },
      },
    ],
  });
  assert.throws(
    () =>
      validateWorkflowShapeContract({
        label: "bad",
        parentToolCallId: "launch",
        events: [{ result: { details: { workflowChildren: { version: 2 } } } }],
      }),
    /unsupported workflow summary version/u,
  );
});

test("validateDirectAsyncShapeContract matches launch identity to wait completion", () => {
  validateDirectAsyncShapeContract({
    label: "async",
    expectedModel: "provider/model-a",
    expectedThinking: "low",
    requireThinking: true,
    events: [
      {
        type: "tool_execution_end",
        toolName: "subagent",
        result: { details: { asyncId: "run-async", results: [] } },
        isError: false,
      },
      {
        type: "tool_execution_end",
        toolName: "subagent_wait",
        result: {
          details: {
            completions: [
              {
                runId: "run-async",
                results: [
                  {
                    index: 9,
                    model: "provider/model-a",
                    thinking: "low",
                    exitCode: 0,
                  },
                ],
              },
            ],
          },
        },
        isError: false,
      },
    ],
  });
  assert.throws(
    () =>
      validateDirectAsyncShapeContract({
        label: "missing",
        events: [],
        requireThinking: true,
      }),
    /missing structured async launch/u,
  );
});

test("validateDirectShapeContract matches the structured direct surface", () => {
  validateDirectShapeContract({
    label: "direct",
    expectedModel: "provider/model-a",
    expectedThinking: "low",
    expectedFinalChildren: 2,
    requireUniqueSiblingIds: true,
    requireThinking: true,
    shape: collectSubagentEvents([
      {
        type: "tool_execution_end",
        toolName: "subagent",
        isError: false,
        result: finalResult,
      },
    ]),
  });
});

test("reportedThinkingModel matches the Pi model argument emitted for an explicit fixture thinking level", () => {
  assert.equal(
    reportedThinkingModel("provider/model-a", "low"),
    "provider/model-a:low",
  );
});

test("validateShapeContract matches partial and final rows by upstream identity", () => {
  const shape = collectSubagentEvents([
    {
      type: "tool_execution_update",
      toolName: "subagent",
      partialResult: {
        details: { runId: "run-a", results: finalResult.details.results },
      },
    },
    {
      type: "tool_execution_end",
      toolName: "subagent",
      result: finalResult,
      isError: false,
    },
  ]);
  validateShapeContract({
    label: "parallel",
    expectedModel: "provider/model-a",
    expectedThinking: "low",
    expectedFinalChildren: 2,
    requireUniqueSiblingIds: true,
    requireThinking: true,
    shape,
  });
});

test("validateShapeContract accepts partial rows that are an ordered subset of final rows", () => {
  const shape = collectSubagentEvents([
    {
      type: "tool_execution_update",
      toolName: "subagent",
      partialResult: {
        details: {
          runId: "run-a",
          results: [finalResult.details.results[1]],
        },
      },
    },
    {
      type: "tool_execution_end",
      toolName: "subagent",
      result: finalResult,
      isError: false,
    },
  ]);
  validateShapeContract({
    label: "counted",
    expectedModel: "provider/model-a",
    expectedThinking: "low",
    expectedFinalChildren: 2,
    requireUniqueSiblingIds: true,
    requireThinking: true,
    shape,
  });
});

test("validateShapeContract requires a final runId", () => {
  assert.throws(
    () =>
      validateShapeContract({
        label: "missing-run-id",
        expectedModel: "provider/model-a",
        expectedThinking: "low",
        expectedFinalChildren: 2,
        requireUniqueSiblingIds: true,
        requireThinking: true,
        shape: collectSubagentEvents([
          {
            type: "tool_execution_end",
            toolName: "subagent",
            result: { details: { results: finalResult.details.results } },
            isError: false,
          },
        ]),
      }),
    /missing details\.runId/u,
  );
});

test("validateShapeContract rejects partial runId drift", () => {
  assert.throws(
    () =>
      validateShapeContract({
        label: "run-id-drift",
        expectedModel: "provider/model-a",
        expectedThinking: "low",
        expectedFinalChildren: 2,
        requireUniqueSiblingIds: true,
        requireThinking: true,
        shape: collectSubagentEvents([
          {
            type: "tool_execution_update",
            toolName: "subagent",
            partialResult: {
              details: {
                runId: "run-b",
                results: finalResult.details.results,
              },
            },
          },
          {
            type: "tool_execution_end",
            toolName: "subagent",
            result: finalResult,
            isError: false,
          },
        ]),
      }),
    /partial runId run-b does not match final runId run-a/u,
  );
});

test("validateShapeContract fails missing model, missing index, duplicate indexes, and order drift", () => {
  assert.throws(
    () =>
      validateShapeContract({
        label: "missing-model",
        expectedModel: "provider/model-a",
        expectedThinking: "low",
        expectedFinalChildren: 1,
        requireUniqueSiblingIds: false,
        requireThinking: true,
        shape: collectSubagentEvents([
          {
            type: "tool_execution_end",
            toolName: "subagent",
            result: {
              details: {
                runId: "run-a",
                results: [{ index: 0, thinking: "low" }],
              },
            },
            isError: false,
          },
        ]),
      }),
    /missing model/u,
  );
  assert.throws(
    () =>
      validateShapeContract({
        label: "missing-index",
        expectedModel: "provider/model-a",
        expectedThinking: "low",
        expectedFinalChildren: 1,
        requireUniqueSiblingIds: false,
        requireThinking: true,
        shape: collectSubagentEvents([
          {
            type: "tool_execution_end",
            toolName: "subagent",
            result: {
              details: {
                runId: "run-a",
                results: [{ model: "provider/model-a", thinking: "low" }],
              },
            },
            isError: false,
          },
        ]),
      }),
    /missing upstream identity/u,
  );
  assert.throws(
    () =>
      validateShapeContract({
        label: "duplicate-index",
        expectedModel: "provider/model-a",
        expectedThinking: "low",
        expectedFinalChildren: 2,
        requireUniqueSiblingIds: true,
        requireThinking: true,
        shape: collectSubagentEvents([
          {
            type: "tool_execution_end",
            toolName: "subagent",
            result: {
              details: {
                runId: "run-a",
                results: [
                  { index: 0, model: "provider/model-a", thinking: "low" },
                  { index: 0, model: "provider/model-a", thinking: "low" },
                ],
              },
            },
          },
        ]),
      }),
    /duplicate upstream identity/u,
  );
  assert.throws(
    () =>
      validateShapeContract({
        label: "order-drift",
        expectedModel: "provider/model-a",
        expectedThinking: "low",
        expectedFinalChildren: 2,
        requireUniqueSiblingIds: true,
        requireThinking: true,
        shape: collectSubagentEvents([
          {
            type: "tool_execution_update",
            toolName: "subagent",
            partialResult: {
              details: {
                runId: "run-a",
                results: finalResult.details.results.toReversed(),
              },
            },
          },
          {
            type: "tool_execution_end",
            toolName: "subagent",
            result: finalResult,
          },
        ]),
      }),
    /out of order/u,
  );
});

test("validateShapeContract rejects failed tool results and child exits", () => {
  assert.throws(
    () =>
      validateShapeContract({
        label: "failed-tool-result",
        expectedModel: "provider/model-a",
        expectedThinking: "low",
        expectedFinalChildren: 1,
        requireUniqueSiblingIds: false,
        requireThinking: true,
        shape: collectSubagentEvents([
          {
            type: "tool_execution_end",
            toolName: "subagent",
            result: {
              isError: true,
              details: {
                runId: "run-a",
                results: [
                  {
                    index: 0,
                    model: "provider/model-a",
                    thinking: "low",
                    exitCode: 1,
                  },
                ],
              },
            },
            isError: false,
          },
        ]),
      }),
    /expected no failed subagent tool results/u,
  );
  assert.throws(
    () =>
      validateShapeContract({
        label: "failed-then-successful-tool-result",
        expectedModel: "provider/model-a",
        expectedThinking: "low",
        expectedFinalChildren: 1,
        requireUniqueSiblingIds: false,
        requireThinking: true,
        shape: collectSubagentEvents([
          {
            type: "tool_execution_end",
            toolName: "subagent",
            result: {
              isError: true,
              details: { runId: "run-a", results: [] },
            },
            isError: false,
          },
          {
            type: "tool_execution_end",
            toolName: "subagent",
            result: {
              details: {
                runId: "run-a",
                results: [
                  {
                    index: 0,
                    model: "provider/model-a",
                    thinking: "low",
                    exitCode: 0,
                  },
                ],
              },
            },
            isError: false,
          },
        ]),
      }),
    /expected no failed subagent tool results/u,
  );
  assert.throws(
    () =>
      validateShapeContract({
        label: "failed-child-exit",
        expectedModel: "provider/model-a",
        expectedThinking: "low",
        expectedFinalChildren: 1,
        requireUniqueSiblingIds: false,
        requireThinking: true,
        shape: collectSubagentEvents([
          {
            type: "tool_execution_end",
            toolName: "subagent",
            result: {
              details: {
                runId: "run-a",
                results: [
                  {
                    index: 0,
                    model: "provider/model-a",
                    thinking: "low",
                    exitCode: 1,
                  },
                ],
              },
            },
            isError: false,
          },
        ]),
      }),
    /exited with code 1/u,
  );
});

test("validateShapeContract preserves legitimate thinking absence", () => {
  const shape = collectSubagentEvents([
    {
      type: "tool_execution_end",
      toolName: "subagent",
      result: {
        details: {
          runId: "run-a",
          results: [{ index: 0, model: "provider/no-thinking" }],
        },
      },
      isError: false,
    },
  ]);
  validateShapeContract({
    label: "no-thinking",
    expectedModel: "provider/no-thinking",
    expectedFinalChildren: 1,
    requireUniqueSiblingIds: false,
    requireThinking: false,
    shape,
  });
});
