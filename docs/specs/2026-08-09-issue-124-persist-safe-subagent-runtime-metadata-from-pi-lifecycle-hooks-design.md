# Persist safe subagent runtime metadata from Pi lifecycle hooks design

**Issue:** [#124](https://github.com/rochecompaan/patchmill/issues/124)
**Parent:** [#116](https://github.com/rochecompaan/patchmill/issues/116)
**Dependencies:** #121 and #122, both complete **Status:** Approved design

## Summary

Patchmill will add a small Pi extension that observes authoritative
`pi-subagents` child metadata in parent tool lifecycle events and persists a
strict projection as `patchmill-subagent-progress` custom session entries.
Because the extension calls `pi.appendEntry()` inside the parent Pi process, the
entry lands in the exact active parent session and remains outside LLM context.

The implementation will separate pure validation and projection from Pi event
handling. It will load the observer in every run-once profile, leave triage
unchanged, and prove real extension loading in source, npm-packed, and
Nix-installed layouts with one stable packaged sentinel fixture.

## Goals

- Persist the first valid authoritative partial update before parent tool
  completion when `pi-subagents` emits one.
- Use the terminal tool result as a fallback and suppress exact tuples already
  persisted from partial updates.
- Keep every child independent across sibling indexes and concurrent parent tool
  calls.
- Persist only parent tool-call identity, upstream child identity, agent name,
  and reported model/thinking fields.
- Preserve unknown runtime fields as absent and allow a valid identity-only
  entry.
- Bound accepted identifiers, result batches, metadata transitions,
  deduplication state, and persisted progress entries far above normal
  `pi-subagents` workloads.
- Load the observer in run-once planning, development-environment, and
  implementation profiles.
- Prove that the same observer and its relative import load from source,
  npm-packed, and Nix-installed package layouts.

## Non-goals

This issue will not:

- reproduce agent, model, thinking, provider, override, default, or fallback
  resolution;
- follow Pi session files or use `PI_SESSION_FILE` to find the parent session;
- correlate custom entries into Patchmill observations;
- synthesize requested-child or unresolved-child fallbacks;
- render progress in the console or TUI;
- change stdout/stderr behavior;
- load the observer in triage;
- change the pinned `pi-subagents` dependency; or
- modify `pi-subagents` itself.

## Upstream and Pi contracts

Patchmill relies on the `pi-subagents` 0.39.0 contract adopted by issue #122:

- child rows are available at `result.details.results`;
- each row has a stable non-negative integer `index` assigned by upstream;
- sibling indexes are unique within one foreground run;
- partial and final rows preserve child identity and ordering;
- `agent`, `model`, and `thinking` are reported by upstream; and
- Patchmill must not infer missing values from parent or agent configuration.

The observer uses Pi's documented lifecycle and persistence APIs:

- `tool_execution_update.partialResult` for near-live observations;
- `tool_execution_end.result` for terminal fallback; and
- `pi.appendEntry()` for custom entries that do not participate in LLM context.

The parent `toolCallId` scopes the upstream child index to one parent subagent
invocation. The upstream `runId` is therefore unnecessary for this bridge and is
not allowed in the persisted projection.

`pi-subagents` is a trusted in-process dependency, but Pi exposes lifecycle
result fields as runtime-unknown values. Patchmill guarantees that the observer
copies no properties outside its five-field allowlist. It does not claim that an
allowlisted `agent`, `model`, or `thinking` value is semantically free of
secrets; that guarantee belongs to the trusted upstream producer. Patchmill
still limits every accepted identifier so an upstream bug cannot create an
unbounded projection.

## Architecture

### Pure normalization module

Create `src/pi/subagent-progress.ts` with one responsibility: validate unknown
`pi-subagents` result values and return the safe persisted projection.

Its public surface will be:

```ts
export const SUBAGENT_PROGRESS_CUSTOM_TYPE = "patchmill-subagent-progress";
export const SUBAGENT_PROGRESS_LIMIT_ERROR =
  "PATCHMILL_SUBAGENT_PROGRESS_LIMIT_EXCEEDED";
export const SUBAGENT_PROGRESS_LIMITS = {
  maxToolCallIdCodeUnits: 1024,
  maxAgentCodeUnits: 256,
  maxModelCodeUnits: 512,
  maxThinkingCodeUnits: 128,
  maxResultRows: 1024,
  maxActiveParents: 256,
  maxChildrenPerParent: 1024,
  maxActiveChildren: 4096,
  maxActiveKeys: 16384,
  maxTransitionsPerChild: 32,
  maxEntriesPerSession: 65536,
} as const;

export type SubagentProgress = {
  toolCallId: string;
  childIndex: number;
  agent: string;
  model?: string;
  thinking?: string;
};

export function parseSubagentProgressResults(
  result: unknown,
  toolCallId: string,
): SubagentProgress[];

export function subagentProgressKey(progress: SubagentProgress): string;
```

The module will not import Pi, read files, inspect agent definitions, or retain
unrestricted result objects.

### Thin lifecycle observer

Create `src/pi/extensions/run-once-subagent-progress.ts` with one
responsibility: connect Pi lifecycle events to the pure normalizer and append
unseen entries.

Its default Pi extension factory owns handler registration and exports
`SUBAGENT_PROGRESS_APPEND_ERROR` with the stable value
`PATCHMILL_SUBAGENT_PROGRESS_APPEND_FAILED`. Behavior tests call that default
export, and integration tests load it through Pi's extension loader so a no-op
package entry point cannot pass while an internal helper works. The adapter will
subscribe to:

- `session_start` to reset session-scoped deduplication state;
- `tool_execution_update` to process `partialResult`; and
- `tool_execution_end` to process `result`.

The observer deliberately lives below `src/pi/extensions/`, not the package's
conventional top-level `extensions/` directory. Patchmill will load it only
through run-once resource profiles instead of making it an auto-discovered
package extension.

## Persisted data contract

For every candidate event and row:

1. Require `toolName === "subagent"`.
2. Require a nonblank string `toolCallId` no longer than 1,024 UTF-16 code units
   from the Pi lifecycle event.
3. Require `result`, `result.details`, and each candidate row to be records.
4. Require `result.details.results` to be an array with at most 1,024 rows. A
   larger batch throws `PATCHMILL_SUBAGENT_PROGRESS_LIMIT_EXCEEDED` before any
   row is persisted.
5. Require `row.index` to be a non-negative safe integer.
6. Require `row.agent` to be a nonblank string no longer than 256 UTF-16 code
   units.
7. Include `row.model` only when it is a nonblank string no longer than 512
   UTF-16 code units.
8. Include `row.thinking` only when it is a nonblank string no longer than 128
   UTF-16 code units.

Accepted strings remain verbatim after validation. Patchmill will not remove a
provider prefix, split a model suffix, constrain thinking to a local enum,
truncate a reported identifier, or backfill a missing value. Overlong required
identifiers invalidate their event or row; overlong optional fields remain
absent. The validator checks a string's code-unit ceiling before calling
`trim()`, so an overlong value is rejected without first scanning or copying it
for blankness. These ceilings are deliberately far above the upstream defaults
of eight parallel tasks, concurrency four, and global concurrency twenty.

A valid row with only `index` and `agent` produces an identity-only entry:

```json
{
  "toolCallId": "call-1",
  "childIndex": 3,
  "agent": "worker"
}
```

The projection never reads or copies task, output, prompt, credential, usage,
cost, path, error, message, full-result, event-argument, or other incidental
properties. Invalid rows are ignored individually so one child cannot suppress
valid siblings. This structural guarantee does not inspect the meaning of an
otherwise valid allowlisted identifier supplied by trusted `pi-subagents`.

## Lifecycle, deduplication, and back-pressure

The observer keeps parent state keyed by `toolCallId`, then child state keyed by
upstream `childIndex`. Each child stores its emitted fixed-position JSON tuple
keys and transition count:

```text
(toolCallId, childIndex, agent, model?, thinking?)
```

The key is based on the upstream child index, never the row's array position.
`subagentProgressKey()` will serialize a fixed-position JSON tuple so delimiter
characters and absent optional fields cannot create collisions. Including
`toolCallId` and `childIndex` prevents collisions between concurrent parent
invocations and siblings. Including the complete projection gives these
semantics:

- the first valid partial tuple is appended immediately;
- a repeated partial tuple is suppressed;
- an identical final tuple is suppressed;
- a final tuple that adds or changes authoritative metadata is appended; and
- an identity-only tuple is valid and deduplicates like any other tuple.

Rows are processed in the order upstream supplies them. Existing entries are
never updated, replaced, or deleted. Before allocating or appending state, the
observer enforces these ceilings:

- 256 active parent tool calls;
- 1,024 child indexes for one parent tool call;
- 4,096 active child states across all parents;
- 16,384 active serialized tuple keys;
- 32 persisted transitions for one `(toolCallId, childIndex)`; and
- 65,536 `patchmill-subagent-progress` entries in one Pi session.

Any state or session-entry ceiling breach throws the stable
`PATCHMILL_SUBAGENT_PROGRESS_LIMIT_EXCEEDED` identifier before persistence or
state mutation. The limits are high enough to avoid normal sessions while
providing a finite upper bound when upstream configuration removes its normal
parallelism defaults.

The observer calls `pi.appendEntry()` before recording the key or incrementing
any counter. The append call is the only local translation boundary: if it
throws, the observer rethrows an error whose stable message is
`PATCHMILL_SUBAGENT_PROGRESS_APPEND_FAILED` and retains the original error as
its `cause`. Pi 0.84.1's `ExtensionRunner` catches that handler error and emits
it to `onError`; it does not reject `emit()`. The failed key and counters remain
unchanged, so an equivalent terminal update may retry. The handler stops
processing the current event at the first persistence failure and never logs raw
event data.

`tool_execution_end` is parsed even when the tool reports an error because the
result may still contain valid authoritative child metadata. Parent state is
released only after terminal processing succeeds. If terminal persistence fails,
state remains available for a later equivalent retry.

On `session_start`, the observer clears active deduplication state and counts
existing custom entries with `customType === "patchmill-subagent-progress"` from
`ctx.sessionManager.getEntries()`. Restoring that counter prevents a reload or
resume from bypassing the per-session persistence ceiling. Pi does not replay
completed lifecycle events into the new extension instance.

## Exact parent-session guarantee

The observer runs in the same Pi process and resource profile as the parent
`subagent` tool call. `pi.appendEntry()` writes to that process's active
`SessionManager`, so no session discovery or file correlation is needed.

The custom entry type is `custom`, not `custom_message`. Pi excludes custom
entries from `buildSessionContext()`, which keeps the bounded projection and all
discarded source fields outside the LLM conversation.

## Run-once resource profiles

Update `src/pi/resource-profiles.ts` to resolve the observer from the Patchmill
package root and require it to be a regular file. The shared run-once extension
order will be:

1. resolved `pi-subagents` package root;
2. `extensions/todos.ts`; and
3. `src/pi/extensions/run-once-subagent-progress.ts`.

The following profiles use that list:

- `run-once-planning`;
- `run-once-development-environment`; and
- `run-once-implementation`.

The `triage` profile retains an empty extension list. Existing argument helpers
will render all three paths as ordered `-e` arguments without special cases.

## Stable extension-load sentinel

Create `fixtures/run-once-extension-load-sentinel.ts`. It is a test fixture, not
an auto-discovered extension. Its factory will require the
`PATCHMILL_RUN_ONCE_EXTENSION_SENTINEL` environment variable and write the exact
UTF-8 payload `patchmill-run-once-extensions-loaded\n`, including the final line
feed, to that path.

Every layout smoke test will pass the run-once profile's extension arguments
first and the sentinel fixture last. Reaching the sentinel proves that Pi loaded
`pi-subagents`, todos, the observer, and the observer's relative
`../subagent-progress.ts` import before the probe factory ran.

The checks will use isolated home/config directories and offline RPC mode with
no model execution. The fixture will not register a command, append a session
entry, alter production behavior, or expose a production test flag.

The fixture will be included in both distribution paths without changing their
file lists because npm already includes `fixtures` and the Nix install already
copies that directory. Likewise, both layouts already package `src`, which will
include the observer and normalizer.

## Package-layout verification

### Source layout

A focused Pi load test will resolve the bundled Pi command, load the actual
run-once profile plus the packaged sentinel fixture, close one RPC request, and
assert the exact sentinel payload. A second integration path will load the
observer through Pi's `discoverAndLoadExtensions()`, assert that its default
factory registers all three lifecycle handlers, and exercise append failure plus
final retry through `ExtensionRunner.onError`.

### Compiled layout

The existing compiled resource-profile test will stage the observer and
normalizer source beside the compiled modules. It will assert that all three
run-once extension paths exist and that missing or non-file package-owned
extensions fail during profile import.

### npm-packed layout

`scripts/smoke-packed-artifact.mjs` will use the profile imported from the
installed tarball. It will use the installed Pi loader to assert that the
installed observer's default factory registers all three handlers, then run the
installed Pi binary with those extension paths plus the installed sentinel
fixture and assert the exact payload.

### Nix-installed layout

`nix/package.nix` will extend `installCheckPhase` to verify the observer,
normalizer, and sentinel files under `$out/share/patchmill`. A single-quoted
shell heredoc will carry the JavaScript verification program without shell
rewriting its imports, string literals, or RPC JSON. That program will assert
installed default-factory handler registration, then run Pi from the installed
dependency tree with the installed profile and sentinel fixture and assert the
exact payload.

No new test will merely restate Nix source text or package metadata. The Nix
build itself is the direct installed-layout verification.

## Error handling

- Unrelated tool events are ignored.
- Missing or malformed result containers produce no rows.
- A result array above 1,024 rows throws
  `PATCHMILL_SUBAGENT_PROGRESS_LIMIT_EXCEEDED` before row processing.
- Malformed or overlong rows are skipped without affecting valid siblings.
- Invalid or overlong optional model/thinking fields remain absent on an
  otherwise valid identity entry.
- Raw malformed values and discarded fields are never logged or persisted.
- State and session-entry ceilings throw
  `PATCHMILL_SUBAGENT_PROGRESS_LIMIT_EXCEEDED` before mutation.
- The `appendEntry()` boundary catches only to retain the original `cause` and
  rethrow `PATCHMILL_SUBAGENT_PROGRESS_APPEND_FAILED`; Pi's runner reports that
  stable identifier through `onError` and leaves deduplication counters
  unchanged.
- A future upstream contract change fails closed by producing no unsafe
  projection; Patchmill's exact dependency pin and contract verification remain
  the guard against silent upstream drift.

## Testing strategy

These tests pass Patchmill's Testing Value Gate because they prove reusable
runtime behavior, privacy boundaries, concurrency isolation, lifecycle
fallbacks, and installed extension loading.

### Pure normalizer tests

Cover:

- one and multiple valid rows;
- nonsequential upstream child indexes;
- stable upstream row order;
- identity-only rows;
- optional model and thinking independently;
- verbatim model/thinking preservation;
- malformed roots, details, arrays, and rows;
- blank or invalid parent tool-call IDs;
- unsafe, negative, and missing indexes;
- blank or missing agents;
- invalid optional field types;
- exact accepted identifier boundaries and one-code-unit-over rejection;
- a 1,024-row batch and a 1,025-row stable limit error;
- no fallback to array positions; and
- rows containing secret task, output, prompt, credential, path, usage, and
  unrestricted metadata properties, with serialized projections proven not to
  copy those property values. Tests will not claim that trusted allowlisted
  values are semantically secret-free.

### Observer tests

Initialize the narrow in-memory Pi API harness through the default extension
factory to cover:

- handler registration through the production entry point;
- immediate partial persistence;
- terminal-only fallback;
- exact partial/final duplicate suppression;
- changed authoritative tuples;
- sibling and parent-tool-call isolation;
- valid metadata on failed terminal events;
- session-start dedup reset, persisted-entry count restoration, one successful
  append from 65,535 to 65,536, and rejection of the next distinct tuple;
- unrelated and malformed lifecycle events;
- active-parent, per-parent child, active-child, active-key, per-child
  transition, and per-session entry ceilings;
- state release after successful terminal events; and
- oversized and rapidly changing updates.

Use the default-factory harness to assert that a translated `appendEntry()`
error retains the original failure as `cause`. Use Pi's real extension loader
and `ExtensionRunner` error listener to cover the same append failure's stable
surfaced identifier, unchanged counters, and a successful equivalent terminal
retry; Pi does not expose `cause` through `onError`.

### Wiring and layout tests

Update existing profile, compiled-layout, and run-once Pi argument tests for the
third ordered extension. Add the source load and runner-error tests. Extend the
existing npm packed smoke and Nix install check with both installed
handler-registration assertions and the stable sentinel protocol. The Nix
JavaScript must execute from a single-quoted heredoc rather than an inline shell
double-quoted `-e` payload.

## Verification

Implementation verification will include:

```sh
node --test \
  src/pi/subagent-progress.test.ts \
  src/pi/extensions/run-once-subagent-progress.test.ts \
  src/pi/extensions/run-once-subagent-progress.runner.test.ts \
  src/pi/extensions/run-once-subagent-progress.load.test.ts \
  src/pi/resource-profiles.test.ts \
  src/pi/resource-profiles.compiled.test.ts \
  src/cli/commands/run-once/pi.test.ts
npm test
npm run lint
node scripts/smoke-packed-artifact.mjs
nix build .#patchmill --no-link --print-build-logs
nix flake check --print-build-logs
```

No dependency installation, service startup, or baseline suite is needed while
planning. Those commands belong to implementation verification.

## Acceptance mapping

| Acceptance criterion                       | Design response                                                                                                               |
| ------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------- |
| First partial persists before completion   | Update handler appends each first valid tuple immediately.                                                                    |
| Final fills when partial did not           | End handler uses the same parser and exact-tuple state.                                                                       |
| Children remain independent                | Keys include parent `toolCallId` and upstream child index.                                                                    |
| Unknown metadata stays absent              | Optional fields are allowlisted only when valid; identity-only entries are allowed.                                           |
| Discarded source fields do not leak        | Pure projection reads only five named fields; trusted allowlisted identifier values have an explicit semantic trust boundary. |
| Memory and session growth are bounded      | Generous identifier, batch, parent, child, key, transition, and session-entry ceilings fail loudly before mutation.           |
| Append failures stay visible and retryable | The append boundary rethrows a stable identifier with the original cause; Pi's runner reports it and a final event can retry. |
| Production entry point registers behavior  | Unit tests call the default factory and Pi loader checks assert its three handlers in source, npm, and Nix layouts.           |
| All run-once profiles load observer        | Shared ordered extension list is used by all three run-once profiles.                                                         |
| Triage does not load observer              | Triage retains an empty extension list.                                                                                       |
| Source/npm/Nix layouts load observer       | Each layout runs Pi with the same packaged trailing sentinel fixture.                                                         |
