import assert from "node:assert/strict";
import { dirname, join } from "node:path";
import type { TestContext } from "node:test";
import {
  cleanupMergedIssue,
  type CleanupServices,
} from "../src/kernel/merged-cleanup.ts";
import { acquireLock } from "../src/kernel/lock.ts";
import { planningBranchName, worktreeDirName } from "../src/kernel/names.ts";
import {
  branch,
  implement,
  mergePullRequest,
  plan,
  setupRun,
  spec,
} from "./run-once-fixture.ts";

export async function setupCleanup(t: TestContext, hook = true) {
  const c = await setupRun(t, [implement]);
  const counter = join(c.dir, "hook-counter");
  const hookPath = "./scripts/cleanup hook.sh";
  await c.seed({
    [spec]: "spec",
    [plan]: "plan",
    "scripts/cleanup hook.sh": `pwd\nprintf 'hook ran\\n' >> ${JSON.stringify(counter)}\n`,
  });
  if (hook) c.config.cleanupHook = hookPath;
  assert.equal((await c.run({ issue: 9 })).status, "completed");
  await mergePullRequest(c, branch, { closeIssue: true });
  const issueDir = dirname(c.lockPath);
  const services: CleanupServices = {
    ...c.deps,
    config: c.config,
    report: (message) => c.output.push(message),
  };
  const cleanup = async (
    overrides: Partial<CleanupServices> = {},
    selectedBranch = branch,
  ) => {
    const lock = await acquireLock(c.lockPath);
    try {
      return await cleanupMergedIssue({
        ...services,
        ...overrides,
        issue: 9,
        branch: selectedBranch,
        lock,
      });
    } finally {
      await lock.release();
    }
  };
  const planning = async (slug = "") => {
    const workspaces = (["spec", "plan"] as const).map((stage) => {
      const branch = planningBranchName(9, stage, slug);
      return {
        branch,
        path: join(dirname(c.worktree), worktreeDirName(branch)),
      };
    });
    for (const workspace of workspaces)
      await c.git(["worktree", "add", "-b", workspace.branch, workspace.path]);
    return workspaces;
  };
  const localBranch = async (head = branch) =>
    (
      await c.deps.runner(
        "git",
        ["show-ref", "--verify", "--quiet", `refs/heads/${head}`],
        { cwd: c.repoRoot },
      )
    ).code === 0;
  return {
    ...c,
    counter,
    hookPath,
    issueDir,
    services,
    cleanup,
    planning,
    localBranch,
  };
}
