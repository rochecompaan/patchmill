import assert from "node:assert/strict";
import test from "node:test";
import { executeRunRecoveryMutation } from "./recovery-mutation.ts";
import type { RunRecoveryAssessment, RunRecoveryDecision } from "./types.ts";
const assessment = {
  runStatePath: "state",
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
test("resume mutation performs no Git commands", async () => {
  const calls: string[][] = [];
  const decision: RunRecoveryDecision = { action: "resume", assessment };
  const result = await executeRunRecoveryMutation({
    decision,
    repoRoot: ".",
    runner: {
      run: async (_command, args) => {
        calls.push(args);
        return { code: 0, stdout: "", stderr: "" };
      },
    },
    reassess: async () => decision,
  });
  assert.equal(result.action, "resume");
  assert.deepEqual(calls, []);
  assert.deepEqual(result.quarantinePaths, []);
});
test("recreates an existing branch without creating it again", async () => {
  const calls: string[][] = [];
  const decision: RunRecoveryDecision = {
    action: "recreate-and-resume",
    assessment,
    recreation: {
      branch: "issue",
      expectedWorktreePath: "work",
      mode: "advance-to-base",
      targetOid: assessment.baseOid,
      expectedBranchOid: assessment.branch.oid,
      pruneStaleRegistration: false,
      stagingPath: "stage",
    },
  };
  await executeRunRecoveryMutation({
    decision,
    repoRoot: ".",
    runner: {
      run: async (_command, args) => {
        calls.push(args);
        return { code: 0, stdout: "", stderr: "" };
      },
    },
    reassess: async () => decision,
  });
  assert.deepEqual(
    calls.find((args) => args[0] === "worktree" && args[1] === "add"),
    ["worktree", "add", "stage", "issue"],
  );
});
test("refusal is never accepted as a reassessment result", async () => {
  const decision: RunRecoveryDecision = {
    action: "recreate-and-resume",
    assessment,
    recreation: {
      branch: "issue",
      expectedWorktreePath: "work",
      mode: "create-from-base",
      targetOid: assessment.baseOid,
      pruneStaleRegistration: false,
      stagingPath: "stage",
    },
  };
  await assert.rejects(
    executeRunRecoveryMutation({
      decision,
      repoRoot: ".",
      runner: { run: async () => ({ code: 0, stdout: "", stderr: "" }) },
      reassess: async () => ({
        action: "refuse",
        assessment,
        reason: "dirty-worktree",
        guidance: [],
      }),
    }),
    /refused/,
  );
});
