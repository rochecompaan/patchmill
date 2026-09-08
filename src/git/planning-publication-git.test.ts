import assert from "node:assert/strict";
import test from "node:test";
import {
  PlanningPublicationGit,
  PlanningPublicationGitError,
} from "./planning-publication-git.ts";

test("accepts an owned workspace outside the repository root", async () => {
  const git = new PlanningPublicationGit({
    repoRoot: "/repo",
    runner: {
      async run() {
        return { code: 0, stdout: "", stderr: "" };
      },
    },
  });
  await assert.rejects(
    () =>
      git.verifyWorkspace({
        workspacePath: "/other-worktrees/spec",
        baseOid: "a".repeat(40),
        headOid: "a".repeat(40),
        artifactPaths: ["docs/specs/a.md"],
      }),
    (error: unknown) =>
      error instanceof PlanningPublicationGitError &&
      error.reason === "head-mismatch",
  );
});
test("recovers an already-pushed exact phase head without a push", async () => {
  const calls: string[][] = [];
  const git = new PlanningPublicationGit({
    repoRoot: "/repo",
    runner: {
      async run(_command, args) {
        calls.push(args);
        return {
          code: 0,
          stdout: `${"a".repeat(40)}\trefs/heads/planning/spec\n`,
          stderr: "",
        };
      },
    },
  });
  const result = await git.ensureRemoteHead({
    remote: "origin",
    branch: "planning/spec",
    headOid: "a".repeat(40),
  });
  assert.deepEqual(result, { pushed: false, headOid: "a".repeat(40) });
  assert.deepEqual(calls, [
    [
      "ls-remote",
      "--exit-code",
      "--heads",
      "--",
      "origin",
      "refs/heads/planning/spec",
    ],
  ]);
});
test("blocks a conflicting remote head before push", async () => {
  const git = new PlanningPublicationGit({
    repoRoot: "/repo",
    runner: {
      async run() {
        return {
          code: 0,
          stdout: `${"b".repeat(40)}\trefs/heads/planning/spec\n`,
          stderr: "",
        };
      },
    },
  });
  await assert.rejects(
    () =>
      git.ensureRemoteHead({
        remote: "origin",
        branch: "planning/spec",
        headOid: "a".repeat(40),
      }),
    (error: unknown) =>
      error instanceof PlanningPublicationGitError &&
      error.reason === "conflicting-head",
  );
});
test("rejects a non-regular committed artifact", async () => {
  const git = new PlanningPublicationGit({
    repoRoot: "/repo",
    runner: {
      async run() {
        return {
          code: 0,
          stdout: `120000 blob ${"a".repeat(40)}\tdocs/specs/a.md\0`,
          stderr: "",
        };
      },
    },
  });
  await assert.rejects(
    () =>
      git.assertRegularFiles({
        commitOid: "a".repeat(40),
        paths: ["docs/specs/a.md"],
      }),
    /non-regular-file/,
  );
});
