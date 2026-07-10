import test from "node:test";
import assert from "node:assert/strict";
import {
  BUNDLED_TRIAGE_SKILL_REFERENCE,
  BUNDLED_VISUAL_EVIDENCE_SKILL_REFERENCE,
  DEPRECATED_PATCHMILL_SKILL_KEYS,
  DEFAULT_PATCHMILL_SKILLS,
  GLOBAL_PATCHMILL_SKILLS,
  PATCHMILL_SKILL_KEYS,
  bundledVisualEvidenceSkillPath,
  cloneSkillsConfig,
  mergeSkillsConfig,
  renderConfiguredSkillLine,
  resolveConfiguredSkillInvocation,
} from "./skills.ts";
import type { PartialPatchmillSkillsConfig } from "./skills.ts";

test("DEFAULT_PATCHMILL_SKILLS uses the bundled fallback triage reference", () => {
  assert.deepEqual(DEFAULT_PATCHMILL_SKILLS, {
    triage: BUNDLED_TRIAGE_SKILL_REFERENCE,
    planning: "superpowers:writing-plans",
    implementation: "superpowers:subagent-driven-development",
    visualEvidence: BUNDLED_VISUAL_EVIDENCE_SKILL_REFERENCE,
  });
});

test("GLOBAL_PATCHMILL_SKILLS keeps the global named triage skill", () => {
  assert.deepEqual(GLOBAL_PATCHMILL_SKILLS, {
    triage: "patchmill-issue-triage",
    planning: "superpowers:writing-plans",
    implementation: "superpowers:subagent-driven-development",
    visualEvidence: "patchmill-visual-evidence",
  });
});

test("default skill keys cover the configurable workflow stages", () => {
  assert.deepEqual(PATCHMILL_SKILL_KEYS, [
    "triage",
    "planning",
    "implementation",
    "developmentEnvironment",
    "toolchain",
    "review",
    "visualEvidence",
    "landing",
  ]);
});

test("deprecated skill keys are excluded from active configurable workflow stages", () => {
  assert.deepEqual(DEPRECATED_PATCHMILL_SKILL_KEYS, ["artifactExtraction"]);
  const activeSkillKeys: readonly string[] = PATCHMILL_SKILL_KEYS;
  assert.equal(activeSkillKeys.includes("artifactExtraction"), false);
});

test("bundled visual evidence skill resolves to a SKILL.md path", () => {
  const path = bundledVisualEvidenceSkillPath();

  assert.match(path, /skills\/patchmill-visual-evidence\/SKILL\.md$/);
});

test("resolveConfiguredSkillInvocation resolves bundled visual evidence", () => {
  const resolved = resolveConfiguredSkillInvocation(
    [BUNDLED_VISUAL_EVIDENCE_SKILL_REFERENCE],
    "/repo",
  );

  assert.deepEqual(resolved.paths, [bundledVisualEvidenceSkillPath()]);
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

test("mergeSkillsConfig preserves optional development environment skill", () => {
  const merged = mergeSkillsConfig(DEFAULT_PATCHMILL_SKILLS, {
    developmentEnvironment: ".patchmill/skills/development-environment",
  });

  assert.equal(
    merged.developmentEnvironment,
    ".patchmill/skills/development-environment",
  );
  assert.equal(DEFAULT_PATCHMILL_SKILLS.developmentEnvironment, undefined);
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
