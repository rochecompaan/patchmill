import assert from "node:assert/strict";
import test from "node:test";
import { PlanningStateStore } from "../../src/workflow/planning-state-store.ts";

function methodDescriptors() {
  return {
    initialize: Object.getOwnPropertyDescriptor(
      PlanningStateStore.prototype,
      "initialize",
    )!,
    replace: Object.getOwnPropertyDescriptor(
      PlanningStateStore.prototype,
      "replace",
    )!,
  };
}

test("state observer installs lazily and restores exact methods", async () => {
  const original = methodDescriptors();
  const { observePlanningStateReplacements } =
    await import("./planning-provider-state-observer.ts");
  assert.deepEqual(
    methodDescriptors(),
    original,
    "import does not patch methods",
  );

  const disposeFirst = observePlanningStateReplacements(
    "/tmp/state-one",
    () => {},
  );
  const installed = methodDescriptors();
  assert.notEqual(installed.initialize.value, original.initialize.value);
  assert.notEqual(installed.replace.value, original.replace.value);

  const disposeSecond = observePlanningStateReplacements(
    "/tmp/state-two",
    () => {},
  );
  disposeFirst();
  assert.deepEqual(
    methodDescriptors(),
    installed,
    "one observer remains installed until the final unregister",
  );
  disposeSecond();
  assert.deepEqual(
    methodDescriptors(),
    original,
    "final unregister restores exact descriptors and method identities",
  );
});
