import assert from "node:assert/strict";
import test from "node:test";
import { renderPlanningPullRequestMarker } from "../../../workflow/planning-pull-request-markers.ts";
import { publishPlanningPhase } from "./planning-phase-publisher.ts";

const oid = "a".repeat(40);
const repository = {
  provider: "github-gh" as const,
  host: "github.com",
  owner: "acme",
  repository: "patchmill",
};
const state = {
  version: 1 as const,
  workflowVersion: "planning-pr-v1" as const,
  runId: "123e4567-e89b-42d3-a456-426614174000",
  issueNumber: 188,
  issueTitle: "Example",
  gates: { specRequired: true, planRequired: false },
  revision: 1,
  createdAt: "2026-09-08T12:00:00.000Z",
  updatedAt: "2026-09-08T12:00:01.000Z",
  phases: [
    {
      kind: "spec" as const,
      status: "branch-pushed" as const,
      base: {
        remote: "origin",
        baseBranch: "main",
        baseOid: oid,
        artifactCandidates: { spec: [], plan: [] },
      },
      workspace: {
        runId: "123e4567-e89b-42d3-a456-426614174000",
        phase: "spec" as const,
        identity: { branch: "planning/spec", worktreePath: "/repo/worktree" },
        remote: "origin",
        baseBranch: "main",
        baseOid: oid,
        headOid: oid,
        cleanup: { state: "ready" as const },
      },
      artifacts: [
        {
          kind: "spec" as const,
          path: "docs/specs/example.md",
          commitOid: oid,
          source: "workspace" as const,
        },
      ],
      publication: {
        targetRepository: repository,
        headRepository: repository,
        baseBranch: "main",
        headBranch: "planning/spec",
        headOid: oid,
      },
    },
    { kind: "implementation" as const, status: "pending" as const },
  ],
};
test("stops after exact push when its branch checkpoint cannot persist", async () => {
  const events: string[] = [];
  const ready = structuredClone(state);
  ready.phases[0] = { ...ready.phases[0], status: "workspace-ready" };
  await assert.rejects(
    () =>
      publishPlanningPhase({
        state: ready,
        phaseIndex: 0,
        lock: {} as never,
        stateStore: {
          async replace() {
            events.push("replace");
            throw new Error("store failed");
          },
        },
        host: {
          async resolveTargetRepositoryIdentity() {
            events.push("target");
            return repository;
          },
          async resolveRemoteRepositoryIdentity() {
            events.push("head");
            return repository;
          },
          async findPullRequests() {
            events.push("find");
            return [];
          },
        } as never,
        git: {
          async verifyWorkspace() {
            events.push("verify");
          },
          async ensureRemoteHead() {
            events.push("push");
            return { pushed: true, headOid: oid };
          },
          async inspectRemoteHead() {
            events.push("inspect");
            return { state: "present" as const, headOid: oid };
          },
        },
        workspaces: {
          async resume() {
            events.push("resume");
          },
        } as never,
      }),
    /store failed/,
  );
  assert.deepEqual(events, [
    "resume",
    "verify",
    "target",
    "head",
    "push",
    "replace",
  ]);
});
test("rejects incomplete workspace artifacts before publication effects", async () => {
  const partial = structuredClone(state);
  partial.phases[0] = {
    ...partial.phases[0],
    status: "workspace-ready",
    artifacts: [],
  };
  await assert.rejects(
    () =>
      publishPlanningPhase({
        state: partial,
        phaseIndex: 0,
        lock: {} as never,
        stateStore: {} as never,
        host: {} as never,
        git: {} as never,
        workspaces: {} as never,
      }),
    /artifacts are incomplete/,
  );
});
test("blocks branch-pushed discovery when the saved remote head changed", async () => {
  let discovered = false;
  await assert.rejects(
    () =>
      publishPlanningPhase({
        state,
        phaseIndex: 0,
        lock: {} as never,
        stateStore: {} as never,
        host: {
          async findPullRequests() {
            discovered = true;
            return [];
          },
        } as never,
        git: {
          async inspectRemoteHead() {
            return { state: "present", headOid: "b".repeat(40) };
          },
        } as never,
        workspaces: {} as never,
      }),
    /remote head changed/,
  );
  assert.equal(discovered, false);
});
function pullRequest(status: "open" | "closed-unmerged" | "merged" = "open") {
  return {
    number: 188,
    url: "https://github.com/acme/patchmill/pull/188",
    targetRepository: repository,
    headRepository: repository,
    baseBranch: "main",
    headBranch: "planning/spec",
    headSha: oid,
    body: renderPlanningPullRequestMarker({ issueNumber: 188, phase: "spec" }),
    status,
  };
}
test("creates, checkpoints, and cleans up one discovered-missing pull request", async () => {
  const events: string[] = [];
  const created = pullRequest();
  const result = await publishPlanningPhase({
    state,
    phaseIndex: 0,
    lock: {} as never,
    stateStore: {
      async replace({ next }) {
        events.push(`replace:${next.phases[0]!.status}`);
        return next;
      },
    },
    host: {
      async findPullRequests() {
        events.push("find");
        return [];
      },
      async createPullRequest() {
        events.push("create");
        return created;
      },
      async getPullRequest() {
        events.push("get");
        return created;
      },
    } as never,
    git: {
      async inspectRemoteHead() {
        events.push("inspect");
        return { state: "present" as const, headOid: oid };
      },
    } as never,
    workspaces: {
      async removeWorktree() {
        events.push("worktree");
      },
      async removeBranch() {
        events.push("branch");
      },
    } as never,
  });
  assert.equal(result.kind, "published");
  assert.deepEqual(events, [
    "inspect",
    "find",
    "create",
    "get",
    "replace:pull-request-open",
    "get",
    "inspect",
    "worktree",
    "replace:pull-request-open",
    "branch",
    "replace:pull-request-open",
    "get",
  ]);
});
test("adopts one exact pull request without creating or rewriting it", async () => {
  const events: string[] = [];
  const adopted = pullRequest();
  await publishPlanningPhase({
    state,
    phaseIndex: 0,
    lock: {} as never,
    stateStore: {
      async replace({ next }) {
        return next;
      },
    },
    host: {
      async findPullRequests() {
        events.push("find");
        return [adopted];
      },
      async createPullRequest() {
        events.push("create");
        return adopted;
      },
      async getPullRequest() {
        events.push("get");
        return adopted;
      },
    } as never,
    git: {
      async inspectRemoteHead() {
        return { state: "present" as const, headOid: oid };
      },
    } as never,
    workspaces: { async removeWorktree() {}, async removeBranch() {} } as never,
  });
  assert.deepEqual(events, ["find", "get", "get", "get"]);
});
test("returns ambiguous discovery without creating a replacement pull request", async () => {
  const result = await publishPlanningPhase({
    state,
    phaseIndex: 0,
    lock: {} as never,
    stateStore: {
      async replace() {
        throw new Error("unexpected");
      },
    },
    host: {
      id: "github-gh",
      async resolveTargetRepositoryIdentity() {
        return repository;
      },
      async resolveRemoteRepositoryIdentity() {
        return repository;
      },
      async createPullRequest() {
        throw new Error("unexpected");
      },
      async findPullRequests() {
        return [{}, {}] as never;
      },
      async getPullRequest() {
        throw new Error("unexpected");
      },
      async readPullRequestBody() {
        return "";
      },
      async updatePullRequestBody() {},
    },
    git: {
      async verifyWorkspace() {},
      async inspectRemoteHead() {
        return { state: "present" as const, headOid: oid };
      },
      async ensureRemoteHead() {
        return { pushed: false, headOid: oid };
      },
    },
    workspaces: {} as never,
  });
  assert.equal(result.kind, "ambiguous");
  assert.equal(result.pullRequests.length, 2);
});

test("recovers an interrupted create by adopting the exact discovered pull request", async () => {
  const events: string[] = [];
  const created = pullRequest();
  await assert.rejects(
    () =>
      publishPlanningPhase({
        state,
        phaseIndex: 0,
        lock: {} as never,
        stateStore: {} as never,
        host: {
          async findPullRequests() {
            events.push("find:first");
            return [];
          },
          async createPullRequest() {
            events.push("create");
            throw new Error("interrupted response");
          },
        } as never,
        git: {
          async inspectRemoteHead() {
            events.push("inspect:first");
            return { state: "present" as const, headOid: oid };
          },
        } as never,
        workspaces: {} as never,
      }),
    /interrupted response/,
  );
  assert.deepEqual(events, ["inspect:first", "find:first", "create"]);
  const retryEvents: string[] = [];
  const retry = await publishPlanningPhase({
    state,
    phaseIndex: 0,
    lock: {} as never,
    stateStore: {
      async replace({ next }) {
        return next;
      },
    },
    host: {
      async findPullRequests() {
        retryEvents.push("find");
        return [created];
      },
      async createPullRequest() {
        retryEvents.push("create");
        return created;
      },
      async getPullRequest() {
        retryEvents.push("get");
        return created;
      },
    } as never,
    git: {
      async inspectRemoteHead() {
        retryEvents.push("inspect");
        return { state: "present" as const, headOid: oid };
      },
    } as never,
    workspaces: {
      async removeWorktree() {
        retryEvents.push("worktree");
      },
      async removeBranch() {
        retryEvents.push("branch");
      },
    } as never,
  });
  assert.equal(retry.kind, "published");
  assert.equal(retryEvents.includes("create"), false);
  assert.deepEqual(retryEvents, [
    "inspect",
    "find",
    "get",
    "get",
    "inspect",
    "worktree",
    "branch",
    "get",
  ]);
});

test("resumes cleanup from worktree-removed without removing the worktree again", async () => {
  const resume = structuredClone(state);
  resume.phases[0] = {
    ...resume.phases[0],
    status: "pull-request-open",
    pullRequest: {
      reference: { targetRepository: repository, number: 188 },
      url: "https://github.com/acme/patchmill/pull/188",
    },
    workspace: {
      ...resume.phases[0].workspace,
      cleanup: { state: "worktree-removed", pushedHeadOid: oid },
    },
  };
  const events: string[] = [];
  await publishPlanningPhase({
    state: resume,
    phaseIndex: 0,
    lock: {} as never,
    stateStore: {
      async replace({ next }) {
        events.push("replace");
        return next;
      },
    },
    host: {
      async getPullRequest() {
        events.push("get");
        return pullRequest();
      },
    } as never,
    git: {
      async inspectRemoteHead() {
        events.push("inspect");
        return { state: "present" as const, headOid: oid };
      },
    } as never,
    workspaces: {
      async removeWorktree() {
        events.push("worktree");
      },
      async removeBranch() {
        events.push("branch");
      },
    } as never,
  });
  assert.deepEqual(events, ["get", "branch", "replace", "get"]);
});
