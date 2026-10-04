# One Implementation Skill with a Single Review Appendix

## Status and intent

This spec records the design approved in Pi session
`01a1057a-49c6-706c-828f-5a9b59debbe6`. The written spec awaits user review.
Implementation requires a separate approved plan.

Patchmill users need a reliable implementation workflow, not a choice between
several overlapping skills. Patchmill must make one recommended choice.

The recommendation is native execution through Superpowers `executing-plans`.
One fresh-context reviewer uses the upstream review template plus a
Patchmill-owned appendix. The appendix preserves the distinct strengths of the
Codex and thermo-nuclear rubrics without separate review passes.

Native execution is Patchmill's default choice. This spec does not claim that
Superpowers makes native execution its universal default.

## Goals

- Provide one recommended Patchmill implementation skill.
- Reuse upstream execution, task records, review, and fix-pass rules.
- Preserve useful correctness, security, operational, and structural checks.
- Remove duplicate review instructions and unbounded review loops.
- Keep validation, PR readiness, and unattended completion requirements.
- Preserve human control over scope, unsafe actions, and landing policy.

## Non-goals

- A second implementation skill or an execution-mode selector.
- Changes to Superpowers source files or a new upstream dependency version.
- Per-task implementer or reviewer subagents.
- A second review for gaps, structure, or validation.
- A new oracle, checkpoint service, or subagent recovery framework.
- Changes to the personal roche-pi review profiles.
- Changes to planning review gates, Run recovery state, or terminal JSON
  schemas.
- Dependency repairs or product implementation in this spec-writing task.

## Current behavior

The recommended project-local skill is
`subagent-dev-with-validation-and-pr-checks`. Two optional Patchmill wrappers
add Codex and thermo-nuclear reviews. One wrapper dispatches one worker for the
whole plan instead of one worker per task.

These wrappers overlap with upstream execution and review instructions. The
Codex and thermo-nuclear wrappers also repeat review and repair until each
review passes. A separate validation-readiness reviewer adds another pass.

The recommended pack already includes Superpowers v6.4.2 and `executing-plans`.
That skill provides native execution, task helpers, a progress ledger, one final
review, and one fix pass. The namespace defaults still select
`superpowers:subagent-driven-development`.

## Skill ownership and defaults

The new entrypoint is `skills/patchmill-implementation/SKILL.md`. Its installed
project-local path is `.patchmill/skills/patchmill-implementation`.

The skill is a thin wrapper around sibling upstream skills. It adds the
Patchmill rules in this spec instead of reproducing the upstream task loop.

Its supporting file, `review-appendix.md`, owns the deduplicated review policy.
The review prompt reads the installed upstream `code-reviewer.md` and appends
this file. Patchmill does not maintain a fork of the upstream template.

The recommended pack removes these Patchmill implementation skills:

- `subagent-dev-with-validation-and-pr-checks`
- `subagent-dev-with-codex-and-thermo-reviews`
- `single-subagent-dev-with-codex-and-thermo-reviews`

Their worker prompts, repeated review loops, and full rubric copies leave the
pack. Relevant PR-check repair rules move into the new wrapper without a worker
dispatch. Historical specs remain available as records.

The upstream `subagent-driven-development` directory remains installed because
native execution uses its helpers. Its presence is not another Patchmill
recommendation.

Fresh project-local configuration selects `patchmill-implementation`. Namespace
and user-global defaults select `superpowers:executing-plans` instead of the
subagent-driven executor. This is an external-skill compatibility path, not the
recommended workflow. It does not provide the Patchmill appendix automatically.
Documentation must state that distinction and recommend the managed local pack.

Explicit custom implementation skills remain supported. This change does not
silently replace user-owned skill choices.

## Native execution

The implementation session is the sole writer in the existing implementation
Phase workspace. It follows the sibling `executing-plans` skill, including:

1. Reading the approved plan and spec.
2. Creating or resuming the plan workspace and progress ledger.
3. Checking shared interfaces before the first task.
4. Reading each task brief through `task-start`.
5. Applying TDD where the Testing Value Gate requires behavioral tests.
6. Comparing command output with the plan's expected results.
7. Recording task completion through `task-done`.
8. Completing all tasks without routine human check-ins.

The Superpowers progress ledger is a task record. It is not Patchmill's Event
ledger and does not replace Run recovery state.

Patchmill's Testing Value Gate overrides blanket demands for new tests.
Documentation, static configuration, and other excluded changes use direct
verification. Their task completion command must still pass and enter the
progress ledger. No task receives a completion record from an unrun command.

The planning wrapper records native execution as the configured choice. It does
not ask an unattended session to choose between execution methods. Planning
review gates and spec or plan approval requirements remain unchanged.

Upstream's ordinary ambiguities become reasoned ledger rulings. A ruling does
not grant new product scope or authorize unsafe actions. Destructive actions,
security-sensitive actions, unauthorized external effects, and an unusable plan
produce the existing blocker JSON instead of a question awaiting another turn.

Existing authorization for branch publication and landing remains valid. The
wrapper does not reinterpret a permitted PR push as a new approval request.

## One final review

### Review inputs

After all tasks complete, the parent prepares one whole-branch review package.
It supplies:

- The fixed base and head references and the complete review-package path.
- The approved plan and spec paths.
- The plan's Review Focus section, without paraphrase.
- The progress ledger and its rulings.
- The required validation commands and their working directory.
- Workflow-materialized files that form part of the final implementation.
- The installed upstream review template and Patchmill review appendix.

The package covers the complete delivery, not only the last task or commit. The
parent accounts for uncommitted materialized files before dispatch. It cannot
omit them from a clean-looking base-to-head diff.

The parent dispatches the canonical Pi `reviewer` with fresh context. It uses
the most capable available review model under the operator's model policy. Where
a role resolver supplies model and thinking values, the dispatch passes both
explicitly. The reviewer cannot dispatch children or change the branch.

If a reviewer is unavailable, the run reports a blocker. Unattended Patchmill
does not substitute the author's self-review for the required independent
review.

### Prompt composition and precedence

The installed upstream template supplies the review structure and general
criteria. The appendix supplies more specific Patchmill criteria. Its opening
rule states that these criteria govern overlapping general examples or advice.

Project requirements and approved scope remain binding. The appendix does not
override authorization, tool restrictions, or the upstream read-only boundary.

The review keeps the upstream severity names: Critical, Important, and Minor. It
does not introduce Codex priority tags or competing verdict formats.

### Coverage ownership

| Review concern                                                           | Canonical owner                |
| ------------------------------------------------------------------------ | ------------------------------ |
| Plan alignment, spec as vision, Review Focus, declined-to-judge behavior | Upstream template and executor |
| General code quality, tests, architecture, production readiness          | Upstream template              |
| Read-only rules, no child dispatch, finding locations, main verdict      | Upstream template              |
| Evidence filters and precise error, security, and operational policy     | Patchmill appendix             |
| Specific structural checks and their severity policy                     | Patchmill appendix             |
| Required command results and human-review callouts                       | Patchmill appendix             |
| Rulings, accepted fixes, deferred minors, final validation               | Parent executor                |

Each concern has one detailed definition. The appendix refines broad upstream
criteria instead of copying their full sections. It does not repeat structural
checks as questions, flag lists, remedies, and approval rules.

## Review appendix requirements

### Finding filters

A finding must identify a discrete problem introduced or worsened by the
reviewed change. It must explain the affected behavior or structure and provide
an actionable correction.

Evidence must identify the affected path and the impact. Speculation about
unknown callers or author intent is insufficient. The required rigor must fit
the codebase and its documented standards.

An intentional behavior change is not a defect merely because it differs from
the base. Intent does not excuse a security fault or broken requirement.
Pre-existing problems remain outside the fix pass unless the change worsens
them.

The filters govern the entire review, not only appendix findings. They do not
weaken the upstream rule that reasonable user expectations matter beyond an
explicit example in the spec.

### Error handling

The reviewer evaluates each changed error handler at its actual boundary. If
that boundary cannot preserve correctness through local recovery, propagation is
the default.

The appendix flags swallowed parse errors, misleading empty results,
log-and-continue behavior, and fallback values that conceal failure.
Compatibility fallbacks require an explicit requirement and tested behavior.
Boundary handlers can translate errors, but cannot falsely report success. Error
matching uses stable codes or identifiers rather than message text.

The upstream example that praises fallbacks does not override this policy.

### Security and operations

Checks apply to changed paths that process untrusted input. They cover redirect
destinations, parameterized SQL, output escaping, and server-side URL access.
URL checks include local-resource access through DNS resolution and redirects.

The operational checks cover back pressure and concrete increases in failure
risk or operator intervention. The report names the failure mechanism instead of
making a general claim about reliability.

### Structure

The review report includes a required Structure section. It contains one result
for each check below, with evidence or a reason that the check does not apply. A
finding appears once in Issues, and the Structure section refers to it.

1. **Complexity removal:** A simpler model can remove new branches, modes, or
   layers.
2. **Module growth:** The change crosses a size limit or weakens an existing
   module's cohesion.
3. **Shared paths:** New special cases or feature logic spread through unrelated
   shared code.
4. **Abstraction value:** Wrappers or generic machinery add indirection without
   a clear benefit.
5. **Type boundaries:** Casts, optionality, or loosely shaped values hide an
   invariant.
6. **Canonical ownership:** New logic duplicates an existing helper or belongs
   in another established layer.
7. **Orchestration:** Unnecessary serialization or partial updates add avoidable
   complexity or correctness risk.

The default size signal is a file crossing from fewer than 1,000 lines to more
than 1,000 lines. Stricter documented project limits also apply. The report
records a clear structural justification for any accepted exception.

The appendix retains thermo-nuclear review's search for a simpler design.
However, the actionable scope is complexity introduced or worsened by this diff.
It does not demand a general redesign of pre-existing code.

A concrete structural defect with an in-scope remedy is presumptively Important.
Passing tests do not automatically reduce it to Minor. A justified exception
requires evidence about the design, not only a green test result.

Stylistic preferences and speculative simplifications remain Minor or
recommendations. A larger reframe beyond approved scope becomes a recommendation
and a parent ruling. It is not an instruction to expand the implementation.

A recommendation alone does not block the run. An independent correctness or
security defect still blocks readiness until the parent resolves it safely.

### Validation and human-review callouts

The report includes every required validation command, its result, and an
evidence location. Missing or unrun commands remain explicit unknowns.

The final report section is Human Reviewer Callouts (Non-Blocking). It includes
applicable migrations, dependency changes, auth or permission changes, breaking
public contracts, and irreversible operations. If none apply, it states none.

Callouts alone do not change the verdict or create fix items. A separate defect
in the same change still belongs in Issues.

## Validation without a third reviewer

Required commands come from the plan, repository instructions, and configured
toolchain skill. The parent collects one command list before the final review.
The reviewer runs the commands as part of that same review.

The review remains read-only on the implementation checkout. Commands that write
files run in a separate disposable copy of the reviewed state. That copy must
include materialized files and the same relevant configuration.

Validation cannot publish, deploy, change credentials, or modify shared
resources without existing authorization. If safe validation is impossible, the
report states the missing evidence and required operator action.

Repository-fixable failures caused by the change enter Issues as Important
findings. Pre-existing command failures remain explicit validation blockers, not
new diff findings or permission for unrelated repairs.

External credentials, service outages, or unavailable runners become operator
blockers, not speculative source changes. Mixed failures receive separate
classifications.

After the fix pass, the parent reruns every required command against the final
implementation state. A previous green result cannot establish readiness for a
changed head. The absence of review findings does not remove this final gate.

## One ordered fix pass

The parent first rules on every declined-to-judge entry and reviews severity
against the actual effect. It records the reasons for rejected or regraded
findings. It cannot demote a structural finding merely because behavior is
intact.

Accepted Critical and Important findings enter one bounded pass:

1. Correctness fixes use a reproducing test that fails before the fix and passes
   afterward.
2. Structural fixes preserve behavior and use a green suite plus the required
   validation commands.
3. Testing Value Gate exclusions use the relevant direct verification instead of
   artificial tests.

The structural rule is an explicit Patchmill adaptation of upstream's blanket
RED-to-GREEN requirement. New tests are still required for behavior changes or
uncovered risky behavior that passes the Testing Value Gate.

The progress ledger records each finding's disposition and evidence. Minor
findings enter the deferred-minor list, not the fix pass. Larger reframes enter
the rulings list with their cost if wrong.

There is no automatic second review and no repeat-until-approved loop. If the
accepted fixes or required validation remain incomplete, the run cannot report
readiness. It preserves the evidence and returns an actionable blocker.

The existing progress ledger also records the review result reference, reviewed
head, fix disposition, and final validation evidence. On resume, the parent uses
these records instead of repeating completed work. Evidence for a different head
cannot establish readiness for the current head.

## PR checks, landing, and completion

The parent retains the existing landing policy and required implementation PR
rules. A planning workflow that requires an implementation PR cannot directly
land through this skill. No interactive branch-finishing menu runs unattended.

For a PR handoff, the parent waits for observable required checks. Code-related
failures permit at most two PR-check repair passes, performed by the parent.
Each repair preserves approved scope and reruns affected validation before push.
These passes address new CI evidence, not deferred review preferences.

Unobservable checks, operator-only failures, or exhausted repairs produce the
existing blocker outcome. The run cannot report `pr-created` as ready before
observable required checks pass. If no required checks exist, evidence of that
state is sufficient.

The parent preserves rulings, deferred minors, structural recommendations,
validation evidence, and human-review callouts in the PR body. The final
response uses the existing JSON contract and its available summary fields. This
design does not add new terminal JSON fields or put prose after the JSON.

For permitted direct landing, the existing durable completion channel carries
the same information. All required todos and reviewer work must be resolved
before any successful terminal result.

The parent preserves the plan workspace while a run is blocked. It removes only
that plan's workspace after fixes, validation, and durable reporting complete.
Cleanup remains subject to Patchmill's existing Phase workspace ownership rules.

## Installation and migration

The recommended pack receives a new version and an explicit migration notice.
Fresh installations use the new project-local entrypoint.

`patchmill skills update` retains its existing protection for customized managed
files. It does not silently overwrite custom skills or rewrite configuration.
The notice lists the retired skill names and the replacement configuration path.

Existing configurations that reference a retired managed skill require an
explicit configuration change. Even if an old copy remains readable, doctor
reports the retired reference and the replacement. A missing retired path gets
the same actionable migration guidance instead of only a generic file error.

Custom paths remain valid. Migration diagnostics must identify managed
references, not reject an unrelated user-owned path merely because its basename
matches. No compatibility alias keeps another implementation workflow alive
indefinitely.

Installer and doctor checks cover the new entrypoint and appendix. They also
cover the upstream files that native execution uses:

- `executing-plans/SKILL.md`
- `executing-plans/scripts/task-start`
- `executing-plans/scripts/task-done`
- `subagent-driven-development/scripts/sdd-workspace`
- `subagent-driven-development/scripts/task-brief`
- `subagent-driven-development/scripts/review-package`
- `requesting-code-review/SKILL.md`
- `requesting-code-review/code-reviewer.md`

All directly invoked scripts require executable permissions. Their sibling paths
must resolve from the installed pack, not only from the source checkout.
Remaining required upstream skills stay installed through the existing pack.

This feature does not require an upstream version bump. Installed files, pack
metadata, dependency references, and integration fixtures must agree on the pin.
The repository's managed `.patchmill/skills` copy must match the pack sources.

## Expected change areas

- `skills/patchmill-implementation/`: the wrapper and review appendix.
- `skills/patchmill-planning/SKILL.md`: the unattended execution handoff.
- The three retired wrapper directories and their support files.
- `src/workflow/skill-pack.ts` and `src/workflow/skills.ts`: pack membership and
  defaults.
- `src/cli/commands/init/skill-installer.ts`: installed dependency checks.
- `src/cli/commands/skills/update.ts`: migration notices and managed-file
  handling.
- `src/cli/commands/doctor/checks.ts`: actionable migration and dependency
  diagnostics.
- Run-once prompt assembly: remove conflicting default review or handoff
  instructions.
- Skills documentation, integration tests, and generated pack metadata.

An explicit custom `skills.review` remains an operator override. Documentation
must distinguish it from the default one-review workflow. The default must not
silently dispatch an additional review through that configuration key.

## Acceptance and verification

The implementation is acceptable when all of these outcomes hold:

1. A fresh managed installation selects one Patchmill implementation entrypoint.
2. The parent runs plan tasks natively and resumes completed tasks from upstream
   records.
3. One fresh reviewer receives the full scope, upstream template, appendix, and
   required commands.
4. No default per-task review, Codex loop, thermo loop, or validation reviewer
   remains.
5. The review preserves upstream plan checks and emits the complete Structure
   section.
6. Each retained rubric concern has one policy owner and one finding location.
7. Structural defects can enter the fix pass without an artificial failing
   behavior test.
8. Larger reframes become visible recommendations without unauthorized changes.
9. The parent completes one review fix pass and all required final validation.
10. PR readiness retains the two-repair limit and operator-blocker behavior.
11. Rulings and callouts survive workspace cleanup through durable reporting.
12. Retired managed references receive actionable migration guidance without
    damage to custom skills.
13. Required helpers run from installed paths, and all upstream version
    references agree.

Automated tests cover behavior at reusable seams: installation, missing helper
handling, executable permissions, configuration resolution, and migration
safety. Prompt-contract tests belong only where they prove meaningful execution
or safety requirements. Tests must not merely assert prose or a static version
string.

Skill verification includes scenarios for a hidden parse failure, an unsupported
finding, a structural defect, an out-of-scope reframe, and a non-blocking
migration callout. It also covers a validation failure, interrupted progress,
and exhausted PR repairs. Each scenario must expose the expected disposition and
evidence.

Direct verification covers Markdown formatting, links, installed file paths,
script permissions, and a temporary-repository helper smoke test. Existing tests
remain part of implementation verification.

If npm dependency files change during implementation, the Nix build is required.
Dependency changes are not required merely to write or approve this spec.

### Baseline recorded before this spec

The earlier session created `.worktrees/single-seat-review-appendix` on branch
`docs/single-seat-review-appendix`, from `cddfd6e`. It linked the primary
checkout's `node_modules` into that worktree.

Its baseline commands failed before any feature changes. The recorded failures
include installed `pi-subagents` 0.68.0 against the package pin 0.74.0,
extraneous dependencies, and skill integration failures.

These are baseline findings, not evidence that this design fails. The
implementation phase must establish a synchronized environment before behavioral
verification. This docs-only change uses documentation checks instead of another
known-broken full-suite run.

## Alternatives and residual risks

A new native wrapper beside the existing choices preserves unnecessary user
choice. Replacing both rubrics with the upstream template loses specific policy.
Two full review passes retain overlapping instructions and extra cost. A
separate gaps reviewer cannot apply finding filters to the upstream reviewer.

The selected appendix keeps one review while giving its general criteria precise
local rules. Its main risk is reduced attention to structure. The mandatory
Structure section makes missing coverage visible without buying another review.
A second reviewer remains a future decision, not an automatic fallback.

The older issue 265 design proposes oracle-adjudicated checkpointed execution.
This design replaces that implementation approach for the recommended skill. It
does not claim that a task ledger solves every process crash or lifecycle
failure. Related issue closure and stall-recovery branch disposal require
separate decisions and are not actions authorized by this spec.

## Source references

- [Native executor](../../.patchmill/skills/executing-plans/SKILL.md)
- [Upstream reviewer template](../../.patchmill/skills/requesting-code-review/code-reviewer.md)
- [Skill pack definition](../../src/workflow/skill-pack.ts)
- [Skill defaults](../../src/workflow/skills.ts)
- [Domain language](../../CONTEXT.md)
- [Earlier review-wrapper design](2026-06-12-subagent-dev-with-codex-and-thermo-reviews-design.md)
- [Validation and PR-check design](2026-07-18-final-validation-and-pr-check-repair-design.md)
- [Issue 265 design](2026-09-21-issue-265-oracle-adjudicated-checkpointed-implementation-skill-design.md)
