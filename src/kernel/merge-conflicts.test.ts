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
import type { Facts } from "./facts.ts";
import { createKernelGit, type MergeConflict } from "./git.ts";
import { conflictResolutionGaps } from "./merge-conflicts.ts";

/** Branch `b` and `main` both add `a.txt` with different text. */
async function conflictRepo(t: TestContext) {
  const f = await createGitFixture();
  t.after(() => fs.rm(f.dir, { recursive: true, force: true }));
  const runner: CommandRunner = (command, args, options) =>
    runCommand(command, args, { ...options, env: f.env });
  const seed = join(f.dir, "seed");
  const git = async (args: string[], cwd = seed) => {
    const result = await runner("git", args, { cwd });
    if (result.code !== 0 && !(args[0] === "merge" && result.code === 1))
      throw new CommandFailedError("git", args, result);
    return result.stdout.trim();
  };
  const commit = async (files: Record<string, string>, message: string) => {
    for (const [path, text] of Object.entries(files))
      await fs.writeFile(join(seed, path), text);
    await git(["add", "-A"]);
    await git(["commit", "-m", message]);
  };
  await git(["checkout", "-b", "b"]);
  await commit({ "a.txt": "branch\n" }, "branch");
  await git(["checkout", "main"]);
  await commit({ "a.txt": "main\n" }, "main");
  await git(["push", "origin", "main", "b"]);
  const kernel = createKernelGit(runner, f.repoRoot);
  await kernel.fetch();
  const before = (await kernel.mergeConflict("origin/main", "origin/b"))!;
  assert.deepEqual(before.files, ["a.txt"]);
  return { ...f, git, commit, kernel, before };
}

const factsFor = (fields: Partial<Facts> & Pick<Facts, "branch">): Facts => ({
  stage: "implementation",
  remoteBranchExists: true,
  worktree: "/worktree",
  baseBranch: "main",
  expectedSpecPath: "s.md",
  expectedPlanPath: "p.md",
  ...fields,
});

async function after(c: Awaited<ReturnType<typeof conflictRepo>>) {
  await c.kernel.fetch();
  const conflict = await c.kernel.mergeConflict("origin/main", "origin/b");
  return factsFor({
    branch: "b",
    ...(conflict ? { mergeConflict: conflict } : {}),
  });
}

const short = (sha: string) => sha.slice(0, 7);

test("a merge of base that resolves the conflict has no gaps", async (t) => {
  const c = await conflictRepo(t);
  await c.git(["checkout", "b"]);
  await c.git(["merge", "main"]);
  await c.commit({ "a.txt": "both\n" }, "Merge main");
  await c.git(["push", "origin", "b"]);
  assert.deepEqual(
    await conflictResolutionGaps(c.kernel, c.before, await after(c)),
    [],
  );
});

test("history rewrite is a gap", async (t) => {
  const c = await conflictRepo(t);
  await c.git(["checkout", "-B", "b", "main"]);
  await c.commit({ "a.txt": "rewritten\n" }, "Rewrite");
  await c.git(["push", "--force", "origin", "b"]);
  assert.deepEqual(
    await conflictResolutionGaps(c.kernel, c.before, await after(c)),
    [
      `The pushed branch does not contain its previous head ${short(c.before.headSha)}; its history was rewritten.`,
    ],
  );
});

test("a push without base is a gap", async (t) => {
  const c = await conflictRepo(t);
  await c.git(["checkout", "b"]);
  await c.commit({ "other.txt": "x\n" }, "Other");
  await c.git(["push", "origin", "b"]);
  assert.deepEqual(
    await conflictResolutionGaps(c.kernel, c.before, await after(c)),
    [
      "The pull request still conflicts with origin/main in: a.txt.",
      `The pushed branch does not contain origin/main at ${short(c.before.baseSha)}; merge the base branch.`,
    ],
  );
});

test("a remaining conflict is a gap", async (t) => {
  const c = await conflictRepo(t);
  const gaps = await conflictResolutionGaps(
    c.kernel,
    c.before,
    factsFor({ branch: "b", mergeConflict: c.before }),
  );
  assert.equal(
    gaps[0],
    "The pull request still conflicts with origin/main in: a.txt.",
  );
});

test("a moved base is worded as a new conflict", async (t) => {
  const c = await conflictRepo(t);
  const moved: MergeConflict = {
    ...c.before,
    baseSha: "f".repeat(40),
    files: ["a.txt", "b.txt"],
  };
  const gaps = await conflictResolutionGaps(
    c.kernel,
    c.before,
    factsFor({ branch: "b", mergeConflict: moved }),
  );
  assert.equal(
    gaps[0],
    "The pull request conflicts with origin/main again at fffffff in: a.txt, b.txt; the base moved during the session.",
  );
});

test("a deleted remote branch skips the ancestry checks", async (t) => {
  const c = await conflictRepo(t);
  assert.deepEqual(
    await conflictResolutionGaps(
      c.kernel,
      c.before,
      factsFor({ branch: "gone", remoteBranchExists: false }),
    ),
    [],
  );
});
