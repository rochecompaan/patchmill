# Run-once subagent model and thinking output design

**Issue:** #116 **Date:** 2026-07-25 **Status:** Approved

## Context

Patchmill's run-once console reporter currently summarizes subagent execution
calls using only the requested role:

```text
🤖 subagent (agent=reviewer)
🤖 subagent (agent=worker)
```

That output hides which model and thinking level `pi-subagents` resolved for a
child. Operators therefore cannot confirm role-specific runtime configuration
while an automated run is in progress.

Pi exposes the original subagent arguments through `tool_execution_start` and
`tool_call`. Those arguments are insufficient because normal calls commonly
contain only an agent name and task. Model and thinking defaults are resolved
inside `pi-subagents`, after the call is accepted.

Pi also exposes `tool_execution_update` with the tool's partial result and
`tool_execution_end` with its final result. The `pi-subagents` partial and final
result details contain one result per child, including the resolved model. A
resolved model may encode its thinking level as a known suffix, for example
`openai-codex/gpt-5.6-terra:high`.

## Goals

- Show the resolved child model and thinking level in run-once console output
  for foreground direct, parallel, and chain subagent calls.
- Preserve near-live progress by observing partial tool results instead of
  waiting exclusively for completion.
- Render one independent visible line per requested child, including children
  that fail before resolved model metadata appears.
- Preserve agent-only summaries for effective async starts because the pinned
  `pi-subagents` version exposes no resolved child models in those start
  results.
- Use values emitted by `pi-subagents` rather than independently reproducing its
  configuration and fallback precedence.
- Avoid adding subagent tasks, output, or tool-result content to the parent LLM
  context.
- Retain normal formatting for subagent management calls.

## Non-goals

- Changing Pi or `pi-subagents` model selection, thinking selection, or fallback
  behavior.
- Changing the interactive `pi-subagents` TUI.
- Adding model or thinking fields to the public `subagent` tool schema.
- Changing triage progress output or delaying its current near-live tool-call
  delivery.
- Showing task prompts, child output, credentials, costs, or complete result
  metadata in the run-once progress line.
- Updating npm dependencies.

## Selected approach

Add a Patchmill-owned Pi extension that bridges live subagent result metadata
into the persisted Pi session. Patchmill's existing session streamer will turn
those extension entries into progress observations, and the console reporter
will render the requested output.

Two alternatives were considered and rejected:

- **Completion-time parsing of the final toolResult message.** The final
  `toolResult` message already persists `details.results` with resolved models,
  so this would avoid the extension entirely. It was rejected because issue #116
  is specifically about _progress_ output: foreground worker and reviewer
  children routinely run for minutes, and a completion-time design shows nothing
  while they run. Near-live visibility was confirmed as a requirement during
  interactive planning. The extension exists solely to serve that requirement;
  the final toolResult remains as the `tool_execution_end` fallback path.
- **Resolving local settings at tool-call time.** Rejected because it would
  duplicate `pi-subagents` agent, override, model, thinking, and fallback
  precedence rules and could drift from upstream behavior.
- **Emitting both lines.** Print the agent-only line immediately, then print
  enriched per-child lines as metadata resolves. This deletes the streamer's
  buffer/replay machinery but adds a redundant line to every call: the run-once
  console is a terse operator dashboard, the call summary is a strict subset of
  the enriched line that typically arrives seconds later with the first partial
  update, and subagent calls are frequent enough that the duplicate noise
  obscures other tool output. Suppression until the outcome is known was
  confirmed as an operator requirement during interactive planning; the
  buffer/replay fallback is the price of that requirement and guarantees the
  call never vanishes.

## Architecture

### Subagent progress extraction

Create `src/pi/subagent-progress.ts` as the pure boundary around the external
result shape. It will:

- validate that a partial or final tool result contains `details.results`;
- Extract each child's stable index, agent name, model, and optional explicit
  thinking value;
- prefer `progress.index` from `pi-subagents` results and use the result-array
  position only as a compatibility fallback;
- split known thinking suffixes from model strings;
- remove only the leading provider segment from the displayed model (the portion
  before the first `/`) while preserving nested model-ID segments;
- accept Pi thinking levels `off`, `minimal`, `low`, `medium`, `high`, `xhigh`,
  and `max`;
- reject model strings that normalize to an empty display ID;
- build collision-safe structured deduplication keys;
- define and validate the custom session-entry payload;
- inventory requested children from direct, repeated-task, sequential-chain, and
  chain-parallel public call shapes in pinned result-index order.

When a child result ever carries both an explicit thinking field (a possible
future `pi-subagents` addition) and a known model suffix, the suffix wins —
matching `pi-subagents`' own `applyThinkingSuffix()`, which leaves an
already-suffixed model untouched, and its display formatting, which prefers the
suffix. An explicit field is used only when the model carries no known suffix.
When neither is present, `thinking` is omitted from the payload rather than
guessed: in the pinned `pi-subagents`, thinking reaches the child only through
the model suffix, which `applyThinkingSuffix()` deliberately omits for `off` and
unset levels, so a parent-side fallback such as `pi.getThinkingLevel()` can
report a level the child was never launched with. Thinking is therefore
displayed only when it is determinable from the child's own result metadata.

`progress.index` is present only on partial (running) snapshots; completed
results are compacted and strip `progress`, so completion extraction uses the
result-array position. Both values derive from task order, so a child's partial
and final tuples share one deduplication key.

Requested-child inventory mirrors only `pi-subagents`' public execution-shape
expansion: a direct call contributes one child; `tasks` entries expand accepted
`count` values in task order; and chain sequential and parallel leaves flatten
into the executor's global child-index order. It does not resolve profiles,
agents, models, thinking, defaults, or effective async mode. Management calls
produce no inventory, and malformed or conflicting shapes remain unknown rather
than being guessed.

### Pi observer extension

Create `src/pi/extensions/run-once-subagent-progress.ts`. The extension will be
small and lifecycle-focused:

1. Clear its in-memory deduplication set at `session_start`.
2. Listen for `tool_execution_update` events whose tool name is `subagent`.
3. Convert every valid child result into a normalized progress payload.
4. Append one non-context custom entry for every new child/model/thinking tuple.
5. Listen for `tool_execution_end` and repeat extraction as a completion
   fallback.

The custom entry will use this contract:

```json
{
  "type": "custom",
  "customType": "patchmill-subagent-progress",
  "data": {
    "toolCallId": "call-123",
    "childIndex": 0,
    "agent": "reviewer",
    "model": "gpt-5.6-sol",
    "thinking": "xhigh"
  }
}
```

Pi supplies the outer `type`, entry identifiers, parent link, and timestamp when
the extension calls `pi.appendEntry()`. Custom entries are persisted for the
session streamer but do not participate in LLM context. `thinking` is omitted
from `data` when the child's own result metadata cannot determine it.

The deduplication key consists of tool call ID, stable child index, agent,
model, and thinking. Repeated updates for the same child therefore produce one
line. If a fallback launches the child with a different model or thinking tuple,
the new tuple produces another truthful launch line instead of leaving stale
output.

### Run-once resource profiles

Modify `src/pi/resource-profiles.ts` so all run-once profiles load the observer
extension after `pi-subagents`. Planning, development-environment, and
implementation sessions can all invoke subagents and must expose consistent
progress. Triage remains unchanged.

The observer is first-party Patchmill code, so it lives under
`src/pi/extensions/` — inside the eslint, tsc, and test-discovery globs — rather
than in `extensions/`, which holds vendored third-party code outside those
globs. The two extension homes now exist deliberately. The profile loads the
observer as `<package-root>/src/pi/extensions/run-once-subagent-progress.ts`: Pi
loads extensions through jiti, so TypeScript sources work without compilation,
and `package.json` ships the `src/` tree.

`PATCHMILL_PACKAGE_ROOT` currently derives from `import.meta.url` with a fixed
`../..`, which resolves to `<pkg>/dist` in the compiled layout — a pre-existing
bug that already mis-resolves `extensions/todos.ts` in production, where Pi's
loader logs the failure and continues without the extension. Replace it with a
walk-up search for the nearest ancestor directory containing `package.json`,
which resolves correctly from both `src/pi/` and `dist/src/pi/` and fixes both
extension paths.

### Session observation

Extend `src/cli/commands/run-once/pi-session-stream.ts` with a dedicated
subagent-resolution observation. Only a `custom` entry with the exact
`patchmill-subagent-progress` type and a valid payload becomes this observation.
Other custom entries continue to be ignored.

The shared streamer exposes an explicit policy. Immediate pass-through is the
default and preserves triage's current near-live tool-call delivery. Run-once
opts into enrichment buffering. Generic tool-call-ID deduplication remains
active in both policies.

In enriched mode, the gate inventories every recognized subagent execution shape
and buffers the parent call regardless of submitted `async` or `clarify` fields.
A custom progress observation marks only its matching child resolved, emits
near-live, and leaves unresolved siblings pending. On the explicit
`completed: true` toolResult signal, the gate emits one synthetic, agent-only
fallback for each unresolved child in index order. Streamer shutdown invokes the
same flush path after the final poll so a killed or incomplete Pi process cannot
strand pending calls. Synthetic fallbacks contain only `agent`; they do not copy
task text or other call arguments.

Buffering every execution shape deliberately avoids reproducing `pi-subagents`'
effective-mode precedence (`forceTopLevelAsync`, submitted `async`, configured
`asyncByDefault`, and `clarify`). A foreground result produces authoritative
custom metadata. An effective async start produces no such metadata, so its fast
toolResult flushes the existing agent-only summary. Management and malformed
calls pass through immediately.

No task text, child output, generic tool-result content, or arbitrary custom
entry data will be forwarded. The extension's end entry is expected to precede
the toolResult in pinned Pi's JSONL ordering; if that invariant reverses, a safe
fallback may precede a later enriched line, but the call is never silent.

`pi-session-stream.ts` is already a large module, so the stateful
buffer/resolve/flush logic remains a focused exported gate with synchronous unit
tests, while the polling loop only dispatches observations into it. External
result validation, record validation, model normalization, and public
child-shape inventory remain in `src/pi/subagent-progress.ts`; a broader
stream-module refactor is unrelated to issue #116 and remains out of scope.

Run-once step accounting remains parent-level: all resolved, changed, and
fallback child observations sharing one `toolCallId` contribute one `toolCalls`
unit. ID-less ordinary tool-call observations retain existing counting
semantics.

### Console rendering

Modify `src/cli/commands/run-once/console-progress.ts` to render each normalized
observation as:

```text
🤖 subagent (agent=reviewer, model=gpt-5.6-sol, thinking=xhigh)
```

Parallel foreground calls produce one line per child:

```text
🤖 subagent (agent=worker, model=gpt-5.6-terra, thinking=medium)
🤖 subagent (agent=reviewer, model=gpt-5.6-sol, thinking=xhigh)
```

A resolved child no longer also emits the old agent-only summary. Each child
whose model metadata never arrives receives one task-free, agent-only fallback
at completion or shutdown, including unresolved siblings in mixed-result
parallel calls. When a child's thinking level is not determinable from its own
result metadata, the `thinking` segment is omitted from the enriched line rather
than guessed. Effective async starts return `details.results: []` from the
pinned `pi-subagents` version and therefore retain one agent-only summary.
Subagent management calls, such as `subagent(action=list)`, continue through
normal tool-call formatting.

## Data flow

```text
pi-subagents child update
  -> Pi tool_execution_update
  -> Patchmill observer extension
  -> non-context custom session entry
  -> Pi session JSONL
  -> Patchmill session streamer
  -> subagent-resolution observation
  -> run-once console reporter
  -> enriched operator output
```

`tool_execution_end` follows the same path when no usable partial update was
observed or when a fallback changes the resolved tuple.

## Error handling

- Events for tools other than `subagent` are ignored.
- Missing, non-object, or malformed result details are ignored without throwing.
- Invalid child entries are skipped independently so one malformed child does
  not hide valid parallel siblings.
- Repeated partial and final results are deduplicated.
- Malformed external lifecycle payloads are treated as absent metadata and do
  not interrupt the parent Pi run.
- The completion hook supplies a second chance when partial updates are absent.
- The toolResult branch marks its `tool-call` observation with
  `completed: true`. The gate flushes per-child residual fallbacks only for that
  explicit completion signal or streamer shutdown, rather than inferring
  completion from missing arguments.
- A resolved child clears only its matching inventory item; unresolved parallel
  and chain siblings remain pending and each receive their own fallback.
- Unknown model suffixes remain part of the model ID rather than being
  misreported as a thinking level.
- Nonempty malformed session JSON and non-record JSON entries fail loudly.
  Background polling captures its first parsing or I/O error and `stop()`
  propagates it; shutdown flushing still runs, and simultaneous failures are
  preserved in an `AggregateError`.
- Process timeouts, spawn failures, package-root failures, and extension-load
  diagnostics fail their owning verification rather than being ignored.
- A thinking level is never inferred from the parent session; when the child's
  own metadata does not determine one, the `thinking` segment is omitted.

## Security and privacy

The custom entry contains only the tool call identifier, child index, agent,
model ID, and thinking level. Synthetic unresolved-child observations contain
only the parent tool call identifier and agent. Both paths exclude tasks,
prompts, output, provider credentials, usage details, artifact paths, and error
content. Using a custom entry rather than a custom message keeps the resolved
observation out of LLM context.

## Testing strategy

This change passes Patchmill's Testing Value Gate because it modifies production
event handling, validates external data, and changes operator-visible behavior.

### Automated tests

- `src/pi/subagent-progress.test.ts`
  - removes only the leading provider from nested model IDs and parses known
    thinking suffixes;
  - honors a separate explicit thinking field;
  - omits thinking when the child's metadata cannot determine it;
  - uses stable `progress.index` values for out-of-order partial results;
  - extracts multiple parallel child results;
  - inventories direct, counted tasks, sequential chain steps, and counted
    chain-parallel leaves in pinned child-index order;
  - rejects empty normalized models, arrays, conflicting execution shapes, and
    malformed result and custom-entry data;
  - builds collision-safe stable tuple keys.
- `src/pi/extensions/run-once-subagent-progress.test.ts`
  - registers the expected Pi event handlers;
  - appends one custom entry per child on the first usable update;
  - deduplicates repeated updates and final results;
  - uses the end event as a fallback;
  - emits a changed fallback tuple;
  - resets state on session start;
  - ignores unrelated tools.
- `src/cli/commands/run-once/pi.test.ts`
  - verifies all run-once extensions are forwarded before `-p` without
    positional-index assertions;
  - updates both existing toolResult-observation expectations for the explicit
    `completed: true` contract.
- `src/pi/resource-profiles.test.ts`
  - updates the exact `profileExtensionArgs()` expectation for all three
    extension paths and their order;
  - verifies every run-once profile includes the observer, triage excludes it,
    package roots resolve from source/dist layouts, and every source-tree
    extension path exists.
- `src/cli/commands/run-once/pi-session-stream.test.ts`
  - converts valid custom entries into subagent-resolution observations;
  - ignores malformed and unrelated custom entries;
  - marks toolResult observations with the `completed` completion signal;
  - defaults to immediate pass-through and buffers only when run-once opts in;
  - emits every resolved child plus one agent-only fallback for each unresolved
    direct, task, or chain child;
  - emits changed tuples without resolving a child twice;
  - deduplicates repeated progress entries across file re-reads;
  - uses authoritative result behavior for submitted async/clarify shapes rather
    than guessing effective mode;
  - flushes pending children on shutdown;
  - propagates malformed JSON parsing failures.
- `src/cli/commands/triage/tool-call-observer.test.ts`
  - proves triage receives an assistant subagent call before any toolResult is
    written.
- `src/cli/commands/run-once/pipeline-progress.test.ts`
  - counts one parent invocation across multiple resolved, changed, and fallback
    child observations sharing a `toolCallId`.
- `src/cli/commands/run-once/console-progress.test.ts`
  - asserts the exact requested output, including separate lines for parallel
    children;
  - omits the `thinking` segment when it is not determinable;
  - leaves every existing tool-call rendering test untouched, including
    management-call formatting.
- `src/pi/extensions/run-once-subagent-progress.load.test.ts`
  - resolves Pi through the canonical `src/cli/pi-cli.ts` helper, then
    smoke-verifies that the bundled CLI loads the vendored `extensions/todos.ts`
    and the multi-file TypeScript observer (including its relative
    `../subagent-progress.ts` import) and fails only at the expected
    invalid-provider stage;
  - runs the synchronous child with a process-level timeout, isolated working
    directory, temporary HOME/XDG/Pi-agent paths, no session, and ambient Pi
    resource discovery disabled.

### Direct verification

Run focused tests during implementation, followed by:

```sh
npm test
npm run lint
npm run build
git diff --check
npm pack --dry-run
nix build .#patchmill --no-link --print-build-logs
```

The package dry-run must show both
`src/pi/extensions/run-once-subagent-progress.ts` and
`src/pi/subagent-progress.ts`. The dry-run alone proves nothing about path
resolution, so also install the packed tarball into a temporary directory and
assert every run-once profile extension path exists on disk, cleaning both the
temporary install and generated tarball even on failure. Although no dependency
change triggers the repository's mandatory Nix rule, the design depends on the
Nix-installed source layout. Extend `nix/package.nix`'s install check to import
the profile from `$out/share/patchmill`, assert the two new source files exist,
and verify every resolved extension path exists; then build the real
`.#patchmill` package target.

## Acceptance criteria

- A resolved reviewer invocation renders
  `🤖 subagent (agent=reviewer, model=<model>, thinking=<level>)`.
- A resolved worker invocation renders
  `🤖 subagent (agent=worker, model=<model>, thinking=<level>)`.
- Only the leading provider segment and a known thinking suffix are removed;
  nested model-ID segments remain intact.
- Direct, repeated-task, sequential-chain, and chain-parallel calls render one
  visible line per requested child.
- Repeated partial/final updates do not duplicate an unchanged tuple.
- A changed fallback tuple is reported rather than hidden.
- Completion and streamer shutdown emit one task-free, agent-only fallback for
  each unresolved child, including mixed-success siblings.
- Every per-child progress observation for one call is rendered; a second child
  or a changed fallback tuple is never swallowed.
- The `thinking` segment appears only when determinable from the child's own
  result metadata; it is never inferred from the parent session.
- A resolved child does not also emit the previous agent-only line.
- Effective async starts retain one agent-only summary without duplicating
  upstream mode precedence.
- Triage receives subagent calls immediately and never opts into run-once
  buffering.
- Subagent management calls retain normal tool-call output.
- Custom progress entries and synthetic fallbacks contain no task or child
  output and do not add content to the parent LLM context.
- Parent `toolCalls` accounting remains one unit per `toolCallId`.
- Malformed hook payloads are ignored at the external-data boundary, while
  malformed session JSON, I/O, process timeout/spawn, package-root, and
  extension-load failures propagate.
- Focused tests, the full test suite, lint, build, diff checks, source/npm
  package verification, and the Nix package build pass.
