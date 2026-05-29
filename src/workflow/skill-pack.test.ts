import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import {
  DEFAULT_PROJECT_SKILL_DIR,
  PATCHMILL_RECOMMENDED_SKILL_PACK,
  SKILL_PACK_METADATA_FILE,
  buildRecommendedProjectSkillConfig,
  buildSkillPackMetadata,
  hashContent,
  hashText,
  projectSkillPath,
} from "./skill-pack.ts";

const unixNewline = "name: sample\n";

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

test("buildRecommendedProjectSkillConfig maps required workflow stages locally", () => {
  assert.deepEqual(buildRecommendedProjectSkillConfig(), {
    triage: ".patchmill/skills/patchmill-issue-triage",
    planning: ".patchmill/skills/writing-plans",
    implementation: ".patchmill/skills/subagent-driven-development",
  });
});

test("default pack records pinned external source", () => {
  assert.equal(PATCHMILL_RECOMMENDED_SKILL_PACK.name, "patchmill-recommended");
  assert.equal(PATCHMILL_RECOMMENDED_SKILL_PACK.version, "2026.05");
  assert.deepEqual(PATCHMILL_RECOMMENDED_SKILL_PACK.source, {
    type: "github-release",
    repository: "obra/superpowers",
    tag: "v5.0.7",
    tarballUrl:
      "https://github.com/obra/superpowers/archive/refs/tags/v5.0.7.tar.gz",
  });
  assert.deepEqual(PATCHMILL_RECOMMENDED_SKILL_PACK.skills, [
    { name: "patchmill-issue-triage", source: "patchmill" },
    { name: "brainstorming", source: "superpowers" },
    { name: "dispatching-parallel-agents", source: "superpowers" },
    { name: "executing-plans", source: "superpowers" },
    { name: "finishing-a-development-branch", source: "superpowers" },
    { name: "receiving-code-review", source: "superpowers" },
    { name: "requesting-code-review", source: "superpowers" },
    { name: "subagent-driven-development", source: "superpowers" },
    { name: "systematic-debugging", source: "superpowers" },
    { name: "test-driven-development", source: "superpowers" },
    { name: "using-git-worktrees", source: "superpowers" },
    { name: "using-superpowers", source: "superpowers" },
    { name: "verification-before-completion", source: "superpowers" },
    { name: "writing-plans", source: "superpowers" },
    { name: "writing-skills", source: "superpowers" },
  ]);
  assert.equal(
    new Set(PATCHMILL_RECOMMENDED_SKILL_PACK.skills.map((skill) => skill.name))
      .size,
    PATCHMILL_RECOMMENDED_SKILL_PACK.skills.length,
  );
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
      version: "2026.05",
      source: {
        type: "github-release",
        repository: "obra/superpowers",
        tag: "v5.0.7",
        tarballUrl:
          "https://github.com/obra/superpowers/archive/refs/tags/v5.0.7.tar.gz",
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
