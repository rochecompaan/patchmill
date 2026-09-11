import type { PlanningIssueLock } from "./planning-issue-lock.ts";
import type { PlanningStateStore } from "./planning-state-store.ts";
import type {
  PlanningPhaseStateV1,
  PlanningStateV1,
} from "./planning-state-types.ts";

/** Replaces exactly one phase using the single durable planning revision edge. */
export async function replacePlanningPhase(input: {
  stateStore: Pick<PlanningStateStore, "replace">;
  lock: PlanningIssueLock;
  state: PlanningStateV1;
  phaseIndex: number;
  phase: PlanningPhaseStateV1;
  now?: () => Date;
}): Promise<PlanningStateV1> {
  const { state } = input;
  return input.stateStore.replace({
    issueNumber: state.issueNumber,
    expectedRunId: state.runId,
    expectedRevision: state.revision,
    lock: input.lock,
    next: {
      ...state,
      revision: state.revision + 1,
      updatedAt: (input.now ?? (() => new Date()))().toISOString(),
      phases: state.phases.map((item, index) =>
        index === input.phaseIndex ? input.phase : item,
      ),
    },
  });
}
