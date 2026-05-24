import test from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_PATCHMILL_SKILLS,
  cloneSkillsConfig,
  mergeSkillsConfig,
  renderConfiguredSkillLine,
  bundledTriageSkillPath,
} from "./skills.ts";

test("DEFAULT_PATCHMILL_SKILLS keeps current default workflow skills", () => {
  assert.deepEqual(DEFAULT_PATCHMILL_SKILLS, {
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
    triage: "patchmill-issue-triage",
    planning: "superpowers:writing-plans",
    implementation: "project-implementation",
    visualEvidence: "capturing-proof-screenshots",
  });
});

test("cloneSkillsConfig returns an independent object", () => {
  const cloned = cloneSkillsConfig(DEFAULT_PATCHMILL_SKILLS);
  cloned.planning = "changed";

  assert.equal(DEFAULT_PATCHMILL_SKILLS.planning, "superpowers:writing-plans");
});

test("renderConfiguredSkillLine renders direct stage-to-skill wording", () => {
  assert.equal(
    renderConfiguredSkillLine("Use the configured planning skill", "superpowers:writing-plans"),
    "Use the configured planning skill: `superpowers:writing-plans`.",
  );
});

test("bundledTriageSkillPath points at the bundled SKILL.md file", () => {
  assert.match(bundledTriageSkillPath(), /skills\/patchmill-issue-triage\/SKILL\.md$/);
});
