import assert from "node:assert/strict";
import { join } from "node:path";
import test from "node:test";
import {
  BUNDLED_PATCHMILL_SKILLS,
  bundledSkillByConfigReference,
  bundledSkillByKey,
  bundledSkillByName,
  bundledSkillDir,
  bundledSkillPath,
  bundledSkillPathForReference,
  requiredFilesForBundledSkillName,
} from "./bundled-skills.ts";

test("bundled skill registry preserves public metadata", () => {
  assert.deepEqual(
    BUNDLED_PATCHMILL_SKILLS.map((skill) => skill.key),
    ["triage", "visualEvidence"],
  );
  assert.equal(
    bundledSkillByKey("triage")?.configReference,
    "patchmill:bundled-issue-triage",
  );
  assert.equal(
    bundledSkillByKey("visualEvidence")?.globalName,
    "patchmill-visual-evidence",
  );
  assert.deepEqual(
    requiredFilesForBundledSkillName("patchmill-visual-evidence"),
    ["SKILL.md", "scripts/capture-visual-evidence.cjs"],
  );
});

test("bundled skill registry resolves lookups by reference and name", () => {
  assert.equal(
    bundledSkillByConfigReference("patchmill:bundled-issue-triage")?.key,
    "triage",
  );
  assert.equal(
    bundledSkillByName("patchmill-issue-triage")?.configReference,
    "patchmill:bundled-issue-triage",
  );
  assert.equal(
    bundledSkillByConfigReference("superpowers:writing-plans"),
    undefined,
  );
  assert.deepEqual(requiredFilesForBundledSkillName("unknown"), ["SKILL.md"]);
});

test("bundled skill registry resolves skill directories and SKILL.md paths", () => {
  const triage = bundledSkillByKey("triage");
  const visualEvidence = bundledSkillByKey("visualEvidence");
  assert.ok(triage);
  assert.ok(visualEvidence);

  assert.ok(
    bundledSkillDir(triage).endsWith(join("skills", "patchmill-issue-triage")),
  );
  assert.ok(
    bundledSkillPath(visualEvidence).endsWith(
      join("skills", "patchmill-visual-evidence", "SKILL.md"),
    ),
  );
  assert.equal(
    bundledSkillPathForReference("patchmill:bundled-visual-evidence"),
    bundledSkillPath(visualEvidence),
  );
  assert.equal(bundledSkillPathForReference("patchmill-unknown"), undefined);
});
