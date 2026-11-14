import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { dirname, join } from "node:path";
import test from "node:test";
import { setupCleanup } from "../../test-support/merged-cleanup-fixture.ts";
import { cleanupMergedIssue } from "./merged-cleanup.ts";
import { acquireLock } from "./lock.ts";
import type { CommandRunner } from "../process/command.ts";

for (const mode of [
  "open",
  "closed-unmerged",
  "wrong target",
  "wrong repository",
  "wrong head",
  "non-closing",
  "open issue",
  "open replacement",
  "planning",
] as const) {
  test(`merge authorization refuses ${mode}`, async (t) => {
    const c = await setupCleanup(t);
    if (mode === "planning") await c.planning();
    await c.mutate((state) => {
      const pr = state.pullRequests[0]!;
      if (mode === "open") pr.state = "open";
      if (mode === "closed-unmerged") pr.state = "closed";
      if (mode === "wrong target") pr.baseBranch = "release";
      if (mode === "wrong repository") pr.headRepository = "attacker/repo";
      if (mode === "wrong head") pr.headBranch = "other";
      if (mode === "non-closing") pr.body = "Closes another/repo#9";
      if (mode === "open issue") state.issues[0]!.state = "open";
      if (mode === "open replacement")
        state.pullRequests.push({ ...pr, number: 2, state: "open" });
    });
    assert.equal(
      (
        await c.cleanup(
          {},
          mode === "planning" ? "agent/issue-9--spec" : undefined,
        )
      ).status,
      "skipped",
    );
    await fs.access(c.worktree);
    assert.equal(await c.localBranch(), true);
    await assert.rejects(fs.access(c.counter));
    await assert.rejects(fs.access(join(c.issueDir, "cleanup.json")));
  });
}

for (const mode of ["wrong branch", "elsewhere", "primary alias"] as const) {
  test(`unsafe worktree registration preserves targets: ${mode}`, async (t) => {
    const c = await setupCleanup(t);
    if (mode === "wrong branch")
      await c.git(["checkout", "-b", "unrelated"], c.worktree);
    if (mode === "elsewhere")
      await c.git([
        "worktree",
        "move",
        c.worktree,
        join(c.dir, "other-checkout"),
      ]);
    if (mode === "primary alias") {
      await c.git(["worktree", "remove", c.worktree]);
      await fs.symlink(c.repoRoot, c.worktree, "dir");
    }
    assert.equal((await c.cleanup()).status, "kept");
    assert.equal(await c.localBranch(), true);
    await assert.rejects(fs.access(c.counter));
    assert.match(c.output.join("\n"), /cleanup.*failed/i);
  });
}

test("cleanup preserves a worktree containing the process cwd", async (t) => {
  const c = await setupCleanup(t);
  const cwd = process.cwd();
  try {
    process.chdir(c.worktree);
    assert.equal((await c.cleanup()).status, "kept");
  } finally {
    process.chdir(cwd);
  }
  await fs.access(c.worktree);
  await assert.rejects(fs.access(c.counter));
});

for (const symlink of [false, true]) {
  test(`cleanup never removes its lock parent (symlink=${symlink})`, async (t) => {
    const c = await setupCleanup(t);
    const runs = join(c.worktree, "local-runs");
    await fs.mkdir(runs);
    const alias = join(c.dir, "runs-alias");
    if (symlink) await fs.symlink(runs, alias, "dir");
    c.config.paths.runsDir = symlink ? alias : runs;
    const lockPath = join(c.config.paths.runsDir, "issue-9/lock");
    const lock = await acquireLock(lockPath);
    const before = await fs.stat(lockPath);
    const parentBefore = await fs.stat(dirname(lockPath));
    try {
      assert.equal(
        (
          await cleanupMergedIssue({
            ...c.services,
            issue: 9,
            branch: "agent/issue-9-add-login",
            lock,
          })
        ).status,
        "kept",
      );
    } finally {
      await lock.release();
    }
    const after = await fs.stat(lockPath);
    const parentAfter = await fs.stat(dirname(lockPath));
    assert.deepEqual(
      [after.dev, after.ino, parentAfter.dev, parentAfter.ino],
      [before.dev, before.ino, parentBefore.dev, parentBefore.ino],
    );
    await fs.access(c.worktree);
    await assert.rejects(fs.access(c.counter));
  });
}

test("a changed registration after the hook stops removal", async (t) => {
  const c = await setupCleanup(t);
  const runner: CommandRunner = async (command, args, options) => {
    const result = await c.deps.runner(command, args, options);
    if (command === "bash")
      await c.git(["checkout", "-b", "different"], c.worktree);
    return result;
  };
  assert.equal((await c.cleanup({ runner })).status, "kept");
  await fs.access(c.worktree);
  assert.equal(await c.localBranch(), true);
  assert.equal(await fs.readFile(c.counter, "utf8"), "hook ran\n");
});

for (const timing of ["before hook", "after hook"] as const) {
  test(`cleanup preserves an ignored nested registered checkout: ${timing}`, async (t) => {
    const c = await setupCleanup(t);
    const child = join(c.worktree, "ignored-child");
    const ignore = join(c.dir, "nested-ignore");
    await fs.writeFile(ignore, "ignored-child/\n");
    await c.git(["config", "core.excludesFile", ignore]);
    const createChild = async () => {
      await c.git(["worktree", "add", "-b", "operator-nested", child]);
      await fs.writeFile(join(child, "uncommitted.txt"), "must survive");
      assert.equal(await c.git(["status", "--porcelain"], c.worktree), "");
    };
    if (timing === "before hook") await createChild();
    const mutations: string[][] = [];
    const runner: CommandRunner = async (command, args, options) => {
      if (args[1] === "remove" || args[0] === "branch") mutations.push(args);
      const result = await c.deps.runner(command, args, options);
      if (command === "bash" && timing === "after hook") await createChild();
      return result;
    };
    assert.equal((await c.cleanup({ runner })).status, "kept");
    assert.equal(
      await fs.readFile(join(child, "uncommitted.txt"), "utf8"),
      "must survive",
    );
    assert.equal(await c.localBranch(), true);
    assert.equal(await c.localBranch("operator-nested"), true);
    assert.deepEqual(mutations, []);
    assert.equal(
      c.output.some((message) => message.includes(child)),
      true,
    );
    if (timing === "before hook") await assert.rejects(fs.access(c.counter));
    else assert.equal(await fs.readFile(c.counter, "utf8"), "hook ran\n");
  });
}

test("base branch resolution honors an explicit non-default base", async (t) => {
  const c = await setupCleanup(t, false);
  c.config.git.baseBranch = "release";
  await c.mutate((state) => {
    state.pullRequests[0]!.baseBranch = "release";
  });
  assert.equal((await c.cleanup()).status, "cleaned");
});
