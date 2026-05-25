import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  DEFAULT_PATCHMILL_SKILLS,
  cloneSkillsConfig,
  mergeSkillsConfig,
  renderConfiguredSkillLine,
  bundledTriageSkillPath,
} from "./skills.ts";
import type { PartialPatchmillSkillsConfig } from "./skills.ts";

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

test("mergeSkillsConfig preserves defaults when update contains explicit undefined", () => {
  const merged = mergeSkillsConfig(DEFAULT_PATCHMILL_SKILLS, {
    triage: undefined,
  } as PartialPatchmillSkillsConfig);

  assert.equal(merged.triage, "patchmill-issue-triage");
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

test("bundledTriageSkillPath points at the bundled SKILL.md file", () => {
  assert.ok(
    bundledTriageSkillPath().endsWith(
      join("skills", "patchmill-issue-triage", "SKILL.md"),
    ),
  );
});

test("bundled triage skill matches dry-run previews and execute mutations", async () => {
  const skill = await readFile(bundledTriageSkillPath(), "utf8");

  assert.doesNotMatch(skill, /required JSON decision document/);
  assert.doesNotMatch(skill, /Do not mutate repository-hosting state\./);
  assert.match(skill, /dry-run\/preview mode[\s\S]*read-only JSON preview/i);
  assert.match(
    skill,
    /execute mode[\s\S]*apply[\s\S]*labels, comments, closures[\s\S]*(host tools|configured workflow)/i,
  );
});
