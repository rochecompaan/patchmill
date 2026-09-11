import { runPlanningImplementationPhase } from "./planning-phase-runner-implementation.ts";
import { runPlanningSpecPlanPhase } from "./planning-phase-runner-planning.ts";
import type {
  PlanningPhaseRunnerInput,
  PlanningPhaseRunnerOutcome,
} from "./planning-phase-runner-shared.ts";

export type {
  PlanningImplementationAdapter,
  PlanningPhaseRunnerInput,
  PlanningPhaseRunnerOutcome,
} from "./planning-phase-runner-shared.ts";

/** Dispatches one durable phase to its planning or implementation flow. */
export async function runPlanningPhase(
  input: PlanningPhaseRunnerInput,
): Promise<PlanningPhaseRunnerOutcome> {
  const phase = input.state.phases[input.phaseIndex];
  if (phase === undefined || phase.kind !== input.phase.kind)
    throw new RangeError("Planning phase does not match durable state");
  return input.phase.kind === "implementation"
    ? runPlanningImplementationPhase(input)
    : runPlanningSpecPlanPhase(input);
}
