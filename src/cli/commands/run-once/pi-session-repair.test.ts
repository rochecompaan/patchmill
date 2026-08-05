import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { readPiRepairFacts } from "./pi-session-repair.ts";

async function writeSession(lines: unknown[]): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "patchmill-repair-facts-"));
  const sessionPath = join(dir, "parent-session.jsonl");
  await writeFile(
    sessionPath,
    `${lines.map((line) => JSON.stringify(line)).join("\n")}\n`,
    "utf8",
  );
  return sessionPath;
}

test("readPiRepairFacts reports the session byte size used for repair streaming", async () => {
  const dir = await mkdtemp(join(tmpdir(), "patchmill-repair-size-"));
  const sessionPath = join(dir, "parent-session.jsonl");
  const source = `${JSON.stringify({
    type: "message",
    message: {
      role: "assistant",
      content: [{ type: "text", text: "Review café is still running." }],
    },
  })}\n`;
  await writeFile(sessionPath, source, "utf8");

  const facts = await readPiRepairFacts({
    sessionPath,
    parseError: new Error("parse failed"),
  });

  assert.equal(facts.sessionByteSize, Buffer.byteLength(source));
});

test("readPiRepairFacts reports an async subagent launch with running status as unresolved", async () => {
  const sessionPath = await writeSession([
    { type: "session", id: "parent" },
    {
      type: "message",
      message: {
        role: "assistant",
        content: [
          {
            type: "toolCall",
            id: "call-1",
            name: "subagent",
            arguments: { agent: "reviewer", task: "review", async: true },
          },
        ],
      },
    },
    {
      type: "message",
      message: {
        role: "toolResult",
        toolName: "subagent",
        toolCallId: "call-1",
        content: [
          {
            type: "text",
            text: '{"id":"pm-subagents-abc123","status":"running"}',
          },
        ],
      },
    },
    {
      type: "message",
      message: {
        role: "assistant",
        content: [
          {
            type: "toolCall",
            id: "call-2",
            name: "subagent",
            arguments: { action: "status", id: "pm-subagents-abc123" },
          },
        ],
      },
    },
    {
      type: "message",
      message: {
        role: "toolResult",
        toolName: "subagent",
        toolCallId: "call-2",
        content: [
          {
            type: "text",
            text: '{"id":"pm-subagents-abc123","state":"running"}',
          },
        ],
      },
    },
  ]);

  const facts = await readPiRepairFacts({
    sessionPath,
    parseError: new Error("parse failed"),
  });
  assert.deepEqual(facts.subagentRuns, [
    {
      id: "pm-subagents-abc123",
      lastAction: "status",
      lastState: "running",
      unresolved: true,
    },
  ]);
  assert.equal(facts.unresolvedSummary, "1 unresolved async subagent run");
});

test("readPiRepairFacts recognizes installed pi-subagents async and status result shapes", async () => {
  const sessionPath = await writeSession([
    {
      type: "message",
      message: {
        role: "assistant",
        content: [
          {
            type: "toolCall",
            id: "call-launch",
            name: "subagent",
            arguments: { agent: "reviewer", task: "review", async: true },
          },
        ],
      },
    },
    {
      type: "message",
      message: {
        role: "toolResult",
        toolName: "subagent",
        toolCallId: "call-launch",
        content: [
          {
            type: "text",
            text: 'Async: reviewer [deadbeef]\nUse subagent({ action: "status", id: "deadbeef" }) when you need the result.',
          },
        ],
        details: { mode: "single", asyncId: "deadbeef" },
      },
    },
    {
      type: "message",
      message: {
        role: "assistant",
        content: [
          {
            type: "toolCall",
            id: "call-status",
            name: "subagent",
            arguments: { action: "status", id: "deadbeef" },
          },
        ],
      },
    },
    {
      type: "message",
      message: {
        role: "toolResult",
        toolName: "subagent",
        toolCallId: "call-status",
        content: [{ type: "text", text: "Run: deadbeef\nState: running" }],
        details: {
          mode: "single",
          results: [],
          lifecycleStatus: {
            processTerminal: { runId: "deadbeef", state: "pending" },
          },
        },
      },
    },
  ]);

  const facts = await readPiRepairFacts({
    sessionPath,
    parseError: new Error("parse failed"),
  });
  assert.deepEqual(facts.subagentRuns, [
    {
      id: "deadbeef",
      lastAction: "status",
      lastState: "running",
      unresolved: true,
    },
  ]);
  assert.equal(facts.unresolvedSummary, "1 unresolved async subagent run");
});

test("readPiRepairFacts reads supported runs arrays without harvesting incidental nested ids", async () => {
  const sessionPath = await writeSession([
    {
      type: "message",
      message: {
        role: "toolResult",
        toolName: "subagent",
        content: [
          {
            type: "text",
            text: "Run: incidental-run-id completed; Run: pi-subagents-status123 running",
          },
        ],
        details: {
          mode: "fleet",
          runs: [
            {
              runId: "pi-subagents-status123",
              status: "running",
            },
          ],
          metadata: {
            id: "incidental-run-id",
            state: "running",
          },
        },
      },
    },
  ]);

  const facts = await readPiRepairFacts({
    sessionPath,
    parseError: new Error("parse failed"),
  });

  assert.deepEqual(facts.subagentRuns, [
    {
      id: "pi-subagents-status123",
      lastState: "running",
      unresolved: true,
    },
  ]);
});

test("readPiRepairFacts does not apply an ambiguous prose state to a known run", async () => {
  const sessionPath = await writeSession([
    {
      type: "message",
      message: {
        role: "assistant",
        content: [
          {
            type: "toolCall",
            id: "call-launch",
            name: "subagent",
            arguments: { agent: "reviewer", task: "review", async: true },
          },
        ],
      },
    },
    {
      type: "message",
      message: {
        role: "toolResult",
        toolName: "subagent",
        toolCallId: "call-launch",
        content: [
          { type: "text", text: "Async: reviewer [pi-subagents-known123]" },
        ],
        details: { mode: "single", asyncId: "pi-subagents-known123" },
      },
    },
    {
      type: "message",
      message: {
        role: "assistant",
        content: [
          {
            type: "toolCall",
            id: "call-status",
            name: "subagent",
            arguments: { action: "status", id: "pi-subagents-known123" },
          },
        ],
      },
    },
    {
      type: "message",
      message: {
        role: "toolResult",
        toolName: "subagent",
        toolCallId: "call-status",
        content: [
          {
            type: "text",
            text: "Run: incidental-run-id completed; Run: pi-subagents-known123 running",
          },
        ],
        details: {
          mode: "fleet",
          runs: [{ runId: "pi-subagents-known123" }],
        },
      },
    },
  ]);

  const facts = await readPiRepairFacts({
    sessionPath,
    parseError: new Error("parse failed"),
  });

  assert.deepEqual(facts.subagentRuns, [
    {
      id: "pi-subagents-known123",
      lastAction: "status",
      unresolved: true,
    },
  ]);
});

test("readPiRepairFacts treats async default launch results as unresolved until terminal", async () => {
  const sessionPath = await writeSession([
    {
      type: "message",
      message: {
        role: "assistant",
        content: [
          {
            type: "toolCall",
            id: "call-default-async",
            name: "subagent",
            arguments: { agent: "reviewer", task: "review" },
          },
        ],
      },
    },
    {
      type: "message",
      message: {
        role: "toolResult",
        toolName: "subagent",
        toolCallId: "call-default-async",
        content: [{ type: "text", text: "Async: reviewer [deadbeef]" }],
        details: { mode: "single", asyncId: "deadbeef" },
      },
    },
  ]);

  const facts = await readPiRepairFacts({
    sessionPath,
    parseError: new Error("parse failed"),
  });
  assert.deepEqual(facts.subagentRuns, [
    {
      id: "deadbeef",
      unresolved: true,
    },
  ]);
  assert.equal(facts.unresolvedSummary, "1 unresolved async subagent run");
});

test("readPiRepairFacts treats bundled stopped and rejected states as resolved", async () => {
  for (const state of ["stopped", "rejected"]) {
    const sessionPath = await writeSession([
      {
        type: "message",
        message: {
          role: "toolResult",
          toolName: "subagent",
          content: [{ type: "text", text: "Async: reviewer [deadbeef]" }],
          details: { mode: "single", asyncId: "deadbeef" },
        },
      },
      {
        type: "message",
        message: {
          role: "toolResult",
          toolName: "subagent",
          content: [{ type: "text", text: `Run: deadbeef\nState: ${state}` }],
        },
      },
    ]);

    const facts = await readPiRepairFacts({
      sessionPath,
      parseError: new Error("parse failed"),
    });
    assert.deepEqual(facts.subagentRuns, [
      {
        id: "deadbeef",
        lastState: state,
        unresolved: false,
      },
    ]);
    assert.equal(
      facts.unresolvedSummary,
      "no unresolved async subagent runs detected",
    );
  }
});

test("readPiRepairFacts treats terminal subagent states as resolved", async () => {
  const sessionPath = await writeSession([
    {
      type: "message",
      message: {
        role: "toolResult",
        toolName: "subagent",
        content: [
          {
            type: "text",
            text: '{"runId":"pm-subagents-done","state":"completed"}',
          },
        ],
      },
    },
  ]);
  const facts = await readPiRepairFacts({
    sessionPath,
    parseError: new Error("parse failed"),
  });
  assert.equal(facts.subagentRuns[0]?.unresolved, false);
  assert.equal(
    facts.unresolvedSummary,
    "no unresolved async subagent runs detected",
  );
});

test("readPiRepairFacts extracts the last assistant prose that is not terminal JSON", async () => {
  const sessionPath = await writeSession([
    {
      type: "message",
      message: {
        role: "assistant",
        content: [
          {
            type: "text",
            text: "Task 4 is closed. Final review is running: pm-subagents-abc123.",
          },
        ],
      },
    },
  ]);
  const facts = await readPiRepairFacts({
    sessionPath,
    parseError: new Error("parse failed"),
  });
  assert.equal(
    facts.lastAssistantTextExcerpt,
    "Task 4 is closed. Final review is running: pm-subagents-abc123.",
  );
});

test("readPiRepairFacts tolerates malformed lines and unknown subagent result shapes", async () => {
  const dir = await mkdtemp(join(tmpdir(), "patchmill-repair-facts-bad-"));
  const sessionPath = join(dir, "parent-session.jsonl");
  await writeFile(
    sessionPath,
    [
      "not json",
      JSON.stringify({
        type: "message",
        message: {
          role: "toolResult",
          toolName: "subagent",
          content: [
            {
              type: "text",
              text: "review run pm-subagents-xyz987 is needs-attention",
            },
          ],
        },
      }),
    ].join("\n") + "\n",
    "utf8",
  );
  const facts = await readPiRepairFacts({
    sessionPath,
    parseError: new Error("parse failed"),
  });
  assert.equal(facts.subagentRuns[0]?.id, "pm-subagents-xyz987");
  assert.equal(facts.subagentRuns[0]?.unresolved, true);
});
