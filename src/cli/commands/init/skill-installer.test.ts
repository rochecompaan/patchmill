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

const patchmillPlanningSkill = `---
name: patchmill-planning
description: Wrap Superpowers planning for Patchmill.
---
# Patchmill Planning
`;

const brainstormingSkill = `---
name: brainstorming
description: Brainstorm.
---
# Brainstorming
`;

const tddSkill = `---
name: test-driven-development
description: TDD.
---
# Test-Driven Development
`;

const implementationSkill = `---
name: subagent-driven-development
description: Execute plans.
---
# Implementation
`;

const validationReadyImplementationSkill = `---
name: subagent-dev-with-validation-and-pr-checks
description: Execute plans with final validation and PR readiness.
---
# Subagent Dev with Validation and PR Checks
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

const validationWrapperSharedPrompts = {
  "prompts/final-validation-review.md": "review final validation\n",
  "prompts/fix-pr-checks.md": "repair failed PR checks\n",
  "prompts/fix-review-findings.md": "fix validation findings\n",
};

async function writeValidationWrapperPathModeDependencies(
  root: string,
  skillDir: string,
  options: { omit?: string } = {},
): Promise<void> {
  if (options.omit !== "subagent-dev-with-validation-and-pr-checks") {
    await writeSkill(
      root,
      `${skillDir}/subagent-dev-with-validation-and-pr-checks`,
      validationReadyImplementationSkill,
    );
  }
  if (options.omit !== "subagent-driven-development") {
    await writeSkill(
      root,
      `${skillDir}/subagent-driven-development`,
      implementationSkill,
    );
  }

  const sharedPrompts = Object.fromEntries(
    Object.entries(validationWrapperSharedPrompts).filter(
      ([path]) => path !== options.omit,
    ),
  );
  await writeSkill(
    root,
    `${skillDir}/subagent-dev-with-codex-and-thermo-reviews`,
    finalReviewedImplementationSkill,
    sharedPrompts,
  );
}

test("installProjectSkills copies skills and writes metadata", async () => {
  const repoRoot = await tempRoot("patchmill-install-repo-");
  const patchmillSource = await tempRoot("patchmill-install-patchmill-");
  const superpowersSource = await tempRoot("patchmill-install-superpowers-");
  await writeSkill(patchmillSource, "patchmill-issue-triage", triageSkill);
  await writeSkill(
    patchmillSource,
    "subagent-dev-with-validation-and-pr-checks",
    validationReadyImplementationSkill,
  );
  await writeSkill(
    patchmillSource,
    "subagent-dev-with-codex-and-thermo-reviews",
    finalReviewedImplementationSkill,
    {
      "prompts/final-review.md": "review the final worktree\n",
      "prompts/final-validation-review.md": "review final validation\n",
      "prompts/fix-pr-checks.md": "repair failed PR checks\n",
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
  await writeSkill(
    patchmillSource,
    "patchmill-planning",
    patchmillPlanningSkill,
  );
  await writeSkill(superpowersSource, "brainstorming", brainstormingSkill, {
    "visual-companion.md": "visual companion instructions\n",
    "scripts/server.cjs": "console.log('server');\n",
  });
  await writeSkill(superpowersSource, "writing-plans", planningSkill, {
    "plan-document-reviewer-prompt.md": "review plans carefully\n",
  });
  await writeSkill(superpowersSource, "test-driven-development", tddSkill, {
    "testing-anti-patterns.md": "avoid mock-only tests\n",
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
        name: "subagent-dev-with-validation-and-pr-checks",
        source: "patchmill",
      },
      {
        name: "subagent-dev-with-codex-and-thermo-reviews",
        source: "patchmill",
      },
      {
        name: "single-subagent-dev-with-codex-and-thermo-reviews",
        source: "patchmill",
      },
      { name: "patchmill-planning", source: "patchmill" },
      { name: "brainstorming", source: "superpowers" },
      { name: "writing-plans", source: "superpowers" },
      { name: "test-driven-development", source: "superpowers" },
      { name: "subagent-driven-development", source: "superpowers" },
    ],
  });

  assert.equal(result.skillDir, ".patchmill/skills");
  assert.deepEqual(result.skillConfig, buildRecommendedProjectSkillConfig());
  assert.deepEqual(result.installedSkills, [
    ".patchmill/skills/patchmill-issue-triage",
    ".patchmill/skills/subagent-dev-with-validation-and-pr-checks",
    ".patchmill/skills/subagent-dev-with-codex-and-thermo-reviews",
    ".patchmill/skills/single-subagent-dev-with-codex-and-thermo-reviews",
    ".patchmill/skills/patchmill-planning",
    ".patchmill/skills/brainstorming",
    ".patchmill/skills/writing-plans",
    ".patchmill/skills/test-driven-development",
    ".patchmill/skills/subagent-driven-development",
  ]);
  assert.equal(
    await readFile(
      join(
        repoRoot,
        ".patchmill",
        "skills",
        "subagent-dev-with-validation-and-pr-checks",
        "SKILL.md",
      ),
      "utf8",
    ),
    validationReadyImplementationSkill,
  );
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
      join(
        repoRoot,
        ".patchmill",
        "skills",
        "subagent-dev-with-codex-and-thermo-reviews",
        "prompts",
        "final-validation-review.md",
      ),
      "utf8",
    ),
    "review final validation\n",
  );
  assert.equal(
    await readFile(
      join(
        repoRoot,
        ".patchmill",
        "skills",
        "subagent-dev-with-codex-and-thermo-reviews",
        "prompts",
        "fix-pr-checks.md",
      ),
      "utf8",
    ),
    "repair failed PR checks\n",
  );
  assert.equal(
    await readFile(
      join(repoRoot, ".patchmill", "skills", "patchmill-planning", "SKILL.md"),
      "utf8",
    ),
    patchmillPlanningSkill,
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
        "brainstorming",
        "visual-companion.md",
      ),
      "utf8",
    ),
    "visual companion instructions\n",
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
  assert.equal(
    await readFile(
      join(
        repoRoot,
        ".patchmill",
        "skills",
        "test-driven-development",
        "testing-anti-patterns.md",
      ),
      "utf8",
    ),
    "avoid mock-only tests\n",
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
        path: ".patchmill/skills/subagent-dev-with-validation-and-pr-checks/SKILL.md",
        sha256: hashText(validationReadyImplementationSkill),
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
        path: ".patchmill/skills/subagent-dev-with-codex-and-thermo-reviews/prompts/final-validation-review.md",
        sha256: hashText("review final validation\n"),
      },
      {
        path: ".patchmill/skills/subagent-dev-with-codex-and-thermo-reviews/prompts/fix-pr-checks.md",
        sha256: hashText("repair failed PR checks\n"),
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
        path: ".patchmill/skills/patchmill-planning/SKILL.md",
        sha256: hashText(patchmillPlanningSkill),
      },
      {
        path: ".patchmill/skills/brainstorming/SKILL.md",
        sha256: hashText(brainstormingSkill),
      },
      {
        path: ".patchmill/skills/brainstorming/scripts/server.cjs",
        sha256: hashText("console.log('server');\n"),
      },
      {
        path: ".patchmill/skills/brainstorming/visual-companion.md",
        sha256: hashText("visual companion instructions\n"),
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
        path: ".patchmill/skills/test-driven-development/SKILL.md",
        sha256: hashText(tddSkill),
      },
      {
        path: ".patchmill/skills/test-driven-development/testing-anti-patterns.md",
        sha256: hashText("avoid mock-only tests\n"),
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

test("installProjectSkills installs the default Patchmill visual evidence skill", async () => {
  const repoRoot = await tempRoot("patchmill-install-repo-");

  const result = await installProjectSkills({
    repoRoot,
    installedAt: "2026-06-13T00:00:00.000Z",
  });

  assert.equal(
    result.installedSkills.includes(
      ".patchmill/skills/patchmill-visual-evidence",
    ),
    true,
  );
  const skill = await readFile(
    join(
      repoRoot,
      ".patchmill",
      "skills",
      "patchmill-visual-evidence",
      "SKILL.md",
    ),
    "utf8",
  );
  assert.match(skill, /^---\nname: patchmill-visual-evidence\n/mu);
  assert.match(skill, /final `pr-created` JSON/u);
  assert.match(skill, /"visualEvidence"/u);
  assert.doesNotMatch(skill, /Forgejo|Gitea|tea|Nix|nix/u);
  const script = await readFile(
    join(
      repoRoot,
      ".patchmill",
      "skills",
      "patchmill-visual-evidence",
      "scripts",
      "capture-visual-evidence.cjs",
    ),
    "utf8",
  );
  assert.match(script, /@playwright\/test/u);
  assert.doesNotMatch(
    script,
    /NODE_PATH|command -v playwright|PLAYWRIGHT_BROWSERS_PATH|Nix|nix/u,
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
  await writeSkill(
    repoRoot,
    "project-skills/patchmill-planning",
    patchmillPlanningSkill,
  );
  await writeSkill(
    repoRoot,
    "project-skills/brainstorming",
    brainstormingSkill,
  );
  await writeSkill(repoRoot, "project-skills/writing-plans", planningSkill);
  await writeValidationWrapperPathModeDependencies(repoRoot, "project-skills");
  await writeSkill(
    repoRoot,
    "project-skills/patchmill-visual-evidence",
    `---
name: patchmill-visual-evidence
description: Capture visual evidence.
---
# Visual Evidence
`,
    { "scripts/capture-visual-evidence.cjs": "#!/usr/bin/env node\n" },
  );

  assert.deepEqual(
    await validateExistingSkillDirectory(repoRoot, "project-skills"),
    buildRecommendedProjectSkillConfig("project-skills"),
  );
});

test("validateExistingSkillDirectory fails when validation wrapper runtime dependencies are missing", async () => {
  for (const { omit, expectedPath } of [
    {
      omit: "subagent-driven-development",
      expectedPath: "project-skills/subagent-driven-development/SKILL.md",
    },
    {
      omit: "prompts/final-validation-review.md",
      expectedPath:
        "project-skills/subagent-dev-with-codex-and-thermo-reviews/prompts/final-validation-review.md",
    },
    {
      omit: "prompts/fix-review-findings.md",
      expectedPath:
        "project-skills/subagent-dev-with-codex-and-thermo-reviews/prompts/fix-review-findings.md",
    },
    {
      omit: "prompts/fix-pr-checks.md",
      expectedPath:
        "project-skills/subagent-dev-with-codex-and-thermo-reviews/prompts/fix-pr-checks.md",
    },
  ]) {
    const repoRoot = await tempRoot("patchmill-install-repo-");
    await writeSkill(
      repoRoot,
      "project-skills/patchmill-issue-triage",
      triageSkill,
    );
    await writeSkill(
      repoRoot,
      "project-skills/patchmill-planning",
      patchmillPlanningSkill,
    );
    await writeSkill(
      repoRoot,
      "project-skills/brainstorming",
      brainstormingSkill,
    );
    await writeSkill(repoRoot, "project-skills/writing-plans", planningSkill);
    await writeValidationWrapperPathModeDependencies(
      repoRoot,
      "project-skills",
      {
        omit,
      },
    );
    await writeSkill(
      repoRoot,
      "project-skills/patchmill-visual-evidence",
      `---
name: patchmill-visual-evidence
description: Capture visual evidence.
---
# Visual Evidence
`,
      { "scripts/capture-visual-evidence.cjs": "#!/usr/bin/env node\n" },
    );

    await assert.rejects(
      validateExistingSkillDirectory(repoRoot, "project-skills"),
      new RegExp(
        `Missing required skill file: ${expectedPath.replaceAll("/", "\\/")}`,
      ),
    );
  }
});

test("validateExistingSkillDirectory fails when visual evidence helper script is missing", async () => {
  const repoRoot = await tempRoot("patchmill-install-repo-");
  await writeSkill(
    repoRoot,
    "project-skills/patchmill-issue-triage",
    triageSkill,
  );
  await writeSkill(
    repoRoot,
    "project-skills/patchmill-planning",
    patchmillPlanningSkill,
  );
  await writeSkill(
    repoRoot,
    "project-skills/brainstorming",
    brainstormingSkill,
  );
  await writeSkill(repoRoot, "project-skills/writing-plans", planningSkill);
  await writeSkill(
    repoRoot,
    "project-skills/subagent-driven-development",
    implementationSkill,
  );
  await writeSkill(
    repoRoot,
    "project-skills/patchmill-visual-evidence",
    `---
name: patchmill-visual-evidence
description: Capture visual evidence.
---
# Visual Evidence
`,
  );

  await assert.rejects(
    validateExistingSkillDirectory(repoRoot, "project-skills"),
    /Missing required skill file: project-skills\/patchmill-visual-evidence\/scripts\/capture-visual-evidence\.cjs/,
  );
});

test("validateExistingSkillDirectory fails when a required skill is missing", async () => {
  const repoRoot = await tempRoot("patchmill-install-repo-");
  await writeSkill(
    repoRoot,
    "project-skills/patchmill-planning",
    patchmillPlanningSkill,
  );

  await assert.rejects(
    validateExistingSkillDirectory(repoRoot, "project-skills"),
    /Missing required skill file: project-skills\/patchmill-issue-triage\/SKILL\.md/,
  );
});

test("validateExistingSkillDirectory fails when planning wrapper siblings are missing", async () => {
  const repoRoot = await tempRoot("patchmill-install-repo-");
  await writeSkill(
    repoRoot,
    "project-skills/patchmill-issue-triage",
    triageSkill,
  );
  await writeSkill(
    repoRoot,
    "project-skills/patchmill-planning",
    patchmillPlanningSkill,
  );
  await writeSkill(
    repoRoot,
    "project-skills/subagent-driven-development",
    implementationSkill,
  );
  await writeSkill(
    repoRoot,
    "project-skills/patchmill-visual-evidence",
    `---
name: patchmill-visual-evidence
description: Capture visual evidence.
---
# Visual Evidence
`,
    { "scripts/capture-visual-evidence.cjs": "#!/usr/bin/env node\n" },
  );

  await assert.rejects(
    validateExistingSkillDirectory(repoRoot, "project-skills"),
    /Missing required skill file: project-skills\/brainstorming\/SKILL\.md/,
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
  await writeSkill(
    repoRoot,
    "project-skills/patchmill-planning",
    patchmillPlanningSkill,
  );
  await writeSkill(
    repoRoot,
    "project-skills/subagent-driven-development",
    implementationSkill,
  );
  await writeSkill(
    repoRoot,
    "project-skills/patchmill-visual-evidence",
    `---
name: patchmill-visual-evidence
description: Capture visual evidence.
---
# Visual Evidence
`,
    { "scripts/capture-visual-evidence.cjs": "#!/usr/bin/env node\n" },
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
