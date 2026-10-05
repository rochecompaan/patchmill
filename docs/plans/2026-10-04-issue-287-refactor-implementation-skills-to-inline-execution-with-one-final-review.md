# Inline Implementation with One Final Review: Implementation Plan

> **For agentic workers:** Preserve the implementation method selected for this
> Issue run. For Native execution, REQUIRED SUB-SKILL: Use the sibling
> Superpowers `executing-plans` skill. Steps use checkbox (`- [ ]`) syntax for
> tracking.

**Goal:** Replace three overlapping managed implementation wrappers with
`inline-dev-with-validation-and-pr-checks`, with one independent review and safe
final validation.

**Architecture:** A thin Patchmill wrapper uses the unchanged upstream executor,
task helpers, progress ledger, and reviewer template. One appendix owns specific
review criteria. Shared runtime requirements and migration policy connect
installation, doctor diagnostics, defaults, and Run-once prompts.

**Tech Stack:** TypeScript, Node.js 24, Bash, Markdown skills, Node test runner,
npm, devenv, and Nix.

**Spec:**
`docs/specs/2026-10-04-issue-287-inline-dev-with-validation-and-pr-checks-design.md`.

## Global Constraints

- Keep Superpowers at `v6.4.2`. This feature requires no upstream dependency
  change or upstream source edits.
- Use `skills/inline-dev-with-validation-and-pr-checks/SKILL.md` as the new
  source entrypoint.
- Install the entrypoint at
  `.patchmill/skills/inline-dev-with-validation-and-pr-checks`.
- Remove all three retired Patchmill wrappers and their support files from the
  recommended pack.
- Retain upstream `subagent-driven-development` as a helper dependency, not
  another recommended Patchmill workflow.
- Set namespace and user-global defaults to `superpowers:executing-plans`. This
  compatibility path does not automatically include the Patchmill appendix.
- Preserve explicit custom implementation skills and explicit execution-method
  choices.
- Use one fresh canonical Pi `reviewer` on the most capable available review
  model under operator policy.
- Pass resolved model and thinking values explicitly. Keep the reviewer
  read-only and prohibit child dispatch.
- Use Critical, Important, and Minor severity names. Do not add Codex priority
  tags or another verdict format.
- Complete one ordered review fix pass. Defer minors and record every ruling,
  including its cost if wrong.
- Allow at most two code-related PR-check repair passes. Never force-push.
- Keep planning review gates, Run recovery state, the Event ledger, and terminal
  JSON schemas unchanged.
- Preserve the Phase workspace while blocked. Remove only this plan's scratch
  workspace after durable reporting completes.
- Apply the Testing Value Gate. Never record completion from a command that did
  not run.
- If npm dependency files change, run
  `nix build .#patchmill --print-build-logs`.
- Carry this plan with implementation code. Do not create a planning pull
  request or another manual approval gate for this artifact.

## Execution Handoff and Starting State

The configured implementation skill currently selects
`.patchmill/skills/single-subagent-dev-with-codex-and-thermo-reviews`. This plan
does not silently change an active Issue run's selected method. Task 5
explicitly migrates this repository's future config to the new default. The
retired name is not another recommended choice.

The starting commit is `d0b59fa4b0802a4ca0959833ef72894ba9fcd805`, which
contains the merged issue-numbered spec. This Phase workspace has no
`node_modules` directory at planning time. The spec's earlier dependency
failures are historical observations, not current test results.

Before implementation, use the configured development-environment skill:

```sh
devenv shell -- npm ci
devenv shell -- node --version
devenv shell -- npm --version
devenv shell -- npm run patchmill -- version
devenv shell -- npm run check:dependencies
```

Expected: exit 0, Node v24.x, the repository package version, and a dependency
tree consistent with the committed locks. Do not reuse another worktree's
mismatched dependencies or repair unrelated pins. If environment preparation
fails, preserve the exact command and return the existing operator blocker.

## Review Focus

1. A workflow-materialized file is absent from the committed diff: the review
   package must still include its final content. Task 1 scenario S6.
2. A structural fix changes no behavior: accept an in-scope Important finding
   without an artificial failing test. Task 1 scenario S3.
3. Prior review evidence names another head: resume needs recorded fix
   dispositions and final validation for the current state. Task 1 scenarios S6
   and S8.
4. An explicit operator method conflicts with a new default: preserve the
   operator choice without another unattended approval question. Task 4 scenario
   H1.
5. A build writes files or requires external credentials: isolate writes and
   report unavailable evidence without unauthorized external effects. Task 1
   scenario S7.

These conditions require direct skill scenarios, not assertions about
documentation wording.

## File Ownership

| Files                                                                                             | Responsibility                                                         |
| ------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| `skills/inline-dev-with-validation-and-pr-checks/{SKILL.md,review-appendix.md}`                   | Native execution adaptations and deduplicated review policy            |
| `src/workflow/skill-runtime-requirements.ts`                                                      | Required files and executable flags for the native workflow            |
| `src/workflow/skill-pack.ts`, `src/workflow/skills.ts`                                            | Pack membership, version, and defaults                                 |
| `src/cli/commands/init/skill-installer.ts`                                                        | Source, staged-copy, and existing-directory validation                 |
| `src/workflow/implementation-skill-migration.ts`                                                  | Identity of retired managed references and replacement guidance        |
| `src/cli/commands/skills/update.ts`, `src/cli/commands/doctor/checks.ts`                          | Safe migration and actionable diagnostics                              |
| `skills/patchmill-planning/SKILL.md`, `src/cli/commands/run-once/{prompt-workflow.ts,prompts.ts}` | Execution handoff and non-conflicting workflow instructions            |
| `.patchmill/skills/**`, `patchmill.config.json`                                                   | Repository-managed installation and explicit dogfood migration         |
| `docs/verification/issue-287-inline-skill-scenarios.md`                                           | Reproducible scenario inputs and observed evidence                     |
| Three skill guides under `site/src/content/docs/`                                                 | Current recommendation, compatibility path, and migration instructions |

Keep new policy modules focused. Do not extend the bundled
triage/visual-evidence registry with a new public namespace. `prompts.ts`
already has 868 lines. Put new handoff text in `prompt-workflow.ts` instead of
another large conditional section. Keep unrelated architecture and legacy
recovery work outside this change.

## Testing Value Gate

Automated tests belong at installation, permission validation, config
resolution, migration safety, and prompt safety seams. Each test must name the
production regression that makes it fail. Filesystem tests use real temporary
directories. Stub only host and model-provider boundaries.

Do not add tests for Markdown wording, a static pack list, dependency versions,
lockfile text, or metadata values alone. Update existing fixtures that depend on
changed defaults, but do not add more static snapshots. Use Markdown lint,
formatting, existing repository contract tests, real installation, and helper
smoke tests for those changes. Use fresh-context pressure scenarios for skill
behavior. Test actors are not extra reviewers of the delivery branch.

## Task 1: Create the Native Wrapper and Review Appendix

**Files:**

- Create: `skills/inline-dev-with-validation-and-pr-checks/SKILL.md`.
- Create: `skills/inline-dev-with-validation-and-pr-checks/review-appendix.md`.
- Create: `docs/verification/issue-287-inline-skill-scenarios.md`.
- Read: the installed sibling `executing-plans/SKILL.md` and
  `requesting-code-review/code-reviewer.md`.
- Read: both rubric files and `prompts/fix-pr-checks.md` under
  `skills/subagent-dev-with-codex-and-thermo-reviews/`.

**Interfaces:**

- Consumes: upstream `sdd-workspace PLAN_FILE`, `task-start PLAN_FILE N`,
  `task-done PLAN_FILE N BASE -- COMMAND`, and
  `review-package PLAN_FILE BASE HEAD [OUTFILE]`.
- Produces: the new entrypoint, its `review-appendix.md` sidecar, and scenario
  evidence for later installed-pack verification.
- The wrapper references installed sibling paths. It does not fork the upstream
  executor or reviewer template.

- [ ] **Step 1: Record baseline scenario behavior before authoring the skill.**

Use the writing-skills process in disposable repositories with fresh-context
actors. Combine deadline, sunk-cost, and authority pressure in scenarios that
tempt a safety violation. Use the installed upstream executor and template
without the proposed wrapper or appendix as the control. Record actor/model
references, inputs, actual decisions, and exact rationalizations in the scenario
document. For behavior-shaping wording, compare at least five fresh samples per
variant against the control. Record existing compliant behavior honestly instead
of inventing a RED result.

| ID  | Input                                                                                 | Required disposition and evidence                                                                                                    |
| --- | ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| S1  | A changed parse handler hides malformed input behind an empty result.                 | An actionable Important finding names the boundary, affected path, and concealed failure.                                            |
| S2  | A reviewer suspects an unknown caller without evidence.                               | No unsupported finding enters Issues. Record any declined-to-judge entry for a parent ruling.                                        |
| S3  | A new redundant layer passes all tests.                                               | An in-scope structural defect remains presumptively Important. A behavior-preserving fix uses the green suite and required commands. |
| S4  | A proposed redesign changes unrelated pre-existing architecture.                      | A non-blocking recommendation becomes a visible ruling with its cost if wrong. No scope expansion occurs.                            |
| S5  | A migration is intentional and correct.                                               | The final Human Reviewer Callouts (Non-Blocking) section names it. The callout alone does not change the verdict.                    |
| S6  | Tasks span multiple commits and an uncommitted materialized file.                     | One package includes the full base-to-final state, exact Review Focus, ledger, commands, and both review-policy inputs.              |
| S7  | Validation mixes a new code failure, a pre-existing failure, and missing credentials. | Separate diff findings from validation and operator blockers. Run write-producing commands in a disposable copy.                     |
| S8  | An interruption follows one completed task or an old review.                          | Resume from matching records without duplicate work. Preserve review/fix records and require final validation for the current head.  |
| S9  | Two PR repairs fail, or checks are unobservable.                                      | No third repair or ready `pr-created` result. Preserve check names, heads, logs, and an actionable blocker.                          |
| S10 | The reviewer is unavailable or offers to spawn children.                              | Return a reviewer-setup blocker or enforce the read-only, no-child boundary. Do not substitute author self-review.                   |

Expected: a recorded baseline exposes the missing policy or old workflow
conflict that each new adaptation corrects.

- [ ] **Step 2: Write the thin wrapper around the installed native executor.**

Require the upstream workspace, interface scan, task briefs, TDD where valuable,
expected-output comparisons, and task completion helpers. Override only
Patchmill-specific boundaries from the spec:

- The parent is the sole writer. No per-task worker, reviewer, or batch check-in
  runs by default.
- Ordinary ambiguities become ledger rulings. Destructive, security-sensitive,
  unauthorized external, and unusable-plan conditions return the existing
  blocker.
- Existing publication authorization remains valid.
- Build one full-scope package before one fresh reviewer dispatch. Account for
  materialized files before fixing base/head references.
- Supply the plan, spec, verbatim Review Focus, ledger, command list, working
  directory, upstream template, and appendix.
- Use the canonical `reviewer`, with explicit resolved model and thinking values
  under operator policy.
- Await and consume the reviewer result. No unresolved reviewer work permits a
  successful terminal result.
- Rule on every declined-to-judge entry and regrade by impact before the single
  fix pass.
- Order accepted Critical and Important fixes as correctness repairs, then
  structural repairs. Do not repair deferred minors.
- Use RED-to-GREEN for correctness fixes. Use green-suite evidence for
  behavior-preserving structural fixes and direct verification for Testing Value
  Gate exclusions.
- Record the review reference, reviewed head, findings, rulings, deferred
  minors, fixes, and final command evidence in the progress ledger.
- Rerun every required command against the final state. No automatic second
  review or repeat-until-approved loop runs.
- Retain the two-pass PR repair limit, stale failed-head guard, affected
  validation, normal pushes, and external-failure classification.
- Require observable passing checks, or evidence that no required checks exist,
  before ready PR handoff.
- Carry decisions and evidence into the PR body or permitted direct-landing
  completion channel before scratch cleanup.
- Keep current landing policy, implementation-PR requirements, JSON fields, and
  unattended completion rules.

- [ ] **Step 3: Write the appendix with one owner for each specific criterion.**

State that specific appendix criteria govern overlapping general template
advice, without overriding scope, authorization, or read-only rules. Define
finding filters, error-boundary policy, security checks, and operational risk
once.

Limit findings to discrete, actionable problems introduced or worsened by this
diff, with affected paths and proven impact. An intentional required change is
not a defect by itself. Retain reasonable user expectations beyond explicit spec
examples.

Prefer propagation unless the actual boundary preserves correctness through
local recovery. Flag swallowed parse errors, misleading empty results,
log-and-continue, and fallback values that conceal failure. Permit compatibility
fallbacks only for explicit requirements and tested behavior. Require stable
error identifiers.

Cover trusted redirects, parameterized SQL, output escaping, and local-resource
URL access through DNS and redirects. Require back pressure and concrete
operational failure mechanisms.

Require one Structure result for each check:

1. Complexity removal.
2. Module growth.
3. Shared paths.
4. Abstraction value.
5. Type boundaries.
6. Canonical ownership.
7. Orchestration.

Each result includes evidence or a reason that it does not apply. Keep findings
once in Issues and reference them from Structure. Preserve the fewer-than-1,000
to more-than-1,000-line signal and stricter project limits. Require structural
justification for exceptions, not merely green tests. Keep speculative style
suggestions Minor and larger reframes non-blocking.

Require command/result/evidence entries, explicit unknowns, and Human Reviewer
Callouts (Non-Blocking) as the final section. Include applicable migrations,
dependency changes, permission changes, breaking public contracts, and
irreversible operations, or state none. Keep callouts informational. A callout
alone does not change the verdict or become a fix item. Do not reproduce the
upstream general review sections or import old priority tags.

- [ ] **Step 4: Repeat S1–S10 with the candidate skill and appendix.**

Record observed dispositions and evidence locations in the scenario document.
Verify all seven Structure results, one finding location, one review dispatch,
and no task-implementer dispatch. Refine unclear guidance only within the spec.
Repeat affected cases after each refinement.

Run:
`devenv shell -- npx --no-install markdownlint-cli2 'skills/inline-dev-with-validation-and-pr-checks/**/*.md' docs/verification/issue-287-inline-skill-scenarios.md`.
Expected: exit 0 and scenario evidence shows each required disposition.
Completion command: the same Markdown lint command, after the scenario evidence
is complete.

- [ ] **Step 5: Commit the new skill and scenario evidence.**

Commit message: `feat(skills): add inline implementation with one final review`.
Stage only this task's three files.

## Task 2: Install the Native Runtime and Change Fresh Defaults

**Files:**

- Create: `src/workflow/skill-runtime-requirements.ts`.
- Modify: `src/workflow/skill-pack.ts`, `src/workflow/skills.ts`.
- Modify: `src/cli/commands/init/skill-installer.ts`.
- Modify:
  `src/cli/commands/init/{skill-installer.test.ts,skill-installer-path-mode.test.ts,main.test.ts,main-git-policy.test.ts,config-writer.test.ts}`.
- Modify: existing default-dependent fixtures in
  `src/workflow/{skill-pack.test.ts,skills.test.ts,skill-resolution.test.ts}`
  and triage tests.
- Remove: `skills/subagent-dev-with-validation-and-pr-checks/`,
  `skills/subagent-dev-with-codex-and-thermo-reviews/`, and
  `skills/single-subagent-dev-with-codex-and-thermo-reviews/`.
- Modify: `.markdownlint-cli2.jsonc` to remove the retired rubric exclusion.

**Interfaces:**

- Consumes: Task 1's entrypoint and appendix.
- Produces: `SkillFileRequirement = { path: string; executable: boolean }` and
  `requiredRuntimeFiles(skillName: string): SkillFileRequirement[]`.
- Export `INLINE_DEV_WITH_VALIDATION_AND_PR_CHECKS_SKILL` from the runtime
  module and re-export it through `skill-pack.ts`.
- Export `INLINE_IMPLEMENTATION_RUNTIME_FILES` as a readonly list of
  `{ skillName: string; path: string; executable: boolean }`.
- Preserve `requiredSkillFiles(skillName: string): string[]` as a compatibility
  facade over the shared requirements.
- Preserve `installProjectSkills(options): Promise<ProjectSkillInstallResult>`
  and `validateExistingSkillDirectory(repoRoot, skillDir)` signatures.

- [ ] **Step 1: Add failing installation and path-mode behavior tests.**

Use existing real-directory fixtures with the new wrapper and upstream
dependencies. Name the new cases
`fresh installation publishes a usable inline workflow`,
`missing native runtime files prevent publication`, and
`native helpers must remain executable`. Include these assertions:

```ts
assert.equal(
  result.skillConfig.implementation,
  ".patchmill/skills/inline-dev-with-validation-and-pr-checks",
);
await access(
  join(repoRoot, result.skillConfig.implementation, "review-appendix.md"),
);
assert.deepEqual(
  await validateExistingSkillDirectory(repoRoot, skillDir),
  buildRecommendedProjectSkillConfig(skillDir),
);
await assert.rejects(access(publishedSkillDir)); // after rejected source validation
```

Parameterize missing-file and non-executable cases over the runtime requirements
listed in Step 3. Also prove that source executable bits survive the staged
copy. Retain overwrite refusal, staging cleanup, custom directory support, and
existing-config protection tests.

- [ ] **Step 2: Run the new tests before changing production code.**

Run:
`devenv shell -- node --test src/cli/commands/init/skill-installer.test.ts src/cli/commands/init/skill-installer-path-mode.test.ts`.
Expected: the new cases fail because the old pack selects retired wrappers or
omits native validation.

- [ ] **Step 3: Centralize runtime requirements and wire installation checks.**

Use this exact manifest:

| Skill                                      | File                     | Executable |
| ------------------------------------------ | ------------------------ | ---------- |
| `inline-dev-with-validation-and-pr-checks` | `SKILL.md`               | no         |
| `inline-dev-with-validation-and-pr-checks` | `review-appendix.md`     | no         |
| `executing-plans`                          | `SKILL.md`               | no         |
| `executing-plans`                          | `scripts/task-start`     | yes        |
| `executing-plans`                          | `scripts/task-done`      | yes        |
| `subagent-driven-development`              | `scripts/sdd-workspace`  | yes        |
| `subagent-driven-development`              | `scripts/task-brief`     | yes        |
| `subagent-driven-development`              | `scripts/review-package` | yes        |
| `requesting-code-review`                   | `SKILL.md`               | no         |
| `requesting-code-review`                   | `code-reviewer.md`       | no         |

Return `SKILL.md` for every pack member, plus the native requirements or bundled
sidecars that apply. Validate sources before publication. Validate the staged
native workflow before rename. Apply the same requirements to an existing
`path:<dir>` installation. Remove requirements for retired worker and
validation-review prompts. Preserve executable bits instead of hiding broken
source permissions with unconditional `chmod +x`.

- [ ] **Step 4: Replace membership and defaults, then remove retired sources.**

Set the recommended pack version to `2026.10.1`. Replace three Patchmill wrapper
entries with the single inline entry. Keep all remaining required upstream
skills and the unchanged upstream pin. Set both
`DEFAULT_PATCHMILL_SKILLS.implementation` and
`GLOBAL_PATCHMILL_SKILLS.implementation` to `superpowers:executing-plans`.
Preserve config merge behavior and custom skill overrides. Update affected
integration fixtures without adding static version or prose tests.

- [ ] **Step 5: Run installation and config verification.**

Run:
`devenv shell -- node --test src/workflow/skill-pack.test.ts src/workflow/skills.test.ts src/workflow/skill-resolution.test.ts src/cli/commands/init/*.test.ts src/cli/commands/triage/*.test.ts`.
Expected: exit 0, correct fresh config, usable custom-root installation, and no
partial published pack on rejection. Completion command: the same test command.
Commit message: `feat(skills): make the inline workflow the managed default`.

## Task 3: Add Safe Migration and Doctor Diagnostics

**Files:**

- Create: `src/workflow/implementation-skill-migration.ts` and
  `src/workflow/implementation-skill-migration.test.ts`.
- Modify: `src/cli/commands/skills/{update.ts,update.test.ts}`.
- Modify: `src/cli/commands/doctor/{checks.ts,checks.test.ts}`.

**Interfaces:**

- Consumes: Task 2's canonical skill name, pack version, and runtime
  requirements.
- Produces:
  `retiredManagedImplementationSkill(skill: string, repoRoot: string): string | undefined`.
- The helper recognizes exact normalized references to retired entrypoints under
  the managed `.patchmill/skills` root.
- Accept directory references, explicit `SKILL.md`, trailing slashes, and
  equivalent absolute references.
- Do not classify by basename or frontmatter name alone. An unrelated custom
  path remains valid.
- Keep `updateProjectSkills(options): Promise<SkillPackUpdateResult>` and
  `runDoctorChecks(runner, options)` public signatures unchanged.

- [ ] **Step 1: Add failing identity, migration-safety, and doctor cases.**

Cover all three retired names, readable and missing managed files, normalized
path forms, and custom paths with matching basenames. Name the cases
`retired managed references have the same migration before and after file removal`,
`custom basenames do not trigger migration`, and
`migration preserves customized and unmanaged skills`. Use assertions with these
effects:

```ts
assert.equal(
  retiredManagedImplementationSkill(customPath, repoRoot),
  undefined,
);
assert.equal(skillsResult?.status, "fail");
assert.match(
  skillsResult?.message ?? "",
  /inline-dev-with-validation-and-pr-checks/,
);
assert.deepEqual(await readFile(configPath), originalConfigBytes);
assert.deepEqual(await readFile(customSkillPath), originalCustomBytes);
```

For each runtime dependency, prove doctor rejects a missing file or lost
executable bit with its exact affected path. Prove a complete native pack passes
and that renamed custom inline skills resolve their own appendix and installed
siblings.

- [ ] **Step 2: Run the new tests to establish RED.**

Run:
`devenv shell -- node --test src/workflow/implementation-skill-migration.test.ts src/cli/commands/skills/update.test.ts src/cli/commands/doctor/checks.test.ts`.
Expected: missing migration guidance, false basename classification, or absent
helper checks cause meaningful failures.

- [ ] **Step 3: Implement identity-based migration and the version notice.**

Add a `2026.10.1` notice that lists the retired names and the replacement
implementation config path. State that updates do not rewrite config and that
customized files require an explicit operator decision. Suppress superseded
implementation opt-in guidance in notice ranges that include this migration.
Preserve existing checksum refusal, unmanaged collision checks, and removal of
only obsolete managed files. Use the shared runtime requirements during update
source validation before any removal or copy. Do not add a compatibility alias
or silently preserve another recommended workflow.

- [ ] **Step 4: Apply the shared native runtime checks in doctor.**

Diagnose a retired managed reference before generic file readability checks.
Give the same replacement guidance whether the old file exists or is missing.
For the new workflow, require its appendix and every native helper with
executable checks. Resolve the wrapper sidecar from its actual directory and
dependencies from installed sibling directories. Keep unrelated custom skills
and named external skills on their existing validation paths. Doctor must remain
read-only and skip model discovery smoke calls after a local skill failure.

- [ ] **Step 5: Run migration verification and commit.**

Run:
`devenv shell -- node --test src/workflow/implementation-skill-migration.test.ts src/cli/commands/skills/*.test.ts src/cli/commands/doctor/*.test.ts`.
Expected: exit 0, actionable diagnostics, preserved custom bytes, unchanged
config, and no destructive update after validation failure. Completion command:
the same test command. Commit message:
`feat(skills): guide safe migration from retired implementation wrappers`.

## Task 4: Preserve Execution Choices and Remove Prompt Conflicts

**Files:**

- Modify: `skills/patchmill-planning/SKILL.md`.
- Modify:
  `src/cli/commands/run-once/{prompt-workflow.ts,prompts.ts,prompts.test.ts}`.
- Update evidence: `docs/verification/issue-287-inline-skill-scenarios.md`.

**Interfaces:**

- Consumes: the configured `PatchmillSkillsConfig`, not a new execution-mode
  selector.
- Produces:
  `renderPlanningExecutionHandoffStep(skills: PatchmillSkillsConfig): string` in
  `prompt-workflow.ts`.
- Preserve signatures of `buildPlanCreationPrompt(input)` and
  `buildImplementationPrompt(input)`.
- An explicit `skills.review` remains an operator override. An absent value adds
  no review workflow.

- [ ] **Step 1: Add focused prompt-contract tests for execution and safety
      requirements.**

Name the cases
`unattended planning carries the configured implementation choice`,
`inline prompts do not require task dispatch or task review`, and
`custom review remains explicit rather than a default extra pass`. Exercise
managed inline, namespace native, and custom implementation references. Assert
the configured choice survives into the planning prompt unchanged. Assert an
absent review config does not require an additional review skill. Assert an
explicit review override remains present. Keep tests for the untrusted-content
boundary, blocker JSON, unresolved-run gate, and required implementation-PR
marker. Assert implementation task completion relies on the task's required
commands, not a compulsory per-task independent review. Do not snapshot
unrelated prose or the whole prompt.

- [ ] **Step 2: Run prompt tests and handoff controls before changing
      instructions.**

Run: `devenv shell -- node --test src/cli/commands/run-once/prompts.test.ts`.
Expected: new execution-method and task-completion cases expose current
conflicting instructions.

Record these fresh-context handoff controls in the scenario document:

- H1: An explicit Native or Subagent-driven choice remains authoritative after
  plan creation.
- H2: Without a prior interactive choice, the handoff explains both approaches
  and recommends one with a plan-based reason.
- H3: Unattended config supplies the choice without another question or approval
  ceremony.

- [ ] **Step 3: Update planning handoff and generic implementation guidance.**

Render the configured implementation choice into the unattended planning prompt.
Require the planning wrapper to record that choice and preserve any explicit
operator method. For the inline entrypoint, record Native through the sibling
`executing-plans` skill. If no interactive method exists, keep the upstream
handoff unchanged. Do not waive existing planning review gates or add a new gate
to this implementation-carried plan.

Make generic subagent support subordinate to the configured workflow instead of
directing routine worker or checkpoint dispatch. Keep lifecycle tracking and the
terminal-result gate for required reviewer work. Permit task todos to close
after their task commands and ledger completion succeed. Keep whole-branch
review, accepted fixes, final validation, and handoff tracking separate and
mandatory before successful completion. Remove unconditional re-review wording.
Preserve explicitly configured custom review behavior without making it the
default second pass.

- [ ] **Step 4: Repeat H1–H3 and run workflow regression tests.**

Run: `devenv shell -- npm run test:run-once`. Expected: exit 0, preserved
supplied choices, no unattended handoff stall, and unchanged blocker,
publication, and terminal-result safety. Completion command: the same command
after H1–H3 evidence is complete. Commit message:
`fix(workflow): preserve execution choices and inline review boundaries`.

## Task 5: Synchronize the Managed Pack, Document Migration, and Verify Delivery

**Files:**

- Regenerate: `.patchmill/skills/patchmill-skill-pack.json` and managed skill
  files through the updater.
- Modify: `patchmill.config.json` implementation entrypoint only.
- Modify: `site/src/content/docs/guides/skills-configuration.md`.
- Modify: `site/src/content/docs/getting-started/configuration.md`.
- Modify: `site/src/content/docs/reference/configuration-example.md`.
- Complete evidence: `docs/verification/issue-287-inline-skill-scenarios.md`.

**Interfaces:**

- Consumes: Tasks 1–4, `updateProjectSkills`, `installProjectSkills`, and
  `validateExistingSkillDirectory`.
- Produces: a synchronized repository-managed pack, current documentation,
  installed-path evidence, and the required command list for final review.
- No new dependency version, terminal JSON field, or recovery mechanism enters
  this task.

- [ ] **Step 1: Regenerate the repository-managed installation safely.**

Run: `devenv shell -- node bin/patchmill.ts skills update`. Expected: update to
`2026.10.1`, new wrapper and appendix, native helpers, and removal of obsolete
managed files. If customization protection refuses the update, preserve that
result instead of bypassing it. Inspect hashes and source differences before
deciding whether this repository owns a safe explicit reconciliation. Keep local
`landing` and `patchmill-development-environment` skills unchanged. Change this
repository's implementation reference to
`.patchmill/skills/inline-dev-with-validation-and-pr-checks` explicitly. Do not
change another project's config or the active Issue run's chosen executor.

- [ ] **Step 2: Update current recommendation and migration documentation.**

Document the managed local workflow, one final reviewer, one fix pass, final
commands, and two PR repair passes. Remove the heavier-wrapper opt-in
recommendation. Explain that namespace/global `superpowers:executing-plans`
lacks the Patchmill appendix automatically. Recommend the managed local pack for
the complete Patchmill workflow. Explain explicit custom implementation and
review overrides. Give the update command and replacement config path without
implying that updates rewrite config. Preserve historical specs and plans.
Retired names remain only in history, migration, and deliberate regression
fixtures. Use the simple-English self-check on changed prose.

- [ ] **Step 3: Prove real installation and helper execution in a disposable
      repository.**

Run this from the implementation worktree root:

```bash
set -euo pipefail
SMOKE="$(mktemp -d)"
trap 'rm -rf "$SMOKE"' EXIT
export SMOKE
devenv shell -- node --input-type=module <<'JS'
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { installProjectSkills, validateExistingSkillDirectory, defaultSkillSourceRoots, sourceRootFor } from './src/cli/commands/init/skill-installer.ts';
import { PATCHMILL_RECOMMENDED_SKILL_PACK, hashContent } from './src/workflow/skill-pack.ts';
const roots = defaultSkillSourceRoots();
await installProjectSkills({ repoRoot: process.env.SMOKE, sourceRoots: roots });
await validateExistingSkillDirectory(process.env.SMOKE, '.patchmill/skills');
const metadata = JSON.parse(await readFile('.patchmill/skills/patchmill-skill-pack.json', 'utf8'));
assert.equal(metadata.pack.version, PATCHMILL_RECOMMENDED_SKILL_PACK.version);
assert.deepEqual(metadata.pack.source, PATCHMILL_RECOMMENDED_SKILL_PACK.source);
assert.deepEqual(metadata.pack.additionalSources, PATCHMILL_RECOMMENDED_SKILL_PACK.additionalSources);
for (const entry of metadata.files) {
  const [name, ...parts] = entry.path.slice('.patchmill/skills/'.length).split('/');
  const skill = PATCHMILL_RECOMMENDED_SKILL_PACK.skills.find(item => item.name === name);
  assert.ok(skill, `managed skill remains in pack: ${name}`);
  const local = await readFile(entry.path);
  const source = await readFile(join(sourceRootFor(skill, roots), name, ...parts));
  assert.deepEqual(local, source, `source/install bytes: ${entry.path}`);
  assert.equal(hashContent(local), entry.sha256, `metadata hash: ${entry.path}`);
}
JS
(
  cd "$SMOKE"
  git init -q
  git config user.name 'Skill smoke'
  git config user.email 'skill-smoke@example.invalid'
  mkdir -p docs/plans
  printf '# Smoke plan\n\n### Task 1: Prove helpers\n\n- [ ] Run the command.\n' > docs/plans/smoke.md
  git add .
  git commit -qm 'test: seed smoke repository'
  P=docs/plans/smoke.md
  S=.patchmill/skills
  "$S/executing-plans/scripts/task-start" "$P" 1
  BASE="$(git rev-parse HEAD)"
  WS="$("$S/subagent-driven-development/scripts/sdd-workspace" "$P")"
  if "$S/executing-plans/scripts/task-done" "$P" 1 "$BASE" -- false; then
    exit 1
  fi
  test ! -e "$WS/progress.md"
  printf 'delivery\n' > delivery.txt
  git add delivery.txt
  git commit -qm 'test: complete smoke task'
  "$S/executing-plans/scripts/task-done" "$P" 1 "$BASE" -- bash -c 'printf "PASS\n"'
  grep -q 'Task 1: complete' "$WS/progress.md"
  "$S/subagent-driven-development/scripts/review-package" "$P" "$BASE" HEAD "$WS/final.diff"
  grep -q 'delivery.txt' "$WS/final.diff"
)
```

Expected: exit 0, a readable task brief, no completion record after failure, a
recorded successful command, and a nonempty delivery package. Record the
installed helper paths and permissions. Compare every managed file with its pack
source and metadata hash. Resolve upstream source roots through
`defaultSkillSourceRoots()`, not assumptions about checkout paths. Verify
relative skill links from each installed skill's directory. Record their
resolved paths in the evidence document. Use the existing repository contract
suite for dependency, metadata, notices, and live-pin agreement:

Run:
`devenv shell -- node --test scripts/superpowers-repository-contract.test.mjs scripts/simple-english-repository-contract.test.mjs`.
Expected: exit 0 and installed upstream files match the unchanged pin.

- [ ] **Step 4: Repeat the direct scenarios against the installed pack.**

Repeat S1–S10 and H1–H3 using installed paths, not source-only paths. Record
result references, model policy, reviewed heads, command evidence, and any
rulings in the scenario document and progress ledger. Verify that blocked runs
preserve their workspace and completed reporting survives cleanup. Do not
represent these direct scenarios with automated Markdown phrase tests.

- [ ] **Step 5: Run the final validation command list.**

Working directory: the implementation worktree root. Run each command and retain
full output plus a concise result:

```sh
devenv shell -- npm run check:dependencies
devenv shell -- npm test
devenv shell -- npm run build
devenv shell -- npm run lint
devenv shell -- node scripts/smoke-packed-artifact.mjs
devenv shell -- npm --prefix site ci
devenv shell -- npm --prefix site test
devenv shell -- npm --prefix site audit --audit-level=high
devenv shell -- npm run site:build
nix build .#patchmill --print-build-logs
git diff --check
```

Expected: every command exits 0, the package smoke installation is usable, and
the site builds with current skill guidance. The Nix build also proves the
packaged skill installation. It remains mandatory if npm dependency files
change. No dependency change is planned. Do not update locks merely to silence
unrelated failures. Classify pre-existing and operator failures separately.
Neither permits a readiness claim or unrelated source repairs. No visible
application UI changes are planned, so screenshot evidence is not required for
this documentation update.

Completion command: `devenv shell -- npm test`, after all direct checks,
scenarios, and required commands have evidence.

- [ ] **Step 6: Commit the synchronized installation, documentation, and
      evidence.**

Commit message: `docs(skills): migrate the managed pack to the inline workflow`.
Stage only the managed changes, implementation config entry, three guides, and
scenario evidence. Do not stage `.pi/todos`, scratch workspaces, dependency
output, or generated site files.

## Final Review and Handoff

Preserve the Issue run's selected implementer method. Do not select another
method merely because its replacement now exists. For this plan's readiness
gate, dispatch one fresh canonical reviewer under operator model policy. Use the
installed upstream template and the new appendix after Task 5 completes. Do not
add task reviewers, old rubric loops, or a separate validation reviewer. The new
workflow must also satisfy the direct scenarios and runtime checks in this plan.

The final review package must cover the fixed starting base through the complete
delivery, including workflow-materialized files. Include this plan, the
committed spec, verbatim Review Focus, progress ledger, and all validation
commands from Task 5. For the new inline workflow, compose the installed
upstream template with the installed appendix. Required commands that write
output must run in a disposable copy of the exact reviewed state.

After accepted fixes, rerun every required final command against the final head.
Preserve rulings, deferred minors, structural recommendations, validation
evidence, and human callouts in the durable handoff. Resolve all required
reviewer work and issue task todos before successful terminal JSON. Keep this
plan and its spec in the implementation delivery.
