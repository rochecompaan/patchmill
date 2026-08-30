import assert from "node:assert/strict";
import test from "node:test";
import { validateResetIssueEligibility } from "./reset.ts";
import type {
  AgentIssueConfig,
  AgentIssueRunState,
  IssueSummary,
} from "../../run-once/types.ts";
const config = {
  readyLabel: "agent-ready",
  triagePolicy: {
    labels: {
      ready: "agent-ready",
      inProgress: "in-progress",
      done: "agent-done",
      needsInfo: "needs-info",
    },
  },
} as AgentIssueConfig;
const issue = (labels: string[], state: "open" | "closed" = "open") =>
  ({ number: 45, title: "Recover", state, labels }) as IssueSummary;
const run = (
  status: AgentIssueRunState["status"],
  extra: Partial<AgentIssueRunState> = {},
) =>
  ({
    issueNumber: 45,
    title: "Recover",
    status,
    createdAt: "x",
    updatedAt: "x",
    ...extra,
  }) as AgentIssueRunState;
test("allows active saved statuses only with in-progress", () => {
  for (const status of ["claimed", "planning", "implementing"] as const)
    assert.doesNotThrow(() =>
      validateResetIssueEligibility({
        issue: issue(["in-progress"]),
        state: run(status),
        config,
      }),
    );
});
test("requires agent-ready for blocked and blocked-finished recovery", () => {
  for (const state of [
    run("blocked"),
    run("finished", { blockedAt: "x", lastError: "x" }),
  ]) {
    assert.throws(
      () =>
        validateResetIssueEligibility({
          issue: issue(["needs-info"]),
          state,
          config,
        }),
      /not eligible/,
    );
    assert.doesNotThrow(() =>
      validateResetIssueEligibility({
        issue: issue(["agent-ready", "needs-info"]),
        state,
        config,
      }),
    );
  }
});
test("allows normal finished state with ready or in-progress", () => {
  for (const label of ["agent-ready", "in-progress"])
    assert.doesNotThrow(() =>
      validateResetIssueEligibility({
        issue: issue([label]),
        state: run("finished"),
        config,
      }),
    );
});
test("rejects closed issues and wrong active labels before mutation", () => {
  assert.throws(
    () =>
      validateResetIssueEligibility({
        issue: issue(["in-progress"], "closed"),
        state: run("blocked"),
        config,
      }),
    /not open/,
  );
  assert.throws(
    () =>
      validateResetIssueEligibility({
        issue: issue(["agent-ready"]),
        state: run("implementing"),
        config,
      }),
    /not eligible/,
  );
});
test("allows absent state so reset can provide guidance", () =>
  assert.doesNotThrow(() =>
    validateResetIssueEligibility({ issue: issue([]), config }),
  ));
