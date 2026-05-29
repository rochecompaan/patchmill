# Project-local Default Skills Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `patchmill init` install Patchmill's recommended skill pack into
`.patchmill/skills/`, write config that points at those local skills, and make
`doctor` validate the project-owned skill files.

**Architecture:** Add a small pure skill-pack module for recommended project
paths, metadata, and config mappings; add an init skill-installer module for
filesystem copying; update init orchestration to install project-local skills by
default while supporting `--skills project|global|none|path:<dir>`. Add shared
skill target resolution so triage and run-once Pi invocations pass path-like
skills through `--skill`, and extend doctor with shape, metadata, customization,
git-ignore, and Pi skill-loading checks.

**Tech Stack:** TypeScript ESM, Node 24 built-ins (`node:test`, `fs/promises`,
`crypto`, `module`, `path`), existing Patchmill CLI command modules, existing
`CommandRunner`, npm dependency management.

---

## File structure

Create:

- `src/workflow/skill-pack.ts` — pure manifest, project-local recommended skill
  paths, metadata types, hash helpers, and local config builders.
- `src/workflow/skill-pack.test.ts` — unit tests for path building, metadata
  shape, and config mapping.
- `src/cli/commands/init/skill-installer.ts` — install/copy recommended skill
  directories, write metadata, validate path-mode sources, and avoid overwrites.
- `src/cli/commands/init/skill-installer.test.ts` — filesystem tests for project
  install, metadata, no-overwrite safety, and path-mode validation.

Modify:

- `package.json`, `package-lock.json`, `npm-shrinkwrap.json` — add the pinned
  external recommended skill-pack source dependency.
- `src/workflow/skills.ts` — add path-like skill detection and `--skill`
  argument resolution helpers.
- `src/workflow/skills.test.ts` — cover path-like detection and invocation
  argument resolution.
- `src/config/defaults.test.ts` and `src/workflow/skills.test.ts` — update
  expectations only where default behavior intentionally changes or remains
  global.
- `src/cli/commands/init/args.ts` — parse `--skills` mode.
- `src/cli/commands/init/args.test.ts` — cover `--skills` parsing and invalid
  values.
- `src/cli/commands/init/config-writer.ts` — write skill mappings into generated
  config when init selects project/global/path modes.
- `src/cli/commands/init/config-writer.test.ts` — cover generated config skill
  mappings.
- `src/cli/commands/init/main.ts` — run selected skill installation mode and
  update user-facing output.
- `src/cli/commands/init/main.test.ts` — cover default project install, `none`,
  `global`, and `path:<dir>` init modes.
- `src/cli/commands/doctor/checks.ts` — validate local skill shape, pack
  metadata, git-ignore status, customized hashes, and Pi visibility for the
  project-local skill pack.
- `src/cli/commands/doctor/checks.test.ts` — cover fresh project-local skills,
  missing skills, malformed skills, customized skills, missing metadata, ignored
  skill directory, and Pi failing to load the project-local skill pack.
- `src/cli/commands/triage/dry-run-agent.ts` — use shared skill invocation args
  for configured triage skill paths.
- `src/cli/commands/triage/dry-run-agent.test.ts` — cover `--skill` for
  project-local triage paths.
- `src/cli/commands/triage/execute-agent.ts` — use shared skill invocation args
  for configured triage skill paths.
- `src/cli/commands/triage/execute-agent.test.ts` — cover `--skill` for
  project-local triage paths.
- `src/cli/commands/run-once/pi.ts` — allow plan/implementation Pi calls to pass
  local skill files through `--skill`.
- `src/pi/runner.ts` — resolve local skill paths for planning and implementation
  stages.
- `src/pi/runner.test.ts` and `src/cli/commands/run-once/pi.test.ts` — cover
  plan/implementation `--skill` arguments.
- `docs/configuration.md`, `docs/skills.md`, `docs/issue-agent-workflows.md`,
  `README.md` — document init-installed project-local skills.

Do not modify:

- Triage policy labels or issue-state decisions.
- Host provider behavior.
- Future `patchmill skills diff/update/reset` commands; this plan only creates
  metadata that later commands can use.

---

## Task 1: Pin the external recommended skill-pack source

**Files:**

- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `npm-shrinkwrap.json`

- [ ] **Step 1: Add the dependency with npm**

Run:

```sh
npm install superpowers@5.0.7 --save-exact
```

Expected: `package.json`, `package-lock.json`, and `npm-shrinkwrap.json` include
`superpowers` at exact version `5.0.7`.

- [ ] **Step 2: Verify the dependency exposes skills**

Run:

```sh
node -e "const {createRequire}=require('node:module'); const {join}=require('node:path'); const {readdirSync}=require('node:fs'); const requireFromHere=createRequire(process.cwd() + '/src/workflow/skill-pack.ts'); const root=require('node:path').dirname(requireFromHere.resolve('superpowers/package.json')); console.log(readdirSync(join(root, 'skills')).filter((name)=>name !== 'node_modules').sort().join('\n'))"
```

Expected output includes:

```text
subagent-driven-development
writing-plans
```

- [ ] **Step 3: Commit dependency pin**

Run:

```sh
git add package.json package-lock.json npm-shrinkwrap.json
git commit -m "chore(skills): pin recommended skill pack source"
```

---

## Task 2: Add pure recommended skill-pack manifest and metadata helpers

**Files:**

- Create: `src/workflow/skill-pack.ts`
- Create: `src/workflow/skill-pack.test.ts`

- [ ] **Step 1: Write failing tests for recommended project paths and metadata**

Create `src/workflow/skill-pack.test.ts`:

```ts
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import {
  DEFAULT_PROJECT_SKILL_DIR,
  PATCHMILL_DEFAULT_SKILL_PACK,
  SKILL_PACK_METADATA_FILE,
  buildRecommendedProjectSkillConfig,
  buildSkillPackMetadata,
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
    projectSkillPath("subagent-driven-development", "project/skills"),
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
    type: "npm",
    package: "superpowers",
    version: "5.0.7",
  });
  assert.ok(
    PATCHMILL_RECOMMENDED_SKILL_PACK.skills.some(
      (skill) => skill.name === "patchmill-issue-triage",
    ),
  );
  assert.ok(
    PATCHMILL_RECOMMENDED_SKILL_PACK.skills.some(
      (skill) => skill.name === "writing-plans",
    ),
  );
});

test("hashText returns stable sha256 hex", () => {
  assert.equal(
    hashText(unixNewline),
    createHash("sha256").update(unixNewline).digest("hex"),
  );
});

test("buildSkillPackMetadata records installed file hashes", () => {
  const metadata = buildSkillPackMetadata([
    {
      path: ".patchmill/skills/writing-plans/SKILL.md",
      sha256: hashText(unixNewline),
    },
  ]);

  assert.deepEqual(metadata, {
    pack: {
      name: "patchmill-recommended",
      version: "2026.05",
      source: {
        type: "npm",
        package: "superpowers",
        version: "5.0.7",
      },
    },
    installedAt: "<generated-by-init>",
    skillDir: ".patchmill/skills",
    metadataFile: SKILL_PACK_METADATA_FILE,
    files: [
      {
        path: ".patchmill/skills/writing-plans/SKILL.md",
        sha256: hashText(unixNewline),
      },
    ],
  });
});
```

- [ ] **Step 2: Run the new test to verify failure**

Run:

```sh
node --test src/workflow/skill-pack.test.ts
```

Expected: FAIL because `src/workflow/skill-pack.ts` does not exist.

- [ ] **Step 3: Implement the pure manifest module**

Create `src/workflow/skill-pack.ts`:

```ts
import { createHash } from "node:crypto";
import type { PatchmillSkillsConfig } from "./skills.ts";

export const DEFAULT_PROJECT_SKILL_DIR = ".patchmill/skills";
export const SKILL_PACK_METADATA_FILE = "patchmill-skill-pack.json";

export type SkillPackSource = {
  type: "npm";
  package: "superpowers";
  version: "5.0.7";
};

export type SkillPackSkill = {
  name: string;
  source: "patchmill" | "superpowers";
};

export type SkillPack = {
  name: "patchmill-recommended";
  version: "2026.05";
  source: SkillPackSource;
  skills: SkillPackSkill[];
};

export type SkillPackMetadataFile = {
  pack: {
    name: SkillPack["name"];
    version: SkillPack["version"];
    source: SkillPackSource;
  };
  installedAt: "<generated-by-init>" | string;
  skillDir: string;
  metadataFile: typeof SKILL_PACK_METADATA_FILE;
  files: Array<{ path: string; sha256: string }>;
};

export const PATCHMILL_RECOMMENDED_SKILL_PACK: SkillPack = {
  name: "patchmill-recommended",
  version: "2026.05",
  source: {
    type: "npm",
    package: "superpowers",
    version: "5.0.7",
  },
  skills: [
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
  ],
};

export function projectSkillPath(
  skillName: string,
  skillDir = DEFAULT_PROJECT_SKILL_DIR,
): string {
  return `${skillDir.replace(/\/+$/u, "")}/${skillName}`;
}

export function buildRecommendedProjectSkillConfig(
  skillDir = DEFAULT_PROJECT_SKILL_DIR,
): Pick<PatchmillSkillsConfig, "triage" | "planning" | "implementation"> {
  return {
    triage: projectSkillPath("patchmill-issue-triage", skillDir),
    planning: projectSkillPath("writing-plans", skillDir),
    implementation: projectSkillPath("subagent-driven-development", skillDir),
  };
}

export function hashText(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

export function buildSkillPackMetadata(
  files: Array<{ path: string; sha256: string }>,
  options: { installedAt?: string; skillDir?: string } = {},
): SkillPackMetadataFile {
  return {
    pack: {
      name: PATCHMILL_RECOMMENDED_SKILL_PACK.name,
      version: PATCHMILL_RECOMMENDED_SKILL_PACK.version,
      source: PATCHMILL_RECOMMENDED_SKILL_PACK.source,
    },
    installedAt: options.installedAt ?? "<generated-by-init>",
    skillDir: options.skillDir ?? DEFAULT_PROJECT_SKILL_DIR,
    metadataFile: SKILL_PACK_METADATA_FILE,
    files,
  };
}
```

- [ ] **Step 4: Run the manifest test to verify it passes**

Run:

```sh
node --test src/workflow/skill-pack.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit manifest module**

Run:

```sh
git add src/workflow/skill-pack.ts src/workflow/skill-pack.test.ts
git commit -m "feat(skills): describe recommended skill pack"
```

---

## Task 3: Add project-local skill installer

**Files:**

- Create: `src/cli/commands/init/skill-installer.ts`
- Create: `src/cli/commands/init/skill-installer.test.ts`

- [ ] **Step 1: Write failing installer tests**

Create `src/cli/commands/init/skill-installer.test.ts`:

```ts
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { SKILL_PACK_METADATA_FILE } from "../../../workflow/skill-pack.ts";
import {
  installProjectSkills,
  validateExistingSkillDirectory,
} from "./skill-installer.ts";

async function tempRoot(prefix: string): Promise<string> {
  return mkdtemp(join(tmpdir(), prefix));
}

async function writeSkill(
  root: string,
  name: string,
  body: string,
): Promise<void> {
  await mkdir(join(root, name), { recursive: true });
  await writeFile(join(root, name, "SKILL.md"), body);
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
# Plans
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
  await writeSkill(superpowersSource, "writing-plans", planningSkill);
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

  assert.deepEqual(result.skillConfig, {
    triage: ".patchmill/skills/patchmill-issue-triage",
    planning: ".patchmill/skills/writing-plans",
    implementation: ".patchmill/skills/subagent-driven-development",
  });
  assert.equal(result.installedSkills.length, 3);
  assert.match(
    await readFile(
      join(repoRoot, ".patchmill", "skills", "writing-plans", "SKILL.md"),
      "utf8",
    ),
    /name: writing-plans/,
  );

  const metadata = JSON.parse(
    await readFile(
      join(repoRoot, ".patchmill", "skills", SKILL_PACK_METADATA_FILE),
      "utf8",
    ),
  ) as { installedAt: string; files: Array<{ path: string; sha256: string }> };
  assert.equal(metadata.installedAt, "2026-05-29T00:00:00.000Z");
  assert.ok(
    metadata.files.some(
      (file) => file.path === ".patchmill/skills/writing-plans/SKILL.md",
    ),
  );
});

test("installProjectSkills refuses to overwrite existing skill files", async () => {
  const repoRoot = await tempRoot("patchmill-install-repo-");
  const patchmillSource = await tempRoot("patchmill-install-patchmill-");
  const superpowersSource = await tempRoot("patchmill-install-superpowers-");
  await writeSkill(patchmillSource, "patchmill-issue-triage", triageSkill);
  await writeSkill(superpowersSource, "writing-plans", planningSkill);
  await mkdir(join(repoRoot, ".patchmill", "skills", "writing-plans"), {
    recursive: true,
  });
  await writeFile(
    join(repoRoot, ".patchmill", "skills", "writing-plans", "SKILL.md"),
    "existing\n",
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
    /Refusing to overwrite existing skill path/,
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
    {
      triage: "project-skills/patchmill-issue-triage",
      planning: "project-skills/writing-plans",
      implementation: "project-skills/subagent-driven-development",
    },
  );
});

test("validateExistingSkillDirectory fails when a required skill is missing", async () => {
  const repoRoot = await tempRoot("patchmill-install-repo-");
  await writeSkill(repoRoot, "project-skills/writing-plans", planningSkill);

  await assert.rejects(
    validateExistingSkillDirectory(repoRoot, "project-skills"),
    /Missing required skill file: project-skills\/patchmill-issue-triage\/SKILL.md/,
  );
});
```

- [ ] **Step 2: Run the installer test to verify failure**

Run:

```sh
node --test src/cli/commands/init/skill-installer.test.ts
```

Expected: FAIL because `skill-installer.ts` does not exist.

- [ ] **Step 3: Implement the installer**

Create `src/cli/commands/init/skill-installer.ts`:

```ts
import { constants } from "node:fs";
import { access, cp, mkdir, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import {
  DEFAULT_PROJECT_SKILL_DIR,
  PATCHMILL_RECOMMENDED_SKILL_PACK,
  SKILL_PACK_METADATA_FILE,
  buildRecommendedProjectSkillConfig,
  buildSkillPackMetadata,
  hashText,
  projectSkillPath,
  type SkillPackSkill,
} from "../../../workflow/skill-pack.ts";
import type { PatchmillSkillsConfig } from "../../../workflow/skills.ts";
import { bundledTriageSkillPath } from "../../../workflow/skills.ts";

const require = createRequire(import.meta.url);

type SourceRoots = {
  patchmillSkillsDir: string;
  superpowersSkillsDir: string;
};

export type ProjectSkillInstallResult = {
  skillDir: string;
  skillConfig: Pick<
    PatchmillSkillsConfig,
    "triage" | "planning" | "implementation"
  >;
  installedSkills: string[];
  metadataPath: string;
};

export function defaultSkillSourceRoots(): SourceRoots {
  const superpowersRoot = dirname(require.resolve("superpowers/package.json"));
  return {
    patchmillSkillsDir: resolve(dirname(bundledTriageSkillPath()), ".."),
    superpowersSkillsDir: join(superpowersRoot, "skills"),
  };
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

function sourceRootFor(skill: SkillPackSkill, roots: SourceRoots): string {
  return skill.source === "patchmill"
    ? roots.patchmillSkillsDir
    : roots.superpowersSkillsDir;
}

async function assertSkillFile(
  path: string,
  displayPath: string,
): Promise<void> {
  try {
    await access(path, constants.R_OK);
  } catch {
    throw new Error(`Missing required skill file: ${displayPath}`);
  }
}

export async function installProjectSkills(options: {
  repoRoot: string;
  skillDir?: string;
  sourceRoots?: SourceRoots;
  packSkills?: SkillPackSkill[];
  installedAt?: string;
}): Promise<ProjectSkillInstallResult> {
  const skillDir = options.skillDir ?? DEFAULT_PROJECT_SKILL_DIR;
  const roots = options.sourceRoots ?? defaultSkillSourceRoots();
  const packSkills =
    options.packSkills ?? PATCHMILL_RECOMMENDED_SKILL_PACK.skills;
  const absoluteSkillDir = resolve(options.repoRoot, skillDir);
  const files: Array<{ path: string; sha256: string }> = [];
  const installedSkills: string[] = [];

  for (const skill of packSkills) {
    const sourceDir = join(sourceRootFor(skill, roots), skill.name);
    const targetRelativeDir = projectSkillPath(skill.name, skillDir);
    const targetDir = resolve(options.repoRoot, targetRelativeDir);
    const targetSkillFile = join(targetDir, "SKILL.md");
    await assertSkillFile(
      join(sourceDir, "SKILL.md"),
      `${skill.name}/SKILL.md`,
    );
    if (await exists(targetDir)) {
      throw new Error(
        `Refusing to overwrite existing skill path: ${targetRelativeDir}`,
      );
    }
    await mkdir(dirname(targetDir), { recursive: true });
    await cp(sourceDir, targetDir, {
      recursive: true,
      errorOnExist: true,
      force: false,
    });
    const text = await readFile(targetSkillFile, "utf8");
    files.push({
      path: `${targetRelativeDir}/SKILL.md`,
      sha256: hashText(text),
    });
    installedSkills.push(targetRelativeDir);
  }

  const metadata = buildSkillPackMetadata(files, {
    installedAt: options.installedAt ?? new Date().toISOString(),
    skillDir,
  });
  const metadataPath = join(absoluteSkillDir, SKILL_PACK_METADATA_FILE);
  await writeFile(metadataPath, `${JSON.stringify(metadata, null, 2)}\n`, {
    flag: "wx",
  });

  return {
    skillDir,
    skillConfig: buildRecommendedProjectSkillConfig(skillDir),
    installedSkills,
    metadataPath,
  };
}

export async function validateExistingSkillDirectory(
  repoRoot: string,
  skillDir: string,
): Promise<
  Pick<PatchmillSkillsConfig, "triage" | "planning" | "implementation">
> {
  const skillConfig = buildRecommendedProjectSkillConfig(skillDir);
  const required = [
    skillConfig.triage,
    skillConfig.planning,
    skillConfig.implementation,
  ];
  for (const skillPath of required) {
    const displayPath = `${skillPath}/SKILL.md`;
    await assertSkillFile(resolve(repoRoot, displayPath), displayPath);
  }
  return skillConfig;
}
```

- [ ] **Step 4: Run the installer test to verify it passes**

Run:

```sh
node --test src/cli/commands/init/skill-installer.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit installer module**

Run:

```sh
git add src/cli/commands/init/skill-installer.ts src/cli/commands/init/skill-installer.test.ts
git commit -m "feat(init): install project-local skill pack"
```

---

## Task 4: Parse init skill install modes

**Files:**

- Modify: `src/cli/commands/init/args.ts`
- Modify: `src/cli/commands/init/args.test.ts`

- [ ] **Step 1: Write failing arg parser tests**

Replace the current assertions in `src/cli/commands/init/args.test.ts` with
these updated expectations and new mode tests:

```ts
import assert from "node:assert/strict";
import { test } from "node:test";
import { parseArgs } from "./args.ts";

test("parseArgs defaults to creating config with project skills", () => {
  assert.deepEqual(parseArgs([], "/repo"), {
    repoRoot: "/repo",
    showHelp: false,
    skills: { mode: "project" },
  });
});

test("parseArgs recognizes help", () => {
  assert.deepEqual(parseArgs(["--help"], "/repo"), {
    repoRoot: "/repo",
    showHelp: true,
    skills: { mode: "project" },
  });
  assert.deepEqual(parseArgs(["-h"], "/repo"), {
    repoRoot: "/repo",
    showHelp: true,
    skills: { mode: "project" },
  });
});

test("parseArgs recognizes skills modes", () => {
  assert.deepEqual(parseArgs(["--skills", "project"], "/repo").skills, {
    mode: "project",
  });
  assert.deepEqual(parseArgs(["--skills=global"], "/repo").skills, {
    mode: "global",
  });
  assert.deepEqual(parseArgs(["--skills", "none"], "/repo").skills, {
    mode: "none",
  });
  assert.deepEqual(
    parseArgs(["--skills", "path:project-skills"], "/repo").skills,
    {
      mode: "path",
      path: "project-skills",
    },
  );
});

test("parseArgs rejects missing skills value", () => {
  assert.throws(
    () => parseArgs(["--skills"], "/repo"),
    /--skills requires one of project, global, none, or path:<dir>/,
  );
});

test("parseArgs rejects unsupported skills value", () => {
  assert.throws(
    () => parseArgs(["--skills", "remote"], "/repo"),
    /--skills requires one of project, global, none, or path:<dir>/,
  );
});

test("parseArgs rejects empty path mode", () => {
  assert.throws(
    () => parseArgs(["--skills=path:"], "/repo"),
    /--skills path:<dir> requires a non-empty directory/,
  );
});

test("parseArgs rejects force in v1", () => {
  assert.throws(
    () => parseArgs(["--force"], "/repo"),
    /Unknown argument: --force/,
  );
});

test("parseArgs rejects unknown arguments", () => {
  assert.throws(
    () => parseArgs(["--json"], "/repo"),
    /Unknown argument: --json/,
  );
});
```

- [ ] **Step 2: Run arg parser tests to verify failure**

Run:

```sh
node --test src/cli/commands/init/args.test.ts
```

Expected: FAIL because `skills` parsing is not implemented.

- [ ] **Step 3: Implement skills mode parsing**

Update `src/cli/commands/init/args.ts`:

```ts
import { cwd } from "node:process";

export type InitSkillsMode =
  | { mode: "project" }
  | { mode: "global" }
  | { mode: "none" }
  | { mode: "path"; path: string };

export type InitConfig = {
  repoRoot: string;
  showHelp: boolean;
  skills: InitSkillsMode;
};

function parseSkillsMode(value: string | undefined): InitSkillsMode {
  if (!value) {
    throw new Error(
      "--skills requires one of project, global, none, or path:<dir>",
    );
  }
  if (value === "project" || value === "global" || value === "none") {
    return { mode: value };
  }
  if (value.startsWith("path:")) {
    const path = value.slice("path:".length).trim();
    if (path.length === 0) {
      throw new Error("--skills path:<dir> requires a non-empty directory");
    }
    return { mode: "path", path };
  }
  throw new Error(
    "--skills requires one of project, global, none, or path:<dir>",
  );
}

export function parseArgs(args: string[], repoRoot = cwd()): InitConfig {
  const config: InitConfig = {
    repoRoot,
    showHelp: false,
    skills: { mode: "project" },
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]!;
    if (arg === "--help" || arg === "-h") {
      config.showHelp = true;
    } else if (arg === "--skills") {
      config.skills = parseSkillsMode(args[index + 1]);
      index += 1;
    } else if (arg.startsWith("--skills=")) {
      config.skills = parseSkillsMode(arg.slice("--skills=".length));
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return config;
}
```

- [ ] **Step 4: Run arg parser tests to verify pass**

Run:

```sh
node --test src/cli/commands/init/args.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit args parsing**

Run:

```sh
git add src/cli/commands/init/args.ts src/cli/commands/init/args.test.ts
git commit -m "feat(init): parse skill install modes"
```

---

## Task 5: Generate config with selected skill mappings

**Files:**

- Modify: `src/cli/commands/init/config-writer.ts`
- Modify: `src/cli/commands/init/config-writer.test.ts`

- [ ] **Step 1: Write failing config writer tests**

Add these tests to `src/cli/commands/init/config-writer.test.ts`:

```ts
test("buildInitialConfig includes explicit project-local skill mappings", () => {
  assert.deepEqual(
    buildInitialConfig({
      skills: {
        triage: ".patchmill/skills/patchmill-issue-triage",
        planning: ".patchmill/skills/writing-plans",
        implementation: ".patchmill/skills/subagent-driven-development",
      },
    }),
    {
      host: {
        provider: "forgejo-tea",
        login: "triage-agent",
      },
      skills: {
        triage: ".patchmill/skills/patchmill-issue-triage",
        planning: ".patchmill/skills/writing-plans",
        implementation: ".patchmill/skills/subagent-driven-development",
      },
    },
  );
});

test("writeInitialConfig writes selected skills", async () => {
  const repoRoot = await tempRepo();
  const result = await writeInitialConfig(repoRoot, {
    skills: {
      triage: ".patchmill/skills/patchmill-issue-triage",
      planning: ".patchmill/skills/writing-plans",
      implementation: ".patchmill/skills/subagent-driven-development",
    },
  });

  assert.equal(result.status, "created");
  assert.deepEqual(
    JSON.parse(await readFile(join(repoRoot, CONFIG_FILE_NAME), "utf8")),
    {
      host: {
        provider: "forgejo-tea",
        login: "triage-agent",
      },
      skills: {
        triage: ".patchmill/skills/patchmill-issue-triage",
        planning: ".patchmill/skills/writing-plans",
        implementation: ".patchmill/skills/subagent-driven-development",
      },
    },
  );
});
```

- [ ] **Step 2: Run config writer tests to verify failure**

Run:

```sh
node --test src/cli/commands/init/config-writer.test.ts
```

Expected: FAIL because `buildInitialConfig` and `writeInitialConfig` do not
accept `skills`.

- [ ] **Step 3: Update config writer types and builders**

Modify the top of `src/cli/commands/init/config-writer.ts` so `InitialConfig`
can include skills:

```ts
type InitialConfig = {
  host: Pick<PatchmillConfig["host"], "provider" | "login">;
  skills?: Pick<
    PatchmillConfig["skills"],
    "triage" | "planning" | "implementation"
  >;
};
```

Update `buildInitialConfig` signature and return value:

```ts
export function buildInitialConfig(
  options: {
    provider?: PatchmillConfig["host"]["provider"];
    login?: string;
    skills?: Pick<
      PatchmillConfig["skills"],
      "triage" | "planning" | "implementation"
    >;
  } = {},
): InitialConfig {
  const provider = options.provider ?? DEFAULT_PATCHMILL_CONFIG.host.provider;
  return {
    host: {
      provider,
      login:
        options.login ??
        (provider === "github-gh" ? "" : DEFAULT_PATCHMILL_CONFIG.host.login),
    },
    ...(options.skills !== undefined ? { skills: options.skills } : {}),
  };
}
```

Update `writeInitialConfig` options:

```ts
export async function writeInitialConfig(
  repoRoot: string,
  options: {
    login?: string;
    skills?: Pick<
      PatchmillConfig["skills"],
      "triage" | "planning" | "implementation"
    >;
  },
): Promise<InitWriteResult> {
  const path = join(repoRoot, CONFIG_FILE_NAME);
  if (await fileExists(path)) return { status: "exists", path };

  const provider = inferHostProviderFromRemote(await originRemoteUrl(repoRoot));
  const config = buildInitialConfig({
    provider,
    login: options.login,
    skills: options.skills,
  });
  await writeFile(path, `${JSON.stringify(config, null, 2)}\n`, {
    flag: "wx",
  });
  return { status: "created", path, config };
}
```

- [ ] **Step 4: Run config writer tests to verify pass**

Run:

```sh
node --test src/cli/commands/init/config-writer.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit config writer changes**

Run:

```sh
git add src/cli/commands/init/config-writer.ts src/cli/commands/init/config-writer.test.ts
git commit -m "feat(init): write selected skill mappings"
```

---

## Task 6: Wire skill installation into `patchmill init`

**Files:**

- Modify: `src/cli/commands/init/main.ts`
- Modify: `src/cli/commands/init/main.test.ts`

- [ ] **Step 1: Write failing init orchestration tests**

Add these tests to `src/cli/commands/init/main.test.ts`:

```ts
import { mkdir, readFile } from "node:fs/promises";
```

Keep the existing imports and add `readFile` to the current `fs/promises` import
if it already exists.

Add tests after `runInit creates config and prints next step`:

```ts
test("runInit installs project-local skills by default", async () => {
  const repoRoot = await tempRepo();
  const stdout: string[] = [];

  assert.equal(
    await runInit(
      [],
      repoRoot,
      { stdout: (line) => stdout.push(line), stderr: () => undefined },
      {
        env: {},
        homeDir: await tempRepo(),
        isInteractive: false,
        checkPiAvailable: async () => false,
      },
    ),
    0,
  );

  const config = JSON.parse(
    await readFile(join(repoRoot, "patchmill.config.json"), "utf8"),
  ) as { skills: Record<string, string> };
  assert.deepEqual(config.skills, {
    triage: ".patchmill/skills/patchmill-issue-triage",
    planning: ".patchmill/skills/writing-plans",
    implementation: ".patchmill/skills/subagent-driven-development",
  });
  assert.match(
    await readFile(
      join(repoRoot, ".patchmill", "skills", "writing-plans", "SKILL.md"),
      "utf8",
    ),
    /name: writing-plans/,
  );
  assert.match(stdout.join("\n"), /Installed project-local skills/);
  assert.match(stdout.join("\n"), /Commit `.patchmill\/skills\/`/);
});

test("runInit --skills none skips skill installation", async () => {
  const repoRoot = await tempRepo();
  const stdout: string[] = [];

  assert.equal(
    await runInit(
      ["--skills", "none"],
      repoRoot,
      { stdout: (line) => stdout.push(line), stderr: () => undefined },
      {
        env: {},
        homeDir: await tempRepo(),
        isInteractive: false,
        checkPiAvailable: async () => false,
      },
    ),
    0,
  );

  const config = JSON.parse(
    await readFile(join(repoRoot, "patchmill.config.json"), "utf8"),
  ) as { skills?: Record<string, string> };
  assert.equal(config.skills, undefined);
  assert.match(stdout.join("\n"), /Skipped default skill installation/);
});

test("runInit --skills global writes global default skill names", async () => {
  const repoRoot = await tempRepo();

  assert.equal(
    await runInit(
      ["--skills=global"],
      repoRoot,
      { stdout: () => undefined, stderr: () => undefined },
      {
        env: {},
        homeDir: await tempRepo(),
        isInteractive: false,
        checkPiAvailable: async () => false,
      },
    ),
    0,
  );

  const config = JSON.parse(
    await readFile(join(repoRoot, "patchmill.config.json"), "utf8"),
  ) as { skills: Record<string, string> };
  assert.deepEqual(config.skills, {
    triage: "patchmill-issue-triage",
    planning: "superpowers:writing-plans",
    implementation: "superpowers:subagent-driven-development",
  });
});

test("runInit --skills path validates and writes existing local skills", async () => {
  const repoRoot = await tempRepo();
  await mkdir(join(repoRoot, "project-skills", "patchmill-issue-triage"), {
    recursive: true,
  });
  await mkdir(join(repoRoot, "project-skills", "writing-plans"), {
    recursive: true,
  });
  await mkdir(join(repoRoot, "project-skills", "subagent-driven-development"), {
    recursive: true,
  });
  await writeFile(
    join(repoRoot, "project-skills", "patchmill-issue-triage", "SKILL.md"),
    "---\nname: patchmill-issue-triage\ndescription: Triage.\n---\n",
  );
  await writeFile(
    join(repoRoot, "project-skills", "writing-plans", "SKILL.md"),
    "---\nname: writing-plans\ndescription: Plan.\n---\n",
  );
  await writeFile(
    join(repoRoot, "project-skills", "subagent-driven-development", "SKILL.md"),
    "---\nname: subagent-driven-development\ndescription: Implement.\n---\n",
  );

  assert.equal(
    await runInit(
      ["--skills", "path:project-skills"],
      repoRoot,
      { stdout: () => undefined, stderr: () => undefined },
      {
        env: {},
        homeDir: await tempRepo(),
        isInteractive: false,
        checkPiAvailable: async () => false,
      },
    ),
    0,
  );

  const config = JSON.parse(
    await readFile(join(repoRoot, "patchmill.config.json"), "utf8"),
  ) as { skills: Record<string, string> };
  assert.deepEqual(config.skills, {
    triage: "project-skills/patchmill-issue-triage",
    planning: "project-skills/writing-plans",
    implementation: "project-skills/subagent-driven-development",
  });
});
```

- [ ] **Step 2: Run init main tests to verify failure**

Run:

```sh
node --test src/cli/commands/init/main.test.ts
```

Expected: FAIL because `runInit` does not install skills or pass skill config to
the writer.

- [ ] **Step 3: Update help text**

Modify `HELP_TEXT` in `src/cli/commands/init/main.ts`:

```ts
export const HELP_TEXT = `Usage:
  patchmill init [options]

Create a minimal patchmill.config.json for this repository and install the recommended project-local skill pack by default.

Options:
  --skills <mode>  Skill setup mode: project, global, none, or path:<dir>. Default: project.
  --help, -h       Show this help and exit.
`;
```

- [ ] **Step 4: Add skill mode resolution to main**

Add imports to `src/cli/commands/init/main.ts`:

```ts
import { DEFAULT_PATCHMILL_SKILLS } from "../../../workflow/skills.ts";
import type { PatchmillSkillsConfig } from "../../../workflow/skills.ts";
import type { InitSkillsMode } from "./args.ts";
import {
  installProjectSkills,
  validateExistingSkillDirectory,
} from "./skill-installer.ts";
```

Add this helper above `runInit`:

```ts
type SelectedSkills = {
  configSkills?: Pick<
    PatchmillSkillsConfig,
    "triage" | "planning" | "implementation"
  >;
  message: string;
};

async function selectSkills(
  repoRoot: string,
  mode: InitSkillsMode,
): Promise<SelectedSkills> {
  if (mode.mode === "none") {
    return {
      message:
        "Skipped default skill installation. Patchmill will use built-in skill defaults unless config is edited.",
    };
  }
  if (mode.mode === "global") {
    return {
      configSkills: {
        triage: DEFAULT_PATCHMILL_SKILLS.triage,
        planning: DEFAULT_PATCHMILL_SKILLS.planning,
        implementation: DEFAULT_PATCHMILL_SKILLS.implementation,
      },
      message:
        "Configured global/default skill names. Ensure those skills are installed for the agent runtime.",
    };
  }
  if (mode.mode === "path") {
    return {
      configSkills: await validateExistingSkillDirectory(repoRoot, mode.path),
      message: `Configured existing local skills from ${mode.path}. Commit that directory if it governs this project.`,
    };
  }

  const install = await installProjectSkills({ repoRoot });
  return {
    configSkills: install.skillConfig,
    message: `Installed project-local skills in ${install.skillDir}. Commit \`${install.skillDir}/\` because these files govern implementation behavior.`,
  };
}
```

Update `runInit` before calling `writeInitialConfig`:

```ts
const selectedSkills = await selectSkills(config.repoRoot, config.skills);
const result = await writeInitialConfig(config.repoRoot, {
  skills: selectedSkills.configSkills,
});
```

Update the existing final output block by replacing:

```ts
Using Patchmill defaults for labels, paths, skills, and git policy.
```

with:

```ts
Using Patchmill defaults for labels, paths, and git policy.

Skills:
  ${selectedSkills.message}
```

- [ ] **Step 5: Preserve existing-config no-overwrite behavior before installing
      skills**

The previous step installs project skills before `writeInitialConfig` can return
`exists`. Fix this by exporting `configFileExists` from `config-writer.ts`:

```ts
export async function configFileExists(repoRoot: string): Promise<boolean> {
  return fileExists(join(repoRoot, CONFIG_FILE_NAME));
}
```

Import it in `main.ts`:

```ts
import { configFileExists, writeInitialConfig } from "./config-writer.ts";
```

Add this guard before `selectSkills`:

```ts
if (await configFileExists(config.repoRoot)) {
  output.stdout(
    `patchmill.config.json already exists.\n\nPatchmill did not overwrite it.\n\nNext:\n  patchmill doctor`,
  );
  return 1;
}
```

Keep the existing `result.status === "exists"` branch after `writeInitialConfig`
as a race-safety fallback.

- [ ] **Step 6: Run init tests to verify pass**

Run:

```sh
node --test src/cli/commands/init/*.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit init integration**

Run:

```sh
git add src/cli/commands/init/args.ts src/cli/commands/init/args.test.ts src/cli/commands/init/config-writer.ts src/cli/commands/init/config-writer.test.ts src/cli/commands/init/main.ts src/cli/commands/init/main.test.ts src/cli/commands/init/skill-installer.ts src/cli/commands/init/skill-installer.test.ts
git commit -m "feat(init): install committed project skills by default"
```

---

## Task 7: Resolve path-like skills into Pi `--skill` arguments

**Files:**

- Modify: `src/workflow/skills.ts`
- Modify: `src/workflow/skills.test.ts`
- Modify: `src/cli/commands/triage/dry-run-agent.ts`
- Modify: `src/cli/commands/triage/dry-run-agent.test.ts`
- Modify: `src/cli/commands/triage/execute-agent.ts`
- Modify: `src/cli/commands/triage/execute-agent.test.ts`
- Modify: `src/cli/commands/run-once/pi.ts`
- Modify: `src/cli/commands/run-once/pi.test.ts`
- Modify: `src/pi/runner.ts`
- Modify: `src/pi/runner.test.ts`

- [ ] **Step 1: Write failing skill resolution tests**

Add tests to `src/workflow/skills.test.ts`:

```ts
import { resolve } from "node:path";
```

Add these imports from `./skills.ts`:

```ts
  isPathLikeSkill,
  skillInvocationArgs,
```

Add tests:

```ts
test("isPathLikeSkill detects local and absolute paths", () => {
  assert.equal(isPathLikeSkill(".patchmill/skills/writing-plans"), true);
  assert.equal(isPathLikeSkill("skills\\writing-plans"), true);
  assert.equal(isPathLikeSkill("/repo/skills/writing-plans"), true);
  assert.equal(isPathLikeSkill("C:\\repo\\skills\\writing-plans"), true);
  assert.equal(isPathLikeSkill("superpowers:writing-plans"), false);
  assert.equal(isPathLikeSkill("writing-plans"), false);
});

test("skillInvocationArgs resolves bundled default triage skill", () => {
  assert.deepEqual(skillInvocationArgs("patchmill-issue-triage", "/repo"), [
    "--skill",
    bundledTriageSkillPath(),
  ]);
});

test("skillInvocationArgs resolves local skill directories to SKILL.md", () => {
  assert.deepEqual(
    skillInvocationArgs(".patchmill/skills/writing-plans", "/repo"),
    [
      "--skill",
      resolve("/repo", ".patchmill/skills/writing-plans", "SKILL.md"),
    ],
  );
});

test("skillInvocationArgs ignores named external skills", () => {
  assert.deepEqual(
    skillInvocationArgs("superpowers:writing-plans", "/repo"),
    [],
  );
});
```

- [ ] **Step 2: Run skill tests to verify failure**

Run:

```sh
node --test src/workflow/skills.test.ts
```

Expected: FAIL because helper functions do not exist.

- [ ] **Step 3: Implement shared skill resolution helpers**

Add to `src/workflow/skills.ts` before `renderConfiguredSkillLine`:

```ts
const WINDOWS_ABSOLUTE_PATH_PATTERN = /^[A-Za-z]:[\\/]/u;
const SKILL_NAMESPACE_PATTERN = /^[a-z0-9-]+:.+$/iu;

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

export function skillInvocationArgs(
  skill: string | undefined,
  repoRoot: string,
): string[] {
  if (!skill) return [];
  if (skill === DEFAULT_PATCHMILL_SKILLS.triage) {
    return ["--skill", bundledTriageSkillPath()];
  }
  if (!isPathLikeSkill(skill)) return [];
  const resolved = WINDOWS_ABSOLUTE_PATH_PATTERN.test(skill)
    ? skill
    : join(repoRoot, skill);
  return ["--skill", join(resolved, "SKILL.md")];
}

export function skillInvocationPaths(
  skills: Array<string | undefined>,
  repoRoot: string,
): string[] {
  return skills.flatMap((skill) => {
    const args = skillInvocationArgs(skill, repoRoot);
    return args.length === 2 ? [args[1]!] : [];
  });
}
```

- [ ] **Step 4: Replace duplicated path-like helpers in doctor**

Remove `WINDOWS_ABSOLUTE_PATH_PATTERN`, `SKILL_NAMESPACE_PATTERN`,
`isNamespaceStyleSkill`, and `isPathLikeSkill` from
`src/cli/commands/doctor/checks.ts`. Import `isPathLikeSkill` from
`../../../workflow/skills.ts`.

- [ ] **Step 5: Use helper in triage agents**

In `src/cli/commands/triage/dry-run-agent.ts`, replace the current `skillArgs`
calculation with:

```ts
const skillArgs = skillInvocationArgs(skills.triage, repoRoot);
```

Add `skillInvocationArgs` to the existing import from
`../../../workflow/skills.ts` and remove `bundledTriageSkillPath` if it becomes
unused.

Make the same change in `src/cli/commands/triage/execute-agent.ts`.

- [ ] **Step 6: Add triage tests for project-local skill paths**

In `src/cli/commands/triage/dry-run-agent.test.ts`, add a test near the existing
bundled `--skill` test:

```ts
test("runTriageDryRunAgent passes project-local triage skill through --skill", async () => {
  const calls: Array<{ command: string; args: string[] }> = [];
  const runner = {
    async run(command: string, args: string[]) {
      calls.push({ command, args });
      return {
        code: 0,
        stdout: JSON.stringify({ previews: [] }),
        stderr: "",
      };
    },
  };

  await runTriageDryRunAgent(runner, "/repo", {
    issues: [],
    labels: DEFAULT_PATCHMILL_CONFIG.labels,
    stateMap: DEFAULT_PATCHMILL_CONFIG.triage.stateMap,
    skills: {
      ...DEFAULT_PATCHMILL_SKILLS,
      triage: ".patchmill/skills/patchmill-issue-triage",
    },
  });

  const skillIndex = calls[0]!.args.indexOf("--skill");
  assert.equal(
    calls[0]!.args[skillIndex + 1],
    join("/repo", ".patchmill/skills/patchmill-issue-triage", "SKILL.md"),
  );
});
```

In `src/cli/commands/triage/execute-agent.test.ts`, add the same assertion
pattern around `runTriageExecuteAgent`, returning
`{ code: 0, stdout: "", stderr: "" }` from the runner.

- [ ] **Step 7: Add skill path support to run-once Pi calls**

Update `src/cli/commands/run-once/pi.ts`:

```ts
function piPromptArgs(
  promptPath: string,
  sessionDir?: string,
  skillPaths: string[] = [],
): string[] {
  const skillArgs = skillPaths.flatMap((path) => ["--skill", path]);
  const baseArgs = ["-e", PI_SUBAGENTS_PACKAGE_ROOT, ...skillArgs, "-p"];
  return sessionDir
    ? [...baseArgs, "--session-dir", sessionDir, `@${promptPath}`]
    : [...baseArgs, `@${promptPath}`];
}
```

Add to `RunPiPromptOptions`:

```ts
  skillPaths?: string[];
```

Update the runner call:

```ts
result = await runner.run(
  "pi",
  piPromptArgs(promptPath, sessionDir, options?.skillPaths),
  { cwd },
);
```

Update `src/pi/runner.ts` imports:

```ts
import { skillInvocationPaths } from "../workflow/skills.ts";
```

Add `skillPaths` to the plan `runPiPrompt` options:

```ts
        skillPaths: skillInvocationPaths([input.skills.planning], input.repoRoot),
```

Add `skillPaths` to the implementation `runPiPrompt` options:

```ts
        skillPaths: skillInvocationPaths(
          [
            input.skills.toolchain,
            input.skills.implementation,
            input.skills.review,
            input.skills.visualEvidence,
            input.skills.landing,
          ],
          worktreeRoot,
        ),
```

- [ ] **Step 8: Add run-once Pi tests for skill paths**

In `src/cli/commands/run-once/pi.test.ts`, add a test next to the existing
`runPiPrompt` command argument tests:

```ts
test("runPiPrompt passes configured local skill paths to pi", async () => {
  const calls: Array<{ command: string; args: string[] }> = [];
  const runner = {
    async run(command: string, args: string[]) {
      calls.push({ command, args });
      return {
        code: 0,
        stdout: JSON.stringify({ status: "blocked", reason: "stop" }),
        stderr: "",
      };
    },
  };

  await runPiPrompt(runner, "/repo", "prompt", {
    stage: "pi-plan",
    skillPaths: ["/repo/.patchmill/skills/writing-plans/SKILL.md"],
  });

  const skillIndex = calls[0]!.args.indexOf("--skill");
  assert.equal(
    calls[0]!.args[skillIndex + 1],
    "/repo/.patchmill/skills/writing-plans/SKILL.md",
  );
});
```

In `src/pi/runner.test.ts`, add tests that instantiate `PiRunner` with a
recording runner and verify plan and implementation calls include local skills.
Use existing test fixtures in that file and assert the final `pi` command
contains `--skill` followed by the expected `SKILL.md` path.

- [ ] **Step 9: Run focused tests to verify pass**

Run:

```sh
node --test src/workflow/skills.test.ts src/cli/commands/triage/dry-run-agent.test.ts src/cli/commands/triage/execute-agent.test.ts src/cli/commands/run-once/pi.test.ts src/pi/runner.test.ts
```

Expected: PASS.

- [ ] **Step 10: Commit skill invocation changes**

Run:

```sh
git add src/workflow/skills.ts src/workflow/skills.test.ts src/cli/commands/doctor/checks.ts src/cli/commands/triage/dry-run-agent.ts src/cli/commands/triage/dry-run-agent.test.ts src/cli/commands/triage/execute-agent.ts src/cli/commands/triage/execute-agent.test.ts src/cli/commands/run-once/pi.ts src/cli/commands/run-once/pi.test.ts src/pi/runner.ts src/pi/runner.test.ts
git commit -m "feat(skills): pass local skill files to pi"
```

---

## Task 8: Extend doctor skill validation

**Files:**

- Modify: `src/cli/commands/doctor/checks.ts`
- Modify: `src/cli/commands/doctor/checks.test.ts`

- [ ] **Step 1: Write failing doctor tests for project-local skills**

Add imports to `src/cli/commands/doctor/checks.test.ts`:

```ts
import { readFile } from "node:fs/promises";
import {
  SKILL_PACK_METADATA_FILE,
  hashText,
} from "../../../workflow/skill-pack.ts";
```

Add helper functions near `writeConfig`:

```ts
async function writeLocalSkill(
  repoRoot: string,
  name: string,
  body: string,
): Promise<void> {
  await mkdir(join(repoRoot, ".patchmill", "skills", name), {
    recursive: true,
  });
  await writeFile(
    join(repoRoot, ".patchmill", "skills", name, "SKILL.md"),
    body,
  );
}

async function writeSkillMetadata(
  repoRoot: string,
  files: Array<{ path: string; body: string }>,
): Promise<void> {
  await mkdir(join(repoRoot, ".patchmill", "skills"), { recursive: true });
  await writeFile(
    join(repoRoot, ".patchmill", "skills", SKILL_PACK_METADATA_FILE),
    `${JSON.stringify(
      {
        pack: {
          name: "patchmill-recommended",
          version: "2026.05",
          source: { type: "npm", package: "superpowers", version: "5.0.7" },
        },
        installedAt: "2026-05-29T00:00:00.000Z",
        skillDir: ".patchmill/skills",
        metadataFile: SKILL_PACK_METADATA_FILE,
        files: files.map((file) => ({
          path: file.path,
          sha256: hashText(file.body),
        })),
      },
      null,
      2,
    )}\n`,
  );
}

function piSkillSmokeMock(
  repoRoot: string,
  skills: string[],
): Record<string, { code: number; stdout?: string; stderr?: string }> {
  const args = skills.flatMap((skill) => [
    "--skill",
    join(repoRoot, ".patchmill", "skills", skill, "SKILL.md"),
  ]);
  return {
    [`pi --no-session --no-context-files --no-prompt-templates ${args.join(" ")} -p Reply with PATCHMILL_SKILLS_OK and nothing else.`]:
      {
        code: 0,
        stdout: "PATCHMILL_SKILLS_OK\n",
      },
  };
}
```

Add tests:

```ts
test("runDoctorChecks passes freshly initialized project-local skills", async () => {
  const repoRoot = await tempRepo();
  const triage =
    "---\nname: patchmill-issue-triage\ndescription: Triage.\n---\n";
  const planning = "---\nname: writing-plans\ndescription: Plan.\n---\n";
  const implementation =
    "---\nname: subagent-driven-development\ndescription: Implement.\n---\n";
  await writeConfig(repoRoot, {
    host: { provider: "forgejo-tea", login: "triage-agent" },
    skills: {
      triage: ".patchmill/skills/patchmill-issue-triage",
      planning: ".patchmill/skills/writing-plans",
      implementation: ".patchmill/skills/subagent-driven-development",
    },
  });
  await mkdir(join(repoRoot, "docs"), { recursive: true });
  await writeLocalSkill(repoRoot, "patchmill-issue-triage", triage);
  await writeLocalSkill(repoRoot, "writing-plans", planning);
  await writeLocalSkill(
    repoRoot,
    "subagent-driven-development",
    implementation,
  );
  await writeSkillMetadata(repoRoot, [
    { path: ".patchmill/skills/patchmill-issue-triage/SKILL.md", body: triage },
    { path: ".patchmill/skills/writing-plans/SKILL.md", body: planning },
    {
      path: ".patchmill/skills/subagent-driven-development/SKILL.md",
      body: implementation,
    },
  ]);
  const runner = runnerFrom(
    successMocks(REQUIRED_LABELS, {
      "git check-ignore -q .patchmill/skills": { code: 1 },
      ...piSkillSmokeMock(repoRoot, [
        "patchmill-issue-triage",
        "writing-plans",
        "subagent-driven-development",
      ]),
    }),
  );

  const results = await runDoctorChecks(runner, {
    repoRoot,
    teaRepoRootForTests: "/repo",
  });
  const skills = results.find((result) => result.name === "skills");

  assert.equal(skills?.status, "pass");
  assert.match(skills?.message ?? "", /project-local metadata verified/);
});

test("runDoctorChecks fails when a local skill is malformed", async () => {
  const repoRoot = await tempRepo();
  await writeConfig(repoRoot, {
    host: { provider: "forgejo-tea", login: "triage-agent" },
    skills: { planning: ".patchmill/skills/writing-plans" },
  });
  await mkdir(join(repoRoot, "docs"), { recursive: true });
  await mkdir(join(repoRoot, ".patchmill"), { recursive: true });
  await writeLocalSkill(repoRoot, "writing-plans", "# Missing frontmatter\n");
  const runner = runnerFrom(successMocks());

  const results = await runDoctorChecks(runner, {
    repoRoot,
    teaRepoRootForTests: "/repo",
  });
  const skills = results.find((result) => result.name === "skills");

  assert.equal(skills?.status, "fail");
  assert.match(
    skills?.message ?? "",
    /missing skill frontmatter with name and description/,
  );
});

test("runDoctorChecks warns when project-local skills are customized", async () => {
  const repoRoot = await tempRepo();
  const original =
    "---\nname: writing-plans\ndescription: Plan.\n---\n# Original\n";
  const customized =
    "---\nname: writing-plans\ndescription: Plan.\n---\n# Customized\n";
  await writeConfig(repoRoot, {
    host: { provider: "forgejo-tea", login: "triage-agent" },
    skills: { planning: ".patchmill/skills/writing-plans" },
  });
  await mkdir(join(repoRoot, "docs"), { recursive: true });
  await writeLocalSkill(repoRoot, "writing-plans", customized);
  await writeSkillMetadata(repoRoot, [
    { path: ".patchmill/skills/writing-plans/SKILL.md", body: original },
  ]);
  const runner = runnerFrom(
    successMocks(REQUIRED_LABELS, {
      "git check-ignore -q .patchmill/skills": { code: 1 },
      ...piSkillSmokeMock(repoRoot, ["writing-plans"]),
    }),
  );

  const results = await runDoctorChecks(runner, {
    repoRoot,
    teaRepoRootForTests: "/repo",
  });
  const skills = results.find((result) => result.name === "skills");

  assert.equal(skills?.status, "warn");
  assert.match(skills?.message ?? "", /customized from installed pack/);
});

test("runDoctorChecks fails when project-local skill directory is gitignored", async () => {
  const repoRoot = await tempRepo();
  const planning = "---\nname: writing-plans\ndescription: Plan.\n---\n";
  await writeConfig(repoRoot, {
    host: { provider: "forgejo-tea", login: "triage-agent" },
    skills: { planning: ".patchmill/skills/writing-plans" },
  });
  await mkdir(join(repoRoot, "docs"), { recursive: true });
  await writeLocalSkill(repoRoot, "writing-plans", planning);
  await writeSkillMetadata(repoRoot, [
    { path: ".patchmill/skills/writing-plans/SKILL.md", body: planning },
  ]);
  const runner = runnerFrom(
    successMocks(REQUIRED_LABELS, {
      "git check-ignore -q .patchmill/skills": {
        code: 0,
        stdout: ".patchmill/skills",
      },
    }),
  );

  const results = await runDoctorChecks(runner, {
    repoRoot,
    teaRepoRootForTests: "/repo",
  });
  const skills = results.find((result) => result.name === "skills");

  assert.equal(skills?.status, "fail");
  assert.match(skills?.message ?? "", /.patchmill\/skills is ignored by git/);
});

test("runDoctorChecks fails when Pi cannot load project-local skills", async () => {
  const repoRoot = await tempRepo();
  const planning = "---\nname: writing-plans\ndescription: Plan.\n---\n";
  await writeConfig(repoRoot, {
    host: { provider: "forgejo-tea", login: "triage-agent" },
    skills: { planning: ".patchmill/skills/writing-plans" },
  });
  await mkdir(join(repoRoot, "docs"), { recursive: true });
  await writeLocalSkill(repoRoot, "writing-plans", planning);
  await writeSkillMetadata(repoRoot, [
    { path: ".patchmill/skills/writing-plans/SKILL.md", body: planning },
  ]);
  const runner = runnerFrom(
    successMocks(REQUIRED_LABELS, {
      "git check-ignore -q .patchmill/skills": { code: 1 },
      [`pi --no-session --no-context-files --no-prompt-templates --skill ${join(repoRoot, ".patchmill", "skills", "writing-plans", "SKILL.md")} -p Reply with PATCHMILL_SKILLS_OK and nothing else.`]:
        {
          code: 1,
          stderr: "skill could not be loaded",
        },
    }),
  );

  const results = await runDoctorChecks(runner, {
    repoRoot,
    teaRepoRootForTests: "/repo",
  });
  const skills = results.find((result) => result.name === "skills");

  assert.equal(skills?.status, "fail");
  assert.match(
    skills?.message ?? "",
    /Pi could not load the project-local skill pack/,
  );
  assert.match(skills?.message ?? "", /skill could not be loaded/);
});
```

Remove the unused `readFile` import if your final version does not use it.

- [ ] **Step 2: Run doctor tests to verify failure**

Run:

```sh
node --test src/cli/commands/doctor/checks.test.ts
```

Expected: FAIL because doctor only checks readability and named-skill warnings.

- [ ] **Step 3: Add skill target shape validation**

In `src/cli/commands/doctor/checks.ts`, update imports:

```ts
import { access, readFile, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import {
  DEFAULT_PROJECT_SKILL_DIR,
  SKILL_PACK_METADATA_FILE,
  hashText,
  type SkillPackMetadataFile,
} from "../../../workflow/skill-pack.ts";
import { isPathLikeSkill } from "../../../workflow/skills.ts";
```

Replace `checkReadableSkillTarget` with:

```ts
type SkillTargetCheck =
  | { ok: true; skillFile: string; text: string }
  | { ok: false; message: string };

async function resolveSkillFile(path: string): Promise<string> {
  const pathStat = await stat(path);
  return pathStat.isDirectory() ? join(path, "SKILL.md") : path;
}

function hasSkillFrontmatter(text: string): boolean {
  return /^---\s*\n[\s\S]*?^name:\s*\S+[\s\S]*?^description:\s*/mu.test(text);
}

async function checkSkillTarget(path: string): Promise<SkillTargetCheck> {
  try {
    const skillFile = await resolveSkillFile(path);
    const text = await readFile(skillFile, "utf8");
    if (!hasSkillFrontmatter(text)) {
      return {
        ok: false,
        message: "missing skill frontmatter with name and description",
      };
    }
    return { ok: true, skillFile, text };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return { ok: false, message: `configured path unreadable at ${path}` };
    }
    return {
      ok: false,
      message: error instanceof Error ? error.message : String(error),
    };
  }
}
```

- [ ] **Step 4: Add metadata and git-ignore checks**

Add helpers above `checkSkills`:

```ts
function projectRelative(repoRoot: string, absolutePath: string): string {
  return absolutePath.startsWith(repoRoot)
    ? absolutePath.slice(repoRoot.length + 1).replace(/\\/gu, "/")
    : absolutePath.replace(/\\/gu, "/");
}

async function readSkillPackMetadata(
  repoRoot: string,
): Promise<SkillPackMetadataFile | undefined> {
  try {
    return JSON.parse(
      await readFile(
        resolve(repoRoot, DEFAULT_PROJECT_SKILL_DIR, SKILL_PACK_METADATA_FILE),
        "utf8",
      ),
    ) as SkillPackMetadataFile;
  } catch {
    return undefined;
  }
}

async function checkSkillGitIgnore(
  runner: CommandRunner,
  repoRoot: string,
): Promise<"not-ignored" | "ignored" | "unknown"> {
  const result = await runner.run(
    "git",
    ["check-ignore", "-q", DEFAULT_PROJECT_SKILL_DIR],
    {
      cwd: repoRoot,
    },
  );
  if (result.code === 0) return "ignored";
  if (result.code === 1) return "not-ignored";
  return "unknown";
}

async function checkPiLoadsSkills(
  runner: CommandRunner,
  repoRoot: string,
  skillFiles: string[],
): Promise<DoctorCheckResult | undefined> {
  if (skillFiles.length === 0) return undefined;
  const result = await runner.run(
    "pi",
    [
      "--no-session",
      "--no-context-files",
      "--no-prompt-templates",
      ...skillFiles.flatMap((skillFile) => ["--skill", skillFile]),
      "-p",
      "Reply with PATCHMILL_SKILLS_OK and nothing else.",
    ],
    { cwd: repoRoot },
  );
  if (result.code === 0 && result.stdout.includes("PATCHMILL_SKILLS_OK")) {
    return pass("pi skills", "Pi loaded the project-local skill pack");
  }
  return fail(
    "pi skills",
    `Pi could not load the project-local skill pack: ${commandOutput(result)}`,
    [
      "Patchmill passed the project-local skill pack files to Pi with --skill.",
      "Fix the reported skill parse/load error, then rerun:",
      "  patchmill doctor",
    ],
  );
}
```

Change `checkSkills` signature:

```ts
async function checkSkills(
  runner: CommandRunner,
  config: PatchmillConfig,
  repoRoot: string,
): Promise<DoctorCheckResult> {
```

Within `checkSkills`, collect verified local skill files and compare them to
metadata:

```ts
const checkedFiles: Array<{
  relativePath: string;
  absolutePath: string;
  text: string;
}> = [];
```

When a path-like skill check passes, push:

```ts
checkedFiles.push({
  relativePath: projectRelative(repoRoot, checked.skillFile),
  absolutePath: checked.skillFile,
  text: checked.text,
});
```

After building `entries`, add metadata and git-ignore entries when any checked
file starts with `.patchmill/skills/`:

```ts
const hasProjectLocalSkills = checkedFiles.some((file) =>
  file.relativePath.startsWith(`${DEFAULT_PROJECT_SKILL_DIR}/`),
);
if (hasProjectLocalSkills) {
  const ignored = await checkSkillGitIgnore(runner, repoRoot);
  if (ignored === "ignored") {
    entries.push({
      status: "fail" as const,
      summary: `${DEFAULT_PROJECT_SKILL_DIR} is ignored by git`,
    });
  } else if (ignored === "unknown") {
    entries.push({
      status: "warn" as const,
      summary: `${DEFAULT_PROJECT_SKILL_DIR} git-ignore status could not be verified`,
    });
  }

  const metadata = await readSkillPackMetadata(repoRoot);
  if (!metadata) {
    entries.push({
      status: "warn" as const,
      summary: "project-local skill pack metadata missing",
    });
  } else {
    const metadataHashes = new Map(
      metadata.files.map((file) => [file.path, file.sha256]),
    );
    const customized = checkedFiles.filter((file) => {
      const expected = metadataHashes.get(file.relativePath);
      return expected !== undefined && expected !== hashText(file.text);
    });
    entries.push(
      customized.length > 0
        ? {
            status: "warn" as const,
            summary: `${customized.map((file) => file.relativePath).join(", ")} customized from installed pack`,
          }
        : {
            status: "pass" as const,
            summary: "project-local metadata verified",
          },
    );
  }
}
```

Inside the `hasProjectLocalSkills` block, ask Pi to load the project-local skill
pack when no skill validation failure has already been found. Use metadata file
paths when metadata exists so the smoke test covers every installed pack skill,
not only the currently configured stages:

```ts
const projectLocalSkillFiles = metadata
  ? metadata.files
      .filter((file) => file.path.startsWith(`${DEFAULT_PROJECT_SKILL_DIR}/`))
      .map((file) => resolve(repoRoot, file.path))
  : checkedFiles
      .filter((file) =>
        file.relativePath.startsWith(`${DEFAULT_PROJECT_SKILL_DIR}/`),
      )
      .map((file) => file.absolutePath);

if (!entries.some((entry) => entry.status === "fail")) {
  const piSkills = await checkPiLoadsSkills(
    runner,
    repoRoot,
    projectLocalSkillFiles,
  );
  if (piSkills) {
    entries.push({ status: piSkills.status, summary: piSkills.message });
  }
}
```

Update the call site in `runDoctorChecks`:

```ts
results.push(await checkSkills(runner, config, options.repoRoot));
```

- [ ] **Step 5: Run doctor tests to verify pass**

Run:

```sh
node --test src/cli/commands/doctor/checks.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit doctor validation**

Run:

```sh
git add src/cli/commands/doctor/checks.ts src/cli/commands/doctor/checks.test.ts
git commit -m "feat(doctor): validate project-local skills"
```

---

## Task 9: Update documentation

**Files:**

- Modify: `README.md`
- Modify: `docs/configuration.md`
- Modify: `docs/skills.md`
- Modify: `docs/issue-agent-workflows.md`

- [ ] **Step 1: Update README first-use flow**

Edit the README onboarding section so it states:

```md
patchmill init
```

creates `patchmill.config.json` and installs Patchmill's recommended skills into
`.patchmill/skills/` by default. The skill files should be committed because
they govern how Patchmill plans and implements code changes.

Document alternatives:

```sh
patchmill init --skills project
patchmill init --skills global
patchmill init --skills none
patchmill init --skills path:project-skills
```

- [ ] **Step 2: Update configuration docs**

In `docs/configuration.md`, update the skills default section so it explains:

````md
For new repositories, `patchmill init` writes project-local skill mappings by
default:

```json
{
  "skills": {
    "triage": ".patchmill/skills/patchmill-issue-triage",
    "planning": ".patchmill/skills/writing-plans",
    "implementation": ".patchmill/skills/subagent-driven-development"
  }
}
```

If no config file overrides skills, Patchmill still has built-in defaults for
compatibility with older repositories.
````

- [ ] **Step 3: Update skills docs**

In `docs/skills.md`, add a section named `Project-local default skills` with
this content:

```md
`patchmill init` installs the recommended skill pack into `.patchmill/skills/`
unless a different `--skills` mode is selected. Commit this directory to git.
Skill changes are process changes: they affect how Patchmill triages, plans,
implements, reviews, and validates work.

Patchmill treats the installed files as project-owned after init. It does not
silently overwrite edited skills. `patchmill doctor` warns when installed skills
differ from the recorded pack metadata and fails when configured required skill
paths are missing or malformed.
```

- [ ] **Step 4: Update issue workflow docs**

In `docs/issue-agent-workflows.md`, update the init/doctor preflight description
so it says doctor verifies configured local skills, asks Pi to load the
project-local skill pack, and checks that `.patchmill/skills/` is not ignored by
git.

- [ ] **Step 5: Run docs lint**

Run:

```sh
npm run lint:md
```

Expected: PASS.

- [ ] **Step 6: Commit docs**

Run:

```sh
git add README.md docs/configuration.md docs/skills.md docs/issue-agent-workflows.md
git commit -m "docs(skills): document project-local defaults"
```

---

## Task 10: Full verification

**Files:**

- Verify all changed files.

- [ ] **Step 1: Run focused test suites**

Run:

```sh
node --test src/workflow/*.test.ts src/cli/commands/init/*.test.ts src/cli/commands/doctor/*.test.ts src/cli/commands/triage/dry-run-agent.test.ts src/cli/commands/triage/execute-agent.test.ts src/cli/commands/run-once/pi.test.ts src/pi/runner.test.ts
```

Expected: all listed tests PASS.

- [ ] **Step 2: Run full test suite**

Run:

```sh
npm test
```

Expected: all tests PASS.

- [ ] **Step 3: Run lint**

Run:

```sh
npm run lint
```

Expected: format check, TypeScript lint, and markdown lint all PASS.

- [ ] **Step 4: Smoke-test init in a temporary git repo**

Run:

```sh
tmpdir=$(mktemp -d)
cd "$tmpdir"
git init
node /home/roche/projects/patchmill/bin/patchmill.ts init --skills project
find .patchmill/skills -maxdepth 2 -name SKILL.md | sort
node -e "const fs=require('fs'); const cfg=JSON.parse(fs.readFileSync('patchmill.config.json','utf8')); console.log(JSON.stringify(cfg.skills, null, 2));"
git status --short
```

Expected output includes:

```text
.patchmill/skills/patchmill-issue-triage/SKILL.md
.patchmill/skills/subagent-driven-development/SKILL.md
.patchmill/skills/writing-plans/SKILL.md
```

Expected config output:

```json
{
  "triage": ".patchmill/skills/patchmill-issue-triage",
  "planning": ".patchmill/skills/writing-plans",
  "implementation": ".patchmill/skills/subagent-driven-development"
}
```

Expected `git status --short` includes untracked `patchmill.config.json` and
`.patchmill/skills/`, proving the skills are not ignored and are ready to
commit.

- [ ] **Step 5: Inspect final diff**

Run:

```sh
git diff --stat HEAD~10..HEAD
git status --short
```

Expected: committed changes are grouped by the task commits above, and
`git status --short` is empty.
