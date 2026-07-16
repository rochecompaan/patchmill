import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  DEFAULT_PROJECT_SKILL_DIR,
  PATCHMILL_RECOMMENDED_SKILL_PACK,
  SKILL_PACK_METADATA_FILE,
  buildRecommendedProjectSkillConfig,
  buildSkillPackMetadata,
  hashContent,
  hashText,
  projectSkillPath,
  requiredSkillFiles,
} from "./skill-pack.ts";

const unixNewline = "name: sample\n";
const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

function bundledSkillText(skillName: string): string {
  return bundledSkillFileText(skillName, "SKILL.md");
}

function bundledSkillFileText(skillName: string, filePath: string): string {
  return readFileSync(join(repoRoot, "skills", skillName, filePath), "utf8");
}

test("recommended project skill paths are repo-relative POSIX paths", () => {
  assert.equal(DEFAULT_PROJECT_SKILL_DIR, ".patchmill/skills");
  assert.equal(
    projectSkillPath("writing-plans"),
    ".patchmill/skills/writing-plans",
  );
  assert.equal(
    projectSkillPath("subagent-driven-development", "project/skills/"),
    "project/skills/subagent-driven-development",
  );
});

test("requiredSkillFiles returns bundled sidecars and SKILL.md fallback", () => {
  assert.deepEqual(requiredSkillFiles("patchmill-visual-evidence"), [
    "SKILL.md",
    "scripts/capture-visual-evidence.cjs",
  ]);
  assert.deepEqual(requiredSkillFiles("patchmill-issue-triage"), ["SKILL.md"]);
  assert.deepEqual(requiredSkillFiles("unknown"), ["SKILL.md"]);
});

test("buildRecommendedProjectSkillConfig maps required workflow stages locally", () => {
  assert.deepEqual(buildRecommendedProjectSkillConfig(), {
    triage: ".patchmill/skills/patchmill-issue-triage",
    planning: ".patchmill/skills/writing-plans",
    implementation: ".patchmill/skills/subagent-driven-development",
    visualEvidence: ".patchmill/skills/patchmill-visual-evidence",
  });
});

test("default pack records pinned external source", () => {
  assert.equal(PATCHMILL_RECOMMENDED_SKILL_PACK.name, "patchmill-recommended");
  assert.equal(PATCHMILL_RECOMMENDED_SKILL_PACK.version, "2026.07.1");
  assert.deepEqual(PATCHMILL_RECOMMENDED_SKILL_PACK.source, {
    type: "github-release",
    repository: "obra/superpowers",
    tag: "v6.0.3",
    tarballUrl:
      "https://github.com/obra/superpowers/archive/refs/tags/v6.0.3.tar.gz",
  });
  assert.deepEqual(PATCHMILL_RECOMMENDED_SKILL_PACK.skills, [
    { name: "patchmill-issue-triage", source: "patchmill" },
    {
      name: "subagent-dev-with-codex-and-thermo-reviews",
      source: "patchmill",
    },
    {
      name: "single-subagent-dev-with-codex-and-thermo-reviews",
      source: "patchmill",
    },
    { name: "module-size", source: "patchmill" },
    { name: "patchmill-visual-evidence", source: "patchmill" },
    { name: "brainstorming", source: "patchmill" },
    { name: "dispatching-parallel-agents", source: "superpowers" },
    { name: "executing-plans", source: "superpowers" },
    { name: "finishing-a-development-branch", source: "superpowers" },
    { name: "receiving-code-review", source: "superpowers" },
    { name: "requesting-code-review", source: "superpowers" },
    { name: "subagent-driven-development", source: "superpowers" },
    { name: "systematic-debugging", source: "superpowers" },
    { name: "test-driven-development", source: "patchmill" },
    { name: "using-git-worktrees", source: "superpowers" },
    { name: "using-superpowers", source: "superpowers" },
    { name: "verification-before-completion", source: "superpowers" },
    { name: "writing-plans", source: "patchmill" },
    { name: "writing-skills", source: "superpowers" },
  ]);
  assert.equal(
    new Set(PATCHMILL_RECOMMENDED_SKILL_PACK.skills.map((skill) => skill.name))
      .size,
    PATCHMILL_RECOMMENDED_SKILL_PACK.skills.length,
  );
});

test("Patchmill-adapted skills encode artifact locations, worktree policy, and test value", () => {
  const brainstorming = bundledSkillText("brainstorming");
  const brainstormingReviewer = bundledSkillFileText(
    "brainstorming",
    "spec-document-reviewer-prompt.md",
  );
  assert.match(brainstorming, /Patchmill customization/u);
  assert.match(brainstorming, /docs\/specs\/YYYY-MM-DD-<topic>-design\.md/u);
  assert.match(brainstorming, /issue worktree/u);
  assert.match(brainstorming, /using-git-worktrees/u);
  assert.match(brainstormingReviewer, /docs\/specs\//u);
  assert.doesNotMatch(brainstormingReviewer, /docs\/superpowers/u);

  const writingPlans = bundledSkillText("writing-plans");
  assert.match(writingPlans, /Patchmill customization/u);
  assert.match(writingPlans, /docs\/plans\/YYYY-MM-DD-<feature-name>\.md/u);
  assert.match(writingPlans, /Testing Value Gate/u);
  assert.match(writingPlans, /direct verification/u);

  const tdd = bundledSkillText("test-driven-development");
  assert.match(tdd, /Patchmill customization/u);
  assert.match(tdd, /Testing Value Gate/u);
  assert.match(tdd, /Do not write new tests merely to assert/u);
  assert.match(tdd, /documentation text/u);
  assert.match(tdd, /package lock contents/u);
});

test("hashText returns stable sha256 hex", () => {
  assert.equal(
    hashText(unixNewline),
    createHash("sha256").update(unixNewline).digest("hex"),
  );
});

test("hashContent hashes raw bytes without text decoding", () => {
  const content = Buffer.from([0x66, 0x6f, 0x80, 0x6f]);

  assert.equal(
    hashContent(content),
    createHash("sha256").update(content).digest("hex"),
  );
});

test("buildSkillPackMetadata records installed file hashes", () => {
  const files = [
    {
      path: ".patchmill/skills/writing-plans/SKILL.md",
      sha256: hashText(unixNewline),
    },
  ];
  const metadata = buildSkillPackMetadata(files, {
    skillDir: "custom/skills/",
  });

  assert.deepEqual(metadata, {
    pack: {
      name: "patchmill-recommended",
      version: "2026.07.1",
      source: {
        type: "github-release",
        repository: "obra/superpowers",
        tag: "v6.0.3",
        tarballUrl:
          "https://github.com/obra/superpowers/archive/refs/tags/v6.0.3.tar.gz",
      },
    },
    installedAt: "<generated-by-init>",
    skillDir: "custom/skills",
    metadataFile: SKILL_PACK_METADATA_FILE,
    files: [
      {
        path: ".patchmill/skills/writing-plans/SKILL.md",
        sha256: hashText(unixNewline),
      },
    ],
  });

  files[0].path = "changed/path.md";
  assert.equal(
    metadata.files[0]?.path,
    ".patchmill/skills/writing-plans/SKILL.md",
  );
  assert.notEqual(metadata.files[0]?.path, files[0]?.path);
});
