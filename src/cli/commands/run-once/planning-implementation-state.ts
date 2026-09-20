import type { PlanningIssueLock } from "../../../workflow/planning-issue-lock.ts";
import { replacePlanningPhase } from "../../../workflow/planning-phase-replacement.ts";
import type { PlanningStateStore } from "../../../workflow/planning-state-store.ts";
import type { PlanningStateV1 } from "../../../workflow/planning-state-types.ts";

/** Creates the state replacement adapter bound to one owned implementation phase. */
export function implementationPhaseReplacer(input: {
  stateStore: Pick<PlanningStateStore, "replace">;
  lock: PlanningIssueLock;
  phaseIndex: number;
  now?: () => Date;
}) {
  return async (
    state: PlanningStateV1,
    phase: PlanningStateV1["phases"][number],
  ): Promise<PlanningStateV1> =>
    replacePlanningPhase({
      stateStore: input.stateStore,
      lock: input.lock,
      state,
      phaseIndex: input.phaseIndex,
      phase,
      ...(input.now === undefined ? {} : { now: input.now }),
    });
}
