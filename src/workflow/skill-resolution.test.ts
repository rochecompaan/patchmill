import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  BUNDLED_TRIAGE_SKILL_REFERENCE,
  GLOBAL_PATCHMILL_SKILLS,
} from "./skills.ts";
import {
  DEFAULT_PROJECT_SKILL_DIR,
  PATCHMILL_RECOMMENDED_SKILL_PACK,
  SKILL_PACK_METADATA_FILE,
  hashText,
  type SkillPackMetadataFile,
} from "./skill-pack.ts";
import {
  bundledTriageSkillPath,
  isNamespaceStyleSkill,
  isPathLikeSkill,
  resolveConfiguredSkillInvocation,
  resolvePathLikeSkillPath,
  skillInvocationArgs,
  skillInvocationPaths,
} from "./skill-resolution.ts";

async function tempRepo(): Promise<string> {
  return mkdtemp(join(tmpdir(), "patchmill-skill-resolution-"));
}

function skillDocument(name: string): string {
  return `---\nname: ${name}\ndescription: ${name} skill.\n---\n# ${name}\n`;
}

async function writeProjectLocalSkill(
  repoRoot: string,
  name: string,
): Promise<string> {
  const skillDir = join(repoRoot, DEFAULT_PROJECT_SKILL_DIR, name);
  await mkdir(skillDir, { recursive: true });
  const content = skillDocument(name);
  await writeFile(join(skillDir, "SKILL.md"), content);
  return content;
}

async function writeMetadata(
  repoRoot: string,
  files: SkillPackMetadataFile["files"],
): Promise<void> {
  await mkdir(join(repoRoot, DEFAULT_PROJECT_SKILL_DIR), { recursive: true });
  const metadata: SkillPackMetadataFile = {
    pack: {
      name: PATCHMILL_RECOMMENDED_SKILL_PACK.name,
      version: PATCHMILL_RECOMMENDED_SKILL_PACK.version,
      source: PATCHMILL_RECOMMENDED_SKILL_PACK.source,
    },
    installedAt: "2026-05-30T00:00:00.000Z",
    skillDir: DEFAULT_PROJECT_SKILL_DIR,
    metadataFile: SKILL_PACK_METADATA_FILE,
    files,
  };
  await writeFile(
    join(repoRoot, DEFAULT_PROJECT_SKILL_DIR, SKILL_PACK_METADATA_FILE),
    JSON.stringify(metadata),
  );
}

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
  assert.deepEqual(
    skillInvocationArgs(GLOBAL_PATCHMILL_SKILLS.triage, "/repo"),
    [],
  );
  assert.deepEqual(
    skillInvocationArgs(BUNDLED_TRIAGE_SKILL_REFERENCE, "/repo"),
    ["--skill", bundledTriageSkillPath()],
  );
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

test("resolvePathLikeSkillPath preserves configured SKILL.md file paths", async () => {
  const repoRoot = await tempRepo();

  assert.equal(
    resolvePathLikeSkillPath("project-skills/writing-plans/SKILL.md", repoRoot),
    join(repoRoot, "project-skills", "writing-plans", "SKILL.md"),
  );
  assert.equal(
    resolvePathLikeSkillPath("project-skills/writing-plans", repoRoot),
    join(repoRoot, "project-skills", "writing-plans", "SKILL.md"),
  );
  assert.equal(
    resolvePathLikeSkillPath(
      "C:\\repo\\skills\\writing-plans\\SKILL.md",
      repoRoot,
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
        BUNDLED_TRIAGE_SKILL_REFERENCE,
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

test("resolveConfiguredSkillInvocation expands a valid project-local pack exactly once", async () => {
  const repoRoot = await tempRepo();
  const triage = await writeProjectLocalSkill(
    repoRoot,
    "patchmill-issue-triage",
  );
  const planning = await writeProjectLocalSkill(repoRoot, "writing-plans");
  const implementation = await writeProjectLocalSkill(
    repoRoot,
    "subagent-driven-development",
  );
  await writeMetadata(repoRoot, [
    {
      path: `${DEFAULT_PROJECT_SKILL_DIR}/patchmill-issue-triage/SKILL.md`,
      sha256: hashText(triage),
    },
    {
      path: `${DEFAULT_PROJECT_SKILL_DIR}/writing-plans/SKILL.md`,
      sha256: hashText(planning),
    },
    {
      path: `${DEFAULT_PROJECT_SKILL_DIR}/subagent-driven-development/SKILL.md`,
      sha256: hashText(implementation),
    },
  ]);

  const result = resolveConfiguredSkillInvocation(
    [
      `${DEFAULT_PROJECT_SKILL_DIR}/writing-plans`,
      `${DEFAULT_PROJECT_SKILL_DIR}/subagent-driven-development`,
    ],
    repoRoot,
  );

  assert.deepEqual(result.paths, [
    join(
      repoRoot,
      DEFAULT_PROJECT_SKILL_DIR,
      "patchmill-issue-triage",
      "SKILL.md",
    ),
    join(repoRoot, DEFAULT_PROJECT_SKILL_DIR, "writing-plans", "SKILL.md"),
    join(
      repoRoot,
      DEFAULT_PROJECT_SKILL_DIR,
      "subagent-driven-development",
      "SKILL.md",
    ),
  ]);
  assert.equal(result.usedProjectLocalPack, true);
  assert.deepEqual(result.configuredProjectLocalPaths, [
    join(repoRoot, DEFAULT_PROJECT_SKILL_DIR, "writing-plans", "SKILL.md"),
    join(
      repoRoot,
      DEFAULT_PROJECT_SKILL_DIR,
      "subagent-driven-development",
      "SKILL.md",
    ),
  ]);
  assert.deepEqual(
    result.diagnostics.map((entry) => entry.status),
    ["pass"],
  );
});

test("resolveConfiguredSkillInvocation uses configured paths only when metadata is missing", async () => {
  const repoRoot = await tempRepo();
  await writeProjectLocalSkill(repoRoot, "writing-plans");
  await writeProjectLocalSkill(repoRoot, "subagent-driven-development");

  const result = resolveConfiguredSkillInvocation(
    [
      `${DEFAULT_PROJECT_SKILL_DIR}/writing-plans`,
      `${DEFAULT_PROJECT_SKILL_DIR}/subagent-driven-development`,
    ],
    repoRoot,
  );

  assert.deepEqual(result.paths, [
    join(repoRoot, DEFAULT_PROJECT_SKILL_DIR, "writing-plans", "SKILL.md"),
    join(
      repoRoot,
      DEFAULT_PROJECT_SKILL_DIR,
      "subagent-driven-development",
      "SKILL.md",
    ),
  ]);
  assert.deepEqual(result.diagnostics, [
    {
      status: "warn",
      summary:
        "project-local skill pack metadata missing; using configured project-local skill paths only",
    },
  ]);
});

test("resolveConfiguredSkillInvocation preserves mixed configured ordering when metadata is missing", async () => {
  const repoRoot = await tempRepo();
  await writeProjectLocalSkill(repoRoot, "subagent-driven-development");

  const result = resolveConfiguredSkillInvocation(
    [
      "skills/toolchain",
      `${DEFAULT_PROJECT_SKILL_DIR}/subagent-driven-development`,
    ],
    repoRoot,
  );

  assert.deepEqual(result.paths, [
    join(repoRoot, "skills", "toolchain", "SKILL.md"),
    join(
      repoRoot,
      DEFAULT_PROJECT_SKILL_DIR,
      "subagent-driven-development",
      "SKILL.md",
    ),
  ]);
  assert.deepEqual(result.diagnostics, [
    {
      status: "warn",
      summary:
        "project-local skill pack metadata missing; using configured project-local skill paths only",
    },
  ]);
  assert.equal(result.usedProjectLocalPack, true);
});

test("resolveConfiguredSkillInvocation treats unsafe metadata paths as malformed", async () => {
  const repoRoot = await tempRepo();
  await writeProjectLocalSkill(repoRoot, "subagent-driven-development");
  await writeProjectLocalSkill(repoRoot, "requesting-code-review");
  await writeMetadata(repoRoot, [
    {
      path: `${DEFAULT_PROJECT_SKILL_DIR}/../other/SKILL.md`,
      sha256: "escaped",
    },
  ]);

  const result = resolveConfiguredSkillInvocation(
    [`${DEFAULT_PROJECT_SKILL_DIR}/subagent-driven-development`],
    repoRoot,
  );

  assert.deepEqual(result.paths, [
    join(
      repoRoot,
      DEFAULT_PROJECT_SKILL_DIR,
      "subagent-driven-development",
      "SKILL.md",
    ),
  ]);
  assert.deepEqual(result.diagnostics, [
    {
      status: "warn",
      summary:
        "project-local skill pack metadata malformed; using configured project-local skill paths only",
    },
  ]);
});

test("resolveConfiguredSkillInvocation uses configured paths only when metadata is malformed", async () => {
  const repoRoot = await tempRepo();
  await writeProjectLocalSkill(repoRoot, "writing-plans");
  await mkdir(join(repoRoot, DEFAULT_PROJECT_SKILL_DIR), { recursive: true });
  await writeFile(
    join(repoRoot, DEFAULT_PROJECT_SKILL_DIR, SKILL_PACK_METADATA_FILE),
    "{ malformed json",
  );

  const result = resolveConfiguredSkillInvocation(
    [`${DEFAULT_PROJECT_SKILL_DIR}/writing-plans`],
    repoRoot,
  );

  assert.deepEqual(result.paths, [
    join(repoRoot, DEFAULT_PROJECT_SKILL_DIR, "writing-plans", "SKILL.md"),
  ]);
  assert.equal(result.diagnostics[0]?.status, "warn");
  assert.match(
    result.diagnostics[0]?.summary ?? "",
    /project-local skill pack metadata malformed; using configured project-local skill paths only/,
  );
});

test("resolveConfiguredSkillInvocation preserves mixed configured ordering when metadata is malformed", async () => {
  const repoRoot = await tempRepo();
  await writeProjectLocalSkill(repoRoot, "subagent-driven-development");
  await mkdir(join(repoRoot, DEFAULT_PROJECT_SKILL_DIR), { recursive: true });
  await writeFile(
    join(repoRoot, DEFAULT_PROJECT_SKILL_DIR, SKILL_PACK_METADATA_FILE),
    "{ malformed json",
  );

  const result = resolveConfiguredSkillInvocation(
    [
      "skills/toolchain",
      `${DEFAULT_PROJECT_SKILL_DIR}/subagent-driven-development`,
    ],
    repoRoot,
  );

  assert.deepEqual(result.paths, [
    join(repoRoot, "skills", "toolchain", "SKILL.md"),
    join(
      repoRoot,
      DEFAULT_PROJECT_SKILL_DIR,
      "subagent-driven-development",
      "SKILL.md",
    ),
  ]);
  assert.equal(result.diagnostics[0]?.status, "warn");
  assert.match(
    result.diagnostics[0]?.summary ?? "",
    /project-local skill pack metadata malformed; using configured project-local skill paths only/,
  );
  assert.equal(result.usedProjectLocalPack, true);
});

test("resolveConfiguredSkillInvocation reports customized project-local pack files", async () => {
  const repoRoot = await tempRepo();
  const planning = await writeProjectLocalSkill(repoRoot, "writing-plans");
  await writeMetadata(repoRoot, [
    {
      path: `${DEFAULT_PROJECT_SKILL_DIR}/writing-plans/SKILL.md`,
      sha256: hashText(planning),
    },
  ]);
  await writeFile(
    join(repoRoot, DEFAULT_PROJECT_SKILL_DIR, "writing-plans", "SKILL.md"),
    skillDocument("writing-plans") + "\n# local customization\n",
  );

  const result = resolveConfiguredSkillInvocation(
    [`${DEFAULT_PROJECT_SKILL_DIR}/writing-plans`],
    repoRoot,
  );

  assert.deepEqual(
    result.diagnostics.map((entry) => entry.status),
    ["pass", "warn"],
  );
  assert.equal(
    result.diagnostics[0]?.summary,
    "project-local metadata verified",
  );
  assert.match(
    result.diagnostics[1]?.summary ?? "",
    /project-local skill pack customized from installed pack/,
  );
});

test("resolveConfiguredSkillInvocation ignores unused project-local directories and metadata", async () => {
  const repoRoot = await tempRepo();
  await writeProjectLocalSkill(repoRoot, "stale-unused-skill");
  await mkdir(join(repoRoot, DEFAULT_PROJECT_SKILL_DIR), { recursive: true });
  await writeFile(
    join(repoRoot, DEFAULT_PROJECT_SKILL_DIR, SKILL_PACK_METADATA_FILE),
    "{ malformed json",
  );

  const result = resolveConfiguredSkillInvocation(
    ["superpowers:writing-plans", "superpowers:subagent-driven-development"],
    repoRoot,
  );

  assert.deepEqual(result.paths, []);
  assert.deepEqual(result.diagnostics, []);
  assert.equal(result.usedProjectLocalPack, false);
  assert.deepEqual(result.configuredProjectLocalPaths, []);
});

test("resolveConfiguredSkillInvocation separates bundled fallback from global triage", async () => {
  const repoRoot = await tempRepo();

  assert.equal(
    resolveConfiguredSkillInvocation([BUNDLED_TRIAGE_SKILL_REFERENCE], repoRoot)
      .paths.length,
    1,
  );
  assert.deepEqual(
    resolveConfiguredSkillInvocation([GLOBAL_PATCHMILL_SKILLS.triage], repoRoot)
      .paths,
    [],
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
