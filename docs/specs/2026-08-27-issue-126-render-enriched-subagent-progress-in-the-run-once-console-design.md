# Render enriched subagent progress in the run-once console design

- **Issue:** #126
- **Parent:** #116
- **Dependency:** #125, complete and merged
- **Status:** Proposed design

## Summary

Run-once will render the validated `subagent-progress` observations introduced
by issue #125 as concise child-level console lines. An authoritative child
observation renders every available `agent`, `model`, and `thinking` field in
that order. A child that closes without authoritative agent metadata renders one
identity-only `unresolved=true` fallback using #125's canonical child identity.

The console reporter will own presentation-level deduplication. It will suppress
lifecycle-only repeats of the same child metadata tuple, render changed metadata
as an additional line, and keep identical tuples from different children
independent. It will not resolve metadata, reinterpret lifecycle, or alter the
issue #125 observation contract.

## Context

The merged #125 contract adds this validated run-once observation:

```ts
{ type: "subagent-progress", progress: PersistedSubagentProgress }
```

`PersistedSubagentProgress` is a bounded versioned union:

- direct child identity: originating `toolCallId`, `runId`, and `childIndex`;
- workflow child identity: originating `toolCallId`, `workflowRunId`, and
  `childId`;
- optional authoritative `agent`, `model`, and `thinking` metadata;
- optional lifecycle state; and
- a literal `unresolved: true` marker for a closed child that never acquired
  canonical agent metadata.

The exact-session streamer already validates these entries, excludes sibling and
nested sessions, and suppresses exact persisted-entry duplicates. Its tuple key
includes lifecycle state and closure metadata, however, so a pending, running,
and completed entry with unchanged runtime metadata remains three valid
observations. #126 must collapse those into one console outcome without changing
the durable or pipeline-level history.

`AgentIssueConsoleProgressReporter` currently handles assistant usage and
ordinary tool-call observations. Parent subagent calls use the existing
`🤖 subagent (...)` summary when their arguments expose agent names, while
management calls such as `action=list` use normal `🔧 subagent (...)`
formatting. The reporter does not yet handle child-level `subagent-progress`
observations.

## Goals

- Render one child progress line for every distinct authoritative
  `agent`/`model`/`thinking` tuple reported for that child.
- Render exactly one canonical identity-only fallback for each unresolved child
  that never reports authoritative agent metadata.
- Preserve every available authoritative metadata field and omit unavailable
  fields without placeholders.
- Preserve nested provider/model path segments and all accepted identifier bytes
  exactly as #125 reports them.
- Suppress state-only and exact metadata repeats without collapsing distinct
  children.
- Keep failed and unresolved children visible.
- Preserve existing parent tool-call, management-call, non-child, accounting,
  triage, stdout, and stderr behavior.
- Cover both the focused formatter behavior and the complete parent-session to
  operator-output path.

## Non-goals

This issue will not:

- resolve or infer agent, model, thinking, provider, or child identity;
- parse Pi lifecycle results or change #125's persisted union;
- change session ownership, streaming, cancellation, inventory, accounting, or
  implementation-todo progression;
- display child lifecycle state or closure seals;
- change `pi-subagents` or its TUI;
- enrich triage output; or
- change the existing run-once final-result policy for TTY versus redirected
  stdout.

## Approaches considered

### Render and deduplicate in the console reporter (chosen)

Add a dedicated `subagent-progress` branch and small child/tuple key helpers to
`AgentIssueConsoleProgressReporter`. The reporter is the presentation boundary,
sees observations in order, and already owns run-scoped console state. It can
ignore lifecycle-only changes while the JSONL reporter and pipeline retain the
complete observation stream.

This keeps #126 consumer-only and makes console behavior directly testable.

### Deduplicate in the exact-session streamer

The streamer could discard observations whose metadata is unchanged. That would
remove valid lifecycle history from every downstream consumer, couple terminal
presentation to session parsing, and weaken #125's accounting and todo-refresh
contract. It is rejected.

### Render every #125 observation

This is the smallest code change, but state transitions and workflow closure
seals would repeat unchanged lines. It would not satisfy stable per-child tuple
deduplication and is rejected.

## Proposed console behavior

### Authoritative metadata lines

A child observation is authoritative for console rendering when it contains
`agent`. `model` and `thinking` remain independently optional. Fields appear in
the fixed order `agent`, `model`, `thinking` and use comma-and-space separators:

```text
🤖 subagent (agent=reviewer, model=gpt-5.6-sol, thinking=xhigh)
🤖 subagent (agent=reviewer, model=openai/team/models/gpt-5.6-sol)
🤖 subagent (agent=reviewer, thinking=xhigh)
🤖 subagent (agent=reviewer)
```

The formatter will not trim, split, normalize, truncate, remove a provider
prefix, or strip model suffixes. In particular, `openai/team/models/gpt-5.6-sol`
remains byte-for-byte unchanged.

A non-fallback observation without `agent` is not promoted into an authoritative
console tuple. The reporter waits for a later authoritative observation or the
issue #125 unresolved marker. It never treats model or thinking as child
identity and never fills the missing agent from parent tool arguments.

### Unresolved fallback lines

When `unresolved === true` arrives for a child that has produced no
authoritative console tuple, render one identity-only fallback. Metadata and
lifecycle state are not displayed in this fallback.

Workflow children use the validated `childId` value:

```text
🤖 subagent (child=review-step, unresolved=true)
```

Direct children use both validated identity components because `childIndex` is
scoped by `runId`:

```text
🤖 subagent (runId=run-123, childIndex=0, unresolved=true)
```

The displayed workflow `child` value comes directly from `childId`; the direct
values come directly from `runId` and `childIndex`. The reporter does not use
array position, tool arguments, task text, a placeholder agent, or any locally
constructed identity.

Identity-only non-fallback observations, including pending async entries and
workflow closure seals without metadata, produce no console line. #125 emits the
unresolved marker only after authoritative inventory closure, so the reporter
does not buffer or predict unresolved children.

### Child identity and deduplication

Presentation state lives for the lifetime of one console reporter, which is one
run-once invocation. Canonical internal child keys include every #125 scoping
component:

```text
direct:   (kind, toolCallId, runId, childIndex)
workflow: (kind, toolCallId, workflowRunId, childId)
```

For each child, the reporter records fixed-position metadata tuple keys:

```text
(agent, model-or-absent, thinking-or-absent)
```

These rules follow:

- the first authoritative tuple renders immediately;
- an exact repeat for the same child is suppressed;
- a state-only or `inventoryClosed` change with the same metadata is suppressed;
- a changed agent, model, or thinking value renders an additional line;
- earlier lines are never replaced;
- two different children with the same metadata each render their own line; and
- repeated unresolved entries for one child render at most one fallback.

Fixed-position serialization, rather than delimiter concatenation, avoids key
collisions when accepted values contain punctuation. The reporter does not reuse
issue #125's full progress key because that key intentionally distinguishes
lifecycle transitions.

### Placement and existing output

Child progress uses the reporter's existing indentation convention: three spaces
inside an active step and no indentation if an observation arrives outside a
step. It is never discarded solely because no step is active.

The existing ordinary `tool-call` branch remains unchanged. Parent subagent call
summaries, management calls such as `🔧 subagent (action=list)`, and all
non-subagent tools retain their current formatting. Child-progress deduplication
applies only to `subagent-progress` observations; it does not reinterpret parent
call summaries as authoritative child metadata.

The reporter continues to write through its stderr-backed `write`/`writeLine`
sink. `writeRunOnceResult()` remains the only final-result writer on stdout.
Redirected stdout therefore remains exactly one machine-readable JSON object;
interactive stdout retains the terminal result behavior introduced separately
from this issue. No child progress is written to either final-result form.

## Data flow

1. The #125 Pi extension appends a bounded `patchmill-subagent-progress` custom
   entry to the exact parent session.
2. The exact-session streamer validates the entry and emits a
   `subagent-progress` observation.
3. Pipeline progress records the complete observation without incrementing
   parent `toolCalls`; implementation may refresh todos as it already does.
4. The JSONL reporter preserves the observation for diagnostics.
5. The console reporter derives the canonical child key and either:
   - renders an unseen authoritative metadata tuple;
   - renders the child's first terminal unresolved fallback; or
   - suppresses a presentation-level repeat.
6. Final run-once output is written separately on stdout after the pipeline
   settles.

## Affected components

### `src/cli/commands/run-once/console-progress.ts`

- Add focused formatting for authoritative and unresolved child observations.
- Add run-scoped canonical child and metadata tuple state.
- Handle `subagent-progress` before the existing ordinary tool-call branch.
- Leave token accounting, step formatting, final-result snapshots, and generic
  tool formatting unchanged.

### `src/cli/commands/run-once/console-progress.test.ts`

Add focused behavior coverage for field omission, nested model preservation,
per-child deduplication, changed tuples, direct and workflow fallbacks, and
existing tool-call formatting.

### `src/cli/commands/run-once/pipeline-progress-scenarios.test.ts`

Extend or add one operator-output scenario using real
`patchmill-subagent-progress` parent-session entries. Attach the production
console reporter to the pipeline's progress stream and prove that authoritative,
failed, and unresolved child outcomes reach the console without changing parent
accounting.

### `src/cli/commands/run-once/result-output.test.ts`

Only if needed to keep the end-to-end output assertion focused, compose captured
console progress with redirected final-result output and prove that stdout
parses as the unchanged final JSON while all child lines remain in the stderr
sink. No production change to result output is planned.

No `src/pi`, dependency, package, Nix, triage, or `pi-subagents` change belongs
in this issue.

## Failure and safety behavior

- The reporter consumes only the already validated #125 projection and never
  reads raw Pi tool results.
- Malformed or over-limit custom entries remain filtered by the existing
  exact-session parser and produce no console output.
- Missing optional metadata remains absent; no placeholder text is introduced.
- An unresolved child with no agent is still visible through canonical bounded
  identity.
- Failed children remain visible when #125 reports either an authoritative tuple
  or an unresolved fallback; lifecycle state itself is not rendered.
- Task text, output, prompts, credentials, paths, usage, and unrestricted result
  fields never enter the formatter.
- Reporter state is bounded by #125's existing per-session child, transition,
  and custom-entry ceilings.
- Console write failures retain the existing backpressured observation failure
  behavior; this issue adds no catch that could hide them or redirect output.

## Verification strategy

These tests pass Patchmill's Testing Value Gate because they protect an
operator-visible runtime contract, metadata fidelity, per-child identity, and
stdout/stderr separation.

### Focused console tests

Cover:

- all three authoritative fields in stable order;
- independent omission of model and thinking;
- a model identifier with multiple `/` path segments preserved exactly;
- the same child and tuple repeated across pending, running, failed, or
  completed lifecycle entries rendering once;
- a changed agent, model, or thinking tuple rendering an additional line;
- two children with identical metadata each rendering one line;
- identity-only non-fallback observations producing no line;
- one workflow fallback from `childId`;
- one direct fallback from `runId` plus `childIndex`;
- repeated fallback observations producing exactly one line;
- no agent/model/thinking invention in fallbacks;
- progress received outside an active step remaining visible; and
- unchanged parent subagent, management-call, and ordinary tool formatting.

### End-to-end regression

Use the existing run-once mock runner and exact parent-session helpers to append
real #125 custom entries while a Pi invocation is active. Include:

- one child whose model/thinking tuple changes;
- a duplicate or lifecycle-only transition;
- one failed child with authoritative metadata;
- unresolved workflow and direct children without agent metadata; and
- a model with nested path segments.

Assert the production pipeline plus console reporter emits exactly the expected
child lines, keeps distinct children independent, preserves one accounting unit
per parent tool-call ID, and does not expose sibling or nested session entries.
Capture redirected final output separately and assert stdout is one parseable
JSON result containing no progress text while every child line is confined to
the stderr sink.

Implementation verification should include:

```sh
node --test \
  src/cli/commands/run-once/console-progress.test.ts \
  src/cli/commands/run-once/pipeline-progress-scenarios.test.ts \
  src/cli/commands/run-once/result-output.test.ts
npm run test:run-once
npm test
npm run lint
npm run build
```

No Nix build is required unless implementation unexpectedly changes an npm
dependency file; such a dependency change is outside this design.

## Acceptance mapping

| Acceptance criterion                          | Design response                                                                                           |
| --------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| One line per distinct authoritative tuple     | Canonical child plus fixed-position metadata keys suppress only same-child repeats.                       |
| Changed tuple adds a line                     | Any agent/model/thinking change creates a new presentation key; prior output remains.                     |
| Missing fields are omitted                    | The formatter includes only available fields and never inserts placeholders.                              |
| One fallback per unresolved child             | A per-child fallback marker renders once only on `unresolved: true`.                                      |
| Workflow and direct fallback identity         | Workflow displays #125 `childId`; direct displays #125 `runId` and `childIndex`.                          |
| No local resolution or inference              | Only validated observation fields are consumed; arguments and configuration are ignored.                  |
| Nested model identifiers survive              | Rendering performs no splitting, provider stripping, normalization, or truncation.                        |
| Failed and unresolved children remain visible | Authoritative failed tuples and identity-only unresolved fallbacks use the same child path.               |
| Stdout/stderr remain separated                | Console progress stays on the stderr reporter; redirected final output remains one JSON object on stdout. |
| Other run-once output is unchanged            | Existing tool-call, step, token, accounting, and final-result branches remain intact.                     |
