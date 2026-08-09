import assert from "node:assert/strict";
import { test } from "node:test";
import {
  parseSubagentProgressResults,
  SUBAGENT_PROGRESS_LIMIT_ERROR,
  SUBAGENT_PROGRESS_LIMITS,
  subagentProgressKey,
  type SubagentProgress,
} from "./subagent-progress.ts";

function resultWithRows(rows: unknown[]): unknown {
  return { details: { results: rows } };
}

function isLimitError(error: unknown): boolean {
  return (
    error instanceof Error && error.message === SUBAGENT_PROGRESS_LIMIT_ERROR
  );
}

test("projects valid rows in upstream order and preserves upstream indexes", () => {
  assert.deepEqual(
    parseSubagentProgressResults(
      resultWithRows([
        { index: 7, agent: "worker", model: "openai/gpt-5", thinking: "high" },
        { index: 2, agent: "reviewer", model: "anthropic/claude:beta" },
        { index: 12, agent: "scout", thinking: "future-level" },
      ]),
      "call-parent",
    ),
    [
      {
        toolCallId: "call-parent",
        childIndex: 7,
        agent: "worker",
        model: "openai/gpt-5",
        thinking: "high",
      },
      {
        toolCallId: "call-parent",
        childIndex: 2,
        agent: "reviewer",
        model: "anthropic/claude:beta",
      },
      {
        toolCallId: "call-parent",
        childIndex: 12,
        agent: "scout",
        thinking: "future-level",
      },
    ],
  );
});

test("keeps identity-only rows and accepted strings verbatim", () => {
  assert.deepEqual(
    parseSubagentProgressResults(
      resultWithRows([
        {
          index: 3,
          agent: " worker ",
          model: " provider/model:suffix ",
          thinking: " future-level ",
        },
        { index: 9, agent: "scout" },
      ]),
      " call-with-spaces ",
    ),
    [
      {
        toolCallId: " call-with-spaces ",
        childIndex: 3,
        agent: " worker ",
        model: " provider/model:suffix ",
        thinking: " future-level ",
      },
      { toolCallId: " call-with-spaces ", childIndex: 9, agent: "scout" },
    ],
  );
});

test("fails closed for malformed containers, parent IDs, and malformed siblings", () => {
  for (const value of [
    undefined,
    null,
    [],
    {},
    { details: null },
    { details: [] },
    { details: {} },
    { details: { results: null } },
    { details: { results: {} } },
  ]) {
    assert.deepEqual(parseSubagentProgressResults(value, "call-1"), []);
  }
  assert.deepEqual(
    parseSubagentProgressResults(
      resultWithRows([{ index: 0, agent: "worker" }]),
      " ",
    ),
    [],
  );
  assert.deepEqual(
    parseSubagentProgressResults(
      resultWithRows([
        null,
        [],
        { agent: "missing" },
        { index: -1, agent: "negative" },
        { index: 1.5, agent: "fraction" },
        { index: Number.MAX_SAFE_INTEGER + 1, agent: "unsafe" },
        { index: 4 },
        { index: 5, agent: "" },
        { index: 6, agent: "   " },
        { index: 11, agent: "valid", model: 42, thinking: { level: "high" } },
      ]),
      "call-1",
    ),
    [{ toolCallId: "call-1", childIndex: 11, agent: "valid" }],
  );
});

test("never substitutes array position and never copies discarded properties", () => {
  const projection = parseSubagentProgressResults(
    resultWithRows([
      { agent: "missing-index", task: "SECRET_TASK" },
      {
        index: 42,
        agent: "worker",
        model: "reported-model",
        thinking: "reported-thinking",
        task: "SECRET_TASK",
        output: "SECRET_OUTPUT",
        prompt: "SECRET_PROMPT",
        credentials: "SECRET_CREDENTIAL",
        path: "/secret/session.jsonl",
        usage: { cost: "SECRET_COST" },
        error: "SECRET_ERROR",
        args: { token: "SECRET_TOKEN" },
      },
    ]),
    "call-safe",
  );
  assert.deepEqual(projection, [
    {
      toolCallId: "call-safe",
      childIndex: 42,
      agent: "worker",
      model: "reported-model",
      thinking: "reported-thinking",
    },
  ]);
  const serialized = JSON.stringify(projection);
  for (const forbidden of [
    "SECRET_TASK",
    "SECRET_OUTPUT",
    "SECRET_PROMPT",
    "SECRET_CREDENTIAL",
    "/secret/session.jsonl",
    "SECRET_COST",
    "SECRET_ERROR",
    "SECRET_TOKEN",
  ]) {
    assert.equal(serialized.includes(forbidden), false);
  }
});

test("enforces identifier and result-row ceilings without truncation", () => {
  const limits = SUBAGENT_PROGRESS_LIMITS;
  const toolCallId = "t".repeat(limits.maxToolCallIdCodeUnits);
  const agent = "a".repeat(limits.maxAgentCodeUnits);
  assert.deepEqual(
    parseSubagentProgressResults(
      resultWithRows([
        {
          index: 0,
          agent,
          model: "m".repeat(limits.maxModelCodeUnits),
          thinking: "h".repeat(limits.maxThinkingCodeUnits),
        },
      ]),
      toolCallId,
    ),
    [
      {
        toolCallId,
        childIndex: 0,
        agent,
        model: "m".repeat(limits.maxModelCodeUnits),
        thinking: "h".repeat(limits.maxThinkingCodeUnits),
      },
    ],
  );
  assert.deepEqual(
    parseSubagentProgressResults(
      resultWithRows([
        { index: 0, agent: `${agent}x` },
        {
          index: 1,
          agent: "worker",
          model: "m".repeat(limits.maxModelCodeUnits + 1),
          thinking: "h".repeat(limits.maxThinkingCodeUnits + 1),
        },
      ]),
      toolCallId,
    ),
    [{ toolCallId, childIndex: 1, agent: "worker" }],
  );
  assert.deepEqual(
    parseSubagentProgressResults(
      resultWithRows([{ index: 0, agent: "worker" }]),
      `${toolCallId}x`,
    ),
    [],
  );
  assert.equal(
    parseSubagentProgressResults(
      resultWithRows(
        Array.from({ length: limits.maxResultRows }, (_, index) => ({
          index,
          agent: "worker",
        })),
      ),
      "call-max",
    ).length,
    limits.maxResultRows,
  );
  assert.throws(
    () =>
      parseSubagentProgressResults(
        resultWithRows(
          Array.from({ length: limits.maxResultRows + 1 }, (_, index) => ({
            index,
            agent: "worker",
          })),
        ),
        "call-over",
      ),
    isLimitError,
  );
});

test("serializes fixed-position collision-safe keys", () => {
  const identity: SubagentProgress = {
    toolCallId: "call|1",
    childIndex: 3,
    agent: "worker,reviewer",
  };
  assert.equal(
    subagentProgressKey(identity),
    '["call|1",3,"worker,reviewer",null,null]',
  );
  assert.notEqual(
    subagentProgressKey(identity),
    subagentProgressKey({ ...identity, model: "" }),
  );
  assert.notEqual(
    subagentProgressKey({ ...identity, model: "model", thinking: "high" }),
    subagentProgressKey({ ...identity, model: "model:high" }),
  );
});
