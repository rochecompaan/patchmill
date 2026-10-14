import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  utimes,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { PlanningPublicationGit } from "./planning-publication-git.ts";

const git = (cwd: string, ...args: string[]) =>
  execFileSync("git", args, { cwd, encoding: "utf8" }).trim();

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "publication-preservation-"));
  const repo = join(root, "repo");
  const workspace = join(root, "workspace");
  execFileSync("git", ["init", "-b", "main", repo]);
  git(repo, "config", "user.name", "Patchmill Test");
  git(repo, "config", "user.email", "patchmill@example.test");
  await writeFile(
    join(repo, ".gitignore"),
    ".pi/todos/\nignored-cache/\nnode_modules/\ndocs/plans/*.log\n",
  );
  await writeFile(join(repo, "tracked.txt"), "base\n");
  git(repo, "add", ".");
  git(repo, "commit", "-m", "base");
  const baseOid = git(repo, "rev-parse", "HEAD");
  git(repo, "worktree", "add", "-b", "planning/plan", workspace, "HEAD");
  const artifactPath = "docs/plans/2026-10-11-issue-307-original.md";
  await mkdir(join(workspace, "docs/plans"), { recursive: true });
  await writeFile(join(workspace, artifactPath), "# Original plan\n");
  git(workspace, "add", artifactPath);
  git(workspace, "commit", "-m", "plan");
  const headOid = git(workspace, "rev-parse", "HEAD");
  await mkdir(join(workspace, ".pi/todos/issue-307"), { recursive: true });
  await mkdir(join(workspace, "ignored-cache"));
  await mkdir(join(workspace, "node_modules"));
  const sentinels = [
    ".pi/todos/issue-307/task.md",
    "ignored-cache/cache.bin",
    "node_modules/cache.bin",
    "docs/plans/agent.log",
  ];
  for (const path of sentinels)
    await writeFile(join(workspace, path), Buffer.from([0, 1, 255, 10]));
  const indexPath = git(
    workspace,
    "rev-parse",
    "--path-format=absolute",
    "--git-path",
    "index",
  );
  const calls: string[][] = [];
  const publication = new PlanningPublicationGit({
    repoRoot: repo,
    runner: {
      async run(command, args, options) {
        calls.push(args);
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
            status: number;
            stdout: string;
            stderr: string;
          };
          return {
            code: failure.status,
            stdout: failure.stdout,
            stderr: failure.stderr,
          };
        }
      },
    },
  });
  return {
    root,
    repo,
    workspace,
    artifactPath,
    artifacts: [
      {
        kind: "plan" as const,
        path: artifactPath,
        commitOid: headOid,
        source: "workspace" as const,
      },
    ],
    baseOid,
    headOid,
    sentinels,
    indexPath,
    calls,
    publication,
  };
}

test("verifies committed artifacts with ignored content without writing", async () => {
  const f = await fixture();
  try {
    const artifact = await readFile(join(f.workspace, f.artifactPath));
    for (const collapsed of [false, true]) {
      if (collapsed)
        await writeFile(join(f.repo, ".git/info/exclude"), ".pi/\n");
      assert.equal(
        git(f.workspace, "--no-optional-locks", "status", "--porcelain=v1"),
        "",
      );
      const ignoredStatus = git(
        f.workspace,
        "--no-optional-locks",
        "status",
        "--porcelain=v1",
        "-z",
        "--ignored=matching",
      );
      assert.match(
        ignoredStatus,
        collapsed ? /!! \.pi\/\0/u : /!! \.pi\/todos\/\0/u,
      );
      // Make tracked stat information stale, without changing its bytes.
      const tracked = join(f.workspace, f.artifactPath);
      const beforeStat = await stat(tracked);
      await utimes(
        tracked,
        beforeStat.atime,
        new Date(beforeStat.mtimeMs + 2000),
      );
      const index = await readFile(f.indexPath);
      for (let repeat = 0; repeat < 2; repeat++) {
        await f.publication.verifyArtifactCommit({
          workspacePath: f.workspace,
          previousHeadOid: f.baseOid,
          headOid: f.headOid,
          artifactPath: f.artifactPath,
          artifactKind: "plan",
        });
        await f.publication.verifyWorkspace({
          workspacePath: f.workspace,
          baseOid: f.baseOid,
          headOid: f.headOid,
          artifacts: f.artifacts,
        });
      }
      assert.deepEqual(await readFile(f.indexPath), index);
      assert.deepEqual(await readFile(tracked), artifact);
    }
    for (const path of f.sentinels)
      assert.deepEqual(
        await readFile(join(f.workspace, path)),
        Buffer.from([0, 1, 255, 10]),
      );
    assert.equal(git(f.workspace, "rev-parse", "HEAD"), f.headOid);
    assert.ok(
      f.calls
        .filter((args) => args.includes("status"))
        .every((args) => args[0] === "--no-optional-locks"),
    );
    assert.ok(
      f.calls.every(
        (args) =>
          !args.some((arg) =>
            /^(reset|clean|checkout|update-index|add|commit|push)$/u.test(arg),
          ),
      ),
    );
  } finally {
    await rm(f.root, { recursive: true, force: true });
  }
});

for (const condition of [
  "tracked artifact",
  "tracked unrelated file",
  "staged file",
  "staged artifact",
  "force-added ignored file",
  "untracked file",
] as const) {
  test(`publication refuses ordinary dirty status: ${condition}`, async () => {
    const f = await fixture();
    try {
      const path =
        condition === "tracked artifact" || condition === "staged artifact"
          ? f.artifactPath
          : condition === "tracked unrelated file"
            ? "tracked.txt"
            : condition === "force-added ignored file"
              ? "ignored-cache/cache.bin"
              : "new.txt";
      await writeFile(join(f.workspace, path), "dirty\n");
      if (condition === "staged file" || condition === "staged artifact")
        git(f.workspace, "add", path);
      if (condition === "force-added ignored file")
        git(f.workspace, "add", "-f", path);
      const index = await readFile(f.indexPath);
      await assert.rejects(
        () =>
          f.publication.verifyArtifactCommit({
            workspacePath: f.workspace,
            previousHeadOid: f.baseOid,
            headOid: f.headOid,
            artifactPath: f.artifactPath,
            artifactKind: "plan",
          }),
        /dirty-workspace/u,
      );
      await assert.rejects(
        () =>
          f.publication.verifyWorkspace({
            workspacePath: f.workspace,
            baseOid: f.baseOid,
            headOid: f.headOid,
            artifacts: f.artifacts,
          }),
        /dirty-workspace/u,
      );
      assert.deepEqual(await readFile(f.indexPath), index);
      assert.equal(await readFile(join(f.workspace, path), "utf8"), "dirty\n");
    } finally {
      await rm(f.root, { recursive: true, force: true });
    }
  });
}

test("rejects committed force-added ignored content in the artifact delta", async () => {
  const f = await fixture();
  try {
    git(f.workspace, "add", "-f", f.sentinels[0]!);
    git(f.workspace, "commit", "-m", "force-add ignored content");
    const headOid = git(f.workspace, "rev-parse", "HEAD");
    await assert.rejects(
      () =>
        f.publication.verifyArtifactCommit({
          workspacePath: f.workspace,
          previousHeadOid: f.baseOid,
          headOid,
          artifactPath: f.artifactPath,
          artifactKind: "plan",
        }),
      /diff\/unexpected-changes/u,
    );
    // Aggregate workspace scope rejects committed ignored content too.
    await assert.rejects(
      f.publication.verifyWorkspace({
        workspacePath: f.workspace,
        baseOid: f.baseOid,
        headOid,
        artifacts: f.artifacts,
      }),
      /diff\/unexpected-changes/u,
    );
  } finally {
    await rm(f.root, { recursive: true, force: true });
  }
});
