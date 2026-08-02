import assert from "node:assert/strict";
import { test } from "node:test";
import {
  collectSubagentEvents,
  reportedThinkingModel,
  validateShapeContract,
} from "./verify-pi-subagents-child-metadata.mjs";

const finalResult = {
  details: {
    results: [
      { index: 0, model: "provider/model-a", thinking: "low", content: "ok" },
      { index: 1, model: "provider/model-a", thinking: "low", content: "ok" },
    ],
  },
};

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
      partialResult: { details: { results: finalResult.details.results } },
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
            result: { details: { results: [{ index: 0, thinking: "low" }] } },
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
              details: { results: [{ model: "provider/model-a", thinking: "low" }] },
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
            partialResult: { details: { results: finalResult.details.results.toReversed() } },
          },
          { type: "tool_execution_end", toolName: "subagent", result: finalResult },
        ]),
      }),
    /ordering differs/u,
  );
});

test("validateShapeContract preserves legitimate thinking absence", () => {
  const shape = collectSubagentEvents([
    {
      type: "tool_execution_end",
      toolName: "subagent",
      result: {
        details: { results: [{ index: 0, model: "provider/no-thinking" }] },
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
