import assert from "node:assert/strict";
import test from "node:test";
import {
  IncompletePullRequestSearchError,
  PullRequestNotFoundError,
  type PullRequestSummary,
} from "../../../host/pull-requests.ts";
import { renderPlanningPullRequestMarker } from "../../../workflow/planning-pull-request-markers.ts";
import { reconcilePlanningPhase } from "./planning-phase-reconciler.ts";

const baseOid = "a".repeat(40);
const headOid = "b".repeat(40);
const mergeOid = "c".repeat(40);
const mergedBaseOid = "d".repeat(40);
const repository = {
  provider: "github-gh" as const,
  host: "github.com",
  owner: "acme",
  repository: "patchmill",
};
const reference = { targetRepository: repository, number: 188 };

function summary(
  status: PullRequestSummary["status"] = "open",
): PullRequestSummary {
  const common = {
    number: 188,
    url: "https://github.com/acme/patchmill/pull/188",
    targetRepository: repository,
    headRepository: repository,
    baseBranch: "saved-main",
    headBranch: "planning/spec",
    headSha: headOid,
    body: renderPlanningPullRequestMarker({ issueNumber: 188, phase: "spec" }),
  };
  return status === "merged"
    ? { ...common, status, mergeCommit: mergeOid }
    : { ...common, status };
}

function base() {
  return {
    remote: "saved-origin",
    baseBranch: "saved-main",
    baseOid,
    artifactCandidates: { spec: [], plan: [] },
  };
}

function workspace(
  cleanup: "ready" | "worktree-removed" | "removed" = "ready",
) {
  return {
    runId: "123e4567-e89b-42d3-a456-426614174000",
    phase: "spec" as const,
    identity: { branch: "planning/spec", worktreePath: "/workspace" },
    remote: "saved-origin",
    baseBranch: "saved-main",
    baseOid,
    headOid,
    cleanup:
      cleanup === "ready"
        ? ({ state: "ready" } as const)
        : ({ state: cleanup, pushedHeadOid: headOid } as const),
  };
}

function artifacts() {
  return [
    {
      kind: "spec" as const,
      path: "docs/specs/example.md",
      source: "workspace" as const,
      commitOid: headOid,
    },
  ];
}

function publication() {
  return {
    targetRepository: repository,
    headRepository: repository,
    baseBranch: "saved-main",
    headBranch: "planning/spec",
    headOid,
  };
}

function planningState(
  phase:
    | "remote-base"
    | "branch-pushed"
    | "open-ready"
    | "open-worktree-removed"
    | "open-removed" = "open-ready",
) {
  const first =
    phase === "remote-base"
      ? {
          kind: "spec" as const,
          status: "complete" as const,
          base: {
            ...base(),
            artifactCandidates: { spec: ["docs/specs/example.md"], plan: [] },
          },
          artifacts: [
            {
              ...artifacts()[0]!,
              source: "remote-base" as const,
              commitOid: baseOid,
            },
          ],
          completion: { kind: "remote-base" as const },
        }
      : phase === "branch-pushed"
        ? {
            kind: "spec" as const,
            status: "branch-pushed" as const,
            base: base(),
            workspace: workspace(),
            artifacts: artifacts(),
            publication: publication(),
          }
        : {
            kind: "spec" as const,
            status: "pull-request-open" as const,
            base: base(),
            workspace: workspace(
              phase === "open-ready"
                ? "ready"
                : phase === "open-worktree-removed"
                  ? "worktree-removed"
                  : "removed",
            ),
            artifacts: artifacts(),
            publication: publication(),
            pullRequest: {
              reference,
              url: "https://github.com/acme/patchmill/pull/188",
            },
          };
  return {
    version: 1 as const,
    workflowVersion: "planning-pr-v1" as const,
    runId: "123e4567-e89b-42d3-a456-426614174000",
    issueNumber: 188,
    issueTitle: "Example",
    gates: { specRequired: true, planRequired: false },
    revision: 0,
    createdAt: "2026-09-08T12:00:00.000Z",
    updatedAt: "2026-09-08T12:00:00.000Z",
    phases: [
      first,
      { kind: "implementation" as const, status: "pending" as const },
    ],
  };
}

function fixture(
  input: {
    state?: ReturnType<typeof planningState>;
    pullRequest?: PullRequestSummary;
    matches?: readonly PullRequestSummary[];
    getError?: Error;
    findError?: Error;
    removeWorktreeError?: Error;
    removeBranchError?: Error;
    replaceErrorAt?: number;
    fetchError?: Error;
    ancestorError?: Error;
    regularError?: Error;
  } = {},
) {
  const events: string[] = [];
  let replacements = 0;
  const state = input.state ?? planningState();
  const pullRequest = input.pullRequest ?? summary();
  return {
    state,
    events,
    input: {
      state,
      phaseIndex: 0,
      lock: {} as never,
      stateStore: {
        async replace({ next }: { next: typeof state }) {
          replacements += 1;
          events.push(
            `replace:${next.phases[0]!.status}:${"completion" in next.phases[0]! ? "complete" : (next.phases[0]!.workspace?.cleanup.state ?? "ready")}`,
          );
          if (replacements === input.replaceErrorAt)
            throw new Error("store failed");
          return next;
        },
      },
      host: {
        async findPullRequests() {
          events.push("find");
          if (input.findError) throw input.findError;
          return input.matches ?? [pullRequest];
        },
        async getPullRequest() {
          events.push("get");
          if (input.getError) throw input.getError;
          return pullRequest;
        },
      } as never,
      remoteBase: {
        async fetch(value: { remote: string; baseBranch: string }) {
          events.push(`fetch:${value.remote}:${value.baseBranch}`);
          if (input.fetchError) throw input.fetchError;
          return { ...base(), baseOid: mergedBaseOid };
        },
      },
      git: {
        async inspectRemoteHead() {
          events.push("remote-head");
          return { state: "present" as const, headOid };
        },
        async assertAncestor(value: {
          ancestorOid: string;
          descendantOid: string;
        }) {
          events.push(`ancestor:${value.ancestorOid}:${value.descendantOid}`);
          if (input.ancestorError) throw input.ancestorError;
        },
        async assertRegularFiles(value: { commitOid: string }) {
          events.push(`regular:${value.commitOid}`);
          if (input.regularError) throw input.regularError;
        },
      },
      workspaces: {
        async removeWorktree() {
          events.push("remove-worktree");
          if (input.removeWorktreeError) throw input.removeWorktreeError;
        },
        async removeBranch() {
          events.push("remove-branch");
          if (input.removeBranchError) throw input.removeBranchError;
        },
      } as never,
    },
  };
}

test("returns remote-base completion without host or local effects", async () => {
  const testFixture = fixture({ state: planningState("remote-base") });
  const result = await reconcilePlanningPhase(testFixture.input);
  assert.equal(result.outcome.kind, "satisfied-by-base");
  assert.deepEqual(testFixture.events, []);
});

test("classifies open and closed pull requests only after both cleanup checkpoints", async () => {
  for (const [status, outcome] of [
    ["open", "review-pending"],
    ["closed-unmerged", "closed-unmerged"],
  ] as const) {
    const testFixture = fixture({ pullRequest: summary(status) });
    const result = await reconcilePlanningPhase(testFixture.input);
    assert.equal(result.outcome.kind, outcome);
    assert.deepEqual(testFixture.events, [
      "get",
      "remote-head",
      "remove-worktree",
      "replace:pull-request-open:worktree-removed",
      "remove-branch",
      "replace:pull-request-open:removed",
    ]);
    assert.equal(result.state.phases[0]!.workspace!.cleanup.state, "removed");
  }
});

test("classifies branch-pushed discovery outcomes without replacement creation", async () => {
  for (const [matches, kind] of [
    [[], "missing"],
    [[summary(), summary()], "ambiguous"],
  ] as const) {
    const testFixture = fixture({
      state: planningState("branch-pushed"),
      matches,
    });
    const result = await reconcilePlanningPhase(testFixture.input);
    assert.equal(result.outcome.kind, kind);
    assert.deepEqual(testFixture.events, ["find"]);
  }
});

test("adopts one discovered pull request, checkpoints identity, cleans up, and classifies it", async () => {
  const testFixture = fixture({ state: planningState("branch-pushed") });
  const result = await reconcilePlanningPhase(testFixture.input);
  assert.equal(result.outcome.kind, "review-pending");
  assert.deepEqual(testFixture.events, [
    "find",
    "get",
    "replace:pull-request-open:ready",
    "remote-head",
    "remove-worktree",
    "replace:pull-request-open:worktree-removed",
    "remove-branch",
    "replace:pull-request-open:removed",
  ]);
});

test("maps only typed get absence to missing and leaves host failures byte-identical", async () => {
  const saved = planningState("open-removed");
  const bytes = JSON.stringify(saved);
  const missingFixture = fixture({
    state: saved,
    getError: new PullRequestNotFoundError(reference),
  });
  const missing = await reconcilePlanningPhase(missingFixture.input);
  assert.deepEqual(missing.outcome, { kind: "missing", reference });
  assert.deepEqual(missingFixture.events, ["get"]);
  assert.equal(JSON.stringify(saved), bytes);
  for (const error of [
    new Error("transport"),
    new IncompletePullRequestSearchError({
      targetRepository: repository,
      baseBranch: "saved-main",
      headRepository: repository,
      headBranch: "planning/spec",
    }),
  ]) {
    const testFixture = fixture({
      state: planningState("open-ready"),
      getError: error,
    });
    const before = JSON.stringify(testFixture.state);
    await assert.rejects(
      () => reconcilePlanningPhase(testFixture.input),
      error,
    );
    assert.equal(JSON.stringify(testFixture.state), before);
    assert.deepEqual(testFixture.events, ["get"]);
  }
});

test("does not treat incomplete branch discovery as absence", async () => {
  const error = new IncompletePullRequestSearchError({
    targetRepository: repository,
    baseBranch: "saved-main",
    headRepository: repository,
    headBranch: "planning/spec",
  });
  const testFixture = fixture({
    state: planningState("branch-pushed"),
    findError: error,
  });
  await assert.rejects(() => reconcilePlanningPhase(testFixture.input), error);
  assert.deepEqual(testFixture.events, ["find"]);
});

test("stops cleanup at each durable boundary when removal or checkpoint fails", async () => {
  for (const input of [
    { removeWorktreeError: new Error("dirty") },
    { replaceErrorAt: 1 },
    { removeBranchError: new Error("branch failed") },
    { replaceErrorAt: 2 },
  ]) {
    const testFixture = fixture(input);
    await assert.rejects(() => reconcilePlanningPhase(testFixture.input));
    const branch = testFixture.events.indexOf("remove-branch");
    const failedFirstCheckpoint = input.replaceErrorAt === 1;
    if (input.removeWorktreeError || failedFirstCheckpoint)
      assert.equal(branch, -1);
    assert.equal(
      testFixture.events.includes(`fetch:saved-origin:saved-main`),
      false,
    );
  }
  const retryFixture = fixture({
    state: planningState("open-worktree-removed"),
  });
  const result = await reconcilePlanningPhase(retryFixture.input);
  assert.equal(result.outcome.kind, "review-pending");
  assert.deepEqual(retryFixture.events, [
    "get",
    "remove-branch",
    "replace:pull-request-open:removed",
  ]);
});

test("proves and persists merged base artifacts without consulting workspace blobs", async () => {
  const testFixture = fixture({ pullRequest: summary("merged") });
  const result = await reconcilePlanningPhase(testFixture.input);
  assert.equal(result.outcome.kind, "merged");
  assert.deepEqual(testFixture.events, [
    "get",
    "remote-head",
    "remove-worktree",
    "replace:pull-request-open:worktree-removed",
    "remove-branch",
    "replace:pull-request-open:removed",
    "fetch:saved-origin:saved-main",
    `ancestor:${mergeOid}:${mergedBaseOid}`,
    `regular:${mergeOid}`,
    `regular:${mergedBaseOid}`,
    "replace:complete:complete",
  ]);
  const phase = result.state.phases[0]!;
  assert.equal(phase.status, "complete");
  assert.deepEqual(phase.completion, {
    kind: "merged-pull-request",
    mergeOid,
    mergedBaseOid,
  });
  assert.deepEqual(phase.artifacts, [
    {
      kind: "spec",
      path: "docs/specs/example.md",
      source: "remote-base",
      commitOid: mergedBaseOid,
    },
  ]);
  assert.equal(
    testFixture.events.some((event) => event.includes(headOid)),
    false,
  );
});

test("keeps the published phase incomplete when merge proof fails", async () => {
  const testFixture = fixture({
    pullRequest: summary("merged"),
    ancestorError: new Error("not ancestor"),
  });
  await assert.rejects(
    () => reconcilePlanningPhase(testFixture.input),
    /not ancestor/,
  );
  assert.equal(testFixture.events.includes("replace:complete:complete"), false);
  assert.equal(testFixture.events.includes(`regular:${mergeOid}`), false);
});
