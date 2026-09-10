import assert from "node:assert/strict";
import test from "node:test";
import { planningPhasePlan } from "../../../workflow/planning-pull-requests.ts";
import { coordinatePlanningPhases } from "./planning-phase-coordinator.ts";
import { runPlanningIssue } from "./planning-pipeline.ts";
import { PlanningIssueLockConflictError } from "../../../workflow/planning-issue-lock.ts";

const issue = { number: 189, title: "Safety", state: "open" } as never;
function state(gates: { specRequired: boolean; planRequired: boolean }) {
  return {
    issueNumber: 189,
    gates,
    phases: planningPhasePlan(gates).map((phase) => ({
      kind: phase.kind,
      status: "pending",
    })),
  } as never;
}

test("all gate assignments preserve review stops across merged-phase attempts", async () => {
  const cases = [
    {
      gates: { specRequired: false, planRequired: false },
      sequence: ["implementation"],
    },
    {
      gates: { specRequired: true, planRequired: false },
      sequence: ["spec:review", "spec:merged", "implementation"],
    },
    {
      gates: { specRequired: false, planRequired: true },
      sequence: ["plan:review", "plan:merged", "implementation"],
    },
    {
      gates: { specRequired: true, planRequired: true },
      sequence: [
        "spec:review",
        "spec:merged",
        "plan:review",
        "plan:merged",
        "implementation",
      ],
    },
  ];
  for (const { gates, sequence } of cases) {
    const calls: string[] = [];
    const reviewed = new Set<number>();
    let current = state(gates);
    for (;;) {
      const outcome = await coordinatePlanningPhases({
        state: current,
        issue,
        runPlanningPhase: async ({
          phase,
          phaseIndex,
          state: currentState,
        }) => {
          if (phase.kind === "implementation") {
            calls.push("implementation");
            return {
              kind: "complete",
              state: currentState,
              result: { status: "pr-created" } as never,
            };
          }
          if (!reviewed.has(phaseIndex)) {
            reviewed.add(phaseIndex);
            calls.push(`${phase.kind}:review`);
            return {
              kind: "review-pending",
              state: currentState,
              prUrl: `https://example.test/${phase.kind}`,
            };
          }
          calls.push(`${phase.kind}:merged`);
          return {
            kind: "advanced",
            state: {
              ...currentState,
              phases: currentState.phases.map((saved, index) =>
                index === phaseIndex ? { ...saved, status: "complete" } : saved,
              ),
            },
          } as never;
        },
      });
      current = outcome.state;
      if (outcome.kind === "complete") break;
      assert.equal(outcome.kind, "review-pending");
    }
    assert.deepEqual(calls, sequence);
  }
});

test("open planning reviews never execute later phase work", async () => {
  const gates = { specRequired: true, planRequired: true };
  const calls: string[] = [];
  const outcome = await coordinatePlanningPhases({
    state: state(gates),
    issue,
    runPlanningPhase: async ({ phase }) => {
      calls.push(phase.kind);
      return {
        kind: "review-pending",
        state: state(gates),
        prUrl: "https://example.test/pr/1",
      };
    },
  });
  assert.equal(outcome.kind, "review-pending");
  assert.deepEqual(calls, ["spec"]);
});

test("fresh production pipeline initializes before claim, comment, and coordinate", async () => {
  const calls: string[] = [];
  const fresh = state({ specRequired: false, planRequired: false });
  const result = await runPlanningIssue({
    issue: {
      number: 189,
      title: "Safety",
      state: "open",
      labels: ["agent-ready"],
    } as never,
    config: { readyLabel: "agent-ready" } as never,
    state: fresh,
    expectedStatePresence: "absent",
    runStateDir: "/tmp/planning-scenarios",
    stateStore: {
      read: async () => undefined,
      initialize: async () => {
        calls.push("initialize");
      },
    },
    readIssue: async () => {
      calls.push("read-issue");
      return {
        number: 189,
        title: "Safety",
        state: "open",
        labels: ["agent-ready"],
      } as never;
    },
    readLegacy: async () => {
      calls.push("read-legacy");
      return undefined;
    },
    mutate: async () => {
      calls.push("claim-comment");
      return ["agent-in-progress"];
    },
    coordinate: async () => {
      calls.push("coordinate");
      return { kind: "stopped", state: fresh, reason: "plan-only" } as never;
    },
    acquire: async () => ({ record: { runId: fresh.runId } }) as never,
    release: async () => {
      calls.push("release");
    },
  });
  assert.equal(result.status, "coordinated");
  assert.deepEqual(calls, [
    "read-issue",
    "read-legacy",
    "initialize",
    "claim-comment",
    "coordinate",
    "release",
  ]);
});

test("existing planning run-id changes fail closed without mutation", async () => {
  const initial = state({ specRequired: false, planRequired: false });
  const replacement = {
    ...initial,
    runId: "223e4567-e89b-42d3-a456-426614174000",
  } as never;
  const calls: string[] = [];
  let reads = 0;
  const result = await runPlanningIssue({
    issue: {
      number: 189,
      title: "Safety",
      state: "open",
      labels: ["agent-in-progress"],
    } as never,
    config: {} as never,
    state: initial,
    expectedStatePresence: "present",
    runStateDir: "/tmp/planning-scenarios",
    stateStore: {
      read: async () => (++reads === 1 ? replacement : replacement),
      initialize: async () => {
        throw new Error("must not initialize active state");
      },
    },
    readIssue: async () =>
      ({
        number: 189,
        title: "Safety",
        state: "open",
        labels: ["agent-in-progress"],
      }) as never,
    readLegacy: async () => undefined,
    mutate: async () => {
      calls.push("mutate");
      return [];
    },
    coordinate: async () => {
      calls.push("coordinate");
      return { kind: "stopped", state: replacement, reason: "done" } as never;
    },
    acquire: async (_dir, identity) => {
      calls.push(`acquire:${identity.runId}`);
      return { record: { runId: identity.runId } } as never;
    },
    release: async () => {
      calls.push("release");
    },
  });
  assert.equal(result.status, "blocked");
  assert.deepEqual(calls, [`acquire:${initial.runId}`, "release"]);
});

test("fresh initialization races retry with the authoritative run ID", async () => {
  const initial = state({ specRequired: false, planRequired: false });
  const replacement = {
    ...initial,
    runId: "223e4567-e89b-42d3-a456-426614174000",
  } as never;
  const calls: string[] = [];
  const result = await runPlanningIssue({
    issue: {
      number: 189,
      title: "Safety",
      state: "open",
      labels: ["agent-ready"],
    } as never,
    config: { readyLabel: "agent-ready" } as never,
    state: initial,
    expectedStatePresence: "absent",
    runStateDir: "/tmp/planning-scenarios",
    stateStore: {
      read: async () => replacement,
      initialize: async () => {
        throw new Error("racing state must not be initialized twice");
      },
    },
    readIssue: async () =>
      ({
        number: 189,
        title: "Safety",
        state: "open",
        labels: ["agent-ready"],
      }) as never,
    readLegacy: async () => undefined,
    mutate: async () => {
      calls.push("mutate");
      return [];
    },
    coordinate: async () => {
      calls.push("coordinate");
      return {
        kind: "stopped",
        state: replacement,
        reason: "plan-only",
      } as never;
    },
    acquire: async (_dir, identity) => {
      calls.push(`acquire:${identity.runId}`);
      return { record: { runId: identity.runId } } as never;
    },
    release: async () => {
      calls.push("release");
    },
  });
  assert.equal(result.status, "coordinated");
  assert.deepEqual(calls, [
    `acquire:${initial.runId}`,
    "release",
    `acquire:${replacement.runId}`,
    "mutate",
    "coordinate",
    "release",
  ]);
});

test("post-lock state for another issue blocks before mutation", async () => {
  let mutated = false;
  const initial = state({ specRequired: false, planRequired: false });
  const result = await runPlanningIssue({
    issue: {
      number: 189,
      title: "Safety",
      state: "open",
      labels: ["agent-ready"],
    } as never,
    config: { readyLabel: "agent-ready" } as never,
    state: initial,
    expectedStatePresence: "present",
    runStateDir: "/tmp/planning-scenarios",
    stateStore: {
      read: async () => ({ ...initial, issueNumber: 190 }),
      initialize: async () => {
        throw new Error("unreachable");
      },
    },
    readIssue: async () =>
      ({
        number: 189,
        title: "Safety",
        state: "open",
        labels: ["agent-ready"],
      }) as never,
    readLegacy: async () => undefined,
    mutate: async () => {
      mutated = true;
      return [];
    },
    coordinate: async () => {
      throw new Error("unreachable");
    },
    acquire: async () => ({ record: { runId: initial.runId } }) as never,
    release: async () => {},
  });
  assert.equal(result.status, "blocked");
  assert.equal(mutated, false);
});

test("active, stale, and malformed locks have distinct no-mutation outcomes", async () => {
  for (const classification of ["active", "stale", "unverifiable"] as const) {
    let mutated = false;
    const result = await runPlanningIssue({
      issue: {
        number: 189,
        title: "Safety",
        state: "open",
        labels: [],
      } as never,
      config: {} as never,
      state: state({ specRequired: false, planRequired: false }),
      expectedStatePresence: "absent",
      runStateDir: "/tmp/planning-scenarios",
      stateStore: {} as never,
      readIssue: async () => {
        throw new Error("unreachable");
      },
      readLegacy: async () => undefined,
      mutate: async () => {
        mutated = true;
        return [];
      },
      coordinate: async () => {
        throw new Error("unreachable");
      },
      acquire: async () => {
        throw new PlanningIssueLockConflictError({
          classification,
          path: "lock",
          fingerprint: "",
        });
      },
    });
    assert.equal(mutated, false);
    assert.equal(
      result.status,
      classification === "active" ? "stopped" : "blocked",
    );
  }
});

test("plan-only delegates implementation-carried artifact decisions to the runner", async () => {
  let receivedPlanOnly = false;
  const gates = { specRequired: false, planRequired: false };
  const outcome = await coordinatePlanningPhases({
    state: state(gates),
    issue,
    planOnly: true,
    runPlanningPhase: async ({ planOnly }) => {
      receivedPlanOnly = planOnly === true;
      return { kind: "stopped", state: state(gates), reason: "plan-only" };
    },
  });
  assert.equal(outcome.kind, "stopped");
  assert.equal(receivedPlanOnly, true);
});
