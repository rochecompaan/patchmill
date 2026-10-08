import assert from "node:assert/strict";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createCommandRunner } from "../triage/command.ts";
import { cleanupIssueWorkspace } from "./git.ts";
import { resolveRunRepositoryNamespace } from "../../../workflow/run-repository-namespace.ts";

test("stale deletion observation cannot delete a new head or its workspace", async () => {
  const root = await mkdtemp(join(tmpdir(), "git-cleanup-concurrency-"));
  const runner = createCommandRunner();
  const git = async (...args: string[]) => {
    const result = await runner.run("git", args, { cwd: root });
    assert.equal(result.code, 0, result.stderr);
    return result.stdout.trim();
  };
  try {
    await git("init", "--initial-branch=main");
    await git("config", "user.name", "Test");
    await git("config", "user.email", "test@example.test");
    await git("commit", "--allow-empty", "-m", "base");
    const oldHead = await git("rev-parse", "HEAD");
    const path = join(root, ".worktrees", "issue-226");
    await git("worktree", "add", "-b", "agent/issue-226", path, oldHead);
    await git("commit", "--allow-empty", "-m", "new head");
    const newHead = await git("rev-parse", "HEAD");
    await git("update-ref", "refs/heads/agent/issue-226", newHead, oldHead);
    const namespace = await resolveRunRepositoryNamespace(runner, {
      repoRoot: root,
      hostRepository: {
        provider: "github-gh",
        host: "github.com",
        owner: "test",
        repository: "repo",
      },
      runStateDir: join(root, ".runs"),
      worktreeRoot: join(root, ".worktrees"),
      todoRoot: ".pi/todos",
    });
    const result = await cleanupIssueWorkspace(
      runner,
      root,
      {
        branch: "agent/issue-226",
        worktreePath: path,
        expectedHeadOid: oldHead,
      },
      { namespace, runner, attemptId: "cleanup", assertOwned: async () => {} },
    );
    assert.equal(await git("rev-parse", "refs/heads/agent/issue-226"), newHead);
    assert.equal((await stat(path)).isDirectory(), true);
    assert.equal(
      result.some((entry) => entry.status === "failed"),
      true,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
