import assert from "node:assert/strict";
import test from "node:test";
import { PlanningRemoteBaseGit } from "./planning-remote-base.ts";
import type { CommandRunner } from "../process/command.ts";
const oid = "a".repeat(40);
test("fetches a pinned remote ref and discovers regular issue artifacts", async () => {
  const calls: unknown[] = [];
  const runner: CommandRunner = {
    run: async (command, args, options) => {
      calls.push({ command, args, cwd: options?.cwd });
      if (args[0] === "rev-parse")
        return { code: 0, stdout: `${oid}\n`, stderr: "" };
      if (args[0] === "ls-tree")
        return {
          code: 0,
          stdout:
            `100644 blob ${oid}\tdocs/specs/a-issue-187-x.md\0` +
            `120000 blob ${oid}\tdocs/plans/link-issue-187-x.md\0` +
            `100755 blob ${oid}\tdocs/plans/b-issue-187-x.md\0`,
          stderr: "",
        };
      return { code: 0, stdout: "", stderr: "" };
    },
  };
  const git = new PlanningRemoteBaseGit({
    runner,
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
