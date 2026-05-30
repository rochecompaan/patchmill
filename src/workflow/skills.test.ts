import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  DEFAULT_PATCHMILL_SKILLS,
  cloneSkillsConfig,
  mergeSkillsConfig,
  renderConfiguredSkillLine,
  bundledTriageSkillPath,
  isNamespaceStyleSkill,
  isPathLikeSkill,
  resolvePathLikeSkillPath,
  skillInvocationArgs,
  skillInvocationPaths,
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

test("isNamespaceStyleSkill recognizes namespace-style skills only", () => {
  assert.equal(isNamespaceStyleSkill("superpowers:writing-plans"), true);
  assert.equal(isNamespaceStyleSkill("writing-plans"), false);
  assert.equal(isNamespaceStyleSkill("C:\\repo\\skills\\writing-plans"), false);
});

test("isPathLikeSkill recognizes relative and absolute local skill paths", () => {
  assert.equal(isPathLikeSkill(".patchmill/skills/writing-plans"), true);
  assert.equal(isPathLikeSkill("skills\\writing-plans"), true);
  assert.equal(isPathLikeSkill("/repo/skills/writing-plans"), true);
  assert.equal(isPathLikeSkill("C:\\repo\\skills\\writing-plans"), true);
  assert.equal(isPathLikeSkill("superpowers:writing-plans"), false);
  assert.equal(isPathLikeSkill("writing-plans"), false);
});

test("skillInvocationArgs resolves bundled, local, and named skills", () => {
  assert.deepEqual(skillInvocationArgs(undefined, "/repo"), []);
  assert.deepEqual(skillInvocationArgs("writing-plans", "/repo"), []);
  assert.deepEqual(skillInvocationArgs("patchmill-issue-triage", "/repo"), [
    "--skill",
    bundledTriageSkillPath(),
  ]);
  assert.deepEqual(
    skillInvocationArgs(".patchmill/skills/writing-plans", "/repo"),
    ["--skill", "/repo/.patchmill/skills/writing-plans/SKILL.md"],
  );
  assert.deepEqual(skillInvocationArgs("skills\\writing-plans", "/repo"), [
    "--skill",
    "/repo/skills/writing-plans/SKILL.md",
  ]);
  assert.deepEqual(skillInvocationArgs("/repo/skills/writing-plans", "/repo"), [
    "--skill",
    "/repo/skills/writing-plans/SKILL.md",
  ]);
  assert.deepEqual(
    skillInvocationArgs("C:\\repo\\skills\\writing-plans", "/repo"),
    ["--skill", "C:\\repo\\skills\\writing-plans\\SKILL.md"],
  );
  assert.deepEqual(
    skillInvocationArgs("./skills/writing-plans/SKILL.md", "/repo"),
    ["--skill", "/repo/skills/writing-plans/SKILL.md"],
  );
  assert.deepEqual(
    skillInvocationArgs("/repo/skills/writing-plans/SKILL.md", "/repo"),
    ["--skill", "/repo/skills/writing-plans/SKILL.md"],
  );
  assert.deepEqual(
    skillInvocationArgs("C:\\repo\\skills\\writing-plans\\SKILL.md", "/repo"),
    ["--skill", "C:\\repo\\skills\\writing-plans\\SKILL.md"],
  );
});

test("resolvePathLikeSkillPath preserves configured SKILL.md file paths", () => {
  assert.equal(
    resolvePathLikeSkillPath("./skills/writing-plans/SKILL.md", "/repo"),
    "/repo/skills/writing-plans/SKILL.md",
  );
  assert.equal(
    resolvePathLikeSkillPath("/repo/skills/writing-plans/SKILL.md", "/repo"),
    "/repo/skills/writing-plans/SKILL.md",
  );
  assert.equal(
    resolvePathLikeSkillPath(
      "C:\\repo\\skills\\writing-plans\\SKILL.md",
      "/repo",
    ),
    "C:\\repo\\skills\\writing-plans\\SKILL.md",
  );
});

test("skillInvocationPaths keeps only invokable skill paths in order", () => {
  assert.deepEqual(
    skillInvocationPaths(
      [
        ".patchmill/skills/writing-plans",
        "superpowers:writing-plans",
        undefined,
        "patchmill-issue-triage",
        "skills\\implementation",
      ],
      "/repo",
    ),
    [
      "/repo/.patchmill/skills/writing-plans/SKILL.md",
      bundledTriageSkillPath(),
      "/repo/skills/implementation/SKILL.md",
    ],
  );
});

test("skillInvocationPaths expands project-local pack skills from metadata", async () => {
  const repoRoot = await mkdtemp(join(tmpdir(), "patchmill-skills-metadata-"));
  const projectSkillsRoot = join(repoRoot, ".patchmill", "skills");
  await mkdir(join(projectSkillsRoot, "subagent-driven-development"), {
    recursive: true,
  });
  await mkdir(join(projectSkillsRoot, "requesting-code-review"), {
    recursive: true,
  });
  await writeFile(
    join(projectSkillsRoot, "subagent-driven-development", "SKILL.md"),
    "# implementation\n",
  );
  await writeFile(
    join(projectSkillsRoot, "requesting-code-review", "SKILL.md"),
    "# review\n",
  );
  await writeFile(
    join(projectSkillsRoot, "patchmill-skill-pack.json"),
    JSON.stringify({
      files: [
        {
          path: ".patchmill/skills/subagent-driven-development/SKILL.md",
          sha256: "impl",
        },
        {
          path: ".patchmill/skills/requesting-code-review/SKILL.md",
          sha256: "review",
        },
        {
          path: ".patchmill/skills/subagent-driven-development/README.md",
          sha256: "docs",
        },
      ],
    }),
  );

  assert.deepEqual(
    skillInvocationPaths(
      [".patchmill/skills/subagent-driven-development"],
      repoRoot,
    ),
    [
      join(
        repoRoot,
        ".patchmill",
        "skills",
        "subagent-driven-development",
        "SKILL.md",
      ),
      join(
        repoRoot,
        ".patchmill",
        "skills",
        "requesting-code-review",
        "SKILL.md",
      ),
    ],
  );
});

test("skillInvocationPaths rejects metadata skill paths outside project-local skills", async () => {
  const repoRoot = await mkdtemp(
    join(tmpdir(), "patchmill-skills-metadata-traversal-"),
  );
  const projectSkillsRoot = join(repoRoot, ".patchmill", "skills");
  await mkdir(join(projectSkillsRoot, "subagent-driven-development"), {
    recursive: true,
  });
  await mkdir(join(projectSkillsRoot, "requesting-code-review"), {
    recursive: true,
  });
  await writeFile(
    join(projectSkillsRoot, "subagent-driven-development", "SKILL.md"),
    "# implementation\n",
  );
  await writeFile(
    join(projectSkillsRoot, "requesting-code-review", "SKILL.md"),
    "# review\n",
  );
  await writeFile(
    join(projectSkillsRoot, "patchmill-skill-pack.json"),
    JSON.stringify({
      files: [
        {
          path: ".patchmill/skills/../other/SKILL.md",
          sha256: "escaped",
        },
      ],
    }),
  );

  assert.deepEqual(
    skillInvocationPaths(
      [".patchmill/skills/subagent-driven-development"],
      repoRoot,
    ),
    [
      join(
        repoRoot,
        ".patchmill",
        "skills",
        "subagent-driven-development",
        "SKILL.md",
      ),
    ],
  );
});

test("skillInvocationPaths fails fast when project-local metadata is malformed", async () => {
  const repoRoot = await mkdtemp(
    join(tmpdir(), "patchmill-skills-malformed-metadata-"),
  );
  const projectSkillsRoot = join(repoRoot, ".patchmill", "skills");
  await mkdir(join(projectSkillsRoot, "subagent-driven-development"), {
    recursive: true,
  });
  await mkdir(join(projectSkillsRoot, "test-driven-development"), {
    recursive: true,
  });
  await writeFile(
    join(projectSkillsRoot, "subagent-driven-development", "SKILL.md"),
    "# implementation\n",
  );
  await writeFile(
    join(projectSkillsRoot, "test-driven-development", "SKILL.md"),
    "# tests\n",
  );
  await writeFile(join(projectSkillsRoot, "patchmill-skill-pack.json"), "{");

  assert.throws(
    () =>
      skillInvocationPaths(
        [".patchmill/skills/subagent-driven-development"],
        repoRoot,
      ),
    /project-local skill pack metadata malformed/u,
  );
});

test("skillInvocationPaths discovers project-local pack skills when metadata is missing", async () => {
  const repoRoot = await mkdtemp(join(tmpdir(), "patchmill-skills-discovery-"));
  const projectSkillsRoot = join(repoRoot, ".patchmill", "skills");
  await mkdir(join(projectSkillsRoot, "subagent-driven-development"), {
    recursive: true,
  });
  await mkdir(join(projectSkillsRoot, "test-driven-development"), {
    recursive: true,
  });
  await writeFile(
    join(projectSkillsRoot, "subagent-driven-development", "SKILL.md"),
    "# implementation\n",
  );
  await writeFile(
    join(projectSkillsRoot, "test-driven-development", "SKILL.md"),
    "# tests\n",
  );

  assert.deepEqual(
    skillInvocationPaths(
      [".patchmill/skills/subagent-driven-development"],
      repoRoot,
    ),
    [
      join(
        repoRoot,
        ".patchmill",
        "skills",
        "subagent-driven-development",
        "SKILL.md",
      ),
      join(
        repoRoot,
        ".patchmill",
        "skills",
        "test-driven-development",
        "SKILL.md",
      ),
    ],
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
