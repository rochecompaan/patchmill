import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { buildRecommendedProjectSkillConfig } from "../../../workflow/skill-pack.ts";
import { validateExistingSkillDirectory } from "./skill-installer.ts";

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

const rawTaskImplementationFiles = {
  "implementer-prompt.md": "implement a task\n",
  "task-reviewer-prompt.md": "review a task\n",
  "scripts/review-package": "#!/usr/bin/env bash\n",
  "scripts/sdd-workspace": "#!/usr/bin/env bash\n",
  "scripts/task-brief": "#!/usr/bin/env bash\n",
};

const validationWrapperSharedPrompts = {
  "prompts/final-validation-review.md": "review final validation\n",
  "prompts/fix-pr-checks.md": "repair failed PR checks\n",
  "prompts/fix-review-findings.md": "fix validation findings\n",
};

async function writeBaseProjectLocalSkills(repoRoot: string): Promise<void> {
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
    "project-skills/patchmill-visual-evidence",
    `---
name: patchmill-visual-evidence
description: Capture visual evidence.
---
# Visual Evidence
`,
    { "scripts/capture-visual-evidence.cjs": "#!/usr/bin/env node\n" },
  );
}

async function writeValidationWrapperDependencies(
  root: string,
  skillDir: string,
  options: { executableTaskScripts?: boolean; omit?: string } = {},
): Promise<void> {
  if (options.omit !== "subagent-dev-with-validation-and-pr-checks/SKILL.md") {
    await writeSkill(
      root,
      `${skillDir}/subagent-dev-with-validation-and-pr-checks`,
      validationReadyImplementationSkill,
    );
  }

  const rawFiles = Object.fromEntries(
    Object.entries(rawTaskImplementationFiles).filter(
      ([path]) => `subagent-driven-development/${path}` !== options.omit,
    ),
  );
  if (options.omit !== "subagent-driven-development/SKILL.md") {
    await writeSkill(
      root,
      `${skillDir}/subagent-driven-development`,
      implementationSkill,
      rawFiles,
    );
    if (options.executableTaskScripts !== false) {
      for (const script of Object.keys(rawFiles).filter((path) =>
        path.startsWith("scripts/"),
      )) {
        await chmod(
          join(root, skillDir, "subagent-driven-development", script),
          0o755,
        );
      }
    }
  }

  const sharedPrompts = Object.fromEntries(
    Object.entries(validationWrapperSharedPrompts).filter(
      ([path]) =>
        `subagent-dev-with-codex-and-thermo-reviews/${path}` !== options.omit,
    ),
  );
  await writeSkill(
    root,
    `${skillDir}/subagent-dev-with-codex-and-thermo-reviews`,
    finalReviewedImplementationSkill,
    sharedPrompts,
  );
}

test("validateExistingSkillDirectory returns local config for path mode", async () => {
  const repoRoot = await tempRoot("patchmill-install-repo-");
  await writeBaseProjectLocalSkills(repoRoot);
  await writeValidationWrapperDependencies(repoRoot, "project-skills");

  assert.deepEqual(
    await validateExistingSkillDirectory(repoRoot, "project-skills"),
    buildRecommendedProjectSkillConfig("project-skills"),
  );
});

test("validateExistingSkillDirectory fails when validation wrapper runtime dependencies are missing", async () => {
  for (const missingPath of [
    "subagent-dev-with-validation-and-pr-checks/SKILL.md",
    "subagent-driven-development/SKILL.md",
    "subagent-driven-development/implementer-prompt.md",
    "subagent-driven-development/task-reviewer-prompt.md",
    "subagent-driven-development/scripts/review-package",
    "subagent-driven-development/scripts/sdd-workspace",
    "subagent-driven-development/scripts/task-brief",
    "subagent-dev-with-codex-and-thermo-reviews/prompts/final-validation-review.md",
    "subagent-dev-with-codex-and-thermo-reviews/prompts/fix-review-findings.md",
    "subagent-dev-with-codex-and-thermo-reviews/prompts/fix-pr-checks.md",
  ]) {
    const repoRoot = await tempRoot("patchmill-install-repo-");
    await writeBaseProjectLocalSkills(repoRoot);
    await writeValidationWrapperDependencies(repoRoot, "project-skills", {
      omit: missingPath,
    });

    await assert.rejects(
      validateExistingSkillDirectory(repoRoot, "project-skills"),
      new RegExp(
        `Missing required skill file: project-skills/${missingPath}`.replaceAll(
          "/",
          "\\/",
        ),
      ),
    );
  }
});

test("validateExistingSkillDirectory fails when task implementation scripts are not executable", async () => {
  const repoRoot = await tempRoot("patchmill-install-repo-");
  await writeBaseProjectLocalSkills(repoRoot);
  await writeValidationWrapperDependencies(repoRoot, "project-skills", {
    executableTaskScripts: false,
  });

  await assert.rejects(
    validateExistingSkillDirectory(repoRoot, "project-skills"),
    /Missing required executable skill file: project-skills\/subagent-driven-development\/scripts\/review-package/,
  );
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
  await writeValidationWrapperDependencies(repoRoot, "project-skills");
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
  await writeValidationWrapperDependencies(repoRoot, "project-skills");
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
  await writeValidationWrapperDependencies(repoRoot, "project-skills");
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
