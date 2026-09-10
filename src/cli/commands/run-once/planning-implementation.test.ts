import assert from "node:assert/strict";
import test from "node:test";
import { runPlanningImplementation } from "./planning-implementation.ts";

const oid = (value: string) => value.repeat(40);
const repository = {
  provider: "github-gh" as const,
  host: "github.com",
  owner: "acme",
  repository: "patchmill",
};

function input(overrides: Record<string, unknown> = {}) {
  const phase = {
    kind: "implementation" as const,
    status: "workspace-ready" as const,
    base: {
      remote: "origin",
      baseBranch: "main",
      baseOid: oid("a"),
      artifactCandidates: { spec: [], plan: [] },
    },
    workspace: {
      runId: "123e4567-e89b-42d3-a456-426614174000",
      phase: "implementation" as const,
      identity: { branch: "agent/189", worktreePath: "/worktrees/189" },
      remote: "origin",
      baseBranch: "main",
      baseOid: oid("a"),
      headOid: oid("a"),
      cleanup: { state: "ready" as const },
    },
    artifacts: [],
  };
  const state = {
    version: 1,
    workflowVersion: "planning-pr-v1",
    runId: phase.workspace.runId,
    issueNumber: 189,
    issueTitle: "Implementation",
    gates: { specRequired: false, planRequired: false },
    phases: [phase],
    revision: 0,
    createdAt: "2026-09-10T00:00:00.000Z",
    updatedAt: "2026-09-10T00:00:00.000Z",
  };
  return {
    state,
    phaseIndex: 0,
    lock: {} as never,
    stateStore: { replace: async ({ next }: { next: unknown }) => next },
    host: {
      id: "github-gh" as const,
      resolveTargetRepositoryIdentity: async () => repository,
      resolveRemoteRepositoryIdentity: async () => repository,
      getPullRequest: async () => {
        throw new Error("host transport failure");
      },
    },
    workspaces: {
      inspect: async () => ({
        state: "ready" as const,
        identity: phase.workspace.identity,
        headOid: oid("b"),
        clean: true,
      }),
    },
    git: {
      inspectRemoteHead: async () => ({
        state: "present" as const,
        headOid: oid("b"),
      }),
      assertAncestor: async () => {},
    },
    configuredGit: { baseBranch: "main", allowDirectLand: true },
    runAgent: async () => ({
      status: "pr-created" as const,
      prUrl: "https://github.com/acme/patchmill/pull/189",
      branch: "agent/189",
      commits: [oid("b")],
      validation: [],
    }),
    ...overrides,
  } as never;
}

test("passes the post-prepare durable state and implementation workspace to the agent", async () => {
  let received:
    | { state: unknown; phase: unknown; git: Record<string, unknown> }
    | undefined;
  const result = await runPlanningImplementation(
    input({
      runAgent: async (agentInput: typeof received) => {
        received = agentInput;
        return {
          status: "blocked",
          reason: "stop",
          questions: [],
          commits: [],
          validation: [],
        };
      },
    }),
  );
  assert.equal(result.kind, "blocked");
  assert.equal(
    (received?.phase as { workspace: { identity: { worktreePath: string } } })
      .workspace.identity.worktreePath,
    "/worktrees/189",
  );
  assert.equal(received?.git.allowDirectLand, false);
});

test("propagates host transport failures instead of converting them to validation blockers", async () => {
  await assert.rejects(
    runPlanningImplementation(input()),
    /host transport failure/,
  );
});
