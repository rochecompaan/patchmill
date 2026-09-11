import assert from "node:assert/strict";
import test from "node:test";
import { PlanningImplementationBaseError } from "./planning-implementation-base.ts";
import { PlanningPhaseArtifactError } from "./planning-phase-artifacts.ts";
import { PlanningPublicationGitError } from "../../../git/planning-publication-git.ts";
import { runPlanningPhase } from "./planning-phase-runner.ts";

const oid = (character: string) => character.repeat(40);
const issue = { number: 189, title: "Planning runner", state: "open" } as never;
const base = {
  remote: "origin",
  baseBranch: "main",
  baseOid: oid("a"),
  artifactCandidates: { spec: [], plan: [] },
};
const workspace = {
  runId: "123e4567-e89b-42d3-a456-426614174000",
  phase: "implementation",
  identity: {
    branch: "agent/issue-189-implementation",
    worktreePath: ".worktrees/issue-189-implementation",
  },
  remote: "origin",
  baseBranch: "main",
  baseOid: oid("a"),
  headOid: oid("a"),
  cleanup: { state: "ready" },
};

function state(phase: object) {
  return {
    version: 1,
    workflowVersion: "planning-pr-v1",
    runId: workspace.runId,
    issueNumber: 189,
    issueTitle: "Planning runner",
    gates: { specRequired: false, planRequired: false },
    phases: [phase],
    revision: 0,
    createdAt: "2026-09-10T00:00:00.000Z",
    updatedAt: "2026-09-10T00:00:00.000Z",
  } as never;
}

function input(overrides: Record<string, unknown> = {}) {
  const initial = state({ kind: "implementation", status: "pending" });
  return {
    state: initial,
    phaseIndex: 0,
    phase: {
      kind: "implementation",
      artifactKinds: [],
      pullRequestRequired: true,
    },
    issue,
    lock: {} as never,
    config: {
      repoRoot: "/repo",
      remote: "origin",
      baseBranch: "main",
      specsDir: "docs/specs",
      plansDir: "docs/plans",
      projectPolicy: {} as never,
      skills: {} as never,
      triageLabels: { ready: "agent-ready", needsInfo: "needs-info" },
      workspaceIdentity: () => workspace.identity,
    },
    stateStore: {
      replace: async ({ next }: { next: unknown }) => next,
    },
    host: {} as never,
    remoteBase: { fetch: async () => base },
    publicationGit: {} as never,
    workspaces: {
      prepare: async () => ({ workspace, base }),
      resume: async () => ({ state: "ready", headOid: oid("a"), clean: true }),
    } as never,
    artifactAgent: {} as never,
    operations: {
      reconcile: async () => ({
        state: initial,
        outcome: {
          kind: "review-pending",
          pullRequest: { status: "open", url: "https://example.test/pr/1" },
        },
      }),
      resolveArtifacts: () => ({
        kind: "workspace-required",
        artifacts: [],
        missing: [],
      }),
      runArtifacts: async ({ current }: { current: unknown }) => ({
        kind: "workspace-ready",
        phase: current,
      }),
      publish: async () => {
        throw new Error("unexpected publish");
      },
      runImplementation: async () => ({ kind: "validated", state: initial }),
      finishImplementation: async () => ({
        state: initial,
        result: { status: "pr-created" },
      }),
    },
    now: () => new Date("2026-09-10T00:00:01.000Z"),
    ...overrides,
  } as never;
}

test("keeps a later base artifact while preparing implementation work", async () => {
  let artifacts: string[] | undefined;
  const result = await runPlanningPhase(
    input({
      planOnly: true,
      phase: {
        kind: "implementation",
        artifactKinds: ["spec", "plan"],
        pullRequestRequired: true,
      },
      remoteBase: {
        fetch: async () => ({
          ...base,
          artifactCandidates: {
            spec: [],
            plan: ["docs/plans/example.md"],
          },
        }),
      },
      operations: {
        resolveArtifacts: () => ({
          kind: "workspace-required",
          artifacts: [
            {
              kind: "plan",
              path: "docs/plans/example.md",
              source: "remote-base",
              commitOid: oid("a"),
            },
          ],
          missing: ["spec"],
        }),
        runArtifacts: async ({
          current,
        }: {
          current: { artifacts: unknown[] };
        }) => {
          artifacts = current.artifacts.map(
            (artifact) => (artifact as { kind: string }).kind,
          );
          return { kind: "workspace-ready", phase: current };
        },
      },
    }),
  );
  assert.equal(result.kind, "stopped");
  assert.deepEqual(artifacts, ["plan"]);
});

test("blocks dirty resumed workspaces before planning or implementation agents", async () => {
  for (const kind of ["spec", "plan", "implementation"] as const) {
    let artifactRuns = 0;
    let implementationRuns = 0;
    const result = await runPlanningPhase(
      input({
        state: state({
          kind,
          status: "workspace-ready",
          base,
          workspace: { ...workspace, phase: kind },
          artifacts: [],
        }),
        phase: { kind, artifactKinds: [], pullRequestRequired: true },
        workspaces: {
          resume: async () => ({
            state: "ready",
            identity: workspace.identity,
            headOid: oid("a"),
            clean: false,
          }),
        } as never,
        operations: {
          runArtifacts: async () => {
            artifactRuns += 1;
            throw new Error("unexpected artifact agent");
          },
          runImplementation: async () => {
            implementationRuns += 1;
            throw new Error("unexpected implementation agent");
          },
        },
      }),
    );
    assert.equal(result.kind, "blocked");
    if (result.kind === "blocked")
      assert.equal(result.result.reason, "planning-workspace-dirty");
    assert.equal(artifactRuns, 0);
    assert.equal(implementationRuns, 0);
  }
});

test("reconciles a published planning branch before any workspace effect", async () => {
  const published = state({ kind: "spec", status: "branch-pushed" });
  let prepared = false;
  const result = await runPlanningPhase(
    input({
      state: published,
      phase: {
        kind: "spec",
        artifactKinds: ["spec"],
        pullRequestRequired: true,
      },
      workspaces: {
        prepare: async () => ((prepared = true), {}),
        resume: async () => ({}),
      },
      operations: {
        reconcile: async () => ({
          state: published,
          outcome: {
            kind: "review-pending",
            pullRequest: { status: "open", url: "https://example.test/pr/1" },
          },
        }),
      },
    }),
  );
  assert.deepEqual(result, {
    kind: "review-pending",
    state: published,
    prUrl: "https://example.test/pr/1",
  });
  assert.equal(prepared, false);
});

test("maps a missing planning pull request to a sanitized blocker", async () => {
  const published = state({ kind: "plan", status: "pull-request-open" });
  const result = await runPlanningPhase(
    input({
      state: published,
      phase: {
        kind: "plan",
        artifactKinds: ["plan"],
        pullRequestRequired: true,
      },
      operations: {
        reconcile: async () => ({
          state: published,
          outcome: { kind: "missing" },
        }),
      },
    }),
  );
  assert.deepEqual(result, {
    kind: "blocked",
    state: published,
    result: {
      status: "blocked",
      reason: "planning-pull-request-missing",
      questions: [],
      commits: [],
      validation: [],
    },
  });
});

test("blocks ambiguous base artifacts without starting a workspace", async () => {
  let prepared = false;
  const result = await runPlanningPhase(
    input({
      phase: {
        kind: "spec",
        artifactKinds: ["spec"],
        pullRequestRequired: true,
      },
      state: state({ kind: "spec", status: "pending" }),
      workspaces: {
        prepare: async () => ((prepared = true), { workspace, base }),
      } as never,
      operations: {
        resolveArtifacts: () => {
          throw new PlanningPhaseArtifactError("ambiguous-base-artifact");
        },
      },
    }),
  );
  // The production error is classified by its stable reason before Git effects.
  assert.equal(prepared, false);
  assert.equal(result.kind, "blocked");
});

test("checkpoints a planning phase satisfied by the fetched base without a pull request", async () => {
  const initial = state({ kind: "spec", status: "pending" });
  const replacements: unknown[] = [];
  const result = await runPlanningPhase(
    input({
      state: initial,
      phase: {
        kind: "spec",
        artifactKinds: ["spec"],
        pullRequestRequired: true,
      },
      stateStore: {
        replace: async ({ next }: { next: unknown }) => {
          replacements.push(next);
          return next;
        },
      },
      operations: {
        resolveArtifacts: () => ({
          kind: "satisfied-by-base",
          artifacts: [
            {
              kind: "spec",
              path: "docs/specs/issue-189.md",
              source: "remote-base",
              commitOid: oid("a"),
            },
          ],
        }),
      },
    }),
  );
  assert.equal(result.kind, "advanced");
  assert.equal(replacements.length, 1);
  assert.equal(
    (replacements[0] as { phases: Array<{ status: string }> }).phases[0]!
      .status,
    "complete",
  );
});

test("plan-only stops before creating an implementation workspace when its artifacts are durable", async () => {
  let prepared = false;
  const result = await runPlanningPhase(
    input({
      planOnly: true,
      workspaces: {
        prepare: async () => ((prepared = true), { workspace, base }),
      } as never,
      operations: {
        resolveArtifacts: () => ({
          kind: "satisfied-by-base",
          artifacts: [
            {
              kind: "plan",
              path: "docs/plans/issue-189.md",
              source: "remote-base",
              commitOid: oid("a"),
            },
          ],
        }),
      },
    }),
  );
  assert.equal(result.kind, "stopped");
  assert.equal(prepared, false);
});

function stateWithCompletedSpec() {
  const artifactPath = "docs/specs/2026-09-10-issue-189-planning-runner.md";
  return {
    ...state({ kind: "implementation", status: "pending" }),
    gates: { specRequired: true, planRequired: false },
    phases: [
      {
        kind: "spec",
        status: "complete",
        base: {
          ...base,
          artifactCandidates: { spec: [artifactPath], plan: [] },
        },
        artifacts: [
          {
            kind: "spec",
            path: artifactPath,
            commitOid: oid("c"),
            source: "remote-base",
          },
        ],
        completion: {
          kind: "merged-pull-request",
          mergeOid: oid("b"),
          mergedBaseOid: oid("c"),
        },
      },
      { kind: "implementation", status: "pending" },
    ],
  } as never;
}

test("fails closed before plan-only pause when a reviewed artifact is deleted, renamed, or ambiguous", async () => {
  const artifactPath = "docs/specs/2026-09-10-issue-189-planning-runner.md";
  for (const [name, candidates, reason] of [
    ["deleted", [], "prior-artifact-missing"],
    [
      "renamed",
      ["docs/specs/2026-09-10-issue-189-renamed.md"],
      "prior-artifact-mismatch",
    ],
    [
      "ambiguous",
      [artifactPath, "docs/specs/2026-09-10-issue-189-competing.md"],
      "prior-artifact-ambiguous",
    ],
  ] as const) {
    let prepared = false;
    await assert.rejects(
      runPlanningPhase(
        input({
          state: stateWithCompletedSpec(),
          phaseIndex: 1,
          planOnly: true,
          remoteBase: {
            fetch: async () => ({
              ...base,
              baseOid: oid("d"),
              artifactCandidates: { spec: candidates, plan: [] },
            }),
          },
          publicationGit: {
            assertAncestor: async () => undefined,
            assertRegularFiles: async () => undefined,
          },
          workspaces: {
            prepare: async () => ((prepared = true), { workspace, base }),
          },
        }),
      ),
      (error: unknown) =>
        error instanceof PlanningImplementationBaseError &&
        error.reason === reason,
      name,
    );
    assert.equal(prepared, false, name);
  }
});

test("fails closed when reviewed planning base history is rewritten before implementation", async () => {
  let prepared = false;
  const ancestors: string[] = [];
  await assert.rejects(
    runPlanningPhase(
      input({
        state: stateWithCompletedSpec(),
        phaseIndex: 1,
        remoteBase: {
          fetch: async () => ({
            ...base,
            baseOid: oid("d"),
            artifactCandidates: {
              spec: ["docs/specs/2026-09-10-issue-189-planning-runner.md"],
              plan: [],
            },
          }),
        },
        publicationGit: {
          assertAncestor: async ({ ancestorOid }: { ancestorOid: string }) => {
            ancestors.push(ancestorOid);
            if (ancestorOid === oid("c"))
              throw new PlanningPublicationGitError("ancestry", "not-ancestor");
          },
          assertRegularFiles: async () => {
            throw new Error("unexpected artifact verification");
          },
        },
        workspaces: {
          prepare: async () => ((prepared = true), { workspace, base }),
        },
      }),
    ),
    (error: unknown) =>
      error instanceof PlanningPublicationGitError &&
      error.reason === "not-ancestor",
  );
  assert.deepEqual(ancestors, [oid("a"), oid("b"), oid("c")]);
  assert.equal(prepared, false);
});

test("fails closed when a plan-only workspace resumes after planning artifact deletion", async () => {
  const paused = stateWithCompletedSpec();
  paused.phases[1] = {
    kind: "implementation",
    status: "workspace-ready",
    base,
    workspace,
    artifacts: [],
  };
  let resumed = false;
  await assert.rejects(
    runPlanningPhase(
      input({
        state: paused,
        phaseIndex: 1,
        remoteBase: {
          fetch: async () => ({
            ...base,
            baseOid: oid("d"),
            artifactCandidates: { spec: [], plan: [] },
          }),
        },
        publicationGit: {
          assertAncestor: async () => {
            throw new Error("unexpected ancestry verification");
          },
          assertRegularFiles: async () => {
            throw new Error("unexpected artifact verification");
          },
        },
        workspaces: {
          resume: async () => ((resumed = true), { clean: true }),
        },
      }),
    ),
    (error: unknown) =>
      error instanceof PlanningImplementationBaseError &&
      error.reason === "prior-artifact-missing",
  );
  assert.equal(resumed, false);
});

test("rechecks planning anchors before implementation resumes after a plan-only pause", async () => {
  const paused = stateWithCompletedSpec();
  paused.phases[1] = {
    kind: "implementation",
    status: "workspace-ready",
    base,
    workspace,
    artifacts: [],
  };
  let resumed = false;
  let implementationRuns = 0;
  await assert.rejects(
    runPlanningPhase(
      input({
        state: paused,
        phaseIndex: 1,
        remoteBase: {
          fetch: async () => ({
            ...base,
            baseOid: oid("d"),
            artifactCandidates: {
              spec: ["docs/specs/2026-09-10-issue-189-planning-runner.md"],
              plan: [],
            },
          }),
        },
        publicationGit: {
          assertAncestor: async ({ ancestorOid }: { ancestorOid: string }) => {
            if (ancestorOid === oid("c"))
              throw new PlanningPublicationGitError("ancestry", "not-ancestor");
          },
          assertRegularFiles: async () => undefined,
        },
        workspaces: {
          resume: async () => ((resumed = true), { clean: true }),
        },
        operations: {
          runImplementation: async () => {
            implementationRuns += 1;
            throw new Error("unexpected implementation");
          },
        },
      }),
    ),
    (error: unknown) =>
      error instanceof PlanningPublicationGitError &&
      error.reason === "not-ancestor",
  );
  assert.equal(resumed, false);
  assert.equal(implementationRuns, 0);
});

test("verifies reviewed planning evidence before a plan-only implementation pause", async () => {
  const calls: Array<{ kind: string; value: string | string[] }> = [];
  const result = await runPlanningPhase(
    input({
      state: stateWithCompletedSpec(),
      phaseIndex: 1,
      planOnly: true,
      remoteBase: {
        fetch: async () => ({
          ...base,
          baseOid: oid("d"),
          artifactCandidates: {
            spec: ["docs/specs/2026-09-10-issue-189-planning-runner.md"],
            plan: [],
          },
        }),
      },
      publicationGit: {
        assertAncestor: async ({ ancestorOid }: { ancestorOid: string }) => {
          calls.push({ kind: "ancestor", value: ancestorOid });
        },
        assertRegularFiles: async ({ paths }: { paths: string[] }) => {
          calls.push({ kind: "regular", value: paths });
        },
      },
      operations: {
        resolveArtifacts: () => ({ kind: "satisfied-by-base", artifacts: [] }),
      },
    }),
  );
  assert.equal(result.kind, "stopped");
  assert.deepEqual(calls, [
    { kind: "ancestor", value: oid("a") },
    { kind: "ancestor", value: oid("b") },
    { kind: "ancestor", value: oid("c") },
    {
      kind: "regular",
      value: ["docs/specs/2026-09-10-issue-189-planning-runner.md"],
    },
  ]);
});

test("checkpoints implementation planning artifacts then stops before implementation code", async () => {
  const initial = state({
    kind: "implementation",
    status: "workspace-ready",
    base,
    workspace,
    artifacts: [],
  });
  let implementations = 0;
  const result = await runPlanningPhase(
    input({
      state: initial,
      planOnly: true,
      operations: {
        runImplementation: async () => {
          implementations += 1;
          throw new Error("unexpected implementation");
        },
      },
    }),
  );
  assert.equal(result.kind, "stopped");
  assert.equal(implementations, 0);
});

test("plan-only stops resumed branch-pushed and pull-request-open implementation phases", async () => {
  for (const [name, phase] of [
    [
      "branch-pushed",
      {
        kind: "implementation",
        status: "branch-pushed",
        base,
        workspace,
        artifacts: [],
        publication: {},
        implementation: {},
      },
    ],
    [
      "pull-request-open",
      {
        kind: "implementation",
        status: "pull-request-open",
        base,
        workspace,
        artifacts: [],
        publication: {},
        pullRequest: {},
        implementation: {},
        finish: {},
      },
    ],
  ] as const) {
    const initial = state(phase);
    let implementationRuns = 0;
    let finishRuns = 0;
    const result = await runPlanningPhase(
      input({
        state: initial,
        planOnly: true,
        operations: {
          runImplementation: async () => {
            implementationRuns += 1;
            throw new Error("unexpected implementation");
          },
          finishImplementation: async () => {
            finishRuns += 1;
            throw new Error("unexpected finish");
          },
        },
      }),
    );
    assert.deepEqual(
      result,
      { kind: "stopped", state: initial, reason: "plan-only" },
      name,
    );
    assert.equal(implementationRuns, 0, name);
    assert.equal(finishRuns, 0, name);
  }
});

test("resumes branch-pushed and pull-request-open implementation phases without plan-only", async () => {
  for (const [name, phase, expectedImplementationRuns] of [
    [
      "branch-pushed",
      {
        kind: "implementation",
        status: "branch-pushed",
        base,
        workspace,
        artifacts: [],
        publication: {},
        implementation: {},
      },
      1,
    ],
    [
      "pull-request-open",
      {
        kind: "implementation",
        status: "pull-request-open",
        base,
        workspace,
        artifacts: [],
        publication: {},
        pullRequest: {},
        implementation: {},
        finish: {},
      },
      0,
    ],
  ] as const) {
    const initial = state(phase);
    let implementationRuns = 0;
    let finishRuns = 0;
    const result = await runPlanningPhase(
      input({
        state: initial,
        implementation: {
          implementation: {} as never,
          finish: () => ({}) as never,
        },
        operations: {
          runImplementation: async () => {
            implementationRuns += 1;
            return { kind: "validated", state: initial };
          },
          finishImplementation: async () => {
            finishRuns += 1;
            return { state: initial, result: { status: "pr-created" } };
          },
        },
      }),
    );
    assert.equal(result.kind, "complete", name);
    assert.equal(implementationRuns, expectedImplementationRuns, name);
    assert.equal(finishRuns, 1, name);
  }
});

test("finishes implementation only after the implementation runner validates it", async () => {
  const initial = state({
    kind: "implementation",
    status: "workspace-ready",
    base,
    workspace,
    artifacts: [],
  });
  const validated = {
    ...initial,
    revision: 1,
    phases: [
      {
        kind: "implementation",
        status: "pull-request-open",
        base,
        workspace,
        artifacts: [],
        publication: {},
        pullRequest: {},
        implementation: {},
        finish: {},
      },
    ],
  } as never;
  let finished = false;
  const result = await runPlanningPhase(
    input({
      state: initial,
      implementation: {
        implementation: {} as never,
        finish: () => ({}) as never,
      },
      operations: {
        runImplementation: async () => ({
          kind: "validated",
          state: validated,
        }),
        finishImplementation: async ({
          state: received,
        }: {
          state: unknown;
        }) => {
          finished = received === validated;
          return { state: validated, result: { status: "pr-created" } };
        },
      },
    }),
  );
  assert.equal(result.kind, "complete");
  assert.equal(finished, true);
});

test("returns durable terminal implementation result without rerunning implementation", async () => {
  const terminal = state({
    kind: "implementation",
    status: "complete",
    workspace,
    artifacts: [],
    pullRequest: { url: "https://example.test/pr/189" },
    implementation: {
      branch: workspace.identity.branch,
      commits: ["abc123"],
      validation: ["npm test"],
      reviewSummary: "approved",
      landingDecision: "no-direct-land",
      visualEvidence: [
        {
          screenshotPath: "artifacts/terminal.png",
          caption: "terminal",
          referencePaths: ["reference.png"],
          url: "https://example.test/evidence",
        },
      ],
    },
  });
  let implementationRuns = 0;
  let finishEffects = 0;
  const result = await runPlanningPhase(
    input({
      state: terminal,
      implementation: {
        implementation: {},
        finish: () => {
          finishEffects += 1;
          return {};
        },
      },
      operations: {
        runImplementation: async () => ((implementationRuns += 1), {}),
        finishImplementation: async ({
          state: durable,
        }: {
          state: unknown;
        }) => ({
          state: durable,
          result: {
            status: "pr-created",
            prUrl: "https://example.test/pr/189",
            branch: workspace.identity.branch,
            commits: [],
            validation: [],
          },
        }),
      },
    }),
  );
  assert.equal(result.kind, "complete");
  assert.deepEqual(result.result, {
    status: "pr-created",
    prUrl: "https://example.test/pr/189",
    branch: workspace.identity.branch,
    commits: ["abc123"],
    validation: ["npm test"],
    reviewSummary: "approved",
    landingDecision: "no-direct-land",
    visualEvidence: [
      {
        screenshotPath: "artifacts/terminal.png",
        caption: "terminal",
        referencePaths: ["reference.png"],
        url: "https://example.test/evidence",
      },
    ],
  });
  assert.notEqual(
    result.result.visualEvidence[0]?.referencePaths,
    terminal.phases[0]!.implementation.visualEvidence[0]!.referencePaths,
  );
  assert.equal(implementationRuns, 0);
  assert.equal(finishEffects, 0);
});

test("passes fresh versus resumed workspace context to implementation", async () => {
  const seen: boolean[] = [];
  const run = async (initial: unknown) =>
    runPlanningPhase(
      input({
        state: initial,
        implementation: { implementation: {}, finish: () => ({}) },
        operations: {
          runImplementation: async ({
            state: durable,
            workspaceCreated,
          }: {
            state: unknown;
            workspaceCreated?: boolean;
          }) => {
            seen.push(workspaceCreated === true);
            return { kind: "validated", state: durable };
          },
          finishImplementation: async ({
            state: durable,
          }: {
            state: unknown;
          }) => ({
            state: durable,
            result: { status: "pr-created" },
          }),
        },
      }),
    );
  await run(state({ kind: "implementation", status: "pending" }));
  await run(
    state({
      kind: "implementation",
      status: "workspace-ready",
      base,
      workspace,
      artifacts: [],
    }),
  );
  assert.deepEqual(seen, [true, false]);
});
