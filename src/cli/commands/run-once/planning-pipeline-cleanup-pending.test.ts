import assert from "node:assert/strict";
import test from "node:test";
import { createPlanningProviderScenario } from "../../../../test-support/run-once/planning-provider-scenario.ts";

const artifacts = [
  { path: ".env", contents: "TOKEN=local-only\n" },
  { path: ".pi/todos/issue-243.md", contents: "# local task\n" },
  { path: ".superpowers/progress.md", contents: "review\n" },
  { path: "build/output.bin", contents: Uint8Array.from([0, 36, 243, 255]) },
  { path: "test-results/result.json", contents: "{}\n" },
  { path: ".unknown/unique.txt", contents: "preserve me\n" },
] as const;

test("reconciles failed cleanup-pending publication before coordinator retry", async () => {
  const scenario = await createPlanningProviderScenario({
    provider: "github-gh",
    gates: { specRequired: false, planRequired: false },
    ignoredImplementationArtifacts: artifacts,
  });
  try {
    scenario.failNextCleanupPendingComment();
    await assert.rejects(scenario.run(), /transient comment failure/);
    const pendingStateCount = scenario
      .stateHistory()
      .filter((state) =>
        state.phases.some(
          (phase) => phase.ownership?.cleanupState === "cleanup-pending",
        ),
      ).length;
    const agentRuns = scenario
      .effects()
      .filter((effect) => effect.operation === "agent-run").length;
    assert.deepEqual(scenario.issueSnapshot().labels, ["in-progress"]);

    const recovered = await scenario.run();
    assert.equal(
      recovered.status,
      "cleanup-pending",
      JSON.stringify(recovered),
    );
    assert.deepEqual(scenario.issueSnapshot().labels, ["needs-info"]);
    assert.equal(
      scenario
        .issueSnapshot()
        .comments?.filter((comment) =>
          comment.body.includes("Patchmill cleanup pending"),
        ).length,
      1,
    );
    assert.equal(
      scenario
        .stateHistory()
        .filter((state) =>
          state.phases.some(
            (phase) => phase.ownership?.cleanupState === "cleanup-pending",
          ),
        ).length,
      pendingStateCount,
    );
    assert.equal(
      scenario.effects().filter((effect) => effect.operation === "cleanup-hook")
        .length,
      1,
    );
    assert.equal(
      scenario
        .effects()
        .some((effect) => effect.operation === "workspace-remove"),
      false,
    );
    assert.equal(
      scenario.effects().some((effect) => effect.operation === "branch-remove"),
      false,
    );
    assert.equal(
      scenario.effects().filter((effect) => effect.operation === "agent-run")
        .length,
      agentRuns,
    );
    assert.equal((await scenario.run()).status, "no-issue");
  } finally {
    await scenario.cleanup();
  }
});

test("an implementation cleanup pending preserves ignored artifacts through an acknowledged retry", async () => {
  const scenario = await createPlanningProviderScenario({
    provider: "github-gh",
    gates: { specRequired: false, planRequired: false },
    ignoredImplementationArtifacts: artifacts,
  });
  try {
    const pending = await scenario.run();
    assert.equal(pending.status, "cleanup-pending", JSON.stringify(pending));
    if (pending.status !== "cleanup-pending") return;
    assert.equal(pending.phase, "implementation");
    assert.deepEqual(pending.ignoredPaths, [
      ".env",
      ".pi/todos/",
      ".superpowers/",
      ".unknown/",
      "build/",
      "test-results/",
    ]);
    assert.deepEqual(
      await scenario.ignoredImplementationArtifactContents(),
      Object.fromEntries(
        artifacts.map(({ path, contents }) => [
          path,
          typeof contents === "string"
            ? new TextEncoder().encode(contents)
            : contents,
        ]),
      ),
    );
    const durable = await scenario.state();
    const implementation = durable?.phases.find(
      (phase) => phase.kind === "implementation",
    );
    assert.equal(implementation?.status, "pull-request-open");
    assert.deepEqual(
      "workspace" in (implementation ?? {})
        ? implementation.workspace.cleanup
        : undefined,
      {
        state: "cleanup-pending",
        reason: "ignored-worktree-content",
        ignoredPaths: pending.ignoredPaths,
      },
    );
    assert.equal(
      scenario.effects().filter((effect) => effect.operation === "cleanup-hook")
        .length,
      1,
    );
    assert.equal(
      scenario
        .effects()
        .some((effect) => effect.operation === "workspace-remove"),
      false,
    );
    assert.deepEqual(scenario.issueSnapshot().labels.sort(), ["needs-info"]);
    assert.equal(
      scenario
        .issueSnapshot()
        .comments?.filter((comment) =>
          comment.body.includes("Patchmill cleanup pending"),
        ).length,
      1,
    );

    assert.equal((await scenario.run()).status, "no-issue");
    scenario.applyReadyLabel();
    const unchanged = await scenario.run();
    assert.equal(unchanged.status, "cleanup-pending");
    assert.equal(
      scenario
        .stateHistory()
        .filter((state) =>
          state.phases.some(
            (phase) => phase.ownership?.cleanupState === "cleanup-pending",
          ),
        ).length,
      1,
      "unchanged ignored inventory does not create another durable checkpoint",
    );
    assert.equal(
      scenario.effects().filter((effect) => effect.operation === "cleanup-hook")
        .length,
      1,
    );

    await scenario.removeIgnoredImplementationArtifacts();
    scenario.applyReadyLabel();
    const complete = await scenario.run();
    assert.equal(complete.status, "pr-created", JSON.stringify(complete));
    assert.equal((await scenario.state())?.phases.at(-1)?.status, "complete");
    assert.equal(
      scenario.effects().filter((effect) => effect.operation === "cleanup-hook")
        .length,
      1,
    );
    assert.equal(
      scenario
        .effects()
        .filter((effect) => effect.operation === "workspace-remove").length,
      1,
    );
    assert.equal(
      scenario
        .effects()
        .filter((effect) => effect.operation === "branch-remove").length,
      1,
    );
  } finally {
    await scenario.cleanup();
  }
});
