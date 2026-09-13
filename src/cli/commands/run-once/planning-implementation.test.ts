import assert from "node:assert/strict";
import test from "node:test";
import { PlanningPublicationGitError } from "../../../git/planning-publication-git.ts";
import { validatePlanningState } from "../../../workflow/planning-state.ts";
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
    configuredGit: {
      remote: "origin",
      baseBranch: "main",
      allowDirectLand: true,
    },
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

test("blocks remote and base configuration drift before invoking a resumed implementation agent", async () => {
  for (const configuredGit of [
    { remote: "changed-origin", baseBranch: "main", allowDirectLand: true },
    { remote: "origin", baseBranch: "changed-main", allowDirectLand: true },
  ]) {
    let agentRuns = 0;
    const result = await runPlanningImplementation(
      input({
        configuredGit,
        runAgent: async () => {
          agentRuns += 1;
          throw new Error("unexpected agent");
        },
      }),
    );
    assert.equal(result.kind, "blocked");
    if (result.kind === "blocked")
      assert.equal(result.result.reason, "implementation-configuration");
    assert.equal(agentRuns, 0);
  }
});

test("validates a matching resumed implementation pull request with the host", async () => {
  let agentRuns = 0;
  let hostReads = 0;
  const result = await runPlanningImplementation(
    input({
      configuredGit: {
        remote: "origin",
        baseBranch: "main",
        allowDirectLand: true,
      },
      runAgent: async () => {
        agentRuns += 1;
        return {
          status: "pr-created",
          prUrl: "https://github.com/acme/patchmill/pull/189",
          branch: "agent/189",
          commits: [oid("b")],
          validation: [],
        };
      },
      host: {
        id: "github-gh",
        resolveTargetRepositoryIdentity: async () => repository,
        resolveRemoteRepositoryIdentity: async () => repository,
        getPullRequest: async () => {
          hostReads += 1;
          return {
            number: 189,
            url: "https://github.com/acme/patchmill/pull/189",
            targetRepository: repository,
            baseBranch: "main",
            headRepository: repository,
            headBranch: "agent/189",
            headSha: oid("b"),
            body: "Closes #189\n\n<!-- patchmill:planning-pr-v1 issue=189 phase=implementation -->",
            status: "open",
          };
        },
      },
    }),
  );
  assert.equal(result.kind, "validated");
  assert.equal(result.state.phases[0]?.status, "pull-request-open");
  assert.equal(agentRuns, 1);
  assert.equal(hostReads, 1);
});

test("blocks runner pre-validation failures without a pull-request-open checkpoint", async () => {
  for (const [name, overrides] of [
    [
      "missing workspace",
      {
        workspaces: { inspect: async () => ({ state: "missing" as const }) },
      },
    ],
    [
      "dirty workspace",
      {
        workspaces: {
          inspect: async () => ({
            state: "ready" as const,
            identity: { branch: "agent/189", worktreePath: "/worktrees/189" },
            headOid: oid("b"),
            clean: false,
          }),
        },
      },
    ],
    [
      "missing remote head",
      {
        git: {
          inspectRemoteHead: async () => ({ state: "missing" as const }),
          assertAncestor: async () => {},
        },
      },
    ],
    [
      "changed remote head",
      {
        git: {
          inspectRemoteHead: async () => ({
            state: "present" as const,
            headOid: oid("c"),
          }),
          assertAncestor: async () => {},
        },
      },
    ],
    [
      "wrong result branch",
      {
        runAgent: async () => ({
          status: "pr-created" as const,
          prUrl: "https://github.com/acme/patchmill/pull/189",
          branch: "other",
          commits: [oid("b")],
          validation: [],
        }),
      },
    ],
  ] as const) {
    const replacements: unknown[] = [];
    const result = await runPlanningImplementation(
      input({
        ...overrides,
        stateStore: {
          replace: async ({ next }: { next: unknown }) => {
            replacements.push(next);
            return next;
          },
        },
      }),
    );
    assert.equal(result.kind, "blocked", name);
    assert.equal(
      replacements.some(
        (next) =>
          (next as { phases?: Array<{ status?: string }> }).phases?.[0]
            ?.status === "pull-request-open",
      ),
      false,
      name,
    );
  }
});

test("blocks direct merged agent results regardless configured landing policy", async () => {
  for (const allowDirectLand of [true, false]) {
    let replacements = 0;
    let validations = 0;
    const result = await runPlanningImplementation(
      input({
        configuredGit: {
          remote: "origin",
          baseBranch: "main",
          allowDirectLand,
        },
        stateStore: {
          replace: async ({ next }: { next: unknown }) => {
            replacements += 1;
            return next;
          },
        },
        host: {
          ...input().host,
          getPullRequest: async () => {
            validations += 1;
            throw new Error("unexpected validation");
          },
        },
        runAgent: async () => ({ status: "merged" as const }),
      }),
    );
    assert.equal(result.kind, "blocked");
    if (result.kind === "blocked")
      assert.equal(result.result.reason, "implementation-direct-merge");
    assert.equal(replacements, 1);
    assert.equal(validations, 0);
  }
});

test("propagates a branch-pushed checkpoint conflict without host continuation", async () => {
  let validations = 0;
  let replacements = 0;
  await assert.rejects(
    runPlanningImplementation(
      input({
        stateStore: {
          replace: async () => {
            replacements += 1;
            throw new Error("state conflict");
          },
        },
        host: {
          ...input().host,
          getPullRequest: async () => {
            validations += 1;
            throw new Error("unexpected validation");
          },
        },
      }),
    ),
    /state conflict/u,
  );
  assert.equal(replacements, 1);
  assert.equal(validations, 0);
});

test("blocks invalid successful agent evidence before PR validation", async () => {
  let hostReads = 0;
  const result = await runPlanningImplementation(
    input({
      runAgent: async () => ({
        status: "pr-created",
        prUrl: "https://github.com/acme/patchmill/pull/189",
        branch: "agent/189",
        commits: [],
        validation: [],
      }),
      stateStore: {
        replace: async ({ next }: { next: unknown }) =>
          validatePlanningState(next),
      },
      host: {
        ...input().host,
        getPullRequest: async () => {
          hostReads += 1;
          throw new Error("unexpected host read");
        },
      },
    }),
  );
  assert.equal(result.kind, "blocked");
  if (result.kind === "blocked")
    assert.equal(result.result.reason, "implementation-evidence");
  assert.equal(hostReads, 0);
});

test("checkpoints clean committed blocker progress for resumption", async () => {
  const checkpoints: Array<{
    phases: Array<{ workspace: { headOid: string } }>;
  }> = [];
  const result = await runPlanningImplementation(
    input({
      runAgent: async () => ({
        status: "blocked",
        reason: "pause",
        questions: [],
        commits: [],
        validation: [],
      }),
      stateStore: {
        replace: async ({ next }: { next: (typeof checkpoints)[number] }) => {
          checkpoints.push(next);
          return next;
        },
      },
    }),
  );
  assert.equal(result.kind, "blocked");
  assert.equal(checkpoints[0]?.phases[0]?.workspace.headOid, oid("b"));
});

test("blocks a resumed blocker when its saved head is not an ancestor", async () => {
  const checkpoints: unknown[] = [];
  const result = await runPlanningImplementation(
    input({
      runAgent: async () => ({
        status: "blocked",
        reason: "pause",
        questions: [],
        commits: [],
        validation: [],
      }),
      git: {
        inspectRemoteHead: async () => ({ state: "missing" as const }),
        assertAncestor: async () => {
          throw new PlanningPublicationGitError("merge-base", "not-ancestor");
        },
      },
      stateStore: {
        replace: async ({ next }: { next: unknown }) => {
          checkpoints.push(next);
          return next;
        },
      },
    }),
  );
  assert.equal(result.kind, "blocked");
  if (result.kind === "blocked") {
    assert.match(result.result.reason, /^pause/);
    assert.match(result.result.reason, /workspace was left dirty or unproven/);
  }
  assert.deepEqual(checkpoints, []);
});

test("refuses dirty blocker progress without checkpointing", async () => {
  const checkpoints: unknown[] = [];
  const result = await runPlanningImplementation(
    input({
      runAgent: async () => ({
        status: "blocked",
        reason: "pause",
        questions: [{ question: "which file?" }],
        commits: [],
        validation: [],
      }),
      workspaces: {
        inspect: async () => ({
          state: "ready",
          identity: { branch: "agent/189", worktreePath: "/worktrees/189" },
          headOid: oid("b"),
          clean: false,
        }),
      },
      stateStore: {
        replace: async ({ next }: { next: unknown }) => {
          checkpoints.push(next);
          return next;
        },
      },
    }),
  );
  assert.equal(result.kind, "blocked");
  if (result.kind === "blocked") {
    assert.match(result.result.reason, /^pause/);
    assert.match(result.result.reason, /workspace was left dirty or unproven/);
    assert.deepEqual(result.result.questions, [{ question: "which file?" }]);
  }
  assert.deepEqual(checkpoints, []);
});

test("blocks unproven reported commits before branch-pushed evidence", async () => {
  const checkpoints: unknown[] = [];
  let inspectedRemote = false;
  const result = await runPlanningImplementation(
    input({
      git: {
        inspectRemoteHead: async () => {
          inspectedRemote = true;
          return { state: "present" as const, headOid: oid("b") };
        },
        assertAncestor: async ({ ancestorOid, descendantOid }) => {
          if (ancestorOid === oid("a") && descendantOid === oid("c"))
            throw new PlanningPublicationGitError("merge-base", "not-ancestor");
        },
      },
      runAgent: async () => ({
        status: "pr-created" as const,
        prUrl: "https://github.com/acme/patchmill/pull/189",
        branch: "agent/189",
        commits: [oid("c")],
        validation: [],
      }),
      stateStore: {
        replace: async ({ next }: { next: unknown }) => {
          checkpoints.push(next);
          return next;
        },
      },
    }),
  );
  assert.equal(result.kind, "blocked");
  if (result.kind === "blocked")
    assert.equal(result.result.reason, "implementation-ancestry");
  assert.equal(checkpoints[0]?.phases[0]?.workspace.headOid, oid("b"));
  assert.equal(inspectedRemote, false);
});

test("persists a sanitized fresh implementation run-cost report", async () => {
  const checkpoints: Array<{
    phases: Array<{ implementation: { runCostReport?: unknown } }>;
  }> = [];
  await assert.rejects(
    runPlanningImplementation(
      input({
        resolveRunCost: async () => ({
          stages: [],
          promptTokens: 2,
          outputTokens: 3,
          estimatedCostUsd: 0.4,
        }),
        stateStore: {
          replace: async ({ next }: { next: (typeof checkpoints)[number] }) => {
            checkpoints.push(next);
            return next;
          },
        },
      }),
    ),
    /host transport failure/,
  );
  assert.deepEqual(
    checkpoints.find((checkpoint) => checkpoint.phases[0]?.implementation)
      ?.phases[0]?.implementation.runCostReport,
    {
      stages: [],
      promptTokens: 2,
      outputTokens: 3,
      estimatedCostUsd: 0.4,
    },
  );
});

test("blocks a successful retry when its saved workspace head was rewritten", async () => {
  let validated = false;
  const result = await runPlanningImplementation(
    input({
      git: {
        inspectRemoteHead: async () => ({
          state: "present" as const,
          headOid: oid("b"),
        }),
        assertAncestor: async ({ ancestorOid, descendantOid }) => {
          if (ancestorOid === oid("a") && descendantOid === oid("b"))
            throw new PlanningPublicationGitError("ancestry", "not-ancestor");
        },
      },
      host: {
        id: "github-gh" as const,
        resolveTargetRepositoryIdentity: async () => repository,
        resolveRemoteRepositoryIdentity: async () => repository,
        getPullRequest: async () => {
          validated = true;
          throw new Error("must not validate rewritten workspace");
        },
      },
    }),
  );
  assert.equal(result.kind, "blocked");
  if (result.kind === "blocked")
    assert.equal(result.result.reason, "implementation-workspace");
  assert.equal(validated, false);
});

test("checkpoints clean post-agent workspace progress before recoverable publication failures", async () => {
  for (const [name, failure] of [
    ["wrong URL", "url"],
    ["wrong branch", "branch"],
    ["changed remote head", "remote-head"],
  ] as const) {
    let durable = input().state;
    let attempts = 0;
    const receivedHeads: string[] = [];
    let pullRequestReads = 0;
    const checkpoints: unknown[] = [];
    const run = () =>
      runPlanningImplementation(
        input({
          state: durable,
          stateStore: {
            replace: async ({ next }: { next: typeof durable }) => {
              checkpoints.push(next);
              durable = next;
              return next;
            },
          },
          git: {
            inspectRemoteHead: async () =>
              failure === "remote-head" && attempts === 1
                ? { state: "present" as const, headOid: oid("c") }
                : { state: "present" as const, headOid: oid("b") },
            assertAncestor: async () => {},
          },
          host: {
            ...input().host,
            getPullRequest: async () => {
              pullRequestReads += 1;
              return {
                number: 189,
                url: "https://github.com/acme/patchmill/pull/189",
                targetRepository: repository,
                baseBranch: "main",
                headRepository: repository,
                headBranch: "agent/189",
                headSha: oid("b"),
                body: "Closes #189\n\n<!-- patchmill:planning-pr-v1 issue=189 phase=implementation -->",
                status: "open" as const,
              };
            },
          },
          runAgent: async ({
            phase,
          }: {
            phase: { workspace: { headOid: string } };
          }) => {
            receivedHeads.push(phase.workspace.headOid);
            attempts += 1;
            return {
              status: "pr-created" as const,
              prUrl:
                failure === "url" && attempts === 1
                  ? "https://github.com/acme/other/pull/189"
                  : "https://github.com/acme/patchmill/pull/189",
              branch:
                failure === "branch" && attempts === 1 ? "other" : "agent/189",
              commits: [oid("b")],
              validation: [],
            };
          },
        }),
      );
    const failed = await run();
    assert.equal(failed.kind, "blocked", name);
    assert.equal(durable.phases[0]?.status, "workspace-ready", name);
    assert.equal(durable.phases[0]?.workspace.headOid, oid("b"), name);
    assert.equal(
      checkpoints.some(
        (state) =>
          (state as { phases: Array<{ status: string }> }).phases[0]?.status ===
          "pull-request-open",
      ),
      false,
      name,
    );
    assert.equal(pullRequestReads, 0, name);
    const repaired = await run();
    assert.equal(repaired.kind, "validated", name);
    assert.equal(repaired.state.phases[0]?.status, "pull-request-open", name);
    assert.deepEqual(receivedHeads, [oid("a"), oid("b")], name);
  }
});

test("checkpoints clean workspace progress when the implementation agent throws", async () => {
  let durable = input().state;
  let attempts = 0;
  const receivedHeads: string[] = [];
  let pullRequestReads = 0;
  const checkpoints: unknown[] = [];
  const run = () =>
    runPlanningImplementation(
      input({
        state: durable,
        stateStore: {
          replace: async ({ next }: { next: typeof durable }) => {
            checkpoints.push(next);
            durable = next;
            return next;
          },
        },
        host: {
          ...input().host,
          getPullRequest: async () => {
            pullRequestReads += 1;
            return {
              number: 189,
              url: "https://github.com/acme/patchmill/pull/189",
              targetRepository: repository,
              baseBranch: "main",
              headRepository: repository,
              headBranch: "agent/189",
              headSha: oid("b"),
              body: "Closes #189\n\n<!-- patchmill:planning-pr-v1 issue=189 phase=implementation -->",
              status: "open" as const,
            };
          },
        },
        runAgent: async ({
          phase,
        }: {
          phase: { workspace: { headOid: string } };
        }) => {
          receivedHeads.push(phase.workspace.headOid);
          attempts += 1;
          if (attempts === 1) throw new Error("todo completeness failed");
          return {
            status: "pr-created" as const,
            prUrl: "https://github.com/acme/patchmill/pull/189",
            branch: "agent/189",
            commits: [oid("b")],
            validation: [],
          };
        },
      }),
    );
  await assert.rejects(run(), /todo completeness failed/u);
  assert.equal(durable.phases[0]?.status, "workspace-ready");
  assert.equal(durable.phases[0]?.workspace.headOid, oid("b"));
  assert.equal(
    checkpoints.some(
      (state) =>
        (state as { phases: Array<{ status: string }> }).phases[0]?.status ===
        "pull-request-open",
    ),
    false,
  );
  assert.equal(pullRequestReads, 0);
  const repaired = await run();
  assert.equal(repaired.kind, "validated");
  assert.deepEqual(receivedHeads, [oid("a"), oid("b")]);
  assert.equal(repaired.state.phases[0]?.status, "pull-request-open");
});

test("propagates host transport failures instead of converting them to validation blockers", async () => {
  await assert.rejects(
    runPlanningImplementation(input()),
    /host transport failure/,
  );
});
