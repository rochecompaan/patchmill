---
name: inline-dev-with-validation-and-pr-checks
description:
  Use when executing an approved Patchmill implementation plan in one session
  with final validation, normal independent review, conditional frontend review,
  and pull-request check handling.
---

# Inline Development with Validation and PR Checks

Use the installed sibling `executing-plans` skill as the executor. This wrapper
adds Patchmill boundaries for one normal whole-branch review, conditional
frontend review, final validation, and PR checks. It does not fork the upstream
executor or reviewer template.

## Required inputs

Read these files before work starts:

- `../executing-plans/SKILL.md`
- `../requesting-code-review/code-reviewer.md`
- `review-appendix.md`
- The approved plan and its spec

Use the upstream workspace and task records:

```sh
../subagent-driven-development/scripts/sdd-workspace PLAN_FILE
../executing-plans/scripts/task-start PLAN_FILE N
../executing-plans/scripts/task-done PLAN_FILE N BASE -- COMMAND
../subagent-driven-development/scripts/review-package PLAN_FILE BASE HEAD [OUTFILE]
```

Start or resume the plan workspace. Read its progress ledger, scan shared
interfaces, read each task brief, compare every expected output, and use
`task-done` only after the task command passes. Apply TDD when the Testing Value
Gate requires a behavioral test. Use direct verification for static documents,
configuration, and other Testing Value Gate exclusions.

## Inline execution boundaries

The parent session is the sole writer. Do not dispatch task implementers,
per-task reviewers, or batch check-ins by default.

Record ordinary ambiguities as ledger rulings. A ruling must state the decision,
reason, and cost if wrong. Return the existing blocker result for a destructive
or security-sensitive action, an unauthorized external effect, or an unusable
plan. Existing publication authorization remains valid.

Keep the existing landing policy, implementation-PR requirements, recovery
state, terminal JSON fields, and unattended completion rules. Do not add a
second implementation method. Non-frontend work retains one normal review and
one ordered fix pass. The conditional frontend repair loop below is the only
automatic extra-review exception.

## One normal final review and validation

After all plan tasks have their required command evidence, prepare one package
for the complete delivery. Before setting its base and head, account for every
workflow-materialized file. The package must include these inputs:

- immutable base and reviewed-head references, plus working-tree status and
  final content for materialized files outside the committed range;
- the approved plan and spec;
- the plan's Review Focus verbatim;
- the progress ledger, including task records and rulings;
- required commands, results, evidence locations, and their working directory;
- the installed upstream template and this appendix.

Discover `reviewer` within Patchmill’s isolated Pi runtime. The bundled
`pi-subagents/agents/reviewer.md` supplies its base prompt.

Build the review task from `../requesting-code-review/code-reviewer.md`, add
`review-appendix.md`, and supply the complete review package. Selecting the role
does not load these task files automatically.

Select the most capable available model under operator policy. Pass its resolved
model and thinking values explicitly. If no reviewer is available, return the
existing reviewer setup blocker. Do not substitute author review. The reviewer
must not create children or alter the branch. Await and consume its result.
Unresolved reviewer work prevents a successful terminal result.

The canonical reviewer is shell-less. Keep its read-only tool policy. The parent
runs required commands at the reviewer's request and supplies the command,
result, and evidence location. Run a command that writes files in a disposable
copy of the exact reviewed state. Do not publish, deploy, change credentials, or
modify shared resources without existing authorization. Record unavailable
evidence and its required operator action.

Before one ordered fix pass, rule on every declined-to-judge entry and regrade
findings by their user impact. Record the review reference, reviewed head,
findings, rulings, deferred minors, fixes, and final command evidence in the
progress ledger.

1. Repair accepted Critical and Important correctness findings first. Each uses
   a reproducing test from RED to GREEN.
2. Repair accepted structural findings next. Use green-suite and required
   command evidence. Do not invent a failing behavior test for a
   behavior-preserving repair.
3. Use direct verification for Testing Value Gate exclusions. Defer Minor
   findings. Do not repair them in this pass.

Run every required command again against the final state. For non-frontend work,
do not start an automatic second review or a repeat-until-approved loop. For
frontend work, complete explicit operator-configured normal reviews and use the
conditional checkpoint below after final validation.

## Conditional frontend review

Evaluate applicability independently from the planning decision. Inspect the
final delivery and materialized files outside the committed range. Record a
brief reason in the progress ledger. Activate for browser-visible layout,
responsive behavior, styling, interaction, motion, accessibility, navigation, or
user-flow changes. Skip backend, documentation, and copy-only work unless copy
materially changes one of these areas.

When applicable, read and follow `../patchmill-frontend-review/SKILL.md`. Stop
with an evidenced blocker if the skill or required local reference or license is
missing. Never fetch replacement rules. This is an independent frontend
checkpoint after task commands, normal review, its ordered fix pass, explicit
operator-configured reviews, and final validation. It does not replace them.

Use the shared skill's fresh canonical reviewer, resolved model and thinking,
read-only shell-less policy, and safe parent-supplied command evidence. Supply
immutable base/head, final frontend and materialized files, requirements,
project design-system policy, approved spec, available mockup, local pinned
rules, and current visual evidence. Do not retroactively require mockups for
older approved specs. Missing optional evidence does not block review; existing
required evidence remains required.

The parent remains the sole repair author. Resolve every valid frontend finding,
including Minor findings, before frontend `pass`. Record evidence and reasoned
dispositions for disputes; do not waive valid requirements. This differs from
the normal review's deferred Minor recommendations.

For a production-code repair, refresh scope/head, rerun affected validation, and
obtain independent normal code review for the repair scope. Complete its
accepted ordered fixes and all required final commands before a fresh frontend
review. For other repairs, run affected direct verification before fresh
frontend review. Continue until `pass` or an evidenced blocker. Old-head
approval cannot pass the current delivery.

Record reviewed heads, review references, findings, dispositions, repairs,
commands, and visual evidence in the progress ledger. Resolve all review and
repair work before ready handoff. The normal review appendix remains the normal
code-review contract, not a frontend preference list.

## PR checks and durable handoff

Resume only from matching task, review, and fix records. A review for another
head is stale. Record the current immutable head, status, and final validation
before resuming review or landing. Before repairing a failed PR check, compare
its failed head with the current PR or branch head. Skip stale failures and
record the mismatch. For a current code-related failure, run affected validation
and make no more than two repair passes. Push normally when existing
authorization permits it. Never force-push.

A current-head PR-check repair that changes frontend work invalidates affected
frontend approval and stale screenshots. Refresh required visual evidence
through the existing evidence tooling, then apply the same affected-validation,
normal-review, final-command, and fresh-frontend-review order above. Preserve
the two-pass PR-check repair limit and stale-check detection. Record the pass
number before edits. Each attempt to repair a current-head failed check is one
pass, including its review-driven corrections. A new failed-check repair attempt
consumes the next pass. Never start a third attempt.

Classify pre-existing failures as validation blockers, and credentials,
services, runners, permissions, quotas, billing, and host failures as operator
blockers. Do not make speculative source changes for either class. Require
observable passing checks, or evidence that no required checks exist, before a
ready PR handoff.

Carry rulings, deferred minors, structural recommendations, command evidence,
and human-review callouts into the PR body. Include frontend reviewed heads,
findings, dispositions, repairs, and current evidence before scratch cleanup.
Direct landing is not permitted. Keep the plan workspace while blocked. Remove
only this plan's scratch workspace after durable reporting is complete.
