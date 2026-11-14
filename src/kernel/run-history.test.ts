import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createRunHistory } from "./run-history.ts";
import { boardProgress } from "../../test-support/board-fixture.ts";

test("history retains ordered diagnostic records and never throws on storage errors", async (t) => {
  const runDir = await fs.mkdtemp(join(tmpdir(), "run-history-"));
  t.after(() => fs.rm(runDir, { recursive: true, force: true }));
  const warnings: string[] = [];
  const history = createRunHistory({
    issue: 9,
    runId: "20261114-120000-abcd",
    runDir,
    now: () => new Date("2026-11-14T12:00:00Z"),
    warn: (s) => warnings.push(s),
  });
  await history.snapshot(
    boardProgress({ issue: 9, runId: "20261114-120000-abcd" }),
  );
  await history.session({
    number: 1,
    phase: "planning",
    stage: "implementation",
  });
  await history.progress("stderr", "01 planning");
  const records = (await fs.readFile(join(runDir, "history.jsonl"), "utf8"))
    .trim()
    .split("\n")
    .map((s) => JSON.parse(s));
  assert.deepEqual(
    records.map((r) => r.sequence),
    [1, 2, 3],
  );
  assert.deepEqual(
    records.map((r) => r.kind),
    ["snapshot", "session", "progress"],
  );
  assert.equal(records[2].text, "01 planning");
  assert.equal(records[1].stage, "implementation");
  await fs.rm(join(runDir, "history.jsonl"));
  await fs.mkdir(join(runDir, "history.jsonl"));
  await history.progress("stdout", "private-marker");
  assert.equal(warnings.length, 1);
  assert.doesNotMatch(warnings[0]!, /private-marker|\/tmp\//);
});
