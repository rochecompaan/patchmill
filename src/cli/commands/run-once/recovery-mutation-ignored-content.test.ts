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
import type { RunRecoveryDecision } from "./types.ts";

test("late ignored quarantine content prevents refresh ref update", async () => {
  const root = await mkdtemp(join(tmpdir(), "patchmill-refresh-late-"));
  const git = (...args: string[]) =>
    execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
  git("init");
  git("config", "user.email", "test@example.com");
  git("config", "user.name", "Test");
  await writeFile(join(root, ".gitignore"), ".cache/\n");
  await writeFile(join(root, "file"), "old\n");
  git("add", ".");
  git("commit", "-m", "base");
  const oldBranchOid = git("rev-parse", "HEAD");
  const branch = "agent/refresh";
  const expected = join(root, "expected");
  const quarantine = join(root, "quarantine");
  const staging = join(root, "staging");
  git("worktree", "add", "-b", branch, expected, oldBranchOid);
  await writeFile(join(root, "file"), "new\n");
  git("add", "file");
  git("commit", "-m", "new base");
  const baseOid = git("rev-parse", "HEAD");
  const assessment = {
    runStatePath: "state",
    issueNumber: 45,
    title: "Recover",
    status: "blocked",
    lease: { status: "owned", ownerToken: "owner" },
    legacyMigrationFenceValid: true,
    blocked: true,
    expectedWorkspace: { branch, worktreePath: expected },
    savedWorkspace: { branch, worktreePath: expected },
    baseOid,
    branch: { exists: true, oid: oldBranchOid, checkedOutAt: expected },
    worktree: {
      exists: true,
      registered: true,
      registeredBranch: branch,
      ordinaryClean: true,
      ignoredEntries: [],
    },
    divergence: { behind: 1, ahead: 0 },
    actualUniqueCommits: [],
    savedCommits: [],
    artifacts: { spec: { valid: false }, plan: { valid: false } },
    classification: "resumable-stale-base" as const,
  };
  const decision: RunRecoveryDecision = {
    action: "refresh-and-resume",
    assessment,
    refresh: {
      branch,
      expectedWorktreePath: expected,
      expectedBranchOid: oldBranchOid,
      baseOid,
      quarantinePath: quarantine,
      stagingPath: staging,
    },
  };
  const calls: string[][] = [];
  let injected = false;
  const runner = {
    async run(_command: string, args: string[], options?: { cwd?: string }) {
      calls.push(args);
      try {
        const stdout = execFileSync("git", args, {
          cwd: options?.cwd ?? root,
          encoding: "utf8",
        });
        if (args[0] === "worktree" && args[1] === "move" && !injected) {
          injected = true;
          await (
            await import("node:fs/promises")
          ).mkdir(join(quarantine, ".cache"));
          await writeFile(
            join(quarantine, ".cache", "late.bin"),
            Buffer.from([0, 211, 255]),
          );
        }
        return { code: 0, stdout, stderr: "" };
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
  await assert.rejects(
    executeRunRecoveryMutation({
      decision,
      repoRoot: root,
      runner,
      reassess: async () => decision,
    }),
    (error: unknown) => {
      assert.ok(error instanceof RunRecoveryMutationError);
      assert.match(String(error), /quarantine/);
      assert.match(String(error), /staging/);
      return true;
    },
  );
  assert.deepEqual(
    await readFile(join(quarantine, ".cache", "late.bin")),
    Buffer.from([0, 211, 255]),
  );
  assert.equal(git("rev-parse", branch), oldBranchOid);
  assert.equal(
    calls.some(
      (args) =>
        args[0] === "update-ref" &&
        (args[1] === "--no-deref" || args[1] === `refs/heads/${branch}`),
    ),
    false,
  );
  assert.equal(
    calls.filter((args) => args[0] === "worktree" && args[1] === "move").length,
    1,
  );
});
