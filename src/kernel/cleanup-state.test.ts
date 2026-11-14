import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  appendCleanupLog,
  readCleanupReceipt,
  writeCleanupReceipt,
  type CleanupReceipt,
} from "./cleanup-state.ts";

const receipt: CleanupReceipt = {
  version: 1,
  identity: {
    repository: "fixture/repo",
    pushRepository: "fixture/repo",
    issue: 9,
    branch: "agent/issue-9-add-login",
    baseBranch: "main",
    pullRequest: 1,
  },
  completedAt: "2026-11-14T12:00:00.000Z",
  hook: { status: "succeeded", path: "./scripts/cleanup.sh" },
};

for (const mode of ["hook", "no hook"] as const) {
  test(`cleanup receipt round trip: ${mode}`, async (t) => {
    const dir = await fs.mkdtemp(join(tmpdir(), "cleanup-state-"));
    t.after(() => fs.rm(dir, { recursive: true, force: true }));
    assert.equal(await readCleanupReceipt(dir), undefined);
    const value: CleanupReceipt = {
      ...receipt,
      hook: mode === "hook" ? receipt.hook : { status: "not-configured" },
    };
    await writeCleanupReceipt(dir, value);
    assert.deepEqual(await readCleanupReceipt(dir), value);
    assert.deepEqual(await fs.readdir(dir), ["cleanup.json"]);
  });
}

for (const raw of [
  "{",
  "null",
  JSON.stringify({ ...receipt, version: 2 }),
  JSON.stringify({ ...receipt, identity: { ...receipt.identity, issue: -9 } }),
  JSON.stringify({ ...receipt, hook: { status: "pending" } }),
  JSON.stringify({
    ...receipt,
    identity: { ...receipt.identity, branch: "agent/issue-99-other" },
  }),
]) {
  test(`invalid receipt is not treated as absent: ${raw}`, async (t) => {
    const dir = await fs.mkdtemp(join(tmpdir(), "cleanup-state-"));
    t.after(() => fs.rm(dir, { recursive: true, force: true }));
    await fs.writeFile(join(dir, "cleanup.json"), raw);
    await assert.rejects(readCleanupReceipt(dir), /cleanup receipt/i);
    assert.equal(await fs.readFile(join(dir, "cleanup.json"), "utf8"), raw);
  });
}

test("failed atomic receipt publication leaves existing destination and no temporary file", async (t) => {
  const dir = await fs.mkdtemp(join(tmpdir(), "cleanup-state-"));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  await fs.mkdir(join(dir, "cleanup.json"));
  await assert.rejects(writeCleanupReceipt(dir, receipt));
  assert.deepEqual(await fs.readdir(dir), ["cleanup.json"]);
  assert.equal((await fs.stat(join(dir, "cleanup.json"))).isDirectory(), true);
});

test("cleanup log appends timestamped command output and mirrors run diagnostics", async (t) => {
  const dir = await fs.mkdtemp(join(tmpdir(), "cleanup-state-"));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const runLogPath = join(dir, "pi.log");
  await appendCleanupLog({
    issueDir: dir,
    at: receipt.completedAt,
    message: "hook exited 7",
    stdout: "hook stdout\n",
    stderr: "hook stderr\n",
    runLogPath,
  });
  await appendCleanupLog({
    issueDir: dir,
    at: receipt.completedAt,
    message: "kept workspace",
  });
  const log = await fs.readFile(join(dir, "cleanup.log"), "utf8");
  assert.match(log, /2026-11-14T12:00:00.000Z.*hook exited 7/);
  assert.match(log, /hook stdout\nhook stderr\n/);
  assert.match(log, /kept workspace/);
  assert.match(await fs.readFile(runLogPath, "utf8"), /hook exited 7/);
});
