import assert from "node:assert/strict";
import test from "node:test";
import {
  createPlanningProviderScenario,
  type PlanningScenarioProvider,
} from "../../../../test-support/run-once/planning-provider-scenario.ts";

for (const provider of [
  "github-gh",
  "forgejo-tea",
] as const satisfies readonly PlanningScenarioProvider[]) {
  for (const [name, mutate, expected] of [
    [
      "closed-unmerged",
      (scenario: Awaited<ReturnType<typeof createPlanningProviderScenario>>) =>
        scenario.closeOpenPlanningPull(),
      "planning-pull-request-closed-unmerged",
    ],
    [
      "missing",
      (scenario: Awaited<ReturnType<typeof createPlanningProviderScenario>>) =>
        scenario.removeSavedPlanningPull(),
      "planning-pull-request-missing",
    ],
  ] as const) {
    test(`${provider} fails closed for ${name} planning pull requests`, async () => {
      const scenario = await createPlanningProviderScenario({
        provider,
        gates: { specRequired: true, planRequired: true },
      });
      try {
        const review = await scenario.run();
        assert.equal(review.status, "review-pending");
        const before = await scenario.state();
        mutate(scenario);
        const result = await scenario.run();
        assert.equal(result.status, "blocked");
        if (result.status === "blocked") assert.equal(result.reason, expected);
        const after = await scenario.state();
        assert.deepEqual(after?.phases[0], before?.phases[0]);
      } finally {
        await scenario.cleanup();
      }
    });
  }

  test(`${provider} preserves a transient planning-host failure`, async () => {
    const scenario = await createPlanningProviderScenario({
      provider,
      gates: { specRequired: true, planRequired: true },
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
}
