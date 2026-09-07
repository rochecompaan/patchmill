import assert from "node:assert/strict";
import test from "node:test";
import { PlanningRemoteBaseGit } from "./planning-remote-base.ts";
import type { CommandRunner } from "../process/command.ts";
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
