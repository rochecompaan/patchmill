import test from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import {
  cleanStatusIgnoredPaths,
  configuredPathRelativeToRepo,
  configuredWorktreeDir,
  configuredWorktreeStrategy,
  expectedIssueWorkspace,
  mirrorConfiguredPathInWorktree,
} from "./pipeline-workspace.ts";
import { makeConfig } from "../../../../test-support/run-once/pipeline-fixtures.ts";

test("configured worktree helpers mirror paths inside issue worktrees", async () => {
  const config = await makeConfig();
  assert.equal(configuredWorktreeDir(config), ".worktrees");
  assert.equal(
    configuredPathRelativeToRepo(config.repoRoot, config.specsDir),
    "docs/specs",
  );
  assert.equal(
    mirrorConfiguredPathInWorktree(config.repoRoot, "/tmp/wt", config.plansDir),
    join("/tmp/wt", "docs/plans"),
  );
});

test("configuredWorktreeStrategy and expectedIssueWorkspace use configured names", async () => {
  const config = await makeConfig({ worktreePrefix: "wt-", slugLength: 12 });
  const strategy = configuredWorktreeStrategy(config);
  const workspace = expectedIssueWorkspace(12, "Hello World", strategy);
  assert.equal(strategy.worktreePrefix, "wt-");
  assert.match(workspace.branch, /^agent\/issue-12-/);
  assert.match(workspace.worktreePath, /^\.worktrees\/wt-12-/);
});

test("cleanStatusIgnoredPaths includes configured runtime paths", async () => {
  const config = await makeConfig();
  assert.ok(
    cleanStatusIgnoredPaths(config, { logPath: ".patchmill/run.jsonl" }).some(
      (path) => path.includes(".patchmill/run.jsonl"),
    ),
  );
});
