import assert from "node:assert/strict";
import test from "node:test";
import { assertPlanningPhaseReplacement } from "./planning-state-transitions.ts";
import {
  PlanningStateValidationError,
  validatePlanningState,
} from "./planning-state.ts";

const oid = (character: string) => character.repeat(40);
const runId = "123e4567-e89b-42d3-a456-426614174000";
const base = {
  remote: "origin",
  baseBranch: "main",
  baseOid: oid("a"),
  artifactCandidates: { spec: ["docs/specs/a.md"], plan: [] },
};
const workspace = (cleanup: unknown = { state: "ready" }) => ({
  runId,
  phase: "spec",
  identity: { branch: "planning/spec", worktreePath: ".worktrees/spec" },
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
const artifact = (
  source: "workspace" | "remote-base" = "workspace",
  commitOid = oid("b"),
) => ({
  kind: "spec",
  path: "docs/specs/a.md",
  source,
  commitOid,
});
const pullRequest = {
  reference: { targetRepository: publication.targetRepository, number: 188 },
  url: "https://github.com/acme/patchmill/pull/188",
};
function phase(
  status: string,
  cleanup: unknown = { state: "ready" },
): Record<string, unknown> {
  if (status === "pending") return { kind: "spec", status };
  if (status === "workspace-ready")
    return {
      kind: "spec",
      status,
      base,
      workspace: workspace(cleanup),
      artifacts: [],
    };
  if (status === "branch-pushed")
    return {
      kind: "spec",
      status,
      base,
      workspace: workspace(cleanup),
      artifacts: [artifact()],
      publication,
    };
  if (status === "pull-request-open")
    return {
      kind: "spec",
      status,
      base,
      workspace: workspace(cleanup),
      artifacts: [artifact()],
      publication,
      pullRequest,
    };
  if (status === "remote-base")
    return {
      kind: "spec",
      status: "complete",
      base,
      artifacts: [artifact("remote-base", oid("a"))],
      completion: { kind: "remote-base" },
    };
  return {
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
  };
}
function document(phaseValue: object) {
  return {
    version: 1,
    workflowVersion: "planning-pr-v1",
    runId,
    issueNumber: 188,
    issueTitle: "Example",
    gates: { specRequired: true, planRequired: false },
    phases: [phaseValue, { kind: "implementation", status: "pending" }],
    revision: 0,
    createdAt: "2026-09-08T12:00:00.000Z",
    updatedAt: "2026-09-08T12:00:00.000Z",
  };
}
function parsed(status: string, cleanup?: unknown) {
  return validatePlanningState(document(phase(status, cleanup))).phases[0]!;
}
function invalid(value: unknown, reason: string, path: string): void {
  assert.throws(
    () => validatePlanningState(value),
    (error: unknown) =>
      error instanceof PlanningStateValidationError &&
      error.reason === reason &&
      error.path === path,
  );
}

test("rejects nested unknown and missing fields at stable paths for every state variant", () => {
  const cases: ReadonlyArray<
    [string, string, (value: Record<string, unknown>) => void, string, string]
  > = [
    [
      "pending unknown",
      "pending",
      (value) => {
        value.extra = true;
      },
      "unknown-key",
      "$.phases[0].extra",
    ],
    [
      "workspace base missing",
      "workspace-ready",
      (value) => {
        delete (value.base as Record<string, unknown>).remote;
      },
      "missing-key",
      "$.phases[0].base.remote",
    ],
    [
      "branch publication unknown",
      "branch-pushed",
      (value) => {
        (value.publication as Record<string, unknown>).extra = true;
      },
      "unknown-key",
      "$.phases[0].publication.extra",
    ],
    [
      "open reference missing",
      "pull-request-open",
      (value) => {
        delete (
          (value.pullRequest as Record<string, unknown>).reference as Record<
            string,
            unknown
          >
        ).number;
      },
      "missing-key",
      "$.phases[0].pullRequest.reference.number",
    ],
    [
      "remote completion unknown",
      "remote-base",
      (value) => {
        (value.completion as Record<string, unknown>).extra = true;
      },
      "unknown-key",
      "$.phases[0].completion.extra",
    ],
    [
      "merged completion missing",
      "merged",
      (value) => {
        delete (value.completion as Record<string, unknown>).mergedBaseOid;
      },
      "missing-key",
      "$.phases[0].completion.mergedBaseOid",
    ],
  ];
  for (const [, status, mutate, reason, path] of cases) {
    const value = structuredClone(phase(status));
    mutate(value);
    invalid(document(value), reason, path);
  }
});

test("rejects artifact, publication, cleanup, pull request, and phase-order contradictions", () => {
  const cases: ReadonlyArray<
    [string, (value: Record<string, unknown>) => void, string, string]
  > = [
    [
      "workspace artifact commit",
      (value) => {
        (value.artifacts as Record<string, unknown>[])[0]!.commitOid = oid("a");
      },
      "workspace-artifact-mismatch",
      "$.phases[0].artifacts[0]",
    ],
    [
      "remote artifact source",
      (value) => {
        (value.artifacts as Record<string, unknown>[])[0]!.source =
          "remote-base";
      },
      "remote-artifact-mismatch",
      "$.phases[0].artifacts[0]",
    ],
    [
      "publication branch",
      (value) => {
        (value.publication as Record<string, unknown>).headBranch =
          "planning/other";
      },
      "publication-mismatch",
      "$.phases[0].publication",
    ],
    [
      "cleanup head",
      (value) => {
        (value.workspace as Record<string, unknown>).cleanup = {
          state: "removed",
          pushedHeadOid: oid("c"),
        };
      },
      "cleanup-head-mismatch",
      "$.phases[0].workspace.cleanup.pushedHeadOid",
    ],
    [
      "pull request target",
      (value) => {
        (
          (value.pullRequest as Record<string, unknown>).reference as Record<
            string,
            unknown
          >
        ).targetRepository = {
          ...publication.targetRepository,
          repository: "other",
        };
      },
      "pull-request-mismatch",
      "$.phases[0].pullRequest",
    ],
  ];
  for (const [, mutate, reason, path] of cases) {
    const value = structuredClone(phase("pull-request-open"));
    mutate(value);
    invalid(document(value), reason, path);
  }
  const outOfOrder = document(phase("pending"));
  outOfOrder.phases[1] = {
    kind: "implementation",
    status: "workspace-ready",
    base: {
      ...base,
      artifactCandidates: { spec: [], plan: ["docs/plans/a.md"] },
    },
    workspace: {
      ...workspace(),
      phase: "implementation",
      identity: {
        branch: "planning/implementation",
        worktreePath: ".worktrees/implementation",
      },
    },
    artifacts: [],
  };
  invalid(outOfOrder, "progress-order", "$.phases[1]");
});

test("requires planner artifact order and source-specific commit evidence", () => {
  const planBase = {
    ...base,
    artifactCandidates: {
      spec: ["docs/specs/a.md"],
      plan: ["docs/plans/a.md"],
    },
  };
  const planWorkspace = {
    ...workspace(),
    phase: "plan",
    identity: { branch: "planning/plan", worktreePath: ".worktrees/plan" },
  };
  const planPhase = {
    kind: "plan",
    status: "workspace-ready",
    base: planBase,
    workspace: planWorkspace,
    artifacts: [
      {
        kind: "spec",
        path: "docs/specs/a.md",
        source: "remote-base",
        commitOid: oid("a"),
      },
      {
        kind: "plan",
        path: "docs/plans/a.md",
        source: "workspace",
        commitOid: oid("b"),
      },
    ],
  };
  const value = {
    ...document(planPhase),
    gates: { specRequired: false, planRequired: true },
    phases: [planPhase, { kind: "implementation", status: "pending" }],
  };
  assert.doesNotThrow(() => validatePlanningState(value));
  const reversed = structuredClone(value);
  reversed.phases[0].artifacts.reverse();
  invalid(reversed, "artifact-kinds", "$.phases[0].artifacts");
  const wrongRemoteCommit = structuredClone(value);
  wrongRemoteCommit.phases[0].artifacts[0].commitOid = oid("c");
  invalid(
    wrongRemoteCommit,
    "remote-artifact-mismatch",
    "$.phases[0].artifacts[0]",
  );
});

test("rejects duplicate and canonically equivalent workspace identities", () => {
  const planBase = {
    ...base,
    artifactCandidates: {
      spec: ["docs/specs/a.md"],
      plan: ["docs/plans/a.md"],
    },
  };
  const planWorkspace = {
    ...workspace({ state: "removed", pushedHeadOid: oid("b") }),
    phase: "plan",
    identity: { branch: "planning/plan", worktreePath: ".worktrees/plan" },
  };
  const planPublication = { ...publication, headBranch: "planning/plan" };
  const planPullRequest = {
    reference: { targetRepository: publication.targetRepository, number: 189 },
    url: "https://github.com/acme/patchmill/pull/189",
  };
  const completePlan = {
    kind: "plan",
    status: "complete",
    base: planBase,
    workspace: planWorkspace,
    artifacts: [
      {
        kind: "plan",
        path: "docs/plans/a.md",
        source: "remote-base",
        commitOid: oid("c"),
      },
    ],
    publication: planPublication,
    pullRequest: planPullRequest,
    completion: {
      kind: "merged-pull-request",
      mergeOid: oid("d"),
      mergedBaseOid: oid("c"),
    },
  };
  const implementationWorkspace = {
    ...workspace(),
    phase: "implementation",
    identity: {
      branch: "planning/implementation",
      worktreePath: ".worktrees/other/../plan",
    },
  };
  const value = {
    ...document(phase("remote-base")),
    gates: { specRequired: true, planRequired: true },
    phases: [
      phase("remote-base"),
      completePlan,
      {
        kind: "implementation",
        status: "workspace-ready",
        base: planBase,
        workspace: implementationWorkspace,
        artifacts: [],
      },
    ],
  };
  invalid(
    value,
    "duplicate-workspace-identity",
    "$.phases[2].workspace.identity",
  );
  const duplicateBranch = structuredClone(value);
  (duplicateBranch.phases[2].workspace.identity as { branch: string }).branch =
    "planning/plan";
  (
    duplicateBranch.phases[2].workspace.identity as { worktreePath: string }
  ).worktreePath = ".worktrees/implementation";
  invalid(
    duplicateBranch,
    "duplicate-workspace-identity",
    "$.phases[2].workspace.identity",
  );
});

test("permits every checkpoint edge and rejects skipped or backward checkpoint edges", () => {
  const ready = parsed("workspace-ready");
  const artifactReady = validatePlanningState(
    document({
      ...phase("workspace-ready"),
      workspace: { ...workspace(), headOid: oid("c") },
      artifacts: [artifact("workspace", oid("c"))],
    }),
  ).phases[0]!;
  const readyForPush = validatePlanningState(
    document({ ...phase("workspace-ready"), artifacts: [artifact()] }),
  ).phases[0]!;
  const pushed = parsed("branch-pushed");
  const open = parsed("pull-request-open");
  const worktreeRemoved = parsed("pull-request-open", {
    state: "worktree-removed",
    pushedHeadOid: oid("b"),
  });
  const removed = parsed("pull-request-open", {
    state: "removed",
    pushedHeadOid: oid("b"),
  });
  const remoteBase = parsed("remote-base");
  const merged = parsed("merged");
  const allowed: ReadonlyArray<[typeof ready, typeof ready]> = [
    [parsed("pending"), parsed("pending")],
    [parsed("pending"), ready],
    [parsed("pending"), remoteBase],
    [ready, ready],
    [ready, artifactReady],
    [ready, readyForPush],
    [readyForPush, pushed],
    [pushed, pushed],
    [pushed, open],
    [open, open],
    [open, worktreeRemoved],
    [worktreeRemoved, worktreeRemoved],
    [worktreeRemoved, removed],
    [removed, removed],
    [removed, merged],
    [remoteBase, remoteBase],
    [merged, merged],
  ];
  for (const [current, next] of allowed)
    assert.doesNotThrow(() => assertPlanningPhaseReplacement(current, next, 0));
  for (const [current, next] of [
    [ready, open],
    [pushed, removed],
    [open, removed],
    [worktreeRemoved, open],
    [removed, open],
  ] as const)
    assert.throws(
      () => assertPlanningPhaseReplacement(current, next, 0),
      PlanningStateValidationError,
    );
});

test("keeps immutable publication and pull request evidence after publication", () => {
  const pushed = parsed("branch-pushed");
  const open = parsed("pull-request-open");
  for (const mutate of [
    (value: Record<string, unknown>) => {
      (value.publication as Record<string, unknown>).headOid = oid("c");
    },
    (value: Record<string, unknown>) => {
      (value.workspace as Record<string, unknown>).headOid = oid("c");
    },
    (value: Record<string, unknown>) => {
      (value.artifacts as Record<string, unknown>[])[0]!.path =
        "docs/specs/other.md";
    },
    (value: Record<string, unknown>) => {
      (
        (value.pullRequest as Record<string, unknown>).reference as Record<
          string,
          unknown
        >
      ).number = 189;
    },
  ]) {
    const next = structuredClone(open) as Record<string, unknown>;
    mutate(next);
    assert.throws(
      () => assertPlanningPhaseReplacement(open, next as never, 0),
      PlanningStateValidationError,
    );
  }
  const changedPublication = structuredClone(pushed) as Record<string, unknown>;
  (changedPublication.publication as Record<string, unknown>).headOid =
    oid("c");
  assert.throws(
    () =>
      assertPlanningPhaseReplacement(pushed, changedPublication as never, 0),
    PlanningStateValidationError,
  );
});
