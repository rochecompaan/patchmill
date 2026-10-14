import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import test from "node:test";
import {
  implementationResumeFixture,
  resumeGit,
} from "../../../../test-support/run-once/planning-implementation-resume-fixture.ts";
import { runPlanningPhase } from "./planning-phase-runner.ts";

test("a changed clean branch-pushed worktree passes preparation before fresh same-PR checks", async () => {
  const run = await implementationResumeFixture("branch-pushed");
  try {
    const head = await run.advance();
    const result = await runPlanningPhase(run.input);
    assert.equal(
      result.kind,
      "implementation-published",
      JSON.stringify(result),
    );
    assert.equal(run.agents(), 1);
    assert.equal(run.preparations(), 1);
    const phase = run.current().phases[0];
    assert.equal(phase?.status, "pull-request-open");
    if (
      phase?.kind !== "implementation" ||
      phase.status !== "pull-request-open"
    )
      assert.fail();
    assert.equal(phase.pullRequest.reference.number, 17);
    assert.equal(phase.implementation.checkedHeadOid, head);
    assert.deepEqual(phase.implementation.validation, ["fresh checks"]);
    assert.deepEqual(phase.finish, {});
  } finally {
    await run.close();
  }
});

test("a changed dirty branch-pushed worktree blocks before agents and before a ready-head checkpoint", async () => {
  const run = await implementationResumeFixture("branch-pushed");
  try {
    await run.advance();
    await writeFile(join(run.path, "tracked.txt"), "uncommitted human edits\n");
    const result = await runPlanningPhase(run.input);
    assert.equal(result.kind, "blocked");
    assert.equal(result.state.phases[0]?.status, "revalidation-pending");
    assert.equal(run.agents(), 0);
    assert.equal(run.current().phases[0]?.status, "revalidation-pending");
    assert.equal(run.current().phases[0]?.workspace.headOid, run.checkedHead);
    assert.equal(
      await readFile(join(run.path, "tracked.txt"), "utf8"),
      "uncommitted human edits\n",
    );
  } finally {
    await run.close();
  }
});

test("an unchanged branch-pushed receipt validates its PR without an agent rerun", async () => {
  const run = await implementationResumeFixture("branch-pushed");
  try {
    const result = await runPlanningPhase(run.input);
    assert.equal(result.kind, "implementation-published");
    assert.equal(run.agents(), 0);
    assert.equal(run.preparations(), 0);
  } finally {
    await run.close();
  }
});

test("a removed implementation worktree is restored at its owned path from the current PR head", async () => {
  const run = await implementationResumeFixture();
  try {
    await run.remove();
    const human = join(run.root, "human");
    execFileSync("git", ["clone", run.remote, human], { stdio: "ignore" });
    resumeGit(human, "config", "user.name", "Human");
    resumeGit(human, "config", "user.email", "human@example.test");
    resumeGit(human, "checkout", run.identity.branch);
    const head = await run.advance(human);
    const result = await runPlanningPhase(run.input);
    assert.equal(
      result.kind,
      "implementation-published",
      JSON.stringify(result),
    );
    assert.equal(run.agents(), 1);
    assert.equal(resumeGit(run.path, "rev-parse", "HEAD"), head);
    assert.equal(run.current().phases[0]?.status, "pull-request-open");
    assert.ok(
      !run.calls.some(
        (args) => args.includes("reset") || args.includes("--force"),
      ),
    );
  } finally {
    await run.close();
  }
});

test("interrupted prepared retries recheck cleanliness before reentering implementation", async () => {
  const run = await implementationResumeFixture("branch-pushed");
  try {
    await run.advance();
    const realImplementation = run.input.operations?.runImplementation;
    run.input.operations = {
      ...run.input.operations,
      runImplementation: async ({ state }) => ({
        kind: "blocked",
        state,
        result: {
          status: "blocked",
          reason: "interrupted",
          questions: [],
          commits: [],
          validation: [],
        },
      }),
    };
    const first = await runPlanningPhase(run.input);
    assert.equal(first.kind, "blocked");
    assert.equal(run.current().phases[0]?.status, "workspace-ready");
    run.input.state = run.current();
    if (realImplementation)
      run.input.operations.runImplementation = realImplementation;
    else delete run.input.operations.runImplementation;
    await writeFile(join(run.path, "tracked.txt"), "dirty retry\n");
    const result = await runPlanningPhase(run.input);
    assert.equal(result.kind, "blocked");
    assert.equal(result.state.phases[0]?.status, "revalidation-pending");
    assert.equal(run.agents(), 0);
  } finally {
    await run.close();
  }
});

test("a rewritten remote PR branch fails saved-base ancestry before restoration or agents", async () => {
  const run = await implementationResumeFixture();
  try {
    await run.remove();
    resumeGit(run.repo, "checkout", "--orphan", "unrelated");
    await writeFile(join(run.repo, "tracked.txt"), "foreign history\n");
    resumeGit(run.repo, "add", ".");
    resumeGit(run.repo, "commit", "-m", "unrelated root");
    const head = resumeGit(run.repo, "rev-parse", "HEAD");
    resumeGit(
      run.repo,
      "push",
      "--force",
      "origin",
      `HEAD:refs/heads/${run.identity.branch}`,
    );
    run.setPull({ ...run.pull(), headSha: head });
    await assert.rejects(runPlanningPhase(run.input), /base-oid-mismatch/);
    assert.equal(run.agents(), 0);
    assert.equal(run.current().phases[0]?.status, "revalidation-pending");
    assert.equal(run.current().phases[0]?.workspace.cleanup.state, "removed");
    assert.equal(run.current().phases[0]?.workspace.headOid, run.checkedHead);
  } finally {
    await run.close();
  }
});

test("a foreign path keeps the saved PR and removed cleanup state and never starts an agent", async () => {
  const run = await implementationResumeFixture();
  try {
    await run.remove();
    resumeGit(run.repo, "worktree", "add", "-b", "foreign", run.path, "main");
    await writeFile(join(run.path, "sentinel.txt"), "do not change\n");
    resumeGit(
      run.remote,
      "update-ref",
      `refs/heads/${run.identity.branch}`,
      run.base.baseOid,
    );
    run.setPull({ ...run.pull(), headSha: run.base.baseOid });
    await assert.rejects(
      runPlanningPhase(run.input),
      /unsafe|collision|registration/,
    );
    assert.equal(run.agents(), 0);
    const phase = run.current().phases[0];
    assert.equal(phase?.status, "revalidation-pending");
    assert.equal(phase?.workspace.cleanup.state, "removed");
    assert.equal(phase?.revalidation.pullRequest.reference.number, 17);
    assert.equal(
      await readFile(join(run.path, "sentinel.txt"), "utf8"),
      "do not change\n",
    );
  } finally {
    await run.close();
  }
});
