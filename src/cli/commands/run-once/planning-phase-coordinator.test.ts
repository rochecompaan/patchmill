import assert from "node:assert/strict";
import test from "node:test";
import { coordinatePlanningPhases } from "./planning-phase-coordinator.ts";

const state = (gates: { specRequired: boolean; planRequired: boolean }) =>
  ({
    issueNumber: 189,
    gates,
    phases: (gates.specRequired && gates.planRequired
      ? ["spec", "plan", "implementation"]
      : gates.specRequired
        ? ["spec", "implementation"]
        : gates.planRequired
          ? ["plan", "implementation"]
          : ["implementation"]
    ).map((kind) => ({ kind, status: "pending" })),
  }) as never;

test("coordinates every gate plan in order and stops at an open planning review", async () => {
  for (const gates of [
    { specRequired: false, planRequired: false },
    { specRequired: true, planRequired: false },
    { specRequired: false, planRequired: true },
    { specRequired: true, planRequired: true },
  ]) {
    const seen: string[] = [];
    const result = await coordinatePlanningPhases({
      state: state(gates),
      issue: { number: 189 } as never,
      runPlanningPhase: async ({ phase }) => {
        seen.push(phase.kind);
        return phase.kind === "implementation"
          ? {
              kind: "complete",
              state: state(gates),
              result: { status: "pr-created" } as never,
            }
          : {
              kind: "review-pending",
              state: state(gates),
              prUrl: "https://example.test/pr/1",
            };
      },
    });
    const expectedFirst = gates.specRequired
      ? "spec"
      : gates.planRequired
        ? "plan"
        : "implementation";
    assert.equal(seen[0], expectedFirst);
    assert.equal(
      result.kind,
      expectedFirst === "implementation" ? "complete" : "review-pending",
    );
  }
});

test("advances to implementation after a completed planning checkpoint", async () => {
  const gates = { specRequired: true, planRequired: false };
  const advanced = {
    issueNumber: 189,
    gates,
    phases: [
      { kind: "spec", status: "complete" },
      { kind: "implementation", status: "pending" },
    ],
  } as never;
  const seen: string[] = [];
  const result = await coordinatePlanningPhases({
    state: state(gates),
    issue: { number: 189 } as never,
    runPlanningPhase: async ({ state: current, phase }) => {
      seen.push(phase.kind);
      if (phase.kind === "spec") return { kind: "advanced", state: advanced };
      assert.equal(current, advanced);
      return {
        kind: "complete",
        state: current,
        result: { status: "pr-created" } as never,
      };
    },
  });
  assert.equal(result.kind, "complete");
  assert.deepEqual(seen, ["spec", "implementation"]);
});

test("delegates plan-only implementation artifacts to the phase runner", async () => {
  let calls = 0;
  const result = await coordinatePlanningPhases({
    state: state({ specRequired: false, planRequired: false }),
    issue: { number: 189 } as never,
    planOnly: true,
    runPlanningPhase: async ({ planOnly }) => {
      calls += 1;
      assert.equal(planOnly, true);
      return {
        kind: "stopped",
        state: state({ specRequired: false, planRequired: false }),
        reason: "plan-only",
      };
    },
  });
  assert.equal(result.kind, "stopped");
  assert.equal(calls, 1);
});
