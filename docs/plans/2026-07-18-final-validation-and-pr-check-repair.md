# Final Validation and PR Check Repair Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make all Patchmill implementation workflows repair final local
validation failures before landing and repair code-related pull-request check
failures before returning a successful `pr-created` handoff.

**Architecture:** Keep the existing Pi-owned landing flow and `pr-created`
contract. Add shared final validation-readiness and PR-check repair prompts to
`subagent-dev-with-codex-and-thermo-reviews`, update both Codex/thermo wrappers,
and add a validation-only `subagent-dev-with-validation-and-pr-checks` wrapper
around Superpowers `subagent-driven-development`. Make the validation-only
wrapper the recommended project-local default, retain the raw Superpowers skill
as its dependency, and synchronize all canonical wrappers into the installed
skill pack.

**Tech Stack:** Markdown Pi skills and prompt templates, Patchmill skill-pack
installer/updater, TypeScript Node test runner, GitHub `gh` and Forgejo/Gitea
`tea` host tooling.

## Global Constraints

- Keep this prompt- and skill-driven; do not add an orchestrator-owned
  validation state machine or command executor.
- Do not add new run-state statuses or change the `pr-created`, `merged`, or
  `blocked` JSON contracts.
- Do not move pull-request creation from the top-level Pi session into
  `IssueHostProvider`.
- Run final validation after Codex and thermo-nuclear review and before landing.
- Treat every file introduced or changed between base and head as implementation
  scope, including materialized plan/spec artifacts.
- Never dismiss a failing file as "unchanged" merely because an earlier workflow
  commit introduced it.
- Use code-repair workers only for test, lint, formatting, type-check, or build
  failures.
- Treat cancelled, timed-out, infrastructure, permissions, quota, billing, or
  host-service failures as operator blockers.
- Allow no more than two post-PR code-repair passes.
- Return successful `pr-created` JSON only after all observable required checks
  pass.
- Keep canonical `skills/` resources, installed `.patchmill/skills/` resources,
  skill-pack metadata, tests, docs, and generated config references
  synchronized.
- The new validation-only wrapper must run Superpowers task-level development
  and reviews but must not add Codex or thermo-nuclear full-worktree reviews.
- Make `.patchmill/skills/subagent-dev-with-validation-and-pr-checks` the
  recommended project-local implementation path while retaining
  `.patchmill/skills/subagent-driven-development` as its installed dependency.
- Do not rewrite explicit implementation skill choices in existing repositories;
  leave the global compatibility fallback unchanged.
- Invoke the `writing-skills` skill before editing or validating skill content.
- Do not add tests that merely assert static Markdown wording. Use direct
  verification for prompt prose and automated tests for skill installation,
  hashing, and version behavior.
- No npm dependency changes are planned. If `package.json`, `package-lock.json`,
  or `npm-shrinkwrap.json` changes unexpectedly, stop and inspect the cause;
  rerun the Nix build before completion if such a dependency change is retained.

---

## File Structure

- Create
  `skills/subagent-dev-with-codex-and-thermo-reviews/prompts/final-validation-review.md`
  for the shared review-only final command execution and failure-reporting
  contract.
- Create
  `skills/subagent-dev-with-codex-and-thermo-reviews/prompts/fix-pr-checks.md`
  for shared focused repair of code-related CI failures on an existing PR
  branch.
- Modify `skills/subagent-dev-with-codex-and-thermo-reviews/SKILL.md` to add
  final validation review/fix and post-PR readiness stages to the task-by-task
  workflow.
- Modify `skills/single-subagent-dev-with-codex-and-thermo-reviews/SKILL.md` to
  enforce the same stages through its existing shared-skill dependency.
- Create `skills/subagent-dev-with-validation-and-pr-checks/SKILL.md` as a
  validation-only wrapper around the installed Superpowers task-level skill.
- Modify `.patchmill/skills/landing/SKILL.md` to withhold final `pr-created`
  JSON until the configured implementation skill's PR-check readiness loop
  completes.
- Modify `src/workflow/skill-pack.ts` to bump the recommended pack version to
  `2026.07.2`.
- Modify `src/workflow/skill-pack.test.ts` to expect the new pack version.
- Modify `src/cli/commands/init/skill-installer.test.ts` so installation
  metadata coverage includes the new wrapper and both new prompt sidecars.
- Modify `src/cli/commands/init/main.test.ts` and
  `src/cli/commands/init/config-writer.test.ts` to expect the wrapper in
  generated project-local config.
- Modify the public skills/configuration docs to show the wrapper as the
  initialized implementation default.
- Regenerate all three installed wrapper `SKILL.md` files, both new shared
  prompt files under
  `.patchmill/skills/subagent-dev-with-codex-and-thermo-reviews/prompts/`, and
  `.patchmill/skills/patchmill-skill-pack.json` with `patchmill skills update`.

---

### Task 1: Add Final Validation and PR Check Prompt Contracts

**Files:**

- Create:
  `skills/subagent-dev-with-codex-and-thermo-reviews/prompts/final-validation-review.md`
- Create:
  `skills/subagent-dev-with-codex-and-thermo-reviews/prompts/fix-pr-checks.md`
- Modify: `skills/subagent-dev-with-codex-and-thermo-reviews/SKILL.md`
- Modify: `skills/single-subagent-dev-with-codex-and-thermo-reviews/SKILL.md`
- Modify: `.patchmill/skills/landing/SKILL.md`

**Interfaces:**

- Consumes: existing Pi `worker` and `reviewer` agents; shared
  `prompts/fix-review-findings.md`; configured landing skill; host CLIs already
  named by Patchmill's landing prompt.
- Produces: shared `prompts/final-validation-review.md` with runtime fields
  `{BASE_SHA}`, `{HEAD_SHA}`, `{WORKTREE_PATH}`, `{PLAN_OR_SPEC_PATHS}`,
  `{REQUIRED_VALIDATION_COMMANDS}`, and `{PRIOR_VALIDATION_SUMMARY}`; shared
  `prompts/fix-pr-checks.md` with PR/check/runtime fields; task-by-task and
  single-subagent skill processes that run both contracts before final handoff.

- [ ] **Step 1: Read the skill-writing workflow and capture the existing skill
      baseline**

Read:

```text
skills/writing-skills/SKILL.md
skills/subagent-dev-with-codex-and-thermo-reviews/SKILL.md
skills/subagent-dev-with-codex-and-thermo-reviews/prompts/fix-review-findings.md
skills/single-subagent-dev-with-codex-and-thermo-reviews/SKILL.md
.patchmill/skills/landing/SKILL.md
```

Then run:

```bash
for skill in \
  subagent-dev-with-codex-and-thermo-reviews \
  single-subagent-dev-with-codex-and-thermo-reviews
do
  cmp \
    "skills/$skill/SKILL.md" \
    ".patchmill/skills/$skill/SKILL.md"
done
```

Expected: PASS with no output, proving both canonical and installed skill files
match before edits.

Use PR #99 as the RED behavior evidence: the recorded session ran
`npm run lint`, observed a non-zero result for branch-added plan/spec files,
created PR #99 anyway, and CI failed on the same command.

- [ ] **Step 2: Create the final validation-readiness reviewer prompt**

Create
`skills/subagent-dev-with-codex-and-thermo-reviews/prompts/final-validation-review.md`
with this complete shared content:

````markdown
# Final Validation Readiness Review Prompt

Use this template when dispatching the final fresh-context Pi `reviewer` after
Codex and thermo-nuclear review and before landing.

```text
Review-only task. Do not edit files.

You are performing: Final validation-readiness review

## Implementation scope

Base SHA: {BASE_SHA}
Head SHA: {HEAD_SHA}
Worktree: {WORKTREE_PATH}
Plan/spec: {PLAN_OR_SPEC_PATHS}
Required final validation commands:
{REQUIRED_VALIDATION_COMMANDS}
Prior validation summary (evidence only; do not rely on it instead of running commands):
{PRIOR_VALIDATION_SUMMARY}

Inspect the complete base-to-head scope before classifying a failure:

- `git diff --stat {BASE_SHA}..{HEAD_SHA}`
- `git diff --name-status {BASE_SHA}..{HEAD_SHA}`
- `git status --short`
- committed, uncommitted, and untracked implementation files
- materialized plan/spec artifacts and other files added by workflow commits

## Required procedure

1. Run every required final validation command that is feasible in the prepared development environment.
2. Record each command, exit status, and concise result evidence.
3. Treat every non-zero exit from a required command as an actionable finding unless the evidence demonstrates an external operator or infrastructure blocker.
4. Treat every file added or changed between base and head as implementation scope, even when an earlier workflow commit or another worker introduced it.
5. Do not dismiss a failing path as "pre-existing" or "unchanged" when it is absent from the base SHA or differs from the base SHA.
6. For a repository-fixable failure, cite the command, relevant output, and affected paths so a worker can repair it.
7. For an external blocker, cite the failed command and evidence showing why repository changes cannot repair it.
8. Do not return a passing verdict while any required command has an unresolved non-zero exit.

## Finding severity

- Critical: validation exposes data loss, security, release corruption, or an unsafe landing condition.
- Important: any repository-fixable required test, lint, formatting, type-check, or build failure.
- Minor: non-blocking validation quality improvements that do not change the command result.

## Output format

### Validation commands
- `<command>` — pass | fail | blocked — concise evidence

### Findings

#### Critical
Actionable findings with command, output, and path evidence.

#### Important
Actionable findings with command, output, and path evidence.

#### Minor
Non-blocking improvements with evidence.

### Verdict
pass | pass-with-deferred-minor-findings | fail | blocked

### Reasoning
One or two concise technical sentences explaining whether landing may proceed.
```
````

- [ ] **Step 3: Create the PR-check repair worker prompt**

Create
`skills/subagent-dev-with-codex-and-thermo-reviews/prompts/fix-pr-checks.md`
with this complete shared content:

````markdown
# Fix Pull Request Checks Prompt

Use this template when dispatching a Pi `worker` to repair code-related failed
checks on an existing pull request.

```text
You are repairing code-related failed checks on an existing pull request. Do not dispatch subagents.

## Pull request context

Pull request: {PR_URL}
Branch: {BRANCH}
Expected failed head SHA: {FAILED_HEAD_SHA}
Current local HEAD: {CURRENT_HEAD_SHA}
Worktree: {WORKTREE_PATH}
Plan/spec: {PLAN_OR_SPEC_PATHS}

## Failed checks

{FAILED_CHECKS}

## Failed-step evidence

{FAILED_CHECK_LOGS}

## Prior readiness evidence

Local validation: {LOCAL_VALIDATION_SUMMARY}
Final reviews: {FINAL_REVIEW_SUMMARY}
Prior PR-check repair attempts: {REPAIR_ATTEMPT_COUNT}

## Required procedure

1. Verify the pull request still points at the expected failed head SHA. If it moved, stop and report `NEEDS_CONTEXT` with both SHAs instead of editing against stale CI evidence.
2. Reproduce or explain each failed test, lint, formatting, type-check, or build check locally when feasible.
3. Apply only repository changes needed to repair the demonstrated failures.
4. Preserve the approved plan/spec, product behavior, public API, architecture, migration strategy, and landing policy unless the failed check proves a defect in one of them.
5. Run focused validation for the changed files and rerun every final validation command affected by the repair.
6. Commit the repair with a focused Conventional Commit.
7. Push normally to the existing pull-request branch. Never force-push.
8. Do not claim that cancelled, timed-out, infrastructure, permissions, quota, billing, or host-service failures were repaired with code.

## Report format

- Status: DONE | DONE_WITH_CONCERNS | BLOCKED | NEEDS_CONTEXT
- Failed checks addressed
- Root cause
- Files changed
- Commit SHA and subject
- Validation run and results
- Push result
- Remaining failed or external checks
```
````

- [ ] **Step 4: Add final validation and PR readiness stages to both
      implementation skills**

Update both:

```text
skills/subagent-dev-with-codex-and-thermo-reviews/SKILL.md
skills/single-subagent-dev-with-codex-and-thermo-reviews/SKILL.md
```

In each file, update the opening description to say the workflow closes with
Codex, thermo-nuclear, and final validation readiness before landing.

In each file's **Required sub-skills and agents** section, replace the
reviewer/worker bullets with:

```markdown
- Use Pi `subagent` with the canonical `reviewer` agent for both final code
  review passes and the final validation-readiness review.
- Use Pi `subagent` with `worker` to fix accepted final-review findings, final
  validation findings, and code-related failed PR checks.
```

In each skill, replace the current `### 7. Complete Patchmill handoff` section
with the following process. Use local `prompts/...` paths in
`subagent-dev-with-codex-and-thermo-reviews`; use
`../subagent-dev-with-codex-and-thermo-reviews/prompts/...` paths in
`single-subagent-dev-with-codex-and-thermo-reviews`:

```markdown
### 7. Run final validation-readiness review

Only start this after the Codex and thermo-nuclear review loops are closed.
Refresh base SHA, current HEAD, `git status --short`, plan/spec paths, required
validation commands, and prior validation evidence.

Dispatch a fresh-context, review-only `reviewer` using
`prompts/final-validation-review.md`. The reviewer must run every feasible
required final command and treat any repository-fixable non-zero result as an
Important or Critical finding. Every base-to-head file is in scope, including
materialized plan/spec files and files created by earlier workflow commits.

Prior passing summaries are evidence only. They do not permit the reviewer to
skip commands. Landing is blocked until the reviewer returns `pass` or
`pass-with-deferred-minor-findings`.

### 8. Fix final validation findings

When the validation-readiness reviewer reports repository-fixable findings:

1. Synthesize the accepted validation findings with exact commands, concise
   output, and affected paths.
2. Dispatch `worker` using the skill's existing `fix-review-findings.md`
   contract (`prompts/fix-review-findings.md` in the shared skill or the sibling
   path in the single-subagent skill).
3. Require focused fixes, appropriate validation, and a Conventional Commit.
4. Refresh HEAD, worktree status, and validation evidence.
5. Re-run the final validation-readiness review.

If validation is blocked by external tooling, infrastructure, credentials, or
operator action, return the existing blocked contract with evidence. Never
classify a branch-added failing file as out of scope merely because the
implementation worker did not edit it.

### 9. Complete landing and verify PR checks

After all three final review gates are closed:

1. Summarize implementation commits, passing validation, Codex review, thermo
   review, final validation-readiness review, and deferred findings.
2. Continue with the configured landing skill or Patchmill PR/direct-land
   instructions.
3. For direct landing, return `merged` only after the final validation-readiness
   review passed.
4. For PR fallback, create or update the pull request, then obtain its URL and
   current head SHA before returning final JSON.
5. Wait for all observable required PR checks using configured host tooling.
6. If all required checks pass, return the normal `pr-created` final JSON with
   only current passing validation evidence.
7. If test, lint, formatting, type-check, or build checks fail, collect failed
   check names, URLs, and failed-step logs. Dispatch `worker` using
   `prompts/fix-pr-checks.md`, then wait for replacement checks after its push.
8. Allow at most two PR-check repair passes. If code-related checks still fail,
   return the existing blocked contract with the remaining failures and links.
9. Treat cancelled, timed-out, infrastructure, permissions, quota, billing, or
   host-service failures as operator blockers. Do not dispatch a code-repair
   worker for them.

For GitHub, use `gh pr checks` and `gh run view --log-failed` or equivalent
supported commands. For Forgejo/Gitea, use the configured `tea` or API tooling.
If required checks cannot be observed, report that limitation rather than
claiming the PR is ready.
```

In the shared skill's **Supporting files**, add:

```markdown
- `prompts/final-validation-review.md` — final review-only command execution and
  validation finding contract shared by both implementation workflows.
- `prompts/fix-pr-checks.md` — worker contract for code-related failed checks on
  an existing pull request, shared by both implementation workflows.
```

In the single-subagent skill's **Supporting files**, add:

```markdown
- `../subagent-dev-with-codex-and-thermo-reviews/prompts/final-validation-review.md`
  — shared final validation-readiness reviewer contract.
- `../subagent-dev-with-codex-and-thermo-reviews/prompts/fix-pr-checks.md` —
  shared worker contract for code-related failed PR checks.
```

In the single-subagent skill's **Rationalization checks**, add the following
rows. Add the same rules as prose under the shared skill's **Red flags** because
that skill does not currently have a rationalization table:

```markdown
| "The failing file was not edited by the implementation worker." | Base-to-head
scope includes every workflow commit and materialized artifact. Fix the required
validation failure before landing. | | "The PR exists, so handoff is complete."
| PR fallback is complete only after observable required checks pass or an
operator blocker is reported. | | "Retry CI until it eventually passes." | Run
no more than two code-repair passes; classify external failures instead of
looping. |
```

In both skills' **Red flags**, add:

```markdown
- Proceed to landing after a required validation command exits non-zero.
- Dismiss branch-added plan/spec or workflow artifacts as unchanged.
- Return `pr-created` before observable required checks finish.
- Dispatch code workers for infrastructure or operator failures.
- Run more than two PR-check repair passes.
```

Add dispatch examples in both skills for the final validation prompt with
`reviewer` and the PR-check repair prompt with `worker`, using
`context: "fresh"` for the reviewer and the normal worker context for fixes. The
shared skill uses local `prompts/...` paths; the single-subagent skill uses the
exact sibling paths under
`../subagent-dev-with-codex-and-thermo-reviews/prompts/`.

- [ ] **Step 5: Tighten the Patchmill dogfood landing contract**

In `.patchmill/skills/landing/SKILL.md`, replace the sentence immediately before
the `pr-created` JSON example with:

```markdown
For everything else, create or update a pull request and follow the configured
implementation skill's post-PR check readiness procedure. Do not return final
`pr-created` JSON immediately after creating the PR. Wait for observable
required checks; repair code-related test/lint/format/type-check/build failures
through the configured worker loop; and return an operator blocker for
cancelled, timed-out, infrastructure, permissions, quota, billing, or host
service failures. Return `pr-created` only after required checks pass. Prefer PR
fallback for visual UI changes, migrations, large refactors, dependency updates,
security-sensitive changes, and anything that needs human product, UX, or
architecture review. Include a `landingDecision` that explains why human review
is required:
```

- [ ] **Step 6: Format and directly verify prompt contracts**

Run:

```bash
npx prettier --write \
  skills/subagent-dev-with-codex-and-thermo-reviews/SKILL.md \
  skills/subagent-dev-with-codex-and-thermo-reviews/prompts/final-validation-review.md \
  skills/subagent-dev-with-codex-and-thermo-reviews/prompts/fix-pr-checks.md \
  skills/single-subagent-dev-with-codex-and-thermo-reviews/SKILL.md \
  .patchmill/skills/landing/SKILL.md

npx markdownlint-cli2 \
  skills/subagent-dev-with-codex-and-thermo-reviews/SKILL.md \
  skills/subagent-dev-with-codex-and-thermo-reviews/prompts/final-validation-review.md \
  skills/subagent-dev-with-codex-and-thermo-reviews/prompts/fix-pr-checks.md \
  skills/single-subagent-dev-with-codex-and-thermo-reviews/SKILL.md

git diff --check
```

Expected: all commands PASS.

No new automated test is added for exact prompt prose because that would assert
static Markdown wording. The real PR #99 transcript is the regression evidence;
formatting, Markdown lint, skill pressure-testing required by `writing-skills`,
and the installation/hash tests in Task 2 provide verification.

- [ ] **Step 7: Review and commit the canonical skill change**

Run:

```bash
git diff -- \
  skills/subagent-dev-with-codex-and-thermo-reviews \
  skills/single-subagent-dev-with-codex-and-thermo-reviews \
  .patchmill/skills/landing/SKILL.md
```

Confirm the final validation stage precedes landing, the PR repair loop follows
PR creation, external failures are blockers, and the repair loop is capped at
two attempts.

Commit:

```bash
git add \
  skills/subagent-dev-with-codex-and-thermo-reviews/SKILL.md \
  skills/subagent-dev-with-codex-and-thermo-reviews/prompts/final-validation-review.md \
  skills/subagent-dev-with-codex-and-thermo-reviews/prompts/fix-pr-checks.md \
  skills/single-subagent-dev-with-codex-and-thermo-reviews/SKILL.md \
  .patchmill/skills/landing/SKILL.md
git commit -m "feat(skills): gate PR handoff on validation"
```

---

### Task 2: Add the Validation-Only Default Wrapper

**Files:**

- Create: `skills/subagent-dev-with-validation-and-pr-checks/SKILL.md`
- Modify: `src/workflow/skill-pack.ts`
- Modify: `src/workflow/skill-pack.test.ts`
- Modify: `src/cli/commands/init/skill-installer.ts`
- Modify: `src/cli/commands/init/main.test.ts`
- Modify: `src/cli/commands/init/config-writer.test.ts`
- Modify: `src/cli/commands/doctor/checks.test.ts`
- Modify: `site/src/content/docs/guides/skills-configuration.md`
- Modify: `site/src/content/docs/getting-started/configuration.md`
- Modify: `site/src/content/docs/reference/configuration-example.md`

**Interfaces:**

- Consumes: installed sibling Superpowers
  `../subagent-driven-development/SKILL.md`; shared final readiness prompts
  under `../subagent-dev-with-codex-and-thermo-reviews/prompts/`; existing
  landing and result contracts.
- Produces: exported constant
  `SUBAGENT_DEV_WITH_VALIDATION_AND_PR_CHECKS_SKILL`; canonical wrapper skill
  `subagent-dev-with-validation-and-pr-checks`; recommended project-local
  implementation path
  `.patchmill/skills/subagent-dev-with-validation-and-pr-checks`; unchanged raw
  Superpowers dependency in the pack.

- [ ] **Step 1: Write failing recommended-pack and init expectations**

In `src/workflow/skill-pack.test.ts`, change the recommended config expectation
to:

```typescript
assert.deepEqual(buildRecommendedProjectSkillConfig(), {
  triage: ".patchmill/skills/patchmill-issue-triage",
  planning: ".patchmill/skills/patchmill-planning",
  implementation:
    ".patchmill/skills/subagent-dev-with-validation-and-pr-checks",
  visualEvidence: ".patchmill/skills/patchmill-visual-evidence",
});
```

Add the new Patchmill wrapper to the expected pack skill list immediately before
`subagent-dev-with-codex-and-thermo-reviews`:

```typescript
{
  name: "subagent-dev-with-validation-and-pr-checks",
  source: "patchmill",
},
```

Keep this existing raw dependency entry unchanged later in the list:

```typescript
{ name: "subagent-driven-development", source: "superpowers" },
```

In `src/cli/commands/init/main.test.ts` and
`src/cli/commands/init/config-writer.test.ts`, change only the project-local
fixture value:

```typescript
implementation:
  ".patchmill/skills/subagent-dev-with-validation-and-pr-checks",
```

Do not change the `GLOBAL_SKILLS` compatibility fixture in `main.test.ts`; it
must remain `superpowers:subagent-driven-development`.

In `src/cli/commands/doctor/checks.test.ts`, update
`recommendedProjectLocalConfig()` so its configured implementation path is:

```typescript
implementation:
  `${DEFAULT_PROJECT_SKILL_DIR}/subagent-dev-with-validation-and-pr-checks`,
```

For test fixtures that use `recommendedProjectLocalConfig()`, create and hash
`subagent-dev-with-validation-and-pr-checks` as the configured implementation
skill. Retain separate fixtures that intentionally test the raw
`superpowers:subagent-driven-development` compatibility reference or the raw
installed dependency.

In the main init integration test, add this installed-file assertion beside the
other implementation wrapper assertions:

```typescript
await access(
  join(
    repoRoot,
    ".patchmill",
    "skills",
    "subagent-dev-with-validation-and-pr-checks",
    "SKILL.md",
  ),
);
```

- [ ] **Step 2: Run focused tests to verify the wrapper is missing**

Run:

```bash
node --test \
  src/workflow/skill-pack.test.ts \
  src/cli/commands/init/config-writer.test.ts \
  src/cli/commands/init/main.test.ts \
  src/cli/commands/doctor/checks.test.ts
```

Expected: FAIL because `buildRecommendedProjectSkillConfig()` still returns the
raw project-local Superpowers skill and the recommended pack does not contain a
Patchmill source entry for the new wrapper.

- [ ] **Step 3: Create the validation-only wrapper skill**

Create `skills/subagent-dev-with-validation-and-pr-checks/SKILL.md` with this
complete content:

````markdown
---
name: subagent-dev-with-validation-and-pr-checks
description:
  Use when executing Patchmill implementation plans with Superpowers task-level
  development plus final validation and pull-request readiness, without extra
  Codex or thermo-nuclear full-worktree reviews
---

# Patchmill Subagent Dev with Validation and PR Checks

Execute the implementation plan with Superpowers' subagent-driven-development
pattern, then require final validation readiness and observable passing PR
checks before Patchmill returns a successful handoff.

**Core principle:** preserve the normal task-level implementation and review
workflow while ensuring known local or CI failures are repaired before landing
is declared ready.

## Required sub-skills and agents

- **REQUIRED SUB-SKILL:** Use the installed sibling Superpowers
  subagent-driven-development skill for task-by-task plan execution. Read it
  from `../subagent-driven-development/SKILL.md` and read its prompt templates
  from `../subagent-driven-development/` before dispatching task-level
  subagents.
- **REQUIRED SUB-SKILL:** Use `superpowers:verification-before-completion`
  before claiming success.
- Use Pi `subagent` with the canonical `reviewer` agent for the final
  validation-readiness review.
- Use Pi `subagent` with `worker` to fix final validation findings and
  code-related failed PR checks.
- Use the shared final-readiness prompts from
  `../subagent-dev-with-codex-and-thermo-reviews/prompts/`.
- Do not run the Codex or thermo-nuclear full-worktree review passes from the
  sibling Patchmill wrapper. This skill intentionally adds validation and PR
  readiness only.
- Do **not** use legacy `code-reviewer`; in Pi, it is a disabled compatibility
  shim.

Before launching any subagent, list available agents with
`subagent({ action: "list" })` and confirm `reviewer` and `worker` are
executable.

## Process

### 1. Execute the implementation plan

Follow the installed sibling Superpowers subagent-driven-development workflow
for all implementation tasks:

1. Fresh implementer/worker per task as directed by that skill.
2. Task-level spec compliance review.
3. Task-level code quality review.
4. Fix and re-review until each task is complete.

Adapt any upstream `superpowers:code-reviewer` or `code-reviewer` wording to the
canonical Pi `reviewer`. Do not add the separate Codex or thermo-nuclear
full-worktree review loops used by the heavier Patchmill wrappers.

### 2. Capture final implementation scope

After all plan tasks and task-level reviews are complete:

1. Record the implementation base SHA and current `HEAD`.
2. Run `git status --short`.
3. Record the approved plan/spec paths.
4. Collect every final validation command required by the plan, repository
   instructions, and configured workflow.
5. Include committed, uncommitted, untracked, and materialized workflow files in
   base-to-head scope.

Refresh this scope after every fix pass.

### 3. Run final validation-readiness review

Dispatch a fresh-context, review-only `reviewer` using
`../subagent-dev-with-codex-and-thermo-reviews/prompts/final-validation-review.md`.
Prior validation summaries are evidence only; the reviewer must run every
feasible required final command.

Every base-to-head file is in scope, including materialized plans/specs and
files created by earlier workflow commits. Landing is blocked until the reviewer
returns `pass` or `pass-with-deferred-minor-findings`.

### 4. Fix final validation findings

For repository-fixable findings:

1. Synthesize exact commands, concise output, and affected paths.
2. Dispatch `worker` using
   `../subagent-dev-with-codex-and-thermo-reviews/prompts/fix-review-findings.md`.
3. Require focused fixes, validation, and a Conventional Commit.
4. Refresh final scope and re-run the validation-readiness reviewer.

For external tooling, infrastructure, credential, or operator blockers, return
the existing blocked contract with evidence. Never dismiss a branch-added file
as unchanged merely because another worker or workflow commit introduced it.

### 5. Complete landing and verify PR checks

After final validation passes:

1. Continue with the configured landing skill or Patchmill PR/direct-land
   instructions.
2. For direct landing, return `merged` only after final validation passed.
3. For PR fallback, create or update the PR, then capture its URL and current
   head SHA.
4. Wait for all observable required checks using configured host tooling.
5. Return `pr-created` only after all required checks pass.
6. For failed test, lint, formatting, type-check, or build checks, collect
   names, links, and failed-step logs; dispatch `worker` using
   `../subagent-dev-with-codex-and-thermo-reviews/prompts/fix-pr-checks.md`; and
   wait for replacement checks after its normal push.
7. Allow at most two PR-check repair passes.
8. Return an operator blocker for cancelled, timed-out, infrastructure,
   permissions, quota, billing, or host-service failures. Do not dispatch a code
   worker for them.

For GitHub, use `gh pr checks` and `gh run view --log-failed` or equivalent
supported commands. For Forgejo/Gitea, use the configured `tea` or API tooling.
If required checks cannot be observed, report that limitation instead of
claiming the PR is ready.

## Supporting files

- `../subagent-driven-development/SKILL.md` and its sibling templates — upstream
  task-level implementation and review workflow.
- `../subagent-dev-with-codex-and-thermo-reviews/prompts/final-validation-review.md`
  — shared final validation reviewer contract.
- `../subagent-dev-with-codex-and-thermo-reviews/prompts/fix-review-findings.md`
  — shared validation finding repair contract.
- `../subagent-dev-with-codex-and-thermo-reviews/prompts/fix-pr-checks.md` —
  shared failed PR-check repair contract.

## Rationalization checks

| Temptation                                        | Reality                                                                                                         |
| ------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| "The upstream task reviews are enough."           | Task reviews do not prove the complete branch passes final repository commands. Run final validation.           |
| "Use the Codex/thermo wrapper for consistency."   | This wrapper intentionally adds only validation and PR readiness. Do not add the heavier full-worktree reviews. |
| "The failing file was not edited by this worker." | Base-to-head scope includes every workflow commit and materialized artifact.                                    |
| "The PR exists, so handoff is complete."          | PR fallback is complete only after observable required checks pass or an operator blocker is reported.          |
| "Retry CI until it eventually passes."            | Run no more than two code-repair passes and classify external failures.                                         |

## Red flags

Never:

- Skip or replace the upstream Superpowers task-level workflow.
- Add Codex or thermo-nuclear full-worktree reviews in this wrapper.
- Proceed to landing after a required validation command exits non-zero.
- Dismiss branch-added plan/spec or workflow artifacts as unchanged.
- Return `pr-created` before observable required checks finish.
- Dispatch code workers for infrastructure or operator failures.
- Run more than two PR-check repair passes.

## Dispatch shape reference

Final validation uses fresh reviewer context:

```typescript
subagent({
  agent: "reviewer",
  context: "fresh",
  task: "Use ../subagent-dev-with-codex-and-thermo-reviews/prompts/final-validation-review.md with the final scope and required commands below...",
  output: false,
});
```

Repair passes use the normal worker context:

```typescript
subagent({
  agent: "worker",
  task: "Use the appropriate shared fix-review-findings.md or fix-pr-checks.md prompt for the evidence below...",
});
```
````

- [ ] **Step 4: Add the wrapper to the recommended pack and default config**

In `src/workflow/skill-pack.ts`, add:

```typescript
export const SUBAGENT_DEV_WITH_VALIDATION_AND_PR_CHECKS_SKILL =
  "subagent-dev-with-validation-and-pr-checks";
```

Add this Patchmill source entry immediately before the Codex/thermo wrapper:

```typescript
{
  name: SUBAGENT_DEV_WITH_VALIDATION_AND_PR_CHECKS_SKILL,
  source: "patchmill",
},
```

Keep the later raw Superpowers entry:

```typescript
{ name: "subagent-driven-development", source: "superpowers" },
```

Change `buildRecommendedProjectSkillConfig()` to:

```typescript
implementation: projectSkillPath(
  SUBAGENT_DEV_WITH_VALIDATION_AND_PR_CHECKS_SKILL,
  skillDir,
),
```

In `src/cli/commands/init/skill-installer.ts`, import the same constant from
`skill-pack.ts` and replace the hardcoded validation entry with:

```typescript
{
  name: SUBAGENT_DEV_WITH_VALIDATION_AND_PR_CHECKS_SKILL,
  skillPath: skillConfig.implementation,
},
```

Do not change `DEFAULT_PATCHMILL_SKILLS` in `src/workflow/skills.ts`; it remains
the compatibility fallback for repositories without installed project-local
skills.

- [ ] **Step 5: Update public recommended-config documentation**

Replace `.patchmill/skills/subagent-driven-development` with
`.patchmill/skills/subagent-dev-with-validation-and-pr-checks` only where the
site documents initialized/recommended project-local implementation config:

```text
site/src/content/docs/guides/skills-configuration.md
site/src/content/docs/getting-started/configuration.md
site/src/content/docs/reference/configuration-example.md
```

In `site/src/content/docs/guides/skills-configuration.md`, add one concise
sentence explaining that the wrapper delegates task execution to the installed
Superpowers skill and adds final validation plus PR-check readiness without the
optional Codex/thermo full-worktree loops.

Do not change Patchmill's own explicit
`single-subagent-dev-with-codex-and-thermo-reviews` dogfood configuration.

- [ ] **Step 6: Format and run focused wrapper/default tests**

Run:

```bash
npx prettier --write \
  skills/subagent-dev-with-validation-and-pr-checks/SKILL.md \
  src/workflow/skill-pack.ts \
  src/workflow/skill-pack.test.ts \
  src/cli/commands/init/skill-installer.ts \
  src/cli/commands/init/main.test.ts \
  src/cli/commands/init/config-writer.test.ts \
  src/cli/commands/doctor/checks.test.ts \
  site/src/content/docs/guides/skills-configuration.md \
  site/src/content/docs/getting-started/configuration.md \
  site/src/content/docs/reference/configuration-example.md

npx markdownlint-cli2 \
  skills/subagent-dev-with-validation-and-pr-checks/SKILL.md \
  site/src/content/docs/guides/skills-configuration.md \
  site/src/content/docs/getting-started/configuration.md \
  site/src/content/docs/reference/configuration-example.md

node --test \
  src/workflow/skill-pack.test.ts \
  src/cli/commands/init/config-writer.test.ts \
  src/cli/commands/init/main.test.ts \
  src/cli/commands/doctor/checks.test.ts
```

Expected: formatting and Markdown lint PASS; all focused tests PASS. The tests
prove recommended config and installation behavior rather than static wrapper
prose.

- [ ] **Step 7: Review and commit the validation-only wrapper**

Run:

```bash
git diff -- \
  skills/subagent-dev-with-validation-and-pr-checks/SKILL.md \
  src/workflow/skill-pack.ts \
  src/workflow/skill-pack.test.ts \
  src/cli/commands/init/skill-installer.ts \
  src/cli/commands/init/main.test.ts \
  src/cli/commands/init/config-writer.test.ts \
  src/cli/commands/doctor/checks.test.ts \
  site/src/content/docs/guides/skills-configuration.md \
  site/src/content/docs/getting-started/configuration.md \
  site/src/content/docs/reference/configuration-example.md
```

Confirm the wrapper contains no Codex/thermo final review stages, the raw
Superpowers skill remains in the pack, and generated project-local config points
to the wrapper.

Commit:

```bash
git add \
  skills/subagent-dev-with-validation-and-pr-checks/SKILL.md \
  src/workflow/skill-pack.ts \
  src/workflow/skill-pack.test.ts \
  src/cli/commands/init/skill-installer.ts \
  src/cli/commands/init/main.test.ts \
  src/cli/commands/init/config-writer.test.ts \
  src/cli/commands/doctor/checks.test.ts \
  site/src/content/docs/guides/skills-configuration.md \
  site/src/content/docs/getting-started/configuration.md \
  site/src/content/docs/reference/configuration-example.md
git commit -m "feat(skills): add validation-ready implementation wrapper"
```

---

### Task 3: Version and Synchronize the Installed Skill Pack

**Files:**

- Modify: `src/workflow/skill-pack.ts`
- Modify: `src/workflow/skill-pack.test.ts`
- Modify: `src/cli/commands/init/skill-installer.test.ts`
- Modify: `src/cli/commands/skills/update.ts`
- Modify: `src/cli/commands/skills/update.test.ts`
- Create through updater:
  `.patchmill/skills/subagent-dev-with-validation-and-pr-checks/SKILL.md`
- Regenerate:
  `.patchmill/skills/subagent-dev-with-codex-and-thermo-reviews/SKILL.md`
- Create through updater:
  `.patchmill/skills/subagent-dev-with-codex-and-thermo-reviews/prompts/final-validation-review.md`
- Create through updater:
  `.patchmill/skills/subagent-dev-with-codex-and-thermo-reviews/prompts/fix-pr-checks.md`
- Regenerate:
  `.patchmill/skills/single-subagent-dev-with-codex-and-thermo-reviews/SKILL.md`
- Regenerate: `.patchmill/skills/patchmill-skill-pack.json`

**Interfaces:**

- Consumes: the two canonical skill directories updated by Task 1 and the new
  wrapper from Task 2; `PATCHMILL_RECOMMENDED_SKILL_PACK`; recursive
  installer/updater file collection; `buildSkillPackMetadata()`.
- Produces: recommended skill-pack version `2026.07.2`; all three installed
  wrapper files byte-identical to canonical sources; installed shared prompts
  byte-identical to canonical prompts; raw Superpowers dependency retained;
  metadata entries whose SHA-256 values match installed bytes.

- [ ] **Step 1: Update tests for the new skill-pack version and prompt
      sidecars**

In `src/workflow/skill-pack.test.ts`, change both expected pack version values
from `2026.07.1` to `2026.07.2`:

```typescript
assert.equal(PATCHMILL_RECOMMENDED_SKILL_PACK.version, "2026.07.2");
```

and inside the `buildSkillPackMetadata()` expectation:

```typescript
version: "2026.07.2",
```

In `src/cli/commands/skills/update.test.ts`, extend the expected `notices` array
for an update from `2026.04` through the current pack with:

```typescript
{
  version: "2026.07.2",
  message:
    "Patchmill's recommended implementation skill now adds final validation and PR readiness.\n" +
    "To opt in, update patchmill.config.json:\n" +
    '  "implementation": ".patchmill/skills/subagent-dev-with-validation-and-pr-checks"',
},
```

Keep the existing `2026.07.1` planning notice before it.

In `src/cli/commands/init/skill-installer.test.ts`, add this fixture constant:

```typescript
const validationReadyImplementationSkill = `---
name: subagent-dev-with-validation-and-pr-checks
description: Execute plans with final validation and PR readiness.
---
# Subagent Dev with Validation and PR Checks
`;
```

Create that Patchmill source fixture before the Codex/thermo fixture:

```typescript
await writeSkill(
  patchmillSource,
  "subagent-dev-with-validation-and-pr-checks",
  validationReadyImplementationSkill,
);
```

Add this source entry to the test's `packSkills` immediately before the
Codex/thermo wrapper:

```typescript
{
  name: "subagent-dev-with-validation-and-pr-checks",
  source: "patchmill",
},
```

Add this path at the same position in `result.installedSkills`:

```typescript
".patchmill/skills/subagent-dev-with-validation-and-pr-checks",
```

Add a file-content assertion for the installed wrapper:

```typescript
assert.equal(
  await readFile(
    join(
      repoRoot,
      ".patchmill",
      "skills",
      "subagent-dev-with-validation-and-pr-checks",
      "SKILL.md",
    ),
    "utf8",
  ),
  validationReadyImplementationSkill,
);
```

Add its entry to `expectedMetadata` before the Codex/thermo skill:

```typescript
{
  path: ".patchmill/skills/subagent-dev-with-validation-and-pr-checks/SKILL.md",
  sha256: hashText(validationReadyImplementationSkill),
},
```

Then expand the `subagent-dev-with-codex-and-thermo-reviews` fixture to:

```typescript
await writeSkill(
  patchmillSource,
  "subagent-dev-with-codex-and-thermo-reviews",
  finalReviewedImplementationSkill,
  {
    "prompts/final-review.md": "review the final worktree\n",
    "prompts/final-validation-review.md": "review final validation\n",
    "prompts/fix-pr-checks.md": "repair failed PR checks\n",
    "rubrics/armin-codex-review-prompt.md":
      "review using Armin's Codex adaptation\n",
  },
);
```

After the existing shared `final-review.md` assertion, add:

```typescript
assert.equal(
  await readFile(
    join(
      repoRoot,
      ".patchmill",
      "skills",
      "subagent-dev-with-codex-and-thermo-reviews",
      "prompts",
      "final-validation-review.md",
    ),
    "utf8",
  ),
  "review final validation\n",
);
assert.equal(
  await readFile(
    join(
      repoRoot,
      ".patchmill",
      "skills",
      "subagent-dev-with-codex-and-thermo-reviews",
      "prompts",
      "fix-pr-checks.md",
    ),
    "utf8",
  ),
  "repair failed PR checks\n",
);
```

In the `expectedMetadata` file list, add these entries immediately after the
shared `prompts/final-review.md` entry:

```typescript
{
  path: ".patchmill/skills/subagent-dev-with-codex-and-thermo-reviews/prompts/final-validation-review.md",
  sha256: hashText("review final validation\n"),
},
{
  path: ".patchmill/skills/subagent-dev-with-codex-and-thermo-reviews/prompts/fix-pr-checks.md",
  sha256: hashText("repair failed PR checks\n"),
},
```

These assertions prove recursive installation and metadata hashing of the new
runtime prompt dependencies rather than asserting their production prose.

- [ ] **Step 2: Run focused tests to verify the version expectation fails**

Run:

```bash
node --test \
  src/workflow/skill-pack.test.ts \
  src/cli/commands/init/skill-installer.test.ts \
  src/cli/commands/init/main.test.ts \
  src/cli/commands/init/config-writer.test.ts \
  src/cli/commands/doctor/checks.test.ts \
  src/cli/commands/skills/update.ts \
  src/cli/commands/skills/update.test.ts \
  site/src/content/docs/guides/skills-configuration.md \
  site/src/content/docs/getting-started/configuration.md \
  site/src/content/docs/reference/configuration-example.md
```

Expected: FAIL in `default pack records pinned external source` because the
implementation still reports `2026.07.1`; the installer sidecar assertions may
already pass because recursive installation is existing behavior.

- [ ] **Step 3: Bump the recommended skill-pack version**

In `src/workflow/skill-pack.ts`, change:

```typescript
version: "2026.07.1",
```

to:

```typescript
version: "2026.07.2",
```

Do not change the pinned Superpowers source tag or tarball URL.

In `src/cli/commands/skills/update.ts`, append this notice to `VERSION_NOTICES`:

```typescript
{
  version: "2026.07.2",
  message:
    "Patchmill's recommended implementation skill now adds final validation and PR readiness.\n" +
    "To opt in, update patchmill.config.json:\n" +
    '  "implementation": ".patchmill/skills/subagent-dev-with-validation-and-pr-checks"',
},
```

The updater intentionally does not rewrite existing explicit config; the notice
provides the opt-in path while new initialization uses the wrapper
automatically.

- [ ] **Step 4: Run focused source tests**

Run:

```bash
node --test \
  src/workflow/skill-pack.test.ts \
  src/cli/commands/init/skill-installer.test.ts \
  src/cli/commands/skills/update.test.ts \
  src/cli/commands/skills/main.test.ts
```

Expected: PASS.

- [ ] **Step 5: Regenerate the installed skill pack from canonical sources**

Run from the task worktree root:

```bash
node bin/patchmill.ts skills update
```

Expected output includes:

```text
Updated Patchmill skill pack 2026.07.1 -> 2026.07.2.
Notice for 2026.07.2:
Patchmill's recommended implementation skill now adds final validation and PR readiness.
Run git diff to review changes.
```

The updater must:

- install the new validation-only wrapper from Task 2;
- replace both Codex/thermo wrapper `SKILL.md` files with their canonical Task 1
  versions;
- install both new shared prompt files under the task-by-task skill;
- preserve the external Superpowers source at `v6.0.3`;
- write metadata version `2026.07.2`;
- record SHA-256 entries for both new prompts.

If the updater reports customized managed files, stop and compare those files to
the old metadata instead of forcing an overwrite.

- [ ] **Step 6: Verify canonical and installed resources match byte-for-byte**

Run:

```bash
cmp \
  skills/subagent-dev-with-validation-and-pr-checks/SKILL.md \
  .patchmill/skills/subagent-dev-with-validation-and-pr-checks/SKILL.md

for file in \
  SKILL.md \
  prompts/final-review.md \
  prompts/fix-review-findings.md \
  prompts/final-validation-review.md \
  prompts/fix-pr-checks.md
do
  cmp \
    "skills/subagent-dev-with-codex-and-thermo-reviews/$file" \
    ".patchmill/skills/subagent-dev-with-codex-and-thermo-reviews/$file"
done

for file in SKILL.md prompts/implement-plan.md
do
  cmp \
    "skills/single-subagent-dev-with-codex-and-thermo-reviews/$file" \
    ".patchmill/skills/single-subagent-dev-with-codex-and-thermo-reviews/$file"
done
```

Expected: PASS with no output.

Verify metadata bytes with:

```bash
node - <<'NODE'
const { createHash } = require("node:crypto");
const { readFileSync } = require("node:fs");
const metadata = JSON.parse(
  readFileSync(".patchmill/skills/patchmill-skill-pack.json", "utf8"),
);
const targets = new Set([
  ".patchmill/skills/subagent-dev-with-validation-and-pr-checks/SKILL.md",
  ".patchmill/skills/subagent-dev-with-codex-and-thermo-reviews/SKILL.md",
  ".patchmill/skills/subagent-dev-with-codex-and-thermo-reviews/prompts/final-review.md",
  ".patchmill/skills/subagent-dev-with-codex-and-thermo-reviews/prompts/fix-review-findings.md",
  ".patchmill/skills/subagent-dev-with-codex-and-thermo-reviews/prompts/final-validation-review.md",
  ".patchmill/skills/subagent-dev-with-codex-and-thermo-reviews/prompts/fix-pr-checks.md",
  ".patchmill/skills/single-subagent-dev-with-codex-and-thermo-reviews/SKILL.md",
  ".patchmill/skills/single-subagent-dev-with-codex-and-thermo-reviews/prompts/implement-plan.md",
]);
if (metadata.pack.version !== "2026.07.2") {
  throw new Error(`unexpected pack version ${metadata.pack.version}`);
}
for (const path of targets) {
  const entry = metadata.files.find((file) => file.path === path);
  if (!entry) throw new Error(`missing metadata entry ${path}`);
  const actual = createHash("sha256").update(readFileSync(path)).digest("hex");
  if (entry.sha256 !== actual) throw new Error(`hash mismatch ${path}`);
}
console.log("installed implementation skill metadata verified");
NODE
```

Expected: `installed implementation skill metadata verified`.

- [ ] **Step 7: Verify focused integration and live configuration**

Run:

```bash
node --test \
  src/workflow/skill-pack.test.ts \
  src/cli/commands/init/skill-installer.test.ts \
  src/cli/commands/skills/update.test.ts \
  src/cli/commands/skills/main.test.ts

node - <<'NODE'
const { readFileSync } = require("node:fs");
const config = JSON.parse(readFileSync("patchmill.config.json", "utf8"));
const expected = ".patchmill/skills/single-subagent-dev-with-codex-and-thermo-reviews";
if (config.skills.implementation !== expected) {
  throw new Error(`implementation skill is ${config.skills.implementation}`);
}
console.log("live implementation skill reference verified");
NODE
```

Expected: all tests PASS and the script prints
`live implementation skill reference verified`.

- [ ] **Step 8: Review and commit the synchronized skill pack**

Run:

```bash
git status --short
git diff --stat
git diff -- \
  src/workflow/skill-pack.ts \
  src/workflow/skill-pack.test.ts \
  src/cli/commands/init/skill-installer.test.ts \
  src/cli/commands/skills/update.ts \
  src/cli/commands/skills/update.test.ts \
  .patchmill/skills/subagent-dev-with-validation-and-pr-checks \
  .patchmill/skills/subagent-dev-with-codex-and-thermo-reviews \
  .patchmill/skills/single-subagent-dev-with-codex-and-thermo-reviews \
  .patchmill/skills/patchmill-skill-pack.json
```

Confirm no unrelated managed skill changed and all metadata hashes match current
installed bytes.

Commit:

```bash
git add \
  src/workflow/skill-pack.ts \
  src/workflow/skill-pack.test.ts \
  src/cli/commands/init/skill-installer.test.ts \
  src/cli/commands/skills/update.ts \
  src/cli/commands/skills/update.test.ts \
  .patchmill/skills/subagent-dev-with-validation-and-pr-checks \
  .patchmill/skills/subagent-dev-with-codex-and-thermo-reviews \
  .patchmill/skills/single-subagent-dev-with-codex-and-thermo-reviews \
  .patchmill/skills/patchmill-skill-pack.json
git commit -m "chore(skills): publish validation repair prompts"
```

---

### Task 4: Verify End-to-End Skill Readiness

**Files:**

- Modify only if verification exposes a specific defect in files changed by
  Tasks 1-3.

**Interfaces:**

- Consumes: canonical and installed skill resources, skill-pack
  metadata/version, dogfood landing skill, repository test/lint commands.
- Produces: a clean branch whose packaged and live skill resources pass
  repository verification.

- [ ] **Step 1: Re-run the skill updater as an idempotence check**

Run:

```bash
node bin/patchmill.ts skills update
```

Expected:

```text
Patchmill skill pack is already up to date.
```

Any additional update means canonical files, installed files, or metadata are
still inconsistent; inspect and fix before continuing.

- [ ] **Step 2: Run full tests**

Run:

```bash
npm test
```

Expected: PASS with zero failures. This includes npm package dry-run coverage,
installer/updater tests, and skill-pack tests.

- [ ] **Step 3: Run full lint**

Run:

```bash
npm run lint
```

Expected: PASS. If Prettier reports any plan/spec or skill Markdown file, run
`npm run format`, inspect every resulting diff, and rerun `npm run lint`. Do not
dismiss a branch-added file as unchanged.

- [ ] **Step 4: Repeat canonical/installed and metadata verification**

Run the `cmp` loop and Node SHA-256 verifier from Task 3 Step 6 again.

Expected: both PASS.

Also run:

```bash
git diff --check
git status --short
```

Expected: no whitespace errors; only intentional verification fixes may remain
uncommitted.

- [ ] **Step 5: Review the complete feature diff**

Run:

```bash
git diff --stat f91843d..HEAD
git diff f91843d..HEAD -- \
  skills/subagent-dev-with-validation-and-pr-checks \
  skills/subagent-dev-with-codex-and-thermo-reviews \
  skills/single-subagent-dev-with-codex-and-thermo-reviews \
  .patchmill/skills/subagent-dev-with-validation-and-pr-checks \
  .patchmill/skills/subagent-dev-with-codex-and-thermo-reviews \
  .patchmill/skills/single-subagent-dev-with-codex-and-thermo-reviews \
  .patchmill/skills/landing/SKILL.md \
  .patchmill/skills/patchmill-skill-pack.json \
  src/workflow/skill-pack.ts \
  src/workflow/skill-pack.test.ts \
  src/cli/commands/init/skill-installer.ts \
  src/cli/commands/init/skill-installer.test.ts \
  src/cli/commands/init/main.test.ts \
  src/cli/commands/init/config-writer.test.ts \
  src/cli/commands/doctor/checks.test.ts \
  src/cli/commands/skills/update.ts \
  src/cli/commands/skills/update.test.ts \
  site/src/content/docs/guides/skills-configuration.md \
  site/src/content/docs/getting-started/configuration.md \
  site/src/content/docs/reference/configuration-example.md
```

Confirm:

- final validation review occurs after existing review work and before landing
  in all three wrappers;
- the validation-only wrapper delegates to Superpowers task-level development
  without adding Codex or thermo-nuclear full-worktree reviews;
- non-zero required commands become actionable findings;
- branch-added plans/specs are explicitly in scope;
- PR checks run after PR creation and before `pr-created` JSON;
- only code-related failures dispatch repair workers;
- at most two PR repair passes are allowed;
- canonical and installed resources for all three wrappers are identical;
- recommended project-local config selects the validation-only wrapper while the
  raw Superpowers dependency remains installed;
- skill-pack version and metadata are `2026.07.2`;
- external Superpowers source remains `v6.0.3`;
- no dependency file changed.

- [ ] **Step 6: Commit verification fixes only when needed**

If Steps 1-5 required changes, stage only the affected Task 1-3 files and
commit:

```bash
git add \
  skills/subagent-dev-with-validation-and-pr-checks \
  skills/subagent-dev-with-codex-and-thermo-reviews \
  skills/single-subagent-dev-with-codex-and-thermo-reviews \
  .patchmill/skills/subagent-dev-with-validation-and-pr-checks \
  .patchmill/skills/subagent-dev-with-codex-and-thermo-reviews \
  .patchmill/skills/single-subagent-dev-with-codex-and-thermo-reviews \
  .patchmill/skills/landing/SKILL.md \
  .patchmill/skills/patchmill-skill-pack.json \
  src/workflow/skill-pack.ts \
  src/workflow/skill-pack.test.ts \
  src/cli/commands/init/skill-installer.ts \
  src/cli/commands/init/skill-installer.test.ts \
  src/cli/commands/init/main.test.ts \
  src/cli/commands/init/config-writer.test.ts \
  src/cli/commands/doctor/checks.test.ts \
  src/cli/commands/skills/update.ts \
  src/cli/commands/skills/update.test.ts \
  site/src/content/docs/guides/skills-configuration.md \
  site/src/content/docs/getting-started/configuration.md \
  site/src/content/docs/reference/configuration-example.md
git commit -m "fix(skills): stabilize validation repair workflow"
```

If no fixes were needed, do not create an empty verification commit.

A Nix build is not required when npm dependency files remain unchanged. If a
dependency change is retained unexpectedly, run the repository-required Nix
build before completion.

## Plan Self-Review Checklist

- Spec coverage: Task 1 updates both Codex/thermo wrappers and covers shared
  final validation review, branch-wide scope, existing fix loop reuse, post-PR
  check collection/classification, bounded repair, current result contracts, and
  dogfood landing behavior. Task 2 adds the validation-only wrapper, preserves
  the raw Superpowers dependency, changes the recommended project-local default,
  and updates public config docs. Task 3 covers all three wrappers'
  canonical/installed synchronization, shared prompt installation, pack version,
  metadata hashes, installer coverage, and live config. Task 4 covers full
  verification and the PR #99 formatting regression rule.
- Testing Value Gate: no test asserts production Markdown wording. Installer and
  metadata assertions prove runtime prompt resources are recursively installed
  and hashed; static prompt semantics use direct review, lint, mirror
  comparison, and `writing-skills` pressure testing.
- Placeholder scan: brace-delimited names in the two prompt files are
  intentional runtime template fields defined in Task 1 Interfaces, not
  unfinished plan placeholders.
- Type/path consistency: prompt filenames, canonical paths, installed paths,
  metadata paths, pack version `2026.07.2`, and verification commands are
  consistent across all tasks.
