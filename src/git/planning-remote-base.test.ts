import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { CommandRunner } from "../process/command.ts";
import { PlanningRemoteBaseGit } from "./planning-remote-base.ts";
const oid = "a".repeat(40);
function runner(tree: string): CommandRunner {
  return {
    run: async (_command, args) =>
      args[0] === "rev-parse"
        ? { code: 0, stdout: `${oid}\n`, stderr: "" }
        : args[0] === "ls-tree"
          ? { code: 0, stdout: tree, stderr: "" }
          : { code: 0, stdout: "", stderr: "" },
  };
}
test("fetches a pinned remote ref and discovers regular issue artifacts", async () => {
  const calls: unknown[] = [];
  const recording: CommandRunner = {
    run: async (command, args, options) => {
      calls.push({ command, args, cwd: options?.cwd });
      return runner(
        `100644 blob ${oid}\tdocs/specs/a-issue-187-x.md\0` +
          `120000 blob ${oid}\tdocs/plans/link-issue-187-x.md\0` +
          `100755 blob ${oid}\tdocs/plans/b-issue-187-x.md\0`,
      ).run(command, args, options);
    },
  };
  const git = new PlanningRemoteBaseGit({
    runner: recording,
    repoRoot: "/repo",
    specsDir: "docs/specs",
    plansDir: "docs/plans",
  });
  const snapshot = await git.fetch({
    issueNumber: 187,
    remote: "origin",
    baseBranch: "main",
  });
  assert.equal(snapshot.baseOid, oid);
  assert.deepEqual(snapshot.artifactCandidates, {
    spec: ["docs/specs/a-issue-187-x.md"],
    plan: ["docs/plans/b-issue-187-x.md"],
  });
  assert.deepEqual(calls, [
    {
      command: "git",
      args: [
        "fetch",
        "--no-tags",
        "--",
        "origin",
        "+refs/heads/main:refs/remotes/origin/main",
      ],
      cwd: "/repo",
    },
    {
      command: "git",
      args: ["rev-parse", "--verify", "refs/remotes/origin/main^{commit}"],
      cwd: "/repo",
    },
    {
      command: "git",
      args: [
        "ls-tree",
        "-r",
        "-z",
        "--full-tree",
        oid,
        "--",
        "docs/specs",
        "docs/plans",
      ],
      cwd: "/repo",
    },
  ]);
});
test("fetch reads multiple candidates from a newly advanced remote tree", async () => {
  const root = await mkdtemp(join(tmpdir(), "planning-remote-base-"));
  const remote = join(root, "remote.git");
  const seed = join(root, "seed");
  const stale = join(root, "stale");
  const git = (cwd: string, ...args: string[]) =>
    execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
  const realRunner: CommandRunner = {
    run: async (command, args, options) => {
      try {
        return {
          code: 0,
          stdout: execFileSync(command, args, {
            cwd: options?.cwd,
            encoding: "utf8",
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
    await writeFile(join(seed, "README.md"), "old\n");
    git(seed, "add", ".");
    git(seed, "commit", "-m", "old base");
    git(seed, "remote", "add", "origin", remote);
    git(seed, "push", "-u", "origin", "main");
    execFileSync("git", ["clone", remote, stale]);
    const staleOid = git(stale, "rev-parse", "HEAD");

    await mkdir(join(seed, "docs/specs"), { recursive: true });
    await mkdir(join(seed, "docs/plans"), { recursive: true });
    await writeFile(join(seed, "docs/specs/a-issue-187-one.md"), "a\n");
    await writeFile(join(seed, "docs/specs/b-issue-187-two.md"), "b\n");
    await writeFile(join(seed, "docs/plans/c-issue-187-plan.md"), "c\n");
    await writeFile(join(seed, "docs/plans/other-issue-999-plan.md"), "x\n");
    git(seed, "add", ".");
    git(seed, "commit", "-m", "new planning artifacts");
    git(seed, "push", "origin", "main");
    const remoteOid = git(seed, "rev-parse", "HEAD");
    await writeFile(join(stale, "README.md"), "working tree differs\n");

    const adapter = new PlanningRemoteBaseGit({
      runner: realRunner,
      repoRoot: stale,
      specsDir: "docs/specs",
      plansDir: "docs/plans",
    });
    const snapshot = await adapter.fetch({
      issueNumber: 187,
      remote: "origin",
      baseBranch: "main",
    });
    assert.equal(snapshot.baseOid, remoteOid);
    assert.notEqual(snapshot.baseOid, staleOid);
    assert.deepEqual(snapshot.artifactCandidates, {
      spec: ["docs/specs/a-issue-187-one.md", "docs/specs/b-issue-187-two.md"],
      plan: ["docs/plans/c-issue-187-plan.md"],
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("rejects invalid remote inputs before invoking Git", async () => {
  const calls: string[][] = [];
  const adapter = new PlanningRemoteBaseGit({
    runner: {
      run: async (_command, args) => {
        calls.push(args);
        return { code: 0, stdout: "", stderr: "" };
      },
    },
    repoRoot: "/repo",
    specsDir: "docs/specs",
    plansDir: "docs/plans",
  });
  for (const input of [
    { issueNumber: 0, remote: "origin", baseBranch: "main" },
    { issueNumber: 187, remote: "origin\nother", baseBranch: "main" },
    { issueNumber: 187, remote: "origin", baseBranch: "bad branch" },
    { issueNumber: 187, remote: "origin", baseBranch: `x${"a".repeat(1024)}` },
    { issueNumber: 187, remote: "origin", baseBranch: "bad\u0001branch" },
  ]) {
    await assert.rejects(adapter.fetch(input), /Invalid planning remote-base/);
  }
  assert.deepEqual(calls, []);
});

test("rejects invalid tree mode and type pairings", async () => {
  for (const record of [
    `100644 commit ${oid}\tdocs/specs/a-issue-187.md\0`,
    `100755 commit ${oid}\tdocs/specs/a-issue-187.md\0`,
    `120000 commit ${oid}\tdocs/specs/a-issue-187.md\0`,
    `160000 blob ${oid}\tdocs/specs/a-issue-187.md\0`,
  ]) {
    const adapter = new PlanningRemoteBaseGit({
      runner: runner(record),
      repoRoot: "/repo",
      specsDir: "docs/specs",
      plansDir: "docs/plans",
    });
    await assert.rejects(
      adapter.fetch({ issueNumber: 187, remote: "origin", baseBranch: "main" }),
      /invalid-mode-type/,
    );
  }
});

test("rejects malformed symlink entries and duplicate tree paths", async () => {
  const malformed = new PlanningRemoteBaseGit({
    runner: runner(`120000 blob not-an-oid\tdocs/specs/link-issue-187.md\0`),
    repoRoot: "/repo",
    specsDir: "docs/specs",
    plansDir: "docs/plans",
  });
  await assert.rejects(
    malformed.fetch({ issueNumber: 187, remote: "origin", baseBranch: "main" }),
    /malformed-record/,
  );
  const duplicate = new PlanningRemoteBaseGit({
    runner: runner(
      `100644 blob ${oid}\tdocs/specs/a-issue-187.md\0` +
        `100644 blob ${oid}\tdocs/specs/a-issue-187.md\0`,
    ),
    repoRoot: "/repo",
    specsDir: "docs/specs",
    plansDir: "docs/plans",
  });
  await assert.rejects(
    duplicate.fetch({ issueNumber: 187, remote: "origin", baseBranch: "main" }),
    /duplicate-entry/,
  );
});
