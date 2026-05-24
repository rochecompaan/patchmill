import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_GIT_WORKTREE_STRATEGY_CONFIG,
  buildIssueBranchName,
  buildIssueWorktreePath,
} from "./worktree-strategy.ts";

test("worktree strategy uses patchmill defaults for generic worktree naming", () => {
  assert.equal(
    buildIssueBranchName(42, "Add user tags"),
    "agent/issue-42-add-user-tags",
  );
  assert.equal(
    buildIssueWorktreePath(42, "Add user tags"),
    ".worktrees/patchmill-issue-42-add-user-tags",
  );
  assert.deepEqual(DEFAULT_GIT_WORKTREE_STRATEGY_CONFIG, {
    baseBranch: "main",
    baseRef: "HEAD",
    remote: "origin",
    branchPrefix: "agent/issue-",
    worktreeDir: ".worktrees",
    worktreePrefix: "patchmill-issue-",
    slugLength: 48,
    allowDirectLand: true,
  });
});

test("worktree strategy supports custom prefixes, worktree directories, and slug lengths", () => {
  const strategy = {
    ...DEFAULT_GIT_WORKTREE_STRATEGY_CONFIG,
    branchPrefix: "patchmill/task-",
    worktreeDir: ".patchmill/worktrees",
    worktreePrefix: "pm-task-",
    slugLength: 12,
  };

  assert.equal(
    buildIssueBranchName(7, "A custom strategy for worktrees", strategy),
    "patchmill/task-7-a-custom-str",
  );
  assert.equal(
    buildIssueWorktreePath(7, "A custom strategy for worktrees", strategy),
    ".patchmill/worktrees/pm-task-7-a-custom-str",
  );
});
