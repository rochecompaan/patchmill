import assert from "node:assert/strict";
import test from "node:test";
import {
  createPlanningProviderScenario,
  type PlanningProviderScenario,
  type PlanningScenarioFailurePoint,
  type PlanningScenarioProvider,
} from "../../../../test-support/run-once/planning-provider-scenario.ts";

const bothGates = { specRequired: true, planRequired: true };
const interruptionPoints: readonly PlanningScenarioFailurePoint[] = [
  "after-phase-push",
  "after-planning-pull-request-create",
  "after-worktree-remove",
  "after-local-branch-remove",
  "after-planning-merge-observation",
  "after-implementation-pull-request-validation",
  "after-handoff-comment",
  "after-cleanup-hook",
  "after-implementation-worktree-remove",
  "after-done-label",
];

async function advanceToImplementation(scenario: PlanningProviderScenario) {
  for (const phase of ["spec", "plan"] as const) {
    const review = await scenario.run();
    assert.equal(review.status, "review-pending");
    if (review.status === "review-pending") assert.equal(review.phase, phase);
    await scenario.mergeOpenPlanningPull({
      editArtifact: (content) => `${content}reviewed by a human\n`,
    });
  }
}

async function finish(scenario: PlanningProviderScenario) {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const result = await scenario.run();
    if (result.status === "pr-created") return result;
    if (result.status === "review-pending") {
      await scenario.mergeOpenPlanningPull({
        editArtifact: (content) => `${content}reviewed by a human\n`,
      });
      continue;
    }
    assert.fail(`unexpected recovery result: ${JSON.stringify(result)}`);
  }
  assert.fail("scenario did not finish after recovery");
}

function requiresPlanningMerge(point: PlanningScenarioFailurePoint) {
  return point === "after-planning-merge-observation";
}

function requiresImplementation(point: PlanningScenarioFailurePoint) {
  return ![
    "after-phase-push",
    "after-planning-pull-request-create",
    "after-worktree-remove",
    "after-local-branch-remove",
    "after-planning-merge-observation",
  ].includes(point);
}

for (const provider of [
  "github-gh",
  "forgejo-tea",
] as const satisfies readonly PlanningScenarioProvider[]) {
  for (const point of interruptionPoints) {
    test(`${provider} adopts completed effects after ${point}`, async () => {
      const scenario = await createPlanningProviderScenario({
        provider,
        gates: bothGates,
      });
      try {
        if (requiresPlanningMerge(point)) {
          assert.equal((await scenario.run()).status, "review-pending");
          await scenario.mergeOpenPlanningPull({
            editArtifact: (content) => `${content}reviewed by a human\n`,
          });
        }
        if (requiresImplementation(point))
          await advanceToImplementation(scenario);
        scenario.interruptAt(point);
        await assert.rejects(scenario.run());
        const interrupted = await scenario.state();
        assert.ok(interrupted);
        const pullsBeforeRetry = scenario.pulls();
        await scenario.restorePersistence();
        const finished = await finish(scenario);
        assert.equal(finished.status, "pr-created");
        assert.equal(
          (await scenario.state())?.phases.at(-1)?.status,
          "complete",
        );
        assert.deepEqual(
          scenario.pulls().map((pull) => pull.phase),
          ["spec", "plan", "implementation"],
        );
        assert.equal(
          scenario.pulls().filter((pull) => pull.phase === "spec").length,
          1,
        );
        assert.equal(
          scenario.pulls().filter((pull) => pull.phase === "plan").length,
          1,
        );
        assert.equal(
          scenario.pulls().filter((pull) => pull.phase === "implementation")
            .length,
          1,
        );
        assert.ok(pullsBeforeRetry.length <= scenario.pulls().length);
        const terminal = await scenario.state();
        const terminalPulls = scenario.pulls();
        const terminalRerun = await scenario.run();
        assert.ok(
          terminalRerun.status === "pr-created" ||
            terminalRerun.status === "blocked",
          JSON.stringify(terminalRerun),
        );
        assert.deepEqual(await scenario.state(), terminal);
        assert.deepEqual(scenario.pulls(), terminalPulls);
      } finally {
        await scenario.cleanup();
      }
    });
  }

  for (const [name, mutate, expected] of [
    [
      "closed-unmerged",
      (scenario: PlanningProviderScenario) => scenario.closeOpenPlanningPull(),
      "planning-pull-request-closed-unmerged",
    ],
    [
      "missing",
      (scenario: PlanningProviderScenario) =>
        scenario.removeSavedPlanningPull(),
      "planning-pull-request-missing",
    ],
  ] as const) {
    test(`${provider} fails closed for ${name} planning pull requests`, async () => {
      const scenario = await createPlanningProviderScenario({
        provider,
        gates: bothGates,
      });
      try {
        assert.equal((await scenario.run()).status, "review-pending");
        const before = await scenario.state();
        mutate(scenario);
        const result = await scenario.run();
        assert.equal(result.status, "blocked");
        if (result.status === "blocked") assert.equal(result.reason, expected);
        assert.deepEqual(await scenario.state(), before);
      } finally {
        await scenario.cleanup();
      }
    });
  }

  test(`${provider} fails closed for ambiguous branch-pushed planning pulls`, async () => {
    const scenario = await createPlanningProviderScenario({
      provider,
      gates: bothGates,
    });
    try {
      scenario.interruptAt("after-planning-pull-request-create");
      await assert.rejects(scenario.run());
      await scenario.restorePersistence();
      scenario.duplicateOpenPlanningPull();
      const result = await scenario.run();
      assert.equal(result.status, "blocked");
      if (result.status === "blocked")
        assert.equal(result.reason, "planning-pull-request-ambiguous");
      assert.equal(scenario.pulls().length, 2);
    } finally {
      await scenario.cleanup();
    }
  });

  test(`${provider} preserves a transient planning-host failure`, async () => {
    const scenario = await createPlanningProviderScenario({
      provider,
      gates: bothGates,
    });
    try {
      assert.equal((await scenario.run()).status, "review-pending");
      const before = await scenario.state();
      scenario.failNextHostRead();
      await assert.rejects(scenario.run());
      assert.deepEqual(await scenario.state(), before);
    } finally {
      await scenario.cleanup();
    }
  });

  test(`${provider} requires exact stale-lock archival before resuming`, async () => {
    const scenario = await createPlanningProviderScenario({
      provider,
      gates: bothGates,
    });
    try {
      assert.equal((await scenario.run()).status, "review-pending");
      const before = await scenario.state();
      const installed = await scenario.installDeadProcessLock();
      const blocked = await scenario.run();
      assert.equal(blocked.status, "blocked");
      if (blocked.status === "blocked")
        assert.equal(blocked.reason, "issue-lock-stale");
      assert.deepEqual(await scenario.state(), before);
      const archived = await scenario.archiveExactStaleLock();
      assert.equal(archived.fingerprint, installed.fingerprint);
      assert.match(archived.archivePath, /planning-pr-v1[\\/]archives/u);
      assert.equal((await scenario.run()).status, "review-pending");
    } finally {
      await scenario.cleanup();
    }
  });
}
