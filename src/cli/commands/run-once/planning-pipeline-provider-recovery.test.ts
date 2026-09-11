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

function countMatchingEffects(effects: readonly string[], expression: RegExp) {
  return effects.filter((effect) => expression.test(effect)).length;
}

test("known provider-write effects exclude recovery reads", () => {
  assert.deepEqual(
    [
      "gh pr create --body body",
      "gh pr edit 1 --body body",
      "gh issue comment 190 --body body",
      "gh issue edit 190 --add-label agent-done",
      "tea comment 190 -- body",
      "tea issues edit 190 --add-labels agent-done",
      "tea api /repos/acme/patchmill/pulls --method POST",
      "tea api /repos/acme/patchmill/pulls/1 --method PATCH",
      "git push --porcelain --no-force -- origin head:branch",
      "git worktree remove -- workspace",
      "git branch -D issue-190",
      "git update-ref -d refs/heads/issue-190",
      "pi -p @prompt",
      "bash cleanup.sh",
      "fixture implementation-push agent/issue-190",
      "gh pr view 1 --json number",
      "tea api /repos/acme/patchmill/pulls/1 --include",
      "git ls-remote --exit-code --heads -- origin branch",
      "git worktree list --porcelain -z",
    ].map((effect) => [effect, isKnownHostWriteEffect(effect)]),
    [
      ["gh pr create --body body", true],
      ["gh pr edit 1 --body body", true],
      ["gh issue comment 190 --body body", true],
      ["gh issue edit 190 --add-label agent-done", true],
      ["tea comment 190 -- body", true],
      ["tea issues edit 190 --add-labels agent-done", true],
      ["tea api /repos/acme/patchmill/pulls --method POST", true],
      ["tea api /repos/acme/patchmill/pulls/1 --method PATCH", true],
      ["git push --porcelain --no-force -- origin head:branch", true],
      ["git worktree remove -- workspace", true],
      ["git branch -D issue-190", true],
      ["git update-ref -d refs/heads/issue-190", true],
      ["pi -p @prompt", true],
      ["bash cleanup.sh", true],
      ["fixture implementation-push agent/issue-190", true],
      ["gh pr view 1 --json number", false],
      ["tea api /repos/acme/patchmill/pulls/1 --include", false],
      ["git ls-remote --exit-code --heads -- origin branch", false],
      ["git worktree list --porcelain -z", false],
    ],
  );
});

function isKnownHostWriteEffect(effect: string) {
  return /^(?:fixture implementation-push |pi |bash |git (?:push|worktree (?:remove|prune)|branch (?:-D|--delete)|update-ref -d|clean|reset --hard)|gh (?:pr (?:create|edit)|issue (?:comment|edit))|tea (?:comment|issues edit|api .*--method (?:POST|PATCH)(?:\s|$)))/u.test(
    effect,
  );
}

function durableEffects(effects: readonly string[]) {
  return effects.filter(isKnownHostWriteEffect);
}

function assertOnePublicationPerPhase(scenario: PlanningProviderScenario) {
  const effects = scenario.effects();
  for (const phase of ["spec", "plan", "implementation"] as const) {
    const pushes =
      phase === "implementation"
        ? countMatchingEffects(effects, /^fixture implementation-push /u)
        : countMatchingEffects(
            effects,
            new RegExp(`:refs/heads/[^ ]*-${phase}(?:\\s|$)`, "u"),
          );
    assert.equal(pushes, 1, `${phase} has one remote branch update`);
    assert.equal(
      scenario.pulls().filter((pull) => pull.phase === phase).length,
      1,
      `${phase} has one pull request`,
    );
  }
}

function assertNoEffectsAfterInterruption(scenario: PlanningProviderScenario) {
  const effects = scenario.effects();
  const interruption = effects.findLastIndex((effect) =>
    effect.startsWith("fixture interrupt "),
  );
  assert.notEqual(
    interruption,
    -1,
    "the requested effect interrupted state persistence",
  );
  const laterEffects = effects.slice(interruption + 1);
  assert.equal(
    laterEffects.some(isKnownHostWriteEffect),
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
        assertNoEffectsAfterInterruption(scenario);
        const pullsBeforeRetry = scenario.pulls();
        const effectsBeforeRetry = scenario.effects();
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
          scenario.effects().length >= effectsBeforeRetry.length,
          "recovery may only append effects after persistence is restored",
        );
        await assertReviewedArtifactsSurvive(scenario);
        const terminal = await scenario.state();
        const terminalPulls = scenario.pulls();
        const terminalRefs = await scenario.remoteRefs();
        const terminalEffects = durableEffects(scenario.effects());
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
        assert.deepEqual(durableEffects(scenario.effects()), terminalEffects);
        assert.equal(
          countMatchingEffects(terminalEffects, /Automation handoff ready/u),
          1,
          "handoff is idempotent",
        );
        assert.ok(
          countMatchingEffects(terminalEffects, /^bash cleanup\.sh$/u) >= 1,
          "cleanup hook completed before terminal state",
        );
        assert.equal(
          countMatchingEffects(terminalEffects, /agent-done/u),
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
