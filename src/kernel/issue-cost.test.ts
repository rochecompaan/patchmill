import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, type TestContext } from "node:test";
import { readIssueCostReport } from "./issue-cost.ts";

async function fixture(t: TestContext) {
  const root = await fs.mkdtemp(join(tmpdir(), "patchmill-issue-cost-"));
  t.after(() => fs.rm(root, { force: true, recursive: true }));
  const run = join(root, "prior");
  const sessions = join(run, "sessions", "1");
  await fs.mkdir(sessions, { recursive: true });
  await fs.writeFile(
    join(run, "result.json"),
    JSON.stringify({ sessions: [{ phase: "planning" }] }),
  );
  return { root, run, sessions };
}

test("unknown model prices preserve tokens without presenting a partial dollar total", async (t) => {
  const f = await fixture(t);
  await fs.writeFile(
    join(f.sessions, "usage.jsonl"),
    [
      {
        message: {
          model: "priced",
          usage: { input: 100, output: 20, cost: { total: 0.1 } },
        },
      },
      { message: { model: "unpriced", usage: { input: 200, output: 30 } } },
    ]
      .map((record) => JSON.stringify(record))
      .join("\n"),
  );
  assert.deepEqual(await readIssueCostReport(f.root), {
    rows: [
      {
        phase: "planning",
        model: "priced",
        usage: { inputTokens: 100, outputTokens: 20, costUsd: 0.1 },
      },
      {
        phase: "planning",
        model: "unpriced",
        usage: { inputTokens: 200, outputTokens: 30 },
      },
    ],
    total: { inputTokens: 300, outputTokens: 50 },
  });
});

test("bad historical JSON or phase metadata cannot silently disappear from the report", async (t) => {
  const f = await fixture(t);
  await fs.writeFile(
    join(f.sessions, "usage.jsonl"),
    '{"usage":{"input":1,"output":2}}\n{',
  );
  await assert.rejects(
    readIssueCostReport(f.root),
    /Session usage unavailable/,
  );
  for (const metadata of [
    "{",
    "null",
    "{}",
    '{"sessions":[{"phase":"unknown"}]}',
  ]) {
    await fs.writeFile(join(f.run, "result.json"), metadata);
    await assert.rejects(readIssueCostReport(f.root));
  }
});

test("unrecorded session directories cannot produce a partial cost total", async (t) => {
  const f = await fixture(t);
  await fs.writeFile(
    join(f.sessions, "usage.jsonl"),
    '{"usage":{"input":1,"output":2}}\n',
  );
  const extra = join(f.run, "sessions", "2");
  await fs.mkdir(extra);
  await fs.writeFile(
    join(extra, "usage.jsonl"),
    '{"usage":{"input":3,"output":4}}\n',
  );
  await assert.rejects(
    readIssueCostReport(f.root),
    /Session phase metadata unavailable/,
  );
  await assert.rejects(
    readIssueCostReport(f.root, {
      runId: "prior",
      sessions: [{ phase: "planning" }],
    }),
    /Session phase metadata unavailable/,
  );
});

test("current sessions are read once without relying on their unfinished result record", async (t) => {
  const f = await fixture(t);
  await fs.writeFile(join(f.run, "result.json"), "not finished");
  await fs.writeFile(
    join(f.sessions, "usage.jsonl"),
    '{"usage":{"input":0,"output":0,"cost":{"total":0}}}\n',
  );
  assert.deepEqual(
    await readIssueCostReport(f.root, {
      runId: "prior",
      sessions: [{ phase: "implementation" }],
    }),
    {
      rows: [
        {
          phase: "implementation",
          model: "Unknown model",
          usage: { inputTokens: 0, outputTokens: 0, costUsd: 0 },
        },
      ],
      total: { inputTokens: 0, outputTokens: 0, costUsd: 0 },
    },
  );
});

test("attempts that never started Pi do not invent costs or block historical totals", async (t) => {
  const f = await fixture(t);
  await fs.writeFile(
    join(f.sessions, "usage.jsonl"),
    '{"id":"same","usage":{"input":5,"output":2}}\n',
  );
  const empty = join(f.root, "never-started");
  await fs.mkdir(empty);
  await fs.writeFile(join(f.root, "lock"), "lock is not usage");
  const copied = join(f.root, "copied", "sessions", "1");
  await fs.mkdir(copied, { recursive: true });
  await fs.writeFile(
    join(f.root, "copied", "result.json"),
    JSON.stringify({ sessions: [{ phase: "planning" }] }),
  );
  await fs.copyFile(
    join(f.sessions, "usage.jsonl"),
    join(copied, "usage.jsonl"),
  );
  assert.deepEqual((await readIssueCostReport(f.root))?.total, {
    inputTokens: 5,
    outputTokens: 2,
  });
  await fs.rm(f.run, { recursive: true });
  await fs.rm(join(f.root, "copied"), { recursive: true });
  assert.equal(await readIssueCostReport(f.root), undefined);
});

test("subagent children are grouped under their own models", async (t) => {
  const f = await fixture(t);
  await fs.writeFile(
    join(f.sessions, "usage.jsonl"),
    [
      {
        type: "message",
        id: "p",
        message: {
          role: "assistant",
          model: "claude-opus-5-5",
          usage: { input: 10, output: 1, cost: { total: 0 } },
        },
      },
      {
        type: "message",
        id: "t",
        message: {
          role: "toolResult",
          toolName: "subagent",
          usage: { input: 300, output: 30, cost: { total: 0.5522 } },
          details: {
            results: [
              {
                model: "claude-bridge/claude-opus-5-5:high",
                usage: {
                  input: 100,
                  output: 10,
                  cacheRead: 0,
                  cacheWrite: 0,
                  cost: 0,
                },
              },
              {
                model: "openai-codex/gpt-6.1-sol:xhigh",
                usage: {
                  input: 200,
                  output: 20,
                  cacheRead: 0,
                  cacheWrite: 0,
                  cost: 0.5522,
                },
              },
            ],
          },
        },
      },
    ]
      .map((record) => JSON.stringify(record))
      .join("\n"),
  );
  assert.deepEqual(await readIssueCostReport(f.root), {
    rows: [
      {
        phase: "planning",
        model: "claude-opus-5-5",
        usage: {
          inputTokens: 110,
          outputTokens: 11,
          costUsd: 0,
          unpriced: true,
        },
      },
      {
        phase: "planning",
        model: "gpt-6.1-sol",
        usage: { inputTokens: 200, outputTokens: 20, costUsd: 0.5522 },
      },
    ],
    total: {
      inputTokens: 310,
      outputTokens: 31,
      costUsd: 0.5522,
      unpriced: true,
    },
  });
});

test("a tool result copied into a forked session does not count again", async (t) => {
  const f = await fixture(t);
  await fs.writeFile(
    join(f.run, "result.json"),
    JSON.stringify({
      sessions: [{ phase: "planning" }, { phase: "planning" }],
    }),
  );
  const tool = JSON.stringify({
    type: "message",
    id: "tool",
    message: {
      role: "toolResult",
      toolName: "subagent",
      usage: { input: 100, output: 10, cost: { total: 0 } },
      details: {
        results: [
          {
            model: "claude-bridge/child:high",
            usage: {
              input: 100,
              output: 10,
              cacheRead: 0,
              cacheWrite: 0,
              cost: 0,
            },
            sessionFile: "/old/sessions/1/parent/run-a/run-0/session.jsonl",
          },
        ],
      },
    },
  });
  await fs.writeFile(join(f.sessions, "parent.jsonl"), `${tool}\n`);
  const child = join(f.sessions, "parent", "run-a", "run-0");
  await fs.mkdir(child, { recursive: true });
  await fs.writeFile(
    join(child, "session.jsonl"),
    JSON.stringify({
      type: "message",
      id: "c1",
      message: {
        role: "assistant",
        model: "child",
        usage: { input: 100, output: 10, cost: { total: 0 } },
      },
    }),
  );
  const forked = join(f.run, "sessions", "2");
  await fs.mkdir(forked);
  await fs.writeFile(join(forked, "parent.jsonl"), `${tool}\n`);
  assert.deepEqual((await readIssueCostReport(f.root))?.total, {
    inputTokens: 100,
    outputTokens: 10,
    costUsd: 0,
    unpriced: true,
  });
});
