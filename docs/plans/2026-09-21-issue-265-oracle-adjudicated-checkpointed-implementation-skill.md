# Oracle-Adjudicated Checkpointed Implementation Skill Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the default single-subagent implementation skill with the
oracle-adjudicated checkpointed workflow proven in Croprun, generalized for any
repository (issue #265).

**Architecture:** Upstream the Croprun variant verbatim, then generalize
repo-specific wording, bump the skill-pack version with an update notice, add a
sidecar link-integrity test, refresh site docs, and sync the repo's tracked
installed skill copy. Spec:
`docs/specs/2026-09-21-issue-265-oracle-adjudicated-checkpointed-implementation-skill-design.md`.

**Tech Stack:** Markdown skill files, JSON schema, TypeScript (node:test),
Prettier, markdownlint-cli2.

## Global Constraints

- Keep the skill directory name and frontmatter `name:` exactly
  `single-subagent-dev-with-codex-and-thermo-reviews`; existing
  `patchmill.config.json` references must keep working.
- Do not modify `skills/subagent-dev-with-codex-and-thermo-reviews/SKILL.md`;
  only add `prompts/final-visual-evidence-review.md` there.
- Do not change `buildRecommendedProjectSkillConfig` or the default
  implementation skill for new projects.
- Conventional Commits referencing issue #265.
- All `skills/**/*.md` files must pass markdownlint-cli2 and Prettier;
  lint-staged runs both on commit and markdownlint failures block the commit.
- Worktree:
  `/home/roche/projects/patchmill/.worktrees/patchmill-issue-265-oracle-checkpointed-implementation-skill`.
  Run all commands from there.
- Known pre-existing environment failures (also failing on `main`, unrelated to
  this change):
  `pi loads the resolved pi-subagents extension package without model execution`
  and `Pi loads the source run-once extensions before the sentinel`. Do not try
  to fix them.

---

### Task 1: Commit spec and plan

**Files:**

- Create:
  `docs/specs/2026-09-21-issue-265-oracle-adjudicated-checkpointed-implementation-skill-design.md`
- Create:
  `docs/plans/2026-09-21-issue-265-oracle-adjudicated-checkpointed-implementation-skill.md`

Both files already exist in the worktree (written during planning).

- [ ] **Step 1: Commit**

```bash
git add docs/specs/2026-09-21-issue-265-oracle-adjudicated-checkpointed-implementation-skill-design.md docs/plans/2026-09-21-issue-265-oracle-adjudicated-checkpointed-implementation-skill.md
git commit -m "docs: spec and plan for oracle-adjudicated implementation skill (#265)"
```

### Task 2: Upstream the Croprun variant verbatim

**Files:**

- Create: `skills/single-subagent-dev-with-codex-and-thermo-reviews/prompts/` —
  9 prompt files
- Create:
  `skills/single-subagent-dev-with-codex-and-thermo-reviews/schemas/oracle-review-result.schema.json`
- Modify: `skills/single-subagent-dev-with-codex-and-thermo-reviews/SKILL.md`
  (full replace)
- Delete:
  `skills/single-subagent-dev-with-codex-and-thermo-reviews/prompts/implement-plan.md`
- Create:
  `skills/subagent-dev-with-codex-and-thermo-reviews/prompts/final-visual-evidence-review.md`

**Interfaces:**

- Consumes: nothing (first content task).
- Produces: the skill files every later task edits, lints, and tests against.

- [ ] **Step 1: Copy the files**

```bash
SRC=~/projects/croprun/.patchmill/skills/single-subagent-dev-with-codex-and-thermo-reviews
DST=skills/single-subagent-dev-with-codex-and-thermo-reviews
rm "$DST/prompts/implement-plan.md"
cp "$SRC/SKILL.md" "$DST/SKILL.md"
cp "$SRC"/prompts/*.md "$DST/prompts/"
mkdir -p "$DST/schemas"
cp "$SRC/schemas/oracle-review-result.schema.json" "$DST/schemas/"
cp ~/projects/croprun/.patchmill/skills/subagent-dev-with-codex-and-thermo-reviews/prompts/final-visual-evidence-review.md \
  skills/subagent-dev-with-codex-and-thermo-reviews/prompts/
```

- [ ] **Step 2: Verify the copy is verbatim and complete**

```bash
diff -r ~/projects/croprun/.patchmill/skills/single-subagent-dev-with-codex-and-thermo-reviews \
  skills/single-subagent-dev-with-codex-and-thermo-reviews
git status --short
```

Expected: `diff -r` prints nothing. `git status` shows SKILL.md modified,
`prompts/implement-plan.md` deleted, 9 new prompt files, 1 new schema file, and
the new sibling prompt file.

- [ ] **Step 3: Format and lint the new files, fix violations**

```bash
npx prettier --write "skills/single-subagent-dev-with-codex-and-thermo-reviews/**" \
  "skills/subagent-dev-with-codex-and-thermo-reviews/prompts/final-visual-evidence-review.md"
npx markdownlint-cli2 "skills/single-subagent-dev-with-codex-and-thermo-reviews/**/*.md" \
  "skills/subagent-dev-with-codex-and-thermo-reviews/prompts/final-visual-evidence-review.md"
```

Expected: Prettier reformats as needed; markdownlint exits 0. Fix any
markdownlint findings in place (they block the lint-staged commit hook). If
Prettier changed files, re-run the `diff -r` check and accept formatting-only
differences.

- [ ] **Step 4: Commit**

```bash
git add skills/single-subagent-dev-with-codex-and-thermo-reviews \
  skills/subagent-dev-with-codex-and-thermo-reviews/prompts/final-visual-evidence-review.md
git commit -m "feat(skills): upstream checkpointed single-writer implementation skill (#265)"
```

### Task 3: Generalize repo-specific wording

**Files:**

- Modify: `skills/single-subagent-dev-with-codex-and-thermo-reviews/SKILL.md`
- Modify:
  `skills/single-subagent-dev-with-codex-and-thermo-reviews/prompts/visual-review-followup.md`
- Modify:
  `skills/subagent-dev-with-codex-and-thermo-reviews/prompts/final-visual-evidence-review.md`

**Interfaces:**

- Consumes: Task 2's copied files.
- Produces: repository-neutral skill text; no workflow change.

- [ ] **Step 1: Edit `SKILL.md` — project reference material**

Replace:

```text
evidence chronology, coverage, and Croprun references. Validation receives the
```

with:

```text
evidence chronology, coverage, and project reference material. Validation receives the
```

- [ ] **Step 2: Edit `SKILL.md` — host-neutral PR checks**

Replace:

```text
Continue with the configured landing workflow. For a Forgejo/Gitea pull request,
observe required checks with configured host tooling and collect failed-check
names, URLs, and logs. Then:
```

with:

```text
Continue with the configured landing workflow. For a pull request, observe
required checks with the configured host tooling — for GitHub, `gh pr checks`
and `gh run view --log-failed`; for Forgejo/Gitea, the configured `tea` or API
tooling — and collect failed-check names, URLs, and logs. Then:
```

- [ ] **Step 3: Edit `SKILL.md` — general UI wording in affected-reviewer
      rules**

Replace:

```text
- Covered template, style, interaction, rendered behavior, mobile UI, or visual
  evidence changes affect the visual reviewer.
```

with:

```text
- Covered template, style, interaction, rendered behavior, web or mobile UI,
  or visual evidence changes affect the visual reviewer.
```

- [ ] **Step 4: Edit `prompts/visual-review-followup.md`**

Replace:

```text
visible behavior, and Croprun references. Re-evaluate every prior blocking
```

with:

```text
visible behavior, and project reference material. Re-evaluate every prior blocking
```

- [ ] **Step 5: Edit the sibling `prompts/final-visual-evidence-review.md` (5
      substitutions)**

1. `Croprun reference screenshots:` -> `Project reference screenshots:`
2. `6. Open the supplied Croprun references and compare the rendered result rather`
   ->
   `6. Open the supplied project references and compare the rendered result rather`
3. `Assess every applicable image against the supplied Croprun references for:`
   ->
   `Assess every applicable image against the supplied project references for:`
4. `significant Croprun-style/usability` -> `significant style/usability`
5. `- Screenshot -> Croprun reference -> assessment` ->
   `- Screenshot -> project reference -> assessment`

- [ ] **Step 6: Verify no Croprun-isms remain**

```bash
grep -rni "croprun" skills/
```

Expected: no output.

- [ ] **Step 7: Format, lint, test**

```bash
npm run format
npm run lint
node --test src/workflow/skill-pack.test.ts
```

Expected: all pass.

- [ ] **Step 8: Commit**

```bash
git add skills/
git commit -m "feat(skills): generalize checkpointed implementation skill for any repository (#265)"
```

### Task 4: Bump skill-pack version and add update notice

**Files:**

- Modify: `src/workflow/skill-pack.ts` (version constant in
  `PATCHMILL_RECOMMENDED_SKILL_PACK`)
- Modify: `src/cli/commands/skills/update.ts` (`VERSION_NOTICES` array, after
  the `2026.09.1` entry)
- Test: `src/workflow/skill-pack.test.ts`

**Interfaces:**

- Consumes: Task 3's generalized files (the notice describes them).
- Produces: pack version `2026.09.2` that Task 6 syncs into
  `.patchmill/skills/`.

- [ ] **Step 1: Bump the pack version**

In `src/workflow/skill-pack.ts`, replace `version: "2026.09.1",` with
`version: "2026.09.2",`.

- [ ] **Step 2: Add the update notice**

In `src/cli/commands/skills/update.ts`, append to `VERSION_NOTICES` after the
`2026.09.1` entry:

```typescript
  {
    version: "2026.09.2",
    message:
      "The single-subagent-dev-with-codex-and-thermo-reviews skill is now a checkpointed\n" +
      "single-writer workflow: fresh workers per milestone, frozen review waves, and\n" +
      "oracle adjudication with per-finding repair budgets. Configured skill paths are\n" +
      "unchanged; no patchmill.config.json update is required.",
  },
```

- [ ] **Step 3: Update the version assertion**

In `src/workflow/skill-pack.test.ts`, replace
`assert.equal(PATCHMILL_RECOMMENDED_SKILL_PACK.version, "2026.09.1");` with
`assert.equal(PATCHMILL_RECOMMENDED_SKILL_PACK.version, "2026.09.2");`.

- [ ] **Step 4: Run the affected tests**

```bash
node --test src/workflow/skill-pack.test.ts src/cli/commands/skills/update.test.ts src/cli/commands/skills/main.test.ts
```

Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add src/workflow/skill-pack.ts src/workflow/skill-pack.test.ts src/cli/commands/skills/update.ts
git commit -m "feat(skills): bump recommended skill pack to 2026.09.2 (#265)"
```

### Task 5: Sidecar link-integrity test (TDD)

**Files:**

- Test: `src/workflow/skill-pack.test.ts`

**Interfaces:**

- Consumes: Task 2/3 file layout.
- Produces: a regression test later tasks and future skill edits must keep
  green.

- [ ] **Step 1: Write the failing-capable test**

In `src/workflow/skill-pack.test.ts`, add `existsSync` to the `node:fs` import
(it currently imports only `readFileSync`):

```typescript
import { existsSync, readFileSync } from "node:fs";
```

Then append this test:

```typescript
test("implementation skill sidecar references resolve to files on disk", () => {
  const implementationSkills = [
    "single-subagent-dev-with-codex-and-thermo-reviews",
    "subagent-dev-with-codex-and-thermo-reviews",
  ];
  const referencePattern =
    /`((?:\.\.\/|prompts\/|schemas\/|rubrics\/)[^`\s]+)`/gu;
  const missing: string[] = [];
  for (const skillName of implementationSkills) {
    const skillDir = join(repoRoot, "skills", skillName);
    const text = readFileSync(join(skillDir, "SKILL.md"), "utf8");
    for (const match of text.matchAll(referencePattern)) {
      const reference = match[1];
      if (!existsSync(join(skillDir, reference))) {
        missing.push(`${skillName}: ${reference}`);
      }
    }
  }
  assert.deepEqual(missing, []);
});
```

- [ ] **Step 2: Prove the test can fail**

```bash
mv skills/single-subagent-dev-with-codex-and-thermo-reviews/prompts/implement-milestone.md /tmp/
node --test src/workflow/skill-pack.test.ts
mv /tmp/implement-milestone.md skills/single-subagent-dev-with-codex-and-thermo-reviews/prompts/
```

Expected: the run with the file moved FAILS, listing
`single-subagent-dev-with-codex-and-thermo-reviews: prompts/implement-milestone.md`.

- [ ] **Step 3: Run the test to verify it passes**

```bash
node --test src/workflow/skill-pack.test.ts
```

Expected: PASS, including the new test.

- [ ] **Step 4: Commit**

```bash
git add src/workflow/skill-pack.test.ts
git commit -m "test(skills): verify implementation skill sidecar references resolve (#265)"
```

### Task 6: Site docs refresh

**Files:**

- Modify: `site/src/content/docs/getting-started/configuration.md` (after the
  opt-in implementation skills JSON block, before the "See [Skills
  configuration]" line)

**Interfaces:**

- Consumes: Task 3's final wording.
- Produces: user-facing description of the replaced skill.

- [ ] **Step 1: Add the description sentence**

After the closing ``` fence of the opt-in skills JSON block, insert:

```markdown
The `single-subagent-dev-with-codex-and-thermo-reviews` skill checkpoints
implementation in milestones, holds every reviewer to one frozen head per wave,
adjudicates findings through a read-only oracle with per-finding repair budgets,
and adds a visual-evidence review wave when the diff changes visible UI. It
requires the pi-subagents built-in `oracle`, `worker`, and `reviewer` roles.
```

- [ ] **Step 2: Lint**

```bash
npx markdownlint-cli2 "site/src/content/docs/getting-started/configuration.md"
npx prettier --check "site/src/content/docs/getting-started/configuration.md"
```

Expected: both pass.

- [ ] **Step 3: Commit**

```bash
git add site/src/content/docs/getting-started/configuration.md
git commit -m "docs(site): describe oracle-adjudicated checkpointed implementation skill (#265)"
```

### Task 7: Sync the installed pack and run full verification

**Files:**

- Modify: `.patchmill/skills/` (tracked installed copy, regenerated by the
  update command)

**Interfaces:**

- Consumes: every previous task.
- Produces: the synchronized install that ships with the branch.

- [ ] **Step 1: Sync the repo's installed skills**

```bash
node bin/patchmill.ts skills update
```

Expected: pack updates from `2026.09.1` to `2026.09.2` and prints the new
notice. If the command reports local drift, stop and investigate — the worktree
install should be unmodified.

- [ ] **Step 2: Verify both sides of the integration**

```bash
diff -r skills/single-subagent-dev-with-codex-and-thermo-reviews \
  .patchmill/skills/single-subagent-dev-with-codex-and-thermo-reviews
grep -c "implement-milestone.md\|oracle-review-result.schema.json\|final-visual-evidence-review.md" \
  .patchmill/skills/patchmill-skill-pack.json
```

Expected: `diff -r` prints nothing; grep counts 3 or more manifest entries.

- [ ] **Step 3: Run doctor**

```bash
node bin/patchmill.ts doctor
```

Expected: all checks pass, including skill-file readability and frontmatter.

- [ ] **Step 4: Run the full suite and lint**

```bash
npm test
npm run lint
```

Expected: everything passes except the two known pre-existing environment
failures listed in Global Constraints; no new failures.

- [ ] **Step 5: Commit**

```bash
git add .patchmill/
git commit -m "chore(skills): sync installed skill pack to 2026.09.2 (#265)"
```

## Self-Review Notes

- Spec coverage: work items 1-6 from issue #265 map to Tasks 2, 2, 3, 4, 5, and
  7 respectively; generalization wording and non-goals match the spec.
- Placeholder scan: every edit step carries exact old/new text or exact file
  paths and commands.
- Type consistency: `existsSync` import change is stated where the test uses it;
  `repoRoot` and `join` are already defined in `skill-pack.test.ts`.
