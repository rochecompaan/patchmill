import assert from "node:assert/strict";
import test from "node:test";
import { planningPhasePlan } from "../../../workflow/planning-pull-requests.ts";
import { coordinatePlanningPhases } from "./planning-phase-coordinator.ts";

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

test("all gate assignments run only the first unreviewed planning phase", async () => {
  for (const gates of [
    { specRequired: false, planRequired: false },
    { specRequired: true, planRequired: false },
    { specRequired: false, planRequired: true },
    { specRequired: true, planRequired: true },
  ]) {
    const calls: string[] = [];
    const outcome = await coordinatePlanningPhases({
      state: state(gates),
      issue,
      runPlanningPhase: async ({ phase }) => {
        calls.push(phase.kind);
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
    assert.equal(calls.length, 1);
    assert.equal(
      outcome.kind,
      gates.specRequired || gates.planRequired ? "review-pending" : "complete",
    );
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
