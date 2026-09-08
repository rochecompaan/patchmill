import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  PlanningPublicationGit,
  PlanningPublicationGitError,
} from "./planning-publication-git.ts";

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}

function commandRunner(calls: string[][]) {
  return {
    async run(command: string, args: string[], options?: { cwd?: string }) {
      calls.push([command, ...args]);
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
}

test("publishes linked-worktree objects by full OID and proves real Git safety boundaries", async () => {
  const root = await mkdtemp(join(tmpdir(), "planning-publication-real-"));
  const remote = join(root, "remote.git");
  const repo = join(root, "repo");
  const workspace = join(root, "workspace");
  const calls: string[][] = [];
  try {
    execFileSync("git", ["init", "--bare", "--initial-branch=main", remote]);
    execFileSync("git", ["init", "-b", "main", repo]);
    git(repo, "config", "user.name", "Patchmill Test");
    git(repo, "config", "user.email", "patchmill@example.test");
    await writeFile(join(repo, "README.md"), "base\n");
    git(repo, "add", "README.md");
    git(repo, "commit", "-m", "base");
    const baseOid = git(repo, "rev-parse", "HEAD");
    git(repo, "remote", "add", "origin", remote);
    git(repo, "push", "origin", "main");
    git(repo, "worktree", "add", "-b", "planning/spec", workspace, "HEAD");
    await mkdir(join(workspace, "docs/specs"), { recursive: true });
    await writeFile(join(workspace, "docs/specs/issue-188.md"), "artifact A\n");
    git(workspace, "add", "docs/specs/issue-188.md");
    git(workspace, "commit", "-m", "planning artifact");
    const planningOid = git(workspace, "rev-parse", "HEAD");
    const publication = new PlanningPublicationGit({
      repoRoot: repo,
      runner: commandRunner(calls),
    });

    assert.deepEqual(
      await publication.ensureRemoteHead({
        remote: "origin",
        branch: "planning/spec",
        headOid: planningOid,
      }),
      { pushed: true, headOid: planningOid },
    );
    assert.equal(
      git(repo, "ls-remote", "origin", "refs/heads/planning/spec").split(
        "\t",
      )[0],
      planningOid,
    );
    assert.deepEqual(
      await publication.ensureRemoteHead({
        remote: "origin",
        branch: "planning/spec",
        headOid: planningOid,
      }),
      { pushed: false, headOid: planningOid },
    );

    await publication.assertAncestor({
      ancestorOid: baseOid,
      descendantOid: planningOid,
    });
    await publication.assertRegularFiles({
      commitOid: planningOid,
      paths: ["docs/specs/issue-188.md"],
    });
    await writeFile(join(repo, "unrelated.md"), "unrelated\n");
    git(repo, "add", "unrelated.md");
    git(repo, "commit", "-m", "unrelated");
    const unrelatedOid = git(repo, "rev-parse", "HEAD");
    await assert.rejects(
      () =>
        publication.assertAncestor({
          ancestorOid: unrelatedOid,
          descendantOid: planningOid,
        }),
      /not-ancestor/,
    );

    git(repo, "push", "origin", "main");
    git(remote, "update-ref", "refs/heads/planning/spec", unrelatedOid);
    await assert.rejects(
      () =>
        publication.ensureRemoteHead({
          remote: "origin",
          branch: "planning/spec",
          headOid: planningOid,
        }),
      /conflicting-head/,
    );
    assert.equal(
      git(repo, "ls-remote", "origin", "refs/heads/planning/spec").split(
        "\t",
      )[0],
      unrelatedOid,
    );

    await symlink("issue-188.md", join(workspace, "docs/specs/symlink.md"));
    git(workspace, "add", "docs/specs/symlink.md");
    git(workspace, "commit", "-m", "symlink artifact");
    await assert.rejects(
      () =>
        publication.assertRegularFiles({
          commitOid: git(workspace, "rev-parse", "HEAD"),
          paths: ["docs/specs/symlink.md"],
        }),
      (error: unknown) =>
        error instanceof PlanningPublicationGitError &&
        error.reason === "non-regular-file",
    );

    git(
      workspace,
      "update-index",
      "--add",
      "--cacheinfo",
      `160000,${baseOid},docs/specs/gitlink.md`,
    );
    git(workspace, "commit", "-m", "gitlink artifact");
    await assert.rejects(
      () =>
        publication.assertRegularFiles({
          commitOid: git(workspace, "rev-parse", "HEAD"),
          paths: ["docs/specs/gitlink.md"],
        }),
      /non-regular-file/,
    );

    await writeFile(join(workspace, "docs/specs/issue-188.md"), "dirty\n");
    await assert.rejects(
      () =>
        publication.verifyWorkspace({
          workspacePath: workspace,
          baseOid,
          headOid: git(workspace, "rev-parse", "HEAD"),
          artifactPaths: ["docs/specs/issue-188.md"],
        }),
      /dirty-workspace/,
    );
    git(workspace, "checkout", "--", "docs/specs/issue-188.md");
    await writeFile(join(workspace, ".gitignore"), "ignored-residue\n");
    git(workspace, "add", ".gitignore");
    git(workspace, "commit", "-m", "ignore residue");
    await writeFile(join(workspace, "ignored-residue"), "ignored\n");
    await assert.rejects(
      () =>
        publication.verifyWorkspace({
          workspacePath: workspace,
          baseOid,
          headOid: git(workspace, "rev-parse", "HEAD"),
          artifactPaths: ["docs/specs/issue-188.md"],
        }),
      /dirty-workspace/,
    );

    const pushCalls = calls.filter((call) => call[1] === "push");
    assert.equal(pushCalls.length, 1);
    assert.ok(pushCalls.every((call) => call.includes("--no-force")));
    assert.ok(
      calls.every(
        (call) =>
          !call.some((argument) =>
            /^(--force|-f|reset|clean|merge|rebase|branch)$/u.test(argument),
          ),
      ),
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
