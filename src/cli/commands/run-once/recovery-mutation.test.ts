import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  executeRunRecoveryMutation,
  RunRecoveryMutationError,
} from "./recovery-mutation.ts";
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
test("real Git creates a missing branch worktree from its pinned base", async () => {
  const root = await mkdtemp(join(tmpdir(), "patchmill-real-git-"));
  const git = (...args: string[]) =>
    execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
  git("init");
  git("config", "user.email", "test@example.com");
  git("config", "user.name", "Test");
  await writeFile(join(root, "base.txt"), "pinned\n");
  git("add", ".");
  git("commit", "-m", "base");
  const base = git("rev-parse", "HEAD");
  const staging = join(root, "stage");
  const expected = join(root, "expected");
  const decision: RunRecoveryDecision = {
    action: "recreate-and-resume",
    assessment,
    recreation: {
      branch: "agent/recovered",
      expectedWorktreePath: expected,
      mode: "create-from-base",
      targetOid: base,
      pruneStaleRegistration: false,
      stagingPath: staging,
    },
  };
  const runner = {
    run: async (
      _command: string,
      args: string[],
      options?: { cwd?: string },
    ) => {
      try {
        return {
          code: 0,
          stdout: execFileSync("git", args, {
            cwd: options?.cwd ?? root,
            encoding: "utf8",
          }),
          stderr: "",
        };
      } catch (error) {
        const result = error as {
          status?: number;
          stdout?: string;
          stderr?: string;
        };
        return {
          code: result.status ?? 1,
          stdout: result.stdout ?? "",
          stderr: result.stderr ?? "",
        };
      }
    },
  };
  await executeRunRecoveryMutation({
    decision,
    repoRoot: root,
    runner,
    reassess: async () => decision,
  });
  assert.equal(await readFile(join(expected, "base.txt"), "utf8"), "pinned\n");
  assert.equal(git("rev-parse", "agent/recovered"), base);
});
test("real Git refresh quarantines stale checkout and advances branch by expected OID", async () => {
  const root = await mkdtemp(join(tmpdir(), "patchmill-refresh-git-"));
  const git = (...args: string[]) =>
    execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
  git("init");
  git("config", "user.email", "test@example.com");
  git("config", "user.name", "Test");
  await writeFile(join(root, "value"), "old\n");
  git("add", ".");
  git("commit", "-m", "old");
  const old = git("rev-parse", "HEAD");
  const branch = "agent/refresh";
  const expected = join(root, "expected"),
    quarantine = join(root, "quarantine"),
    staging = join(root, "staging");
  git("worktree", "add", "-b", branch, expected, old);
  await writeFile(join(root, "value"), "base\n");
  git("add", ".");
  git("commit", "-m", "base");
  const base = git("rev-parse", "HEAD");
  const decision: RunRecoveryDecision = {
    action: "refresh-and-resume",
    assessment,
    refresh: {
      branch,
      expectedWorktreePath: expected,
      expectedBranchOid: old,
      baseOid: base,
      quarantinePath: quarantine,
      stagingPath: staging,
    },
  };
  const runner = {
    run: async (
      _command: string,
      args: string[],
      options?: { cwd?: string },
    ) => {
      try {
        return {
          code: 0,
          stdout: execFileSync("git", args, {
            cwd: options?.cwd ?? root,
            encoding: "utf8",
          }),
          stderr: "",
        };
      } catch (error) {
        const e = error as {
          status?: number;
          stdout?: string;
          stderr?: string;
        };
        return {
          code: e.status ?? 1,
          stdout: e.stdout ?? "",
          stderr: e.stderr ?? "",
        };
      }
    },
  };
  await executeRunRecoveryMutation({
    decision,
    repoRoot: root,
    runner,
    reassess: async () => decision,
  });
  assert.equal(await readFile(join(expected, "value"), "utf8"), "base\n");
  assert.equal(await readFile(join(quarantine, "value"), "utf8"), "old\n");
  assert.equal(git("rev-parse", branch), base);
});
test("refresh CAS failure retains staged and quarantined paths", async () => {
  const decision: RunRecoveryDecision = {
    action: "refresh-and-resume",
    assessment,
    refresh: {
      branch: "issue",
      expectedWorktreePath: "work",
      expectedBranchOid: assessment.branch.oid!,
      baseOid: assessment.baseOid,
      quarantinePath: "quarantine",
      stagingPath: "staging",
    },
  };
  const runner = {
    run: async (_command: string, args: string[]) => ({
      code: args[0] === "update-ref" && args[1] === "refs/heads/issue" ? 1 : 0,
      stdout: "",
      stderr: "CAS changed",
    }),
  };
  await assert.rejects(
    executeRunRecoveryMutation({
      decision,
      repoRoot: ".",
      runner,
      reassess: async () => decision,
    }),
    (error: unknown) => {
      assert.ok(error instanceof RunRecoveryMutationError);
      const failure = error as RunRecoveryMutationError;
      assert.deepEqual(failure.quarantinePaths, ["quarantine"]);
      assert.deepEqual(failure.stagingPaths, ["staging"]);
      return true;
    },
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
