import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { CommandRunner } from "../command/types.ts";
import { PlanningWorkspaceGit } from "./planning-workspace-git.ts";

const runId = "123e4567-e89b-42d3-a456-426614174000";
const identity = { branch: "planning/spec", worktreePath: "../worktrees/spec" };

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}

function runner(): CommandRunner {
  return {
    async run(command, args, options) {
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
}

test("real Git adopts artifact-only fast-forwards and blocks unsafe revisions", async () => {
  const root = await mkdtemp(join(tmpdir(), "planning-head-adoption-"));
  const remote = join(root, "remote.git");
  const seed = join(root, "seed");
  const repo = join(root, "repo");
  const human = join(root, "human");
  const worktreeRoot = join(root, "worktrees");
  try {
    execFileSync("git", ["init", "--bare", "--initial-branch=main", remote]);
    execFileSync("git", ["init", "-b", "main", seed]);
    git(seed, "config", "user.name", "Patchmill Test");
    git(seed, "config", "user.email", "patchmill@example.test");
    await mkdir(join(seed, "docs", "specs"), { recursive: true });
    await writeFile(join(seed, ".gitignore"), "ignored.txt\n");
    await writeFile(join(seed, "docs", "specs", "example.md"), "original\n");
    git(seed, "add", ".");
    git(seed, "commit", "-m", "base");
    git(seed, "remote", "add", "origin", remote);
    git(seed, "push", "-u", "origin", "main");
    execFileSync("git", ["clone", remote, repo]);
    execFileSync("git", ["clone", remote, human]);
    git(human, "config", "user.name", "Human Test");
    git(human, "config", "user.email", "human@example.test");
    await mkdir(worktreeRoot);

    const workspaces = new PlanningWorkspaceGit({
      runner: runner(),
      repoRoot: repo,
      worktreeRoot,
    });
    const baseOid = git(repo, "rev-parse", "HEAD");
    const prepared = await workspaces.prepare({
      runId,
      phase: "spec",
      identity,
      base: {
        remote: "origin",
        baseBranch: "main",
        baseOid,
        artifactCandidates: { spec: [], plan: [] },
      },
    });
    const worktreePath = join(worktreeRoot, "spec");
    git(worktreePath, "push", "-u", "origin", identity.branch);
    git(human, "fetch", "origin", identity.branch);
    git(human, "checkout", "-b", identity.branch, `origin/${identity.branch}`);
    await writeFile(join(human, "docs", "specs", "example.md"), "revised\n");
    git(human, "add", "docs/specs/example.md");
    git(human, "commit", "-m", "revise spec");
    git(human, "push", "origin", identity.branch);
    const revised = git(human, "rev-parse", "HEAD");

    const safe = await workspaces.adoptPlanningHead({
      issueNumber: 188,
      runId,
      phase: "spec",
      workspace: prepared.workspace,
      hostHeadOid: revised,
      artifactPaths: ["docs/specs/example.md"],
    });
    assert.deepEqual(safe, { kind: "adopted", headOid: revised });
    assert.equal(git(worktreePath, "rev-parse", "HEAD"), revised);

    // Ignored content remains untouched while a cleanup-pending checkpoint advances.
    await writeFile(join(worktreePath, "ignored.txt"), "preserve me\n");
    await writeFile(
      join(human, "docs", "specs", "example.md"),
      "revised twice\n",
    );
    git(human, "add", "docs/specs/example.md");
    git(human, "commit", "-m", "revise spec again");
    git(human, "push", "origin", identity.branch);
    const twice = git(human, "rev-parse", "HEAD");
    const pending = await workspaces.adoptPlanningHead({
      issueNumber: 188,
      runId,
      phase: "spec",
      workspace: {
        ...prepared.workspace,
        headOid: revised,
        cleanup: {
          state: "cleanup-pending",
          reason: "ignored-worktree-content",
          ignoredPaths: ["ignored.txt"],
        },
      },
      hostHeadOid: twice,
      artifactPaths: ["docs/specs/example.md"],
    });
    assert.deepEqual(pending, { kind: "adopted", headOid: twice });
    assert.equal(git(worktreePath, "rev-parse", "HEAD"), twice);
    assert.equal(
      await (
        await import("node:fs/promises")
      ).readFile(join(worktreePath, "ignored.txt"), "utf8"),
      "preserve me\n",
    );

    // A descendant with a non-artifact path cannot move the local checkpoint.
    await writeFile(join(human, "README.md"), "unsafe\n");
    git(human, "add", "README.md");
    git(human, "commit", "-m", "change source-adjacent file");
    git(human, "push", "origin", identity.branch);
    const unsafePath = git(human, "rev-parse", "HEAD");
    const pathBlocked = await workspaces.adoptPlanningHead({
      issueNumber: 188,
      runId,
      phase: "spec",
      workspace: { ...prepared.workspace, headOid: twice },
      hostHeadOid: unsafePath,
      artifactPaths: ["docs/specs/example.md"],
    });
    assert.equal(pathBlocked.kind, "blocked");
    assert.equal(pathBlocked.evidence.failure, "unexpected-paths");
    assert.deepEqual(pathBlocked.evidence.unexpectedPaths, ["README.md"]);
    assert.equal(git(worktreePath, "rev-parse", "HEAD"), twice);

    // A force-pushed non-descendant is rejected and likewise cannot alter local evidence.
    git(human, "reset", "--hard", baseOid);
    await writeFile(join(human, "docs", "specs", "example.md"), "rewritten\n");
    git(human, "add", "docs/specs/example.md");
    git(human, "commit", "-m", "rewrite spec history");
    git(human, "push", "--force", "origin", identity.branch);
    const rewritten = git(human, "rev-parse", "HEAD");
    const rewriteBlocked = await workspaces.adoptPlanningHead({
      issueNumber: 188,
      runId,
      phase: "spec",
      workspace: { ...prepared.workspace, headOid: twice },
      hostHeadOid: rewritten,
      artifactPaths: ["docs/specs/example.md"],
    });
    assert.equal(rewriteBlocked.kind, "blocked");
    assert.equal(rewriteBlocked.evidence.failure, "not-descendant");
    assert.equal(git(worktreePath, "rev-parse", "HEAD"), twice);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
