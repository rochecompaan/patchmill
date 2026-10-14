import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import test from "node:test";
import {
  implementationResumeFixture,
  resumeGit,
} from "../../../../test-support/run-once/planning-implementation-resume-fixture.ts";
import { replacePlanningPhase } from "../../../workflow/planning-phase-replacement.ts";
import { invalidateImplementationChecks } from "./planning-implementation-revalidation.ts";
import { runPlanningPhase } from "./planning-phase-runner.ts";

test("a PR merged while revalidation is pending completes reconciliation without agents", async () => {
  const run = await implementationResumeFixture();
  try {
    await run.remove();
    const saved = run.current();
    const phase = saved.phases[0];
    if (
      phase?.kind !== "implementation" ||
      phase.status !== "pull-request-open"
    )
      assert.fail();
    run.input.state = await replacePlanningPhase({
      stateStore: run.input.stateStore,
      state: saved,
      lock: run.input.lock,
      phaseIndex: 0,
      phase: invalidateImplementationChecks(phase),
    });
    const human = join(run.root, "human");
    execFileSync("git", ["clone", run.remote, human], { stdio: "ignore" });
    resumeGit(human, "config", "user.name", "Human");
    resumeGit(human, "config", "user.email", "human@example.test");
    resumeGit(human, "checkout", run.identity.branch);
    const head = await run.advance(human);
    resumeGit(run.repo, "fetch", "origin");
    resumeGit(
      run.repo,
      "merge",
      "--no-ff",
      "-m",
      "human merge",
      `origin/${run.identity.branch}`,
    );
    const mergeOid = resumeGit(run.repo, "rev-parse", "HEAD");
    resumeGit(run.repo, "push", "origin", "main");
    run.setPull({ ...run.pull(), status: "merged", mergeCommit: mergeOid });
    run.input.remoteBase.fetch = async () => ({
      ...run.base,
      baseOid: mergeOid,
    });
    const result = await runPlanningPhase(run.input);
    assert.equal(
      result.kind,
      "implementation-published",
      JSON.stringify(result),
    );
    assert.equal(run.agents(), 0);
    assert.equal(run.preparations(), 0);
    const merged = run.current().phases[0];
    if (
      merged?.kind !== "implementation" ||
      merged.status !== "pull-request-open"
    )
      assert.fail();
    assert.equal(merged.merge?.mergeOid, mergeOid);
    assert.equal(merged.observedHeadOid, head);
    assert.equal(merged.publication.headOid, run.checkedHead);
    assert.equal(merged.implementation.checkedHeadOid, run.checkedHead);
    assert.equal(merged.workspace.cleanup.state, "removed");
    assert.deepEqual(
      merged.implementation.validation,
      phase.implementation.validation,
    );
    assert.deepEqual(merged.finish, phase.finish);
  } finally {
    await run.close();
  }
});

test("a human merge during preparation skips agents and retains the checked revision", async () => {
  const run = await implementationResumeFixture("branch-pushed");
  try {
    const head = await run.advance();
    run.input.operations = {
      ...run.input.operations,
      runArtifacts: async ({ current }) => {
        resumeGit(run.repo, "fetch", "origin");
        resumeGit(
          run.repo,
          "merge",
          "--no-ff",
          "-m",
          "late human merge",
          `origin/${run.identity.branch}`,
        );
        const mergeOid = resumeGit(run.repo, "rev-parse", "HEAD");
        resumeGit(run.repo, "push", "origin", "main");
        run.setPull({ ...run.pull(), status: "merged", mergeCommit: mergeOid });
        run.input.remoteBase.fetch = async () => ({
          ...run.base,
          baseOid: mergeOid,
        });
        return { kind: "workspace-ready", phase: current };
      },
    };
    const result = await runPlanningPhase(run.input);
    assert.equal(
      result.kind,
      "implementation-published",
      JSON.stringify(result),
    );
    assert.equal(run.agents(), 0);
    const phase = run.current().phases[0];
    if (
      phase?.kind !== "implementation" ||
      phase.status !== "pull-request-open"
    )
      assert.fail();
    assert.equal(phase.workspace.headOid, head);
    assert.equal(phase.observedHeadOid, head);
    assert.equal(phase.publication.headOid, run.checkedHead);
    assert.equal(phase.implementation.checkedHeadOid, run.checkedHead);
    assert.ok(phase.merge);
  } finally {
    await run.close();
  }
});

test("closed unmerged PR recovery blocks without restoring a workspace or starting agents", async () => {
  const run = await implementationResumeFixture();
  try {
    await run.remove();
    const state = run.current();
    const phase = state.phases[0];
    if (
      phase?.kind !== "implementation" ||
      phase.status !== "pull-request-open"
    )
      assert.fail();
    run.input.state = await replacePlanningPhase({
      stateStore: run.input.stateStore,
      state,
      lock: run.input.lock,
      phaseIndex: 0,
      phase: invalidateImplementationChecks(phase),
    });
    run.setPull({ ...run.pull(), status: "closed-unmerged" });
    const result = await runPlanningPhase(run.input);
    assert.equal(result.kind, "blocked");
    assert.equal(run.agents(), 0);
    assert.equal((await run.workspaces.inspect(run.identity)).state, "missing");
    assert.equal(run.current().phases[0]?.status, "revalidation-pending");
    assert.equal(run.current().phases[0]?.workspace.cleanup.state, "removed");
  } finally {
    await run.close();
  }
});
