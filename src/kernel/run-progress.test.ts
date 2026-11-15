import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  parseRunProgress,
  projectRunProgress,
  writeRunProgress,
  type RunProgress,
} from "./run-progress.ts";

const record: RunProgress = {
  schemaVersion: 1,
  issue: 9,
  runId: "20261114-120000-abcd",
  startedAt: "2026-11-14T12:00:00.000Z",
  updatedAt: "2026-11-14T12:00:01.000Z",
  state: "planning",
  phase: "planning",
  session: 1,
  interactive: true,
  facts: {
    stage: "implementation",
    branch: "agent/issue-9-test",
    baseBranch: "main",
    specPath: "docs/specs/design.md",
    planPath: null,
    parentSpec: null,
    pullRequest: null,
  },
  summary: null,
  outcome: null,
};

test("parent spec progress accepts old records and rejects invalid parent facts", () => {
  const { parentSpec: _parent, ...oldFacts } = record.facts!;
  const parsed = parseRunProgress({ ...record, facts: oldFacts }, 9);
  assert.equal(parsed?.facts?.parentSpec, null);
  const parentSpec = { issue: 5, path: "docs/specs/p.md" };
  assert.deepEqual(
    parseRunProgress({ ...record, facts: { ...oldFacts, parentSpec } }, 9)
      ?.facts?.parentSpec,
    parentSpec,
  );
  for (const bad of [
    { issue: 0, path: "a.md" },
    { issue: 5, path: "../x.md" },
    { issue: 5, path: null },
  ]) {
    assert.equal(
      parseRunProgress(
        { ...record, facts: { ...oldFacts, parentSpec: bad } },
        9,
      ),
      undefined,
    );
  }
});

test("unknown progress versions are absent observations", () => {
  assert.equal(parseRunProgress({ schemaVersion: 2 }, 9), undefined);
  assert.deepEqual(parseRunProgress(record, 9), record);
  for (const invalid of [
    { ...record, issue: 10 },
    { ...record, runId: "../private" },
    { ...record, state: "claimed" },
    { ...record, updatedAt: "not a date" },
    { ...record, session: -1 },
    { ...record, state: "ended" },
    { ...record, facts: { ...record.facts, specPath: "/private/spec.md" } },
    { ...record, facts: { ...record.facts, planPath: "docs/../private.md" } },
  ])
    assert.equal(parseRunProgress(invalid, 9), undefined);
});

test("progress projections exclude private kernel paths and PR bodies", () => {
  const p = projectRunProgress(
    {
      issue: 9,
      runId: record.runId,
      runDir: "/private/run",
      startedAt: record.startedAt,
      state: "planning",
      session: 1,
      facts: {
        stage: "implementation",
        branch: "agent/issue-9-test",
        baseBranch: "main",
        worktree: "/private/worktree",
        remoteBranchExists: false,
        expectedSpecPath: "docs/specs/expected.md",
        expectedPlanPath: "docs/plans/expected.md",
        parentSpec: { issue: 5, path: "docs/specs/p.md" },
      },
    },
    true,
    new Date(record.updatedAt),
  );
  assert.doesNotMatch(
    JSON.stringify(p),
    /private|expectedSpecPath|runDir|worktree/,
  );
  assert.equal(p.phase, null);
  assert.equal(p.facts?.specPath, null);
  assert.deepEqual(p.facts?.parentSpec, { issue: 5, path: "docs/specs/p.md" });
});

test("atomic progress replacement leaves complete records and no temporary siblings", async (t) => {
  const dir = await fs.mkdtemp(join(tmpdir(), "patchmill-progress-"));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  await writeRunProgress(dir, record);
  for (let session = 2; session < 12; session++) {
    const writing = writeRunProgress(dir, { ...record, session });
    const during = JSON.parse(
      await fs.readFile(join(dir, "progress.json"), "utf8"),
    );
    assert.ok(parseRunProgress(during, 9));
    await writing;
  }
  assert.equal(
    JSON.parse(await fs.readFile(join(dir, "progress.json"), "utf8")).session,
    11,
  );
  assert.deepEqual(await fs.readdir(dir), ["progress.json"]);
});
