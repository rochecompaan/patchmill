import assert from "node:assert/strict";
import test from "node:test";
import {
  createPlanningProviderScenario,
  type PlanningProviderScenario,
  type PlanningScenarioEffect,
  type PlanningScenarioFailurePoint,
  type PlanningScenarioProvider,
  type PlanningStateSnapshot,
} from "../../../../test-support/run-once/planning-provider-scenario.ts";

const bothGates = { specRequired: true, planRequired: true };
const providers = [
  "github-gh",
  "forgejo-tea",
] as const satisfies readonly PlanningScenarioProvider[];
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

function writeEffects(effects: readonly PlanningScenarioEffect[]) {
  return effects.filter((effect) => effect.kind === "write");
}

for (const provider of providers) {
  test(`${provider} records provider-neutral process effects`, async () => {
    const scenario = await createPlanningProviderScenario({
      provider,
      gates: bothGates,
    });
    try {
      assert.equal((await scenario.run()).status, "review-pending");
      const effects = scenario.effects();
      assert.ok(effects.some((effect) => effect.kind === "read"));
      assert.deepEqual(
        writeEffects(effects)
          .map((effect) => effect.operation)
          .filter((operation) =>
            [
              "agent-run",
              "issue-label-edit",
              "issue-comment",
              "phase-push",
              "planning-pull-request-create",
            ].includes(operation),
          ),
        [
          "issue-label-edit",
          "issue-comment",
          "agent-run",
          "phase-push",
          "planning-pull-request-create",
        ],
      );
    } finally {
      await scenario.cleanup();
    }
  });
}

const allowedPhaseTransitions = {
  pending: [
    "pending",
    "workspace-ready",
    "branch-pushed",
    "pull-request-open",
    "complete",
  ],
  "workspace-ready": [
    "workspace-ready",
    "branch-pushed",
    "pull-request-open",
    "complete",
  ],
  "branch-pushed": ["branch-pushed", "pull-request-open", "complete"],
  "pull-request-open": ["pull-request-open", "complete"],
  complete: ["complete"],
} as const;

function assertMonotonicStateHistory(
  history: readonly PlanningStateSnapshot[],
) {
  assert.ok(history.length >= 2, "recovery records multiple durable states");
  for (let index = 1; index < history.length; index += 1) {
    const previous = history[index - 1]!;
    const current = history[index]!;
    assert.ok(
      current.revision > previous.revision,
      `revision ${current.revision} follows ${previous.revision}`,
    );
    for (const phase of current.phases) {
      const prior = previous.phases.find((item) => item.kind === phase.kind);
      if (prior === undefined) continue;
      assert.ok(
        allowedPhaseTransitions[prior.status].includes(phase.status),
        `${phase.kind} transitions from ${prior.status} to ${phase.status}`,
      );
      for (const checkpoint of prior.finish ?? [])
        assert.ok(
          phase.finish?.includes(checkpoint),
          `${phase.kind} retains ${checkpoint}`,
        );
    }
  }
  const implementation = history
    .at(-1)
    ?.phases.find((phase) => phase.kind === "implementation");
  assert.equal(implementation?.status, "complete");
  assert.deepEqual(implementation?.finish, [
    "cleanupHookCompleted",
    "costPublicationCompleted",
    "doneLabelApplied",
    "doneLabelEnsured",
    "handoffCommentPosted",
    "visualEvidenceValidated",
  ]);
}

function assertOnePublicationPerPhase(scenario: PlanningProviderScenario) {
  const effects = writeEffects(scenario.effects());
  for (const phase of ["spec", "plan", "implementation"] as const) {
    const pushes = effects.filter(
      (effect) =>
        effect.phase === phase &&
        (effect.operation === "phase-push" ||
          effect.operation === "implementation-push"),
    ).length;
    assert.equal(pushes, 1, `${phase} has one remote branch update`);
    assert.equal(
      scenario.pulls().filter((pull) => pull.phase === phase).length,
      1,
      `${phase} has one pull request`,
    );
  }
}

function assertNoEffectsAfterInterruption(
  scenario: PlanningProviderScenario,
  point: PlanningScenarioFailurePoint,
) {
  const effects = scenario.effects();
  const interruption = effects.findLastIndex(
    (effect) => effect.kind === "interrupt",
  );
  assert.notEqual(
    interruption,
    -1,
    "the requested effect interrupted state persistence",
  );
  assert.deepEqual(effects[interruption], {
    kind: "interrupt",
    operation: "persistence-interrupt",
    point,
  });
  const laterEffects = effects.slice(interruption + 1);
  assert.equal(
    laterEffects.some((effect) => effect.kind === "write"),
    false,
    "no later host write, next phase, destructive Git, cleanup, handoff, or label effect runs after persistence fails",
  );
}

async function assertReviewedArtifactsSurvive(
  scenario: PlanningProviderScenario,
) {
  const artifacts = await scenario.remoteArtifactContents();
  assert.deepEqual(
    Object.keys(artifacts)
      .map((path) => (path.startsWith("docs/specs/") ? "spec" : "plan"))
      .sort(),
    ["plan", "spec"],
  );
  for (const [path, content] of Object.entries(artifacts)) {
    assert.match(content, /reviewed by a human/u, path);
    assert.equal(
      scenario.carriedArtifactContents()[path],
      content,
      `${path} survives into a later phase`,
    );
  }
}

for (const provider of providers) {
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
        assertNoEffectsAfterInterruption(scenario, point);
        const pullsBeforeRetry = scenario.pulls();
        const historyBeforeRetry = scenario.stateHistory().slice();
        const refsBeforeRetry = await scenario.remoteRefs();
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
        assertOnePublicationPerPhase(scenario);
        for (const pull of pullsBeforeRetry) {
          const adopted = scenario
            .pulls()
            .find((candidate) => candidate.number === pull.number);
          assert.deepEqual(
            adopted && {
              number: adopted.number,
              phase: adopted.phase,
              targetRepository: adopted.targetRepository,
              headRepository: adopted.headRepository,
              baseBranch: adopted.baseBranch,
              headBranch: adopted.headBranch,
              headOid: adopted.headOid,
              body: adopted.body,
            },
            {
              number: pull.number,
              phase: pull.phase,
              targetRepository: pull.targetRepository,
              headRepository: pull.headRepository,
              baseBranch: pull.baseBranch,
              headBranch: pull.headBranch,
              headOid: pull.headOid,
              body: pull.body,
            },
            `retry adopts pull #${pull.number} without replacing it`,
          );
        }
        const refsAfterRetry = await scenario.remoteRefs();
        for (const [ref, oid] of Object.entries(refsBeforeRetry)) {
          if (ref !== "main")
            assert.equal(refsAfterRetry[ref], oid, `retry preserves ${ref}`);
        }
        assert.ok(
          scenario.stateHistory().length > historyBeforeRetry.length,
          "retry persists a later durable state",
        );
        assertMonotonicStateHistory(scenario.stateHistory());
        await assertReviewedArtifactsSurvive(scenario);
        const terminal = await scenario.state();
        const terminalPulls = scenario.pulls();
        const terminalRefs = await scenario.remoteRefs();
        const terminalEffects = writeEffects(scenario.effects());
        const terminalRerun = await scenario.run();
        assert.ok(
          terminalRerun.status === "pr-created" ||
            terminalRerun.status === "blocked" ||
            terminalRerun.status === "no-issue",
          JSON.stringify(terminalRerun),
        );
        assert.deepEqual(await scenario.state(), terminal);
        assert.deepEqual(scenario.pulls(), terminalPulls);
        assert.deepEqual(await scenario.remoteRefs(), terminalRefs);
        assert.deepEqual(writeEffects(scenario.effects()), terminalEffects);
        assert.equal(
          terminalEffects.filter(
            (effect) => effect.operation === "handoff-comment",
          ).length,
          1,
          "handoff is idempotent",
        );
        assert.ok(
          terminalEffects.some((effect) => effect.operation === "cleanup-hook"),
          "cleanup hook completed before terminal state",
        );
        assert.equal(
          terminalEffects.filter((effect) => effect.operation === "done-label")
            .length,
          1,
          "done label is idempotent",
        );
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
