import assert from "node:assert/strict";
import test from "node:test";
import { IssueRunLeaseConflictError } from "./recovery-lease.ts";
import { PlanningWorkspaceConflictError } from "../../../git/planning-workspaces.ts";
import { failureForPipelineError } from "./pipeline-error-diagnostics.ts";

test("maps Issue run lease conflicts without exposing fencing tokens", () => {
  const failure = failureForPipelineError(
    new IssueRunLeaseConflictError(
      "/repo/.patchmill/locks/issue-242.lock",
      "lease",
      242,
      {
        version: 1,
        issueNumber: 242,
        pid: 12,
        hostname: "host",
        ownerToken: "secret-fencing-token",
        acquiredAt: "2026-09-20T12:00:00.000Z",
      },
    ),
  );
  assert.equal(failure.reason, "active-run");
  if (failure.reason === "active-run") {
    assert.equal(
      failure.diagnosticContext.leasePath,
      "/repo/.patchmill/locks/issue-242.lock",
    );
    assert.equal(failure.diagnosticContext.resource, "lease");
    assert.deepEqual(failure.diagnosticContext.owner, {
      pid: 12,
      hostname: "host",
      acquiredAt: "2026-09-20T12:00:00.000Z",
    });
    assert.doesNotMatch(
      JSON.stringify(failure.diagnosticContext),
      /secret-fencing-token/u,
    );
  }
});

test("maps planning workspace conflicts with the preserved workspace identity", () => {
  const failure = failureForPipelineError(
    new PlanningWorkspaceConflictError("dirty-worktree", {
      branch: "agent/issue-242-plan",
      worktreePath: ".worktrees/issue-242-plan",
    }),
  );
  assert.equal(failure.reason, "planning-workspace-conflict");
  if (failure.reason === "planning-workspace-conflict")
    assert.deepEqual(failure.diagnosticContext, {
      conflictReason: "dirty-worktree",
      branch: "agent/issue-242-plan",
      worktreePath: ".worktrees/issue-242-plan",
    });
});
