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

function phase(kind: "spec" | "plan"): PullRequestOpenPlanningPhase {
  return {
    kind,
    status: "pull-request-open",
    base: {
      remote: "origin",
      baseBranch: "main",
      baseOid: oid,
      artifactCandidates: { spec: [], plan: [] },
    },
    workspace: {
      runId: "123e4567-e89b-42d3-a456-426614174000",
      phase: kind,
      identity: { branch: `planning/${kind}`, worktreePath: "/workspace" },
      remote: "origin",
      baseBranch: "main",
      baseOid: oid,
      headOid: oid,
      cleanup: {
        state: "cleanup-pending",
        reason: "ignored-worktree-content",
        ignoredPaths: [".env", "build/output\nname.bin"],
      },
    },
    artifacts: [
      {
        kind,
        path: `docs/${kind}s/issue-262.md`,
        source: "workspace",
        commitOid: oid,
      },
    ],
    publication: {
      targetRepository: repository,
      headRepository: repository,
      baseBranch: "main",
      headBranch: `planning/${kind}`,
      headOid: oid,
    },
    pullRequest: {
      reference: { targetRepository: repository, number: 262 },
      url: "https://github.com/acme/patchmill/pull/262",
    },
  };
}

test("spec and plan cleanup resume legacy pending state directly to removed", async () => {
  for (const kind of ["spec", "plan"] as const) {
    let current = phase(kind);
    const events: string[] = [];
    const checkpoints: string[] = [];
    let remoteChecks = 0;
    const outcome = await finishPlanningPhaseCleanup({
      phase: current,
      authorization: {
        kind: "publication",
        remoteHead: async (candidate) => {
          assert.equal(candidate.workspace.identity.branch, `planning/${kind}`);
          assert.equal(candidate.publication.headOid, oid);
          remoteChecks += 1;
          return { state: "present", headOid: oid };
        },
      },
      workspaces: {
        removeWorktree: async (input) => {
          assert.equal(remoteChecks, 1, "publication must be checked first");
          events.push(`worktree:${input.workspace.cleanup.state}`);
          return {
            kind: "removed",
            snapshot: {
              state: "branch-only",
              identity: current.workspace.identity,
              headOid: oid,
            },
          };
        },
        removeBranch: async () => {
          events.push("branch");
          return { state: "missing", identity: current.workspace.identity };
        },
      } as never,
      checkpoint: async (next) => {
        current = next;
        checkpoints.push(next.workspace.cleanup.state);
      },
    });
    assert.equal(outcome.kind, "cleaned");
    assert.equal(remoteChecks, 1);
    assert.deepEqual(events, ["worktree:cleanup-pending", "branch"]);
    assert.deepEqual(checkpoints, ["worktree-removed", "removed"]);
    assert.equal(current.workspace.cleanup.state, "removed");
  }
});
