import assert from "node:assert/strict";
import test from "node:test";
import type { PlanningStateV1 } from "../../../workflow/planning-state-types.ts";
import type { PlanningPhaseRunnerOutcome } from "./planning-phase-runner.ts";
import { coordinatePlanningPhases } from "./planning-phase-coordinator.ts";

type Gates = { specRequired: boolean; planRequired: boolean };
type PhaseKind = "spec" | "plan" | "implementation";

const state = (
  gates: Gates,
  phases: readonly {
    kind: PhaseKind;
    status: string;
  }[] = (gates.specRequired && gates.planRequired
    ? ["spec", "plan", "implementation"]
    : gates.specRequired
      ? ["spec", "implementation"]
      : gates.planRequired
        ? ["plan", "implementation"]
        : ["implementation"]
  ).map((kind) => ({ kind, status: "pending" })),
  revision = 1,
): PlanningStateV1 =>
  ({
    issueNumber: 189,
    gates,
    phases,
    revision,
  }) as unknown as PlanningStateV1;

const issue = { number: 189 } as never;
const allGates: readonly Gates[] = [
  { specRequired: false, planRequired: false },
  { specRequired: true, planRequired: false },
  { specRequired: false, planRequired: true },
  { specRequired: true, planRequired: true },
];

test("rejects an unknown runner outcome after one call", async () => {
  const initial = state({ specRequired: true, planRequired: true });
  let calls = 0;
  const run = () =>
    coordinatePlanningPhases({
      state: initial,
      issue,
      runPlanningPhase: async () => {
        calls += 1;
        if (calls === 2) throw new Error("Unexpected second runner call");
        return {
          kind: "unexpected",
          state: initial,
        } as unknown as PlanningPhaseRunnerOutcome;
      },
    });

  await assert.rejects(run, {
    name: "Error",
    message: "Unexpected phase-runner outcome",
  });
  assert.equal(calls, 1);
});

test("preserves supported terminal outcomes after one call", async () => {
  const gates = { specRequired: true, planRequired: true };
  const initial = state(gates);
  const returnedState = state(gates, undefined, 2);
  const cleanupPending = {
    kind: "cleanup-pending" as const,
    state: returnedState,
    phase: "spec" as const,
    prUrl: "https://example.test/pr/cleanup",
    reason: "ignored-worktree-content" as const,
    ignoredPaths: [".env"],
  };
  const blocked = {
    kind: "blocked" as const,
    state: returnedState,
    result: { status: "blocked" } as never,
  };
  const complete = {
    kind: "complete" as const,
    state: returnedState,
    result: { status: "pr-created" } as never,
  };

  for (const terminal of [cleanupPending, blocked, complete]) {
    let calls = 0;
    const actual = await coordinatePlanningPhases({
      state: initial,
      issue,
      runPlanningPhase: async () => {
        calls += 1;
        if (calls === 2) throw new Error("Unexpected second runner call");
        return terminal;
      },
    });
    assert.strictEqual(actual, terminal);
    assert.equal(calls, 1);
  }

  for (const gates of allGates) {
    const initial = state(gates);
    const returnedState = state(gates, undefined, 2);
    const selectedPhase = gates.specRequired
      ? "spec"
      : gates.planRequired
        ? "plan"
        : "implementation";
    if (selectedPhase === "implementation") continue;
    let calls = 0;
    const actual = await coordinatePlanningPhases({
      state: initial,
      issue,
      runPlanningPhase: async () => {
        calls += 1;
        if (calls === 2) throw new Error("Unexpected second runner call");
        return {
          kind: "review-pending",
          state: returnedState,
          prUrl: "https://example.test/pr/review",
        };
      },
    });
    assert.deepEqual(actual, {
      kind: "review-pending",
      state: returnedState,
      phase: selectedPhase,
      prUrl: "https://example.test/pr/review",
    });
    assert.strictEqual(actual.state, returnedState);
    assert.equal(calls, 1);
  }

  for (const gates of allGates) {
    const initial = state(gates);
    const returnedState = state(gates, undefined, 2);
    let calls = 0;
    const actual = await coordinatePlanningPhases({
      state: initial,
      issue,
      planOnly: true,
      runPlanningPhase: async ({ planOnly }) => {
        calls += 1;
        if (calls === 2) throw new Error("Unexpected second runner call");
        assert.equal(planOnly, true);
        return {
          kind: "stopped",
          state: returnedState,
          reason: "plan-only",
        };
      },
    });
    assert.deepEqual(actual, {
      kind: "stopped",
      state: returnedState,
      reason: "plan-only",
      nextPhase: "implementation",
    });
    assert.strictEqual(actual.state, returnedState);
    assert.equal(calls, 1);
  }
});

test("rejects implementation review pending after one call", async () => {
  const initial = state({ specRequired: false, planRequired: false });
  let calls = 0;
  const run = () =>
    coordinatePlanningPhases({
      state: initial,
      issue,
      runPlanningPhase: async () => {
        calls += 1;
        if (calls === 2) throw new Error("Unexpected second runner call");
        return {
          kind: "review-pending",
          state: initial,
          prUrl: "https://example.test/pr/implementation",
        };
      },
    });

  await assert.rejects(run, {
    name: "Error",
    message: "Implementation pull request cannot be review-pending",
  });
  assert.equal(calls, 1);
});
