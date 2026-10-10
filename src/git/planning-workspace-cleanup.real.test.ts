import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { CommandRunner } from "../command/types.ts";
import { PlanningWorkspaceGit } from "./planning-workspace-git.ts";
import {
  PlanningWorkspaceCommandError,
  PlanningWorkspaceConflictError,
  type PlanningWorkspaceOwnership,
} from "./planning-workspaces.ts";

const runId = "123e4567-e89b-42d3-a456-426614174000";

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}

function recordingRunner(input: { beforeRemove?: () => Promise<void> }) {
  const calls: string[][] = [];
  const runner: CommandRunner = {
    async run(command, args, options) {
      calls.push([...args]);
      if (args.join(" ").startsWith("worktree remove"))
        await input.beforeRemove?.();
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
  return { runner, calls };
}

async function fixture(input: { beforeRemove?: () => Promise<void> } = {}) {
  const root = await mkdtemp(join(tmpdir(), "planning-cleanup-"));
  const remote = join(root, "remote.git");
  const seed = join(root, "seed");
  const repo = join(root, "repo");
  const worktreeRoot = join(root, "worktrees");
  execFileSync("git", ["init", "--bare", "--initial-branch=main", remote]);
  execFileSync("git", ["init", "-b", "main", seed]);
  git(seed, "config", "user.name", "Patchmill Test");
  git(seed, "config", "user.email", "patchmill@example.test");
  await writeFile(join(seed, ".gitignore"), ".env\n.pi/\nbuild/\n.unknown/\n");
  await writeFile(join(seed, "README.md"), "base\n");
  git(seed, "add", ".");
  git(seed, "commit", "-m", "base");
  git(seed, "remote", "add", "origin", remote);
  git(seed, "push", "-u", "origin", "main");
  execFileSync("git", ["clone", remote, repo]);
  await mkdir(worktreeRoot);
  const recorded = recordingRunner(input);
  const workspaces = new PlanningWorkspaceGit({
    runner: recorded.runner,
    repoRoot: repo,
    worktreeRoot,
  });
  const baseOid = git(repo, "rev-parse", "HEAD");
  return {
    root,
    repo,
    remote,
    worktreeRoot,
    workspaces,
    calls: recorded.calls,
    base: {
      remote: "origin",
      baseBranch: "main",
      baseOid,
      artifactCandidates: { spec: [], plan: [] },
    },
    async cleanup() {
      await rm(root, { recursive: true, force: true });
    },
  };
}

async function preparedWorkspace(
  setup: Awaited<ReturnType<typeof fixture>>,
  phase: "spec" | "plan" | "implementation",
  cleanup: PlanningWorkspaceOwnership["cleanup"] = { state: "ready" },
) {
  const identity = {
    branch: `planning/${phase}`,
    worktreePath: `../worktrees/${phase}`,
  };
  const prepared = await setup.workspaces.prepare({
    runId,
    phase,
    identity,
    base: setup.base,
  });
  const path = join(setup.worktreeRoot, phase);
  git(path, "push", "-u", "origin", identity.branch);
  return { path, workspace: { ...prepared.workspace, cleanup } };
}

test("normal removal deletes ignored-only worktrees for every phase", async () => {
  const setup = await fixture();
  try {
    for (const phase of ["spec", "plan", "implementation"] as const) {
      const legacy = {
        state: "cleanup-pending" as const,
        reason: "ignored-worktree-content" as const,
        ignoredPaths: [".env", "build/", ".unknown/"],
      };
      const prepared = await preparedWorkspace(
        setup,
        phase,
        phase === "implementation" ? legacy : { state: "ready" },
      );
      await mkdir(join(prepared.path, ".pi"), { recursive: true });
      await mkdir(join(prepared.path, "build"), { recursive: true });
      await mkdir(join(prepared.path, ".unknown"), { recursive: true });
      await writeFile(join(prepared.path, ".env"), "TOKEN=local\n");
      await writeFile(join(prepared.path, ".pi", "state.json"), "{}\n");
      await writeFile(join(prepared.path, "build", "output.bin"), "bytes\n");
      await writeFile(
        join(prepared.path, ".unknown", "operator.txt"),
        "local\n",
      );
      assert.equal(
        git(prepared.path, "status", "--porcelain=v1", "--untracked-files=all"),
        "",
      );

      const resumed = await setup.workspaces.resume({
        runId,
        phase,
        identity: prepared.workspace.identity,
        base: setup.base,
        saved: { ...prepared.workspace, cleanup: { state: "ready" } },
      });
      assert.equal(resumed.clean, true);
      for (const [path, bytes] of [
        [".env", "TOKEN=local\n"],
        [".pi/state.json", "{}\n"],
        ["build/output.bin", "bytes\n"],
        [".unknown/operator.txt", "local\n"],
      ]) {
        assert.equal(await readFile(join(prepared.path, path), "utf8"), bytes);
      }

      const result = await setup.workspaces.removeWorktree({
        runId,
        phase,
        workspace: prepared.workspace,
      });
      assert.equal(result.kind, "removed");
      await assert.rejects(access(prepared.path), { code: "ENOENT" });
      assert.deepEqual(
        setup.calls
          .filter((args) => args[0] === "worktree" && args[1] === "remove")
          .at(-1),
        ["worktree", "remove", "--", prepared.path],
      );
    }
    const removeCalls = setup.calls.filter(
      (args) => args[0] === "worktree" && args[1] === "remove",
    );
    assert.deepEqual(
      removeCalls.map((args) => args.slice(0, 3)),
      [
        ["worktree", "remove", "--"],
        ["worktree", "remove", "--"],
        ["worktree", "remove", "--"],
      ],
    );
    assert.equal(
      setup.calls.some((args) => args.includes("--ignored=matching")),
      false,
    );
  } finally {
    await setup.cleanup();
  }
});

test("cleanup safeguards reject ready and legacy pending ownership before removal", async () => {
  const cases = [
    { kind: "run-id", reason: "invalid-saved-identity" },
    { kind: "phase", reason: "invalid-saved-identity" },
    { kind: "outside", reason: "outside-worktree-root" },
    { kind: "locked", reason: "unsafe-registration" },
    { kind: "elsewhere", reason: "branch-owned-by-other-worktree" },
    { kind: "head", reason: "head-oid-mismatch" },
  ] as const;
  for (const cleanup of [
    { state: "ready" as const },
    {
      state: "cleanup-pending" as const,
      reason: "ignored-worktree-content" as const,
      ignoredPaths: [".env"],
    },
  ]) {
    for (const { kind, reason } of cases) {
      const setup = await fixture();
      try {
        const prepared = await preparedWorkspace(setup, "spec", cleanup);
        await writeFile(join(prepared.path, ".env"), "unique ignored data\n");
        const workspace = {
          ...prepared.workspace,
          identity: { ...prepared.workspace.identity },
        };
        if (kind === "outside") workspace.identity.worktreePath = setup.repo;
        if (kind === "locked")
          git(setup.repo, "worktree", "lock", prepared.path);
        if (kind === "elsewhere")
          workspace.identity.worktreePath = join(setup.worktreeRoot, "other");
        if (kind === "head") workspace.headOid = "b".repeat(40);
        const start = setup.calls.length;
        await assert.rejects(
          setup.workspaces.removeWorktree({
            runId: kind === "run-id" ? "different-run" : runId,
            phase: kind === "phase" ? "plan" : "spec",
            workspace,
          }),
          (error: unknown) => {
            assert.ok(error instanceof PlanningWorkspaceConflictError);
            assert.equal(error.reason, reason, `${cleanup.state}: ${kind}`);
            return true;
          },
        );
        assert.equal(
          setup.calls
            .slice(start)
            .some(
              (args) =>
                (args[0] === "worktree" && args[1] === "remove") ||
                (args[0] === "update-ref" && args[1] === "-d"),
            ),
          false,
        );
        assert.equal(
          await readFile(join(prepared.path, ".env"), "utf8"),
          "unique ignored data\n",
        );
        assert.equal(
          git(setup.repo, "rev-parse", "refs/heads/planning/spec"),
          prepared.workspace.headOid,
        );
      } finally {
        await setup.cleanup();
      }
    }
  }
});

test("ordinary changes remain on disk and block removal", async () => {
  for (const kind of ["tracked", "staged", "untracked"] as const) {
    const setup = await fixture();
    try {
      const prepared = await preparedWorkspace(setup, "spec");
      const name = kind === "tracked" ? "README.md" : `${kind}.txt`;
      const path = join(prepared.path, name);
      await writeFile(path, "preserve me\n");
      if (kind === "staged") git(prepared.path, "add", name);
      await assert.rejects(
        setup.workspaces.removeWorktree({
          runId,
          phase: "spec",
          workspace: prepared.workspace,
        }),
        (error: unknown) =>
          error instanceof PlanningWorkspaceConflictError &&
          error.reason === "dirty-worktree",
      );
      assert.equal(await readFile(path, "utf8"), "preserve me\n");
    } finally {
      await setup.cleanup();
    }
  }
});

test("normal Git removal preserves an ordinary file created after status", async () => {
  let worktreePath = "";
  const setup = await fixture({
    beforeRemove: async () =>
      writeFile(join(worktreePath, "late.txt"), "late\n"),
  });
  try {
    const prepared = await preparedWorkspace(setup, "spec");
    worktreePath = prepared.path;
    await assert.rejects(
      setup.workspaces.removeWorktree({
        runId,
        phase: "spec",
        workspace: prepared.workspace,
      }),
      (error: unknown) =>
        error instanceof PlanningWorkspaceCommandError &&
        error.operation === "worktree-remove",
    );
    assert.equal(
      await readFile(join(prepared.path, "late.txt"), "utf8"),
      "late\n",
    );
    const removals = setup.calls.filter(
      (args) => args[0] === "worktree" && args[1] === "remove",
    );
    assert.equal(removals.length, 1);
    assert.equal(removals[0].includes("--force"), false);
    assert.equal(
      git(setup.repo, "rev-parse", "refs/heads/planning/spec"),
      prepared.workspace.headOid,
    );
  } finally {
    await setup.cleanup();
  }
});
