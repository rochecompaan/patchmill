# Correlate per-child subagent progress and preserve pipeline accounting design

- **Issue:** #125
- **Parent:** #116
- **Dependency:** `pi-subagents` 0.57.0, pinned by #195
- **Status:** Proposed design

## Summary

Patchmill will extend its existing run-once subagent observer into a bounded
correlation bridge for the current structured single-child and `workflowScript`
execution surfaces.

Direct child results will be identified by the originating parent tool call, the
upstream run ID, and `SingleResult.index`. Workflow children will instead be
identified by the `pi-subagents` v0.57.0 `workflowChildren` v1 summary:
originating parent tool-call ID, workflow run ID, and stable child ID. Patchmill
will never map flattened workflow result rows back to children.

The Pi extension will persist validated metadata and lifecycle transitions as
versioned `patchmill-subagent-progress` custom entries in the exact parent Pi
session. It will keep open async workflow inventory until upstream closes it,
suppress exact duplicate tuples, and append one explicit unresolved fallback for
every closed inventoried child that never acquired authoritative agent metadata.
These custom entries remain outside LLM context.

The exact-session streamer will parse the custom entries into a new
`subagent-progress` observation. Child observations may refresh implementation
todos, but only the ordinary parent `tool-call` observation increments step
`toolCalls`. One originating parent tool-call ID therefore remains one
accounting unit regardless of child count or transition count.

## Goals

- Support structured foreground and async single-child calls.
- Support foreground and async `workflowScript` children launched through
  `runs.run`, `runs.all`, sequential control flow, and dynamic control flow.
- Preserve independent observations for children with colliding
  `SingleResult.index` values in different workflow runs.
- Emit the first authoritative metadata or lifecycle tuple and every changed
  tuple while suppressing exact repeats per parent and child.
- Keep async workflow correlation open until `inventoryComplete` or a terminal
  workflow state closes the upstream inventory.
- Emit exactly one unresolved fallback for each closed inventoried child that
  never received canonical agent metadata.
- Let subagent progress refresh implementation-todo state before the parent
  workflow returns.
- Preserve parent-level tool accounting and the existing sensitive-data
  boundary.
- Fail closed under malformed, contradictory, unsupported-version, or over-limit
  input.

## Non-goals

- Parse, evaluate, or predict `workflowScript` launches.
- Correlate workflow children by flattened row position, agent, task text,
  launch order, or `SingleResult.index` alone.
- Reproduce upstream agent, model, thinking, or lifecycle resolution.
- Read undocumented `pi-subagents` status, result, receipt, transcript, or
  artifact files.
- Add session-file ownership, cancellation, console formatting, or triage
  behavior.
- Put task text, child output, prompts, messages, arguments, credentials, or
  paths into subagent progress observations.

## Upstream contract

Patchmill will consume only the released `pi-subagents` 0.57.0 runtime contract.
Its `WorkflowChildSummaryV1` is available as `details.workflowChildren` on
foreground progress/results and async status, and as
`details.completions[*].workflowChildren` on terminal completion replay. It
contains:

```ts
{
  version: 1;
  parentToolCallId: string;
  workflowRunId: string;
  inventoryComplete: boolean;
  workflowState:
    | "queued"
    | "running"
    | "completed"
    | "failed"
    | "paused"
    | "stopped";
  children: Array<{
    childId: string;
    runId?: string;
    agent?: string;
    model?: string;
    thinking?: string;
    state:
      | "pending"
      | "running"
      | "completed"
      | "failed"
      | "paused"
      | "stopped"
      | "rejected"
      | "detached";
  }>;
}
```

The workflow child ID is the stable workflow key. The same key is used for
workflow status, stopping, progress, receipts, and completion. Metadata fields
are optional because upstream omits values it cannot resolve.

For direct foreground results, `Details.runId` scopes `SingleResult.index`.
Patchmill will accept an authoritative direct tuple only when both values are
valid; array position is never a substitute. A structured async single launch
has one child by surface contract and exposes its run identity before terminal
metadata. Patchmill may retain that one pending `(runId, index 0)` identity, but
will not infer agent, model, or thinking from tool arguments. If no later
indexed authoritative tuple appears, terminal completion produces the same
single unresolved fallback used elsewhere.

An unsupported workflow summary version is not interpreted as a compatible
shape. The exact dependency pin and existing installed-package checks remain the
guard against upstream drift.

## Approaches considered

### Extend the in-process custom-entry bridge (chosen)

Normalize and correlate upstream details inside the existing Pi lifecycle
extension, then append only a safe projection to the parent session. This is the
only approach that sees foreground updates, later async status/completion
summaries, and the exact active parent `SessionManager` without inspecting files
or exposing unrestricted result objects.

### Correlate raw session tool results in the run-once streamer

This would move complex upstream result parsing into the session-file reader,
retain unrestricted result payloads longer, and still require cross-call async
state. It weakens the current boundary and duplicates work already performed in
the Pi process.

### Infer workflow children from scripts or flattened results

Parsing scripts cannot predict dynamic launches, and flattened result indexes
are scoped to separate foreground runs. This approach is unsafe and explicitly
rejected.

## Persisted progress contract

Replace the current unversioned five-field projection with this versioned,
discriminated union under the existing custom type:

```ts
type ChildLifecycleState =
  | "pending"
  | "running"
  | "completed"
  | "failed"
  | "paused"
  | "stopped"
  | "rejected"
  | "detached";

type PersistedSubagentProgress =
  | {
      version: 1;
      kind: "direct";
      toolCallId: string;
      runId: string;
      childIndex: number;
      state?: ChildLifecycleState;
      agent?: string;
      model?: string;
      thinking?: string;
      unresolved?: true;
    }
  | {
      version: 1;
      kind: "workflow";
      toolCallId: string;
      workflowRunId: string;
      childId: string;
      state: ChildLifecycleState;
      agent?: string;
      model?: string;
      thinking?: string;
      unresolved?: true;
      inventoryClosed?: true;
    };
```

`inventoryClosed` is workflow-only and accepts only literal `true`. It is a
single deterministic closure seal attached to the lexicographically first child
in an authoritative closing summary, never a direct entry. `toolCallId` always
means the originating launch tool call. A later status or `subagent_wait` call
has its own Pi tool-call ID for accounting, but its workflow summary still
points progress back to the original launch.

Accepted entries contain only the fields above. Missing metadata stays absent;
Patchmill will not insert placeholder agents or derive values from agent files,
settings, parent arguments, or models. A synthetic fallback sets
`unresolved: true`, carries the last authoritative lifecycle state, and omits
model/thinking. If upstream never resolved an agent, `agent` also remains absent
rather than becoming a placeholder. The fallback contains no task or result
content. After final authoritative rows and all required fallbacks append
successfully, the closure seal appends; an append failure leaves the seal absent
and the inventory recoverably open on reload.

The key for exact-tuple deduplication is a fixed-position serialization of:

```text
kind + originating toolCallId + run/workflow identity + child identity
+ state? + agent? + model? + thinking? + unresolved? + inventoryClosed?
```

Earlier entries are immutable. A changed metadata or lifecycle tuple appends a
new entry rather than replacing prior output.

## Correlation state machine

### Direct single-child calls

1. On each `subagent` update or result with `details.mode === "single"`,
   validate the upstream run identity.
2. For each valid `SingleResult`, identify the child by `(runId, index)` and use
   the lifecycle event's launch tool-call ID as its parent.
3. Preserve optional metadata exactly as upstream reports it. Derive terminal
   lifecycle only from explicit upstream result fields such as stopped,
   interrupted, rejection, and exit status; unknown lifecycle remains absent.
4. For a structured async single launch with an empty result array, append one
   pending identity-only entry and retain that child under the authoritative
   async run ID. This cardinality comes from the structured single-child
   surface, not arbitrary arguments.
5. Inspect direct completion only in the documented `details.completions[*]`
   slot and correlate it by run ID. A valid completion with exactly one child
   projection may enrich only the already-inventoried `(runId, index 0)` child;
   its array position never creates identity. If the completion has no valid
   canonical agent tuple, append one unresolved fallback for the retained child
   and release the run.

### Workflow calls

1. Inspect only the documented summary slots: `details.workflowChildren` and
   `details.completions[*].workflowChildren`. Do not recursively search result
   objects.
2. Validate summary version, identifiers, lifecycle enums, optional metadata,
   unique child IDs, row count, and parent/run consistency before mutation.
3. Key each child by `(parentToolCallId, workflowRunId, childId)`. Ignore
   flattened `details.results` for workflow correlation.
4. Treat inventory as open while `inventoryComplete === false` and the workflow
   is nonterminal. New dynamic children may be added, but no unresolved fallback
   is emitted.
5. Append each new metadata tuple and each changed lifecycle tuple. A child may
   therefore have pending, running, and terminal observations without losing
   history.
6. When inventory closes, process the final rows first. For every inventoried
   child that never had canonical agent metadata, append one unresolved
   fallback. After every required fallback succeeds, append the deterministic
   workflow-only `inventoryClosed: true` seal, then release volatile parent
   state.
7. A closed inventory cannot add or remove a previously observed child. A
   contradictory later summary fails closed rather than reopening inventory or
   guessing identity.

Completed, failed, paused/detached, stopped, and rejected children remain
separate rows because their stable child IDs never collapse. A failed or stopped
workflow closes inventory only when upstream sets `inventoryComplete` or uses a
terminal state whose v1 contract guarantees closure.

### Session reload and append failure

On `session_start`, the extension will validate existing
`patchmill-subagent-progress` entries from the active session to restore tuple
deduplication, run-to-parent mappings, and the session entry count. A persisted
`inventoryClosed: true` seal reconstructs closed workflow fingerprints; without
that seal, including when only some unresolved fallbacks persisted, workflow
inventory remains active and recoverable. Invalid legacy or malformed entries do
not become correlation state, but all matching custom entries still count toward
the session ceiling so reload cannot bypass it.

As today, `appendEntry()` happens before in-memory state records a tuple. A
failed append retains the original cause behind the stable Patchmill append
error, leaves the tuple retryable, and does not release terminal state before
all required fallbacks and the closure seal persist.

## Exact-session observation and pipeline behavior

`sessionEntryToObservations()` will recognize only custom entries whose
`customType` is exactly `patchmill-subagent-progress`. It will revalidate the
persisted union and emit:

```ts
{ type: "subagent-progress", progress: PersistedSubagentProgress }
```

Malformed, unsupported, or over-limit custom entries produce no observation and
expose none of their discarded data. The exact observation streamer already
reads only the parent path allocated by `runPiPrompt()`, so matching entries in
sibling, child, stale, or nested session files remain invisible. The streamer
will also suppress duplicate persisted tuple keys defensively.

The exact parent-session streamer retains its per-session set of observed Pi
tool-call IDs, so `createStepAccounting()` receives one ordinary `tool-call`
observation per ID. A `subagent-progress` observation never increments
`toolCalls`. Thus:

- one launch call is one unit even if it owns many children;
- status and wait calls each remain their own real parent tool units;
- repeated result observations and child transitions add no units; and
- output-token accounting is unchanged.

The implementation-stage observer will call the existing todo refresh path for
both `tool-call` and `subagent-progress`. This lets a persisted child update
advance the active implementation task before a foreground workflow returns or
an async workflow completes. Planning and development-environment stages merely
record the new debug observation.

All custom entries remain Pi `custom` entries, not `custom_message` entries, so
Pi excludes them from LLM context. Run-once may record the bounded projection in
its progress JSONL, as it does for other observations; it never records the
upstream source result through this path.

## Limits and failure behavior

Retain the existing generous ceilings and add explicit limits for the new
contract:

- 256 active originating parents;
- 1,024 children per parent and 4,096 active children per session;
- 1,024 rows per upstream result or workflow summary;
- 32 emitted transitions per child;
- 16,384 active tuple keys;
- 65,536 matching custom entries per Pi session;
- non-negative safe integer direct indexes;
- 1,024 UTF-16 code units for direct parent tool-call IDs;
- 256, 512, and 128 UTF-16 code units for direct agent, model, and thinking
  strings respectively;
- 256 UTF-8 bytes for workflow parent tool-call IDs, workflow run IDs, agents,
  and models;
- 32 UTF-8 bytes for workflow thinking strings; and
- the upstream workflow child-ID pattern: 1–128 ASCII letters, digits, dots,
  underscores, or hyphens, starting with a letter or digit.

No accepted value is truncated. Oversized containers and state ceilings raise
the stable limit error before mutation. Malformed individual metadata fields
remain absent when identity is still valid; malformed required identities or
unsupported versions invalidate their row or summary. Raw rejected values are
never logged.

## Affected components

- `src/pi/subagent-progress.ts`
  - define the versioned safe projection, upstream summary parser, persisted
    entry parser, lifecycle normalization, tuple keys, and limits.
- A new focused correlation module under `src/pi/`
  - own direct/workflow parent state, deduplication, async retention, inventory
    closure, session restoration, and fallback generation.
- `src/pi/extensions/run-once-subagent-progress.ts`
  - remain a thin Pi adapter for `subagent` and `subagent_wait` lifecycle
    updates/results plus `session_start` restoration and `appendEntry()`.
- `src/cli/commands/run-once/pi-session-stream.ts`
  - add bounded custom-entry parsing and the `subagent-progress` observation,
    while preserving exact-file ownership and parent tool-call deduplication.
- `src/cli/commands/run-once/pipeline-progress.ts`
  - preserve one accounting unit per parent tool-call ID and record child
    progress without incrementing it.
- `src/cli/commands/run-once/pipeline-implementation.ts`
  - refresh implementation todos on subagent progress as well as tool calls.
- `scripts/verify-pi-subagents-child-metadata.mjs`
  - replace removed legacy task/chain fixtures with the current structured
    single-child and `workflowScript` contract matrix.
- Existing extension-load, packed-artifact, Nix-install, run-once, and pipeline
  tests
  - cover the new module import and production wiring without changing profile
    ordering or loading the observer in triage.

## Verification strategy

These tests pass Patchmill's Testing Value Gate because they protect runtime
correlation, async lifecycle behavior, accounting, parser limits, and the data
boundary rather than restating configuration.

### Pure parser and correlation tests

Cover:

- direct run ID plus non-positional `SingleResult.index` correlation;
- two workflow children whose flattened result indexes are both zero;
- `runs.run`, `runs.all`, sequential, and dynamically appearing child summaries;
- foreground and async summaries, including status and completion replay slots;
- pending, running, completed, failed, paused/detached, stopped, and rejected
  lifecycle transitions;
- exact duplicate suppression and changed metadata/lifecycle append behavior;
- no fallback while dynamic inventory is open;
- exactly one unresolved fallback per closed child without agent metadata;
- missing optional metadata remaining absent;
- append failure retry and session reload restoration; and
- every parent, child, transition, entry, identifier, and metadata limit.

Fixtures will include forbidden task, prompt, output, message, credential,
argument, path, and unrestricted metadata fields and prove none survive
serialization.

### Exact-session and production wiring tests

Add focused `sessionEntryToObservations()` tests for valid, malformed,
duplicate, over-limit, wrong-type, and secret-bearing custom entries.

A production `runPiPrompt()` test will append a real custom entry to the exact
allocated parent JSONL while its mock Pi process is still pending and assert
that `onObservation` receives `subagent-progress` before terminal completion. A
matching entry written to a newer sibling or nested JSONL must not be seen. This
covers the production facade, not only parser fixtures.

### Pipeline tests

Add a run-once implementation scenario in which multiple children and metadata
transitions share one originating launch tool-call ID. Assert that:

- the first custom progress entry refreshes todos and switches the active task
  before Pi returns;
- every child remains independently present in debug observations;
- the completed step reports one tool call for the launch, not one per child or
  transition; and
- real later status/wait calls count once under their own IDs.

### Layout and full verification

Keep source, compiled, npm-packed, and Nix-installed extension-load checks. If a
new correlation module is imported by the observer, compiled-layout staging and
installed file assertions must include it. No dependency or lockfile change is
planned.

Implementation verification should include:

```sh
node --test \
  src/pi/subagent-progress.test.ts \
  src/pi/extensions/run-once-subagent-progress.test.ts \
  src/pi/extensions/run-once-subagent-progress.runner.test.ts \
  src/cli/commands/run-once/pi.test.ts \
  src/cli/commands/run-once/pipeline-progress.test.ts \
  src/cli/commands/run-once/pipeline-progress-scenarios.test.ts
npm test
npm run lint
node scripts/smoke-packed-artifact.mjs
nix build .#patchmill --no-link --print-build-logs
nix flake check --print-build-logs
```

The existing installed dependency contract must still resolve exactly
`pi-subagents` 0.57.0 and load its declared extension. The live child-metadata
verification should be updated from removed legacy task/chain inputs to the
current structured single-child and `workflowScript` matrix when implementation
planning defines its credentialed cases.

## Acceptance mapping

| Acceptance criterion                                     | Design response                                                                                                                                                         |
| -------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Structured foreground and async single-child correlation | Direct identity is `(originating toolCallId, runId, SingleResult.index)`; async single retains one run-scoped pending child and falls back only at terminal completion. |
| Equal workflow result indexes remain independent         | Workflow identity uses `(parentToolCallId, workflowRunId, childId)` and ignores flattened indexes.                                                                      |
| Current workflow execution shapes                        | The v1 summary is consumed for `runs.run`, `runs.all`, sequential, dynamic, foreground, async, failed, and stopped cases.                                               |
| No early dynamic async fallback                          | Fallback generation is gated by closed authoritative inventory.                                                                                                         |
| One fallback per unresolved inventoried child            | Session-restored per-child state records one immutable `unresolved: true` tuple at closure.                                                                             |
| Duplicate suppression and changed observations           | Fixed-position full-tuple keys suppress exact repeats; metadata/lifecycle changes append.                                                                               |
| One parent tool accounting unit                          | Only deduplicated ordinary `tool-call` observations increment `toolCalls`; child progress does not.                                                                     |
| Early implementation-todo refresh                        | `subagent-progress` invokes the existing refresh path before terminal result handling.                                                                                  |
| Exact parent session only                                | Production continues to use the exact allocated parent JSONL; sibling and nested files are never scanned.                                                               |
| Bounded data boundary outside LLM context                | Strict allowlists and limits produce Pi `custom` entries containing only correlation, lifecycle, optional runtime metadata, and unresolved markers.                     |
| Production wiring covered                                | A `runPiPrompt()` test streams a custom child entry before its mocked process completes.                                                                                |
