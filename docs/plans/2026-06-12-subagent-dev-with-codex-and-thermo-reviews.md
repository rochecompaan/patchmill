# Subagent Dev with Codex and Thermo Reviews Skill Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an optional Patchmill composite implementation skill that reuses
Superpowers subagent-driven-development and then requires Codex plus
thermo-nuclear full-worktree review loops.

**Architecture:** Keep the project-local default implementation skill as
`subagent-driven-development`, but install the new Patchmill-owned skill in the
recommended pack so users can opt into it. Package the skill with separate
rubric and prompt support files so initialized repositories get editable local
workflow documentation.

**Tech Stack:** TypeScript, Node test runner, markdown skills, Patchmill init
skill-pack installer.

---

## File structure

- `src/workflow/skill-pack.ts`: recommended pack membership while preserving the
  existing project-local implementation stage mapping.
- `src/workflow/skill-pack.test.ts`: unit tests for pack membership and default
  implementation mapping.
- `src/cli/commands/init/skill-installer.test.ts`: installer behavior test with
  a fake Patchmill skill source.
- `skills/subagent-dev-with-codex-and-thermo-reviews/SKILL.md`: composite
  implementation workflow skill.
- `skills/subagent-dev-with-codex-and-thermo-reviews/rubrics/armin-codex-review-prompt.md`:
  copied Armin Ronacher adaptation of the Codex review prompt.
- `skills/subagent-dev-with-codex-and-thermo-reviews/rubrics/cursor-thermo-nuclear-code-quality-review.md`:
  copied Cursor thermo-nuclear code quality review rubric.
- `skills/subagent-dev-with-codex-and-thermo-reviews/prompts/final-review.md`:
  reviewer prompt template.
- `skills/subagent-dev-with-codex-and-thermo-reviews/prompts/fix-review-findings.md`:
  worker prompt template.
- `docs/skills.md`, `docs/issue-agent-workflows.md`, `docs/configuration.md`:
  documentation updates.

## Task 1: Add failing tests for optional skill-pack installation

**Files:**

- Modify: `src/workflow/skill-pack.test.ts`
- Modify: `src/cli/commands/init/skill-installer.test.ts`

- [ ] **Step 1: Preserve `buildRecommendedProjectSkillConfig` expectation**

Keep the expected implementation path at
`.patchmill/skills/subagent-driven-development`.

- [ ] **Step 2: Update recommended pack expectation**

Add
`{ name: "subagent-dev-with-codex-and-thermo-reviews", source: "patchmill" }`
immediately after `patchmill-issue-triage` in
`PATCHMILL_RECOMMENDED_SKILL_PACK.skills`.

- [ ] **Step 3: Update installer fixture**

Add a fake Patchmill-owned `subagent-dev-with-codex-and-thermo-reviews` skill to
the installer test fixture, include it in `packSkills`, and assert it is copied
and recorded in metadata.

- [ ] **Step 4: Verify RED**

Run:

```bash
node --test src/workflow/skill-pack.test.ts src/cli/commands/init/skill-installer.test.ts
```

Expected: FAIL because production code and the real skill directory do not yet
provide the new optional skill.

## Task 2: Add the composite skill files

**Files:**

- Create: `skills/subagent-dev-with-codex-and-thermo-reviews/SKILL.md`
- Create:
  `skills/subagent-dev-with-codex-and-thermo-reviews/rubrics/armin-codex-review-prompt.md`
- Create:
  `skills/subagent-dev-with-codex-and-thermo-reviews/rubrics/cursor-thermo-nuclear-code-quality-review.md`
- Create:
  `skills/subagent-dev-with-codex-and-thermo-reviews/prompts/final-review.md`
- Create:
  `skills/subagent-dev-with-codex-and-thermo-reviews/prompts/fix-review-findings.md`

- [ ] **Step 1: Write `SKILL.md`**

Include trigger-only frontmatter and process steps that compose Superpowers
subagent-driven-development with two final full-worktree Pi reviewer loops.

- [ ] **Step 2: Copy rubrics**

Copy Armin Ronacher's adaptation of the Codex review prompt and the Cursor
thermo-nuclear code quality review rubric into separate supporting files.
Preserve their separation.

- [ ] **Step 3: Write prompt templates**

Create one review-only prompt template and one worker-fix prompt template. The
reviewer template must require fresh-context `reviewer`, no edits, full final
worktree scope, rubric file inclusion, file/line findings, and verdict. The fix
template must require `worker` to apply only accepted findings, validate, and
summarize changes.

## Task 3: Add the optional skill without changing the default mapping

**Files:**

- Modify: `src/workflow/skill-pack.ts`

- [ ] **Step 1: Add a named constant**

Add
`SUBAGENT_DEV_WITH_CODEX_AND_THERMO_REVIEWS_SKILL = "subagent-dev-with-codex-and-thermo-reviews"`
near skill-pack constants.

- [ ] **Step 2: Add skill to the recommended pack**

Insert the new Patchmill-owned skill after `patchmill-issue-triage`.

- [ ] **Step 3: Keep project-local implementation mapped to the existing skill**

Confirm `buildRecommendedProjectSkillConfig()` still maps implementation to
`projectSkillPath("subagent-driven-development", skillDir)`.

- [ ] **Step 4: Verify GREEN**

Run:

```bash
node --test src/workflow/skill-pack.test.ts src/cli/commands/init/skill-installer.test.ts
```

Expected: PASS.

## Task 4: Update user-facing documentation

**Files:**

- Modify: `docs/skills.md`
- Modify: `docs/issue-agent-workflows.md`
- Modify: `docs/configuration.md`

- [ ] **Step 1: Explain the preserved project-local default**

State that initialized repositories still point `skills.implementation` to
`.patchmill/skills/subagent-driven-development`.

- [ ] **Step 2: Explain composition**

Document that the new optional skill internally uses/adapts Superpowers
subagent-driven-development, then adds the two final review loops.

- [ ] **Step 3: Keep docs focused on initialized repositories**

Document the initialized project-local default and the optional final-reviewed
implementation skill only.

## Task 5: Verify all behavior

**Files:**

- Verify all changed files.

- [ ] **Step 1: Run targeted tests**

```bash
node --test src/workflow/skill-pack.test.ts src/workflow/skills.test.ts src/cli/commands/init/skill-installer.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run full test suite**

```bash
npm test
```

Expected: PASS.

- [ ] **Step 3: Run lint/checks if docs or markdown formatting changed**

```bash
npm run lint
```

Expected: PASS, or report any pre-existing unrelated failures with evidence.

- [ ] **Step 4: Inspect final diff**

```bash
git diff --check
git diff --stat
```

Expected: no whitespace errors; changed files match plan.
