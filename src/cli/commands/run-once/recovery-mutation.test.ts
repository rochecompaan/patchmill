import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  executeRunRecoveryMutation,
  RunRecoveryMutationError,
} from "./recovery-mutation.ts";
import { planRunRecovery } from "./recovery.ts";
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
        return {
          code: 0,
          stdout: args[0] === "rev-parse" ? assessment.baseOid : "",
          stderr: "",
        };
      },
    },
    reassess: async () => decision,
  });
  assert.deepEqual(
    calls.find((args) => args[0] === "worktree" && args[1] === "add"),
    ["worktree", "add", "stage", "issue"],
  );
});
test("real plan reassessment recreates a missing branch without treating staging as the expected worktree", async () => {
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
  const expected = join(root, "expected");
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
  const state = {
    issueNumber: 45,
    title: "Recover",
    status: "blocked" as const,
    branch: "agent/recovered",
    worktreePath: expected,
    createdAt: "now",
    updatedAt: "now",
  };
  const raw = JSON.stringify(state);
  let recoveryPaths:
    | { quarantinePath: string; stagingPath: string }
    | undefined;
  const recoveryInput = () =>
    planRunRecovery({
      intent: "retry",
      runner,
      repoRoot: root,
      runStatePath: join(root, "state.json"),
      state,
      baseRef: "HEAD",
      expectedWorkspace: { branch: "agent/recovered", worktreePath: expected },
      leaseOwnerToken: "owner",
      snapshotRaw: raw,
      recoveryPaths,
    });
  const decision = await recoveryInput();
  if (decision.action === "recreate-and-resume")
    recoveryPaths = {
      quarantinePath: `${decision.recreation.stagingPath}.quarantine`,
      stagingPath: decision.recreation.stagingPath,
    };
  assert.equal(decision.action, "recreate-and-resume");
  await executeRunRecoveryMutation({
    decision,
    repoRoot: root,
    runner,
    reassess: recoveryInput,
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
test("stale registration must disappear before recreation changes a branch ref", async () => {
  const decision: RunRecoveryDecision = {
    action: "recreate-and-resume",
    assessment,
    recreation: {
      branch: "issue",
      expectedWorktreePath: "missing-worktree",
      mode: "advance-to-base",
      targetOid: assessment.baseOid,
      expectedBranchOid: assessment.branch.oid,
      pruneStaleRegistration: true,
      stagingPath: "staging",
    },
  };
  const calls: string[][] = [];
  await assert.rejects(
    executeRunRecoveryMutation({
      decision,
      repoRoot: ".",
      runner: {
        run: async (_command, args) => {
          calls.push(args);
          if (args.join(" ") === "worktree list --porcelain") {
            return {
              code: 0,
              stdout:
                "worktree missing-worktree\nbranch refs/heads/issue\nprunable gone\n",
              stderr: "",
            };
          }
          if (
            args.join(" ") === "worktree prune --dry-run --verbose --expire=now"
          )
            return {
              code: 0,
              stdout: "Removing worktrees/missing-worktree: gone\n",
              stderr: "",
            };
          return { code: 0, stdout: "", stderr: "" };
        },
      },
      reassess: async () => decision,
    }),
    /registration remains after prune/,
  );
  assert.equal(
    calls.some((args) => args[0] === "update-ref"),
    false,
  );
});

test("real Git stale registration cleanup removes only the verified expected registration", async () => {
  const root = await mkdtemp(join(tmpdir(), "patchmill-prune-git-"));
  const git = (...args: string[]) =>
    execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
  git("init");
  git("config", "user.email", "test@example.com");
  git("config", "user.name", "Test");
  await writeFile(join(root, "base.txt"), "base\n");
  git("add", "base.txt");
  git("commit", "-m", "base");
  const baseOid = git("rev-parse", "HEAD");
  git("worktree", "add", "-b", "agent/stale", "expected", "HEAD");
  await rm(join(root, "expected"), { recursive: true });
  const runner = {
    run: async (
      _command: string,
      args: string[],
      options?: { cwd?: string },
    ) => {
      if (args.join(" ") === "worktree prune --dry-run --verbose --expire=now")
        return {
          code: 0,
          stdout: "",
          stderr:
            "Removing worktrees/expected: gitdir file points to non-existent location\n",
        };
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
  const realAssessment = {
    ...assessment,
    baseOid,
    branch: { exists: true, oid: baseOid },
    expectedWorkspace: {
      branch: "agent/stale",
      worktreePath: "expected",
    },
  };
  const decision: RunRecoveryDecision = {
    action: "recreate-and-resume",
    assessment: realAssessment,
    recreation: {
      branch: "agent/stale",
      expectedWorktreePath: "expected",
      mode: "advance-to-base",
      targetOid: baseOid,
      expectedBranchOid: baseOid,
      pruneStaleRegistration: true,
      stagingPath: "stage",
    },
  };
  await executeRunRecoveryMutation({
    decision,
    repoRoot: root,
    runner,
    reassess: async () => decision,
  });
  assert.equal(git("rev-parse", "agent/stale"), baseOid);
  assert.match(git("worktree", "list", "--porcelain"), /worktree .*expected/);
});

test("real Git stale cleanup refuses when an unrelated registration would also be pruned", async () => {
  const root = await mkdtemp(join(tmpdir(), "patchmill-prune-unrelated-"));
  const git = (...args: string[]) =>
    execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
  git("init");
  git("config", "user.email", "test@example.com");
  git("config", "user.name", "Test");
  await writeFile(join(root, "base.txt"), "base\n");
  git("add", "base.txt");
  git("commit", "-m", "base");
  const baseOid = git("rev-parse", "HEAD");
  git("worktree", "add", "-b", "agent/expected", "expected", "HEAD");
  git("worktree", "add", "-b", "agent/unrelated", "unrelated", "HEAD");
  await rm(join(root, "expected"), { recursive: true });
  await rm(join(root, "unrelated"), { recursive: true });
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
  const decision: RunRecoveryDecision = {
    action: "recreate-and-resume",
    assessment: {
      ...assessment,
      baseOid,
      branch: { exists: true, oid: baseOid },
      expectedWorkspace: {
        branch: "agent/expected",
        worktreePath: "expected",
      },
    },
    recreation: {
      branch: "agent/expected",
      expectedWorktreePath: "expected",
      mode: "advance-to-base",
      targetOid: baseOid,
      expectedBranchOid: baseOid,
      pruneStaleRegistration: true,
      stagingPath: "stage",
    },
  };
  await assert.rejects(
    executeRunRecoveryMutation({
      decision,
      repoRoot: root,
      runner,
      reassess: async () => decision,
    }),
    /Refusing repository-wide worktree prune/,
  );
  assert.match(git("worktree", "list", "--porcelain"), /worktree .*unrelated/);
  assert.equal(git("rev-parse", "agent/expected"), baseOid);
});

test("stale registration recovery refuses a dry-run that would prune an unrelated registration", async () => {
  const decision: RunRecoveryDecision = {
    action: "recreate-and-resume",
    assessment,
    recreation: {
      branch: "issue",
      expectedWorktreePath: "missing-worktree",
      mode: "advance-to-base",
      targetOid: assessment.baseOid,
      expectedBranchOid: assessment.branch.oid,
      pruneStaleRegistration: true,
      stagingPath: "staging",
    },
  };
  const calls: string[][] = [];
  await assert.rejects(
    executeRunRecoveryMutation({
      decision,
      repoRoot: ".",
      runner: {
        run: async (_command, args) => {
          calls.push(args);
          if (args.join(" ") === "worktree list --porcelain")
            return {
              code: 0,
              stdout:
                "worktree missing-worktree\nbranch refs/heads/issue\nprunable gone\n\nworktree unrelated\nbranch refs/heads/unrelated\nprunable gone\n",
              stderr: "",
            };
          if (
            args.join(" ") === "worktree prune --dry-run --verbose --expire=now"
          )
            return {
              code: 0,
              stdout:
                "Removing worktrees/missing-worktree: gone\nRemoving worktrees/unrelated: gone\n",
              stderr: "",
            };
          return { code: 0, stdout: "", stderr: "" };
        },
      },
      reassess: async () => decision,
    }),
    /Refusing repository-wide worktree prune/,
  );
  assert.equal(
    calls.some((args) => args[0] === "update-ref"),
    false,
  );
  assert.equal(
    calls.some((args) => args.join(" ") === "worktree prune --expire=now"),
    false,
  );
});

test("cleanup rejects a reassessment with a changed quarantine plan before move", async () => {
  const decision: RunRecoveryDecision = {
    action: "archive-reset-and-start",
    assessment,
    seed: { issueNumber: 45, title: "Recover" },
    cleanup: {
      branch: "issue",
      expectedWorktreePath: "work",
      expectedBranchOid: assessment.branch.oid,
      quarantinePath: "quarantine",
      pruneStaleRegistration: false,
    },
  };
  const changed = {
    ...decision,
    cleanup: { ...decision.cleanup, quarantinePath: "other" },
  };
  const calls: string[][] = [];
  await assert.rejects(
    executeRunRecoveryMutation({
      decision,
      repoRoot: ".",
      runner: {
        run: async (_command, args) => {
          calls.push(args);
          return { code: 0, stdout: "", stderr: "" };
        },
      },
      reassess: async () => changed,
    }),
    /evidence changed/,
  );
  assert.equal(calls.length, 0);
});
test("real Git reset cleanup retains clean checkout as detached quarantine", async () => {
  const root = await mkdtemp(join(tmpdir(), "patchmill-reset-git-"));
  const git = (...args: string[]) =>
    execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
  git("init");
  git("config", "user.email", "test@example.com");
  git("config", "user.name", "Test");
  await writeFile(join(root, "file"), "safe\n");
  git("add", ".");
  git("commit", "-m", "base");
  const oid = git("rev-parse", "HEAD");
  const branch = "agent/reset",
    expected = join(root, "expected"),
    quarantine = join(root, "quarantine");
  git("worktree", "add", "-b", branch, expected, oid);
  const decision: RunRecoveryDecision = {
    action: "archive-reset-and-start",
    assessment,
    seed: { issueNumber: 45, title: "Recover" },
    cleanup: {
      branch,
      expectedWorktreePath: expected,
      expectedBranchOid: oid,
      quarantinePath: quarantine,
      pruneStaleRegistration: false,
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
  const result = await executeRunRecoveryMutation({
    decision,
    repoRoot: root,
    runner,
    reassess: async () => decision,
  });
  assert.equal(await readFile(join(quarantine, "file"), "utf8"), "safe\n");
  assert.throws(() =>
    git("show-ref", "--verify", "--quiet", `refs/heads/${branch}`),
  );
  assert.ok(result.quarantinePaths.includes(quarantine));
});
test("late ignored quarantine content prevents reset ref deletion", async () => {
  const root = await mkdtemp(join(tmpdir(), "patchmill-reset-late-"));
  const git = (...a: string[]) =>
    execFileSync("git", a, { cwd: root, encoding: "utf8" }).trim();
  git("init");
  git("config", "user.email", "t@e");
  git("config", "user.name", "T");
  await writeFile(join(root, ".gitignore"), ".env\n");
  await writeFile(join(root, "file"), "safe\n");
  git("add", ".");
  git("commit", "-m", "base");
  const oid = git("rev-parse", "HEAD"),
    branch = "agent/reset",
    expected = join(root, "expected"),
    quarantine = join(root, "quarantine");
  git("worktree", "add", "-b", branch, expected, oid);
  const decision: RunRecoveryDecision = {
    action: "archive-reset-and-start",
    assessment,
    seed: { issueNumber: 45, title: "Recover" },
    cleanup: {
      branch,
      expectedWorktreePath: expected,
      expectedBranchOid: oid,
      quarantinePath: quarantine,
      pruneStaleRegistration: false,
    },
  };
  let injected = false;
  const runner = {
    run: async (_c: string, args: string[], o?: { cwd?: string }) => {
      try {
        const stdout = execFileSync("git", args, {
          cwd: o?.cwd ?? root,
          encoding: "utf8",
        });
        if (args[0] === "worktree" && args[1] === "move" && !injected) {
          injected = true;
          await writeFile(join(quarantine, ".env"), "secret\n");
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
    (e: unknown) => {
      assert.ok(e instanceof RunRecoveryMutationError);
      assert.deepEqual((e as RunRecoveryMutationError).quarantinePaths, [
        quarantine,
      ]);
      return true;
    },
  );
  assert.equal(await readFile(join(quarantine, ".env"), "utf8"), "secret\n");
  assert.equal(git("rev-parse", branch), oid);
});
async function planRealRecreation(input: {
  root: string;
  branch: string;
  expected: string;
  state: {
    issueNumber: number;
    title: string;
    status: "blocked";
    branch: string;
    worktreePath: string;
    createdAt: string;
    updatedAt: string;
  };
  runner: {
    run: (
      command: string,
      args: string[],
      options?: { cwd?: string },
    ) => Promise<{ code: number; stdout: string; stderr: string }>;
  };
}) {
  const recoveryPaths: {
    current?: { quarantinePath: string; stagingPath: string };
  } = {};
  const reassess = () =>
    planRunRecovery({
      intent: "retry",
      runner: input.runner,
      repoRoot: input.root,
      runStatePath: join(input.root, "state.json"),
      state: input.state,
      baseRef: "HEAD",
      expectedWorkspace: { branch: input.branch, worktreePath: input.expected },
      leaseOwnerToken: "owner",
      snapshotRaw: JSON.stringify(input.state),
      recoveryPaths: recoveryPaths.current,
    });
  const decision = await reassess();
  assert.equal(decision.action, "recreate-and-resume");
  recoveryPaths.current = {
    quarantinePath: `${decision.recreation.stagingPath}.quarantine`,
    stagingPath: decision.recreation.stagingPath,
  };
  return { decision, reassess };
}

test("real plan reassessment reuses an existing clean branch without changing its head", async () => {
  const root = await mkdtemp(join(tmpdir(), "patchmill-reuse-branch-"));
  const git = (...args: string[]) =>
    execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
  git("init");
  git("config", "user.email", "test@example.com");
  git("config", "user.name", "Test");
  await writeFile(join(root, "exact"), "base\n");
  git("add", ".");
  git("commit", "-m", "base");
  const branch = "agent/reuse",
    head = git("rev-parse", "HEAD"),
    expected = join(root, "expected");
  git("branch", branch, head);
  const runner = {
    async run(_command: string, args: string[], options?: { cwd?: string }) {
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
  const state = {
    issueNumber: 45,
    title: "Recover",
    status: "blocked" as const,
    branch,
    worktreePath: expected,
    createdAt: "now",
    updatedAt: "now",
  };
  const { decision, reassess } = await planRealRecreation({
    root,
    branch,
    expected,
    state,
    runner,
  });
  assert.equal(decision.recreation.mode, "reuse-existing");
  await executeRunRecoveryMutation({
    decision,
    repoRoot: root,
    runner,
    reassess,
  });
  assert.equal(git("rev-parse", branch), head);
  assert.equal(git("-C", expected, "rev-parse", "HEAD"), head);
  assert.equal(await readFile(join(expected, "exact"), "utf8"), "base\n");
});

test("real plan reassessment CAS-advances a stale zero-ahead branch to pinned base before staging", async () => {
  const root = await mkdtemp(join(tmpdir(), "patchmill-advance-branch-"));
  const git = (...args: string[]) =>
    execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
  git("init");
  git("config", "user.email", "test@example.com");
  git("config", "user.name", "Test");
  await writeFile(join(root, "exact"), "old\n");
  git("add", ".");
  git("commit", "-m", "old");
  const branch = "agent/advance",
    old = git("rev-parse", "HEAD"),
    expected = join(root, "expected");
  git("branch", branch, old);
  await writeFile(join(root, "exact"), "pinned\n");
  git("add", ".");
  git("commit", "-m", "base");
  const base = git("rev-parse", "HEAD");
  const calls: string[][] = [];
  const runner = {
    async run(_command: string, args: string[], options?: { cwd?: string }) {
      calls.push(args);
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
  const state = {
    issueNumber: 45,
    title: "Recover",
    status: "blocked" as const,
    branch,
    worktreePath: expected,
    createdAt: "now",
    updatedAt: "now",
  };
  const { decision, reassess } = await planRealRecreation({
    root,
    branch,
    expected,
    state,
    runner,
  });
  assert.equal(decision.recreation.mode, "advance-to-base");
  assert.equal(decision.recreation.expectedBranchOid, old);
  await executeRunRecoveryMutation({
    decision,
    repoRoot: root,
    runner,
    reassess,
  });
  const update = calls.find(
    (args) => args[0] === "update-ref" && args[1] === `refs/heads/${branch}`,
  );
  const add = calls.findIndex(
    (args) => args[0] === "worktree" && args[1] === "add",
  );
  assert.ok(update && calls.indexOf(update) < add);
  assert.deepEqual(update, ["update-ref", `refs/heads/${branch}`, base, old]);
  assert.equal(git("rev-parse", branch), base);
  assert.equal(git("-C", expected, "rev-parse", "HEAD"), base);
  assert.equal(await readFile(join(expected, "exact"), "utf8"), "pinned\n");
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
