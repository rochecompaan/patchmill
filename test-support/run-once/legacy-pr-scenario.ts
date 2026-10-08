import assert from "node:assert/strict";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { createCommandRunner } from "../../src/cli/commands/triage/command.ts";
import type { CommandRunner } from "../../src/command/types.ts";
import { runOneIssue } from "../../src/cli/commands/run-once/pipeline.ts";
import {
  buildIssueBranchName,
  buildIssueWorktreePath,
} from "../../src/cli/commands/run-once/git.ts";
import {
  readRunState,
  runStatePath,
} from "../../src/cli/commands/run-once/run-state.ts";
import { writeFixtureRunState } from "./run-state-fixture.ts";
import { makeConfig } from "./pipeline-fixtures.ts";
import { issue, labelListPayload } from "./issue-fixtures.ts";

/** Real Git and local host receipts; no agents or live host operations. */
export async function createLegacyPrScenario(
  input: {
    oldCompletion?: boolean;
    removedWorkspace?: boolean;
    marker?: boolean;
  } = {},
) {
  const config = await makeConfig({
    dryRun: false,
    execute: true,
    issueNumber: 226,
    host: { provider: "github-gh", login: "" },
    cleanupHook: "cleanup.sh",
  });
  const baseRunner = createCommandRunner();
  const git = async (cwd: string, ...args: string[]) => {
    const result = await baseRunner.run("git", args, { cwd });
    assert.equal(result.code, 0, result.stderr);
    return result.stdout.trim();
  };
  const root = config.repoRoot,
    remote = join(root, "remote.git");
  await git(root, "init", "-q", "-b", "main");
  await git(root, "config", "user.name", "Test");
  await git(root, "config", "user.email", "test@example.test");
  await writeFile(
    join(root, ".gitignore"),
    ".worktrees/\n.patchmill/\nremote.git/\n",
  );
  await git(root, "add", ".gitignore");
  await git(root, "commit", "-m", "base");
  const baseOid = await git(root, "rev-parse", "HEAD");
  await git(root, "clone", "--bare", root, remote);
  await git(root, "remote", "add", "origin", remote);
  const selected = issue(
    226,
    input.oldCompletion ? ["agent-done"] : ["in-progress"],
    "Legacy PR",
  );
  const branch = buildIssueBranchName(226, selected.title, config);
  const worktreePath = buildIssueWorktreePath(226, selected.title, {
    ...config,
    worktreeDir: ".worktrees",
  });
  const workspace = resolve(root, worktreePath);
  await git(root, "worktree", "add", "-b", branch, workspace, baseOid);
  await mkdir(join(workspace, "docs", "plans"), { recursive: true });
  const planPath = "docs/plans/issue-226-legacy.md";
  await writeFile(join(workspace, planPath), "# Plan\n");
  await git(workspace, "add", planPath);
  await git(workspace, "commit", "-m", "implementation");
  const headOid = await git(workspace, "rev-parse", "HEAD");
  await git(workspace, "push", "origin", `HEAD:${branch}`);
  const repository = {
    provider: "github-gh" as const,
    host: "github.test",
    owner: "acme",
    repository: "repo",
  };
  const prUrl = "https://github.test/acme/repo/pull/17";
  let status: "open" | "merged" | "closed-unmerged" = "open",
    mergeOid: string | undefined;
  let interrupt: "worktree-remove" | "branch-remove" | undefined;
  let failHook = false;
  const effects: string[] = [];
  const runner: CommandRunner = {
    supportsOwnedGit: true,
    async run(command, args, options = {}) {
      if (command === "git") {
        const mapped = args.map((value) =>
          value === "https://github.test/acme/repo.git" ? remote : value,
        );
        const result = await baseRunner.run(command, mapped, options);
        if (args[0] === "remote" && args[1] === "get-url")
          return { ...result, stdout: "https://github.test/acme/repo.git\n" };
        const point =
          args[0] === "worktree" && args[1] === "remove"
            ? "worktree-remove"
            : args[0] === "update-ref" && args[1] === "-d"
              ? "branch-remove"
              : undefined;
        if (point) {
          effects.push(point);
          if (interrupt === point) {
            interrupt = undefined;
            throw new Error(`crash after ${point}`);
          }
        }
        return result;
      }
      if (command === "bash") {
        effects.push("hook");
        return {
          code: failHook ? 1 : 0,
          stdout: "",
          stderr: failHook ? "hook failure" : "",
        };
      }
      if (command !== "gh")
        throw new Error(`Unexpected agent or command: ${command}`);
      const ok = (value: unknown) => ({
        code: 0,
        stdout: typeof value === "string" ? value : JSON.stringify(value),
        stderr: "",
      });
      if (args[0] === "api" && args[1] === "graphql")
        return ok({
          data: {
            repository: {
              nameWithOwner: "acme/repo",
              pullRequest: { number: 17 },
            },
          },
        });
      if (args[0] === "repo" && args[1] === "view")
        return ok({
          nameWithOwner: "acme/repo",
          url: "https://github.test/acme/repo",
        });
      if (args[0] === "pr" && args[1] === "view")
        return ok({
          number: 17,
          url: prUrl,
          state:
            status === "merged"
              ? "MERGED"
              : status === "open"
                ? "OPEN"
                : "CLOSED",
          mergeCommit: mergeOid ? { oid: mergeOid } : null,
          baseRefName: "main",
          headRefName: branch,
          headRefOid: headOid,
          headRepository: { nameWithOwner: "acme/repo" },
          body: `Closes #226${input.marker === false ? "" : "\n<!-- patchmill:planning-pr-v1 issue=226 phase=implementation -->"}`,
        });
      if (args[0] === "issue" && args[1] === "view")
        return ok({
          ...selected,
          author: { login: selected.author },
          labels: selected.labels.map((name) => ({ name })),
          updatedAt: selected.updated,
        });
      if (args[0] === "label" && args[1] === "list")
        return { code: 0, stdout: labelListPayload(), stderr: "" };
      if (args[0] === "issue" && args[1] === "comment") {
        effects.push("comment");
        return ok("");
      }
      if (args[0] === "issue" && args[1] === "edit") {
        effects.push("labels");
        for (let i = 0; i < args.length; i++) {
          if (args[i] === "--remove-label")
            selected.labels = selected.labels.filter(
              (name) => !args[i + 1]!.split(",").includes(name),
            );
          if (args[i] === "--add-label")
            selected.labels.push(...args[i + 1]!.split(","));
        }
        return ok("");
      }
      throw new Error(`Unexpected host mutation: gh ${args.join(" ")}`);
    },
  };
  await writeFixtureRunState(config.runStateDir, {
    issueNumber: 226,
    title: selected.title,
    status: input.oldCompletion ? "finished" : "implementing",
    branch,
    worktreePath,
    planPath,
    implementationStatus: "pr-created",
    prUrl,
    commits: [headOid],
    validation: ["npm test passed"],
    checkpoints: {
      implementationCompleted: true,
      ...(input.oldCompletion
        ? { doneLabelEnsured: true, doneLabelApplied: true }
        : {}),
    },
    ...(!input.oldCompletion
      ? {
          implementationPr: {
            reference: { targetRepository: repository, number: 17 },
            url: prUrl,
            publication: {
              targetRepository: repository,
              headRepository: repository,
              baseBranch: "main",
              headBranch: branch,
              headOid,
            },
            ownershipMarkerRequired: true,
          },
        }
      : {}),
  });
  if (input.removedWorkspace) {
    await git(root, "worktree", "remove", workspace);
    await git(root, "update-ref", "-d", `refs/heads/${branch}`, headOid);
  }
  return {
    config,
    root,
    remote,
    branch,
    workspace,
    selected,
    effects,
    runner,
    run: () => runOneIssue(runner, config),
    state: () => readRunState(config.runStateDir, 226),
    raw: () => readFile(runStatePath(config.runStateDir, 226), "utf8"),
    cleanup: () => rm(root, { recursive: true, force: true }),
    setHookFailure: (value: boolean) => {
      failHook = value;
    },
    interruptAfter: (point: typeof interrupt) => {
      interrupt = point;
    },
    closeUnmerged: () => {
      status = "closed-unmerged";
      selected.state = "closed";
    },
    merge: async () => {
      const current = await git(remote, "rev-parse", "refs/heads/main");
      const tree = await git(
        remote,
        "merge-tree",
        "--write-tree",
        current,
        headOid,
      );
      mergeOid = await git(
        remote,
        "-c",
        "user.name=Host",
        "-c",
        "user.email=host@example.test",
        "commit-tree",
        tree,
        "-p",
        current,
        "-p",
        headOid,
        "-m",
        "Merge PR",
      );
      await git(remote, "update-ref", "refs/heads/main", mergeOid, current);
      status = "merged";
      selected.state = "closed";
    },
    git: (...args: string[]) => git(root, ...args),
  };
}
