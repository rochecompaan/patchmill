import assert from "node:assert/strict";
import test from "node:test";
import { PlanningIssueLockConflictError } from "../../../workflow/planning-issue-lock.ts";
import { runPlanningIssue } from "./planning-pipeline.ts";

test("returns stopped without mutation for an active planning lock", async () => {
  let mutated = false;
  const result = await runPlanningIssue({
    issue: {
      number: 189,
      title: "Example",
      state: "open",
      labels: [],
    } as never,
    state: { runId: "123e4567-e89b-42d3-a456-426614174000" } as never,
    runStateDir: "/tmp/state",
    stateStore: {} as never,
    readIssue: async () => {
      throw new Error("unreachable");
    },
    readLegacy: async () => false,
    mutate: async () => {
      mutated = true;
    },
    coordinate: async () => {
      throw new Error("unreachable");
    },
    acquire: async () => {
      throw new PlanningIssueLockConflictError({
        classification: "active",
        path: "lock",
        fingerprint: "",
      });
    },
  });
  assert.equal(result.status, "stopped");
  assert.equal(mutated, false);
});
