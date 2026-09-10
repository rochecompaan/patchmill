import assert from "node:assert/strict";
import test from "node:test";
import { finishPlanningImplementation } from "./planning-finish.ts";

const oid = (v: string) => v.repeat(40);
function state(
  finish: Record<string, true> = {},
  cleanup: "ready" | "worktree-removed" | "removed" = "ready",
) {
  const workspace = {
    runId: "123e4567-e89b-42d3-a456-426614174000",
    phase: "implementation" as const,
    identity: { branch: "agent/189", worktreePath: ".worktrees/189" },
    remote: "origin",
    baseBranch: "main",
    baseOid: oid("a"),
    headOid: oid("b"),
    cleanup:
      cleanup === "ready"
        ? { state: "ready" as const }
        : { state: cleanup, pushedHeadOid: oid("b") },
  };
  return {
    version: 1,
    workflowVersion: "planning-pr-v1",
    runId: workspace.runId,
    issueNumber: 189,
    issueTitle: "Finish",
    gates: { specRequired: false, planRequired: false },
    revision: 0,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    phases: [
      {
        kind: "implementation" as const,
        status: "pull-request-open" as const,
        base: {
          remote: "origin",
          baseBranch: "main",
          baseOid: oid("a"),
          artifactCandidates: { spec: [], plan: [] },
        },
        workspace,
        artifacts: [],
        publication: {
          targetRepository: {
            provider: "github-gh" as const,
            host: "github.com",
            owner: "a",
            repository: "b",
          },
          headRepository: {
            provider: "github-gh" as const,
            host: "github.com",
            owner: "a",
            repository: "b",
          },
          baseBranch: "main",
          headBranch: "agent/189",
          headOid: oid("b"),
        },
        pullRequest: {
          reference: {
            targetRepository: {
              provider: "github-gh" as const,
              host: "github.com",
              owner: "a",
              repository: "b",
            },
            number: 1,
          },
          url: "https://github.com/a/b/pull/1",
        },
        implementation: {
          status: "pr-created" as const,
          prUrl: "https://github.com/a/b/pull/1",
          branch: "agent/189",
          commits: [oid("b")],
          validation: [],
          visualEvidence: [],
        },
        finish,
      },
    ],
  } as never;
}
function input(initial = state(), fail?: string) {
  const events: string[] = [];
  const checkpoints: unknown[] = [];
  return {
    events,
    checkpoints,
    value: {
      state: initial,
      phaseIndex: 0,
      lock: {} as never,
      stateStore: {
        replace: async ({ next }: { next: unknown }) => {
          checkpoints.push(next);
          return next;
        },
      },
      workspaces: {
        removeWorktree: async () => {
          events.push("worktree");
        },
        removeBranch: async () => {
          events.push("branch");
        },
      },
      effects: Object.fromEntries(
        [
          "publishCost",
          "validateVisualEvidence",
          "postHandoff",
          "cleanupHook",
          "ensureDoneLabel",
          "applyDoneLabels",
        ].map((name) => [
          name,
          async () => {
            events.push(name);
            if (name === fail) throw new Error(name);
          },
        ]),
      ) as never,
    },
  };
}
test("finishes in durable external-effect and cleanup order", async () => {
  const run = input();
  const result = await finishPlanningImplementation(run.value);
  assert.equal(result.state.phases[0]?.status, "complete");
  assert.deepEqual(run.events, [
    "publishCost",
    "validateVisualEvidence",
    "postHandoff",
    "cleanupHook",
    "worktree",
    "branch",
    "ensureDoneLabel",
    "applyDoneLabels",
  ]);
  assert.equal(run.checkpoints.length, 10);
});
test("does not rerun an interrupted cleanup hook or later effects", async () => {
  const run = input(
    state({
      costPublicationCompleted: true,
      visualEvidenceValidated: true,
      handoffCommentPosted: true,
      cleanupHookStarted: true,
    }),
  );
  await assert.rejects(
    finishPlanningImplementation(run.value),
    /operator repair/,
  );
  assert.deepEqual(run.events, []);
});
test("effect failure prevents later effects", async () => {
  const run = input(state(), "validateVisualEvidence");
  await assert.rejects(
    finishPlanningImplementation(run.value),
    /validateVisualEvidence/,
  );
  assert.deepEqual(run.events, ["publishCost", "validateVisualEvidence"]);
});
