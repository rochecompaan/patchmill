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
  const published = {
    kind: "implementation-published" as const,
    state: returnedState,
    result: { status: "pr-created" } as never,
  };
  const blocked = {
    kind: "blocked" as const,
    state: returnedState,
    result: { status: "blocked" } as never,
  };
  const complete = {
    kind: "complete" as const,
    state: returnedState,
    result: { status: "merged" } as never,
  };

  for (const terminal of [published, blocked, complete]) {
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
        kind: "implementation-published",
        state: current,
        result: { status: "pr-created" } as never,
      };
    },
  });
  assert.equal(result.kind, "implementation-published");
  assert.deepEqual(seen, ["spec", "implementation"]);
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

const completePhase = (
  current: PlanningStateV1,
  phaseIndex: number,
): PlanningStateV1 =>
  ({
    ...current,
    phases: current.phases.map((phase, index) =>
      index === phaseIndex ? { ...phase, status: "complete" } : phase,
    ),
    revision: current.revision + 1,
  }) as PlanningStateV1;

test("rejects advancement without selected-phase completion", async () => {
  const specGate = { specRequired: true, planRequired: true };
  const initial = state(specGate);
  const resumed = state(specGate, [
    { kind: "spec", status: "complete" },
    { kind: "plan", status: "pending" },
    { kind: "implementation", status: "pending" },
  ]);
  const cases: readonly {
    name: string;
    initial: PlanningStateV1;
    returned: PlanningStateV1;
  }[] = [
    { name: "unchanged state", initial, returned: initial },
    {
      name: "revised state",
      initial,
      returned: state(specGate, undefined, 2),
    },
    ...(["workspace-ready", "branch-pushed", "pull-request-open"] as const).map(
      (status) => ({
        name: `${status} checkpoint`,
        initial,
        returned: state(specGate, [
          { kind: "spec", status },
          { kind: "plan", status: "pending" },
          { kind: "implementation", status: "pending" },
        ]),
      }),
    ),
    {
      name: "missing selected entry",
      initial: resumed,
      returned: state(specGate, [{ kind: "spec", status: "complete" }]),
    },
    {
      name: "different phase completes",
      initial,
      returned: state(specGate, [
        { kind: "spec", status: "pending" },
        { kind: "plan", status: "complete" },
        { kind: "implementation", status: "pending" },
      ]),
    },
    {
      name: "earlier phase remains complete",
      initial: resumed,
      returned: state(specGate, [
        { kind: "spec", status: "complete" },
        { kind: "plan", status: "pending" },
        { kind: "implementation", status: "pending" },
      ]),
    },
  ];

  for (const { name, initial, returned } of cases) {
    let calls = 0;
    const run = () =>
      coordinatePlanningPhases({
        state: initial,
        issue,
        runPlanningPhase: async () => {
          calls += 1;
          if (calls === 2) throw new Error("Unexpected second runner call");
          return { kind: "advanced", state: returned };
        },
      });
    await assert.rejects(
      run,
      {
        name: "Error",
        message: "Phase reported advancement without completion",
      },
      name,
    );
    assert.equal(calls, 1, name);
  }
});

test("passes advanced state to the next phase in gate order", async () => {
  const expectedSequences: readonly (readonly PhaseKind[])[] = [
    ["implementation"],
    ["spec", "implementation"],
    ["plan", "implementation"],
    ["spec", "plan", "implementation"],
  ];

  for (const [index, gates] of allGates.entries()) {
    const expected = expectedSequences[index];
    let current = state(gates);
    let calls = 0;
    const actual = await coordinatePlanningPhases({
      state: current,
      issue,
      runPlanningPhase: async ({ state: received, phaseIndex, phase }) => {
        assert.strictEqual(received, current);
        assert.equal(phaseIndex, calls);
        assert.equal(phase.kind, expected[calls]);
        calls += 1;
        if (phase.kind === "implementation") {
          return {
            kind: "complete",
            state: received,
            result: { status: "pr-created" } as never,
          };
        }
        current = completePhase(received, phaseIndex);
        return { kind: "advanced", state: current };
      },
    });
    assert.equal(actual.kind, "complete");
    assert.equal(calls, expected.length);
  }

  const resumed = state({ specRequired: true, planRequired: true }, [
    { kind: "spec", status: "complete" },
    { kind: "plan", status: "pending" },
    { kind: "implementation", status: "pending" },
  ]);
  let current = resumed;
  let calls = 0;
  const actual = await coordinatePlanningPhases({
    state: current,
    issue,
    runPlanningPhase: async ({ state: received, phaseIndex, phase }) => {
      assert.strictEqual(received, current);
      assert.equal(phaseIndex, [1, 2][calls]);
      assert.equal(phase.kind, ["plan", "implementation"][calls]);
      calls += 1;
      if (phase.kind === "implementation") {
        return {
          kind: "complete",
          state: received,
          result: { status: "pr-created" } as never,
        };
      }
      current = completePhase(received, phaseIndex);
      return { kind: "advanced", state: current };
    },
  });
  assert.equal(actual.kind, "complete");
  assert.equal(calls, 2);
});
