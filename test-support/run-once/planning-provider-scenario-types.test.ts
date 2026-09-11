import assert from "node:assert/strict";
import test from "node:test";
import type { PlanningScenarioEffect } from "./planning-provider-scenario-types.ts";

test("scenario effects require operation-specific ownership", () => {
  const valid: PlanningScenarioEffect = {
    kind: "write",
    operation: "workspace-remove",
    phase: "plan",
    branch: "agent/issue-190-plan",
    worktreePath: ".worktrees/issue-190-plan",
  };
  assert.equal(valid.operation, "workspace-remove");

  // @ts-expect-error Cleanup writes require their saved worktree identity.
  const _missingCleanupOwnership: PlanningScenarioEffect = {
    kind: "write",
    operation: "workspace-remove",
    phase: "plan",
    branch: "agent/issue-190-plan",
  };
  // @ts-expect-error Interrupt effects always identify their armed failure point.
  const _missingInterruptPoint: PlanningScenarioEffect = {
    kind: "interrupt",
    operation: "persistence-interrupt",
  };
  // @ts-expect-error Reads cannot carry write-only phase ownership.
  const _readWithOwnership: PlanningScenarioEffect = {
    kind: "read",
    operation: "issue-read",
    phase: "plan",
  };
});
