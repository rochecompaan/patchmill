import assert from "node:assert/strict";
import { access, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import test from "node:test";
import { approvedArtifactExecutionFixture } from "../../../../test-support/run-once/approved-artifact-execution-fixture.ts";
import { readRunState } from "./run-state.ts";

for (const source of ["repository", "published", "branch"] as const) {
  for (const configuredDirectory of [false, true]) {
    test(`selected approved ${source} plan is readable in the execution worktree before the agent (configured directory: ${configuredDirectory})`, async (t) => {
      const run = await approvedArtifactExecutionFixture(t, {
        source,
        configuredDirectory,
      });
      const result = await run.run();
      assert.equal(result.status, "blocked");
      assert.equal(run.agents(), 1);
      assert.notEqual(run.agentCwd(), run.config.repoRoot);
      assert.equal(run.contentAtAgent(), run.content);
      assert.equal(
        (await readRunState(run.config.runStateDir, 140))?.planCommit,
        run.savedCommit,
      );
    });
  }
}
test("materialization uses the retained approved snapshot when its repository source changes", async (t) => {
  const run = await approvedArtifactExecutionFixture(t, {
    afterWorktree: async () => {
      await writeFile(join(root, path), "# Changed after approval\n");
      await writeFile(
        join(dirname(join(root, path)), "other-issue-140-plan.md"),
        "# New competing artifact\n",
      );
    },
  });
  const root = run.config.repoRoot;
  const path = run.path;
  await run.run();
  assert.equal(run.agents(), 1);
  assert.equal(run.contentAtAgent(), run.content);
  assert.equal(
    await readFile(join(root, path), "utf8"),
    "# Changed after approval\n",
  );
});
for (const condition of ["missing", "unreadable", "conflicting"] as const) {
  test(`an approved source in another root cannot satisfy a ${condition} execution destination`, async (t) => {
    const run = await approvedArtifactExecutionFixture(t, {
      ...(condition === "conflicting"
        ? {
            afterWorktree: async (root: string) => {
              await mkdir(dirname(join(root, path)), { recursive: true });
              await writeFile(
                join(root, path),
                "# Conflicting execution content\n",
              );
            },
          }
        : {
            afterMaterialization: async (root: string) => {
              await rm(join(root, path));
              if (condition === "unreadable") await mkdir(join(root, path));
            },
          }),
    });
    const path = run.path;
    const result = await run.run();
    assert.equal(result.status, "blocked");
    if (result.status !== "blocked") assert.fail();
    assert.match(
      result.reason,
      new RegExp(
        `(?:Issue #140|issue #140).*plan.*(?:destination|worktree|materializ|conflict|regular file)`,
      ),
    );
    assert.equal(run.agents(), 0);
    await access(join(run.config.repoRoot, run.path));
  });
}
