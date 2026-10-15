import assert from "node:assert/strict";
import { test } from "node:test";
import { lastJsonBlock, parseAgentResult, parseJsonBlock } from "./result.ts";

test("lastJsonBlock returns undefined without a result fence", () => {
  assert.equal(lastJsonBlock("no fence here"), undefined);
});

test("parseAgentResult reports no result without a fence", () => {
  assert.deepEqual(parseAgentResult("no fence here"), {
    ok: false,
    reason: "no result",
  });
});

test("parseAgentResult accepts upper-case JSON fences with CRLF endings", () => {
  const stdout = [
    "```JSON",
    '{"status":"done","summary":"example"}',
    "```",
  ].join("\r\n");

  assert.deepEqual(parseAgentResult(stdout), {
    ok: true,
    result: { status: "done", summary: "example" },
  });
});

test("parseAgentResult uses the last closed result block", () => {
  const stdout = [
    "```json",
    '{"status":"done","summary":"example"}',
    "```",
    "```json",
    '{"status":"needs-input","summary":"q"}',
    "```",
    "trailing prose",
    "more trailing prose",
  ].join("\n");

  assert.deepEqual(parseAgentResult(stdout), {
    ok: true,
    result: { status: "needs-input", summary: "q" },
  });
});

test("lastJsonBlock ignores an unclosed trailing result fence", () => {
  const stdout = ["```json", "closed", "```", "```json", "unclosed"].join("\n");

  assert.equal(lastJsonBlock(stdout), "closed");
});

test("parseAgentResult reports invalid JSON", () => {
  const result = parseAgentResult("```json\nnot JSON\n```");

  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.reason, /invalid JSON/);
});

test("parseAgentResult rejects arrays", () => {
  const result = parseAgentResult("```json\n[]\n```");

  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.reason, /object/);
});

test("parseAgentResult lists allowed statuses", () => {
  const result = parseAgentResult(
    '```json\n{"status":"complete","summary":"example"}\n```',
  );

  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.match(result.reason, /done/);
    assert.match(result.reason, /needs-input/);
    assert.match(result.reason, /failed/);
  }
});

test("parseAgentResult identifies unexpected fields", () => {
  const result = parseAgentResult(
    '```json\n{"status":"done","summary":"example","prUrl":"x"}\n```',
  );

  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.reason, /prUrl/);
});

test("parseAgentResult requires a summary", () => {
  const result = parseAgentResult('```json\n{"status":"done"}\n```');

  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.reason, /summary/);
});

test("parseJsonBlock returns a validator value", () => {
  const result = parseJsonBlock("```json\n3\n```", (value) =>
    typeof value === "number" ? value * 2 : "not a number",
  );

  assert.deepEqual(result, { ok: true, value: 6 });
});
