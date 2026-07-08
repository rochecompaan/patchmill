import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createStaticCommandRunner } from "../../../../test-support/command-runner.ts";
import {
  assertCleanWorktree,
  cleanupIssueWorkspace,
  assertIssueBaseContainedInPrBase,
  buildIssueBranchName,
  buildIssueWorktreePath,
  createIssueWorktree,
  detectDefaultBaseBranch,
  ensureIssueWorktree,
  pushBranch,
} from "./git.ts";
import { DEFAULT_GIT_WORKTREE_STRATEGY_CONFIG } from "../../../git/worktree-strategy.ts";

test("buildIssueBranchName creates safe issue branches", () => {
  assert.equal(
    buildIssueBranchName(42, "Add user tags"),
    "agent/issue-42-add-user-tags",
  );
});

test("buildIssueWorktreePath creates stable issue worktree paths", () => {
  assert.equal(
    buildIssueWorktreePath(42, "Add user tags"),
    ".worktrees/patchmill-issue-42-add-user-tags",
  );
});

test("buildIssueWorktreePath accepts a configured worktree directory", () => {
  assert.equal(
    buildIssueWorktreePath(42, "Add user tags", ".patchmill/worktrees"),
    ".patchmill/worktrees/patchmill-issue-42-add-user-tags",
  );
});

test("issue branch and worktree slugs truncate deterministically", () => {
  const title = "abcdefghijklmnopqrstuvwxyz abcdefghijklmnopqrstuvwxyz";

  assert.equal(
    buildIssueBranchName(42, title),
    "agent/issue-42-abcdefghijklmnopqrstuvwxyz-abcdefghijklmnopqrstu",
  );
  assert.equal(
    buildIssueWorktreePath(42, title),
    ".worktrees/patchmill-issue-42-abcdefghijklmnopqrstuvwxyz-abcdefghijklmnopqrstu",
  );
});

test("detectDefaultBaseBranch uses the configured remote HEAD", async () => {
  const runner = createStaticCommandRunner([
    { code: 0, stdout: "origin/master\n", stderr: "" },
  ]);

  const result = await detectDefaultBaseBranch(
    runner,
    "/repo",
    "origin",
    "main",
  );

  assert.deepEqual(result, {
    status: "detected",
    branch: "master",
    source: "remote-head",
  });
  assert.deepEqual(runner.calls, [
    {
      command: "git",
      args: ["symbolic-ref", "--quiet", "--short", "refs/remotes/origin/HEAD"],
      cwd: "/repo",
    },
  ]);
});

test("detectDefaultBaseBranch falls back to the current upstream on the same remote", async () => {
  const runner = createStaticCommandRunner([
    { code: 1, stdout: "", stderr: "fatal: ref not found" },
    { code: 0, stdout: "upstream/release/1.2\n", stderr: "" },
  ]);

  const result = await detectDefaultBaseBranch(
    runner,
    "/repo",
    "upstream",
    "main",
  );

  assert.deepEqual(result, {
    status: "detected",
    branch: "release/1.2",
    source: "upstream",
  });
  assert.deepEqual(runner.calls, [
    {
      command: "git",
      args: [
        "symbolic-ref",
        "--quiet",
        "--short",
        "refs/remotes/upstream/HEAD",
      ],
      cwd: "/repo",
    },
    {
      command: "git",
      args: [
        "rev-parse",
        "--abbrev-ref",
        "--symbolic-full-name",
        "@{upstream}",
      ],
      cwd: "/repo",
    },
  ]);
});

test("detectDefaultBaseBranch ignores upstreams from other remotes before fallback", async () => {
  const runner = createStaticCommandRunner([
    { code: 1, stdout: "", stderr: "fatal: ref not found" },
    { code: 0, stdout: "fork/main\n", stderr: "" },
  ]);

  const result = await detectDefaultBaseBranch(
    runner,
    "/repo",
    "origin",
    "main",
  );

  assert.deepEqual(result, {
    status: "fallback",
    branch: "main",
    reason: "remote-head-and-upstream-unavailable",
  });
});

test("assertIssueBaseContainedInPrBase accepts a base contained in the target remote ref", async () => {
  const runner = createStaticCommandRunner([
    { code: 0, stdout: "base-sha\n", stderr: "" },
    { code: 0, stdout: "target-sha\n", stderr: "" },
    { code: 0, stdout: "\n", stderr: "" },
  ]);

  await assertIssueBaseContainedInPrBase(
    runner,
    "/repo",
    "HEAD",
    "origin",
    "main",
  );

  assert.deepEqual(runner.calls, [
    {
      command: "git",
      args: ["rev-parse", "--verify", "HEAD^{commit}"],
      cwd: "/repo",
    },
    {
      command: "git",
      args: ["rev-parse", "--verify", "refs/remotes/origin/main^{commit}"],
      cwd: "/repo",
    },
    {
      command: "git",
      args: ["log", "--oneline", "refs/remotes/origin/main..HEAD"],
      cwd: "/repo",
    },
  ]);
});

test("assertIssueBaseContainedInPrBase rejects commits that are not in the target remote ref", async () => {
  const runner = createStaticCommandRunner([
    { code: 0, stdout: "base-sha\n", stderr: "" },
    { code: 0, stdout: "target-sha\n", stderr: "" },
    {
      code: 0,
      stdout:
        "abc1234 chore: initialize Patchmill\ndef5678 docs: local setup\n",
      stderr: "",
    },
  ]);

  await assert.rejects(
    () =>
      assertIssueBaseContainedInPrBase(
        runner,
        "/repo",
        "HEAD",
        "origin",
        "main",
      ),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.match(
        error.message,
        /Configured git\.baseRef HEAD is not contained in refs\/remotes\/origin\/main\./,
      );
      assert.match(error.message, /abc1234 chore: initialize Patchmill/);
      assert.match(error.message, /def5678 docs: local setup/);
      assert.match(
        error.message,
        /Push or merge these commits into origin\/main/,
      );
      assert.match(
        error.message,
        /configure git\.baseRef to a ref already contained/,
      );
      return true;
    },
  );
});

test("assertIssueBaseContainedInPrBase reports an unresolvable configured base ref", async () => {
  const runner = createStaticCommandRunner([
    {
      code: 128,
      stdout: "",
      stderr: "fatal: Needed a single revision",
    },
  ]);

  await assert.rejects(
    () =>
      assertIssueBaseContainedInPrBase(
        runner,
        "/repo",
        "not-a-ref",
        "origin",
        "main",
      ),
    /Configured git\.baseRef not-a-ref could not be resolved to a commit with exit code 128: fatal: Needed a single revision/,
  );
});

test("assertIssueBaseContainedInPrBase reports a missing target remote ref with remediation", async () => {
  const runner = createStaticCommandRunner([
    { code: 0, stdout: "base-sha\n", stderr: "" },
    {
      code: 128,
      stdout: "",
      stderr: "fatal: Needed a single revision",
    },
  ]);

  await assert.rejects(
    () =>
      assertIssueBaseContainedInPrBase(
        runner,
        "/repo",
        "HEAD",
        "origin",
        "main",
      ),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.match(
        error.message,
        /Configured PR target base refs\/remotes\/origin\/main could not be resolved to a commit/,
      );
      assert.match(error.message, /Run git fetch origin/);
      assert.match(error.message, /git\.remote/);
      assert.match(error.message, /git\.baseBranch/);
      return true;
    },
  );
});

test("assertIssueBaseContainedInPrBase uses configured remote and base branch", async () => {
  const runner = createStaticCommandRunner([
    { code: 0, stdout: "base-sha\n", stderr: "" },
    { code: 0, stdout: "target-sha\n", stderr: "" },
    { code: 0, stdout: "\n", stderr: "" },
  ]);

  await assertIssueBaseContainedInPrBase(
    runner,
    "/repo",
    "refs/remotes/upstream/release/1.2",
    "upstream",
    "release/1.2",
  );

  assert.deepEqual(
    runner.calls.map((call) => call.args),
    [
      ["rev-parse", "--verify", "refs/remotes/upstream/release/1.2^{commit}"],
      ["rev-parse", "--verify", "refs/remotes/upstream/release/1.2^{commit}"],
      [
        "log",
        "--oneline",
        "refs/remotes/upstream/release/1.2..refs/remotes/upstream/release/1.2",
      ],
    ],
  );
});

test("assertCleanWorktree checks for an empty porcelain status", async () => {
  const runner = createStaticCommandRunner([
    { code: 0, stdout: "", stderr: "" },
  ]);

  await assertCleanWorktree(runner, "/repo");

  assert.deepEqual(runner.calls, [
    {
      command: "git",
      args: ["status", "--porcelain=v1", "--untracked-files=all"],
      cwd: "/repo",
    },
  ]);
});

test("assertCleanWorktree rejects dirty repositories", async () => {
  const runner = createStaticCommandRunner([
    { code: 0, stdout: " M src/cli/commands/run-once/git.ts\n", stderr: "" },
  ]);

  await assert.rejects(
    () => assertCleanWorktree(runner, "/repo"),
    /Repository worktree is not clean/,
  );
});

test("assertCleanWorktree ignores configured run-state logs", async () => {
  const runner = createStaticCommandRunner([
    {
      code: 0,
      stdout: [
        "?? .patchmill/runs/run-2026-05-10T04-19-08-934Z.jsonl",
        "?? .patchmill/runs/issue-45/run-2026-05-10T04-19-08-934Z.jsonl",
        "?? .patchmill/triage-runs/run-2026-05-10T04-19-08-934Z.jsonl",
        "",
      ].join("\n"),
      stderr: "",
    },
  ]);

  await assertCleanWorktree(runner, "/repo", [
    ".patchmill/runs/",
    ".patchmill/triage-runs/",
  ]);
});

test("assertCleanWorktree ignores configured todo roots", async () => {
  const runner = createStaticCommandRunner([
    {
      code: 0,
      stdout: [
        "?? .pi/todos/issue-45-task-01-date-range-model.md",
        "?? .patchmill/todos/work-45-step-01-date-range-model.md",
        "",
      ].join("\n"),
      stderr: "",
    },
  ]);

  await assertCleanWorktree(runner, "/repo", [".pi/todos", ".patchmill/todos"]);
});

test("assertCleanWorktree rejects git status failures with exit code and command output", async () => {
  const runner = createStaticCommandRunner([
    {
      code: 7,
      stdout: "index refresh failed",
      stderr: "fatal: bad index file",
    },
  ]);

  await assert.rejects(
    () => assertCleanWorktree(runner, "/repo"),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.match(error.message, /git status failed with exit code 7/);
      assert.match(error.message, /fatal: bad index file/);
      assert.match(error.message, /index refresh failed/);
      return true;
    },
  );

  assert.deepEqual(runner.calls, [
    {
      command: "git",
      args: ["status", "--porcelain=v1", "--untracked-files=all"],
      cwd: "/repo",
    },
  ]);
});

test("createIssueWorktree creates a dedicated branch and worktree", async () => {
  const runner = createStaticCommandRunner([
    { code: 0, stdout: "", stderr: "" },
  ]);

  const created = await createIssueWorktree(
    runner,
    "/repo",
    42,
    "Add user tags",
  );

  assert.deepEqual(created, {
    branch: "agent/issue-42-add-user-tags",
    worktreePath: ".worktrees/patchmill-issue-42-add-user-tags",
  });
  assert.deepEqual(runner.calls, [
    {
      command: "git",
      args: [
        "worktree",
        "add",
        "-b",
        "agent/issue-42-add-user-tags",
        ".worktrees/patchmill-issue-42-add-user-tags",
        "HEAD",
      ],
      cwd: "/repo",
    },
  ]);
});

test("createIssueWorktree accepts a configured worktree strategy", async () => {
  const runner = createStaticCommandRunner([
    { code: 0, stdout: "", stderr: "" },
  ]);

  const created = await createIssueWorktree(
    runner,
    "/repo",
    42,
    "Add user tags",
    {
      ...DEFAULT_GIT_WORKTREE_STRATEGY_CONFIG,
      baseRef: "refs/remotes/upstream/release/1.2",
      branchPrefix: "patchmill/issue-",
      worktreeDir: ".patchmill/worktrees",
      worktreePrefix: "pm-issue-",
    },
  );

  assert.deepEqual(created, {
    branch: "patchmill/issue-42-add-user-tags",
    worktreePath: ".patchmill/worktrees/pm-issue-42-add-user-tags",
  });
  assert.deepEqual(runner.calls, [
    {
      command: "git",
      args: [
        "worktree",
        "add",
        "-b",
        "patchmill/issue-42-add-user-tags",
        ".patchmill/worktrees/pm-issue-42-add-user-tags",
        "refs/remotes/upstream/release/1.2",
      ],
      cwd: "/repo",
    },
  ]);
});

test("createIssueWorktree rejects git worktree failures with exit code and command output", async () => {
  const runner = createStaticCommandRunner([
    {
      code: 3,
      stdout: "worktree add output",
      stderr: "fatal: branch already exists",
    },
  ]);

  await assert.rejects(
    () => createIssueWorktree(runner, "/repo", 42, "Add user tags"),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.match(
        error.message,
        /git worktree add failed for issue #42 with exit code 3/,
      );
      assert.match(error.message, /fatal: branch already exists/);
      assert.match(error.message, /worktree add output/);
      return true;
    },
  );

  assert.deepEqual(runner.calls, [
    {
      command: "git",
      args: [
        "worktree",
        "add",
        "-b",
        "agent/issue-42-add-user-tags",
        ".worktrees/patchmill-issue-42-add-user-tags",
        "HEAD",
      ],
      cwd: "/repo",
    },
  ]);
});

test("ensureIssueWorktree reuses an existing worktree for the expected branch", async () => {
  const runner = createStaticCommandRunner([
    {
      code: 0,
      stdout: [
        "worktree /repo/.worktrees/patchmill-issue-45-resume-feature",
        "HEAD abcdef1234567890",
        "branch refs/heads/agent/issue-45-resume-feature",
        "",
      ].join("\n"),
      stderr: "",
    },
    { code: 0, stdout: "agent/issue-45-resume-feature\n", stderr: "" },
    { code: 0, stdout: "", stderr: "" },
    { code: 0, stdout: "abc123 existing work\n", stderr: "" },
  ]);

  const result = await ensureIssueWorktree(
    runner,
    "/repo",
    45,
    "Resume feature",
  );

  assert.deepEqual(result, {
    branch: "agent/issue-45-resume-feature",
    worktreePath: ".worktrees/patchmill-issue-45-resume-feature",
    created: false,
    hasExistingCommits: true,
    existingCommits: ["abc123 existing work"],
  });
  assert.deepEqual(
    runner.calls.map((call) => call.args.slice(0, 3)),
    [
      ["worktree", "list", "--porcelain"],
      ["-C", ".worktrees/patchmill-issue-45-resume-feature", "branch"],
      ["status", "--porcelain=v1", "--untracked-files=all"],
      ["log", "--oneline", "HEAD..agent/issue-45-resume-feature"],
    ],
  );
});

test("ensureIssueWorktree uses the configured base ref when reading existing commits", async () => {
  const runner = createStaticCommandRunner([
    {
      code: 0,
      stdout: [
        "worktree /repo/.patchmill/worktrees/pm-issue-45-resume-feature",
        "HEAD abcdef1234567890",
        "branch refs/heads/patchmill/issue-45-resume-feature",
        "",
      ].join("\n"),
      stderr: "",
    },
    { code: 0, stdout: "patchmill/issue-45-resume-feature\n", stderr: "" },
    { code: 0, stdout: "", stderr: "" },
    { code: 0, stdout: "abc123 existing work\n", stderr: "" },
  ]);

  const result = await ensureIssueWorktree(
    runner,
    "/repo",
    45,
    "Resume feature",
    {
      ...DEFAULT_GIT_WORKTREE_STRATEGY_CONFIG,
      baseRef: "refs/remotes/upstream/release/1.2",
      branchPrefix: "patchmill/issue-",
      worktreeDir: ".patchmill/worktrees",
      worktreePrefix: "pm-issue-",
    },
  );

  assert.deepEqual(result, {
    branch: "patchmill/issue-45-resume-feature",
    worktreePath: ".patchmill/worktrees/pm-issue-45-resume-feature",
    created: false,
    hasExistingCommits: true,
    existingCommits: ["abc123 existing work"],
  });
  assert.deepEqual(
    runner.calls.map((call) => call.args.slice(0, 3)),
    [
      ["worktree", "list", "--porcelain"],
      ["-C", ".patchmill/worktrees/pm-issue-45-resume-feature", "branch"],
      ["status", "--porcelain=v1", "--untracked-files=all"],
      [
        "log",
        "--oneline",
        "refs/remotes/upstream/release/1.2..patchmill/issue-45-resume-feature",
      ],
    ],
  );
});

test("ensureIssueWorktree ignores configured todo roots when reusing an existing worktree", async () => {
  const runner = createStaticCommandRunner([
    {
      code: 0,
      stdout: [
        "worktree /repo/.worktrees/patchmill-issue-45-resume-feature",
        "HEAD abcdef1234567890",
        "branch refs/heads/agent/issue-45-resume-feature",
        "",
      ].join("\n"),
      stderr: "",
    },
    { code: 0, stdout: "agent/issue-45-resume-feature\n", stderr: "" },
    {
      code: 0,
      stdout: "?? .patchmill/todos/work-45-step-01-date-range-model.md\n",
      stderr: "",
    },
    { code: 0, stdout: "", stderr: "" },
  ]);

  const result = await ensureIssueWorktree(
    runner,
    "/repo",
    45,
    "Resume feature",
    undefined,
    undefined,
    [".patchmill/todos"],
  );

  assert.deepEqual(result, {
    branch: "agent/issue-45-resume-feature",
    worktreePath: ".worktrees/patchmill-issue-45-resume-feature",
    created: false,
    hasExistingCommits: false,
    existingCommits: [],
  });
  assert.deepEqual(runner.calls, [
    {
      command: "git",
      args: ["worktree", "list", "--porcelain"],
      cwd: "/repo",
    },
    {
      command: "git",
      args: [
        "-C",
        ".worktrees/patchmill-issue-45-resume-feature",
        "branch",
        "--show-current",
      ],
      cwd: "/repo",
    },
    {
      command: "git",
      args: ["status", "--porcelain=v1", "--untracked-files=all"],
      cwd: "/repo/.worktrees/patchmill-issue-45-resume-feature",
    },
    {
      command: "git",
      args: ["log", "--oneline", "HEAD..agent/issue-45-resume-feature"],
      cwd: "/repo",
    },
  ]);
});

test("ensureIssueWorktree recreates a missing worktree from an existing branch", async () => {
  const runner = createStaticCommandRunner([
    {
      code: 0,
      stdout:
        "worktree /repo/.worktrees/patchmill-issue-145-resume-feature\nHEAD abcdef1234567890\n",
      stderr: "",
    },
    { code: 0, stdout: "", stderr: "" },
    { code: 0, stdout: "", stderr: "" },
    { code: 0, stdout: "", stderr: "" },
  ]);

  const result = await ensureIssueWorktree(
    runner,
    "/repo",
    45,
    "Resume feature",
  );

  assert.equal(result.created, true);
  assert.deepEqual(runner.calls[2]?.args, [
    "worktree",
    "add",
    ".worktrees/patchmill-issue-45-resume-feature",
    "agent/issue-45-resume-feature",
  ]);
});

test("ensureIssueWorktree ignores porcelain entries for similar absolute paths", async () => {
  const runner = createStaticCommandRunner([
    {
      code: 0,
      stdout: [
        "worktree /tmp/repo/.worktrees/patchmill-issue-45-resume-feature",
        "HEAD abcdef1234567890",
        "branch refs/heads/agent/issue-45-resume-feature",
        "worktree /repo/.worktrees/patchmill-issue-45-resume-feature-copy",
        "HEAD 1234567890abcdef",
        "branch refs/heads/agent/issue-45-resume-feature-copy",
        "",
      ].join("\n"),
      stderr: "",
    },
    { code: 0, stdout: "", stderr: "" },
    { code: 0, stdout: "", stderr: "" },
    { code: 0, stdout: "abc123 existing work\n", stderr: "" },
  ]);

  const result = await ensureIssueWorktree(
    runner,
    "/repo",
    45,
    "Resume feature",
  );

  assert.equal(result.created, true);
  assert.deepEqual(
    runner.calls.map((call) => call.args),
    [
      ["worktree", "list", "--porcelain"],
      [
        "show-ref",
        "--verify",
        "--quiet",
        "refs/heads/agent/issue-45-resume-feature",
      ],
      [
        "worktree",
        "add",
        ".worktrees/patchmill-issue-45-resume-feature",
        "agent/issue-45-resume-feature",
      ],
      ["log", "--oneline", "HEAD..agent/issue-45-resume-feature"],
    ],
  );
});

test("ensureIssueWorktree stops when the deterministic path exists outside git worktree registration", async () => {
  const repoRoot = await mkdtemp(join(tmpdir(), "patchmill-agent-issue-"));
  await mkdir(join(repoRoot, ".worktrees/patchmill-issue-45-resume-feature"), {
    recursive: true,
  });
  const runner = createStaticCommandRunner([
    { code: 0, stdout: "", stderr: "" },
  ]);

  await assert.rejects(
    () => ensureIssueWorktree(runner, repoRoot, 45, "Resume feature"),
    /Existing path \.worktrees\/patchmill-issue-45-resume-feature is not a registered git worktree/,
  );

  assert.deepEqual(
    runner.calls.map((call) => call.args),
    [["worktree", "list", "--porcelain"]],
  );
});

test("pushBranch sets the upstream on the configured remote", async () => {
  const runner = createStaticCommandRunner([
    { code: 0, stdout: "", stderr: "" },
  ]);

  await pushBranch(runner, "/repo", "agent/issue-42-add-user-tags", "upstream");

  assert.deepEqual(runner.calls, [
    {
      command: "git",
      args: [
        "push",
        "--set-upstream",
        "upstream",
        "agent/issue-42-add-user-tags",
      ],
      cwd: "/repo",
    },
  ]);
});

test("pushBranch rejects git push failures with exit code and command output", async () => {
  const runner = createStaticCommandRunner([
    {
      code: 5,
      stdout: "push rejected",
      stderr: "fatal: remote hung up unexpectedly",
    },
  ]);

  await assert.rejects(
    () => pushBranch(runner, "/repo", "agent/issue-42-add-user-tags"),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.match(
        error.message,
        /git push failed for agent\/issue-42-add-user-tags with exit code 5/,
      );
      assert.match(error.message, /fatal: remote hung up unexpectedly/);
      assert.match(error.message, /push rejected/);
      return true;
    },
  );

  assert.deepEqual(runner.calls, [
    {
      command: "git",
      args: [
        "push",
        "--set-upstream",
        "origin",
        "agent/issue-42-add-user-tags",
      ],
      cwd: "/repo",
    },
  ]);
});

test("git helpers include exit code and fallback output when commands fail silently", async () => {
  await assert.rejects(
    () =>
      assertCleanWorktree(
        createStaticCommandRunner([{ code: 11, stdout: "", stderr: "" }]),
        "/repo",
      ),
    /git status failed with exit code 11: \(no output\)/,
  );
  await assert.rejects(
    () =>
      createIssueWorktree(
        createStaticCommandRunner([{ code: 12, stdout: "", stderr: "" }]),
        "/repo",
        42,
        "Add user tags",
      ),
    /git worktree add failed for issue #42 with exit code 12: \(no output\)/,
  );
  await assert.rejects(
    () =>
      pushBranch(
        createStaticCommandRunner([{ code: 13, stdout: "", stderr: "" }]),
        "/repo",
        "agent/issue-42-add-user-tags",
      ),
    /git push failed for agent\/issue-42-add-user-tags with exit code 13: \(no output\)/,
  );
});

test("cleanupIssueWorkspace removes the local worktree then local branch", async () => {
  const runner = createStaticCommandRunner([
    { code: 0, stdout: "", stderr: "" },
    { code: 0, stdout: "", stderr: "" },
  ]);

  const results = await cleanupIssueWorkspace(runner, "/repo", {
    branch: "agent/issue-42-add-user-tags",
    worktreePath: ".worktrees/patchmill-issue-42-add-user-tags",
  });

  assert.deepEqual(
    results.map((result) => result.status),
    ["cleaned", "cleaned"],
  );
  assert.deepEqual(runner.calls, [
    {
      command: "git",
      args: [
        "worktree",
        "remove",
        ".worktrees/patchmill-issue-42-add-user-tags",
      ],
      cwd: "/repo",
    },
    {
      command: "git",
      args: ["branch", "-D", "agent/issue-42-add-user-tags"],
      cwd: "/repo",
    },
  ]);
  assert.equal(
    runner.calls.some((call) => call.args.includes("push")),
    false,
  );
  assert.equal(
    runner.calls.some((call) => call.args.includes("--delete")),
    false,
  );
});

test("cleanupIssueWorkspace skips local branch deletion when worktree removal fails", async () => {
  const runner = createStaticCommandRunner([
    { code: 128, stdout: "", stderr: "fatal: worktree is dirty" },
  ]);

  const results = await cleanupIssueWorkspace(runner, "/repo", {
    branch: "agent/issue-42-add-user-tags",
    worktreePath: ".worktrees/patchmill-issue-42-add-user-tags",
  });

  assert.deepEqual(
    results.map((result) => result.status),
    ["failed"],
  );
  assert.match(results[0]?.message ?? "", /git worktree remove failed/);
  assert.equal(results[0]?.stdout, "");
  assert.equal(results[0]?.stderr, "fatal: worktree is dirty");
  assert.deepEqual(
    runner.calls.map((call) => call.args),
    [["worktree", "remove", ".worktrees/patchmill-issue-42-add-user-tags"]],
  );
});

test("cleanupIssueWorkspace reports branch deletion failures without throwing", async () => {
  const runner = createStaticCommandRunner([
    { code: 0, stdout: "", stderr: "" },
    { code: 1, stdout: "", stderr: "error: branch not found" },
  ]);

  const results = await cleanupIssueWorkspace(runner, "/repo", {
    branch: "agent/issue-42-add-user-tags",
    worktreePath: ".worktrees/patchmill-issue-42-add-user-tags",
  });

  assert.deepEqual(
    results.map((result) => result.status),
    ["cleaned", "failed"],
  );
  assert.equal(results[1]?.step, "branch");
  assert.match(results[1]?.message ?? "", /git branch -D failed/);
});
