# Patchmill Doctor Pi Resources Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `patchmill doctor` print compact, profile-specific Pi resource summaries without mutating package state, writing trust decisions, or executing extension code.

**Architecture:** Extract Patchmill Pi invocation resource profiles into shared code used by both runtime argument builders and doctor. Doctor uses a static, non-mutating Pi resource resolver built from Pi's exported `DefaultPackageManager`, `SettingsManager`, `ProjectTrustStore`, `loadSkills()`, and context-file helpers; it never calls `DefaultResourceLoader.reload()` for resource listing.

**Tech Stack:** TypeScript, Node.js built-in test runner, Pi SDK exports from `@earendil-works/pi-coding-agent`, existing Patchmill config and skill-resolution helpers.

## Global Constraints

- Do not call `DefaultResourceLoader.reload()` for doctor resource listing.
- Do not install missing npm/git Pi package sources during doctor resource discovery; skip and report them.
- Do not execute extension modules merely to list resources.
- Match non-interactive Pi project-trust behavior without prompting and without writing `trust.json`.
- Report named profiles instead of one vague resource set: run-once planning, run-once development-environment, run-once implementation, and triage.
- `patchmill doctor --quiet` suppresses resource-only output when no required readiness check fails.
- Resource-summary warnings must not make `doctor` fail unless an existing required check also fails.
- Unit tests must stub doctor resource loading and must not assert the exact contents of a developer's machine-specific Pi configuration.
- No dependency changes are planned; if dependency files change unexpectedly, rerun the Nix build before completion.

---

## File Structure

- Create `src/pi/resource-profiles.ts` for shared Patchmill Pi invocation resource profiles and argument helpers.
- Create `src/pi/resource-profiles.test.ts` for deterministic profile tests.
- Modify runtime Pi invocation files to consume `src/pi/resource-profiles.ts` instead of rebuilding profile-specific skill/context/extension arguments inline:
  - `src/cli/commands/run-once/pi.ts`
  - `src/pi/runner.ts`
  - `src/cli/commands/run-once/development-environment-stage.ts`
  - `src/cli/commands/run-once/stage-advancement.ts`
  - `src/cli/commands/run-once/pipeline.ts`
  - `src/cli/commands/triage/dry-run-agent.ts`
  - `src/cli/commands/triage/execute-agent.ts`
- Create `src/cli/commands/doctor/pi-resources.ts` for static non-mutating discovery, compact formatting, trust parity, and warning conversion.
- Create `src/cli/commands/doctor/pi-resources.test.ts` for resource resolver and formatter behavior.
- Modify `src/cli/commands/doctor/reporting.ts` and `src/cli/commands/doctor/reporting.test.ts` to prepend profile resource blocks while preserving existing report semantics.
- Modify `src/cli/commands/doctor/main.ts` and `src/cli/commands/doctor/main.test.ts` to collect resources safely, append warning checks, and centralize quiet behavior.

---

### Task 1: Extract Shared Pi Resource Profiles

**Files:**

- Create: `src/pi/resource-profiles.ts`
- Create: `src/pi/resource-profiles.test.ts`
- Modify: `src/cli/commands/run-once/pi.ts`
- Modify: `src/pi/runner.ts`
- Modify: `src/cli/commands/run-once/development-environment-stage.ts`
- Modify: `src/cli/commands/run-once/stage-advancement.ts`
- Modify: `src/cli/commands/run-once/pipeline.ts`
- Modify: `src/cli/commands/triage/dry-run-agent.ts`
- Modify: `src/cli/commands/triage/execute-agent.ts`

**Interfaces:**

- Consumes: `PatchmillSkillsConfig`, `PATCHMILL_SKILL_KEYS`, and `skillInvocationPaths()` from `src/workflow/skills.ts`.
- Produces:
  - `PatchmillPiResourceProfile`
  - `runOncePlanningPiProfile(skills, repoRoot)`
  - `runOnceDevelopmentEnvironmentPiProfile(skills, repoRoot)`
  - `runOnceImplementationPiProfile(skills, repoRoot)`
  - `triagePiProfile(skills, repoRoot)`
  - `doctorPiResourceProfiles(skills, repoRoot)`
  - `profileSkillArgs(profile)`
  - `profileExtensionArgs(profile)`
  - `profileContextArgs(profile)`

- [ ] **Step 1: Write failing profile tests**

Create `src/pi/resource-profiles.test.ts`:

```typescript
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { test } from "node:test";
import {
  doctorPiResourceProfiles,
  profileContextArgs,
  profileExtensionArgs,
  profileSkillArgs,
  runOnceImplementationPiProfile,
  runOncePlanningPiProfile,
  triagePiProfile,
} from "./resource-profiles.ts";
import type { PatchmillSkillsConfig } from "../workflow/skills.ts";

async function withRepo<T>(fn: (repoRoot: string) => Promise<T>): Promise<T> {
  const repoRoot = await mkdtemp(join(tmpdir(), "patchmill-profile-"));
  try {
    return await fn(repoRoot);
  } finally {
    await rm(repoRoot, { recursive: true, force: true });
  }
}

const skills: PatchmillSkillsConfig = {
  triage: "./skills/triage",
  planning: "./skills/planning",
  implementation: "./skills/implementation",
  developmentEnvironment: "./skills/development-environment",
  toolchain: "./skills/toolchain",
  review: "./skills/review",
  visualEvidence: "./skills/visual-evidence",
  landing: "./skills/landing",
};

test("run-once planning profile includes context and Patchmill run-once extensions", async () => {
  await withRepo(async (repoRoot) => {
    const profile = runOncePlanningPiProfile(skills, repoRoot);

    assert.equal(profile.id, "run-once-planning");
    assert.equal(profile.noContextFiles, false);
    assert.equal(profile.noPromptTemplates, false);
    assert.equal(profile.additionalExtensionPaths.length, 2);
    assert.equal(basename(profile.additionalExtensionPaths[0] ?? ""), "pi-subagents");
    assert.equal(
      profile.additionalExtensionPaths[1]?.replaceAll("\\", "/").endsWith("/extensions/todos.ts"),
      true,
    );
    assert.deepEqual(profile.additionalSkillPaths, [
      join(repoRoot, "skills", "planning", "SKILL.md"),
    ]);
  });
});

test("run-once implementation profile includes every implementation-stage skill slot", async () => {
  await withRepo(async (repoRoot) => {
    assert.deepEqual(
      runOnceImplementationPiProfile(skills, repoRoot).additionalSkillPaths,
      [
        join(repoRoot, "skills", "toolchain", "SKILL.md"),
        join(repoRoot, "skills", "implementation", "SKILL.md"),
        join(repoRoot, "skills", "review", "SKILL.md"),
        join(repoRoot, "skills", "visual-evidence", "SKILL.md"),
        join(repoRoot, "skills", "landing", "SKILL.md"),
      ],
    );
  });
});

test("triage profile mirrors triage agents", async () => {
  await withRepo(async (repoRoot) => {
    const profile = triagePiProfile(skills, repoRoot);

    assert.equal(profile.id, "triage");
    assert.equal(profile.noContextFiles, true);
    assert.deepEqual(profile.additionalExtensionPaths, []);
    assert.deepEqual(profileContextArgs(profile), ["--no-context-files"]);
    assert.deepEqual(profileSkillArgs(profile), [
      "--skill",
      join(repoRoot, "skills", "triage", "SKILL.md"),
    ]);
  });
});

test("profile argument helpers render extension and skill flags", async () => {
  await withRepo(async (repoRoot) => {
    const profile = runOncePlanningPiProfile(skills, repoRoot);

    assert.deepEqual(profileExtensionArgs(profile), [
      "-e",
      profile.additionalExtensionPaths[0],
      "-e",
      profile.additionalExtensionPaths[1],
    ]);
    assert.deepEqual(profileSkillArgs(profile), [
      "--skill",
      join(repoRoot, "skills", "planning", "SKILL.md"),
    ]);
  });
});

test("doctorPiResourceProfiles returns every reported profile in stable order", async () => {
  await withRepo(async (repoRoot) => {
    assert.deepEqual(
      doctorPiResourceProfiles(skills, repoRoot).map((profile) => profile.id),
      [
        "run-once-planning",
        "run-once-development-environment",
        "run-once-implementation",
        "triage",
      ],
    );
  });
});
```

- [ ] **Step 2: Run profile tests to verify they fail**

Run:

```bash
node --test src/pi/resource-profiles.test.ts
```

Expected: FAIL because `src/pi/resource-profiles.ts` does not exist.

- [ ] **Step 3: Implement shared profiles and argument helpers**

Create `src/pi/resource-profiles.ts`:

```typescript
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  skillInvocationPaths,
  type PatchmillSkillsConfig,
} from "../workflow/skills.ts";

const require = createRequire(import.meta.url);
const PI_SUBAGENTS_PACKAGE_ROOT = dirname(
  require.resolve("pi-subagents/package.json"),
);
const PATCHMILL_PACKAGE_ROOT = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const PATCHMILL_TODOS_EXTENSION = join(
  PATCHMILL_PACKAGE_ROOT,
  "extensions",
  "todos.ts",
);

export type PatchmillPiResourceProfileId =
  | "run-once-planning"
  | "run-once-development-environment"
  | "run-once-implementation"
  | "triage";

export type PatchmillPiResourceProfile = {
  id: PatchmillPiResourceProfileId;
  label: string;
  noContextFiles: boolean;
  noPromptTemplates: boolean;
  additionalExtensionPaths: string[];
  additionalSkillPaths: string[];
};

function runOnceExtensionPaths(): string[] {
  return [PI_SUBAGENTS_PACKAGE_ROOT, PATCHMILL_TODOS_EXTENSION];
}

function profile(
  input: Omit<PatchmillPiResourceProfile, "additionalSkillPaths"> & {
    skills: Array<string | undefined>;
    repoRoot: string;
  },
): PatchmillPiResourceProfile {
  return {
    id: input.id,
    label: input.label,
    noContextFiles: input.noContextFiles,
    noPromptTemplates: input.noPromptTemplates,
    additionalExtensionPaths: input.additionalExtensionPaths,
    additionalSkillPaths: skillInvocationPaths(input.skills, input.repoRoot),
  };
}

export function runOncePlanningPiProfile(
  skills: PatchmillSkillsConfig,
  repoRoot: string,
): PatchmillPiResourceProfile {
  return profile({
    id: "run-once-planning",
    label: "run-once planning",
    noContextFiles: false,
    noPromptTemplates: false,
    additionalExtensionPaths: runOnceExtensionPaths(),
    skills: [skills.planning],
    repoRoot,
  });
}

export function runOnceDevelopmentEnvironmentPiProfile(
  skills: PatchmillSkillsConfig,
  repoRoot: string,
): PatchmillPiResourceProfile {
  return profile({
    id: "run-once-development-environment",
    label: "run-once development-environment",
    noContextFiles: false,
    noPromptTemplates: false,
    additionalExtensionPaths: runOnceExtensionPaths(),
    skills: [skills.developmentEnvironment],
    repoRoot,
  });
}

export function runOnceImplementationPiProfile(
  skills: PatchmillSkillsConfig,
  repoRoot: string,
): PatchmillPiResourceProfile {
  return profile({
    id: "run-once-implementation",
    label: "run-once implementation",
    noContextFiles: false,
    noPromptTemplates: false,
    additionalExtensionPaths: runOnceExtensionPaths(),
    skills: [
      skills.toolchain,
      skills.implementation,
      skills.review,
      skills.visualEvidence,
      skills.landing,
    ],
    repoRoot,
  });
}

export function triagePiProfile(
  skills: PatchmillSkillsConfig,
  repoRoot: string,
): PatchmillPiResourceProfile {
  return profile({
    id: "triage",
    label: "triage",
    noContextFiles: true,
    noPromptTemplates: false,
    additionalExtensionPaths: [],
    skills: [skills.triage],
    repoRoot,
  });
}

export function doctorPiResourceProfiles(
  skills: PatchmillSkillsConfig,
  repoRoot: string,
): PatchmillPiResourceProfile[] {
  return [
    runOncePlanningPiProfile(skills, repoRoot),
    runOnceDevelopmentEnvironmentPiProfile(skills, repoRoot),
    runOnceImplementationPiProfile(skills, repoRoot),
    triagePiProfile(skills, repoRoot),
  ];
}

export function profileContextArgs(
  profile: PatchmillPiResourceProfile,
): string[] {
  return profile.noContextFiles ? ["--no-context-files"] : [];
}

export function profilePromptTemplateArgs(
  profile: PatchmillPiResourceProfile,
): string[] {
  return profile.noPromptTemplates ? ["--no-prompt-templates"] : [];
}

export function profileExtensionArgs(
  profile: PatchmillPiResourceProfile,
): string[] {
  return profile.additionalExtensionPaths.flatMap((path) => ["-e", path]);
}

export function profileSkillArgs(profile: PatchmillPiResourceProfile): string[] {
  return profile.additionalSkillPaths.flatMap((path) => ["--skill", path]);
}
```

- [ ] **Step 4: Refactor run-once argument generation to use profile extension args**

Modify `src/cli/commands/run-once/pi.ts`:

```typescript
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { profileExtensionArgs } from "../../../pi/resource-profiles.ts";
```

Replace the private `createRequire`, `PI_SUBAGENTS_PACKAGE_ROOT`, `PATCHMILL_PACKAGE_ROOT`, and `PATCHMILL_TODOS_EXTENSION` constants with a local lightweight profile argument parameter:

```typescript
function piPromptArgs(
  promptPath: string,
  sessionDir?: string,
  skillPaths: string[] = [],
  extensionArgs: string[] = [],
): string[] {
  const skillArgs = skillPaths.flatMap((path) => ["--skill", path]);
  const baseArgs = [...extensionArgs, ...skillArgs, "-p"];
  return sessionDir
    ? [...baseArgs, "--session-dir", sessionDir, `@${promptPath}`]
    : [...baseArgs, `@${promptPath}`];
}
```

Add `extensionArgs?: string[]` to `RunPiPromptOptions`. In the `runner.run()` call, pass:

```typescript
piPromptArgs(
  promptPath,
  sessionDir,
  options?.skillPaths,
  options?.extensionArgs,
),
```

Do not call `profileExtensionArgs()` here directly. Runtime callers supply the profile-specific extension args so doctor and invocation call sites share the same profile builder.

- [ ] **Step 5: Refactor runtime call sites to consume profile builders**

Update each call site so the profile is constructed once and its `additionalSkillPaths` and `profileExtensionArgs(profile)` values are passed to Pi.

In `src/pi/runner.ts`, import profile builders:

```typescript
import {
  profileExtensionArgs,
  runOnceImplementationPiProfile,
  runOncePlanningPiProfile,
} from "./resource-profiles.ts";
```

In `plan()`, before `runPiPrompt()`:

```typescript
const profile = runOncePlanningPiProfile(
  input.skills ?? DEFAULT_PATCHMILL_SKILLS,
  input.repoRoot,
);
```

Use:

```typescript
skillPaths: profile.additionalSkillPaths,
extensionArgs: profileExtensionArgs(profile),
```

In `implementation()`, construct:

```typescript
const profile = runOnceImplementationPiProfile(
  input.skills ?? DEFAULT_PATCHMILL_SKILLS,
  input.repoRoot,
);
```

Use the same `skillPaths` and `extensionArgs` properties.

For `src/cli/commands/run-once/development-environment-stage.ts`, `src/cli/commands/run-once/stage-advancement.ts`, and `src/cli/commands/run-once/pipeline.ts`, replace direct `skillInvocationPaths(...)` calls for run-once Pi prompts with the appropriate `runOnceDevelopmentEnvironmentPiProfile()`, `runOncePlanningPiProfile()`, or `runOnceImplementationPiProfile()` call. Pass both:

```typescript
skillPaths: profile.additionalSkillPaths,
extensionArgs: profileExtensionArgs(profile),
```

For `src/cli/commands/triage/dry-run-agent.ts` and `src/cli/commands/triage/execute-agent.ts`, import:

```typescript
import {
  profileContextArgs,
  profileSkillArgs,
  triagePiProfile,
} from "../../../pi/resource-profiles.ts";
```

Replace the local `skillArgs` construction with:

```typescript
const profile = triagePiProfile(skills, repoRoot);
```

Replace the hardcoded context and skill flag segment with:

```typescript
...profileContextArgs(profile),
...sessionArgs,
...profileSkillArgs(profile),
```

- [ ] **Step 6: Run focused runtime profile tests**

Run:

```bash
node --test src/pi/resource-profiles.test.ts src/cli/commands/run-once/pi.test.ts src/pi/runner.test.ts src/cli/commands/triage/dry-run-agent.test.ts src/cli/commands/triage/execute-agent.test.ts
```

Expected: PASS. Existing argument tests should still observe the same Pi command flags, now sourced from shared profile builders.

- [ ] **Step 7: Commit Task 1**

Run:

```bash
git add src/pi/resource-profiles.ts src/pi/resource-profiles.test.ts src/cli/commands/run-once/pi.ts src/pi/runner.ts src/cli/commands/run-once/development-environment-stage.ts src/cli/commands/run-once/stage-advancement.ts src/cli/commands/run-once/pipeline.ts src/cli/commands/triage/dry-run-agent.ts src/cli/commands/triage/execute-agent.ts
git commit -m "refactor(pi): share resource profiles"
```

---

### Task 2: Implement Non-Mutating Doctor Resource Discovery

**Files:**

- Create: `src/cli/commands/doctor/pi-resources.ts`
- Create: `src/cli/commands/doctor/pi-resources.test.ts`

**Interfaces:**

- Consumes: shared profiles from Task 1, `loadPatchmillConfigState()`, `localPiAgentDir()`, Pi `DefaultPackageManager`, `SettingsManager`, `ProjectTrustStore`, `hasTrustRequiringProjectResources()`, `loadSkills()`, and `loadProjectContextFiles()`.
- Produces:
  - `DoctorPiResourceBlock`
  - `DoctorPiResourceReport`
  - `DoctorPiResourceProvider`
  - `loadDoctorPiResources(repoRoot, env?)`
  - `formatPiResourceBlocks(blocks)`
  - `piResourceDiscoveryFailureCheck(error)`

- [ ] **Step 1: Write failing discovery/formatting tests**

Create `src/cli/commands/doctor/pi-resources.test.ts`:

```typescript
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  compactProfileBlock,
  formatPiResourceBlocks,
  piResourceDiscoveryFailureCheck,
  piResourceWarningCheck,
} from "./pi-resources.ts";

const repoRoot = "/repo/project";

test("compactProfileBlock builds sorted compact sections", () => {
  const block = compactProfileBlock({
    label: "run-once planning",
    contextFiles: [join(repoRoot, "AGENTS.md")],
    skillNames: ["github", "brainstorming"],
    promptNames: ["review-loop", "parallel-review"],
    extensionPaths: [
      join(repoRoot, "extensions", "todos.ts"),
      join(repoRoot, "extensions", "pi-remote", "extension", "index.ts"),
    ],
    repoRoot,
  });

  assert.deepEqual(block, {
    label: "run-once planning",
    sections: [
      { heading: "Context", items: ["AGENTS.md"] },
      { heading: "Skills", items: ["brainstorming", "github"] },
      { heading: "Prompts", items: ["/parallel-review", "/review-loop"] },
      { heading: "Extensions", items: ["extension", "todos.ts"] },
    ],
  });
});

test("formatPiResourceBlocks prints profile blocks", () => {
  assert.deepEqual(
    formatPiResourceBlocks([
      {
        label: "run-once planning",
        sections: [
          { heading: "Context", items: ["AGENTS.md"] },
          { heading: "Skills", items: ["github"] },
        ],
      },
    ]),
    [
      "[Pi resources: run-once planning]",
      "",
      "[Context]",
      "  AGENTS.md",
      "",
      "[Skills]",
      "  github",
    ],
  );
});

test("compactProfileBlock omits empty categories", () => {
  assert.deepEqual(
    compactProfileBlock({
      label: "triage",
      contextFiles: [],
      skillNames: [],
      promptNames: ["review-loop"],
      extensionPaths: [],
      repoRoot,
    }),
    {
      label: "triage",
      sections: [{ heading: "Prompts", items: ["/review-loop"] }],
    },
  );
});

test("piResourceWarningCheck returns undefined without warnings", () => {
  assert.equal(piResourceWarningCheck([]), undefined);
});

test("piResourceWarningCheck reports skipped packages without failing", () => {
  assert.deepEqual(piResourceWarningCheck(["skipped missing package npm:@acme/pi-tools"]), {
    name: "pi resources",
    status: "warn",
    message: "skipped missing package npm:@acme/pi-tools",
    remediation: [
      "Patchmill doctor listed Pi resources without installing missing packages or executing extensions.",
      "Install or update the listed Pi package sources outside doctor if you want those resources loaded, then rerun:",
      "  patchmill doctor",
    ],
  });
});

test("piResourceDiscoveryFailureCheck creates a non-failing warning", () => {
  assert.deepEqual(piResourceDiscoveryFailureCheck(new Error("boom")), {
    name: "pi resources",
    status: "warn",
    message: "could not list Pi resources: boom",
    remediation: [
      "Patchmill doctor could not list Pi's startup resources.",
      "The readiness checks still ran; fix the Pi resource discovery error, then rerun:",
      "  patchmill doctor",
    ],
  });
});

test("non-mutating discovery skips missing configured package sources", async () => {
  const tmp = await mkdtemp(join(tmpdir(), "patchmill-doctor-resources-"));
  try {
    await writeFile(
      join(tmp, "patchmill.config.json"),
      JSON.stringify({ host: { provider: "forgejo-tea", repo: "OWNER/repo" } }),
      "utf8",
    );
    await mkdir(join(tmp, ".patchmill", "pi-agent"), { recursive: true });
    await writeFile(
      join(tmp, ".patchmill", "pi-agent", "settings.json"),
      JSON.stringify({ packages: ["npm:@missing/package@1.0.0"] }),
      "utf8",
    );

    const { loadDoctorPiResources } = await import("./pi-resources.ts");
    const report = await loadDoctorPiResources(tmp, {});

    assert.equal(report.check?.status, "warn");
    assert.match(report.check?.message ?? "", /skipped missing package npm:@missing\/package@1\.0\.0/);
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
node --test src/cli/commands/doctor/pi-resources.test.ts
```

Expected: FAIL because `src/cli/commands/doctor/pi-resources.ts` does not exist.

- [ ] **Step 3: Implement compact block formatting and warning helpers**

Create `src/cli/commands/doctor/pi-resources.ts` with these exports:

```typescript
import { homedir } from "node:os";
import {
  basename,
  dirname,
  isAbsolute,
  join,
  parse,
  relative,
  resolve,
} from "node:path";
import {
  DefaultPackageManager,
  hasTrustRequiringProjectResources,
  loadProjectContextFiles,
  loadSkills,
  ProjectTrustStore,
  SettingsManager,
  type MissingSourceAction,
  type ResolvedResource,
} from "@earendil-works/pi-coding-agent";
import { loadPatchmillConfigState } from "../../../config/load.ts";
import {
  doctorPiResourceProfiles,
  type PatchmillPiResourceProfile,
} from "../../../pi/resource-profiles.ts";
import { localPiAgentDir } from "../init/pi-agent-settings.ts";
import type { DoctorCheckResult } from "./checks.ts";

export type DoctorPiResourceSection = {
  heading: "Context" | "Skills" | "Prompts" | "Extensions";
  items: string[];
};

export type DoctorPiResourceBlock = {
  label: string;
  sections: DoctorPiResourceSection[];
};

export type DoctorPiResourceReport = {
  blocks: DoctorPiResourceBlock[];
  check?: DoctorCheckResult;
};

export type DoctorPiResourceProvider = (
  repoRoot: string,
) => Promise<DoctorPiResourceReport>;
```

Add path/format helpers:

```typescript
function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function uniqueSorted(values: string[]): string[] {
  return [...new Set(values.filter((value) => value.trim().length > 0))].sort(
    (a, b) => a.localeCompare(b),
  );
}

function isInside(parent: string, child: string): boolean {
  const rel = relative(parent, child);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

function slashPath(path: string): string {
  return path.replaceAll("\\", "/");
}

function displayPath(path: string, repoRoot: string): string {
  const resolvedPath = resolve(path);
  const resolvedRepoRoot = resolve(repoRoot);
  if (isInside(resolvedRepoRoot, resolvedPath)) {
    const rel = relative(resolvedRepoRoot, resolvedPath);
    return slashPath(rel || basename(resolvedPath));
  }

  const home = homedir();
  if (isInside(home, resolvedPath)) {
    return slashPath(join("~", relative(home, resolvedPath)));
  }

  return slashPath(path);
}

function compactExtensionLabel(path: string): string {
  const normalizedPath = slashPath(path);
  const parsed = parse(normalizedPath);
  return parsed.base === "index.ts" || parsed.base === "index.js"
    ? basename(dirname(normalizedPath))
    : parsed.base;
}
```

Add block formatting exports:

```typescript
export function compactProfileBlock(input: {
  label: string;
  contextFiles: string[];
  skillNames: string[];
  promptNames: string[];
  extensionPaths: string[];
  repoRoot: string;
}): DoctorPiResourceBlock {
  const sections: DoctorPiResourceSection[] = [];

  const context = input.contextFiles.map((path) => displayPath(path, input.repoRoot));
  if (context.length > 0) sections.push({ heading: "Context", items: context });

  const skills = uniqueSorted(input.skillNames);
  if (skills.length > 0) sections.push({ heading: "Skills", items: skills });

  const prompts = uniqueSorted(input.promptNames.map((name) => `/${name}`));
  if (prompts.length > 0) sections.push({ heading: "Prompts", items: prompts });

  const extensions = uniqueSorted(input.extensionPaths.map(compactExtensionLabel));
  if (extensions.length > 0) {
    sections.push({ heading: "Extensions", items: extensions });
  }

  return { label: input.label, sections };
}

export function formatPiResourceBlocks(
  blocks: DoctorPiResourceBlock[],
): string[] {
  return blocks.flatMap((block, blockIndex) => [
    ...(blockIndex === 0 ? [] : [""]),
    `[Pi resources: ${block.label}]`,
    "",
    ...block.sections.flatMap((section, sectionIndex) => [
      ...(sectionIndex === 0 ? [] : [""]),
      `[${section.heading}]`,
      `  ${section.items.join(", ")}`,
    ]),
  ]);
}

export function piResourceWarningCheck(
  warnings: string[],
): DoctorCheckResult | undefined {
  if (warnings.length === 0) return undefined;
  return {
    name: "pi resources",
    status: "warn",
    message: warnings.join("; "),
    remediation: [
      "Patchmill doctor listed Pi resources without installing missing packages or executing extensions.",
      "Install or update the listed Pi package sources outside doctor if you want those resources loaded, then rerun:",
      "  patchmill doctor",
    ],
  };
}

export function piResourceDiscoveryFailureCheck(
  error: unknown,
): DoctorCheckResult {
  return {
    name: "pi resources",
    status: "warn",
    message: `could not list Pi resources: ${errorMessage(error)}`,
    remediation: [
      "Patchmill doctor could not list Pi's startup resources.",
      "The readiness checks still ran; fix the Pi resource discovery error, then rerun:",
      "  patchmill doctor",
    ],
  };
}
```

- [ ] **Step 4: Implement trust parity and non-mutating static discovery**

Append these helpers and `loadDoctorPiResources()` to `src/cli/commands/doctor/pi-resources.ts`:

```typescript
function projectTrustedForResourceListing(
  repoRoot: string,
  agentDir: string,
): boolean {
  if (!hasTrustRequiringProjectResources(repoRoot)) return true;

  const savedDecision = new ProjectTrustStore(agentDir).get(repoRoot);
  if (savedDecision !== null) return savedDecision;

  const globalOnlySettings = SettingsManager.create(repoRoot, agentDir, {
    projectTrusted: false,
  });
  return globalOnlySettings.getDefaultProjectTrust() === "always";
}

function enabledPaths(resources: ResolvedResource[]): string[] {
  return resources.filter((resource) => resource.enabled).map((resource) => resource.path);
}

function promptName(path: string): string {
  return basename(path).replace(/\.md$/u, "");
}

async function resolveStaticResources(input: {
  repoRoot: string;
  agentDir: string;
  profile: PatchmillPiResourceProfile;
  warnings: string[];
}): Promise<{
  contextFiles: string[];
  skillNames: string[];
  promptNames: string[];
  extensionPaths: string[];
}> {
  const settingsManager = SettingsManager.create(input.repoRoot, input.agentDir, {
    projectTrusted: projectTrustedForResourceListing(input.repoRoot, input.agentDir),
  });
  const packageManager = new DefaultPackageManager({
    cwd: input.repoRoot,
    agentDir: input.agentDir,
    settingsManager,
  });

  const onMissing = async (source: string): Promise<MissingSourceAction> => {
    input.warnings.push(`skipped missing package ${source}`);
    return "skip";
  };

  const resolved = await packageManager.resolve(onMissing);
  const baseSkillPaths = enabledPaths(resolved.skills);
  const basePromptPaths = input.profile.noPromptTemplates
    ? []
    : enabledPaths(resolved.prompts);
  const baseExtensionPaths = enabledPaths(resolved.extensions);

  const skills = loadSkills({
    cwd: input.repoRoot,
    agentDir: input.agentDir,
    includeDefaults: false,
    skillPaths: [...baseSkillPaths, ...input.profile.additionalSkillPaths],
  });
  input.warnings.push(
    ...skills.diagnostics.map((diagnostic) =>
      diagnostic.path
        ? `skills: ${diagnostic.message} (${diagnostic.path})`
        : `skills: ${diagnostic.message}`,
    ),
  );

  return {
    contextFiles: input.profile.noContextFiles
      ? []
      : loadProjectContextFiles({
          cwd: input.repoRoot,
          agentDir: input.agentDir,
        }).map((file) => file.path),
    skillNames: skills.skills.map((skill) => skill.name),
    promptNames: basePromptPaths.map(promptName),
    extensionPaths: [...baseExtensionPaths, ...input.profile.additionalExtensionPaths],
  };
}

export async function loadDoctorPiResources(
  repoRoot: string,
  env: Record<string, string | undefined> = process.env,
): Promise<DoctorPiResourceReport> {
  const agentDir = localPiAgentDir(repoRoot);
  const warnings: string[] = [];

  try {
    const loaded = await loadPatchmillConfigState(repoRoot, env, []);
    const blocks = [];
    for (const profile of doctorPiResourceProfiles(loaded.config.skills, repoRoot)) {
      const resources = await resolveStaticResources({
        repoRoot,
        agentDir,
        profile,
        warnings,
      });
      const block = compactProfileBlock({
        label: profile.label,
        repoRoot,
        ...resources,
      });
      if (block.sections.length > 0) blocks.push(block);
    }

    return { blocks, check: piResourceWarningCheck(warnings) };
  } catch (error) {
    return { blocks: [], check: piResourceDiscoveryFailureCheck(error) };
  }
}
```

- [ ] **Step 5: Run resource tests and TypeScript lint**

Run:

```bash
node --test src/cli/commands/doctor/pi-resources.test.ts
npm run lint:ts
```

Expected: PASS. If `DefaultPackageManager` construction types differ, adapt to the exported `.d.ts` shape rather than using private subpath imports.

- [ ] **Step 6: Commit Task 2**

Run:

```bash
git add src/cli/commands/doctor/pi-resources.ts src/cli/commands/doctor/pi-resources.test.ts
git commit -m "feat(doctor): resolve Pi resources read-only"
```

---

### Task 3: Integrate Resource Blocks into Doctor Reporting

**Files:**

- Modify: `src/cli/commands/doctor/reporting.ts`
- Modify: `src/cli/commands/doctor/reporting.test.ts`
- Modify: `src/cli/commands/doctor/main.ts`
- Modify: `src/cli/commands/doctor/main.test.ts`

**Interfaces:**

- Consumes: `DoctorPiResourceProvider`, `DoctorPiResourceReport`, `formatPiResourceBlocks()`, `loadDoctorPiResources()`, and `piResourceDiscoveryFailureCheck()` from Task 2.
- Produces: `formatDoctorReport(results, resourceBlocks?)` and centralized quiet handling in `runDoctor()`.

- [ ] **Step 1: Add reporting tests for resource blocks**

Append to `src/cli/commands/doctor/reporting.test.ts`:

```typescript
test("formatDoctorReport prepends Pi resource blocks", () => {
  assert.deepEqual(
    formatDoctorReport(passing, [
      {
        label: "run-once planning",
        sections: [
          { heading: "Context", items: ["AGENTS.md"] },
          { heading: "Skills", items: ["github"] },
        ],
      },
    ]),
    [
      "[Pi resources: run-once planning]",
      "",
      "[Context]",
      "  AGENTS.md",
      "",
      "[Skills]",
      "  github",
      "",
      "Patchmill doctor",
      "",
      "✓ config: patchmill.config.json",
      "✓ git: clean worktree",
      "",
      "Ready for safe dry runs.",
      "",
      "Next:",
      "  patchmill triage --dry-run",
    ],
  );
});
```

- [ ] **Step 2: Run reporting tests to verify failure**

Run:

```bash
node --test src/cli/commands/doctor/reporting.test.ts
```

Expected: FAIL because `formatDoctorReport()` does not accept resource blocks yet.

- [ ] **Step 3: Update report formatting**

Modify `src/cli/commands/doctor/reporting.ts` imports:

```typescript
import {
  formatPiResourceBlocks,
  type DoctorPiResourceBlock,
} from "./pi-resources.ts";
import type { DoctorCheckResult } from "./checks.ts";
```

Replace `formatDoctorReport()` initialization with:

```typescript
export function formatDoctorReport(
  results: DoctorCheckResult[],
  resourceBlocks: DoctorPiResourceBlock[] = [],
): string[] {
  const resourceLines = formatPiResourceBlocks(resourceBlocks);
  const lines = [
    ...resourceLines,
    ...(resourceLines.length > 0 ? [""] : []),
    "Patchmill doctor",
    "",
  ];
```

Keep the existing checklist, remediation, and success footer behavior below that initialization.

- [ ] **Step 4: Add main-flow tests with stubbed resource provider**

Modify `src/cli/commands/doctor/main.test.ts` imports:

```typescript
import type { DoctorPiResourceReport } from "./pi-resources.ts";
```

Add near the existing runner:

```typescript
const emptyResources: DoctorPiResourceReport = { blocks: [] };
```

Update existing non-help `runDoctor()` option objects to include:

```typescript
loadPiResources: async () => emptyResources,
```

Append tests:

```typescript
test("runDoctor prints Pi resource blocks before checks", async () => {
  const stdout: string[] = [];

  assert.equal(
    await runDoctor(
      [],
      "/repo",
      { stdout: (line) => stdout.push(line), stderr: () => undefined },
      {
        runner,
        loadPiResources: async () => ({
          blocks: [
            {
              label: "run-once planning",
              sections: [
                { heading: "Context", items: ["AGENTS.md"] },
                { heading: "Skills", items: ["github"] },
              ],
            },
          ],
        }),
        runChecks: async () => [
          { name: "config", status: "pass", message: "patchmill.config.json" },
        ],
      },
    ),
    0,
  );

  assert.match(
    stdout.join("\n"),
    /^\[Pi resources: run-once planning\]\n\n\[Context\]\n  AGENTS\.md\n\n\[Skills\]\n  github\n\nPatchmill doctor/m,
  );
});

test("runDoctor adds Pi resource warnings without failing", async () => {
  const stdout: string[] = [];

  assert.equal(
    await runDoctor(
      [],
      "/repo",
      { stdout: (line) => stdout.push(line), stderr: () => undefined },
      {
        runner,
        loadPiResources: async () => ({
          blocks: [],
          check: {
            name: "pi resources",
            status: "warn",
            message: "skipped missing package npm:@acme/pi-tools",
          },
        }),
        runChecks: async () => [
          { name: "config", status: "pass", message: "patchmill.config.json" },
        ],
      },
    ),
    0,
  );

  assert.match(stdout.join("\n"), /! pi resources: skipped missing package/);
  assert.match(stdout.join("\n"), /Ready for safe dry runs/);
});

test("runDoctor converts thrown Pi resource provider errors to warnings", async () => {
  const stdout: string[] = [];

  assert.equal(
    await runDoctor(
      [],
      "/repo",
      { stdout: (line) => stdout.push(line), stderr: () => undefined },
      {
        runner,
        loadPiResources: async () => {
          throw new Error("resource load exploded");
        },
        runChecks: async () => [
          { name: "config", status: "pass", message: "patchmill.config.json" },
        ],
      },
    ),
    0,
  );

  assert.match(
    stdout.join("\n"),
    /! pi resources: could not list Pi resources: resource load exploded/,
  );
});

test("runDoctor --quiet suppresses resource-only output", async () => {
  const stdout: string[] = [];

  assert.equal(
    await runDoctor(
      ["--quiet"],
      "/repo",
      { stdout: (line) => stdout.push(line), stderr: () => undefined },
      {
        runner,
        loadPiResources: async () => ({
          blocks: [
            {
              label: "run-once planning",
              sections: [{ heading: "Skills", items: ["github"] }],
            },
          ],
        }),
        runChecks: async () => [
          { name: "config", status: "pass", message: "patchmill.config.json" },
        ],
      },
    ),
    0,
  );

  assert.deepEqual(stdout, []);
});

test("runDoctor --quiet prints resources when a required check fails", async () => {
  const stdout: string[] = [];

  assert.equal(
    await runDoctor(
      ["--quiet"],
      "/repo",
      { stdout: (line) => stdout.push(line), stderr: () => undefined },
      {
        runner,
        loadPiResources: async () => ({
          blocks: [
            {
              label: "run-once planning",
              sections: [{ heading: "Skills", items: ["github"] }],
            },
          ],
        }),
        runChecks: async () => [
          { name: "config", status: "fail", message: "missing" },
        ],
      },
    ),
    1,
  );

  assert.match(stdout.join("\n"), /\[Pi resources: run-once planning\]/);
  assert.match(stdout.join("\n"), /✗ config: missing/);
});
```

- [ ] **Step 5: Run main tests to verify failure**

Run:

```bash
node --test src/cli/commands/doctor/main.test.ts
```

Expected: FAIL because `runDoctor()` does not accept `loadPiResources` yet.

- [ ] **Step 6: Integrate safe resource loading into `runDoctor()`**

Modify imports in `src/cli/commands/doctor/main.ts`:

```typescript
import {
  loadDoctorPiResources,
  piResourceDiscoveryFailureCheck,
  type DoctorPiResourceProvider,
  type DoctorPiResourceReport,
} from "./pi-resources.ts";
```

Add to the `options` type:

```typescript
    loadPiResources?: DoctorPiResourceProvider;
```

Add helper above `runDoctor()`:

```typescript
async function safeLoadPiResources(
  provider: DoctorPiResourceProvider,
  repoRoot: string,
): Promise<DoctorPiResourceReport> {
  try {
    return await provider(repoRoot);
  } catch (error) {
    return { blocks: [], check: piResourceDiscoveryFailureCheck(error) };
  }
}
```

After the optional `--fix` block and before `runChecks`, add:

```typescript
  const piResources = await safeLoadPiResources(
    options.loadPiResources ?? loadDoctorPiResources,
    config.repoRoot,
  );
```

Replace result assembly with:

```typescript
  const checkResults = await (options.runChecks ?? runDoctorChecks)(runner, {
    repoRoot: config.repoRoot,
  });
  const results = [
    ...(piResources.check ? [piResources.check] : []),
    ...checkResults,
  ];
```

Keep quiet policy centralized:

```typescript
  const failed = hasDoctorFailures(results);
  if (!config.quiet || failed) {
    output.stdout(formatDoctorReport(results, piResources.blocks).join("\n"));
  }
  return failed ? 1 : 0;
```

- [ ] **Step 7: Run doctor unit tests**

Run:

```bash
node --test src/cli/commands/doctor/pi-resources.test.ts src/cli/commands/doctor/reporting.test.ts src/cli/commands/doctor/main.test.ts
node --test src/cli/commands/doctor/*.test.ts
```

Expected: PASS.

- [ ] **Step 8: Commit Task 3**

Run:

```bash
git add src/cli/commands/doctor/reporting.ts src/cli/commands/doctor/reporting.test.ts src/cli/commands/doctor/main.ts src/cli/commands/doctor/main.test.ts
git commit -m "feat(doctor): print Pi resource profiles"
```

---

### Task 4: Verify End-to-End Behavior

**Files:**

- Modify only if verification exposes a specific defect in files touched by Tasks 1-3.

**Interfaces:**

- Consumes: all production and test interfaces from Tasks 1-3.
- Produces: final verified implementation with passing tests and lint.

- [ ] **Step 1: Run focused tests**

Run:

```bash
node --test src/pi/resource-profiles.test.ts src/cli/commands/run-once/pi.test.ts src/pi/runner.test.ts src/cli/commands/triage/dry-run-agent.test.ts src/cli/commands/triage/execute-agent.test.ts src/cli/commands/doctor/*.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run the full test suite**

Run:

```bash
npm test
```

Expected: PASS.

- [ ] **Step 3: Run lint**

Run:

```bash
npm run lint
```

Expected: PASS. If Prettier reports formatting changes, run `npm run format`, inspect the diff, then rerun `npm run lint`.

- [ ] **Step 4: Manually inspect doctor output shape**

Run:

```bash
node bin/patchmill.ts doctor --quiet
```

Expected when readiness checks pass: no output. Expected when a required check fails in the local environment: report prints resource blocks and the failure checklist.

Run:

```bash
node bin/patchmill.ts doctor
```

Expected: resource profile blocks print first, followed by the existing `Patchmill doctor` checklist. If environment-specific host or provider checks fail, confirm the resource blocks still printed before the failure checklist.

- [ ] **Step 5: Verify doctor did not mutate Pi package state**

Before and after running `node bin/patchmill.ts doctor`, compare local package state paths that should not change:

```bash
git status --short
find .patchmill/pi-agent -maxdepth 3 -type f 2>/dev/null | sort
```

Expected: no new git-tracked changes and no package install/update side effects caused by doctor resource discovery. Existing local state files unrelated to this run may already exist; do not delete or modify them.

- [ ] **Step 6: Review the final diff**

Run:

```bash
git status --short
git diff --stat HEAD~3..HEAD
git diff HEAD~3..HEAD -- src/pi src/cli/commands/run-once src/cli/commands/triage src/cli/commands/doctor
```

Expected: The diff is limited to shared Pi resource profiles, runtime call-site refactors, doctor resource discovery/formatting, and tests. No package dependency files changed.

- [ ] **Step 7: Commit verification fixes if needed**

If Step 1-6 required code or test fixes after Task 3's commit, run:

```bash
git add src/pi src/cli/commands/run-once src/cli/commands/triage src/cli/commands/doctor
git commit -m "fix(doctor): stabilize Pi resource profiles"
```

If no fixes were needed, leave the branch at the Task 3 commit.

---

## Plan Self-Review Checklist

- Spec coverage: Task 1 covers profile specificity and drift prevention; Task 2 covers read-only discovery, missing package skips, no extension execution, and trust parity; Task 3 covers report formatting and quiet behavior; Task 4 covers verification and mutation checks.
- Placeholder scan: The plan uses concrete file paths, function names, commands, expected results, and code snippets for every code-producing step.
- Type consistency: `PatchmillPiResourceProfile`, `DoctorPiResourceBlock`, `DoctorPiResourceReport`, `DoctorPiResourceProvider`, `formatPiResourceBlocks()`, `loadDoctorPiResources()`, and `piResourceDiscoveryFailureCheck()` are defined before they are consumed.
