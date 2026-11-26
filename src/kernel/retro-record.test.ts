import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, type TestContext } from "node:test";
import { claimRetro, finishRetro, type RetroEnd } from "./retro-record.ts";

const now = () => new Date("2026-11-27T09:15:00Z");
const merged: RetroEnd = { kind: "merged", pullRequest: 41 };

async function issueDir(t: TestContext) {
  const dir = await fs.mkdtemp(join(tmpdir(), "retro-record-"));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  await fs.mkdir(join(dir, "console"));
  await fs.writeFile(join(dir, "lock"), "");
  return dir;
}

async function attempt(dir: string, runId: string, startedAt?: string) {
  await fs.mkdir(join(dir, runId), { recursive: true });
  await fs.writeFile(
    join(dir, runId, "result.json"),
    JSON.stringify({ runId, ...(startedAt ? { startedAt } : {}) }),
  );
}

async function record(dir: string, retroId: string) {
  return JSON.parse(
    await fs.readFile(join(dir, "retros", retroId, "retro.json"), "utf8"),
  ) as Record<string, unknown>;
}

test("the first claim covers every run folder with a result, oldest first", async (t) => {
  const dir = await issueDir(t);
  await attempt(dir, "20261127-090000-bbbb", "2026-11-27T07:00:00.000Z");
  await attempt(dir, "20261124-101500-aaaa", "2026-11-24T08:15:00.000Z");
  const scope = await claimRetro({
    issueDir: dir,
    end: merged,
    mode: "file-issues",
    now,
  });
  assert.ok(scope);
  assert.deepEqual(scope.runIds, [
    "20261124-101500-aaaa",
    "20261127-090000-bbbb",
  ]);
  assert.equal(scope.since, "2026-11-24T08:15:00.000Z");
  assert.equal(scope.findings, join(scope.dir, "findings.md"));
  const saved = await record(dir, scope.retroId);
  assert.equal(saved.version, 1);
  assert.equal(saved.end, "merged-41");
  assert.equal(saved.status, "started");
  assert.equal(saved.mode, "file-issues");
});

test("a second claim for the same end returns undefined, also after failed", async (t) => {
  const dir = await issueDir(t);
  await attempt(dir, "20261124-101500-aaaa", "2026-11-24T08:15:00.000Z");
  const first = await claimRetro({
    issueDir: dir,
    end: merged,
    mode: "findings-only",
    now,
  });
  assert.ok(first);
  await finishRetro(first, "failed", "Pi exited 1");
  await attempt(dir, "20261128-101500-cccc", "2026-11-28T08:15:00.000Z");
  assert.equal(
    await claimRetro({ issueDir: dir, end: merged, mode: "file-issues", now }),
    undefined,
  );
});

test("a later end covers only uncovered run folders", async (t) => {
  const dir = await issueDir(t);
  await attempt(dir, "20261124-101500-aaaa", "2026-11-24T08:15:00.000Z");
  const first = await claimRetro({
    issueDir: dir,
    end: { kind: "needs-info", runId: "20261124-101500-aaaa" },
    mode: "file-issues",
    now,
  });
  assert.ok(first);
  await attempt(dir, "20261127-090000-bbbb", "2026-11-27T07:00:00.000Z");
  const second = await claimRetro({
    issueDir: dir,
    end: merged,
    mode: "file-issues",
    now: () => new Date("2026-11-27T09:16:00Z"),
  });
  assert.ok(second);
  assert.deepEqual(second.runIds, ["20261127-090000-bbbb"]);
  assert.equal(second.since, "2026-11-27T07:00:00.000Z");
});

test("no uncovered run folder gives no claim", async (t) => {
  const dir = await issueDir(t);
  assert.equal(
    await claimRetro({ issueDir: dir, end: merged, mode: "file-issues", now }),
    undefined,
  );
  await attempt(dir, "20261124-101500-aaaa", "2026-11-24T08:15:00.000Z");
  assert.ok(
    await claimRetro({
      issueDir: dir,
      end: { kind: "needs-info", runId: "20261124-101500-aaaa" },
      mode: "file-issues",
      now,
    }),
  );
  assert.equal(
    await claimRetro({ issueDir: dir, end: merged, mode: "file-issues", now }),
    undefined,
  );
});

test("a run folder without result.json is not covered", async (t) => {
  const dir = await issueDir(t);
  await fs.mkdir(join(dir, "20261124-101500-dead", "sessions"), {
    recursive: true,
  });
  await attempt(dir, "20261125-101500-aaaa", "2026-11-25T08:15:00.000Z");
  const scope = await claimRetro({
    issueDir: dir,
    end: merged,
    mode: "file-issues",
    now,
  });
  assert.deepEqual(scope?.runIds, ["20261125-101500-aaaa"]);
});

test("an unreadable retro.json does not block a claim", async (t) => {
  const dir = await issueDir(t);
  await attempt(dir, "20261124-101500-aaaa", "2026-11-24T08:15:00.000Z");
  await fs.mkdir(join(dir, "retros", "broken"), { recursive: true });
  await fs.writeFile(join(dir, "retros", "broken", "retro.json"), "{");
  const scope = await claimRetro({
    issueDir: dir,
    end: merged,
    mode: "file-issues",
    now,
  });
  assert.deepEqual(scope?.runIds, ["20261124-101500-aaaa"]);
});

for (const status of ["done", "failed", "skipped"] as const) {
  test(`finishRetro records ${status} and blocks a later claim for the end`, async (t) => {
    const dir = await issueDir(t);
    await attempt(dir, "20261124-101500-aaaa", "2026-11-24T08:15:00.000Z");
    const scope = await claimRetro({
      issueDir: dir,
      end: merged,
      mode: "file-issues",
      now,
    });
    assert.ok(scope);
    await finishRetro(scope, status, `Retro ${status}.`, now);
    const saved = await record(dir, scope.retroId);
    assert.equal(saved.status, status);
    assert.equal(saved.summary, `Retro ${status}.`);
    assert.equal(saved.finishedAt, now().toISOString());
    await attempt(dir, "20261128-101500-cccc", "2026-11-28T08:15:00.000Z");
    assert.equal(
      await claimRetro({
        issueDir: dir,
        end: merged,
        mode: "file-issues",
        now,
      }),
      undefined,
    );
  });
}
