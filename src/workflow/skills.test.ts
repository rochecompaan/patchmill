import test from "node:test";
import assert from "node:assert/strict";
import {
  BUNDLED_TRIAGE_SKILL_REFERENCE,
  DEFAULT_PATCHMILL_SKILLS,
  GLOBAL_PATCHMILL_SKILLS,
  cloneSkillsConfig,
  mergeSkillsConfig,
  renderConfiguredSkillLine,
} from "./skills.ts";
import type { PartialPatchmillSkillsConfig } from "./skills.ts";

test("DEFAULT_PATCHMILL_SKILLS uses the bundled fallback triage reference", () => {
  assert.deepEqual(DEFAULT_PATCHMILL_SKILLS, {
    triage: BUNDLED_TRIAGE_SKILL_REFERENCE,
    planning: "superpowers:writing-plans",
    implementation: "superpowers:subagent-driven-development",
  });
});

test("GLOBAL_PATCHMILL_SKILLS keeps the global named triage skill", () => {
  assert.deepEqual(GLOBAL_PATCHMILL_SKILLS, {
    triage: "patchmill-issue-triage",
    planning: "superpowers:writing-plans",
    implementation: "superpowers:subagent-driven-development",
  });
});

test("mergeSkillsConfig replaces only configured stages", () => {
  const merged = mergeSkillsConfig(DEFAULT_PATCHMILL_SKILLS, {
    implementation: "project-implementation",
    visualEvidence: "capturing-proof-screenshots",
  });

  assert.deepEqual(merged, {
    triage: BUNDLED_TRIAGE_SKILL_REFERENCE,
    planning: "superpowers:writing-plans",
    implementation: "project-implementation",
    visualEvidence: "capturing-proof-screenshots",
  });
});

test("mergeSkillsConfig preserves defaults when update contains explicit undefined", () => {
  const merged = mergeSkillsConfig(DEFAULT_PATCHMILL_SKILLS, {
    triage: undefined,
  } as PartialPatchmillSkillsConfig);

  assert.equal(merged.triage, BUNDLED_TRIAGE_SKILL_REFERENCE);
});

test("cloneSkillsConfig returns an independent object", () => {
  const cloned = cloneSkillsConfig(DEFAULT_PATCHMILL_SKILLS);
  cloned.planning = "changed";

  assert.equal(DEFAULT_PATCHMILL_SKILLS.planning, "superpowers:writing-plans");
});

test("renderConfiguredSkillLine renders direct stage-to-skill wording", () => {
  assert.equal(
    renderConfiguredSkillLine(
      "Use the configured planning skill",
      "superpowers:writing-plans",
    ),
    "Use the configured planning skill: `superpowers:writing-plans`.",
  );
});
