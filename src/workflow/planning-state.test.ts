import assert from "node:assert/strict";
import test from "node:test";
import {
  PlanningStateValidationError,
  assertPlanningStateReplacement,
  createPlanningState,
  parsePlanningState,
  serializePlanningState,
  validatePlanningState,
} from "./planning-state.ts";

const oid = (character: string) => character.repeat(40);
const runId = "123e4567-e89b-42d3-a456-426614174000";
const now = "2026-09-08T12:00:00.000Z";
const base = {
  remote: "origin",
  baseBranch: "main",
  baseOid: oid("a"),
  artifactCandidates: {
    spec: ["docs/specs/example-issue-188.md"],
    plan: ["docs/plans/example-issue-188.md"],
  },
};
const workspace = (cleanup: unknown = { state: "ready" }) => ({
  runId,
  phase: "spec",
  identity: { branch: "planning/spec", worktreePath: ".worktrees/188-spec" },
  remote: "origin",
  baseBranch: "main",
  baseOid: oid("a"),
  headOid: oid("b"),
  cleanup,
});
const publication = {
  targetRepository: {
    provider: "github-gh",
    host: "github.com",
    owner: "acme",
    repository: "patchmill",
  },
  headRepository: {
    provider: "github-gh",
    host: "github.com",
    owner: "acme",
    repository: "patchmill",
  },
  baseBranch: "main",
  headBranch: "planning/spec",
  headOid: oid("b"),
};
const artifact = (source: "remote-base" | "workspace", commitOid: string) => ({
  kind: "spec",
  path: "docs/specs/example-issue-188.md",
  source,
  commitOid,
});
const pullRequest = {
  reference: { targetRepository: publication.targetRepository, number: 188 },
  url: "https://github.com/acme/patchmill/pull/188",
};
function state(phase: object, revision = 0) {
  return {
    version: 1,
    workflowVersion: "planning-pr-v1",
    runId,
    issueNumber: 188,
    issueTitle: "Example",
    gates: { specRequired: true, planRequired: false },
    phases: [phase, { kind: "implementation", status: "pending" }],
    revision,
    createdAt: now,
    updatedAt: revision === 0 ? now : "2026-09-08T12:00:01.000Z",
  };
}

test("accepts and preserves a non-prefix remote-base artifact subset", () => {
  const planWorkspace = {
    ...workspace(),
    phase: "plan",
    identity: {
      branch: "planning/plan",
      worktreePath: ".worktrees/188-plan",
    },
    headOid: oid("a"),
  };
  const current = validatePlanningState({
    version: 1,
    workflowVersion: "planning-pr-v1",
    runId,
    issueNumber: 188,
    issueTitle: "Example",
    gates: { specRequired: false, planRequired: true },
    revision: 0,
    createdAt: now,
    updatedAt: now,
    phases: [
      {
        kind: "plan",
        status: "workspace-ready",
        base,
        workspace: planWorkspace,
        artifacts: [
          {
            kind: "plan",
            path: "docs/plans/example-issue-188.md",
            source: "remote-base",
            commitOid: oid("a"),
          },
        ],
      },
      { kind: "implementation", status: "pending" },
    ],
  });
  const next = validatePlanningState({
    ...current,
    revision: 1,
    updatedAt: "2026-09-08T12:00:01.000Z",
    phases: [
      {
        ...current.phases[0],
        workspace: { ...planWorkspace, headOid: oid("b") },
        artifacts: [
          {
            kind: "spec",
            path: "docs/specs/example-issue-188.md",
            source: "workspace",
            commitOid: oid("b"),
          },
          ...current.phases[0].artifacts,
        ],
      },
      current.phases[1],
    ],
  });
  assert.doesNotThrow(() => assertPlanningStateReplacement(current, next));
});

test("round trips every durable planning publication checkpoint", () => {
  const documents = [
    { kind: "spec", status: "pending" },
    {
      kind: "spec",
      status: "workspace-ready",
      base,
      workspace: workspace(),
      artifacts: [],
    },
    {
      kind: "spec",
      status: "workspace-ready",
      base,
      workspace: workspace(),
      artifacts: [artifact("remote-base", oid("a"))],
    },
    {
      kind: "spec",
      status: "workspace-ready",
      base,
      workspace: workspace(),
      artifacts: [artifact("workspace", oid("b"))],
    },
    {
      kind: "spec",
      status: "branch-pushed",
      base,
      workspace: workspace(),
      artifacts: [artifact("workspace", oid("b"))],
      publication,
    },
    {
      kind: "spec",
      status: "pull-request-open",
      base,
      workspace: workspace(),
      artifacts: [artifact("workspace", oid("b"))],
      publication,
      pullRequest,
    },
    {
      kind: "spec",
      status: "pull-request-open",
      base,
      workspace: workspace({
        state: "worktree-removed",
        pushedHeadOid: oid("b"),
      }),
      artifacts: [artifact("workspace", oid("b"))],
      publication,
      pullRequest,
    },
    {
      kind: "spec",
      status: "pull-request-open",
      base,
      workspace: workspace({ state: "removed", pushedHeadOid: oid("b") }),
      artifacts: [artifact("workspace", oid("b"))],
      publication,
      pullRequest,
    },
    {
      kind: "spec",
      status: "complete",
      base,
      workspace: workspace({ state: "removed", pushedHeadOid: oid("b") }),
      artifacts: [artifact("remote-base", oid("c"))],
      publication,
      pullRequest,
      completion: {
        kind: "merged-pull-request",
        mergeOid: oid("d"),
        mergedBaseOid: oid("c"),
      },
    },
  ];
  for (const document of documents) {
    const parsed = validatePlanningState(state(document));
    assert.deepEqual(
      parsePlanningState(serializePlanningState(parsed)),
      parsed,
    );
  }
  const direct = validatePlanningState(
    state({
      kind: "spec",
      status: "complete",
      base,
      artifacts: [artifact("remote-base", oid("a"))],
      completion: { kind: "remote-base" },
    }),
  );
  assert.equal(direct.phases[0]!.status, "complete");
});

test("rejects incomplete publication, cleanup, URLs, and merge evidence", () => {
  const cases: ReadonlyArray<
    [string, (phase: Record<string, unknown>) => void]
  > = [
    [
      "partial branch",
      (phase) => {
        phase.artifacts = [];
      },
    ],
    [
      "wrong publication head",
      (phase) => {
        (phase.publication as Record<string, unknown>).headOid = oid("e");
      },
    ],
    [
      "wrong reference target",
      (phase) => {
        (
          (phase.pullRequest as Record<string, unknown>).reference as Record<
            string,
            unknown
          >
        ).targetRepository = {
          ...publication.targetRepository,
          repository: "other",
        };
      },
    ],
    [
      "unsafe URL",
      (phase) => {
        (phase.pullRequest as Record<string, unknown>).url =
          "https://token@example.com/pull/188";
      },
    ],
    [
      "cleanup mismatch",
      (phase) => {
        (phase.workspace as Record<string, unknown>).cleanup = {
          state: "removed",
          pushedHeadOid: oid("e"),
        };
      },
    ],
  ];
  for (const [, mutate] of cases) {
    const phase: Record<string, unknown> = structuredClone({
      kind: "spec",
      status: "pull-request-open",
      base,
      workspace: workspace(),
      artifacts: [artifact("workspace", oid("b"))],
      publication,
      pullRequest,
    });
    mutate(phase);
    assert.throws(
      () => validatePlanningState(state(phase)),
      PlanningStateValidationError,
    );
  }
  const merged = {
    kind: "spec",
    status: "complete",
    base,
    workspace: workspace({ state: "ready" }),
    artifacts: [artifact("workspace", oid("b"))],
    publication,
    pullRequest,
    completion: { kind: "merged-pull-request", mergeOid: oid("d") },
  };
  assert.throws(
    () => validatePlanningState(state(merged)),
    PlanningStateValidationError,
  );
});

test("allows pending phases to advance into workspace and remote-base completion", () => {
  const pending = validatePlanningState(
    state({ kind: "spec", status: "pending" }),
  );
  const ready = validatePlanningState(
    state(
      {
        kind: "spec",
        status: "workspace-ready",
        base,
        workspace: workspace(),
        artifacts: [],
      },
      1,
    ),
  );
  const complete = validatePlanningState(
    state(
      {
        kind: "spec",
        status: "complete",
        base,
        artifacts: [artifact("remote-base", oid("a"))],
        completion: { kind: "remote-base" },
      },
      1,
    ),
  );
  assert.doesNotThrow(() => assertPlanningStateReplacement(pending, ready));
  assert.doesNotThrow(() => assertPlanningStateReplacement(pending, complete));
});

test("allows only one durable publication edge at a time", () => {
  const ready = validatePlanningState(
    state({
      kind: "spec",
      status: "workspace-ready",
      base,
      workspace: workspace(),
      artifacts: [],
    }),
  );
  const artifactReady = validatePlanningState(
    state(
      {
        kind: "spec",
        status: "workspace-ready",
        base,
        workspace: { ...workspace(), headOid: oid("c") },
        artifacts: [artifact("workspace", oid("c"))],
      },
      1,
    ),
  );
  assert.doesNotThrow(() =>
    assertPlanningStateReplacement(ready, artifactReady),
  );
  const rewritten = validatePlanningState(
    state(
      {
        kind: "spec",
        status: "workspace-ready",
        base,
        workspace: { ...workspace(), headOid: oid("d") },
        artifacts: [],
      },
      1,
    ),
  );
  assert.throws(
    () => assertPlanningStateReplacement(ready, rewritten),
    PlanningStateValidationError,
  );
  const rewrittenArtifact = validatePlanningState(
    state(
      {
        kind: "spec",
        status: "workspace-ready",
        base,
        workspace: { ...workspace(), headOid: oid("d") },
        artifacts: [artifact("workspace", oid("d"))],
      },
      2,
    ),
  );
  assert.throws(
    () => assertPlanningStateReplacement(artifactReady, rewrittenArtifact),
    PlanningStateValidationError,
  );
  const pushed = validatePlanningState(
    state(
      {
        kind: "spec",
        status: "branch-pushed",
        base,
        workspace: { ...workspace(), headOid: oid("c") },
        artifacts: [artifact("workspace", oid("c"))],
        publication: { ...publication, headOid: oid("c") },
      },
      2,
    ),
  );
  assert.doesNotThrow(() =>
    assertPlanningStateReplacement(artifactReady, pushed),
  );
  const open = validatePlanningState(
    state(
      {
        kind: "spec",
        status: "pull-request-open",
        base,
        workspace: { ...workspace(), headOid: oid("c") },
        artifacts: [artifact("workspace", oid("c"))],
        publication: { ...publication, headOid: oid("c") },
        pullRequest,
      },
      3,
    ),
  );
  assert.doesNotThrow(() => assertPlanningStateReplacement(pushed, open));
  const removed = validatePlanningState(
    state(
      {
        kind: "spec",
        status: "pull-request-open",
        base,
        workspace: workspace({ state: "removed", pushedHeadOid: oid("b") }),
        artifacts: [artifact("workspace", oid("b"))],
        publication,
        pullRequest,
      },
      4,
    ),
  );
  assert.throws(
    () => assertPlanningStateReplacement(open, removed),
    PlanningStateValidationError,
  );
});

test("creates strict pending state", () => {
  const created = createPlanningState({
    issueNumber: 188,
    issueTitle: "Example",
    gates: { specRequired: true, planRequired: false },
    runId,
    now,
  });
  assert.deepEqual(created.phases, [
    { kind: "spec", status: "pending" },
    { kind: "implementation", status: "pending" },
  ]);
});

test("permits every cleanup checkpoint and the all-at-once merged-base conversion", () => {
  const ready = validatePlanningState(
    state({
      kind: "spec",
      status: "workspace-ready",
      base,
      workspace: workspace(),
      artifacts: [artifact("workspace", oid("b"))],
    }),
  );
  const pushed = validatePlanningState(
    state(
      {
        kind: "spec",
        status: "branch-pushed",
        base,
        workspace: workspace(),
        artifacts: [artifact("workspace", oid("b"))],
        publication,
      },
      1,
    ),
  );
  const open = validatePlanningState(
    state(
      {
        kind: "spec",
        status: "pull-request-open",
        base,
        workspace: workspace(),
        artifacts: [artifact("workspace", oid("b"))],
        publication,
        pullRequest,
      },
      2,
    ),
  );
  const worktreeRemoved = validatePlanningState(
    state(
      {
        kind: "spec",
        status: "pull-request-open",
        base,
        workspace: workspace({
          state: "worktree-removed",
          pushedHeadOid: oid("b"),
        }),
        artifacts: [artifact("workspace", oid("b"))],
        publication,
        pullRequest,
      },
      3,
    ),
  );
  const removed = validatePlanningState(
    state(
      {
        kind: "spec",
        status: "pull-request-open",
        base,
        workspace: workspace({ state: "removed", pushedHeadOid: oid("b") }),
        artifacts: [artifact("workspace", oid("b"))],
        publication,
        pullRequest,
      },
      4,
    ),
  );
  const merged = validatePlanningState(
    state(
      {
        kind: "spec",
        status: "complete",
        base,
        workspace: workspace({ state: "removed", pushedHeadOid: oid("b") }),
        artifacts: [artifact("remote-base", oid("c"))],
        publication,
        pullRequest,
        completion: {
          kind: "merged-pull-request",
          mergeOid: oid("d"),
          mergedBaseOid: oid("c"),
        },
      },
      5,
    ),
  );
  for (const [left, right] of [
    [ready, pushed],
    [pushed, open],
    [open, worktreeRemoved],
    [worktreeRemoved, removed],
    [removed, merged],
  ] as const)
    assert.doesNotThrow(() => assertPlanningStateReplacement(left, right));
  const remoteBase = validatePlanningState(
    state(
      {
        kind: "spec",
        status: "complete",
        base,
        artifacts: [artifact("remote-base", oid("a"))],
        completion: { kind: "remote-base" },
      },
      6,
    ),
  );
  for (const document of [
    pushed,
    open,
    worktreeRemoved,
    removed,
    merged,
    remoteBase,
  ]) {
    const replacement = {
      ...document,
      revision: document.revision + 1,
      updatedAt: "2026-09-08T12:00:02.000Z",
    };
    assert.doesNotThrow(() =>
      assertPlanningStateReplacement(document, replacement),
    );
  }
  for (const [left, right] of [
    [open, removed],
    [worktreeRemoved, open],
    [pushed, removed],
    [open, merged],
  ] as const)
    assert.throws(
      () => assertPlanningStateReplacement(left, right),
      PlanningStateValidationError,
    );
});

test("freezes publication and pull request identity after branch publication", () => {
  const pushed = validatePlanningState(
    state({
      kind: "spec",
      status: "branch-pushed",
      base,
      workspace: workspace(),
      artifacts: [artifact("workspace", oid("b"))],
      publication,
    }),
  );
  for (const mutate of [
    (phase: Record<string, unknown>) =>
      ((phase.publication as Record<string, unknown>).headOid = oid("c")),
    (phase: Record<string, unknown>) =>
      ((phase.publication as Record<string, unknown>).headBranch =
        "planning/other"),
    (phase: Record<string, unknown>) =>
      ((phase.workspace as Record<string, unknown>).headOid = oid("c")),
    (phase: Record<string, unknown>) =>
      ((phase.artifacts as Array<Record<string, unknown>>)[0]!.commitOid =
        oid("c")),
  ]) {
    const next = structuredClone(pushed.phases[0]!) as Record<string, unknown>;
    mutate(next);
    assert.throws(
      () => assertPlanningStateReplacement(pushed.phases[0]!, next as never),
      PlanningStateValidationError,
    );
  }
});

test("rejects unknown and missing fields for every durable phase discriminator", () => {
  const variants: Array<Record<string, unknown>> = [
    { kind: "spec", status: "pending" },
    {
      kind: "spec",
      status: "workspace-ready",
      base,
      workspace: workspace(),
      artifacts: [],
    },
    {
      kind: "spec",
      status: "branch-pushed",
      base,
      workspace: workspace(),
      artifacts: [artifact("workspace", oid("b"))],
      publication,
    },
    {
      kind: "spec",
      status: "pull-request-open",
      base,
      workspace: workspace(),
      artifacts: [artifact("workspace", oid("b"))],
      publication,
      pullRequest,
    },
    {
      kind: "spec",
      status: "complete",
      base,
      artifacts: [artifact("remote-base", oid("a"))],
      completion: { kind: "remote-base" },
    },
    {
      kind: "spec",
      status: "complete",
      base,
      workspace: workspace({ state: "removed", pushedHeadOid: oid("b") }),
      artifacts: [artifact("remote-base", oid("c"))],
      publication,
      pullRequest,
      completion: {
        kind: "merged-pull-request",
        mergeOid: oid("d"),
        mergedBaseOid: oid("c"),
      },
    },
  ];
  for (const variant of variants) {
    const unknown = structuredClone(variant);
    unknown.unexpected = true;
    assert.throws(
      () => validatePlanningState(state(unknown)),
      PlanningStateValidationError,
    );
    const missing = structuredClone(variant);
    delete missing.kind;
    assert.throws(
      () => validatePlanningState(state(missing)),
      PlanningStateValidationError,
    );
  }
});

test("permits revision-stepped idempotence for pending and workspace-ready", () => {
  const pending = validatePlanningState(
    state({ kind: "spec", status: "pending" }),
  );
  const pendingRetry = {
    ...pending,
    revision: 1,
    updatedAt: "2026-09-08T12:00:01.000Z",
  };
  assert.doesNotThrow(() =>
    assertPlanningStateReplacement(pending, pendingRetry),
  );
  const ready = validatePlanningState(
    state({
      kind: "spec",
      status: "workspace-ready",
      base,
      workspace: workspace(),
      artifacts: [],
    }),
  );
  const readyRetry = {
    ...ready,
    revision: 1,
    updatedAt: "2026-09-08T12:00:01.000Z",
  };
  assert.doesNotThrow(() => assertPlanningStateReplacement(ready, readyRetry));
});

test("accepts implementation checkpoints only with immutable validated evidence", () => {
  const implementationWorkspace = {
    ...workspace(),
    phase: "implementation",
    identity: {
      branch: "planning/implementation",
      worktreePath: ".worktrees/188-implementation",
    },
    headOid: oid("c"),
  };
  const implementationPublication = {
    ...publication,
    headBranch: "planning/implementation",
    headOid: oid("c"),
  };
  const implementation = {
    status: "pr-created",
    prUrl: "https://github.com/acme/patchmill/pull/189",
    branch: "planning/implementation",
    commits: [oid("c")],
    validation: ["npm test"],
    visualEvidence: [],
  };
  const implementationPullRequest = {
    reference: { targetRepository: publication.targetRepository, number: 189 },
    url: "https://github.com/acme/patchmill/pull/189",
  };
  const document = {
    version: 1,
    workflowVersion: "planning-pr-v1",
    runId,
    issueNumber: 188,
    issueTitle: "Example",
    gates: { specRequired: false, planRequired: false },
    phases: [
      {
        kind: "implementation",
        status: "pull-request-open",
        base,
        workspace: implementationWorkspace,
        artifacts: [
          artifact("workspace", oid("c")),
          {
            kind: "plan",
            path: "docs/plans/example-issue-188.md",
            source: "workspace",
            commitOid: oid("c"),
          },
        ],
        publication: implementationPublication,
        pullRequest: implementationPullRequest,
        implementation,
        finish: {},
      },
    ],
    revision: 0,
    createdAt: now,
    updatedAt: now,
  };
  const initial = validatePlanningState(document);
  assert.equal(initial.phases[0]!.status, "pull-request-open");
  const skippedFinish = structuredClone(document);
  skippedFinish.revision = 1;
  skippedFinish.updatedAt = "2026-09-08T12:00:01.000Z";
  skippedFinish.phases[0]!.finish = {
    costPublicationCompleted: true,
    visualEvidenceValidated: true,
    handoffCommentPosted: true,
    cleanupHookCompleted: true,
    doneLabelEnsured: true,
    doneLabelApplied: true,
  };
  assert.throws(
    () =>
      assertPlanningStateReplacement(
        initial,
        validatePlanningState(skippedFinish),
      ),
    PlanningStateValidationError,
  );
  const cleanupBeforeHook = structuredClone(document);
  cleanupBeforeHook.revision = 1;
  cleanupBeforeHook.updatedAt = "2026-09-08T12:00:01.000Z";
  cleanupBeforeHook.phases[0]!.workspace.cleanup = {
    state: "worktree-removed",
    pushedHeadOid: oid("c"),
  };
  assert.throws(
    () =>
      assertPlanningStateReplacement(
        initial,
        validatePlanningState(cleanupBeforeHook),
      ),
    PlanningStateValidationError,
  );
  const workspaceReady = structuredClone(document);
  workspaceReady.phases[0]!.status = "workspace-ready";
  workspaceReady.phases[0]!.artifacts = [
    workspaceReady.phases[0]!.artifacts[0]!,
  ];
  delete workspaceReady.phases[0]!.publication;
  delete workspaceReady.phases[0]!.pullRequest;
  delete workspaceReady.phases[0]!.implementation;
  delete workspaceReady.phases[0]!.finish;
  const appendedArtifact = structuredClone(workspaceReady);
  appendedArtifact.revision = 1;
  appendedArtifact.updatedAt = "2026-09-08T12:00:01.000Z";
  appendedArtifact.phases[0]!.workspace.headOid = oid("d");
  appendedArtifact.phases[0]!.artifacts[0]!.commitOid = oid("d");
  appendedArtifact.phases[0]!.artifacts.push({
    kind: "plan",
    path: "docs/plans/example-issue-188.md",
    source: "workspace",
    commitOid: oid("d"),
  });
  assert.throws(
    () =>
      assertPlanningStateReplacement(
        validatePlanningState(workspaceReady),
        validatePlanningState(appendedArtifact),
      ),
    PlanningStateValidationError,
  );
  const removed = structuredClone(document);
  removed.phases[0]!.workspace.cleanup = {
    state: "removed",
    pushedHeadOid: oid("c"),
  };
  removed.phases[0]!.finish = {
    costPublicationCompleted: true,
    visualEvidenceValidated: true,
    handoffCommentPosted: true,
    cleanupHookCompleted: true,
    doneLabelEnsured: true,
    doneLabelApplied: true,
  };
  const terminal = structuredClone(removed);
  terminal.revision = 1;
  terminal.updatedAt = "2026-09-08T12:00:01.000Z";
  terminal.phases[0]!.status = "complete";
  terminal.phases[0]!.completion = { kind: "implementation-pull-request" };
  terminal.phases[0]!.artifacts[0]!.commitOid = oid("d");
  assert.throws(
    () =>
      assertPlanningStateReplacement(
        validatePlanningState(removed),
        validatePlanningState(terminal),
      ),
    PlanningStateValidationError,
  );
  const remoteBase = structuredClone(document);
  remoteBase.phases[0]!.status = "complete";
  remoteBase.phases[0]!.completion = { kind: "remote-base" };
  delete remoteBase.phases[0]!.workspace;
  delete remoteBase.phases[0]!.publication;
  delete remoteBase.phases[0]!.pullRequest;
  delete remoteBase.phases[0]!.implementation;
  delete remoteBase.phases[0]!.finish;
  assert.throws(
    () => validatePlanningState(remoteBase),
    (error: unknown) =>
      error instanceof PlanningStateValidationError &&
      error.reason === "implementation-completion",
  );
});

test("permits implementation workspace initialization and a newer branch-pushed head", () => {
  const pending = validatePlanningState({
    version: 1,
    workflowVersion: "planning-pr-v1",
    runId,
    issueNumber: 188,
    issueTitle: "Example",
    gates: { specRequired: false, planRequired: false },
    phases: [{ kind: "implementation", status: "pending" }],
    revision: 0,
    createdAt: now,
    updatedAt: now,
  });
  const workspaceReady = validatePlanningState({
    ...pending,
    revision: 1,
    updatedAt: "2026-09-08T12:00:01.000Z",
    phases: [
      {
        kind: "implementation",
        status: "workspace-ready",
        base,
        workspace: {
          ...workspace(),
          phase: "implementation",
          identity: {
            branch: "planning/implementation",
            worktreePath: ".worktrees/188-implementation",
          },
        },
        artifacts: [
          artifact("workspace", oid("b")),
          {
            kind: "plan",
            path: "docs/plans/example-issue-188.md",
            source: "workspace",
            commitOid: oid("b"),
          },
        ],
      },
    ],
  });
  assert.doesNotThrow(() =>
    assertPlanningStateReplacement(pending, workspaceReady),
  );
  const branchPushed = validatePlanningState({
    ...workspaceReady,
    revision: 2,
    updatedAt: "2026-09-08T12:00:02.000Z",
    phases: [
      {
        ...workspaceReady.phases[0]!,
        status: "branch-pushed",
        workspace: {
          ...(workspaceReady.phases[0] as { workspace: object }).workspace,
          headOid: oid("c"),
        },
        publication: {
          ...publication,
          headBranch: "planning/implementation",
          headOid: oid("c"),
        },
        implementation: {
          status: "pr-created",
          prUrl: "https://github.com/acme/patchmill/pull/189",
          branch: "planning/implementation",
          commits: [oid("c")],
          validation: ["npm test"],
          visualEvidence: [],
        },
      },
    ],
  });
  assert.doesNotThrow(() =>
    assertPlanningStateReplacement(workspaceReady, branchPushed),
  );
});

test("requires an empty finish checkpoint when implementation PR validation opens", () => {
  const current = validatePlanningState({
    version: 1,
    workflowVersion: "planning-pr-v1",
    runId,
    issueNumber: 188,
    issueTitle: "Example",
    gates: { specRequired: false, planRequired: false },
    phases: [
      {
        kind: "implementation",
        status: "branch-pushed",
        base,
        workspace: {
          ...workspace(),
          phase: "implementation",
          identity: {
            branch: "planning/implementation",
            worktreePath: ".worktrees/188-implementation",
          },
          headOid: oid("c"),
        },
        artifacts: [
          artifact("workspace", oid("c")),
          {
            kind: "plan",
            path: "docs/plans/example-issue-188.md",
            source: "workspace",
            commitOid: oid("c"),
          },
        ],
        publication: {
          ...publication,
          headBranch: "planning/implementation",
          headOid: oid("c"),
        },
        implementation: {
          status: "pr-created",
          prUrl: "https://github.com/acme/patchmill/pull/189",
          branch: "planning/implementation",
          commits: [oid("c")],
          validation: ["npm test"],
          visualEvidence: [],
        },
      },
    ],
    revision: 0,
    createdAt: now,
    updatedAt: now,
  });
  const next = validatePlanningState({
    ...current,
    revision: 1,
    updatedAt: "2026-09-08T12:00:01.000Z",
    phases: [
      {
        ...current.phases[0]!,
        status: "pull-request-open",
        pullRequest: {
          reference: {
            targetRepository: publication.targetRepository,
            number: 189,
          },
          url: "https://github.com/acme/patchmill/pull/189",
        },
        finish: { costPublicationCompleted: true },
      },
    ],
  });
  assert.throws(
    () => assertPlanningStateReplacement(current, next),
    PlanningStateValidationError,
  );
  const preHookCheckpoint = structuredClone(next);
  preHookCheckpoint.phases[0]!.finish = {
    costPublicationCompleted: true,
    visualEvidenceValidated: true,
    handoffCommentPosted: true,
    cleanupHookStarted: true,
  };
  assert.throws(
    () => validatePlanningState(preHookCheckpoint),
    (error: unknown) =>
      error instanceof PlanningStateValidationError &&
      error.reason === "unknown-key" &&
      error.path.endsWith(".cleanupHookStarted"),
  );
});

test("preserves complete sanitized implementation agent evidence", () => {
  const document = {
    version: 1,
    workflowVersion: "planning-pr-v1",
    runId,
    issueNumber: 188,
    issueTitle: "Example",
    gates: { specRequired: false, planRequired: false },
    phases: [
      {
        kind: "implementation",
        status: "branch-pushed",
        base,
        workspace: {
          ...workspace(),
          phase: "implementation",
          identity: {
            branch: "planning/implementation",
            worktreePath: ".worktrees/188-implementation",
          },
          headOid: oid("c"),
        },
        artifacts: [
          artifact("workspace", oid("c")),
          {
            kind: "plan",
            path: "docs/plans/example-issue-188.md",
            source: "workspace",
            commitOid: oid("c"),
          },
        ],
        publication: {
          ...publication,
          headBranch: "planning/implementation",
          headOid: oid("c"),
        },
        implementation: {
          status: "pr-created",
          prUrl: "https://github.com/acme/patchmill/pull/189",
          branch: "planning/implementation",
          commits: [oid("c")],
          validation: ["npm test"],
          reviewSummary: "reviewed",
          landingDecision: "PR required",
          visualEvidence: [
            {
              screenshotPath: "docs/screenshots/result.png",
              caption: "Result",
              referencePaths: ["docs/screenshots/before.png"],
              url: "https://example.test/evidence/189",
            },
          ],
          runCostReport: {
            stages: [
              {
                stage: "implementation",
                models: [
                  {
                    model: "example/model",
                    promptTokens: 1,
                    outputTokens: 2,
                    estimatedCostUsd: 0.03,
                  },
                ],
                promptTokens: 1,
                outputTokens: 2,
                estimatedCostUsd: 0.03,
              },
            ],
            promptTokens: 1,
            outputTokens: 2,
            estimatedCostUsd: 0.03,
          },
        },
      },
    ],
    revision: 0,
    createdAt: now,
    updatedAt: now,
  };
  const parsed = validatePlanningState(document);
  assert.deepEqual(
    (parsed.phases[0] as { implementation: unknown }).implementation,
    document.phases[0]!.implementation,
  );
  const blankValidation = structuredClone(document);
  blankValidation.phases[0]!.implementation.validation = ["   "];
  assert.throws(
    () => validatePlanningState(blankValidation),
    (error: unknown) =>
      error instanceof PlanningStateValidationError &&
      error.reason === "invalid-string" &&
      error.path === "$.phases[0].implementation.validation[0]",
  );
  const unsafe = structuredClone(document);
  unsafe.phases[0]!.implementation.prUrl =
    "https://token@example.test/pull/189";
  assert.throws(
    () => validatePlanningState(unsafe),
    (error: unknown) =>
      error instanceof PlanningStateValidationError &&
      error.reason === "invalid-url" &&
      error.path === "$.phases[0].implementation.prUrl",
  );
});
