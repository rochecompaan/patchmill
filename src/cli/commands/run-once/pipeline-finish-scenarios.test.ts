import test from "node:test";
import assert from "node:assert/strict";
import { access, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createLegacyPrScenario } from "../../../../test-support/run-once/legacy-pr-scenario.ts";
import { withIssueRunLease } from "./recovery-lease.ts";
import { writeRunState } from "./run-state.ts";

// Replaces pre-PR-only fixtures that marked publication complete without host proof.
test("legacy PR resume skips agents and waits for host merge before cleanup and done labels", async () => {
  const scenario = await createLegacyPrScenario();
  try {
    const open = await scenario.run();
    assert.equal(open.status, "pr-created", JSON.stringify(open));
    assert.equal((await scenario.state())?.status, "implementing");
    assert.deepEqual(scenario.selected.labels, ["in-progress"]);
    assert.deepEqual(scenario.effects, ["comment"]);
    await access(scenario.workspace);
    await scenario.merge();
    const merged = await scenario.run();
    assert.equal(merged.status, "merged", JSON.stringify(merged));
    const state = await scenario.state();
    assert.equal(state?.status, "finished");
    assert.equal(state?.prUrl, "https://github.test/acme/repo/pull/17");
    assert.ok(state?.merge);
    assert.deepEqual(scenario.effects, [
      "comment",
      "hook",
      "worktree-remove",
      "branch-remove",
      "labels",
    ]);
    assert.deepEqual(scenario.selected.labels, ["agent-done"]);
  } finally {
    await scenario.cleanup();
  }
});

test("older false completion archives exact state and restores only its open PR lifecycle", async () => {
  const scenario = await createLegacyPrScenario({
    oldCompletion: true,
    removedWorkspace: true,
    marker: false,
  });
  try {
    const raw = await scenario.raw();
    const result = await scenario.run();
    assert.equal(result.status, "pr-created", JSON.stringify(result));
    assert.deepEqual(scenario.selected.labels, ["in-progress"]);
    const state = await scenario.state();
    assert.equal(state?.status, "implementing");
    assert.equal(state?.checkpoints?.doneLabelApplied, undefined);
    const archive = join(scenario.config.runStateDir, "archive", "issue-226");
    const paths = await readdir(archive);
    assert.equal(paths.length, 1);
    assert.equal(await readFile(join(archive, paths[0]!), "utf8"), raw);
    assert.equal(scenario.effects.includes("hook"), false);
    await scenario.merge();
    assert.equal((await scenario.run()).status, "merged");
    assert.equal(scenario.effects.includes("hook"), false);
  } finally {
    await scenario.cleanup();
  }
});

for (const point of ["worktree-remove", "branch-remove"] as const) {
  test(`legacy finish resumes crash after ${point} without repeating hooks or another issue cleanup`, async () => {
    const scenario = await createLegacyPrScenario();
    try {
      await scenario.run();
      await scenario.merge();
      const other = join(scenario.root, "other-issue.txt");
      await writeFile(other, "untouched");
      scenario.interruptAfter(point);
      await assert.rejects(scenario.run(), /interrupted|crash/u);
      assert.equal((await scenario.state())?.status, "implementing");
      assert.equal((await scenario.run()).status, "merged");
      assert.equal(
        scenario.effects.filter((value) => value === "hook").length,
        1,
      );
      assert.equal(await readFile(other, "utf8"), "untouched");
    } finally {
      await scenario.cleanup();
    }
  });
}

test("failed cleanup hook preserves resumable ownership and does not apply done labels", async () => {
  const scenario = await createLegacyPrScenario();
  try {
    await scenario.run();
    await scenario.merge();
    scenario.setHookFailure(true);
    await assert.rejects(scenario.run(), /hook failure|failed/u);
    assert.equal(
      (await scenario.state())?.checkpoints?.cleanupHookCompleted,
      undefined,
    );
    assert.equal(scenario.effects.includes("labels"), false);
    scenario.setHookFailure(false);
    assert.equal((await scenario.run()).status, "merged");
  } finally {
    await scenario.cleanup();
  }
});

test("verified legacy merge cleanup removes ignored-only workspace content", async () => {
  const scenario = await createLegacyPrScenario();
  try {
    await writeFile(join(scenario.workspace, ".git", "unused"), "").catch(
      () => undefined,
    );
    await scenario.git(
      "-C",
      scenario.workspace,
      "config",
      "--local",
      "core.excludesFile",
      join(scenario.root, "fixture-ignore"),
    );
    await writeFile(join(scenario.root, "fixture-ignore"), "cache/\n");
    await mkdir(join(scenario.workspace, "cache"), { recursive: true });
    await writeFile(join(scenario.workspace, "cache", "owned.db"), "preserve");
    await scenario.run();
    await scenario.merge();
    const result = await scenario.run();
    assert.equal(result.status, "merged", JSON.stringify(result));
    await assert.rejects(access(scenario.workspace), { code: "ENOENT" });
    assert.equal(scenario.effects.includes("labels"), true);
    assert.equal((await scenario.state())?.status, "finished");
    assert.deepEqual(scenario.selected.labels, ["agent-done"]);
    assert.equal(
      scenario.effects.filter((effect) => effect === "worktree-remove").length,
      1,
    );
  } finally {
    await scenario.cleanup();
  }
});

test("a changed published head blocks cleanup before running the hook", async () => {
  const scenario = await createLegacyPrScenario();
  try {
    await scenario.run();
    await scenario.merge();
    await scenario.git(
      "-C",
      scenario.workspace,
      "commit",
      "--allow-empty",
      "-m",
      "newer work",
    );
    const head = await scenario.git(
      "rev-parse",
      `refs/heads/${scenario.branch}`,
    );
    await assert.rejects(scenario.run(), /head-oid-mismatch/u);
    assert.equal(scenario.effects.includes("hook"), false);
    assert.equal(
      await scenario.git("rev-parse", `refs/heads/${scenario.branch}`),
      head,
    );
  } finally {
    await scenario.cleanup();
  }
});

test("closed unmerged PR and direct-land receipt preserve state without new work", async () => {
  const scenario = await createLegacyPrScenario();
  try {
    scenario.closeUnmerged();
    const raw = await scenario.raw();
    assert.equal((await scenario.run()).status, "blocked");
    assert.equal(await scenario.raw(), raw);
    assert.deepEqual(scenario.effects, []);
    await withIssueRunLease(
      { runStateDir: scenario.config.runStateDir, issueNumber: 226 },
      (lease) =>
        writeRunState(
          scenario.config.runStateDir,
          {
            issueNumber: 226,
            status: "finished",
            implementationStatus: "merged",
            mergeCommit: "c".repeat(40),
            resetCheckpoints: true,
          },
          lease,
        ),
    );
    const direct = await scenario.raw();
    assert.equal((await scenario.run()).status, "blocked");
    assert.equal(await scenario.raw(), direct);
    assert.deepEqual(scenario.effects, []);
  } finally {
    await scenario.cleanup();
  }
});
