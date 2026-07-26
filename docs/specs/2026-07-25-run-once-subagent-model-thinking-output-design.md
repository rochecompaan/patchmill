# Run-once subagent model and thinking output design

**Issue:** #116
**Date:** 2026-07-25
**Status:** Approved

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
- Render one independent line per child in parallel foreground subagent calls.
- Preserve existing agent-only summaries for `async: true` calls because the
  pinned `pi-subagents` version does not expose resolved child models in those
  tool-result details.
- Use values emitted by `pi-subagents` rather than independently reproducing
  its configuration and fallback precedence.
- Avoid adding subagent tasks, output, or tool-result content to the parent LLM
  context.
- Retain normal formatting for subagent management calls.

## Non-goals

- Changing Pi or `pi-subagents` model selection, thinking selection, or fallback
  behavior.
- Changing the interactive `pi-subagents` TUI.
- Adding model or thinking fields to the public `subagent` tool schema.
- Changing triage progress output.
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
  so this would avoid the extension entirely. It was rejected because issue
  #116 is specifically about *progress* output: foreground worker and reviewer
  children routinely run for minutes, and a completion-time design shows
  nothing while they run. Near-live visibility was confirmed as a requirement
  during interactive planning. The extension exists solely to serve that
  requirement; the final toolResult remains as the `tool_execution_end`
  fallback path.
- **Resolving local settings at tool-call time.** Rejected because it would
  duplicate `pi-subagents` agent, override, model, thinking, and fallback
  precedence rules and could drift from upstream behavior.

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
- remove a provider prefix from the displayed model by retaining the portion
  after the final `/`;
- accept Pi thinking levels `off`, `minimal`, `low`, `medium`, `high`, `xhigh`,
  and `max`;
- build stable deduplication keys;
- define and validate the custom session-entry payload.

When a child result ever carries both an explicit thinking field (a possible
future `pi-subagents` addition) and a model suffix, the explicit field wins;
otherwise a known suffix on the resolved model is authoritative because it is
the exact model argument used to launch that child. When neither is present,
`thinking` is omitted from the payload rather than guessed: in the pinned
`pi-subagents`, thinking reaches the child only through the model suffix,
which `applyThinkingSuffix()` deliberately omits for `off` and unset levels,
so a parent-side fallback such as `pi.getThinkingLevel()` can report a level
the child was never launched with. Thinking is therefore displayed only when
it is determinable from the child's own result metadata.

`progress.index` is present only on partial (running) snapshots; completed
results are compacted and strip `progress`, so completion extraction uses the
result-array position. Both values derive from task order, so a child's
partial and final tuples share one deduplication key.

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
line. If a fallback launches the child with a different model or thinking
tuple, the new tuple produces another truthful launch line instead of leaving
stale output.

### Run-once resource profiles

Modify `src/pi/resource-profiles.ts` so all run-once profiles load the observer
extension after `pi-subagents`. Planning, development-environment, and
implementation sessions can all invoke subagents and must expose consistent
progress. Triage remains unchanged.

The observer is first-party Patchmill code, so it lives under
`src/pi/extensions/` — inside the eslint, tsc, and test-discovery globs —
rather than in `extensions/`, which holds vendored third-party code outside
those globs. The two extension homes now exist deliberately. The profile loads
the observer as `<package-root>/src/pi/extensions/run-once-subagent-progress.ts`:
Pi loads extensions through jiti, so TypeScript sources work without
compilation, and `package.json` ships the `src/` tree.

`PATCHMILL_PACKAGE_ROOT` currently derives from `import.meta.url` with a fixed
`../..`, which resolves to `<pkg>/dist` in the compiled layout — a pre-existing
bug that already mis-resolves `extensions/todos.ts` in production, where Pi's
loader logs the failure and continues without the extension. Replace it with a
walk-up search for the nearest ancestor directory containing `package.json`,
which resolves correctly from both `src/pi/` and `dist/src/pi/` and fixes both
extension paths.

### Session observation

Extend `src/cli/commands/run-once/pi-session-stream.ts` with a dedicated
subagent-resolution observation. Only a `custom` entry with the exact `patchmill-subagent-progress` type and a
valid payload becomes this observation. Other custom entries continue to be
ignored.

The streamer also owns a completion fallback built on buffering rather than
reconstruction: when a foreground subagent execution call is observed
(assistant tool-call observations carry both `toolCallId` and arguments), the
streamer buffers the original observation instead of emitting it. When an
enriched progress observation arrives for that call, the buffer is dropped.
When the call's toolResult message arrives and no enriched observation was
seen — for example a child whose result carries no `model`, or a whole-call
error with no `details.results` — the streamer replays the buffered original
observation unchanged, and the reporter renders it through the same formatter
main uses today (agent-only for direct/parallel args, the `🔧` argument form
for chain args). This closes the suppress-then-hope gap where a foreground
call could otherwise vanish from output entirely, without adding a second
observation type or reporter-side suppression logic.

No task text, child output, generic tool-result content, or arbitrary custom
entry data will be forwarded.

`pi-session-stream.ts` is already a large module, so this change will add only a
small custom-entry dispatch branch there. External result validation and model
normalization remain in `src/pi/subagent-progress.ts`; a broader stream-module
refactor is unrelated to issue #116 and remains out of scope.

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

Foreground direct, parallel, and chain subagent execution calls will no longer
emit the old agent-only summary because the observer supplies resolved launch
metadata for those calls; if no resolved metadata ever arrives, the streamer
replays the original call summary at completion. When a
child's thinking level is not determinable from its own result metadata, the
`thinking` segment is omitted from the enriched line rather than guessed.
Calls with `async: true` return `details.results: []` from the pinned
`pi-subagents` version and run children out of process; they continue to emit
the existing agent-only summary until resolved metadata is available. Subagent
management calls, such as `subagent(action=list)`, continue through normal
tool-call formatting.

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
- Extension parsing failures must not interrupt the parent Pi run.
- The completion hook supplies a second chance when partial updates are absent.
- The never-vanish replay is triggered by the toolResult message producing a
  duplicate, argument-less `tool-call` observation for an already-seen
  `toolCallId`. If `sessionEntryToObservations` ever stops mapping toolResult
  messages that way, buffered foreground calls would silently never replay;
  the Task 4 streamer tests pin this coupling.
- Unknown model suffixes remain part of the model ID rather than being
  misreported as a thinking level.
- When a child's result carries no usable model metadata, the streamer
  replays the buffered original call summary at completion so the call never
  vanishes from output.
- A thinking level is never inferred from the parent session; when the child's
  own metadata does not determine one, the `thinking` segment is omitted.

## Security and privacy

The custom entry contains only the tool call identifier, child index, agent,
model ID, and thinking level. It excludes tasks, prompts, output, provider
credentials, usage details, artifact paths, and error content. Using a custom
entry rather than a custom message keeps the observation out of LLM context.

## Testing strategy

This change passes Patchmill's Testing Value Gate because it modifies production
event handling, validates external data, and changes operator-visible behavior.

### Automated tests

- `src/pi/subagent-progress.test.ts`
  - parses provider-qualified model IDs and known thinking suffixes;
  - honors a separate explicit thinking field;
  - omits thinking when the child's metadata cannot determine it;
  - uses stable `progress.index` values for out-of-order partial results;
  - extracts multiple parallel child results;
  - rejects malformed result and custom-entry data.
- `src/pi/extensions/run-once-subagent-progress.test.ts`
  - registers the expected Pi event handlers;
  - appends one custom entry per child on the first usable update;
  - deduplicates repeated updates and final results;
  - uses the end event as a fallback;
  - emits a changed fallback tuple;
  - resets state on session start;
  - ignores unrelated tools.
- `src/cli/commands/run-once/pi.test.ts`
  - converts valid custom entries into subagent-resolution observations;
  - ignores malformed and unrelated custom entries;
  - buffers a foreground execution call and replays its original observation
    when the call completes without resolved metadata;
  - emits every per-child progress observation for one call, including a
    changed fallback tuple;
  - never buffers async or management calls.
- `src/cli/commands/run-once/console-progress.test.ts`
  - asserts the exact requested output, including separate lines for parallel
    children;
  - omits the `thinking` segment when it is not determinable;
  - leaves every existing tool-call rendering test untouched, including
    management-call formatting.
- `src/pi/resource-profiles.test.ts`
  - verifies every run-once profile includes the observer extension;
  - verifies triage does not include it;
  - verifies package-root resolution from nested source and dist-style layouts;
  - verifies every resolved extension path exists on disk.
- `src/pi/extensions/run-once-subagent-progress.load.test.ts`
  - smoke-verifies that the bundled Pi CLI loads the multi-file TypeScript
    extension (including its relative `../subagent-progress.ts` import) and
    fails only at the expected invalid-provider stage.

### Direct verification

Run focused tests during implementation, followed by:

```sh
npm test
npm run lint
npm run build
git diff --check
npm pack --dry-run
```

The package dry-run must show both `src/pi/extensions/run-once-subagent-progress.ts`
and `src/pi/subagent-progress.ts`. The dry-run alone proves nothing about path
resolution, so also install the packed tarball into a temporary directory and
assert every run-once profile extension path exists on disk. No dependency
changes are planned, so Patchmill's dependency-triggered Nix build requirement
does not apply.

## Acceptance criteria

- A resolved reviewer invocation renders
  `🤖 subagent (agent=reviewer, model=<model>, thinking=<level>)`.
- A resolved worker invocation renders
  `🤖 subagent (agent=worker, model=<model>, thinking=<level>)`.
- Provider prefixes and known thinking suffixes are not included in the displayed
  model field.
- Parallel foreground calls render one enriched line per child.
- Repeated partial/final updates do not duplicate an unchanged tuple.
- A changed fallback tuple is reported rather than hidden.
- A foreground call whose results carry no usable model metadata still prints
  its original call summary at completion (agent-only for direct/parallel
  args, the `🔧` argument form for chain args).
- Every per-child progress observation for one call is rendered; a second
  child or a changed fallback tuple is never swallowed.
- The `thinking` segment appears only when determinable from the child's own
  result metadata; it is never inferred from the parent session.
- Foreground subagent execution calls do not emit the previous agent-only line
  before resolution.
- Async subagent calls retain an agent-only summary until resolved metadata is
  available.
- Subagent management calls retain normal tool-call output.
- Custom progress entries do not enter LLM context and contain no task or child
  output.
- Malformed hook data does not fail the run.
- Focused tests, the full test suite, lint, build, diff checks, and package
  dry-run pass.
