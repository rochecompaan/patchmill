# Non-Interactive Subagent Finalization Design

**Date:** 2026-07-18 **Status:** Approved direction; implementation pending

## Problem

Patchmill runs implementation agents through a single-turn, non-interactive
`pi -p` invocation. In issue #98, the parent agent launched an asynchronous
worker, repeatedly inspected its status, and then returned progress prose while
the worker was still active. Patchmill correctly rejected the unsupported
response, but the implementation run ended blocked and the detached worker
continued changing the worktree after the parent exited.

The parent already had enough evidence to know the worker was active. The
failure was therefore not missing status visibility. The implementation prompt
and configured skill did not make the orchestration invariant explicit enough:
an unresolved subagent is a hard prohibition on advancing through a dependent
checkpoint or returning the final Patchmill response.

## Goals

- Make the parent implementation agent retain responsibility for every worker,
  reviewer, validator, and fix run until each is resolved.
- Preserve each configured skill's freedom to use one or many subagents,
  sequential or parallel execution, and foreground or background mode.
- Distinguish status inspection from waiting without discouraging documented
  `pi-subagents` status usage.
- Require the parent to continue through all tasks, reviews, fixes,
  verification, todo closure, and landing before returning.
- Make progress prose explicitly invalid as the final response.
- Apply the contract to all three Patchmill-owned subagent development skills
  and to every implementation prompt, including projects that configure another
  implementation skill.

## Non-goals

- Add or change `pi-subagents` runtime enforcement.
- Add environment variables or extension configuration.
- Add finalization tools, orphan cancellation, automatic session resumption, or
  another recovery mechanism.
- Prefer foreground execution or discourage multiple subagents.
- Change child worker or reviewer output contracts; no child-result confusion
  has been observed.
- Change Patchmill's supported final JSON schemas or parser behavior.

## Design

### Universal implementation-prompt contract

Add a dedicated non-interactive orchestration section to the implementation
prompt built by `src/cli/commands/run-once/prompts.ts`. Place it after the
existing subagent-support section so it applies before issue content and the
numbered workflow.

The section must state:

- the Patchmill Pi invocation has one turn and will not be resumed;
- the agent may use whatever subagent topology the configured skill requires,
  including multiple sequential or parallel background runs;
- every launched run must be tracked until it reaches a terminal state;
- `subagent({ action: "status" })` inspects active runs, while `wait({ id })` or
  `wait({ all: true })` keeps the turn alive until results are available;
- status inspection does not replace waiting;
- the parent may continue genuinely independent work while a background run is
  active, but it must not cross a checkpoint that depends on that run;
- when no independent work remains and a result is required, the parent must
  wait rather than end the turn;
- before returning, the parent must inspect active runs and treat every queued,
  running, paused, needs-attention, or otherwise unresolved run as a hard
  prohibition on finalization;
- the parent must resolve, await, resume, or interrupt every outstanding run;
- progress prose and promises to continue later are invalid final responses.

Repeat the essential finalization rule near the landing-result contracts: before
returning terminal JSON, confirm there are no unresolved subagents and all
required implementation, review, verification, todo, and landing checkpoints are
complete. This repetition keeps the terminal constraint close to the response
schemas.

### Patchmill subagent-development skills

Update all three canonical Patchmill-owned skills and their installed
`.patchmill` mirrors:

- `skills/subagent-dev-with-validation-and-pr-checks/SKILL.md`
- `skills/subagent-dev-with-codex-and-thermo-reviews/SKILL.md`
- `skills/single-subagent-dev-with-codex-and-thermo-reviews/SKILL.md`
- `.patchmill/skills/subagent-dev-with-validation-and-pr-checks/SKILL.md`
- `.patchmill/skills/subagent-dev-with-codex-and-thermo-reviews/SKILL.md`
- `.patchmill/skills/single-subagent-dev-with-codex-and-thermo-reviews/SKILL.md`

Each skill must add a Patchmill non-interactive orchestration invariant without
changing its chosen worker/reviewer topology:

1. Track every foreground or background dispatch through completion.
2. Use status for inspection and `wait` when a required result is not yet
   available.
3. Do not repeatedly poll status merely to pass time.
4. Do not advance past a worker/reviewer/fix checkpoint until its result has
   been consumed and any required follow-up is closed.
5. Before final handoff, inspect active runs and resolve every outstanding run.
6. Treat subagent completion as an intermediate checkpoint; continue through the
   remainder of the configured workflow.
7. Never return progress prose from the non-interactive Patchmill invocation.

Both task-by-task wrappers must retain fresh implementers and task reviews for
each plan task. The validation-and-PR-checks wrapper must retain its final
validation-readiness review and observable PR-check repair loop without adding
Codex or thermo-nuclear full-worktree reviews. The Codex-and-thermo wrapper must
retain both full-worktree review loops. The single-worker skill must retain one
initial implementation worker followed by its Codex and thermo-nuclear review
loops. The new wording governs lifecycle completion, not agent count or
concurrency.

The upstream installed `subagent-driven-development` dependency is not changed.
The Patchmill-owned wrappers add the non-interactive invariant while continuing
to use the upstream task-by-task process where applicable.

### Finalization checklist

The implementation prompt and all three skills should give the parent the same
final checklist:

1. Inspect active subagent runs.
2. Confirm no run is unresolved.
3. Confirm every required implementation task is complete.
4. Confirm task-level and final review loops required by the configured skill
   are closed.
5. Confirm accepted findings were fixed and re-reviewed.
6. Confirm required verification and todo closure are complete.
7. Confirm landing completed, or that human input is genuinely required.
8. Return only the specified `merged`, `pr-created`, or blocker JSON object.

A worker or reviewer reporting completion satisfies only its local workflow
checkpoint. It never satisfies this parent finalization checklist by itself.

## Error handling

If status reports an active run, the parent must not return. It should:

- continue independent orchestration work when useful;
- call `wait` when the active result is required;
- handle needs-attention or blocked states;
- resume a run when additional instructions are appropriate; or
- interrupt a run when it must be stopped safely.

If human input is genuinely required, all active writers must first be resolved
or stopped, then the parent may return the existing blocker JSON contract.

## Verification

### Automated behavior checks

Update existing implementation-prompt tests to verify the generated prompt
contains the behavioral contract that:

- this is a one-turn non-interactive invocation;
- status is used to inspect active runs;
- waiting is required before dependent progress or finalization;
- unresolved runs prohibit the final response;
- progress prose is not a valid final response.

These checks protect production prompt behavior rather than asserting standalone
documentation text.

### Skill-pack verification

Do not add tests that merely assert Markdown prose. Instead:

- run Markdown lint or the repository's existing skill validation;
- verify canonical and installed copies of each changed Patchmill skill match;
- verify skill-pack metadata and live configured references still resolve the
  same skill paths;
- run the existing relevant prompt and skill-pack test suites.

No npm dependency changes are planned, so the dependency-change Nix-build rule
does not apply.

### Observation window

Observe the next five Patchmill implementation runs using existing run and Pi
session logs. For each run, record whether:

1. every background dispatch was resolved before dependent workflow progress;
2. status was used for inspection rather than a polling loop;
3. the parent finished with no active subagent;
4. child completion led into remaining review, validation, PR-check, and landing
   work;
5. stdout contained supported terminal JSON; and
6. the run reached landing or a genuine human blocker.

If the failure recurs during this window, revisit mechanical enforcement with
concrete recurrence evidence.

## Affected files

Expected implementation scope:

- `src/cli/commands/run-once/prompts.ts`
- `src/cli/commands/run-once/prompts.test.ts`
- `skills/subagent-dev-with-validation-and-pr-checks/SKILL.md`
- `skills/subagent-dev-with-codex-and-thermo-reviews/SKILL.md`
- `skills/single-subagent-dev-with-codex-and-thermo-reviews/SKILL.md`
- matching installed skill files under `.patchmill/skills/`
- generated hashes in `.patchmill/skills/patchmill-skill-pack.json`

No runtime subagent, parser, pipeline-state, dependency, or user/project
configuration files are in scope. Regenerating managed skill-pack hashes is
required packaging synchronization, not runtime enforcement.
