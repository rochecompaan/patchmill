import assert from "node:assert/strict";
import test from "node:test";
import { createPlanningProviderScenario } from "../../../../test-support/run-once/planning-provider-scenario.ts";

for (const provider of ["github-gh", "forgejo-tea"] as const) {
  test(
    `${provider} finishes interrupted cleanup after merged PR head deletion`,
    { timeout: 120_000 },
    async () => {
      const scenario = await createPlanningProviderScenario({
        provider,
        gates: { specRequired: false, planRequired: false },
      });
      try {
        scenario.interruptAt("after-implementation-worktree-remove");
        await assert.rejects(scenario.run({ explicit: true }), /EACCES/u);
        await scenario.restorePersistence();
        const agents = scenario
          .effects()
          .filter(
            (effect) =>
              effect.kind === "write" && effect.operation === "agent-run",
          ).length;
        await scenario.mergeOpenImplementationPull({ deleteHeadBranch: true });
        const result = await scenario.run({ explicit: true });
        assert.equal(result.status, "merged", JSON.stringify(result));
        assert.equal(
          scenario
            .effects()
            .filter(
              (effect) =>
                effect.kind === "write" && effect.operation === "agent-run",
            ).length,
          agents,
        );
        assert.equal(
          scenario.pulls().filter((pull) => pull.phase === "implementation")
            .length,
          1,
        );
        const complete = (await scenario.state())?.phases.at(-1);
        assert.equal(complete?.status, "complete");
        if (
          !complete ||
          complete.kind !== "implementation" ||
          complete.status !== "complete"
        )
          assert.fail("implementation unfinished");
        assert.ok(complete.merge);
        assert.equal(complete.workspace.cleanup.state, "removed");
        assert.ok(scenario.issueSnapshot().labels.includes("agent-done"));
      } finally {
        await scenario.cleanup();
      }
    },
  );
}
