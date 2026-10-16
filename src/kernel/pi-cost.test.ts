import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, type TestContext } from "node:test";
import { costLine, sumSessionUsage } from "./pi-cost.ts";

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
  for (const cost of [
    undefined,
    null,
    {},
    { total: "0.1" },
    { total: -1 },
    { total: Number.POSITIVE_INFINITY },
  ]) {
    const entries = [
      null,
      [],
      {},
      { usage: { input: "2", output: 3 } },
      { usage: { input: -1, output: 2 } },
      { usage: { input: Number.POSITIVE_INFINITY, output: 2 } },
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
});
