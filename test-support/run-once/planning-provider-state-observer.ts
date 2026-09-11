import { resolve } from "node:path";
import {
  PlanningStateStore,
  type PlanningStateV1,
} from "../../src/workflow/planning-state-store.ts";

type StateReplacementObserver = (state: PlanningStateV1) => void;

const observers = new Map<string, Set<StateReplacementObserver>>();
const initialize = PlanningStateStore.prototype.initialize;
const replace = PlanningStateStore.prototype.replace;

function notify(runStateDir: string, state: PlanningStateV1) {
  for (const observer of observers.get(resolve(runStateDir)) ?? [])
    observer(state);
}

PlanningStateStore.prototype.initialize = async function (input) {
  const state = await initialize.call(this, input);
  notify(this.runStateDir, state);
  return state;
};

PlanningStateStore.prototype.replace = async function (input) {
  const state = await replace.call(this, input);
  notify(this.runStateDir, state);
  return state;
};

/** Observes each state only after PlanningStateStore atomically persists it. */
export function observePlanningStateReplacements(
  runStateDir: string,
  observer: StateReplacementObserver,
) {
  const directory = resolve(runStateDir);
  const registered = observers.get(directory) ?? new Set();
  registered.add(observer);
  observers.set(directory, registered);
  return () => {
    registered.delete(observer);
    if (registered.size === 0) observers.delete(directory);
  };
}
