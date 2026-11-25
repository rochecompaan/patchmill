import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, type TestContext } from "node:test";
import {
  MAX_SUBAGENT_TIMEOUT_MS,
  provisionSubagentLimits,
  subagentLimits,
} from "./subagent-limits.ts";

async function agentDir(t: TestContext) {
  const dir = await mkdtemp(join(tmpdir(), "patchmill-subagent-limits-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return {
    dir,
    file: join(dir, "extensions", "subagent", "config.json"),
  };
}

test("no cap gives the largest timeout pi-subagents accepts", () => {
  assert.equal(MAX_SUBAGENT_TIMEOUT_MS, 2_147_483_647);
  assert.deepEqual(subagentLimits(null), {
    timeoutMs: 2_147_483_647,
    checkpointBeforeDeadlineMs: 300_000,
  });
});

test("a cap gives its whole milliseconds within the pi-subagents range", () => {
  assert.equal(subagentLimits(120).timeoutMs, 7_200_000);
  assert.equal(subagentLimits(0.2).timeoutMs, 12_000);
  for (const minutes of [35791, 0.0000001, 0.33333]) {
    const { timeoutMs } = subagentLimits(minutes);
    assert.ok(Number.isInteger(timeoutMs));
    assert.ok(timeoutMs >= 1 && timeoutMs <= MAX_SUBAGENT_TIMEOUT_MS);
  }
});

test("provisionSubagentLimits creates the file and its folder", async (t) => {
  const a = await agentDir(t);
  await provisionSubagentLimits(a.dir, 120);
  assert.deepEqual(JSON.parse(await readFile(a.file, "utf8")), {
    timeoutMs: 7_200_000,
    checkpointBeforeDeadlineMs: 300_000,
  });
});

test("provisionSubagentLimits keeps other keys and replaces the managed ones", async (t) => {
  const a = await agentDir(t);
  await mkdir(join(a.dir, "extensions", "subagent"), { recursive: true });
  await writeFile(
    a.file,
    JSON.stringify({ toolTimeoutMs: 600_000, timeoutMs: 5 }),
  );
  await provisionSubagentLimits(a.dir, null);
  assert.deepEqual(JSON.parse(await readFile(a.file, "utf8")), {
    toolTimeoutMs: 600_000,
    timeoutMs: 2_147_483_647,
    checkpointBeforeDeadlineMs: 300_000,
  });
});

for (const content of ["not json", "[]"]) {
  test(`provisionSubagentLimits refuses a malformed file: ${content}`, async (t) => {
    const a = await agentDir(t);
    await mkdir(join(a.dir, "extensions", "subagent"), { recursive: true });
    await writeFile(a.file, content);
    await assert.rejects(provisionSubagentLimits(a.dir, null), (error: Error) =>
      error.message.includes(a.file),
    );
    assert.equal(await readFile(a.file, "utf8"), content);
  });
}
