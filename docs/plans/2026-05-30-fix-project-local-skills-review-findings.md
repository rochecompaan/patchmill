# Fix Project-local Skills Review Findings Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the structural review findings in the project-local default skills
branch so runtime, doctor, init, and docs share one coherent skill-resolution
model.

**Architecture:** Move project-local skill-pack resolution into one canonical
workflow module that both runtime invocation and doctor validation consume. Make
init installation atomic by staging the full skill pack before publishing it,
and separate bundled fallback triage from user-global skill names so config
strings no longer carry two meanings.

**Tech Stack:** TypeScript ESM, Node built-ins (`node:test`, `fs/promises`,
`fs`, `crypto`, `path`, `os`), existing Patchmill CLI modules, existing
`CommandRunner`, npm lockfiles.

---

## File structure

Create:

- `src/workflow/skill-resolution.ts` — canonical configured-skill and
  project-local pack resolver. Owns path-like skill detection, local path
  resolution, metadata parsing, metadata path safety, hash/customization checks,
  exact Pi invocation path calculation, and non-fatal diagnostics. This is the
  only module allowed to parse project-local skill-pack metadata or metadata
  file paths.
- `src/workflow/skill-resolution.test.ts` — unit tests for runtime/doctor shared
  resolution semantics.

Modify:

- `src/workflow/skills.ts` — keep skill config constants and presentation
  helpers; delete duplicated invocation/path/metadata resolution and re-export
  the new functions for compatibility.
- `src/workflow/skills.test.ts` — remove or migrate resolver-specific tests to
  `skill-resolution.test.ts`; keep config merge/render tests.
- `src/cli/commands/doctor/checks.ts` — consume the shared resolver,
  validate/smoke-test exact resolved paths, and gate `.patchmill/skills` checks
  on configured project-local usage. It must not parse project-local skill-pack
  metadata JSON, metadata file paths, or metadata hashes directly.
- `src/cli/commands/doctor/checks.test.ts` — add regression tests for unused
  local packs, malformed metadata, and exact smoke paths.
- `src/cli/commands/init/main.ts` — use a distinct global skill mapping for
  `--skills global`.
- `src/cli/commands/init/main.test.ts` — cover that global init writes the
  non-bundled global triage name.
- `src/cli/commands/init/skill-installer.ts` — stage skill installation into a
  temporary directory and publish atomically.
- `src/cli/commands/init/skill-installer.test.ts` — cover rollback/no partial
  target publication when copy or metadata publication fails.
- `src/workflow/skill-pack.ts` — keep manifest/provenance source aligned with
  actual dependency source.
- `package.json`, `package-lock.json`, `npm-shrinkwrap.json` — ensure the
  selected `superpowers` source is installable and lockfiles are refreshed.
- `docs/plans/2026-05-29-project-local-default-skills.md` and
  `docs/specs/2026-05-29-project-local-default-skills-design.md` — align the
  historical plan/spec with the actual GitHub tarball dependency source, because
  `npm view superpowers versions` does not include `5.0.7`.

Do not modify:

- Host provider behavior.
- Triage state policy or label definitions.
- Pi prompt contract JSON shapes.

---

## Task 1: Add canonical skill-resolution tests

**Files:**

- Create: `src/workflow/skill-resolution.test.ts`
- Modify: `src/workflow/skills.test.ts`

- [ ] **Step 1: Create the failing shared resolver test file**

Create `src/workflow/skill-resolution.test.ts` with these tests:

```ts
import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
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
  resolveConfiguredSkillInvocation,
  resolvePathLikeSkillPath,
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
    result.diagnostics.map((entry) => entry.summary),
    [
      "project-local metadata verified",
      "project-local skill pack customized from installed pack",
    ],
  );
});

test("resolveConfiguredSkillInvocation ignores unused project-local directories", async () => {
  const repoRoot = await tempRepo();
  await writeProjectLocalSkill(repoRoot, "stale-unused-skill");

  const result = resolveConfiguredSkillInvocation(
    ["superpowers:writing-plans", "superpowers:subagent-driven-development"],
    repoRoot,
  );

  assert.deepEqual(result.paths, []);
  assert.deepEqual(result.diagnostics, []);
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
});
```

- [ ] **Step 2: Run the new test and verify it fails**

Run:

```bash
node --test src/workflow/skill-resolution.test.ts
```

Expected: FAIL with a module-not-found or missing-export error for
`./skill-resolution.ts`, `BUNDLED_TRIAGE_SKILL_REFERENCE`, or
`GLOBAL_PATCHMILL_SKILLS`.

- [ ] **Step 3: Remove duplicated resolver tests from `skills.test.ts` after the
      new module exists**

Do not delete config tests. Move resolver-focused expectations from
`src/workflow/skills.test.ts` into `src/workflow/skill-resolution.test.ts` after
Task 2 is complete. Keep tests for:

```ts
DEFAULT_PATCHMILL_SKILLS;
mergeSkillsConfig;
cloneSkillsConfig;
renderConfiguredSkillLine;
```

- [ ] **Step 4: Commit tests**

```bash
git add src/workflow/skill-resolution.test.ts src/workflow/skills.test.ts
git commit -m "test(skills): capture shared skill resolution semantics"
```

---

## Task 2: Implement the canonical shared resolver

**Files:**

- Create: `src/workflow/skill-resolution.ts`
- Modify: `src/workflow/skills.ts`
- Test: `src/workflow/skill-resolution.test.ts`

- [ ] **Step 1: Add explicit resolver result types**

Create `src/workflow/skill-resolution.ts` with the public result shape:

```ts
import { readFileSync, readdirSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, win32 } from "node:path";
import { fileURLToPath } from "node:url";
import {
  DEFAULT_PROJECT_SKILL_DIR,
  PATCHMILL_RECOMMENDED_SKILL_PACK,
  SKILL_PACK_METADATA_FILE,
  hashContent,
  type SkillPackMetadataFile,
} from "./skill-pack.ts";
import { BUNDLED_TRIAGE_SKILL_REFERENCE } from "./skills.ts";

export type SkillResolutionStatus = "pass" | "warn" | "fail";

export type SkillResolutionDiagnostic = {
  status: SkillResolutionStatus;
  summary: string;
};

export type SkillInvocationResolution = {
  paths: string[];
  diagnostics: SkillResolutionDiagnostic[];
  configuredProjectLocalPaths: string[];
  usedProjectLocalPack: boolean;
};

const WINDOWS_ABSOLUTE_PATH_PATTERN = /^[A-Za-z]:[\\/]/u;
const SKILL_NAMESPACE_PATTERN = /^[a-z0-9-]+:.+$/iu;
const SKILL_FILE_NAME = "SKILL.md";
```

- [ ] **Step 2: Move path-like helpers into the new module**

Add these helpers to `skill-resolution.ts`:

```ts
export function bundledTriageSkillPath(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  return join(here, "..", "..", "skills", "patchmill-issue-triage", "SKILL.md");
}

export function isNamespaceStyleSkill(skill: string): boolean {
  return (
    SKILL_NAMESPACE_PATTERN.test(skill) &&
    !WINDOWS_ABSOLUTE_PATH_PATTERN.test(skill)
  );
}

export function isPathLikeSkill(skill: string): boolean {
  if (
    skill.startsWith(".") ||
    skill.startsWith("/") ||
    WINDOWS_ABSOLUTE_PATH_PATTERN.test(skill)
  ) {
    return true;
  }

  return /[\\/]/u.test(skill) && !isNamespaceStyleSkill(skill);
}

function isSkillFilePath(skill: string): boolean {
  const normalizedPath = skill.replaceAll("\\", "/");
  return (
    normalizedPath === SKILL_FILE_NAME ||
    normalizedPath.endsWith(`/${SKILL_FILE_NAME}`)
  );
}

export function resolvePathLikeSkillPath(
  skill: string,
  repoRoot: string,
): string {
  if (WINDOWS_ABSOLUTE_PATH_PATTERN.test(skill)) {
    return isSkillFilePath(skill)
      ? win32.normalize(skill)
      : win32.join(skill, SKILL_FILE_NAME);
  }

  const normalizedPath = skill.replaceAll("\\", "/");
  if (isSkillFilePath(normalizedPath)) {
    return normalizedPath.startsWith("/")
      ? resolve(normalizedPath)
      : resolve(repoRoot, normalizedPath);
  }

  return normalizedPath.startsWith("/")
    ? resolve(normalizedPath, SKILL_FILE_NAME)
    : resolve(repoRoot, normalizedPath, SKILL_FILE_NAME);
}
```

- [ ] **Step 3: Add project-local metadata parsing with non-fatal diagnostics**

Add this implementation to `skill-resolution.ts`:

```ts
function pathStartsWith(path: string, prefix: string): boolean {
  return (
    path === prefix ||
    path.startsWith(`${prefix}/`) ||
    path.startsWith(`${prefix}\\`)
  );
}

function isPathInside(parent: string, child: string): boolean {
  const pathRelative = relative(parent, child);
  return (
    pathRelative === "" ||
    (!pathRelative.startsWith("..") && !isAbsolute(pathRelative))
  );
}

function resolveProjectLocalMetadataFilePath(
  filePath: string,
  repoRoot: string,
  projectLocalRoot: string,
): string | null {
  const normalizedPath = filePath.replaceAll("\\", "/");
  if (isAbsolute(normalizedPath) || win32.isAbsolute(filePath)) return null;
  if (!normalizedPath.startsWith(`${DEFAULT_PROJECT_SKILL_DIR}/`)) return null;

  const resolvedPath = resolve(repoRoot, normalizedPath);
  return isPathInside(projectLocalRoot, resolvedPath) ? resolvedPath : null;
}

function validMetadata(
  value: unknown,
  repoRoot: string,
  projectLocalRoot: string,
): value is SkillPackMetadataFile {
  if (!value || typeof value !== "object") return false;

  const candidate = value as Partial<SkillPackMetadataFile> & {
    pack?: { source?: Record<string, unknown> };
  };

  return (
    candidate.pack?.name === PATCHMILL_RECOMMENDED_SKILL_PACK.name &&
    candidate.pack.version === PATCHMILL_RECOMMENDED_SKILL_PACK.version &&
    candidate.pack.source?.type ===
      PATCHMILL_RECOMMENDED_SKILL_PACK.source.type &&
    candidate.pack.source?.repository ===
      PATCHMILL_RECOMMENDED_SKILL_PACK.source.repository &&
    candidate.pack.source?.tag ===
      PATCHMILL_RECOMMENDED_SKILL_PACK.source.tag &&
    candidate.pack.source?.tarballUrl ===
      PATCHMILL_RECOMMENDED_SKILL_PACK.source.tarballUrl &&
    typeof candidate.installedAt === "string" &&
    candidate.skillDir === DEFAULT_PROJECT_SKILL_DIR &&
    candidate.metadataFile === SKILL_PACK_METADATA_FILE &&
    Array.isArray(candidate.files) &&
    candidate.files.every(
      (file) =>
        file &&
        typeof file.path === "string" &&
        typeof file.sha256 === "string" &&
        resolveProjectLocalMetadataFilePath(
          file.path,
          repoRoot,
          projectLocalRoot,
        ) !== null,
    )
  );
}

function metadataSkillPaths(
  metadata: SkillPackMetadataFile,
  repoRoot: string,
  projectLocalRoot: string,
): string[] {
  return metadata.files
    .filter((file) => isSkillFilePath(file.path))
    .flatMap((file) => {
      const resolvedPath = resolveProjectLocalMetadataFilePath(
        file.path,
        repoRoot,
        projectLocalRoot,
      );
      return resolvedPath ? [resolvedPath] : [];
    });
}

function projectLocalPackResolution(
  repoRoot: string,
  configuredProjectLocalPaths: string[],
): { paths: string[]; diagnostics: SkillResolutionDiagnostic[] } {
  const projectLocalRoot = resolve(repoRoot, DEFAULT_PROJECT_SKILL_DIR);
  const metadataPath = join(projectLocalRoot, SKILL_PACK_METADATA_FILE);

  let metadataContent: string;
  try {
    metadataContent = readFileSync(metadataPath, "utf8");
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    return {
      paths: configuredProjectLocalPaths,
      diagnostics: [
        {
          status: "warn",
          summary:
            code === "ENOENT"
              ? "project-local skill pack metadata missing; using configured project-local skill paths only"
              : `project-local skill pack metadata unreadable; using configured project-local skill paths only: ${String(error)}`,
        },
      ],
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(metadataContent);
  } catch (error) {
    return {
      paths: configuredProjectLocalPaths,
      diagnostics: [
        {
          status: "warn",
          summary: `project-local skill pack metadata malformed; using configured project-local skill paths only: ${String(error)}`,
        },
      ],
    };
  }

  if (!validMetadata(parsed, repoRoot, projectLocalRoot)) {
    return {
      paths: configuredProjectLocalPaths,
      diagnostics: [
        {
          status: "warn",
          summary:
            "project-local skill pack metadata malformed; using configured project-local skill paths only",
        },
      ],
    };
  }

  return {
    paths: metadataSkillPaths(parsed, repoRoot, projectLocalRoot),
    diagnostics: [
      { status: "pass", summary: "project-local metadata verified" },
      ...projectLocalCustomizationDiagnostics(
        parsed,
        repoRoot,
        projectLocalRoot,
      ),
    ],
  };
}

function projectLocalCustomizationDiagnostics(
  metadata: SkillPackMetadataFile,
  repoRoot: string,
  projectLocalRoot: string,
): SkillResolutionDiagnostic[] {
  for (const file of metadata.files) {
    const resolvedPath = resolveProjectLocalMetadataFilePath(
      file.path,
      repoRoot,
      projectLocalRoot,
    );
    if (!resolvedPath) {
      return [
        {
          status: "warn",
          summary: "project-local skill pack customized from installed pack",
        },
      ];
    }

    try {
      if (hashContent(readFileSync(resolvedPath)) !== file.sha256) {
        return [
          {
            status: "warn",
            summary: "project-local skill pack customized from installed pack",
          },
        ];
      }
    } catch {
      return [
        {
          status: "warn",
          summary: "project-local skill pack customized from installed pack",
        },
      ];
    }
  }

  return [];
}
```

- [ ] **Step 4: Add the canonical invocation resolver**

Add this public function to `skill-resolution.ts`:

```ts
function unique(paths: string[]): string[] {
  const seen = new Set<string>();
  return paths.filter((path) => {
    if (seen.has(path)) return false;
    seen.add(path);
    return true;
  });
}

export function resolveConfiguredSkillInvocation(
  skills: Array<string | undefined>,
  repoRoot: string,
): SkillInvocationResolution {
  const diagnostics: SkillResolutionDiagnostic[] = [];
  const configuredPaths = skills.flatMap((skill) => {
    if (!skill) return [];
    if (skill === BUNDLED_TRIAGE_SKILL_REFERENCE)
      return [bundledTriageSkillPath()];
    if (!isPathLikeSkill(skill)) return [];
    return [resolvePathLikeSkillPath(skill, repoRoot)];
  });

  const projectLocalRoot = resolve(repoRoot, DEFAULT_PROJECT_SKILL_DIR);
  const configuredProjectLocalPaths = configuredPaths.filter((path) =>
    pathStartsWith(resolve(path), projectLocalRoot),
  );

  if (configuredProjectLocalPaths.length === 0) {
    return {
      paths: unique(configuredPaths),
      diagnostics,
      configuredProjectLocalPaths,
      usedProjectLocalPack: false,
    };
  }

  const pack = projectLocalPackResolution(
    repoRoot,
    configuredProjectLocalPaths,
  );
  diagnostics.push(...pack.diagnostics);

  return {
    paths: unique([...configuredPaths, ...pack.paths]),
    diagnostics,
    configuredProjectLocalPaths: unique(configuredProjectLocalPaths),
    usedProjectLocalPack: true,
  };
}

export function skillInvocationPaths(
  skills: Array<string | undefined>,
  repoRoot: string,
): string[] {
  return resolveConfiguredSkillInvocation(skills, repoRoot).paths;
}

export function skillInvocationArgs(
  skill: string | undefined,
  repoRoot: string,
): string[] {
  return skillInvocationPaths([skill], repoRoot).flatMap((path) => [
    "--skill",
    path,
  ]);
}
```

- [ ] **Step 5: Keep existing imports stable through `skills.ts` re-exports**

In `src/workflow/skills.ts`, remove the duplicated resolver implementation and
re-export resolver helpers:

```ts
export {
  bundledTriageSkillPath,
  isNamespaceStyleSkill,
  isPathLikeSkill,
  resolveConfiguredSkillInvocation,
  resolvePathLikeSkillPath,
  skillInvocationArgs,
  skillInvocationPaths,
  type SkillInvocationResolution,
  type SkillResolutionDiagnostic,
} from "./skill-resolution.ts";
```

- [ ] **Step 6: Add explicit bundled/global constants in `skills.ts`**

In `src/workflow/skills.ts`, define the bundled fallback separately from
user-global names:

```ts
export const BUNDLED_TRIAGE_SKILL_REFERENCE = "patchmill:bundled-issue-triage";

export const DEFAULT_PATCHMILL_SKILLS: PatchmillSkillsConfig = {
  triage: BUNDLED_TRIAGE_SKILL_REFERENCE,
  planning: "superpowers:writing-plans",
  implementation: "superpowers:subagent-driven-development",
};

export const GLOBAL_PATCHMILL_SKILLS: PatchmillSkillsConfig = {
  triage: "patchmill-issue-triage",
  planning: "superpowers:writing-plans",
  implementation: "superpowers:subagent-driven-development",
};
```

- [ ] **Step 7: Run resolver tests**

Run:

```bash
node --test src/workflow/skill-resolution.test.ts src/workflow/skills.test.ts
```

Expected: PASS.

- [ ] **Step 8: Commit resolver implementation**

```bash
git add src/workflow/skill-resolution.ts src/workflow/skills.ts src/workflow/skill-resolution.test.ts src/workflow/skills.test.ts
git commit -m "fix(skills): share runtime skill resolution semantics"
```

---

## Task 3: Make doctor consume the shared resolver and ignore unused local packs

**Files:**

- Modify: `src/cli/commands/doctor/checks.ts`
- Modify: `src/cli/commands/doctor/checks.test.ts`
- Test: `src/cli/commands/doctor/checks.test.ts`

- [ ] **Step 1: Add failing doctor regression tests**

Add these tests to `src/cli/commands/doctor/checks.test.ts` near the existing
project-local skill tests:

```ts
test("runDoctorChecks ignores unused .patchmill skills when config uses global skills", async () => {
  const repoRoot = await tempRepo();
  await writeConfig(repoRoot, {
    host: { provider: "forgejo-tea", login: "triage-agent" },
    skills: {
      triage: "patchmill-issue-triage",
      planning: "superpowers:writing-plans",
      implementation: "superpowers:subagent-driven-development",
    },
  });
  await mkdir(join(repoRoot, "docs"), { recursive: true });
  await writeProjectLocalSkill(
    repoRoot,
    "stale-unused-skill",
    "not a valid skill document\n",
  );

  const runner = runnerFrom(successMocks(REQUIRED_LABELS));

  const results = await runDoctorChecks(runner, {
    repoRoot,
    teaRepoRootForTests: "/repo",
  });
  const skills = results.find((result) => result.name === "skills");

  assert.equal(skills?.status, "warn");
  assert.match(
    skills?.message ?? "",
    /triage: `patchmill-issue-triage` \(named skill configured; doctor did not verify it\)/,
  );
  assert.doesNotMatch(skills?.message ?? "", /stale-unused-skill/);
  assert.doesNotMatch(
    skills?.message ?? "",
    /project-local skill pack metadata/,
  );
});

test("runDoctorChecks smoke-tests the exact shared resolver paths when metadata is malformed", async () => {
  const repoRoot = await tempRepo();
  const planningSkill = skillDocument("writing-plans", "Write plans.");

  await writeConfig(repoRoot, {
    host: { provider: "forgejo-tea", login: "triage-agent" },
    skills: {
      planning: `${DEFAULT_PROJECT_SKILL_DIR}/writing-plans`,
    },
  });
  await mkdir(join(repoRoot, "docs"), { recursive: true });
  await writeProjectLocalSkill(repoRoot, "writing-plans", planningSkill);
  await mkdir(join(repoRoot, DEFAULT_PROJECT_SKILL_DIR), { recursive: true });
  await writeFile(
    join(repoRoot, DEFAULT_PROJECT_SKILL_DIR, SKILL_PACK_METADATA_FILE),
    "{ malformed json",
  );

  const smokePaths = [projectLocalSkillPath(repoRoot, "writing-plans")];
  const runner = runnerFrom(
    successMocks(REQUIRED_LABELS, {
      "git check-ignore --no-index -q .patchmill/skills": { code: 1 },
      [projectLocalPiSmokeCommand(smokePaths)]: {
        code: 0,
        stdout: "PATCHMILL_SKILLS_OK\n",
      },
    }),
  );

  const results = await runDoctorChecks(runner, {
    repoRoot,
    teaRepoRootForTests: "/repo",
  });
  const skills = results.find((result) => result.name === "skills");

  assert.equal(skills?.status, "warn");
  assert.match(skills?.message ?? "", /metadata malformed/);
  assert.match(skills?.message ?? "", /Pi loaded project-local skill pack/);
});
```

- [ ] **Step 2: Run doctor tests and verify they fail**

Run:

```bash
node --test src/cli/commands/doctor/checks.test.ts
```

Expected: FAIL because doctor still validates any readable `.patchmill/skills`
directory and still owns metadata parsing itself.

- [ ] **Step 3: Replace doctor metadata resolution with shared resolver output**

In `src/cli/commands/doctor/checks.ts`, import the resolver:

```ts
import {
  resolveConfiguredSkillInvocation,
  resolvePathLikeSkillPath,
  isPathLikeSkill,
} from "../../../workflow/skills.ts";
```

Then change `checkSkills` so it computes the shared resolution once:

```ts
const configuredSkillValues = PATCHMILL_SKILL_KEYS.flatMap((key) => {
  const skill = config.skills[key];
  return skill ? [skill] : [];
});
const resolution = resolveConfiguredSkillInvocation(
  configuredSkillValues,
  repoRoot,
);
```

Keep per-configured-skill shape validation for path-like skills, but remove
doctor-owned metadata parsing as the source of smoke paths. Use:

```ts
entries.push(...resolution.diagnostics);

if (resolution.usedProjectLocalPack) {
  entries.push(await checkProjectLocalGitIgnore(runner, repoRoot));

  if (
    !entries.some((entry) => entry.status === "fail") &&
    resolution.paths.length > 0
  ) {
    entries.push(
      await smokeTestProjectLocalSkills(runner, repoRoot, resolution.paths),
    );
  }
}
```

Delete these doctor-local helpers after their logic moves to
`skill-resolution.ts`:

```ts
isValidProjectLocalMetadata;
metadataSkillPaths;
checkProjectLocalMetadata;
resolveProjectLocalMetadataFilePath;
```

Do not replace them with another doctor-local metadata parser.
`src/cli/commands/doctor/checks.ts` must not call `JSON.parse` on
`patchmill-skill-pack.json`, must not inspect `metadata.files`, must not resolve
metadata file paths, and must not compare metadata hashes directly.
Customized-pack warnings must arrive through `resolution.diagnostics` from
`resolveConfiguredSkillInvocation`.

- [ ] **Step 4: Add a no-duplication guard for doctor metadata parsing**

Add a targeted assertion or source scan to
`src/cli/commands/doctor/checks.test.ts` so future edits cannot reintroduce
metadata/path parsing into doctor. Use a test like:

```ts
test("doctor does not parse project-local skill-pack metadata directly", async () => {
  const source = await readFile(
    new URL("./checks.ts", import.meta.url),
    "utf8",
  );

  assert.doesNotMatch(source, /checkProjectLocalMetadata/);
  assert.doesNotMatch(source, /isValidProjectLocalMetadata/);
  assert.doesNotMatch(source, /metadataSkillPaths/);
  assert.doesNotMatch(source, /resolveProjectLocalMetadataFilePath/);
  assert.doesNotMatch(source, /metadata\.files/);
  assert.doesNotMatch(source, /JSON\.parse\([^\n]*patchmill-skill-pack/);
});
```

If the exact `JSON.parse` regex is too brittle because the filename is not on
the same line, use a simpler guard that forbids `SKILL_PACK_METADATA_FILE` and
`JSON.parse` appearing in the same helper block. The important invariant is
strict: doctor may read configured skill files for frontmatter and may format
resolver diagnostics, but only `src/workflow/skill-resolution.ts` may parse
project-local skill-pack metadata, metadata paths, or metadata hashes.

- [ ] **Step 5: Run doctor tests**

Run:

```bash
node --test src/cli/commands/doctor/checks.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit doctor integration**

```bash
git add src/cli/commands/doctor/checks.ts src/cli/commands/doctor/checks.test.ts
git commit -m "fix(doctor): validate resolved project-local skill paths"
```

---

## Task 4: Separate bundled fallback triage from global init config

**Files:**

- Modify: `src/cli/commands/init/main.ts`
- Modify: `src/cli/commands/init/main.test.ts`
- Modify: `src/workflow/skills.ts`
- Test: `src/cli/commands/init/main.test.ts`,
  `src/workflow/skill-resolution.test.ts`

- [ ] **Step 1: Update init to use global skill names for `--skills global`**

In `src/cli/commands/init/main.ts`, replace `DEFAULT_GLOBAL_SKILLS` with the
exported global mapping:

```ts
import { GLOBAL_PATCHMILL_SKILLS } from "../../../workflow/skills.ts";
```

Then set:

```ts
const DEFAULT_GLOBAL_SKILLS: InitialConfigSkills = {
  triage: GLOBAL_PATCHMILL_SKILLS.triage,
  planning: GLOBAL_PATCHMILL_SKILLS.planning,
  implementation: GLOBAL_PATCHMILL_SKILLS.implementation,
};
```

- [ ] **Step 2: Update the global init test expectation**

In `src/cli/commands/init/main.test.ts`, change `GLOBAL_SKILLS` to:

```ts
const GLOBAL_SKILLS = {
  triage: "patchmill-issue-triage",
  planning: "superpowers:writing-plans",
  implementation: "superpowers:subagent-driven-development",
};
```

Keep `PROJECT_LOCAL_SKILLS` unchanged.

- [ ] **Step 3: Run targeted init and resolver tests**

Run:

```bash
node --test src/cli/commands/init/main.test.ts src/workflow/skill-resolution.test.ts
```

Expected: PASS. The resolver test must prove `patchmill-issue-triage` no longer
maps to `--skill <bundled path>` while `patchmill:bundled-issue-triage` does.

- [ ] **Step 4: Commit global-mode fix**

```bash
git add src/cli/commands/init/main.ts src/cli/commands/init/main.test.ts src/workflow/skills.ts src/workflow/skill-resolution.test.ts
git commit -m "fix(init): distinguish global skills from bundled fallback"
```

---

## Task 5: Make project skill installation atomic

**Files:**

- Modify: `src/cli/commands/init/skill-installer.ts`
- Modify: `src/cli/commands/init/skill-installer.test.ts`
- Test: `src/cli/commands/init/skill-installer.test.ts`

- [ ] **Step 1: Add failing rollback tests**

Add this test to `src/cli/commands/init/skill-installer.test.ts` after the
existing preflight tests:

```ts
test("installProjectSkills does not publish partial targets when staging fails", async () => {
  const repoRoot = await tempRoot("patchmill-install-repo-");
  const patchmillSource = await tempRoot("patchmill-install-patchmill-");
  const superpowersSource = await tempRoot("patchmill-install-superpowers-");
  await writeSkill(patchmillSource, "patchmill-issue-triage", triageSkill);
  await writeSkill(superpowersSource, "writing-plans", planningSkill);
  await symlink(
    "missing-template.md",
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

  await assert.rejects(access(join(repoRoot, ".patchmill", "skills")));
});
```

Add this test to verify publication happens as a single directory publish:

```ts
test("installProjectSkills can rerun after a failed staged install", async () => {
  const repoRoot = await tempRoot("patchmill-install-repo-");
  const patchmillSource = await tempRoot("patchmill-install-patchmill-");
  const superpowersSource = await tempRoot("patchmill-install-superpowers-");
  await writeSkill(patchmillSource, "patchmill-issue-triage", triageSkill);
  await writeSkill(superpowersSource, "writing-plans", planningSkill);

  const result = await installProjectSkills({
    repoRoot,
    sourceRoots: {
      patchmillSkillsDir: patchmillSource,
      superpowersSkillsDir: superpowersSource,
    },
    packSkills: [
      { name: "patchmill-issue-triage", source: "patchmill" },
      { name: "writing-plans", source: "superpowers" },
    ],
    installedAt: "2026-05-30T00:00:00.000Z",
  });

  assert.equal(result.installedSkills.length, 2);
  await access(
    join(repoRoot, ".patchmill", "skills", SKILL_PACK_METADATA_FILE),
  );
});
```

- [ ] **Step 2: Run installer tests and verify the first new test fails if
      current copy order publishes partial data**

Run:

```bash
node --test src/cli/commands/init/skill-installer.test.ts
```

Expected before implementation: FAIL if `.patchmill/skills` is published before
the full staging operation completes.

- [ ] **Step 3: Stage the entire skill directory before publishing**

In `src/cli/commands/init/skill-installer.ts`, import staging helpers:

```ts
import { tmpdir } from "node:os";
import { basename } from "node:path";
import { mkdtemp, rename, rm } from "node:fs/promises";
```

Then change `installProjectSkills` after preflight planning to copy into a
temporary staging root first:

```ts
const stagingRoot = await mkdtemp(join(tmpdir(), "patchmill-skills-install-"));
const stagedSkillDir = join(stagingRoot, "skills");
let published = false;

try {
  for (const { sourceDir, targetRelativeDir } of installationPlan) {
    const stagedTarget = join(
      stagedSkillDir,
      relative(skillDir, targetRelativeDir),
    );
    await mkdir(dirname(stagedTarget), { recursive: true });
    await cp(sourceDir, stagedTarget, {
      recursive: true,
      errorOnExist: true,
      force: false,
    });
  }

  files.sort((a, b) => comparePaths(a.path, b.path));
  const metadata = buildSkillPackMetadata(files, {
    installedAt: options.installedAt ?? new Date().toISOString(),
    skillDir,
  });
  await writeFile(
    join(stagedSkillDir, SKILL_PACK_METADATA_FILE),
    `${JSON.stringify(metadata, null, 2)}\n`,
    { flag: "wx" },
  );

  await mkdir(dirname(absoluteSkillDir), { recursive: true });
  await rename(stagedSkillDir, absoluteSkillDir);
  published = true;

  return {
    skillDir: metadata.skillDir,
    skillConfig: buildRecommendedProjectSkillConfig(metadata.skillDir),
    installedSkills,
    metadataPath,
  };
} finally {
  if (!published) {
    await rm(stagingRoot, { recursive: true, force: true });
  } else {
    await rm(stagingRoot, { recursive: true, force: true });
  }
}
```

When building staged target paths, preserve each skill directory name exactly.
If `relative(skillDir, targetRelativeDir)` is awkward for custom `skillDir`, use
`basename(targetRelativeDir)` because each plan entry targets one top-level
skill directory under `skillDir`.

- [ ] **Step 4: Preserve the no-overwrite preflight**

Keep these checks before staging starts:

```ts
if (await pathExists(targetDir)) {
  throw new Error(
    `Refusing to overwrite existing skill path: ${targetRelativeDir}`,
  );
}

if (await pathExists(metadataPath)) {
  throw new Error(
    `Refusing to overwrite existing skill path: ${projectSkillPath(SKILL_PACK_METADATA_FILE, skillDir)}`,
  );
}
```

Also add a preflight for the top-level target directory:

```ts
if (await pathExists(absoluteSkillDir)) {
  throw new Error(`Refusing to overwrite existing skill path: ${skillDir}`);
}
```

- [ ] **Step 5: Run installer tests**

Run:

```bash
node --test src/cli/commands/init/skill-installer.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit atomic installer**

```bash
git add src/cli/commands/init/skill-installer.ts src/cli/commands/init/skill-installer.test.ts
git commit -m "fix(init): stage project skill installation atomically"
```

---

## Task 6: Align skill-pack dependency provenance with the installable source

**Files:**

- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `npm-shrinkwrap.json`
- Modify: `src/workflow/skill-pack.ts`
- Modify: `docs/plans/2026-05-29-project-local-default-skills.md`
- Modify: `docs/specs/2026-05-29-project-local-default-skills-design.md`
- Test: `src/cli/commands/init/skill-installer.test.ts`,
  `src/workflow/skill-pack.test.ts`

- [ ] **Step 1: Verify the source decision**

Run:

```bash
npm view superpowers version
npm view superpowers versions --json
```

Expected: the public npm package does not expose `5.0.7`; keep the existing
GitHub tarball dependency instead of switching to `superpowers@5.0.7`.

- [ ] **Step 2: Refresh installed dependencies and lockfiles from the selected
      tarball source**

Run:

```bash
npm install
```

Expected:

- `node_modules/superpowers/package.json` exists.
- `npm ls superpowers --depth=0` shows `superpowers` installed from the GitHub
  tarball dependency.
- `package-lock.json` and `npm-shrinkwrap.json` are consistent with
  `package.json`.

- [ ] **Step 3: Keep manifest source typed as GitHub release**

Confirm `src/workflow/skill-pack.ts` still records:

```ts
export type SkillPackSource = {
  type: "github-release";
  repository: "obra/superpowers";
  tag: "v5.0.7";
  tarballUrl: "https://github.com/obra/superpowers/archive/refs/tags/v5.0.7.tar.gz";
};
```

No code change is needed here if Task 2 still passes. If the lockfile resolved
URL differs, update only the docs, not the metadata constants.

- [ ] **Step 4: Update the old implementation plan to stop claiming npm exact
      package install**

In `docs/plans/2026-05-29-project-local-default-skills.md`, replace the Task 1
command block that says:

```sh
npm install superpowers@5.0.7 --save-exact
```

with:

```sh
npm install https://github.com/obra/superpowers/archive/refs/tags/v5.0.7.tar.gz --save-exact
```

Also replace the expected text:

```md
Expected: `package.json`, `package-lock.json`, and `npm-shrinkwrap.json` include
`superpowers` at exact version `5.0.7`.
```

with:

```md
Expected: `package.json`, `package-lock.json`, and `npm-shrinkwrap.json` include
`superpowers` from the pinned GitHub tag tarball `v5.0.7`.
```

- [ ] **Step 5: Update the design distribution wording**

In `docs/specs/2026-05-29-project-local-default-skills-design.md`, replace:

```md
The initial implementation should install a pinned external skill pack during
`patchmill init`. This keeps Patchmill lean while giving users good defaults.
```

with:

```md
The initial implementation should depend on a pinned GitHub release tarball for
the external skill pack and copy those installed files during `patchmill init`.
This keeps Patchmill lean while giving users good defaults without relying on a
mutable user-global skill installation.
```

- [ ] **Step 6: Run provenance-related tests**

Run:

```bash
node --test src/workflow/skill-pack.test.ts src/cli/commands/init/skill-installer.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit provenance alignment**

```bash
git add package.json package-lock.json npm-shrinkwrap.json src/workflow/skill-pack.ts docs/plans/2026-05-29-project-local-default-skills.md docs/specs/2026-05-29-project-local-default-skills-design.md
git commit -m "docs(skills): align recommended pack provenance"
```

---

## Task 7: Full verification and cleanup

**Files:**

- Modify only if verification exposes failures in files touched above.

- [ ] **Step 1: Run TypeScript lint**

Run:

```bash
npm run lint:ts
```

Expected: PASS with zero warnings.

- [ ] **Step 2: Run formatting check**

Run:

```bash
npm run format:check
```

Expected: PASS.

- [ ] **Step 3: Run markdown lint**

Run:

```bash
npm run lint:md
```

Expected: PASS.

- [ ] **Step 4: Run full test suite**

Run:

```bash
npm test
```

Expected: PASS. The previous failures for
`Cannot find module 'superpowers/package.json'` must be gone after `npm install`
or `npm ci`.

- [ ] **Step 5: Check changed file sizes**

Run:

```bash
git diff --stat origin/main...HEAD
wc -l src/cli/commands/doctor/checks.ts src/workflow/skills.ts src/workflow/skill-resolution.ts
```

Expected:

- `src/workflow/skills.ts` is smaller than before because resolver logic moved
  out.
- `src/cli/commands/doctor/checks.ts` does not grow past 1000 lines.
- `src/workflow/skill-resolution.ts` stays focused on resolution and
  diagnostics.

- [ ] **Step 6: Review the final diff for the original findings**

Run:

```bash
git diff origin/main...HEAD -- src/workflow src/cli/commands/init src/cli/commands/doctor docs package.json package-lock.json npm-shrinkwrap.json
```

Expected, by finding:

- Runtime and doctor both use `resolveConfiguredSkillInvocation`.
- `src/workflow/skills.ts` no longer contains path-like, project-local metadata,
  or metadata-file parsing logic; it only re-exports resolver helpers.
- `src/cli/commands/doctor/checks.ts` no longer contains project-local metadata
  JSON parsing, metadata path resolution, or metadata hash comparison logic.
- Doctor does not validate unused `.patchmill/skills` directories.
- Init stages project skills before publishing `.patchmill/skills`.
- `--skills global` writes global skill names and does not trigger bundled
  triage injection.
- Docs and manifest agree on GitHub tarball provenance.

- [ ] **Step 7: Commit verification fixes if needed**

If Step 1-6 required code changes, commit them:

```bash
git add <changed-files>
git commit -m "fix(skills): finish project-local skill validation cleanup"
```

If no code changes were needed, do not create an empty commit.

---

## Self-review checklist

- Spec coverage: every review finding maps to a task.
  - Divergent runtime/doctor resolver and duplicated metadata/path parsing
    deletion: Tasks 1-3 and Task 7 verification.
  - Unused `.patchmill/skills` validation: Task 3.
  - Non-atomic install: Task 5.
  - Bundled/global triage overload: Task 4.
  - Dependency/provenance mismatch and failing local dependency verification:
    Task 6.
- Placeholder scan: no task uses open-ended implementation placeholders.
- Type consistency: resolver types use `SkillInvocationResolution`,
  `SkillResolutionDiagnostic`, and status strings consistently across tasks.
- Scope check: this is one coherent refactor around project-local skill
  resolution and init safety; no unrelated host, policy, or prompt behavior is
  included.
