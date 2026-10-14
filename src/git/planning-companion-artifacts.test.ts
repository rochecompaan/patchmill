import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import type { CommandRunner } from "../command/types.ts";
import { readPlanningArtifactEvidence } from "./planning-companion-artifacts.ts";
import { PlanningPublicationGit } from "./planning-publication-git.ts";
import { PlanningWorkspaceGit } from "./planning-workspace-git.ts";

const spec = "docs/specs/example.md";
const mockup = "docs/mockups/example.html";
const declaration = (path = mockup) =>
  `# Spec\n\n## Companion artifacts\n\n- \`${path}\`: [Mockup](../mockups/${path.split("/").at(-1)})\n`;
const git = (cwd: string, ...args: string[]) =>
  execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
const runner: CommandRunner = {
  async run(command, args, options) {
    try {
      return {
        code: 0,
        stdout: execFileSync(command, args, {
          cwd: options?.cwd,
          encoding: "utf8",
          stdio: ["ignore", "pipe", "pipe"],
        }),
        stderr: "",
      };
    } catch (error) {
      const e = error as { status: number; stdout: string; stderr: string };
      return { code: e.status, stdout: e.stdout, stderr: e.stderr };
    }
  },
};
async function fixture(t: test.TestContext) {
  const root = await mkdtemp(join(tmpdir(), "planning-companions-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const repo = join(root, "repo");
  execFileSync("git", ["init", "-b", "main", repo], { stdio: "ignore" });
  git(repo, "config", "user.name", "Test");
  git(repo, "config", "user.email", "test@example.test");
  const write = async (path: string, body: string) => {
    await mkdir(dirname(join(repo, path)), { recursive: true });
    await writeFile(join(repo, path), body);
  };
  const commit = () => {
    git(repo, "add", ".");
    git(repo, "commit", "-m", "fixture");
    return git(repo, "rev-parse", "HEAD");
  };
  await write("README.md", "base");
  const base = commit();
  const publication = new PlanningPublicationGit({ runner, repoRoot: repo });
  const inspect = (commitOid: string) =>
    readPlanningArtifactEvidence({
      runner,
      repoRoot: repo,
      kind: "spec",
      path: spec,
      commitOid,
      source: "workspace",
    });
  return { root, repo, write, commit, base, publication, inspect };
}

test("verifies a spec plus declared mockup commit and whole workspace scope", async (t) => {
  const f = await fixture(t);
  await f.write(spec, declaration());
  await f.write(mockup, "<!doctype html>");
  const head = f.commit();
  const evidence = await f.publication.verifyArtifactCommit({
    workspacePath: f.repo,
    previousHeadOid: f.base,
    headOid: head,
    artifactKind: "spec",
    artifactPath: spec,
  });
  assert.deepEqual(evidence, {
    kind: "spec",
    path: spec,
    commitOid: head,
    source: "workspace",
    companionPaths: [mockup],
  });
  await f.write("docs/plans/example.md", "# Plan");
  const planHead = f.commit();
  const artifacts = [
    evidence,
    {
      kind: "plan" as const,
      path: "docs/plans/example.md",
      commitOid: planHead,
      source: "workspace" as const,
    },
  ];
  await f.publication.verifyWorkspace({
    workspacePath: f.repo,
    baseOid: f.base,
    headOid: planHead,
    artifacts,
  });
  await f.write("src/extra.ts", "production");
  const badHead = f.commit();
  await assert.rejects(
    f.publication.verifyWorkspace({
      workspacePath: f.repo,
      baseOid: f.base,
      headOid: badHead,
      artifacts,
    }),
    /unexpected-changes/u,
  );
});

test("does not authorize companions from local content", async (t) => {
  const f = await fixture(t);
  await f.write(spec, "# Spec");
  await f.write(mockup, "undeclared");
  const head = f.commit();
  await f.write(spec, declaration());
  assert.equal((await f.inspect(head)).companionPaths, undefined);
  await assert.rejects(
    f.publication.verifyArtifactCommit({
      workspacePath: f.repo,
      previousHeadOid: f.base,
      headOid: head,
      artifactKind: "spec",
      artifactPath: spec,
    }),
    /unexpected-changes/u,
  );
  await f.write(spec, declaration());
  git(f.repo, "add", spec);
  git(f.repo, "rm", "--cached", mockup);
  git(f.repo, "commit", "-m", "declare untracked companion");
  await assert.rejects(
    f.inspect(git(f.repo, "rev-parse", "HEAD")),
    /non-regular-file/u,
  );
});

test("rejects missing or non-regular companions", async (t) => {
  for (const kind of ["missing", "symlink", "directory", "submodule"]) {
    const f = await fixture(t);
    await f.write(spec, declaration());
    await mkdir(dirname(join(f.repo, mockup)), { recursive: true });
    if (kind === "symlink")
      await symlink("../../README.md", join(f.repo, mockup));
    if (kind === "directory") await f.write(`${mockup}/child`, "child");
    git(f.repo, "add", ".");
    if (kind === "submodule")
      git(
        f.repo,
        "update-index",
        "--add",
        "--cacheinfo",
        `160000,${f.base},${mockup}`,
      );
    git(f.repo, "commit", "-m", kind);
    await assert.rejects(
      f.inspect(git(f.repo, "rev-parse", "HEAD")),
      /non-regular-file/u,
      kind,
    );
  }
});

test("preserves single-document creation and rejects undeclared files", async (t) => {
  for (const kind of ["spec", "plan"] as const) {
    const f = await fixture(t);
    const path = `docs/${kind}s/example.md`;
    await f.write(path, declaration());
    await f.write(mockup, "mockup");
    const head = f.commit();
    if (kind === "plan")
      await assert.rejects(
        f.publication.verifyArtifactCommit({
          workspacePath: f.repo,
          previousHeadOid: f.base,
          headOid: head,
          artifactKind: kind,
          artifactPath: path,
        }),
        /unexpected-changes/u,
      );
    else {
      await f.write("docs/mockups/undeclared.html", "extra");
      const extra = f.commit();
      await assert.rejects(
        f.publication.verifyArtifactCommit({
          workspacePath: f.repo,
          previousHeadOid: f.base,
          headOid: extra,
          artifactKind: kind,
          artifactPath: path,
        }),
        /unexpected-changes/u,
      );
    }
  }
  const f = await fixture(t);
  await f.write(spec, "# Spec");
  const head = f.commit();
  assert.deepEqual(
    (
      await f.publication.verifyArtifactCommit({
        workspacePath: f.repo,
        previousHeadOid: f.base,
        headOid: head,
        artifactKind: "spec",
        artifactPath: spec,
      })
    ).companionPaths,
    undefined,
  );
});

test("adopts revised companions and only permits retirement by deletion", async (t) => {
  for (const revision of [
    "add",
    "remove",
    "edit-retired",
    "unsafe",
    "missing",
  ]) {
    const f = await fixture(t);
    await f.write(spec, declaration());
    await f.write(mockup, "original");
    const recorded = f.commit();
    const old = await f.inspect(recorded);
    const remote = join(f.root, "remote.git");
    execFileSync("git", ["init", "--bare", remote], { stdio: "ignore" });
    git(f.repo, "remote", "add", "origin", remote);
    if (revision === "add") {
      await f.write(spec, declaration("docs/mockups/new.html"));
      await f.write("docs/mockups/new.html", "new");
    }
    if (revision === "remove" || revision === "edit-retired") {
      await f.write(spec, "# No companion");
      if (revision === "remove") await rm(join(f.repo, mockup));
      else await f.write(mockup, "unauthorized edit");
    }
    if (revision === "unsafe")
      await f.write(spec, declaration("src/unsafe.html"));
    if (revision === "missing")
      await f.write(spec, declaration("docs/mockups/missing.html"));
    const candidate = f.commit();
    git(f.repo, "push", "origin", "main");
    const workspaces = new PlanningWorkspaceGit({
      runner,
      repoRoot: f.repo,
      worktreeRoot: join(f.root, "worktrees"),
    });
    const workspace = {
      runId: "123e4567-e89b-42d3-a456-426614174000",
      phase: "spec" as const,
      identity: { branch: "main", worktreePath: "../worktrees/spec" },
      remote: "origin",
      baseBranch: "main",
      baseOid: f.base,
      headOid: recorded,
      cleanup: { state: "removed" as const, pushedHeadOid: recorded },
    };
    const result = await workspaces.adoptPlanningHead({
      issueNumber: 210,
      runId: workspace.runId,
      phase: "spec",
      workspace,
      hostHeadOid: candidate,
      artifacts: [old],
    });
    if (revision === "add" || revision === "remove") {
      assert.equal(result.kind, "adopted");
      if (result.kind === "adopted")
        assert.deepEqual(
          result.artifacts[0]?.companionPaths,
          revision === "add" ? ["docs/mockups/new.html"] : undefined,
        );
    } else assert.equal(result.kind, "blocked");
    assert.equal(workspace.headOid, recorded);
    assert.deepEqual(old.companionPaths, [mockup]);
    assert.equal(git(f.repo, "rev-parse", "HEAD"), candidate);
  }
});
