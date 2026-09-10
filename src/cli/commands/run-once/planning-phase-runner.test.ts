import assert from "node:assert/strict";
import test from "node:test";
import { PlanningPhaseArtifactError } from "./planning-phase-artifacts.ts";
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
      commits: [],
      validation: [],
      visualEvidence: [],
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
  assert.equal(implementationRuns, 0);
  assert.equal(finishEffects, 0);
});
