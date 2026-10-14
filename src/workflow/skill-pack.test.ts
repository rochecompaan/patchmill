import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  DEFAULT_PROJECT_SKILL_DIR,
  PATCHMILL_PLANNING_SKILL,
  PATCHMILL_RECOMMENDED_SKILL_PACK,
  SKILL_PACK_METADATA_FILE,
  buildRecommendedProjectSkillConfig,
  buildSkillPackMetadata,
  hashContent,
  hashText,
  projectSkillPath,
  requiredSkillFiles,
  type SkillPackSkill,
} from "./skill-pack.ts";

const unixNewline = "name: sample\n";
const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const packageJson = JSON.parse(
  readFileSync(join(repoRoot, "package.json"), "utf8"),
) as { dependencies?: Record<string, string> };
const superpowersSpec = packageJson.dependencies?.superpowers ?? "";
const superpowersMatch =
  /^https:\/\/github\.com\/obra\/superpowers\/archive\/refs\/tags\/(v\d+\.\d+\.\d+)\.tar\.gz$/u.exec(
    superpowersSpec,
  );
assert.ok(superpowersMatch, "package.json must pin a stable Superpowers tag");
const expectedSuperpowersSource = {
  type: "github-release" as const,
  repository: "obra/superpowers",
  tag: superpowersMatch[1],
  tarballUrl: superpowersSpec,
};
const simpleEnglishSpec = packageJson.dependencies?.["simple-english"] ?? "";
assert.equal(
  simpleEnglishSpec,
  "file:vendor/simple-english",
  "package.json must pin the vendored SimpleEnglish package",
);
const vendoredSimpleEnglishPackage = JSON.parse(
  readFileSync(
    join(repoRoot, "vendor", "simple-english", "package.json"),
    "utf8",
  ),
) as { version?: string };
assert.ok(
  vendoredSimpleEnglishPackage.version,
  "vendor/simple-english/package.json must record a version",
);
const expectedSimpleEnglishSource = {
  type: "github-release" as const,
  repository: "AminBlg/SimpleEnglish",
  tag: `v${vendoredSimpleEnglishPackage.version}`,
  tarballUrl: `https://github.com/AminBlg/SimpleEnglish/archive/refs/tags/v${vendoredSimpleEnglishPackage.version}.tar.gz`,
};

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
    projectSkillPath(PATCHMILL_PLANNING_SKILL),
    ".patchmill/skills/patchmill-planning",
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
    planning: ".patchmill/skills/patchmill-planning",
    implementation:
      ".patchmill/skills/inline-dev-with-validation-and-pr-checks",
    visualEvidence: ".patchmill/skills/patchmill-visual-evidence",
  });
});

test("default pack records pinned external source", () => {
  assert.equal(PATCHMILL_RECOMMENDED_SKILL_PACK.name, "patchmill-recommended");
  assert.equal(PATCHMILL_RECOMMENDED_SKILL_PACK.version, "2026.10.2");
  assert.deepEqual(
    PATCHMILL_RECOMMENDED_SKILL_PACK.source,
    expectedSuperpowersSource,
  );
  assert.deepEqual(PATCHMILL_RECOMMENDED_SKILL_PACK.additionalSources, [
    expectedSimpleEnglishSource,
  ]);
  assert.deepEqual(
    PATCHMILL_RECOMMENDED_SKILL_PACK.skills.map(({ name, source }) => ({
      name,
      source,
    })),
    [
      { name: "patchmill-issue-triage", source: "patchmill" },
      {
        name: "inline-dev-with-validation-and-pr-checks",
        source: "patchmill",
      },
      { name: "module-size", source: "patchmill" },
      { name: "patchmill-visual-evidence", source: "patchmill" },
      { name: "patchmill-planning", source: "patchmill" },
      { name: "frontend-design", source: "patchmill" },
      { name: "patchmill-frontend-review", source: "patchmill" },
      { name: "simple-english", source: "simple-english" },
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
    ],
  );
  assert.equal(
    new Set(PATCHMILL_RECOMMENDED_SKILL_PACK.skills.map((skill) => skill.name))
      .size,
    PATCHMILL_RECOMMENDED_SKILL_PACK.skills.length,
  );
});

test("Patchmill planning wrapper annotates sibling Superpowers skills", () => {
  const planning = bundledSkillText(PATCHMILL_PLANNING_SKILL);
  assert.match(planning, /name: patchmill-planning/u);
  assert.match(planning, /\.\.\/brainstorming\/SKILL\.md/u);
  assert.match(planning, /\.\.\/writing-plans\/SKILL\.md/u);
  assert.match(planning, /\.\.\/simple-english\/SKILL\.md/u);
  assert.match(
    planning,
    /docs\/specs\/YYYY-MM-DD-issue-<number>-<title-slug>-design\.md/u,
  );
  assert.match(
    planning,
    /docs\/plans\/YYYY-MM-DD-issue-<number>-<title-slug>\.md/u,
  );
  assert.match(planning, /issue worktree/u);
  assert.match(planning, /Testing Value Gate/u);
  assert.match(planning, /direct verification/u);
});

test("metadata renders provenance and canonical sibling requirements without mutating entries", () => {
  const skills: SkillPackSkill[] = [
    {
      name: "patchmill-planning",
      source: "simple-english",
      upstreamSources: [
        {
          repository: "example/guidance",
          commit: "fixture-pin",
          files: [
            { sourcePath: "guidance.md", targetPath: "references/guidance.md" },
          ],
          license: {
            name: "MIT",
            sourcePath: "LICENSE",
            targetPath: "LICENSE",
          },
        },
        {
          repository: "example/other",
          commit: "other-pin",
          files: [
            { sourcePath: "wrapper.md", targetPath: "references/wrapper.md" },
          ],
          license: { name: "MIT", sourcePath: "README.md#license" },
        },
      ],
    },
  ];
  const before = structuredClone(skills);
  const metadata = buildSkillPackMetadata([], {
    skillDir: "custom/skills/",
    skills,
  });
  assert.deepEqual(metadata.skills, [
    {
      name: "patchmill-planning",
      source: "simple-english",
      requiredFiles: [
        "custom/skills/patchmill-planning/SKILL.md",
        "custom/skills/frontend-design/SKILL.md",
        "custom/skills/frontend-design/LICENSE.txt",
      ],
      upstreamSources: [
        {
          repository: "example/guidance",
          commit: "fixture-pin",
          files: [
            {
              sourcePath: "guidance.md",
              installedPath:
                "custom/skills/patchmill-planning/references/guidance.md",
            },
          ],
          license: {
            name: "MIT",
            sourcePath: "LICENSE",
            installedPath: "custom/skills/patchmill-planning/LICENSE",
          },
        },
        {
          repository: "example/other",
          commit: "other-pin",
          files: [
            {
              sourcePath: "wrapper.md",
              installedPath:
                "custom/skills/patchmill-planning/references/wrapper.md",
            },
          ],
          license: { name: "MIT", sourcePath: "README.md#license" },
        },
      ],
    },
  ]);
  assert.deepEqual(skills, before);
  metadata.skills![0]!.upstreamSources![0]!.files[0]!.sourcePath = "changed";
  assert.deepEqual(skills, before);
  assert.ok(Array.isArray(buildSkillPackMetadata([]).skills));
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
    skills: [{ name: "writing-plans", source: "superpowers" }],
  });

  assert.deepEqual(metadata, {
    pack: {
      name: "patchmill-recommended",
      version: "2026.10.2",
      source: expectedSuperpowersSource,
      additionalSources: [expectedSimpleEnglishSource],
    },
    installedAt: "<generated-by-init>",
    skillDir: "custom/skills",
    metadataFile: SKILL_PACK_METADATA_FILE,
    skills: [
      {
        name: "writing-plans",
        source: "superpowers",
        requiredFiles: ["custom/skills/writing-plans/SKILL.md"],
      },
    ],
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
