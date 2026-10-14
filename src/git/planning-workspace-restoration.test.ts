import assert from "node:assert/strict";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import {
  implementationResumeFixture,
  resumeGit,
} from "../../test-support/run-once/planning-implementation-resume-fixture.ts";
import { PlanningWorkspaceGit } from "./planning-workspace-git.ts";

function restoration(
  run: Awaited<ReturnType<typeof implementationResumeFixture>>,
  head = run.pull().headSha,
) {
  const phase = run.current().phases[0];
  if (phase?.kind !== "implementation" || phase.status !== "pull-request-open")
    assert.fail();
  return {
    runId: run.input.state.runId,
    phase: "implementation" as const,
    identity: run.identity,
    base: run.base,
    saved: phase.workspace,
    restoreHeadOid: head,
  };
}

test("restoration reuses a surviving owned branch without reset", async () => {
  const run = await implementationResumeFixture();
  try {
    await run.remove(true);
    const restored = await run.workspaces.resume(restoration(run));
    assert.equal(restored.headOid, run.checkedHead);
    assert.equal(resumeGit(run.path, "rev-parse", "HEAD"), run.checkedHead);
    assert.ok(
      !run.calls.some(
        (args) => args.includes("reset") || args.includes("--force"),
      ),
    );
  } finally {
    await run.close();
  }
});

test("restoration preserves a surviving local branch that differs from the current PR head", async () => {
  const run = await implementationResumeFixture();
  try {
    const localHead = await run.advance();
    resumeGit(
      run.remote,
      "update-ref",
      `refs/heads/${run.identity.branch}`,
      run.checkedHead,
    );
    run.setPull({ ...run.pull(), headSha: run.checkedHead });
    await run.remove(true);
    await assert.rejects(
      run.workspaces.resume(restoration(run)),
      /remote-head-mismatch/,
    );
    assert.equal(
      resumeGit(run.repo, "rev-parse", run.identity.branch),
      localHead,
    );
    assert.ok(
      !run.calls.some(
        (args) => args.includes("reset") || args.includes("--force"),
      ),
    );
  } finally {
    await run.close();
  }
});

test("a PR head that changes between observation and fetch blocks restoration", async () => {
  const run = await implementationResumeFixture();
  try {
    await run.remove();
    await assert.rejects(
      run.workspaces.resume(restoration(run, "c".repeat(40))),
      /remote-head-mismatch/,
    );
    assert.equal((await run.workspaces.inspect(run.identity)).state, "missing");
    assert.equal(run.current().phases[0]?.workspace.cleanup.state, "removed");
    assert.ok(
      !run.calls.some(
        (args) =>
          args[0] === "worktree" &&
          args[1] === "add" &&
          args.includes(run.path) &&
          args.includes("c".repeat(40)),
      ),
    );
  } finally {
    await run.close();
  }
});

test("registration at another worktree path is never taken over", async () => {
  const run = await implementationResumeFixture();
  try {
    await run.remove(true);
    const other = join(run.root, "owned-elsewhere");
    resumeGit(run.repo, "worktree", "add", other, run.identity.branch);
    await assert.rejects(
      run.workspaces.resume(restoration(run)),
      /branch-owned-by-other-worktree/,
    );
    assert.equal(resumeGit(other, "rev-parse", "HEAD"), run.checkedHead);
  } finally {
    await run.close();
  }
});

test("an unregistered destination is not overwritten", async () => {
  const run = await implementationResumeFixture();
  try {
    await run.remove();
    await mkdir(run.path);
    await writeFile(join(run.path, "sentinel.txt"), "external work\n");
    await assert.rejects(
      run.workspaces.resume(restoration(run)),
      /path-collision/,
    );
    assert.equal(
      await readFile(join(run.path, "sentinel.txt"), "utf8"),
      "external work\n",
    );
  } finally {
    await run.close();
  }
});

test("worktree-add failure retains truthful removed recovery evidence", async () => {
  const run = await implementationResumeFixture();
  try {
    await run.remove();
    const adapter = new PlanningWorkspaceGit({
      repoRoot: run.repo,
      worktreeRoot: join(run.root, "worktrees"),
      runner: {
        run: async (command, args, options) =>
          args[0] === "worktree" && args[1] === "add"
            ? { code: 1, stdout: "", stderr: "injected failure" }
            : run.runner.run(command, args, options),
      },
    });
    await assert.rejects(adapter.resume(restoration(run)), /worktree-add/);
    assert.equal((await adapter.inspect(run.identity)).state, "missing");
    assert.equal(run.current().phases[0]?.workspace.cleanup.state, "removed");
    assert.equal(run.agents(), 0);
  } finally {
    await run.close();
  }
});
