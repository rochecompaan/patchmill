import { resolve } from "node:path";
import {
  PlanningStateStore,
  type PlanningStateV1,
} from "../../src/workflow/planning-state-store.ts";

type StateReplacementObserver = (state: PlanningStateV1) => void;
type StoreMethodDescriptors = Readonly<{
  initialize: PropertyDescriptor;
  replace: PropertyDescriptor;
}>;

const observers = new Map<string, Set<StateReplacementObserver>>();
let originals: StoreMethodDescriptors | undefined;

function notify(runStateDir: string, state: PlanningStateV1) {
  for (const observer of observers.get(resolve(runStateDir)) ?? [])
    observer(state);
}

function methodDescriptors(): StoreMethodDescriptors {
  const initialize = Object.getOwnPropertyDescriptor(
    PlanningStateStore.prototype,
    "initialize",
  );
  const replace = Object.getOwnPropertyDescriptor(
    PlanningStateStore.prototype,
    "replace",
  );
  if (
    initialize === undefined ||
    replace === undefined ||
    typeof initialize.value !== "function" ||
    typeof replace.value !== "function"
  )
    throw new Error("PlanningStateStore methods must be writable functions");
  return { initialize, replace };
}

function restoreMethods(descriptors: StoreMethodDescriptors) {
  Object.defineProperty(
    PlanningStateStore.prototype,
    "initialize",
    descriptors.initialize,
  );
  Object.defineProperty(
    PlanningStateStore.prototype,
    "replace",
    descriptors.replace,
  );
}

function installObservers() {
  if (originals !== undefined) return;
  const descriptors = methodDescriptors();
  const initialize = descriptors.initialize
    .value as PlanningStateStore["initialize"];
  const replace = descriptors.replace.value as PlanningStateStore["replace"];
  try {
    Object.defineProperty(PlanningStateStore.prototype, "initialize", {
      ...descriptors.initialize,
      value: async function (
        this: PlanningStateStore,
        input: Parameters<PlanningStateStore["initialize"]>[0],
      ) {
        const state = await initialize.call(this, input);
        notify(this.runStateDir, state);
        return state;
      },
    });
    Object.defineProperty(PlanningStateStore.prototype, "replace", {
      ...descriptors.replace,
      value: async function (
        this: PlanningStateStore,
        input: Parameters<PlanningStateStore["replace"]>[0],
      ) {
        const state = await replace.call(this, input);
        notify(this.runStateDir, state);
        return state;
      },
    });
    originals = descriptors;
  } catch (error) {
    restoreMethods(descriptors);
    throw error;
  }
}

function uninstallObservers() {
  if (originals === undefined) return;
  const descriptors = originals;
  restoreMethods(descriptors);
  originals = undefined;
}

/** Observes each state only after PlanningStateStore atomically persists it. */
export function observePlanningStateReplacements(
  runStateDir: string,
  observer: StateReplacementObserver,
) {
  installObservers();
  const directory = resolve(runStateDir);
  const registered = observers.get(directory) ?? new Set();
  registered.add(observer);
  observers.set(directory, registered);
  let disposed = false;
  return () => {
    if (disposed) return;
    disposed = true;
    registered.delete(observer);
    if (registered.size > 0) return;
    observers.delete(directory);
    if (observers.size === 0) uninstallObservers();
  };
}
