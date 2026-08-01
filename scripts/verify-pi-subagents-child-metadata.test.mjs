import assert from "node:assert/strict";
import { test } from "node:test";
import {
  collectSubagentEvents,
  validateShapeContract,
} from "./verify-pi-subagents-child-metadata.mjs";

const finalResult = {
  details: {
    results: [
      { id: "child-a", model: "provider/model-a", thinking: "low", content: "ok" },
      { id: "child-b", model: "provider/model-a", thinking: "low", content: "ok" },
    ],
  },
};

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

test("validateShapeContract fails missing model, missing id, duplicate ids, and order drift", () => {
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
            result: { details: { results: [{ id: "child-a", thinking: "low" }] } },
            isError: false,
          },
        ]),
      }),
    /missing model/u,
  );
  assert.throws(
    () =>
      validateShapeContract({
        label: "missing-id",
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
        label: "duplicate-id",
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
                  { id: "same", model: "provider/model-a", thinking: "low" },
                  { id: "same", model: "provider/model-a", thinking: "low" },
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
        details: { results: [{ id: "child-a", model: "provider/no-thinking" }] },
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
