import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { archiveRunRecovery } from "./recovery-archive.ts";
import type { RunRecoveryAssessment, RunStateSnapshot } from "./types.ts";
test("archives exact state bytes before reset mutation", async () => {
  const dir = await mkdtemp(join(tmpdir(), "patchmill-archive-"));
  const raw =
    '{\n  "issueNumber": 45,\n  "title": "Recover",\n  "status": "blocked"\n}';
  const path = join(dir, "issue-45.json");
  await writeFile(path, raw);
  const snapshot: RunStateSnapshot = { path, raw, state: JSON.parse(raw) };
  const assessment = {
    runStatePath: path,
    issueNumber: 45,
    title: "Recover",
    status: "blocked",
    lease: { status: "owned", ownerToken: "x" },
    legacyMigrationFenceValid: true,
    blocked: true,
    expectedWorkspace: { branch: "issue", worktreePath: "work" },
    savedWorkspace: {},
    baseOid: "0123456789abcdef0123456789abcdef01234567",
    branch: { exists: true, oid: "abcdefabcdefabcdefabcdefabcdefabcdefabcd" },
    worktree: { exists: true, registered: true, ignoredEntries: [] },
    actualUniqueCommits: [],
    savedCommits: [],
    artifacts: { spec: { valid: false }, plan: { valid: false } },
    classification: "resumable-current",
  } satisfies RunRecoveryAssessment;
  const archived = await archiveRunRecovery({
    runStateDir: dir,
    issueNumber: 45,
    snapshot,
    assessment,
    decision: {
      action: "archive-reset-and-start",
      assessment,
      seed: { issueNumber: 45, title: "Recover" },
      cleanup: { pruneStaleRegistration: false },
    },
    command: "patchmill run reset",
    baseRef: "HEAD",
    now: new Date("2026-08-28T12:00:00.000Z"),
  });
  assert.equal(
    await readFile(join(archived.path, "run-state.json"), "utf8"),
    raw,
  );
  assert.equal(
    JSON.parse(
      await readFile(join(archived.path, "recovery-assessment.json"), "utf8"),
    ).recoveryClassification,
    "resumable-current",
  );
  assert.doesNotMatch(archived.path, /:/);
});

test("archives under the trusted leased issue rather than state data", async () => {
  const dir = await mkdtemp(join(tmpdir(), "patchmill-archive-trusted-"));
  const raw = '{"issueNumber":"../escape","title":"x","status":"blocked"}';
  const path = join(dir, "issue-45.json");
  const snapshot: RunStateSnapshot = {
    path,
    raw,
    state: JSON.parse(raw) as RunStateSnapshot["state"],
  };
  const assessment = {
    runStatePath: path,
    issueNumber: 45,
    title: "x",
    status: "blocked",
    lease: { status: "owned", ownerToken: "x" },
    legacyMigrationFenceValid: true,
    blocked: true,
    expectedWorkspace: { branch: "issue", worktreePath: "work" },
    savedWorkspace: {},
    baseOid: "0123456789abcdef0123456789abcdef01234567",
    branch: { exists: false },
    worktree: { exists: false, registered: false, ignoredEntries: [] },
    actualUniqueCommits: [],
    savedCommits: [],
    artifacts: { spec: { valid: false }, plan: { valid: false } },
    classification: "recreatable-clean",
  } satisfies RunRecoveryAssessment;
  const archived = await archiveRunRecovery({
    runStateDir: dir,
    issueNumber: 45,
    snapshot,
    assessment,
    decision: {
      action: "archive-reset-and-start",
      assessment,
      seed: { issueNumber: 45, title: "x" },
      cleanup: { pruneStaleRegistration: false },
    },
    command: "patchmill run reset",
    baseRef: "HEAD",
    now: new Date("2026-08-28T12:00:00.000Z"),
  });
  assert.match(archived.path, /archive\/issue-45\//);
});
