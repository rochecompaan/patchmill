# Single Subagent Codex Thermo Skill Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans
> to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for
> tracking.

**Goal:** Add an opt-in Patchmill implementation skill that uses one worker
subagent for a full plan, then final Codex and thermo-nuclear review loops.

**Architecture:** Keep the new workflow as a Patchmill-owned skill in `skills/`,
add it to the recommended pack, and document it as an alternative to the
existing task-by-task optional skill. The default `skills.implementation`
mapping stays unchanged.

**Tech Stack:** Markdown skills, Node test runner, TypeScript pack metadata.

---

## Files

- Create: `skills/single-subagent-dev-with-codex-and-thermo-reviews/SKILL.md`
- Create:
  `skills/single-subagent-dev-with-codex-and-thermo-reviews/prompts/implement-plan.md`
- Reference existing shared assets in
  `skills/subagent-dev-with-codex-and-thermo-reviews/prompts/` and
  `skills/subagent-dev-with-codex-and-thermo-reviews/rubrics/` instead of
  duplicating them.
- Modify: `src/workflow/skill-pack.ts`
- Modify: `src/workflow/skill-pack.test.ts`
- Modify: `src/cli/commands/init/main.test.ts`
- Modify: `src/cli/commands/init/skill-installer.test.ts`
- Modify: `README.md`, `docs/skills.md`, `docs/configuration.md`,
  `docs/issue-agent-workflows.md`

## Task 1: Add failing pack and installer expectations

- [ ] Update `src/workflow/skill-pack.test.ts` so
      `PATCHMILL_RECOMMENDED_SKILL_PACK.skills` includes
      `{ name: "single-subagent-dev-with-codex-and-thermo-reviews", source: "patchmill" }`.
- [ ] Update init/installer tests to expect the new skill to be installed and
      discoverable.
- [ ] Run
      `node --test src/workflow/skill-pack.test.ts src/cli/commands/init/main.test.ts src/cli/commands/init/skill-installer.test.ts`.
- [ ] Confirm the failure points to the missing optional skill entry/file.

## Task 2: Add the optional skill and pack entry

- [ ] Add the `SINGLE_SUBAGENT_DEV_WITH_CODEX_AND_THERMO_REVIEWS_SKILL` constant
      in `src/workflow/skill-pack.ts`.
- [ ] Insert the new Patchmill skill into
      `PATCHMILL_RECOMMENDED_SKILL_PACK.skills` without changing
      `buildRecommendedProjectSkillConfig()`.
- [ ] Create the new skill directory with `SKILL.md` and
      `prompts/implement-plan.md`; reference sibling final review/fix prompts
      and rubrics instead of duplicating them.
- [ ] Run the same targeted tests and confirm they pass.

## Task 3: Update user-facing docs

- [ ] Update README's default skills section and Pi runtime section to mention
      both optional variants.
- [ ] Update `docs/skills.md`, `docs/configuration.md`, and
      `docs/issue-agent-workflows.md` with the new opt-in path and distinction
      from the task-by-task variant.
- [ ] Run Markdown lint.

## Task 4: Final verification

- [ ] Run targeted tests again.
- [ ] Run `npm run lint`.
- [ ] Report actual verification evidence and any skipped tests.
