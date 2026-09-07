import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { CommandRunner } from "../process/command.ts";
import { PlanningRemoteBaseGit } from "./planning-remote-base.ts";
import { PlanningWorkspaceGit } from "./planning-workspace-git.ts";
import { isPlanningRelativeWithinRoot } from "./planning-workspace-input.ts";
import type { PlanningWorkspaceOwnership } from "./planning-workspaces.ts";
const oid = "a".repeat(40);
const identity = { branch: "topic", worktreePath: ".worktrees/topic" };
const base = {
  remote: "origin",
  baseBranch: "main",
  baseOid: oid,
  artifactCandidates: { spec: [], plan: [] },
};
test("prepares at exact pinned OID and resumes saved ownership without mutation", async () => {
  let added = false;
  const calls: string[][] = [];
  const runner: CommandRunner = {
    run: async (_command, args) => {
      calls.push(args);
      if (args[0] === "worktree" && args[1] === "list")
        return {
          code: 0,
          stdout: added
            ? `worktree /repo/.worktrees/topic\0HEAD ${oid}\0branch refs/heads/topic\0\0`
            : "",
          stderr: "",
        };
      if (args[0] === "show-ref")
        return { code: added ? 0 : 1, stdout: "", stderr: "" };
      if (args[0] === "worktree" && args[1] === "add") {
        added = true;
        return { code: 0, stdout: "", stderr: "" };
      }
      if (args[0] === "rev-parse")
        return { code: 0, stdout: `${oid}\n`, stderr: "" };
      if (args.includes("status")) return { code: 0, stdout: "", stderr: "" };
      return { code: 0, stdout: "", stderr: "" };
    },
  };
  const git = new PlanningWorkspaceGit({
    runner,
    repoRoot: "/repo",
    worktreeRoot: "/repo/.worktrees",
  });
  const prepared = await git.prepare({
    runId: "123e4567-e89b-42d3-a456-426614174000",
    phase: "spec",
    identity,
    base,
  });
  assert.equal(prepared.workspace.headOid, oid);
  const before = calls.length;
  assert.deepEqual(
    await git.resume({
      runId: prepared.workspace.runId,
      phase: "spec",
      identity,
      base,
      saved: prepared.workspace,
    }),
    prepared.snapshot,
  );
  assert.ok(
    calls
      .slice(before)
      .every(
        (args) =>
          args[0] !== "fetch" && !(args[0] === "worktree" && args[1] === "add"),
      ),
  );
});
test("invalid prepare evidence is rejected before any Git command", async () => {
  const calls: string[][] = [];
  const git = new PlanningWorkspaceGit({
    runner: {
      run: async (_command, args) => {
        calls.push(args);
        return { code: 0, stdout: "", stderr: "" };
      },
    },
    repoRoot: "/repo",
    worktreeRoot: "/repo/.worktrees",
  });
  const valid = {
    runId: "123e4567-e89b-42d3-a456-426614174000",
    phase: "spec" as const,
    identity,
    base,
  };
  for (const candidate of [
    { ...valid, runId: "not-a-uuid" },
    { ...valid, phase: "unknown" },
    { ...valid, identity: { ...identity, branch: "bad branch" } },
    { ...valid, identity: { ...identity, branch: "bad\u00a0branch" } },
    { ...valid, base: { ...base, remote: "bad\nremote" } },
    { ...valid, base: { ...base, baseBranch: "bad branch" } },
    {
      ...valid,
      base: {
        ...base,
        artifactCandidates: { spec: ["../outside.md"], plan: [] },
      },
    },
  ]) {
    await assert.rejects(
      git.prepare(candidate as Parameters<PlanningWorkspaceGit["prepare"]>[0]),
      /invalid-saved-identity/,
    );
  }
  assert.deepEqual(calls, []);
  assert.equal(isPlanningRelativeWithinRoot("D:\\owned"), false);
  assert.equal(isPlanningRelativeWithinRoot("../owned"), false);
  assert.equal(isPlanningRelativeWithinRoot("phase/spec"), true);
});

test("fresh prepare refuses every branch and worktree registration collision", async () => {
  const registrations = [
    { label: "branch-only collision", output: "", branchExists: true },
    {
      label: "path owned by another branch",
      output: `worktree /repo/.worktrees/topic\0HEAD ${oid}\0branch refs/heads/other\0\0`,
      branchExists: false,
    },
    {
      label: "branch owned by another worktree",
      output: `worktree /repo/.worktrees/other\0HEAD ${oid}\0branch refs/heads/topic\0\0`,
      branchExists: true,
    },
    {
      label: "detached expected path",
      output: `worktree /repo/.worktrees/topic\0HEAD ${oid}\0detached\0\0`,
      branchExists: false,
    },
    {
      label: "locked expected path",
      output: `worktree /repo/.worktrees/topic\0HEAD ${oid}\0branch refs/heads/topic\0locked reason\0\0`,
      branchExists: true,
    },
    {
      label: "prunable expected path",
      output: `worktree /repo/.worktrees/topic\0HEAD ${oid}\0branch refs/heads/topic\0prunable reason\0\0`,
      branchExists: true,
    },
    {
      label: "malformed response",
      output: `worktree relative\0HEAD ${oid}\0branch refs/heads/topic\0\0`,
      branchExists: true,
    },
  ];
  for (const item of registrations) {
    const calls: string[][] = [];
    const git = new PlanningWorkspaceGit({
      runner: {
        run: async (_command, args) => {
          calls.push(args);
          if (args[0] === "worktree" && args[1] === "list") {
            return { code: 0, stdout: item.output, stderr: "" };
          }
          if (args[0] === "show-ref") {
            return {
              code: item.branchExists ? 0 : 1,
              stdout: "",
              stderr: "",
            };
          }
          if (args[0] === "rev-parse") {
            return { code: 0, stdout: `${oid}\n`, stderr: "" };
          }
          throw new Error(`unexpected command ${args.join(" ")}`);
        },
      },
      repoRoot: "/repo",
      worktreeRoot: "/repo/.worktrees",
    });
    await assert.rejects(
      git.prepare({
        runId: "123e4567-e89b-42d3-a456-426614174000",
        phase: "spec",
        identity,
        base,
      }),
      undefined,
      item.label,
    );
    assert.equal(
      calls.some((args) => args[0] === "worktree" && args[1] === "add"),
      false,
      item.label,
    );
  }
});

test("fresh prepare refuses an existing unregistered path", async () => {
  const root = await mkdtemp(join(tmpdir(), "planning-collision-"));
  const repo = join(root, "repo");
  const worktreeRoot = join(root, "worktrees");
  await mkdir(repo);
  await mkdir(join(worktreeRoot, "topic"), { recursive: true });
  const calls: string[][] = [];
  try {
    const git = new PlanningWorkspaceGit({
      runner: {
        run: async (_command, args) => {
          calls.push(args);
          if (args[0] === "worktree")
            return { code: 0, stdout: "", stderr: "" };
          if (args[0] === "show-ref")
            return { code: 1, stdout: "", stderr: "" };
          throw new Error(`unexpected command ${args.join(" ")}`);
        },
      },
      repoRoot: repo,
      worktreeRoot,
    });
    await assert.rejects(
      git.prepare({
        runId: "123e4567-e89b-42d3-a456-426614174000",
        phase: "spec",
        identity: { branch: "topic", worktreePath: "../worktrees/topic" },
        base,
      }),
      /path-collision/,
    );
    assert.equal(
      calls.some((args) => args[0] === "worktree" && args[1] === "add"),
      false,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("cleanup rejects dirty owned worktrees before destructive command", async () => {
  const runner: CommandRunner = {
    run: async (_command, args) => {
      if (args[0] === "worktree" && args[1] === "list")
        return {
          code: 0,
          stdout: `worktree /repo/.worktrees/topic\0HEAD ${oid}\0branch refs/heads/topic\0\0`,
          stderr: "",
        };
      if (args[0] === "show-ref") return { code: 0, stdout: "", stderr: "" };
      if (args[0] === "rev-parse")
        return { code: 0, stdout: `${oid}\n`, stderr: "" };
      if (args.includes("status"))
        return { code: 0, stdout: " M changed\0", stderr: "" };
      throw new Error(`unexpected command ${args.join(" ")}`);
    },
  };
  const git = new PlanningWorkspaceGit({
    runner,
    repoRoot: "/repo",
    worktreeRoot: "/repo/.worktrees",
  });
  await assert.rejects(
    git.removeWorktree({
      runId: "123e4567-e89b-42d3-a456-426614174000",
      phase: "spec",
      workspace: {
        runId: "123e4567-e89b-42d3-a456-426614174000",
        phase: "spec",
        identity,
        remote: "origin",
        baseBranch: "main",
        baseOid: oid,
        headOid: oid,
        cleanup: { state: "ready" },
      },
    }),
    /dirty-worktree/,
  );
});

test("branch cleanup requires exact remote proof and expected-old CAS", async () => {
  const runId = "123e4567-e89b-42d3-a456-426614174000";
  const workspace: PlanningWorkspaceOwnership<{
    state: "worktree-removed";
    pushedHeadOid: string;
  }> = {
    runId,
    phase: "spec",
    identity,
    remote: "origin",
    baseBranch: "main",
    baseOid: oid,
    headOid: oid,
    cleanup: { state: "worktree-removed", pushedHeadOid: oid },
  };
  const exact = `${oid}\trefs/heads/topic\n`;
  for (const stdout of [
    `${"b".repeat(40)}\trefs/heads/topic\n`,
    `${oid}\trefs/heads/other\n`,
    `${exact}${exact}`,
    "malformed\n",
    `\n${exact}`,
    `${exact}\n`,
    ` ${exact}`,
  ]) {
    const calls: string[][] = [];
    const adapter = new PlanningWorkspaceGit({
      runner: {
        run: async (_command, args) => {
          calls.push(args);
          if (args[0] === "worktree")
            return { code: 0, stdout: "", stderr: "" };
          if (args[0] === "show-ref")
            return { code: 0, stdout: "", stderr: "" };
          if (args[0] === "rev-parse")
            return { code: 0, stdout: `${oid}\n`, stderr: "" };
          if (args[0] === "ls-remote") return { code: 0, stdout, stderr: "" };
          throw new Error(`unexpected command ${args.join(" ")}`);
        },
      },
      repoRoot: "/repo",
      worktreeRoot: "/repo/.worktrees",
    });
    await assert.rejects(
      adapter.removeBranch({ runId, phase: "spec", workspace }),
      /remote-head-mismatch/,
    );
    assert.equal(
      calls.some((args) => args[0] === "update-ref"),
      false,
    );
  }

  const calls: string[][] = [];
  const adapter = new PlanningWorkspaceGit({
    runner: {
      run: async (_command, args) => {
        calls.push(args);
        if (args[0] === "worktree") return { code: 0, stdout: "", stderr: "" };
        if (args[0] === "show-ref") return { code: 0, stdout: "", stderr: "" };
        if (args[0] === "rev-parse")
          return { code: 0, stdout: `${oid}\n`, stderr: "" };
        if (args[0] === "ls-remote")
          return { code: 0, stdout: exact, stderr: "" };
        if (args[0] === "update-ref")
          return { code: 1, stdout: "", stderr: "changed" };
        throw new Error(`unexpected command ${args.join(" ")}`);
      },
    },
    repoRoot: "/repo",
    worktreeRoot: "/repo/.worktrees",
  });
  await assert.rejects(
    adapter.removeBranch({ runId, phase: "spec", workspace }),
    /branch-deletion/,
  );
  assert.deepEqual(
    calls.find((args) => args[0] === "update-ref"),
    ["update-ref", "-d", "refs/heads/topic", oid],
  );
  assert.equal(
    calls.some((args) => args.includes("-D")),
    false,
  );
});

test(
  "real Git creates at the pinned OID, resumes without index mutation, and cleans up idempotently",
  { timeout: 30_000 },
  async () => {
    const root = await mkdtemp(join(tmpdir(), "planning-workspace-"));
    const remote = join(root, "remote.git");
    const seed = join(root, "seed");
    const repo = join(root, "repo");
    const worktreeRoot = join(root, "worktrees");
    const git = (cwd: string, ...args: string[]) =>
      execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
    const runner: CommandRunner = {
      run: async (command, args, options) => {
        try {
          return {
            code: 0,
            stdout: execFileSync(command, args, {
              cwd: options?.cwd,
              encoding: "utf8",
              env: { ...process.env, ...options?.env },
            }),
            stderr: "",
          };
        } catch (error) {
          const failure = error as {
            status?: number;
            stdout?: string;
            stderr?: string;
          };
          return {
            code: failure.status ?? 1,
            stdout: failure.stdout ?? "",
            stderr: failure.stderr ?? "",
          };
        }
      },
    };
    try {
      execFileSync("git", ["init", "--bare", "--initial-branch=main", remote]);
      execFileSync("git", ["init", "-b", "main", seed]);
      git(seed, "config", "user.name", "Patchmill Test");
      git(seed, "config", "user.email", "patchmill@example.test");
      await writeFile(join(seed, "tracked.txt"), "base\n");
      await writeFile(join(seed, ".gitignore"), "ignored.txt\n");
      git(seed, "add", ".");
      git(seed, "commit", "-m", "base");
      git(seed, "remote", "add", "origin", remote);
      git(seed, "push", "-u", "origin", "main");
      execFileSync("git", ["clone", remote, repo]);
      await mkdir(worktreeRoot);

      const remoteBase = new PlanningRemoteBaseGit({
        runner,
        repoRoot: repo,
        specsDir: "docs/specs",
        plansDir: "docs/plans",
      });
      const snapshot = await remoteBase.fetch({
        issueNumber: 187,
        remote: "origin",
        baseBranch: "main",
      });
      await writeFile(join(seed, "tracked.txt"), "remote advanced\n");
      git(seed, "add", "tracked.txt");
      git(seed, "commit", "-m", "advance remote");
      git(seed, "push", "origin", "main");
      assert.notEqual(snapshot.baseOid, git(seed, "rev-parse", "HEAD"));

      const workspace = new PlanningWorkspaceGit({
        runner,
        repoRoot: repo,
        worktreeRoot,
      });
      const ownedIdentity = {
        branch: "planning/spec",
        worktreePath: "../worktrees/spec",
      };
      const prepared = await workspace.prepare({
        runId: "123e4567-e89b-42d3-a456-426614174000",
        phase: "spec",
        identity: ownedIdentity,
        base: snapshot,
      });
      const worktreePath = join(worktreeRoot, "spec");
      assert.equal(git(worktreePath, "rev-parse", "HEAD"), snapshot.baseOid);
      const indexPath = git(worktreePath, "rev-parse", "--git-path", "index");
      const indexBefore = await readFile(indexPath);
      const refsBefore = git(repo, "show-ref");
      await workspace.resume({
        runId: prepared.workspace.runId,
        phase: "spec",
        identity: ownedIdentity,
        base: snapshot,
        saved: prepared.workspace,
      });
      await workspace.resume({
        runId: prepared.workspace.runId,
        phase: "spec",
        identity: ownedIdentity,
        base: snapshot,
        saved: prepared.workspace,
      });
      assert.deepEqual(await readFile(indexPath), indexBefore);
      assert.equal(git(repo, "show-ref"), refsBefore);

      git(worktreePath, "push", "-u", "origin", ownedIdentity.branch);
      const branchOnly = await workspace.removeWorktree({
        runId: prepared.workspace.runId,
        phase: "spec",
        workspace: prepared.workspace,
      });
      assert.equal(branchOnly.state, "branch-only");
      assert.equal(
        (
          await workspace.removeWorktree({
            runId: prepared.workspace.runId,
            phase: "spec",
            workspace: prepared.workspace,
          })
        ).state,
        "branch-only",
      );
      const pushed: PlanningWorkspaceOwnership<{
        state: "worktree-removed";
        pushedHeadOid: string;
      }> = {
        ...prepared.workspace,
        cleanup: {
          state: "worktree-removed",
          pushedHeadOid: prepared.workspace.headOid,
        },
      };
      assert.equal(
        (
          await workspace.removeBranch({
            runId: pushed.runId,
            phase: "spec",
            workspace: pushed,
          })
        ).state,
        "missing",
      );
      assert.equal(
        (
          await workspace.removeBranch({
            runId: pushed.runId,
            phase: "spec",
            workspace: pushed,
          })
        ).state,
        "missing",
      );

      for (const dirty of [
        "tracked",
        "staged",
        "untracked",
        "ignored",
      ] as const) {
        const dirtyIdentity = {
          branch: `planning/${dirty}`,
          worktreePath: `../worktrees/${dirty}`,
        };
        const dirtyPrepared = await workspace.prepare({
          runId: "123e4567-e89b-42d3-a456-426614174000",
          phase: "spec",
          identity: dirtyIdentity,
          base: snapshot,
        });
        const dirtyPath = join(worktreeRoot, dirty);
        if (dirty === "tracked" || dirty === "staged") {
          await writeFile(join(dirtyPath, "tracked.txt"), `${dirty}\n`);
          if (dirty === "staged") git(dirtyPath, "add", "tracked.txt");
        } else {
          await writeFile(join(dirtyPath, `${dirty}.txt`), `${dirty}\n`);
        }
        await assert.rejects(
          workspace.removeWorktree({
            runId: dirtyPrepared.workspace.runId,
            phase: "spec",
            workspace: dirtyPrepared.workspace,
          }),
          /dirty-worktree/,
          dirty,
        );
        git(dirtyPath, "reset", "--hard", "HEAD");
        if (dirty === "untracked" || dirty === "ignored") {
          await rm(join(dirtyPath, `${dirty}.txt`), { force: true });
        }
        await workspace.removeWorktree({
          runId: dirtyPrepared.workspace.runId,
          phase: "spec",
          workspace: dirtyPrepared.workspace,
        });
        git(repo, "branch", "-D", dirtyIdentity.branch);
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  },
);
