# Module-size Skill Pack Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Install the `module-size` skill with Patchmill's recommended
project-local skill pack.

**Architecture:** Vendor the approved `module-size` skill under Patchmill's
bundled `skills/` directory and add it to the recommended skill pack manifest as
a Patchmill-sourced skill. Leave workflow stage configuration unchanged so
`module-size` is installed for agent use but not assigned to `triage`,
`planning`, or `implementation`.

**Tech Stack:** TypeScript, Node.js built-in test runner, npm package dry-run,
markdown skill files.

---

## File structure

- Modify `src/workflow/skill-pack.ts`: add `module-size` to
  `PATCHMILL_RECOMMENDED_SKILL_PACK.skills` with source `patchmill`.
- Create `skills/module-size/SKILL.md`: vendored copy of
  `/home/roche/projects/pi/roche-pi/skills/module-size/SKILL.md`.
- Modify `src/workflow/skill-pack.test.ts`: assert the recommended pack includes
  the new Patchmill-sourced skill while default workflow config remains
  unchanged.
- Modify `src/cli/commands/init/skill-installer.test.ts`: assert the real
  recommended pack installs `.patchmill/skills/module-size/SKILL.md` and records
  it in metadata.
- Modify `bin/package-files.test.ts`: assert the npm package dry-run includes
  `skills/module-size/SKILL.md`.

No new runtime installer branch is needed. The existing generic skill pack
installer already copies every skill listed in
`PATCHMILL_RECOMMENDED_SKILL_PACK` from the correct source root.

### Task 1: Write failing tests for module-size pack installation

**Files:**

- Modify: `src/workflow/skill-pack.test.ts`
- Modify: `src/cli/commands/init/skill-installer.test.ts`
- Modify: `bin/package-files.test.ts`

- [ ] **Step 1: Add the expected pack member to the recommended pack test**

In `src/workflow/skill-pack.test.ts`, update the expected
`PATCHMILL_RECOMMENDED_SKILL_PACK.skills` array in
`test("default pack records pinned external source", ...)` so the
Patchmill-owned entries are:

```ts
assert.deepEqual(PATCHMILL_RECOMMENDED_SKILL_PACK.skills, [
  { name: "patchmill-issue-triage", source: "patchmill" },
  {
    name: "subagent-dev-with-codex-and-thermo-reviews",
    source: "patchmill",
  },
  {
    name: "single-subagent-dev-with-codex-and-thermo-reviews",
    source: "patchmill",
  },
  { name: "module-size", source: "patchmill" },
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
]);
```

Do not change the `buildRecommendedProjectSkillConfig` expectation. It must
continue to assert only these workflow stage mappings:

```ts
assert.deepEqual(buildRecommendedProjectSkillConfig(), {
  triage: ".patchmill/skills/patchmill-issue-triage",
  planning: ".patchmill/skills/writing-plans",
  implementation: ".patchmill/skills/subagent-driven-development",
});
```

- [ ] **Step 2: Add an init installer regression test for the real recommended
      pack**

In `src/cli/commands/init/skill-installer.test.ts`, add this test after
`test("installProjectSkills copies skills and writes metadata", ...)`:

```ts
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
```

This test intentionally calls `installProjectSkills()` without `packSkills`
overrides so it exercises `PATCHMILL_RECOMMENDED_SKILL_PACK` and the real
bundled source roots.

- [ ] **Step 3: Add package dry-run coverage**

In `bin/package-files.test.ts`, add this assertion after the existing bundled
triage skill assertion:

```ts
assert.equal(files.has("skills/patchmill-issue-triage/SKILL.md"), true);
assert.equal(files.has("skills/module-size/SKILL.md"), true);
```

- [ ] **Step 4: Run targeted tests and verify RED**

Run:

```bash
node --test src/workflow/skill-pack.test.ts src/cli/commands/init/skill-installer.test.ts bin/package-files.test.ts
```

Expected result: FAIL. The failures should show that `module-size` is not yet
present in the recommended pack and/or packaged files. A representative failure
is an assertion where `false !== true` for `.patchmill/skills/module-size` or
`skills/module-size/SKILL.md`.

- [ ] **Step 5: Commit the failing tests**

Run:

```bash
git add src/workflow/skill-pack.test.ts src/cli/commands/init/skill-installer.test.ts bin/package-files.test.ts docs/specs/2026-06-13-module-size-skill-pack-design.md docs/plans/2026-06-13-module-size-skill-pack.md
git commit -m "test: cover module-size recommended skill"
```

### Task 2: Vendor the module-size skill and add it to the recommended pack

**Files:**

- Create: `skills/module-size/SKILL.md`
- Modify: `src/workflow/skill-pack.ts`

- [ ] **Step 1: Copy the approved skill into Patchmill**

Run:

```bash
mkdir -p skills/module-size
cp /home/roche/projects/pi/roche-pi/skills/module-size/SKILL.md skills/module-size/SKILL.md
diff -u /home/roche/projects/pi/roche-pi/skills/module-size/SKILL.md skills/module-size/SKILL.md
```

Expected result: `diff` prints no output and exits with status 0.

- [ ] **Step 2: Add the skill to the recommended pack manifest**

In `src/workflow/skill-pack.ts`, update
`PATCHMILL_RECOMMENDED_SKILL_PACK.skills` by inserting the Patchmill-sourced
`module-size` entry after the existing Patchmill-owned implementation skills and
before the Superpowers-sourced entries:

```ts
  skills: [
    { name: "patchmill-issue-triage", source: "patchmill" },
    {
      name: SUBAGENT_DEV_WITH_CODEX_AND_THERMO_REVIEWS_SKILL,
      source: "patchmill",
    },
    {
      name: SINGLE_SUBAGENT_DEV_WITH_CODEX_AND_THERMO_REVIEWS_SKILL,
      source: "patchmill",
    },
    { name: "module-size", source: "patchmill" },
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
```

Do not modify `buildRecommendedProjectSkillConfig()`.

- [ ] **Step 3: Run targeted tests and verify GREEN**

Run:

```bash
node --test src/workflow/skill-pack.test.ts src/cli/commands/init/skill-installer.test.ts bin/package-files.test.ts
```

Expected result: PASS for all tests in those three files.

- [ ] **Step 4: Commit the implementation**

Run:

```bash
git add skills/module-size/SKILL.md src/workflow/skill-pack.ts
git commit -m "feat(skills): add module-size to recommended pack"
```

### Task 3: Final verification

**Files:**

- Verify: full repository lint/test behavior

- [ ] **Step 1: Run lint**

Run:

```bash
npm run lint
```

Expected result: PASS with no formatting, TypeScript lint, or markdownlint
errors.

- [ ] **Step 2: Run the full automated test suite**

Run:

```bash
npm test
```

Expected result: PASS for the repository's Node test suite.

- [ ] **Step 3: Inspect the final diff**

Run:

```bash
git status --short
git diff --stat HEAD~2..HEAD
```

Expected result: the committed changes are limited to:

```text
bin/package-files.test.ts
docs/plans/2026-06-13-module-size-skill-pack.md
docs/specs/2026-06-13-module-size-skill-pack-design.md
skills/module-size/SKILL.md
src/cli/commands/init/skill-installer.test.ts
src/workflow/skill-pack.test.ts
src/workflow/skill-pack.ts
```

- [ ] **Step 4: Report verification evidence**

In the handoff response, include:

```text
Implemented module-size in Patchmill's recommended skill pack.
Verification:
- node --test src/workflow/skill-pack.test.ts src/cli/commands/init/skill-installer.test.ts bin/package-files.test.ts
- npm run lint
- npm test
```
