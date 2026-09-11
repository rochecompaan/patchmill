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
    assert.equal(
      current.revision,
      previous.revision + 1,
      `revision ${current.revision} immediately follows ${previous.revision}`,
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

type SnapshotPhaseExpectation = Readonly<{
  kind: PlanningStateSnapshot["phases"][number]["kind"];
  status: PlanningStateSnapshot["phases"][number]["status"];
  cleanupState?: NonNullable<
    PlanningStateSnapshot["phases"][number]["ownership"]
  >["cleanupState"];
  finish?: readonly string[];
}>;
type SnapshotExpectation = Readonly<{
  revision: number;
  phases: readonly SnapshotPhaseExpectation[];
}>;

function phase(
  kind: SnapshotPhaseExpectation["kind"],
  status: SnapshotPhaseExpectation["status"],
  cleanupState?: SnapshotPhaseExpectation["cleanupState"],
  finish?: readonly string[],
): SnapshotPhaseExpectation {
  return {
    kind,
    status,
    ...(cleanupState === undefined ? {} : { cleanupState }),
    ...(finish === undefined ? {} : { finish }),
  };
}

const interruptionStateExpectations: Readonly<
  Record<
    PlanningScenarioFailurePoint,
    Readonly<{
      preDeniedWrite: SnapshotExpectation;
      firstRetry: SnapshotExpectation;
    }>
  >
> = {
  "after-phase-push": {
    preDeniedWrite: {
      revision: 2,
      phases: [
        phase("spec", "workspace-ready", "ready"),
        phase("plan", "pending"),
        phase("implementation", "pending"),
      ],
    },
    firstRetry: {
      revision: 3,
      phases: [
        phase("spec", "branch-pushed", "ready"),
        phase("plan", "pending"),
        phase("implementation", "pending"),
      ],
    },
  },
  "after-planning-pull-request-create": {
    preDeniedWrite: {
      revision: 3,
      phases: [
        phase("spec", "branch-pushed", "ready"),
        phase("plan", "pending"),
        phase("implementation", "pending"),
      ],
    },
    firstRetry: {
      revision: 4,
      phases: [
        phase("spec", "pull-request-open", "ready"),
        phase("plan", "pending"),
        phase("implementation", "pending"),
      ],
    },
  },
  "after-worktree-remove": {
    preDeniedWrite: {
      revision: 4,
      phases: [
        phase("spec", "pull-request-open", "ready"),
        phase("plan", "pending"),
        phase("implementation", "pending"),
      ],
    },
    firstRetry: {
      revision: 5,
      phases: [
        phase("spec", "pull-request-open", "worktree-removed"),
        phase("plan", "pending"),
        phase("implementation", "pending"),
      ],
    },
  },
  "after-local-branch-remove": {
    preDeniedWrite: {
      revision: 5,
      phases: [
        phase("spec", "pull-request-open", "worktree-removed"),
        phase("plan", "pending"),
        phase("implementation", "pending"),
      ],
    },
    firstRetry: {
      revision: 6,
      phases: [
        phase("spec", "pull-request-open", "removed"),
        phase("plan", "pending"),
        phase("implementation", "pending"),
      ],
    },
  },
  "after-planning-merge-observation": {
    preDeniedWrite: {
      revision: 6,
      phases: [
        phase("spec", "pull-request-open", "removed"),
        phase("plan", "pending"),
        phase("implementation", "pending"),
      ],
    },
    firstRetry: {
      revision: 7,
      phases: [
        phase("spec", "complete", "removed"),
        phase("plan", "pending"),
        phase("implementation", "pending"),
      ],
    },
  },
  "after-implementation-pull-request-validation": {
    preDeniedWrite: {
      revision: 17,
      phases: [
        phase("spec", "complete", "removed"),
        phase("plan", "complete", "removed"),
        phase("implementation", "branch-pushed", "ready"),
      ],
    },
    firstRetry: {
      revision: 18,
      phases: [
        phase("spec", "complete", "removed"),
        phase("plan", "complete", "removed"),
        phase("implementation", "pull-request-open", "ready", []),
      ],
    },
  },
  "after-handoff-comment": {
    preDeniedWrite: {
      revision: 20,
      phases: [
        phase("spec", "complete", "removed"),
        phase("plan", "complete", "removed"),
        phase("implementation", "pull-request-open", "ready", [
          "costPublicationCompleted",
          "visualEvidenceValidated",
        ]),
      ],
    },
    firstRetry: {
      revision: 21,
      phases: [
        phase("spec", "complete", "removed"),
        phase("plan", "complete", "removed"),
        phase("implementation", "pull-request-open", "ready", [
          "costPublicationCompleted",
          "handoffCommentPosted",
          "visualEvidenceValidated",
        ]),
      ],
    },
  },
  "after-cleanup-hook": {
    preDeniedWrite: {
      revision: 21,
      phases: [
        phase("spec", "complete", "removed"),
        phase("plan", "complete", "removed"),
        phase("implementation", "pull-request-open", "ready", [
          "costPublicationCompleted",
          "handoffCommentPosted",
          "visualEvidenceValidated",
        ]),
      ],
    },
    firstRetry: {
      revision: 22,
      phases: [
        phase("spec", "complete", "removed"),
        phase("plan", "complete", "removed"),
        phase("implementation", "pull-request-open", "ready", [
          "cleanupHookCompleted",
          "costPublicationCompleted",
          "handoffCommentPosted",
          "visualEvidenceValidated",
        ]),
      ],
    },
  },
  "after-implementation-worktree-remove": {
    preDeniedWrite: {
      revision: 22,
      phases: [
        phase("spec", "complete", "removed"),
        phase("plan", "complete", "removed"),
        phase("implementation", "pull-request-open", "ready", [
          "cleanupHookCompleted",
          "costPublicationCompleted",
          "handoffCommentPosted",
          "visualEvidenceValidated",
        ]),
      ],
    },
    firstRetry: {
      revision: 23,
      phases: [
        phase("spec", "complete", "removed"),
        phase("plan", "complete", "removed"),
        phase("implementation", "pull-request-open", "worktree-removed", [
          "cleanupHookCompleted",
          "costPublicationCompleted",
          "handoffCommentPosted",
          "visualEvidenceValidated",
        ]),
      ],
    },
  },
  "after-done-label": {
    preDeniedWrite: {
      revision: 25,
      phases: [
        phase("spec", "complete", "removed"),
        phase("plan", "complete", "removed"),
        phase("implementation", "pull-request-open", "removed", [
          "cleanupHookCompleted",
          "costPublicationCompleted",
          "doneLabelEnsured",
          "handoffCommentPosted",
          "visualEvidenceValidated",
        ]),
      ],
    },
    firstRetry: {
      revision: 26,
      phases: [
        phase("spec", "complete", "removed"),
        phase("plan", "complete", "removed"),
        phase("implementation", "pull-request-open", "removed", [
          "cleanupHookCompleted",
          "costPublicationCompleted",
          "doneLabelApplied",
          "doneLabelEnsured",
          "handoffCommentPosted",
          "visualEvidenceValidated",
        ]),
      ],
    },
  },
};

function assertExactSnapshot(
  actual: PlanningStateSnapshot,
  expected: SnapshotExpectation,
) {
  assert.equal(actual.revision, expected.revision);
  assert.deepEqual(
    actual.phases.map((item) =>
      phase(item.kind, item.status, item.ownership?.cleanupState, item.finish),
    ),
    expected.phases,
  );
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

function assertEffectUsesSavedOwnership(
  effect: PlanningScenarioEffect,
  snapshot: PlanningStateSnapshot,
) {
  if (effect.kind !== "write" || !("phase" in effect)) return;
  const saved = snapshot.phases.find((phase) => phase.kind === effect.phase);
  assert.ok(saved?.ownership, `${effect.operation} has saved ownership`);
  assert.equal(effect.branch, saved.ownership.branch);
  if ("worktreePath" in effect)
    assert.equal(effect.worktreePath, saved.ownership.worktreePath);
  if ("ref" in effect)
    assert.equal(effect.ref, `refs/heads/${saved.ownership.branch}`);
}

function assertCleanupEffectsUseSavedOwnership(
  scenario: PlanningProviderScenario,
) {
  const terminal = scenario.stateHistory().at(-1)!;
  const cleanupEffects = writeEffects(scenario.effects()).filter(
    (effect) =>
      effect.operation === "workspace-remove" ||
      effect.operation === "branch-remove" ||
      effect.operation === "cleanup-hook",
  );
  for (const effect of cleanupEffects)
    assertEffectUsesSavedOwnership(effect, terminal);
  assert.deepEqual(
    cleanupEffects
      .filter((effect) => effect.operation === "workspace-remove")
      .map((effect) => effect.phase),
    ["spec", "plan", "implementation"],
    "worktree cleanup retains each saved phase instead of classifying plan as spec",
  );
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
  const preceding = effects[interruption - 1];
  assert.ok(preceding, "the interrupted write has a preceding effect record");
  const laterEffects = effects.slice(interruption + 1);
  assert.equal(
    laterEffects.some((effect) => effect.kind === "write"),
    false,
    "no later host write, next phase, destructive Git, cleanup, handoff, or label effect runs after persistence fails",
  );
  return preceding;
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
        const historyBeforeRetry = scenario.stateHistory().slice();
        const preDeniedWrite = historyBeforeRetry.at(-1);
        assert.ok(preDeniedWrite, "a durable state precedes the denied write");
        assertExactSnapshot(
          preDeniedWrite,
          interruptionStateExpectations[point].preDeniedWrite,
        );
        assertEffectUsesSavedOwnership(
          assertNoEffectsAfterInterruption(scenario, point),
          preDeniedWrite,
        );
        const pullsBeforeRetry = scenario.pulls();
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
        assertExactSnapshot(
          scenario.stateHistory()[historyBeforeRetry.length]!,
          interruptionStateExpectations[point].firstRetry,
        );
        assertMonotonicStateHistory(scenario.stateHistory());
        assertCleanupEffectsUseSavedOwnership(scenario);
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
