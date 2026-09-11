import assert from "node:assert/strict";
import test from "node:test";
import {
  legacyPlanningDeprecation,
  type LegacyPlanningControl,
} from "./legacy-planning-deprecations.ts";

const controls: LegacyPlanningControl[] = [
  "set-spec",
  "set-plan",
  "--plan-only",
];

test("legacy planning deprecations are stable public copy without runtime content", () => {
  for (const control of controls) {
    const deprecation = legacyPlanningDeprecation(control);
    assert.match(deprecation.warning, /^Deprecated: /u);
    assert.ok(deprecation.warning.includes(control));
    assert.doesNotMatch(deprecation.warning, /\n/u);
    assert.ok(Object.isFrozen(deprecation));
  }
  assert.match(
    legacyPlanningDeprecation("set-spec").warning,
    /unfinished legacy Issue runs/u,
  );
  assert.match(
    legacyPlanningDeprecation("set-plan").warning,
    /configured plan directory/u,
  );
});

test("legacy planning deprecation returns copy-safe entries", () => {
  assert.equal(
    legacyPlanningDeprecation("set-spec"),
    legacyPlanningDeprecation("set-spec"),
  );
});
