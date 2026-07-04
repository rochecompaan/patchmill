import test from "node:test";
import assert from "node:assert/strict";
import {
  BUNDLED_ARTIFACT_EXTRACTION_SKILL_REFERENCE,
  BUNDLED_TRIAGE_SKILL_REFERENCE,
  DEFAULT_PATCHMILL_SKILLS,
  GLOBAL_PATCHMILL_SKILLS,
  PATCHMILL_SKILL_KEYS,
  bundledArtifactExtractionSkillPath,
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
    artifactExtraction: BUNDLED_ARTIFACT_EXTRACTION_SKILL_REFERENCE,
  });
});

test("GLOBAL_PATCHMILL_SKILLS keeps the global named triage skill", () => {
  assert.deepEqual(GLOBAL_PATCHMILL_SKILLS, {
    triage: "patchmill-issue-triage",
    planning: "superpowers:writing-plans",
    implementation: "superpowers:subagent-driven-development",
    artifactExtraction: "patchmill-artifact-extraction",
  });
});

test("default skills include artifact extraction", () => {
  assert.equal(
    DEFAULT_PATCHMILL_SKILLS.artifactExtraction,
    BUNDLED_ARTIFACT_EXTRACTION_SKILL_REFERENCE,
  );
  assert.equal(
    GLOBAL_PATCHMILL_SKILLS.artifactExtraction,
    "patchmill-artifact-extraction",
  );
  assert.equal(PATCHMILL_SKILL_KEYS.includes("artifactExtraction"), true);
});

test("mergeSkillsConfig accepts artifact extraction overrides", () => {
  const merged = mergeSkillsConfig(DEFAULT_PATCHMILL_SKILLS, {
    artifactExtraction: ".patchmill/skills/custom-artifact-extraction",
  });

  assert.equal(
    merged.artifactExtraction,
    ".patchmill/skills/custom-artifact-extraction",
  );
  assert.equal(merged.planning, DEFAULT_PATCHMILL_SKILLS.planning);
});

test("bundled artifact extraction skill resolves to a SKILL.md path", () => {
  const path = bundledArtifactExtractionSkillPath();

  assert.match(path, /skills\/patchmill-artifact-extraction\/SKILL\.md$/);
});

test("resolveConfiguredSkillInvocation resolves bundled artifact extraction", () => {
  const resolved = resolveConfiguredSkillInvocation(
    [BUNDLED_ARTIFACT_EXTRACTION_SKILL_REFERENCE],
    "/repo",
  );

  assert.deepEqual(resolved.paths, [bundledArtifactExtractionSkillPath()]);
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
    artifactExtraction: BUNDLED_ARTIFACT_EXTRACTION_SKILL_REFERENCE,
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
