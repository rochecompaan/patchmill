import assert from "node:assert/strict";
import test from "node:test";
import type { PullRequestOpenPlanningPhase } from "../../../workflow/planning-state-types.ts";
import { finishPlanningPhaseCleanup } from "./planning-phase-cleanup.ts";

const oid = "a".repeat(40);
const repository = {
  provider: "github-gh" as const,
  host: "github.com",
  owner: "acme",
  repository: "patchmill",
};

function phase(): PullRequestOpenPlanningPhase {
  return {
    kind: "spec",
    status: "pull-request-open",
    base: {
      remote: "origin",
      baseBranch: "main",
      baseOid: oid,
      artifactCandidates: { spec: [], plan: [] },
    },
    workspace: {
      runId: "123e4567-e89b-42d3-a456-426614174000",
      phase: "spec",
      identity: { branch: "planning/spec", worktreePath: "/workspace" },
      remote: "origin",
      baseBranch: "main",
      baseOid: oid,
      headOid: oid,
      cleanup: { state: "ready" },
    },
    artifacts: [
      {
        kind: "spec",
        path: "docs/specs/issue-243.md",
        source: "workspace",
        commitOid: oid,
      },
    ],
    publication: {
      targetRepository: repository,
      headRepository: repository,
      baseBranch: "main",
      headBranch: "planning/spec",
      headOid: oid,
    },
    pullRequest: {
      reference: { targetRepository: repository, number: 243 },
      url: "https://github.com/acme/patchmill/pull/243",
    },
  };
}

test("planning cleanup refreshes ignored inventory and resumes branch cleanup after it clears", async () => {
  let current = phase();
  const events: string[] = [];
  const checkpoints: string[] = [];
  const inventories = [[".env"], [".env"], [".env", "build/"], []];
  let assessment = 0;
  const run = async () => {
    const outcome = await finishPlanningPhaseCleanup({
      phase: current,
      remoteHead: async () => events.push("remote-head"),
      workspaces: {
        removeWorktree: async () => {
          events.push("remove-worktree");
          const ignoredPaths = inventories[assessment++]!;
          if (ignoredPaths.length > 0)
            return {
              kind: "cleanup-pending" as const,
              reason: "ignored-worktree-content" as const,
              ignoredPaths,
            };
          return {
            kind: "removed" as const,
            snapshot: {
              state: "branch-only" as const,
              identity: current.workspace.identity,
              headOid: oid,
            },
          };
        },
        removeBranch: async () => {
          events.push("remove-branch");
          return {
            state: "missing" as const,
            identity: current.workspace.identity,
          };
        },
      } as never,
      checkpoint: async (next) => {
        current = next;
        checkpoints.push(next.workspace.cleanup.state);
      },
    });
    current = outcome.phase;
    return outcome;
  };

  assert.equal((await run()).kind, "cleanup-pending");
  assert.equal((await run()).kind, "cleanup-pending");
  assert.equal((await run()).kind, "cleanup-pending");
  assert.equal((await run()).kind, "cleaned");
  assert.deepEqual(checkpoints, [
    "cleanup-pending",
    "cleanup-pending",
    "worktree-removed",
    "removed",
  ]);
  assert.deepEqual(events, [
    "remote-head",
    "remove-worktree",
    "remote-head",
    "remove-worktree",
    "remote-head",
    "remove-worktree",
    "remote-head",
    "remove-worktree",
    "remove-branch",
  ]);
  assert.equal(current.workspace.cleanup.state, "removed");
});
