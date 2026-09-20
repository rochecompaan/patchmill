import assert from "node:assert/strict";
import test from "node:test";
import { IssueRunLeaseConflictError } from "./recovery-lease.ts";
import { PlanningWorkspaceConflictError } from "../../../git/planning-workspaces.ts";
import { failureForPipelineError } from "./pipeline-error-diagnostics.ts";
import { RunRecoveryRefusalError } from "./pipeline-recovery.ts";
import type { RunRecoveryAssessment, RunRecoveryDecision } from "./types.ts";

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

function assessment(): RunRecoveryAssessment {
  return {
    runStatePath: "/repo/.patchmill/runs/issue-242.json",
    issueNumber: 242,
    title: "Recover diagnostics",
    status: "blocked",
    lease: { status: "owned", ownerToken: "secret" },
    legacyMigrationFenceValid: true,
    blocked: true,
    expectedWorkspace: {
      branch: "agent/issue-242",
      worktreePath: ".worktrees/issue-242",
    },
    savedWorkspace: {
      branch: "agent/issue-242-saved",
      worktreePath: ".worktrees/issue-242-saved",
    },
    baseOid: "abc123",
    branch: { exists: true },
    worktree: {
      exists: true,
      registered: true,
      dirtyStatus: " M src/file.ts",
      ignoredEntries: [".agent/evidence.json"],
    },
    actualUniqueCommits: ["def456 preserve work"],
    savedCommits: [],
    artifacts: { spec: { valid: false }, plan: { valid: false } },
    classification: "dirty-worktree",
  };
}

test("maps every typed Run recovery refusal without flattening its evidence", () => {
  const assessedReasons = [
    "dirty-worktree",
    "unmerged-commits",
    "workspace-unverifiable",
    "legacy-active-unfenced",
    "not-blocked",
  ] as const;
  for (const reason of assessedReasons) {
    const decision: Extract<
      RunRecoveryDecision,
      { action: "refuse"; assessment: RunRecoveryAssessment }
    > = {
      action: "refuse",
      assessment: assessment(),
      reason,
      guidance: ["Preserve evidence before retrying."],
    };
    const error = new RunRecoveryRefusalError(decision);
    assert.equal(error.decision, decision);
    const failure = failureForPipelineError(error);
    assert.equal(failure.reason, reason);
    assert.equal(failure.diagnosticContext.issueNumber, 242);
  }

  const ignored: Extract<
    RunRecoveryDecision,
    { action: "refuse"; reason: "ignored-worktree-content" }
  > = {
    action: "refuse",
    assessment: assessment(),
    reason: "ignored-worktree-content",
    blockedAction: "archive-reset-and-start",
    guidance: ["Preserve ignored evidence before retrying."],
  };
  const ignoredFailure = failureForPipelineError(
    new RunRecoveryRefusalError(ignored),
  );
  assert.equal(ignoredFailure.reason, "ignored-worktree-content");
  if (ignoredFailure.reason === "ignored-worktree-content") {
    assert.deepEqual(ignoredFailure.diagnosticContext.ignoredPaths, [
      ".agent/evidence.json",
    ]);
    assert.equal(
      ignoredFailure.diagnosticContext.blockedAction,
      "archive-reset-and-start",
    );
  }

  const active = new RunRecoveryRefusalError({
    action: "refuse",
    reason: "active-run",
    resource: "lease-guard",
    leasePath: "/repo/.patchmill/locks/issue-242.lock",
    owner: {
      version: 1,
      issueNumber: 242,
      pid: 7,
      hostname: "builder",
      ownerToken: "secret-fencing-token",
      acquiredAt: "2026-09-20T12:00:00.000Z",
    },
    guidance: ["Wait for the owner."],
  });
  const activeFailure = failureForPipelineError(active);
  assert.equal(activeFailure.reason, "active-run");
  if (activeFailure.reason === "active-run") {
    assert.equal(activeFailure.diagnosticContext.resource, "lease-guard");
    assert.doesNotMatch(
      JSON.stringify(activeFailure.diagnosticContext),
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
