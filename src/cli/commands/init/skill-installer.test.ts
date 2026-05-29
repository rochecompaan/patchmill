import assert from "node:assert/strict";
import {
  access,
  mkdtemp,
  mkdir,
  readFile,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  SKILL_PACK_METADATA_FILE,
  buildRecommendedProjectSkillConfig,
  buildSkillPackMetadata,
  hashText,
} from "../../../workflow/skill-pack.ts";
import {
  defaultSkillSourceRoots,
  installProjectSkills,
  validateExistingSkillDirectory,
} from "./skill-installer.ts";

async function tempRoot(prefix: string): Promise<string> {
  return mkdtemp(join(tmpdir(), prefix));
}

async function writeSkill(
  root: string,
  skillPath: string,
  skillBody: string,
  extraFiles: Record<string, string> = {},
): Promise<void> {
  const skillDir = join(root, skillPath);
  await mkdir(skillDir, { recursive: true });
  await writeFile(join(skillDir, "SKILL.md"), skillBody);
  for (const [relativePath, content] of Object.entries(extraFiles)) {
    const fullPath = join(skillDir, relativePath);
    await mkdir(join(fullPath, ".."), { recursive: true });
    await writeFile(fullPath, content);
  }
}

const triageSkill = `---
name: patchmill-issue-triage
description: Triage issues.
---
# Triage
`;

const planningSkill = `---
name: writing-plans
description: Write plans.
---
# Planning
`;

const implementationSkill = `---
name: subagent-driven-development
description: Execute plans.
---
# Implementation
`;

test("installProjectSkills copies skills and writes metadata", async () => {
  const repoRoot = await tempRoot("patchmill-install-repo-");
  const patchmillSource = await tempRoot("patchmill-install-patchmill-");
  const superpowersSource = await tempRoot("patchmill-install-superpowers-");
  await writeSkill(patchmillSource, "patchmill-issue-triage", triageSkill);
  await writeSkill(superpowersSource, "writing-plans", planningSkill, {
    "plan-document-reviewer-prompt.md": "review plans carefully\n",
  });
  await writeSkill(
    superpowersSource,
    "subagent-driven-development",
    implementationSkill,
  );

  const result = await installProjectSkills({
    repoRoot,
    sourceRoots: {
      patchmillSkillsDir: patchmillSource,
      superpowersSkillsDir: superpowersSource,
    },
    installedAt: "2026-05-29T00:00:00.000Z",
    packSkills: [
      { name: "patchmill-issue-triage", source: "patchmill" },
      { name: "writing-plans", source: "superpowers" },
      { name: "subagent-driven-development", source: "superpowers" },
    ],
  });

  assert.equal(result.skillDir, ".patchmill/skills");
  assert.deepEqual(result.skillConfig, buildRecommendedProjectSkillConfig());
  assert.deepEqual(result.installedSkills, [
    ".patchmill/skills/patchmill-issue-triage",
    ".patchmill/skills/writing-plans",
    ".patchmill/skills/subagent-driven-development",
  ]);
  assert.equal(
    await readFile(
      join(repoRoot, ".patchmill", "skills", "writing-plans", "SKILL.md"),
      "utf8",
    ),
    planningSkill,
  );
  assert.equal(
    await readFile(
      join(
        repoRoot,
        ".patchmill",
        "skills",
        "writing-plans",
        "plan-document-reviewer-prompt.md",
      ),
      "utf8",
    ),
    "review plans carefully\n",
  );

  const metadata = JSON.parse(
    await readFile(result.metadataPath, "utf8"),
  ) as ReturnType<typeof buildSkillPackMetadata>;
  const expectedMetadata = buildSkillPackMetadata(
    [
      {
        path: ".patchmill/skills/patchmill-issue-triage/SKILL.md",
        sha256: hashText(triageSkill),
      },
      {
        path: ".patchmill/skills/writing-plans/SKILL.md",
        sha256: hashText(planningSkill),
      },
      {
        path: ".patchmill/skills/writing-plans/plan-document-reviewer-prompt.md",
        sha256: hashText("review plans carefully\n"),
      },
      {
        path: ".patchmill/skills/subagent-driven-development/SKILL.md",
        sha256: hashText(implementationSkill),
      },
    ],
    {
      installedAt: "2026-05-29T00:00:00.000Z",
      skillDir: ".patchmill/skills",
    },
  );

  assert.equal(
    result.metadataPath,
    join(repoRoot, ".patchmill", "skills", SKILL_PACK_METADATA_FILE),
  );
  assert.deepEqual(
    metadata.files,
    expectedMetadata.files.toSorted((a, b) =>
      a.path < b.path ? -1 : a.path > b.path ? 1 : 0,
    ),
  );
  assert.deepEqual(
    { ...metadata, files: undefined },
    { ...expectedMetadata, files: undefined },
  );
});

test("installProjectSkills refuses to overwrite existing skill files/directories", async () => {
  const repoRoot = await tempRoot("patchmill-install-repo-");
  const patchmillSource = await tempRoot("patchmill-install-patchmill-");
  const superpowersSource = await tempRoot("patchmill-install-superpowers-");
  await writeSkill(patchmillSource, "patchmill-issue-triage", triageSkill);
  await mkdir(
    join(repoRoot, ".patchmill", "skills", "patchmill-issue-triage"),
    {
      recursive: true,
    },
  );
  await writeFile(
    join(
      repoRoot,
      ".patchmill",
      "skills",
      "patchmill-issue-triage",
      "SKILL.md",
    ),
    "existing\n",
  );

  await assert.rejects(
    installProjectSkills({
      repoRoot,
      sourceRoots: {
        patchmillSkillsDir: patchmillSource,
        superpowersSkillsDir: superpowersSource,
      },
      packSkills: [{ name: "patchmill-issue-triage", source: "patchmill" }],
    }),
    /Refusing to overwrite existing skill path: \.patchmill\/skills\/patchmill-issue-triage/,
  );
  assert.equal(
    await readFile(
      join(
        repoRoot,
        ".patchmill",
        "skills",
        "patchmill-issue-triage",
        "SKILL.md",
      ),
      "utf8",
    ),
    "existing\n",
  );
});

test("installProjectSkills preflights all targets before copying any skill", async () => {
  const repoRoot = await tempRoot("patchmill-install-repo-");
  const patchmillSource = await tempRoot("patchmill-install-patchmill-");
  const superpowersSource = await tempRoot("patchmill-install-superpowers-");
  await writeSkill(patchmillSource, "patchmill-issue-triage", triageSkill);
  await writeSkill(superpowersSource, "writing-plans", planningSkill);
  await mkdir(join(repoRoot, ".patchmill", "skills", "writing-plans"), {
    recursive: true,
  });

  await assert.rejects(
    installProjectSkills({
      repoRoot,
      sourceRoots: {
        patchmillSkillsDir: patchmillSource,
        superpowersSkillsDir: superpowersSource,
      },
      packSkills: [
        { name: "patchmill-issue-triage", source: "patchmill" },
        { name: "writing-plans", source: "superpowers" },
      ],
    }),
    /Refusing to overwrite existing skill path: \.patchmill\/skills\/writing-plans/,
  );

  await assert.rejects(
    access(join(repoRoot, ".patchmill", "skills", "patchmill-issue-triage")),
  );
});

test("installProjectSkills preflights later source trees before copying any skill", async () => {
  const repoRoot = await tempRoot("patchmill-install-repo-");
  const patchmillSource = await tempRoot("patchmill-install-patchmill-");
  const superpowersSource = await tempRoot("patchmill-install-superpowers-");
  await writeSkill(patchmillSource, "patchmill-issue-triage", triageSkill);
  await writeSkill(superpowersSource, "writing-plans", planningSkill);
  await symlink(
    "missing-plan-template.md",
    join(superpowersSource, "writing-plans", "broken-link.md"),
  );

  await assert.rejects(
    installProjectSkills({
      repoRoot,
      sourceRoots: {
        patchmillSkillsDir: patchmillSource,
        superpowersSkillsDir: superpowersSource,
      },
      packSkills: [
        { name: "patchmill-issue-triage", source: "patchmill" },
        { name: "writing-plans", source: "superpowers" },
      ],
    }),
    /Unsupported skill source entry: writing-plans\/broken-link\.md/,
  );

  await assert.rejects(
    access(join(repoRoot, ".patchmill", "skills", "patchmill-issue-triage")),
  );
});

test("validateExistingSkillDirectory returns local config for path mode", async () => {
  const repoRoot = await tempRoot("patchmill-install-repo-");
  await writeSkill(
    repoRoot,
    "project-skills/patchmill-issue-triage",
    triageSkill,
  );
  await writeSkill(repoRoot, "project-skills/writing-plans", planningSkill);
  await writeSkill(
    repoRoot,
    "project-skills/subagent-driven-development",
    implementationSkill,
  );

  assert.deepEqual(
    await validateExistingSkillDirectory(repoRoot, "project-skills"),
    buildRecommendedProjectSkillConfig("project-skills"),
  );
});

test("validateExistingSkillDirectory fails when a required skill is missing", async () => {
  const repoRoot = await tempRoot("patchmill-install-repo-");
  await writeSkill(repoRoot, "project-skills/writing-plans", planningSkill);

  await assert.rejects(
    validateExistingSkillDirectory(repoRoot, "project-skills"),
    /Missing required skill file: project-skills\/patchmill-issue-triage\/SKILL\.md/,
  );
});

test("validateExistingSkillDirectory fails when SKILL.md is a directory", async () => {
  const repoRoot = await tempRoot("patchmill-install-repo-");
  await mkdir(
    join(repoRoot, "project-skills", "patchmill-issue-triage", "SKILL.md"),
    {
      recursive: true,
    },
  );
  await writeSkill(repoRoot, "project-skills/writing-plans", planningSkill);
  await writeSkill(
    repoRoot,
    "project-skills/subagent-driven-development",
    implementationSkill,
  );

  await assert.rejects(
    validateExistingSkillDirectory(repoRoot, "project-skills"),
    /Missing required skill file: project-skills\/patchmill-issue-triage\/SKILL\.md/,
  );
});

test("defaultSkillSourceRoots resolves bundled and dependency skill roots", async () => {
  const roots = defaultSkillSourceRoots();

  await access(
    join(roots.patchmillSkillsDir, "patchmill-issue-triage", "SKILL.md"),
  );
  await access(join(roots.superpowersSkillsDir, "writing-plans", "SKILL.md"));
});
