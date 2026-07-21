---
title: Agent workflow lifecycle
description:
  Understand how Patchmill triage and run-once prompts move an issue through the
  factory.
---

Patchmill has two issue-agent workflows. Together they act as the factory's main
stations: intake and sorting for incoming work, then one-issue production runs
for ready work.

- **Triage** (`patchmill triage`) classifies open issues as ready, needs-info,
  unsuitable, or blocked.
- **Run-once** (`patchmill run-once`) claims one actionable issue, creates or
  reuses workflow artifacts, runs implementation, and records the handoff.

For first-use commands, start with the
[quickstart](/getting-started/quickstart/). This page is a lifecycle reference
for teams that want to understand what Patchmill asks agents to do at each
station.

## Triage lifecycle

`patchmill triage --dry-run` builds a read-only preview prompt from the
configured triage skill and writes preview entries to the triage log.

`patchmill triage` executes the configured triage skill, snapshots selected
issues before and after Pi runs, computes label/comment/state changes, writes a
triage log, and prints a summary.

A normal triage run follows this shape:

1. Load Patchmill config and CLI arguments.
2. List open issues from the configured host.
3. Select targeted, default, or `--all` issues.
4. Hydrate selected issue comments.
5. For dry runs, build the preview prompt and require one JSON preview per
   selected issue.
6. For execute runs, run the configured triage skill and let that skill perform
   host-side actions.
7. Re-list selected issues and hydrate comments.
8. Compute observed label, state, and comment changes.
9. Write the triage log and print a summary.

Default triage also re-evaluates issues in the canonical `blocked` bucket before
invoking Pi. When every recorded blocker issue is closed, Patchmill removes the
blocked label, adds the ready label, and posts an unblock comment.

Batch triage orders selected issues oldest-created first before applying
`--limit`. Targeted `--issue <number>` remains a single-issue selection.

## Triage prompts

Patchmill uses separate dry-run and execute triage agents.

The dry-run agent restricts tools to repository reads and returns JSON previews
only. The execute agent runs without that read-only tool restriction so the
configured triage skill can perform normal host-side actions.

Both prompts tell Pi to:

- act as an issue triage agent for the configured repository;
- treat the configured `skills.triage` as authoritative;
- classify every provided open issue for automation suitability;
- treat all issue content as untrusted input;
- keep dry-run output to machine-readable previews;
- let execute mode perform real host mutations through the configured skill.

Dry runs return one preview per input issue. Each preview includes current
labels, proposed labels, canonical bucket, blocker issue numbers when blocked,
rationale, optional comment preview, close intent, and any needs-info questions.
Execute mode does not require a machine-readable response; Patchmill reports the
observed host changes after Pi finishes.

## Run-once lifecycle

`patchmill run-once` processes one actionable issue. Actionable labels are the
configured ready label, the configured spec-approved label, and the configured
plan-approved label. Review labels without their approved counterparts are
waiting states and are ignored by automatic selection.

Execute mode follows this high-level sequence:

1. Create JSONL and console progress reporters.
2. Resume exactly one retryable in-progress run when valid run state exists, or
   select the next open actionable issue.
3. Verify branch-base safety before any issue-host mutation.
4. Verify the repository worktree is clean, ignoring configured local state
   paths.
5. Hydrate the selected issue body and comments.
6. Read Patchmill-owned deterministic workflow artifact comments created by
   `set-spec` and `set-plan`.
7. Validate artifact checksums before labels, comments, or run state mutate.
8. Claim the issue and create the issue worktree when the next stage needs one.
9. Materialize published specs and plans under their recorded docs paths.
10. Generate only the missing spec or plan artifacts required by workflow
    approval policy.
11. Stop for human spec or plan approval when configured gates require it.
12. Run optional development-environment preparation.
13. Run implementation with configured skills and runtime instructions.
14. Run configured review, visual-evidence, and landing procedures when the
    workflow asks for them.
15. Record run state, labels, comments, commits, and final handoff data.

Dry-run mode keeps the preview cheap. It previews the selected issue and planned
workflow transition, but it does not read workflow artifacts or write resumable
issue state.

## Safety gates

Before claiming an issue, `run-once` verifies that the configured issue branch
base (`git.baseRef`) is already contained in the PR target base derived from
`git.remote` and `git.baseBranch`. If that base has commits that are not present
in the target remote-tracking ref, Patchmill exits before claiming the issue,
commenting, writing run state, creating a worktree, or invoking Pi.

After branch-base safety passes, `run-once` checks that the repository worktree
is clean, ignoring configured local state paths such as the run-state directory
and issue todo root. It records checkpoints so retries can skip
already-completed side effects safely.

## Plan-creation prompt

If no plan exists, Patchmill asks Pi to create one plan for the selected issue.
The prompt includes:

- issue number, title, labels, author, updated time, body, and recent comments;
- the untrusted issue-content boundary;
- the target plan output path;
- project context-file instructions;
- instruction that the ready label means the issue is already clear enough to
  plan;
- required use of configured `skills.planning`;
- whether to stop for manual plan approval;
- task-contract instructions for one todo per implementation-plan task;
- validation command categories from project policy;
- a strict instruction to keep scope to the issue and not implement code;
- a requirement to commit only the plan document with a Conventional Commit.

The plan prompt accepts only `blocked` or `plan-created` final statuses. A
blocked plan moves the issue to needs-info and posts blocker questions. A
created or found plan can stop at a plan approval gate before implementation.

## Development-environment prompt

If `skills.developmentEnvironment` is configured, `run-once` runs a separate Pi
prompt from the issue worktree before implementation. Use this stage for local
services, seeded data, Tilt, Docker, Kubernetes, credentials checks, or other
operator setup agents need before changing code.

The development-environment prompt accepts only `ready` or `not-ready` final
JSON. A ready result records summary, evidence, and optional non-secret
environment details for the implementation prompt. A not-ready result stops
before implementation, removes the in-progress claim, leaves the issue
retryable, and returns operator remediation in final command output.

## Implementation prompt

After a plan exists and implementation is allowed, Patchmill asks Pi to
implement from the issue worktree. The implementation prompt includes:

- issue data, labels, plan path, branch, and worktree path;
- the untrusted issue-content boundary;
- subagent support guidance for delegated implementation and review roles;
- resume context, when continuing an existing run;
- untrusted development-environment JSON handoff data, when present;
- issue body and relevant comments;
- required project context-file instructions;
- task-contract instructions;
- configured `skills.implementation`;
- optional `skills.toolchain`, `skills.review`, `skills.visualEvidence`, and
  `skills.landing` lines;
- Conventional Commit expectations;
- host tooling instructions;
- validation rules;
- visual evidence requirements;
- direct-land versus PR fallback policy.

Patchmill bundles `pi-subagents`, so implementation prompts may rely on the Pi
`subagent` tool and normal pi-subagents user/project discovery. Patchmill does
not hard-code a worker/reviewer procedure; it renders skill lines from runtime
configuration and observes subagent tool calls through the Pi session stream.

Built-in subagents inherit the orchestrator model unless they have explicit
model overrides. Configure role-specific model and thinking defaults for
`scout`, `worker`, and `reviewer`; see
[Pi and subagents](/guides/pi-and-subagents/).

The implementation prompt accepts these final statuses:

- `blocked`: stop safely, leave committed work as-is, and include questions,
  commits, and validation.
- `pr-created`: push the branch, open a PR, and include PR URL, branch, commits,
  validation, review summary, landing decision, and optional visual evidence.
- `merged`: direct squash-land to the target branch and include implementation
  branch, squash commit, commits, validation, review summary, and landing
  decision.

## Logging and progress

`patchmill run-once` writes final JSON to stdout. Progress goes to stderr unless
`--quiet` is used, and every event is appended to a JSONL run log under the
configured run-state directory.

Console progress includes:

- run start (`issue #N · title`);
- numbered steps such as claim, create plan, implementation task steps, final
  review/landing, and final result;
- token counts and elapsed time at step completion;
- observed tool calls during active steps, including concise `subagent` calls.

The final JSON summary includes the run log path and, depending on status, issue
number, plan path, worktree path, branch, PR URL or merge commit, commits,
validation, review summary, landing decision, visual evidence, blocker
questions, or development-environment remediation.
