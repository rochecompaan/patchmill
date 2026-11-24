import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, type TestContext } from "node:test";
import {
  costLine,
  costText,
  readSessionUsage,
  sumSessionUsage,
  totalUsage,
} from "./pi-cost.ts";

async function sessions(t: TestContext) {
  const dir = await fs.mkdtemp(join(tmpdir(), "patchmill-cost-"));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  return dir;
}

test("sums top-level and message usage recursively, skipping blanks and metadata", async (t) => {
  const dir = await sessions(t);
  await fs.mkdir(join(dir, "nested"));
  await fs.writeFile(
    join(dir, "one.jsonl"),
    '\n{"type":"session"}\n{"usage":{"input":100,"output":20,"cost":{"total":0.05}}}\n',
  );
  await fs.writeFile(
    join(dir, "nested", "two.jsonl"),
    '{"message":{"usage":{"input":200,"output":40,"cost":{"total":0.1}}}}\n',
  );
  await fs.writeFile(join(dir, "ignored.txt"), "not JSON");
  const usage = await sumSessionUsage(dir);
  assert.equal(usage?.inputTokens, 300);
  assert.equal(usage?.outputTokens, 60);
  assert.ok(Math.abs(usage!.costUsd! - 0.15) < 1e-10);
});

test("any JSON parse or read failure makes the entire aggregate unavailable", async (t) => {
  const dir = await sessions(t);
  await fs.writeFile(
    join(dir, "valid.jsonl"),
    '{"usage":{"input":1,"output":2}}\n',
  );
  await fs.writeFile(join(dir, "bad.jsonl"), "{\n");
  assert.equal(await sumSessionUsage(dir), undefined);
  await fs.unlink(join(dir, "bad.jsonl"));
  await fs.symlink(join(dir, "absent"), join(dir, "broken.jsonl"));
  assert.equal(await sumSessionUsage(dir), undefined);
  assert.equal(await sumSessionUsage(join(dir, "missing")), undefined);
  assert.equal(await sumSessionUsage(join(dir, "valid.jsonl")), undefined);
});

test("ignores unusable token blocks and omits incomplete or malformed cost totals", async (t) => {
  const dir = await sessions(t);
  for (const cost of [undefined, null, {}, { total: "0.1" }, { total: -1 }]) {
    const entries = [
      null,
      [],
      {},
      { usage: { input: "2", output: 3 } },
      { usage: { input: -1, output: 2 } },
      { usage: { input: 100, output: 20, cost: { total: 0.05 } } },
      { message: { usage: { input: 200, output: 40, cost } } },
    ];
    await fs.writeFile(
      join(dir, "usage.jsonl"),
      entries.map((entry) => JSON.stringify(entry)).join("\n"),
    );
    assert.deepEqual(await sumSessionUsage(dir), {
      inputTokens: 300,
      outputTokens: 60,
    });
  }
});

test("rejects nonfinite tokens and suppresses nonfinite costs parsed from raw JSON", async (t) => {
  const dir = await sessions(t);
  const path = join(dir, "usage.jsonl");
  await fs.writeFile(
    path,
    [
      '{"usage":{"input":100,"output":20,"cost":{"total":0.05}}}',
      '{"usage":{"input":1e309,"output":2}}',
      '{"message":{"usage":{"input":2,"output":1e309}}}',
    ].join("\n") + "\n",
  );
  assert.deepEqual(await sumSessionUsage(dir), {
    inputTokens: 100,
    outputTokens: 20,
    costUsd: 0.05,
  });
  await fs.appendFile(
    path,
    '{"usage":{"input":0,"output":0,"cost":{"total":1e309}}}\n',
  );
  assert.deepEqual(await sumSessionUsage(dir), {
    inputTokens: 100,
    outputTokens: 20,
  });
});

test("no usable usage is unavailable, while numeric zero is real usage", async (t) => {
  const dir = await sessions(t);
  assert.equal(await sumSessionUsage(dir), undefined);
  await fs.writeFile(
    join(dir, "usage.jsonl"),
    'null\n{}\n{"usage":null}\n{"usage":{"input":1}}\n',
  );
  assert.equal(await sumSessionUsage(dir), undefined);
  await fs.writeFile(
    join(dir, "usage.jsonl"),
    '{"usage":{"input":0,"output":0,"cost":{"total":0}}}\n',
  );
  assert.deepEqual(await sumSessionUsage(dir), {
    inputTokens: 0,
    outputTokens: 0,
    costUsd: 0,
  });
});

test("includes cached prompt tokens and counts copied assistant entries only once", async (t) => {
  const dir = await sessions(t);
  await fs.mkdir(join(dir, "subagent"));
  const entry = JSON.stringify({
    type: "message",
    id: "shared-entry",
    message: {
      role: "assistant",
      model: "model-a",
      usage: {
        input: 10,
        cacheRead: 1000,
        cacheWrite: 50,
        output: 7,
        cost: { total: 0.1 },
      },
    },
  });
  await fs.writeFile(join(dir, "parent.jsonl"), `${entry}\n`);
  await fs.writeFile(join(dir, "subagent", "fork.jsonl"), `${entry}\n`);
  assert.deepEqual(await sumSessionUsage(dir), {
    inputTokens: 1060,
    outputTokens: 7,
    costUsd: 0.1,
  });
});

test("formats grouped tokens and optional dollar cost deterministically", () => {
  assert.equal(costLine(undefined), "Cost: unavailable");
  assert.equal(
    costLine({ inputTokens: 12345, outputTokens: 678, costUsd: 0.12 }),
    "Cost: 12,345 in / 678 out tokens, $0.12",
  );
  assert.equal(
    costLine({ inputTokens: 12345, outputTokens: 678 }),
    "Cost: 12,345 in / 678 out tokens",
  );
  assert.equal(
    costLine({
      inputTokens: 1000,
      outputTokens: 20,
      costUsd: 0,
      unpriced: true,
    }),
    "Cost: 1,000 in / 20 out tokens, Unpriced",
  );
  assert.equal(
    costLine({
      inputTokens: 1000,
      outputTokens: 20,
      costUsd: 0.5522,
      unpriced: true,
    }),
    "Cost: 1,000 in / 20 out tokens, $0.55 (partial)",
  );
});

test("zero-priced usage with tokens is unpriced, zero-token usage is not", async (t) => {
  const dir = await sessions(t);
  await fs.writeFile(
    join(dir, "usage.jsonl"),
    '{"usage":{"input":100,"output":20,"cost":{"total":0}}}\n',
  );
  assert.deepEqual(await sumSessionUsage(dir), {
    inputTokens: 100,
    outputTokens: 20,
    costUsd: 0,
    unpriced: true,
  });
});

test("totals keep a priced sum and flag unpriced parts", () => {
  assert.deepEqual(
    totalUsage([
      { inputTokens: 1, outputTokens: 1, costUsd: 0.5522 },
      { inputTokens: 2, outputTokens: 2, costUsd: 0, unpriced: true },
    ]),
    { inputTokens: 3, outputTokens: 3, costUsd: 0.5522, unpriced: true },
  );
  assert.deepEqual(
    totalUsage([
      { inputTokens: 1, outputTokens: 1 },
      { inputTokens: 2, outputTokens: 2, costUsd: 0, unpriced: true },
    ]),
    { inputTokens: 3, outputTokens: 3, unpriced: true },
  );
});

test("cost text distinguishes unavailable, unpriced, partial, and priced", () => {
  const tokens = { inputTokens: 10, outputTokens: 1 };
  assert.equal(costText({ ...tokens, unpriced: true }, 4), undefined);
  assert.equal(
    costText({ ...tokens, costUsd: 0, unpriced: true }, 4),
    "Unpriced",
  );
  assert.equal(
    costText({ ...tokens, costUsd: 0.5522, unpriced: true }, 4),
    "$0.5522 (partial)",
  );
  assert.equal(costText({ ...tokens, costUsd: 0.1 }, 4), "$0.1000");
});

function toolResult(
  details: Record<string, unknown>,
  usage: Record<string, unknown> | undefined,
  toolName = "subagent",
  id = "tool",
) {
  return JSON.stringify({
    type: "message",
    id,
    message: {
      role: "toolResult",
      toolName,
      ...(usage ? { usage } : {}),
      details,
    },
  });
}

const childUsage = (input: number, output: number, cost: number) => ({
  input,
  output,
  cacheRead: 0,
  cacheWrite: 0,
  cost,
});

test("child models drop the provider and thinking level only", async (t) => {
  const dir = await sessions(t);
  for (const [model, expected] of [
    ["claude-bridge/claude-opus-5-5:high", "claude-opus-5-5"],
    ["openrouter/anthropic/claude-x:max", "anthropic/claude-x"],
    ["ollama/llama3:8b", "llama3:8b"],
    ["openrouter/x:free", "x:free"],
    ["gpt-5", "gpt-5"],
    ["", "Unknown model"],
    [undefined, "Unknown model"],
  ] as const) {
    await fs.writeFile(
      join(dir, "usage.jsonl"),
      toolResult(
        {
          results: [
            {
              ...(model === undefined ? {} : { model }),
              usage: childUsage(1, 1, 0),
            },
          ],
        },
        { input: 1, output: 1, cost: { total: 0 } },
      ),
    );
    const records = await readSessionUsage(dir);
    assert.equal(records?.length, 1);
    assert.equal(records[0]!.model, expected, String(model));
  }
});

test("subagent aggregates count only when no child usage exists", async (t) => {
  const dir = await sessions(t);
  await fs.writeFile(
    join(dir, "usage.jsonl"),
    toolResult({ results: [{ model: "m" }] }, { input: 5, output: 1 }),
  );
  assert.deepEqual(
    (await readSessionUsage(dir))?.map(({ model, usage }) => ({
      model,
      usage,
    })),
    [{ model: "Unknown model", usage: { inputTokens: 5, outputTokens: 1 } }],
  );
  await fs.writeFile(
    join(dir, "usage.jsonl"),
    toolResult(
      { results: [{ usage: { input: 3, output: 1 } }] },
      { input: 9, output: 9 },
    ),
  );
  assert.deepEqual(
    (await readSessionUsage(dir))?.map(({ model, usage }) => ({
      model,
      usage,
    })),
    [{ model: "Unknown model", usage: { inputTokens: 3, outputTokens: 1 } }],
  );
});

test("async children in a bg_wait result use their models", async (t) => {
  const dir = await sessions(t);
  await fs.writeFile(
    join(dir, "usage.jsonl"),
    toolResult(
      {
        results: [],
        completions: [
          {
            results: [
              {
                model: "openai-codex/gpt-6.1-sol:high",
                usage: childUsage(50, 5, 0.2),
              },
            ],
          },
        ],
      },
      { input: 50, output: 5, cost: { total: 0.2 } },
      "bg_wait",
    ),
  );
  assert.deepEqual(
    (await readSessionUsage(dir))?.map(({ model, usage }) => ({
      model,
      usage,
    })),
    [
      {
        model: "gpt-6.1-sol",
        usage: { inputTokens: 50, outputTokens: 5, costUsd: 0.2 },
      },
    ],
  );
});

test("a record with usage at the top level and in message counts once", async (t) => {
  const dir = await sessions(t);
  await fs.writeFile(
    join(dir, "transcript.jsonl"),
    JSON.stringify({
      usage: { input: 2, output: 1, cost: 0 },
      message: {
        role: "assistant",
        model: "m",
        usage: { input: 2, output: 1, cost: { total: 0 } },
      },
    }),
  );
  const records = await readSessionUsage(dir);
  assert.equal(records?.length, 1);
  assert.equal(records[0]!.model, "m");
});

test("child session and transcript below the session directory count once", async (t) => {
  const dir = await sessions(t);
  const root = "/elsewhere/sessions/1";
  const child = join(dir, "parent", "run-a", "run-0");
  const artifacts = join(dir, "subagent-artifacts");
  await fs.mkdir(child, { recursive: true });
  await fs.mkdir(artifacts);
  await fs.writeFile(
    join(dir, "parent.jsonl"),
    toolResult(
      {
        results: [
          {
            model: "claude-bridge/child:high",
            usage: childUsage(100, 10, 0),
            sessionFile: `${root}/parent/run-a/run-0/session.jsonl`,
            transcriptPath: `${root}/subagent-artifacts/run-a_reviewer_0_transcript.jsonl`,
          },
        ],
      },
      { input: 100, output: 10, cost: { total: 0 } },
    ),
  );
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
  await fs.writeFile(
    join(artifacts, "run-a_reviewer_0_transcript.jsonl"),
    JSON.stringify({
      usage: { input: 100, output: 10, cost: 0 },
      message: {
        role: "assistant",
        model: "child",
        usage: { input: 100, output: 10, cost: { total: 0 } },
      },
    }),
  );
  const unpriced = {
    inputTokens: 100,
    outputTokens: 10,
    costUsd: 0,
    unpriced: true,
  };
  assert.deepEqual(await sumSessionUsage(dir), unpriced);
  assert.deepEqual(
    (await readSessionUsage(dir))?.map((r) => r.model),
    ["child"],
  );

  await fs.rm(join(child, "session.jsonl"));
  assert.deepEqual(await sumSessionUsage(dir), unpriced);

  // An async child names its transcript only in artifactPaths.
  await fs.writeFile(
    join(dir, "parent.jsonl"),
    toolResult(
      {
        results: [],
        completions: [
          {
            results: [
              {
                model: "claude-bridge/child:high",
                usage: childUsage(100, 10, 0),
                artifactPaths: {
                  transcriptPath: `${root}/subagent-artifacts/run-a_reviewer_0_transcript.jsonl`,
                },
              },
              {
                model: "claude-bridge/child:high",
                artifactPaths: {
                  transcriptPath: `${root}/subagent-artifacts/run-b_reviewer_0_transcript.jsonl`,
                },
              },
            ],
          },
        ],
      },
      { input: 100, output: 10, cost: { total: 0 } },
      "bg_wait",
    ),
  );
  // A child without usage still names a transcript that must not count.
  await fs.writeFile(
    join(artifacts, "run-b_reviewer_0_transcript.jsonl"),
    JSON.stringify({ usage: { input: 7, output: 7, cost: 0 } }),
  );
  assert.deepEqual(await sumSessionUsage(dir), unpriced);
});
