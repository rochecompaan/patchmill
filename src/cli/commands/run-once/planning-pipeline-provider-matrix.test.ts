import assert from "node:assert/strict";
import test from "node:test";
import {
  createPlanningProviderScenario,
  type PlanningScenarioProvider,
} from "../../../../test-support/run-once/planning-provider-scenario.ts";

const gateCases = [
  {
    gates: { specRequired: false, planRequired: false },
    phases: ["implementation"],
  },
  {
    gates: { specRequired: true, planRequired: false },
    phases: ["spec", "implementation"],
  },
  {
    gates: { specRequired: false, planRequired: true },
    phases: ["plan", "implementation"],
  },
  {
    gates: { specRequired: true, planRequired: true },
    phases: ["spec", "plan", "implementation"],
  },
] as const;

for (const provider of [
  "github-gh",
  "forgejo-tea",
] as const satisfies readonly PlanningScenarioProvider[]) {
  test(`${provider} completes every planning review-gate sequence through the public facade`, async () => {
    for (const entry of gateCases) {
      const scenario = await createPlanningProviderScenario({
        provider,
        gates: entry.gates,
      });
      try {
        for (const phase of entry.phases.slice(0, -1)) {
          const review = await scenario.run();
          assert.equal(review.status, "review-pending");
          if (review.status === "review-pending")
            assert.equal(review.phase, phase);
          const durable = await scenario.state();
          assert.deepEqual(durable?.gates, entry.gates);
          assert.equal(
            durable?.phases.find((item) => item.kind === phase)?.status,
            "pull-request-open",
          );
          assert.equal(
            scenario.pulls().filter((pull) => pull.phase === phase).length,
            1,
          );
          await scenario.mergeOpenPlanningPull({
            editArtifact: (content) => `${content}reviewed by a human\n`,
          });
        }
        const result = await scenario.run();
        assert.equal(result.status, "pr-created", JSON.stringify(result));
        const durable = await scenario.state();
        assert.equal(durable?.phases.at(-1)?.status, "complete");
        assert.deepEqual(
          scenario.pulls().map((pull) => pull.phase),
          entry.phases,
        );
        const artifacts = await scenario.remoteArtifactContents();
        const carried = scenario.carriedArtifactContents();
        assert.deepEqual(
          Object.keys(artifacts)
            .map((path) => (path.startsWith("docs/specs/") ? "spec" : "plan"))
            .sort(),
          ["plan", "spec"],
          "every gate cell completes one spec and one plan artifact",
        );
        for (const [path, content] of Object.entries(artifacts)) {
          const phase = path.startsWith("docs/specs/") ? "spec" : "plan";
          if (entry.gates[`${phase}Required`])
            assert.match(content, /reviewed by a human/u, path);
          assert.equal(
            carried[path],
            content,
            `${path} carried to a later phase`,
          );
        }
        const implementation = scenario.pulls().at(-1)!;
        assert.match(implementation.body, /Closes #190/u);
        assert.match(implementation.body, /phase=implementation/u);
        for (const pull of scenario.pulls().slice(0, -1)) {
          assert.match(pull.body, /phase=(spec|plan)/u);
          assert.doesNotMatch(pull.body, /Closes #190/u);
          if (provider === "github-gh") {
            assert.equal(pull.targetRepository, "acme/patchmill");
            assert.equal(pull.headRepository, "acme/patchmill");
          } else {
            assert.equal(pull.targetRepository, "acme/patchmill");
            assert.equal(pull.headRepository, "acme/patchmill-head");
          }
        }
      } finally {
        await scenario.cleanup();
      }
    }
  });
}
