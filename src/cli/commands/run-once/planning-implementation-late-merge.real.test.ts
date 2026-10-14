import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import {
  implementationResumeFixture,
  resumeGit,
} from "../../../../test-support/run-once/planning-implementation-resume-fixture.ts";
import { reconcileImplementationPullRequest } from "../../../workflow/implementation-pr-reconciliation.ts";
import {
  parsePlanningState,
  serializePlanningState,
} from "../../../workflow/planning-state.ts";
import {
  finishPlanningImplementation,
  type PlanningFinishInput,
} from "./planning-finish.ts";
import { runPlanningPhase } from "./planning-phase-runner.ts";

async function lateMergedFixture({
  rewritePreparedHead = false,
  squash = false,
}: { rewritePreparedHead?: boolean; squash?: boolean } = {}) {
  const run = await implementationResumeFixture("branch-pushed");
  const preparedHead = await run.advance();
  run.input.operations = {
    ...run.input.operations,
    runArtifacts: async ({ current }) => {
      const human = join(run.root, "human");
      execFileSync("git", ["clone", run.remote, human], { stdio: "ignore" });
      resumeGit(human, "config", "user.name", "Human");
      resumeGit(human, "config", "user.email", "human@example.test");
      resumeGit(human, "checkout", run.identity.branch);
      if (rewritePreparedHead)
        resumeGit(human, "reset", "--hard", run.checkedHead);
      await writeFile(join(human, "tracked.txt"), "human revision C\n");
      resumeGit(human, "add", ".");
      resumeGit(human, "commit", "-m", "another human revision");
      const headSha = resumeGit(human, "rev-parse", "HEAD");
      resumeGit(
        human,
        "push",
        ...(rewritePreparedHead ? ["--force"] : []),
        "origin",
        run.identity.branch,
      );
      resumeGit(run.repo, "fetch", "origin");
      if (squash) {
        resumeGit(
          run.repo,
          "merge",
          "--squash",
          `origin/${run.identity.branch}`,
        );
        resumeGit(run.repo, "commit", "-m", "late human squash merge");
      } else
        resumeGit(
          run.repo,
          "merge",
          "--no-ff",
          "-m",
          "late human merge",
          `origin/${run.identity.branch}`,
        );
      const mergeCommit = resumeGit(run.repo, "rev-parse", "HEAD");
      resumeGit(run.repo, "push", "origin", "main");
      run.setPull({ ...run.pull(), status: "merged", headSha, mergeCommit });
      run.input.remoteBase.fetch = async () => ({
        ...run.base,
        baseOid: mergeCommit,
      });
      return { kind: "workspace-ready", phase: current };
    },
  };
  return { run, preparedHead };
}

function finishInput(
  run: Awaited<ReturnType<typeof implementationResumeFixture>>,
): PlanningFinishInput {
  return {
    state: run.current(),
    phaseIndex: 0,
    lock: run.input.lock,
    stateStore: run.input.stateStore,
    git: run.input.publicationGit,
    workspaces: run.workspaces,
    reconcilePr: (phase) =>
      reconcileImplementationPullRequest({
        host: run.input.host,
        issueNumber: 189,
        evidence: {
          ...phase.pullRequest,
          publication: phase.publication,
          ownershipMarkerRequired: true,
        },
        fetchBase: () =>
          run.input.remoteBase.fetch({
            issueNumber: 189,
            remote: "origin",
            baseBranch: "main",
            targetRepository: phase.publication.targetRepository,
          }),
        git: run.input.publicationGit,
      }),
    effects: {
      publishCost: async () => {},
      validateVisualEvidence: async () => {},
      postHandoff: async () => {},
      cleanupHook: async () => {},
      ensureDoneLabel: async () => {},
      applyDoneLabels: async () => {},
    },
  };
}

test("a further push-and-merge during preparation preserves three heads through completion", async () => {
  const { run, preparedHead } = await lateMergedFixture();
  try {
    const result = await runPlanningPhase(run.input);
    assert.equal(
      result.kind,
      "implementation-published",
      JSON.stringify(result),
    );
    assert.equal(run.agents(), 0);
    const completed = await finishPlanningImplementation(finishInput(run));
    assert.equal(completed.kind, "complete");
    const phase = completed.state.phases[0];
    if (phase?.kind !== "implementation" || phase.status !== "complete")
      assert.fail();
    assert.equal(phase.implementation.checkedHeadOid, run.checkedHead);
    assert.equal(phase.publication.headOid, run.checkedHead);
    assert.equal(phase.workspace.headOid, preparedHead);
    assert.equal(phase.observedHeadOid, run.pull().headSha);
    assert.notEqual(phase.observedHeadOid, preparedHead);
    assert.equal(phase.merge?.workspaceHeadOid, preparedHead);
    assert.equal(phase.workspace.cleanup.state, "removed");
    assert.deepEqual(
      parsePlanningState(serializePlanningState(completed.state)),
      completed.state,
    );
    assert.equal((await run.workspaces.inspect(run.identity)).state, "missing");
  } finally {
    await run.close();
  }
});

test("a verified late squash merge accepts workspace ancestry in the merged PR head", async () => {
  const { run, preparedHead } = await lateMergedFixture({ squash: true });
  try {
    const result = await runPlanningPhase(run.input);
    assert.equal(
      result.kind,
      "implementation-published",
      JSON.stringify(result),
    );
    assert.equal(run.agents(), 0);
    const completed = await finishPlanningImplementation(finishInput(run));
    assert.equal(completed.kind, "complete");
    const phase = completed.state.phases[0];
    if (phase?.kind !== "implementation" || phase.status !== "complete")
      assert.fail();
    assert.equal(phase.merge?.workspaceHeadOid, preparedHead);
    assert.equal(phase.implementation.checkedHeadOid, run.checkedHead);
  } finally {
    await run.close();
  }
});

test("a late rewritten merge that excludes the prepared workspace blocks without cleanup", async () => {
  const { run, preparedHead } = await lateMergedFixture({
    rewritePreparedHead: true,
  });
  try {
    const result = await runPlanningPhase(run.input);
    assert.equal(result.kind, "blocked", JSON.stringify(result));
    assert.equal(run.agents(), 0);
    assert.equal(run.current().phases[0]?.status, "revalidation-pending");
    assert.equal(resumeGit(run.path, "rev-parse", "HEAD"), preparedHead);
    assert.equal(
      await readFile(join(run.path, "tracked.txt"), "utf8"),
      "human revision B\n",
    );
    assert.ok(
      !run.calls.some((args) => args[0] === "worktree" && args[1] === "remove"),
    );
  } finally {
    await run.close();
  }
});

test("verified late-merge inclusion does not authorize removal of new dirty workspace edits", async () => {
  const { run, preparedHead } = await lateMergedFixture();
  try {
    const result = await runPlanningPhase(run.input);
    assert.equal(
      result.kind,
      "implementation-published",
      JSON.stringify(result),
    );
    await writeFile(join(run.path, "tracked.txt"), "unmerged local edits\n");
    await assert.rejects(
      finishPlanningImplementation(finishInput(run)),
      /dirty/u,
    );
    assert.equal(run.agents(), 0);
    assert.equal(resumeGit(run.path, "rev-parse", "HEAD"), preparedHead);
    assert.equal(
      await readFile(join(run.path, "tracked.txt"), "utf8"),
      "unmerged local edits\n",
    );
    assert.notEqual(run.current().phases[0]?.status, "complete");
  } finally {
    await run.close();
  }
});
