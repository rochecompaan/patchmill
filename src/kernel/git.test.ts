import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { join } from "node:path";
import { test, type TestContext } from "node:test";
import { createGitFixture } from "../../test-support/git-fixture.ts";
import {
  CommandFailedError,
  runCommand,
  type CommandRunner,
} from "../process/command.ts";
import { createKernelGit } from "./git.ts";

async function setup(t: TestContext) {
  const fixture = await createGitFixture();
  t.after(() => fs.rm(fixture.dir, { recursive: true, force: true }));
  const runner: CommandRunner = (command, args, options) =>
    runCommand(command, args, { ...options, env: fixture.env });
  const git = async (args: string[], cwd = fixture.repoRoot) => {
    const result = await runner("git", args, { cwd });
    if (result.code !== 0) throw new CommandFailedError("git", args, result);
    return result.stdout.trim();
  };
  return {
    ...fixture,
    git,
    runner,
    kernel: createKernelGit(runner, fixture.repoRoot),
  };
}

test("resolves the remote default rather than the checked-out local branch", async (t) => {
  const { kernel, git } = await setup(t);
  await git(["checkout", "-b", "local-only"]);
  assert.equal(await kernel.remoteDefaultBranch(), "main");
});

test("returns undefined when origin HEAD is absent", async (t) => {
  const { kernel, repoRoot } = await setup(t);
  await fs.unlink(join(repoRoot, ".git", "refs", "remotes", "origin", "HEAD"));
  assert.equal(await kernel.remoteDefaultBranch(), undefined);
});

test("fetch discovers only exact issue branches and prunes stale remote refs", async (t) => {
  const { kernel, git, repoRoot, dir } = await setup(t);
  const seed = join(dir, "seed");
  await git(
    ["push", "origin", "HEAD:agent/issue-4-a", "HEAD:agent/issue-40-b"],
    seed,
  );
  await git(["update-ref", "refs/remotes/origin/stale", "HEAD"], repoRoot);
  assert.deepEqual(await kernel.remoteBranches(4), []);
  await kernel.fetch();
  assert.deepEqual(await kernel.remoteBranches(4), ["agent/issue-4-a"]);
  assert.equal(
    await git([
      "for-each-ref",
      "--format=%(refname)",
      "refs/remotes/origin/stale",
    ]),
    "",
  );
});

test("Git errors remain visible instead of becoming missing facts", async (t) => {
  const { kernel, repoRoot } = await setup(t);
  await fs.rename(join(repoRoot, ".git"), join(repoRoot, "saved-git"));
  await assert.rejects(kernel.remoteDefaultBranch(), CommandFailedError);
  await assert.rejects(kernel.remoteBranches(4), CommandFailedError);
  await assert.rejects(kernel.fetch(), CommandFailedError);
  await assert.rejects(
    kernel.ensureWorktree({
      path: join(repoRoot, "unused"),
      branch: "agent/issue-4-error",
      base: "main",
      remoteExists: false,
    }),
    CommandFailedError,
  );
});

const branch = "agent/issue-4-worktree";

async function worktreeSetup(t: TestContext, remoteExists = false) {
  const context = await setup(t);
  const path = join(context.dir, "issue 4\nworktree");
  if (remoteExists) {
    await context.git(
      ["push", "origin", `HEAD:${branch}`],
      join(context.dir, "seed"),
    );
    await context.kernel.fetch();
  }
  const input = { path, branch, base: "main", remoteExists };
  return { ...context, path, input };
}

test("creates from origin/base, not local HEAD, and reuses a registered worktree", async (t) => {
  const { kernel, git, input, path, repoRoot } = await worktreeSetup(t);
  await git(["commit", "--allow-empty", "-m", "Local main divergence"]);
  assert.equal(await kernel.ensureWorktree(input), "created");
  assert.equal(await git(["branch", "--show-current"], path), branch);
  assert.equal(
    await git(["rev-parse", "HEAD"], path),
    await git(["rev-parse", "origin/main"]),
  );
  await fs.writeFile(join(path, "keep.txt"), "do not clean");
  assert.equal(await kernel.ensureWorktree(input), "existing");
  assert.equal(
    await fs.readFile(join(path, "keep.txt"), "utf8"),
    "do not clean",
  );
  assert.equal(await git(["branch", "--show-current"], repoRoot), "main");
});

test("creates a remote-backed branch with tracking set", async (t) => {
  const { kernel, git, input, path } = await worktreeSetup(t, true);
  assert.equal(await kernel.ensureWorktree(input), "created");
  assert.equal(
    await git(["rev-parse", "--abbrev-ref", "@{upstream}"], path),
    `origin/${branch}`,
  );
  assert.equal(
    await git(["rev-parse", "HEAD"], path),
    await git(["rev-parse", `origin/${branch}`]),
  );
});

for (const remoteExists of [false, true]) {
  test(`recreates a removed worktree preserving local commits (remoteExists=${remoteExists})`, async (t) => {
    const { kernel, git, input, path } = await worktreeSetup(t, remoteExists);
    await kernel.ensureWorktree(input);
    await git(["commit", "--allow-empty", "-m", "Unpushed work"], path);
    const commit = await git(["rev-parse", "HEAD"], path);
    await fs.rm(path, { recursive: true, force: true });
    assert.equal(await kernel.ensureWorktree(input), "created");
    assert.equal(await git(["rev-parse", "HEAD"], path), commit);
    if (remoteExists) {
      assert.equal(
        await git(["rev-parse", "--abbrev-ref", "@{upstream}"], path),
        `origin/${branch}`,
      );
    }
  });
}

test("uses a pre-existing local branch even without a registered worktree", async (t) => {
  const { kernel, git, input, path } = await worktreeSetup(t);
  await git(["commit", "--allow-empty", "-m", "Local work"]);
  await git(["branch", branch]);
  const commit = await git(["rev-parse", branch]);
  assert.equal(await kernel.ensureWorktree(input), "created");
  assert.equal(await git(["rev-parse", "HEAD"], path), commit);
});

test("replaces an empty unregistered directory", async (t) => {
  const { kernel, input, path, git } = await worktreeSetup(t);
  await fs.mkdir(path);
  assert.equal(await kernel.ensureWorktree(input), "created");
  assert.equal(await git(["branch", "--show-current"], path), branch);
});

test("rejects a nonempty unregistered directory without removing its contents", async (t) => {
  const { kernel, input, path } = await worktreeSetup(t);
  await fs.mkdir(path);
  await fs.writeFile(join(path, "keep.txt"), "valuable");
  await assert.rejects(kernel.ensureWorktree(input), (error: unknown) => {
    assert.ok(error instanceof Error);
    assert.ok(error.message.includes(path));
    return true;
  });
  assert.equal(await fs.readFile(join(path, "keep.txt"), "utf8"), "valuable");
});

test("dirty status includes untracked, staged, and modified files", async (t) => {
  const { kernel, git, input, path } = await worktreeSetup(t);
  await kernel.ensureWorktree(input);
  assert.equal(await kernel.hasUncommittedChanges(path), false);
  await fs.writeFile(join(path, "new.txt"), "new\n");
  assert.equal(await kernel.hasUncommittedChanges(path), true);
  await git(["add", "new.txt"], path);
  assert.equal(await kernel.hasUncommittedChanges(path), true);
  await git(["commit", "-m", "New file"], path);
  assert.equal(await kernel.hasUncommittedChanges(path), false);
  await fs.writeFile(join(path, "new.txt"), "modified\n");
  assert.equal(await kernel.hasUncommittedChanges(path), true);
});

test("reports no remote branch rather than treating local-only commits as pushed", async (t) => {
  const { kernel, input, path } = await worktreeSetup(t);
  await kernel.ensureWorktree(input);
  assert.equal(await kernel.unpushedCommits(path, branch), "no-remote-branch");
});

test("counts commits ahead of the named origin branch and observes pushes", async (t) => {
  const { kernel, git, input, path } = await worktreeSetup(t, true);
  await kernel.ensureWorktree(input);
  assert.equal(await kernel.unpushedCommits(path, branch), 0);
  await git(["commit", "--allow-empty", "-m", "Unpushed commit"], path);
  assert.equal(await kernel.unpushedCommits(path, branch), 1);
  await git(["push", "origin", branch], path);
  assert.equal(await kernel.unpushedCommits(path, branch), 0);
});

test("status and count failures are not mistaken for clean or missing remote", async (t) => {
  const { kernel, dir, git } = await worktreeSetup(t, true);
  await assert.rejects(kernel.hasUncommittedChanges(dir), CommandFailedError);
  await assert.rejects(kernel.unpushedCommits(dir, branch), CommandFailedError);
  // The remote ref exists, but no local branch was created: rev-list must fail.
  assert.equal(
    await git(["rev-parse", `refs/remotes/origin/${branch}`]).then(Boolean),
    true,
  );
  await assert.rejects(
    kernel.unpushedCommits(join(dir, "repo"), branch),
    CommandFailedError,
  );
});

for (const checkout of [["-b", "unrelated"], ["main"], ["--detach"]]) {
  test(`refuses registered worktree on ${checkout.join(" ")} without modifying it`, async (t) => {
    const { kernel, git, input, path } = await worktreeSetup(t);
    await kernel.ensureWorktree(input);
    if (checkout[0] === "main") await git(["checkout", "--detach"]);
    await git(["checkout", ...checkout], path);
    await fs.writeFile(join(path, "keep.txt"), "operator work");
    const head = await git(["rev-parse", "HEAD"], path);
    await assert.rejects(kernel.ensureWorktree(input), /expected branch/i);
    assert.equal(await git(["rev-parse", "HEAD"], path), head);
    assert.equal(
      await fs.readFile(join(path, "keep.txt"), "utf8"),
      "operator work",
    );
  });
}
