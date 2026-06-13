import assert from "node:assert/strict";
import {
  access,
  chmod,
  cp,
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  symlink,
  unlink,
  writeFile,
  stat,
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
  type SkillInstallerDependencies,
  validateExistingSkillDirectory,
} from "./skill-installer.ts";

const skillInstallerDependencies: SkillInstallerDependencies = {
  access,
  chmod,
  cp,
  mkdtemp,
  mkdir,
  readdir,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
};

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

const finalReviewedImplementationSkill = `---
name: subagent-dev-with-codex-and-thermo-reviews
description: Use when executing Patchmill implementation plans that require final full-worktree readiness review before landing
---
# Subagent Dev with Codex and Thermo Reviews
`;

const singleSubagentReviewedImplementationSkill = `---
name: single-subagent-dev-with-codex-and-thermo-reviews
description: Use when executing Patchmill implementation plans with one implementation subagent and final full-worktree readiness review before landing
---
# Single Subagent Dev with Codex and Thermo Reviews
`;

test("installProjectSkills copies skills and writes metadata", async () => {
  const repoRoot = await tempRoot("patchmill-install-repo-");
  const patchmillSource = await tempRoot("patchmill-install-patchmill-");
  const superpowersSource = await tempRoot("patchmill-install-superpowers-");
  await writeSkill(patchmillSource, "patchmill-issue-triage", triageSkill);
  await writeSkill(
    patchmillSource,
    "subagent-dev-with-codex-and-thermo-reviews",
    finalReviewedImplementationSkill,
    {
      "prompts/final-review.md": "review the final worktree\n",
      "rubrics/armin-codex-review-prompt.md":
        "review using Armin's Codex adaptation\n",
    },
  );
  await writeSkill(
    patchmillSource,
    "single-subagent-dev-with-codex-and-thermo-reviews",
    singleSubagentReviewedImplementationSkill,
    {
      "prompts/implement-plan.md": "implement the full plan with one worker\n",
    },
  );
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
      {
        name: "subagent-dev-with-codex-and-thermo-reviews",
        source: "patchmill",
      },
      {
        name: "single-subagent-dev-with-codex-and-thermo-reviews",
        source: "patchmill",
      },
      { name: "writing-plans", source: "superpowers" },
      { name: "subagent-driven-development", source: "superpowers" },
    ],
  });

  assert.equal(result.skillDir, ".patchmill/skills");
  assert.deepEqual(result.skillConfig, buildRecommendedProjectSkillConfig());
  assert.deepEqual(result.installedSkills, [
    ".patchmill/skills/patchmill-issue-triage",
    ".patchmill/skills/subagent-dev-with-codex-and-thermo-reviews",
    ".patchmill/skills/single-subagent-dev-with-codex-and-thermo-reviews",
    ".patchmill/skills/writing-plans",
    ".patchmill/skills/subagent-driven-development",
  ]);
  assert.equal(
    await readFile(
      join(
        repoRoot,
        ".patchmill",
        "skills",
        "subagent-dev-with-codex-and-thermo-reviews",
        "SKILL.md",
      ),
      "utf8",
    ),
    finalReviewedImplementationSkill,
  );
  assert.equal(
    await readFile(
      join(
        repoRoot,
        ".patchmill",
        "skills",
        "single-subagent-dev-with-codex-and-thermo-reviews",
        "SKILL.md",
      ),
      "utf8",
    ),
    singleSubagentReviewedImplementationSkill,
  );
  assert.equal(
    await readFile(
      join(
        repoRoot,
        ".patchmill",
        "skills",
        "single-subagent-dev-with-codex-and-thermo-reviews",
        "prompts",
        "implement-plan.md",
      ),
      "utf8",
    ),
    "implement the full plan with one worker\n",
  );
  assert.equal(
    await readFile(
      join(
        repoRoot,
        ".patchmill",
        "skills",
        "subagent-dev-with-codex-and-thermo-reviews",
        "prompts",
        "final-review.md",
      ),
      "utf8",
    ),
    "review the final worktree\n",
  );
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
        "subagent-dev-with-codex-and-thermo-reviews",
        "rubrics",
        "armin-codex-review-prompt.md",
      ),
      "utf8",
    ),
    "review using Armin's Codex adaptation\n",
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
        path: ".patchmill/skills/subagent-dev-with-codex-and-thermo-reviews/SKILL.md",
        sha256: hashText(finalReviewedImplementationSkill),
      },
      {
        path: ".patchmill/skills/subagent-dev-with-codex-and-thermo-reviews/prompts/final-review.md",
        sha256: hashText("review the final worktree\n"),
      },
      {
        path: ".patchmill/skills/subagent-dev-with-codex-and-thermo-reviews/rubrics/armin-codex-review-prompt.md",
        sha256: hashText("review using Armin's Codex adaptation\n"),
      },
      {
        path: ".patchmill/skills/single-subagent-dev-with-codex-and-thermo-reviews/SKILL.md",
        sha256: hashText(singleSubagentReviewedImplementationSkill),
      },
      {
        path: ".patchmill/skills/single-subagent-dev-with-codex-and-thermo-reviews/prompts/implement-plan.md",
        sha256: hashText("implement the full plan with one worker\n"),
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

test("installProjectSkills installs module-size from the recommended pack", async () => {
  const repoRoot = await tempRoot("patchmill-install-repo-");

  const result = await installProjectSkills({
    repoRoot,
    installedAt: "2026-06-13T00:00:00.000Z",
  });

  assert.equal(
    result.installedSkills.includes(".patchmill/skills/module-size"),
    true,
  );
  assert.match(
    await readFile(
      join(repoRoot, ".patchmill", "skills", "module-size", "SKILL.md"),
      "utf8",
    ),
    /^---\nname: module-size\n/mu,
  );

  const metadata = JSON.parse(
    await readFile(result.metadataPath, "utf8"),
  ) as ReturnType<typeof buildSkillPackMetadata>;
  assert.equal(
    metadata.files.some(
      (file) => file.path === ".patchmill/skills/module-size/SKILL.md",
    ),
    true,
  );
});

test("installProjectSkills makes copied skill pack owner-writable", async () => {
  const repoRoot = await tempRoot("patchmill-install-repo-");
  const patchmillSource = await tempRoot("patchmill-install-patchmill-");
  const superpowersSource = await tempRoot("patchmill-install-superpowers-");
  await writeSkill(patchmillSource, "patchmill-issue-triage", triageSkill, {
    "scripts/check.md": "check things\n",
  });

  await chmod(
    join(patchmillSource, "patchmill-issue-triage", "scripts", "check.md"),
    0o444,
  );
  await chmod(
    join(patchmillSource, "patchmill-issue-triage", "scripts"),
    0o555,
  );
  await chmod(
    join(patchmillSource, "patchmill-issue-triage", "SKILL.md"),
    0o444,
  );
  await chmod(join(patchmillSource, "patchmill-issue-triage"), 0o555);

  await installProjectSkills({
    repoRoot,
    sourceRoots: {
      patchmillSkillsDir: patchmillSource,
      superpowersSkillsDir: superpowersSource,
    },
    packSkills: [{ name: "patchmill-issue-triage", source: "patchmill" }],
  });

  const installedSkillDir = join(
    repoRoot,
    ".patchmill",
    "skills",
    "patchmill-issue-triage",
  );
  const installedSkill = await stat(join(installedSkillDir, "SKILL.md"));
  const installedNestedDir = await stat(join(installedSkillDir, "scripts"));
  const installedNestedFile = await stat(
    join(installedSkillDir, "scripts", "check.md"),
  );

  assert.equal(installedSkill.mode & 0o200, 0o200);
  assert.equal(installedNestedDir.mode & 0o200, 0o200);
  assert.equal(installedNestedFile.mode & 0o200, 0o200);
  await rm(join(repoRoot, ".patchmill"), { recursive: true });
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

test("installProjectSkills does not publish partial targets when staging fails", async () => {
  const repoRoot = await tempRoot("patchmill-install-repo-");
  const patchmillSource = await tempRoot("patchmill-install-patchmill-");
  const superpowersSource = await tempRoot("patchmill-install-superpowers-");
  await writeSkill(patchmillSource, "patchmill-issue-triage", triageSkill, {
    "triage-notes.md": "take notes\n",
  });
  await writeSkill(superpowersSource, "writing-plans", planningSkill);

  const secondSkillDir = join(superpowersSource, "writing-plans");
  const secondSkillPath = join(secondSkillDir, "SKILL.md");
  let copyCalls = 0;

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
      dependencies: {
        ...skillInstallerDependencies,
        async cp(source, destination, options) {
          copyCalls += 1;
          if (copyCalls === 1) {
            await unlink(secondSkillPath);
            await symlink("missing-skill.md", secondSkillPath);
          }
          if (source === secondSkillDir) {
            throw new Error(
              `ENOENT: no such file or directory, copyfile '${secondSkillPath}'`,
            );
          }

          return cp(source, destination, options);
        },
      },
    }),
    /ENOENT: no such file or directory, copyfile .*writing-plans\/SKILL\.md/,
  );

  await assert.rejects(access(join(repoRoot, ".patchmill", "skills")));
});

test("installProjectSkills can install two skills and publish metadata in one directory publish", async () => {
  const repoRoot = await tempRoot("patchmill-install-repo-");
  const patchmillSource = await tempRoot("patchmill-install-patchmill-");
  const superpowersSource = await tempRoot("patchmill-install-superpowers-");
  await writeSkill(patchmillSource, "patchmill-issue-triage", triageSkill);
  await writeSkill(superpowersSource, "writing-plans", planningSkill, {
    "plan-template.md": "template\n",
  });

  const publishedSkillDir = join(repoRoot, ".patchmill", "skills");
  let renameCalls = 0;

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
    ],
    dependencies: {
      ...skillInstallerDependencies,
      async rename(from, to) {
        renameCalls += 1;
        assert.equal(to, publishedSkillDir);
        await assert.rejects(access(publishedSkillDir));
        assert.equal(
          await readFile(
            join(from, "patchmill-issue-triage", "SKILL.md"),
            "utf8",
          ),
          triageSkill,
        );
        assert.equal(
          await readFile(join(from, "writing-plans", "SKILL.md"), "utf8"),
          planningSkill,
        );

        const metadata = JSON.parse(
          await readFile(join(from, SKILL_PACK_METADATA_FILE), "utf8"),
        ) as ReturnType<typeof buildSkillPackMetadata>;
        assert.deepEqual(
          metadata.files.map((file) => file.path),
          [
            ".patchmill/skills/patchmill-issue-triage/SKILL.md",
            ".patchmill/skills/writing-plans/SKILL.md",
            ".patchmill/skills/writing-plans/plan-template.md",
          ],
        );

        return rename(from, to);
      },
    },
  });

  assert.equal(renameCalls, 1);
  assert.deepEqual(result.installedSkills, [
    ".patchmill/skills/patchmill-issue-triage",
    ".patchmill/skills/writing-plans",
  ]);
  assert.equal(
    await readFile(join(publishedSkillDir, SKILL_PACK_METADATA_FILE), "utf8"),
    await readFile(result.metadataPath, "utf8"),
  );
});

test("installProjectSkills refuses to overwrite existing skill root", async () => {
  const repoRoot = await tempRoot("patchmill-install-repo-");
  const patchmillSource = await tempRoot("patchmill-install-patchmill-");
  await writeSkill(patchmillSource, "patchmill-issue-triage", triageSkill);
  await mkdir(join(repoRoot, ".patchmill", "skills"), { recursive: true });

  await assert.rejects(
    installProjectSkills({
      repoRoot,
      sourceRoots: {
        patchmillSkillsDir: patchmillSource,
        superpowersSkillsDir: await tempRoot("patchmill-install-superpowers-"),
      },
      packSkills: [{ name: "patchmill-issue-triage", source: "patchmill" }],
    }),
    /Refusing to overwrite existing skill path: \.patchmill\/skills/,
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
  await access(
    join(
      roots.patchmillSkillsDir,
      "single-subagent-dev-with-codex-and-thermo-reviews",
      "SKILL.md",
    ),
  );
  await access(join(roots.superpowersSkillsDir, "writing-plans", "SKILL.md"));
});
