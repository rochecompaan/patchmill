import assert from "node:assert/strict";
import test from "node:test";
import { PlanningIssueLockConflictError } from "../../../workflow/planning-issue-lock.ts";
import { PlanningStateValidationError } from "../../../workflow/planning-state.ts";
import {
  planningIssueNeedsClaim,
  runPlanningIssue,
} from "./planning-pipeline.ts";

test("does not reclaim an issue after its done-label checkpoint", () => {
  assert.equal(
    planningIssueNeedsClaim({
      issue: {
        number: 189,
        title: "Example",
        state: "open",
        labels: ["agent-done"],
      } as never,
      fresh: false,
      state: {
        phases: [
          {
            kind: "implementation",
            status: "pull-request-open",
            finish: { doneLabelApplied: true },
          },
        ],
      } as never,
      labels: {
        ready: "agent-ready",
        inProgress: "agent-in-progress",
        done: "agent-done",
      },
    }),
    false,
  );
});

test("does not reclaim a done-labeled finish awaiting its final checkpoint", () => {
  assert.equal(
    planningIssueNeedsClaim({
      issue: {
        number: 189,
        title: "Example",
        state: "open",
        labels: ["agent-done"],
      } as never,
      fresh: false,
      state: {
        phases: [
          {
            kind: "implementation",
            status: "pull-request-open",
            workspace: { cleanup: { state: "removed" } },
            finish: {
              visualEvidenceValidated: true,
              handoffCommentPosted: true,
              cleanupHookCompleted: true,
              doneLabelEnsured: true,
            },
          },
        ],
      } as never,
      labels: {
        ready: "agent-ready",
        inProgress: "agent-in-progress",
        done: "agent-done",
      },
    }),
    false,
  );
});

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
    expectedStatePresence: "present",
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

test("maps malformed post-lock planning state to a no-mutation blocker", async () => {
  let mutated = false;
  const result = await runPlanningIssue({
    issue: {
      number: 189,
      title: "Example",
      state: "open",
      labels: ["agent-in-progress"],
    } as never,
    state: { runId: "123e4567-e89b-42d3-a456-426614174000" } as never,
    expectedStatePresence: "present",
    runStateDir: "/tmp/state",
    stateStore: {
      read: async () => {
        throw new PlanningStateValidationError(
          "invalid-json",
          "$",
          "/tmp/state/issue-189.json",
        );
      },
    },
    readIssue: async () =>
      ({
        number: 189,
        title: "Example",
        state: "open",
        labels: ["agent-in-progress"],
      }) as never,
    readLegacy: async () => undefined,
    mutate: async () => {
      mutated = true;
      return [];
    },
    coordinate: async () => {
      throw new Error("unreachable");
    },
    acquire: async () =>
      ({ record: { runId: "123e4567-e89b-42d3-a456-426614174000" } }) as never,
    release: async () => {},
  });
  assert.equal(result.status, "blocked");
  if (result.status === "blocked")
    assert.match(result.result.reason, /issue-189\.json.*invalid-json/);
  assert.equal(mutated, false);
});

test("blocks an active selection whose authoritative state disappears after locking", async () => {
  let initialized = false;
  let mutated = false;
  let coordinated = false;
  const result = await runPlanningIssue({
    issue: {
      number: 189,
      title: "Example",
      state: "open",
      labels: ["agent-in-progress"],
    } as never,
    state: {
      runId: "123e4567-e89b-42d3-a456-426614174000",
      phases: [{ status: "pending" }],
    } as never,
    expectedStatePresence: "present",
    runStateDir: "/tmp/state",
    stateStore: {
      read: async () => undefined,
      initialize: async () => {
        initialized = true;
      },
    },
    readIssue: async () =>
      ({
        number: 189,
        title: "Example",
        state: "open",
        labels: ["agent-in-progress"],
      }) as never,
    readLegacy: async () => undefined,
    mutate: async () => {
      mutated = true;
      return [];
    },
    coordinate: async () => {
      coordinated = true;
      return {} as never;
    },
    acquire: async () =>
      ({ record: { runId: "123e4567-e89b-42d3-a456-426614174000" } }) as never,
    release: async () => {},
  });
  assert.equal(result.status, "blocked");
  assert.equal(initialized, false);
  assert.equal(mutated, false);
  assert.equal(coordinated, false);
});
