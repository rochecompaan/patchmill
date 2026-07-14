# Bundled Skill Registry Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refactor Patchmill bundled skill metadata into one registry that
drives defaults, resolution, skill-pack wiring, init validation, and doctor
verification.

**Architecture:** Add a low-level `src/workflow/bundled-skills.ts` registry with
data-only entries and small lookup/path helpers. Update existing modules to
consume registry helpers while keeping current public constants and path
wrappers as compatibility exports.

**Tech Stack:** TypeScript on Node.js 24, Node built-in test runner via
`npm test`, existing workflow/init/doctor test helpers, no npm dependency
changes.

---

## File structure

- Create `src/workflow/bundled-skills.ts`
  - Own canonical bundled Patchmill skill entries for `triage` and
    `visualEvidence`.
  - Export lookups by key, config reference, and global name/dir name.
  - Export source-tree/built-package path helpers and required-file helpers.
- Create `src/workflow/bundled-skills.test.ts`
  - Assert registry metadata preserves public strings and required sidecar
    files.
  - Assert compatibility helpers resolve bundled `SKILL.md` paths and required
    files.
- Modify `src/workflow/skill-resolution.ts`
  - Replace hardcoded bundled-reference branches with registry lookup.
  - Preserve `BUNDLED_TRIAGE_SKILL_REFERENCE`,
    `BUNDLED_VISUAL_EVIDENCE_SKILL_REFERENCE`, `bundledTriageSkillPath()`, and
    `bundledVisualEvidenceSkillPath()` as derived wrappers.
- Modify `src/workflow/skills.ts`
  - Derive default and global bundled skill values from registry helpers.
  - Keep planning and implementation defaults as Superpowers references.
- Modify `src/workflow/skill-pack.ts`
  - Use registry required files and recommended project-local entries for
    Patchmill bundled skills.
  - Keep recommended pack contents and public config values unchanged.
- Modify `src/cli/commands/init/skill-installer.ts`
  - Derive Patchmill source root from a bundled registry path helper.
  - Validate project-local recommended bundled skills using registry-derived
    names and required files.
- Modify `src/cli/commands/doctor/checks.ts`
  - Verify registered bundled config references generically, including all
    sidecar files.
  - Keep warning behavior for unregistered named/global skills and path-like
    skill validation.
- Modify focused tests:
  - `src/workflow/skills.test.ts`
  - `src/workflow/skill-resolution.test.ts`
  - `src/workflow/skill-pack.test.ts`
  - `src/cli/commands/init/skill-installer.test.ts`
  - `src/cli/commands/doctor/checks.test.ts`
  - `src/workflow/visual-evidence-skill.test.ts` only if path helper imports
    change.

## Global constraints

- Preserve these public values exactly:
  - `patchmill:bundled-issue-triage`
  - `patchmill:bundled-visual-evidence`
  - `patchmill-issue-triage`
  - `patchmill-visual-evidence`
- Do not move or rewrite bundled skill prose or sidecar scripts.
- Do not add npm dependencies. If `package.json`, `package-lock.json`, or
  `npm-shrinkwrap.json` changes, revert or run the Nix build required by
  `AGENTS.md`.
- Unknown skill names must continue to require only `SKILL.md`.
- Non-bundled Superpowers skills stay outside the bundled Patchmill registry.

---

### Task 1: Add the bundled skill registry and unit tests

**Files:**

- Create: `src/workflow/bundled-skills.ts`
- Create: `src/workflow/bundled-skills.test.ts`

- [ ] **Step 1: Write failing registry tests**

Add tests that assert the registry contains exactly the initial bundled entries
and preserves current metadata:

```ts
assert.deepEqual(
  BUNDLED_PATCHMILL_SKILLS.map((skill) => skill.key),
  ["triage", "visualEvidence"],
);
assert.equal(
  bundledSkillByKey("triage")?.configReference,
  "patchmill:bundled-issue-triage",
);
assert.equal(
  bundledSkillByKey("visualEvidence")?.globalName,
  "patchmill-visual-evidence",
);
assert.deepEqual(
  requiredFilesForBundledSkillName("patchmill-visual-evidence"),
  ["SKILL.md", "scripts/capture-visual-evidence.cjs"],
);
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- src/workflow/bundled-skills.test.ts`

Expected: FAIL because `src/workflow/bundled-skills.ts` does not exist yet.

- [ ] **Step 3: Implement the registry module**

Create `BundledPatchmillSkill`, `BundledPatchmillSkillKey`,
`BUNDLED_PATCHMILL_SKILLS`, lookup helpers, `bundledSkillPath(entry)`,
`bundledSkillPathForReference(reference)`, `bundledSkillDir(entry)`, and
`requiredFilesForBundledSkillName(name)`.

- [ ] **Step 4: Run registry tests**

Run: `npm test -- src/workflow/bundled-skills.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit registry foundation**

```bash
git add src/workflow/bundled-skills.ts src/workflow/bundled-skills.test.ts
git commit -m "feat: add bundled skill registry"
```

---

### Task 2: Derive skill resolution and default skill config from the registry

**Files:**

- Modify: `src/workflow/skill-resolution.ts`
- Modify: `src/workflow/skills.ts`
- Modify: `src/workflow/skill-resolution.test.ts`
- Modify: `src/workflow/skills.test.ts`

- [ ] **Step 1: Add/adjust resolver tests**

Cover both bundled references through the generic lookup and keep named/global
skills non-invokable. Include assertions that compatibility wrappers still
return paths ending in the current skill directories.

- [ ] **Step 2: Run focused tests to see current behavior**

Run:
`npm test -- src/workflow/skills.test.ts src/workflow/skill-resolution.test.ts`

Expected before implementation: existing tests pass; new generic-registry
assertions fail until imports and resolver logic are updated.

- [ ] **Step 3: Replace hardcoded resolver branches**

Import registry helpers in `src/workflow/skill-resolution.ts`. Derive bundled
constants from `bundledSkillByKey()`, implement wrapper path functions through
`bundledSkillPath()`, and replace the two `if (skill === BUNDLED_...)` branches
with `bundledSkillPathForReference(skill)`.

- [ ] **Step 4: Derive defaults/globals in `skills.ts`**

Use registry lookup values for `DEFAULT_PATCHMILL_SKILLS.triage`,
`DEFAULT_PATCHMILL_SKILLS.visualEvidence`, `GLOBAL_PATCHMILL_SKILLS.triage`, and
`GLOBAL_PATCHMILL_SKILLS.visualEvidence`. Leave planning and implementation
unchanged.

- [ ] **Step 5: Run focused tests**

Run:
`npm test -- src/workflow/skills.test.ts src/workflow/skill-resolution.test.ts src/workflow/bundled-skills.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit resolver/default changes**

```bash
git add src/workflow/skill-resolution.ts src/workflow/skills.ts src/workflow/skill-resolution.test.ts src/workflow/skills.test.ts src/workflow/bundled-skills.test.ts
git commit -m "refactor: derive bundled skill resolution from registry"
```

---

### Task 3: Derive skill-pack metadata and project-local config from the registry

**Files:**

- Modify: `src/workflow/skill-pack.ts`
- Modify: `src/workflow/skill-pack.test.ts`

- [ ] **Step 1: Add skill-pack regression tests**

Assert `requiredSkillFiles("patchmill-visual-evidence")` returns `SKILL.md` plus
`scripts/capture-visual-evidence.cjs`, `requiredSkillFiles("unknown")` returns
`SKILL.md`, recommended pack entries are unchanged, and
`buildRecommendedProjectSkillConfig()` still returns the same four paths.

- [ ] **Step 2: Run focused tests**

Run:
`npm test -- src/workflow/skill-pack.test.ts src/workflow/bundled-skills.test.ts`

Expected: existing behavior passes; any newly imported registry assertions fail
until wiring is updated.

- [ ] **Step 3: Update `skill-pack.ts` to consume registry helpers**

Replace the local `REQUIRED_SKILL_FILES` map with registry-derived required
files for bundled Patchmill skill names. Build triage and visual evidence
project-local config values from registry entries marked
`recommendedProjectLocal` while preserving planning and implementation
Superpowers paths.

- [ ] **Step 4: Run focused tests**

Run:
`npm test -- src/workflow/skill-pack.test.ts src/workflow/bundled-skills.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit skill-pack changes**

```bash
git add src/workflow/skill-pack.ts src/workflow/skill-pack.test.ts
git commit -m "refactor: derive skill pack bundled metadata from registry"
```

---

### Task 4: Use registry-derived required files during init install and validation

**Files:**

- Modify: `src/cli/commands/init/skill-installer.ts`
- Modify: `src/cli/commands/init/skill-installer.test.ts`

- [ ] **Step 1: Add init validation regression tests**

Add or update tests that validate an existing project-local visual evidence
skill fails when `scripts/capture-visual-evidence.cjs` is missing and passes
when present. Assert `defaultSkillSourceRoots().patchmillSkillsDir` is still the
bundled `skills` root.

- [ ] **Step 2: Run focused init tests**

Run: `npm test -- src/cli/commands/init/skill-installer.test.ts`

Expected: current tests pass; new registry-specific tests fail if the
implementation still hardcodes only selected names.

- [ ] **Step 3: Update installer source-root and validation logic**

Import registry helpers. Derive the Patchmill skills source root from a
registered bundled skill directory helper rather than from
`bundledTriageSkillPath()`. Build the project-local validation list from
`buildRecommendedProjectSkillConfig()` plus registered `recommendedProjectLocal`
entries, keeping planning and implementation validation explicit for Superpowers
skills.

- [ ] **Step 4: Run focused init tests**

Run:
`npm test -- src/cli/commands/init/skill-installer.test.ts src/workflow/skill-pack.test.ts src/workflow/bundled-skills.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit init installer changes**

```bash
git add src/cli/commands/init/skill-installer.ts src/cli/commands/init/skill-installer.test.ts
git commit -m "refactor: validate init bundled skills through registry"
```

---

### Task 5: Verify bundled defaults through the registry in doctor

**Files:**

- Modify: `src/cli/commands/doctor/checks.ts`
- Modify: `src/cli/commands/doctor/checks.test.ts`

- [ ] **Step 1: Add doctor sidecar verification tests**

Add tests proving doctor verifies every required file for registered bundled
config references and fails if the bundled visual evidence sidecar path is
unreadable or missing. Keep tests for named/global skills warning rather than
being verified.

- [ ] **Step 2: Run focused doctor tests**

Run: `npm test -- src/cli/commands/doctor/checks.test.ts`

Expected: new generic bundled verification tests fail until doctor no longer
uses key-specific branches.

- [ ] **Step 3: Replace key-specific bundled doctor branches**

In `checkSkills()`, look up `bundledSkillByConfigReference(skill)`. If found,
call
`verifyBundledSkill(key, skill, bundledSkillPath(entry), entry.requiredFiles)`.
Remove imports for key-specific bundled path helpers where no longer needed.

- [ ] **Step 4: Keep path-like required-file behavior**

Ensure `requiredFilesForConfiguredSkill()` still derives sidecar requirements
for local `.patchmill/skills/patchmill-visual-evidence` and custom path-like
skills whose frontmatter name is `patchmill-visual-evidence`.

- [ ] **Step 5: Run focused doctor tests**

Run:
`npm test -- src/cli/commands/doctor/checks.test.ts src/workflow/bundled-skills.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit doctor changes**

```bash
git add src/cli/commands/doctor/checks.ts src/cli/commands/doctor/checks.test.ts
git commit -m "refactor: verify bundled skills through registry"
```

---

### Task 6: Final regression sweep and cleanup

**Files:**

- Review: `src/workflow/visual-evidence-skill.test.ts`
- Review: all files changed in Tasks 1-5

- [ ] **Step 1: Run all issue-specific focused tests**

Run:

```bash
npm test -- src/workflow/bundled-skills.test.ts src/workflow/skills.test.ts src/workflow/skill-resolution.test.ts src/workflow/skill-pack.test.ts src/cli/commands/init/skill-installer.test.ts src/cli/commands/doctor/checks.test.ts src/workflow/visual-evidence-skill.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run full test suite**

Run: `npm test`

Expected: PASS.

- [ ] **Step 3: Check dependency files**

Run: `git diff -- package.json package-lock.json npm-shrinkwrap.json`

Expected: no output. If any dependency file changed intentionally, run the
project Nix build before completion as required by `AGENTS.md`; otherwise revert
accidental dependency-file changes.

- [ ] **Step 4: Review public behavior diffs**

Run: `git diff -- src/workflow src/cli/commands/init src/cli/commands/doctor`

Expected: registry-driven refactor only; no changes to public skill references,
global names, recommended pack version/source, or bundled skill content.

- [ ] **Step 5: Commit final cleanup if needed**

If Step 4 required cleanup changes, commit them:

```bash
git add <cleaned-files>
git commit -m "chore: clean up bundled skill registry refactor"
```

If no cleanup was needed, do not create an empty commit.

## Validation commands

Run these during implementation and before landing:

```bash
npm test -- src/workflow/bundled-skills.test.ts src/workflow/skills.test.ts src/workflow/skill-resolution.test.ts src/workflow/skill-pack.test.ts
npm test -- src/cli/commands/init/skill-installer.test.ts src/cli/commands/doctor/checks.test.ts
npm test -- src/workflow/visual-evidence-skill.test.ts
npm test
git diff -- package.json package-lock.json npm-shrinkwrap.json
```

A Nix build is not required for this issue unless implementation changes
`package.json`, `package-lock.json`, or `npm-shrinkwrap.json`.
