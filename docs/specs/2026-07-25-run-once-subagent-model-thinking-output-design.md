# Run-once subagent model and thinking output design

**Issue:** #116 **Date:** 2026-07-25 **Status:** Approved

## Context

Patchmill's run-once console reporter currently summarizes subagent execution
calls using only the requested role:

```text
🤖 subagent (agent=reviewer)
🤖 subagent (agent=worker)
```

That output hides the model and thinking metadata `pi-subagents` reports for a
child. Operators therefore cannot inspect role-specific launch metadata while an
automated run is in progress.

Pi exposes the original subagent arguments through `tool_execution_start` and
`tool_call`. Those arguments are insufficient because normal calls commonly
contain only an agent name and task. Model and thinking defaults are resolved
inside `pi-subagents`, after the call is accepted.

Pi also exposes `tool_execution_update` with the tool's partial result and
`tool_execution_end` with its final result. The `pi-subagents` partial and final
result details contain one result per foreground child. An explicitly selected
model is reported immediately; when no model is selected in agent configuration,
0.25.0 fills `result.model` from the first child assistant message. Configured
non-`off` thinking is visible only when 0.25.0 encoded it as a suffix on an
explicit model argument, for example `openai-codex/gpt-5.6-terra:high`.

## Goals

- Show the child model and thinking level reported by `pi-subagents` in run-once
  console output for foreground direct, parallel, and chain calls.
- Preserve near-live progress by observing partial tool results instead of
  waiting exclusively for completion.
- Render one independent visible line per requested child, including children
  that fail before reported model metadata appears.
- Preserve one task-free agent-only fallback per inventoried child for effective
  async starts because pinned 0.25.0 exposes no child results in the start
  response.
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
- Guaranteeing an actual runtime thinking level when pinned 0.25.0 reports no
  thinking suffix or explicit thinking field. That requires a future upstream
  result-contract change; this design never substitutes the parent level or an
  invented fallback.

## Selected approach

Add a Patchmill-owned Pi extension that bridges live subagent result metadata
into the persisted Pi session. Patchmill's existing session streamer will turn
those extension entries into progress observations, and the console reporter
will render the requested output.

Two alternatives were considered and rejected:

- **Completion-time parsing of the final toolResult message.** The final
  `toolResult` message already persists `details.results` with reported models,
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

## Reporting contract limitation

Pinned `pi-subagents@0.25.0` does not expose an independent actual runtime
thinking level. Its child subprocess receives configured thinking only through
the `--model` suffix when an explicit model exists; `off`, unset thinking, and
default-model launches have no reportable level. The approved contract is
therefore deliberately reduced:

- render the model and thinking tuple exactly when `pi-subagents` reports it;
- render the reported model without `thinking` when only model is available;
- render one task-free agent-only fallback per unresolved child when no model is
  available;
- never infer values from the parent session or duplicate upstream resolution.

A future upstream result field could strengthen this contract without changing
the Patchmill transport. Until then, the output is reported launch/runtime
metadata, not a guarantee that every line contains both actual values.

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

Requested-child inventory mirrors pinned execution-mode validation and
result-index expansion. Simultaneous nonempty `chain` and `tasks` arrays are an
invalid conflict and pass through immediately. With exactly one nonempty
aggregate mode, an accompanying `agent` is ignored just as pinned `pi-subagents`
ignores it; otherwise a valid `agent` selects direct mode. Top-level task items
must include the schema-required string `task`; direct tasks remain optional for
self-contained agents. The first sequential chain step needs its own task or the
top-level shared task, the first parallel step needs a task per child, and later
chain steps retain upstream inheritance. The inventory does not resolve
profiles, agents, models, thinking, defaults, or effective async mode.
Management calls and shapes that cannot be safely inventoried pass through
rather than being guessed.

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

Patchmill atomically pre-creates one empty parent JSONL and passes its unique
path to both Pi's explicit `--session` option and the streamer. Pinned Pi
0.80.10 recognizes only an existing path during CLI resolution, then initializes
an empty file with a valid session header in `SessionManager.open()`. Patchmill
never recursively chooses the newest JSONL from a directory, so nested child
sessions, artifacts, and stale files cannot replace or mix with the parent
stream.

`pi-session-file-follower.ts` owns exact-file I/O, sequential line delivery, and
an immediate fatal-error promise. It awaits each line callback before reading
the next line, providing real backpressure instead of accumulating reporter
promises. Because Patchmill pre-creates the path with exclusive-create
semantics, `ENOENT` is fatal; malformed nonempty JSON, non-record JSON, other
I/O failures, and reporter rejection are also fatal.

The shared observation streamer exposes an explicit policy. Immediate
pass-through is the default and preserves triage's current near-live delivery.
Run-once opts into enrichment buffering. The pure gate returns ordered outputs;
the async streamer awaits each output before continuing.

In enriched mode, the gate inventories recognized execution shapes and buffers
the parent call regardless of submitted `async` or `clarify`. A custom progress
observation resolves only its matching child and leaves siblings pending. On
`completed: true` or shutdown, the gate emits one synthetic, task-free
agent-only fallback per unresolved child in index order. Effective async direct,
counted-parallel, and chain calls therefore have the same one-line-per-child
cardinality as foreground calls.

Buffering every valid execution shape avoids reproducing async precedence
(`forceTopLevelAsync`, submitted `async`, configured `asyncByDefault`, and
`clarify`). Request inventory mirrors pinned mode validation: simultaneous
nonempty `chain` and `tasks` conflict, exactly one aggregate mode outranks an
accompanying `agent`, and otherwise `agent` selects direct mode. Management
calls, conflicting aggregate modes, and shapes that cannot be safely inventoried
pass through immediately.

`runPiPrompt()` and triage attach to the follower's fatal promise before
starting it. A stream or async reporter failure aborts the subprocess through
`CommandRunOptions.signal`; owners await process close, stop/flush the streamer,
and then rethrow the sole cause or a recursively flattened `AggregateError`
whose top-level `errors` array contains every runner, streamer, and delivery
cause. No terminal failure masks another.

No task text, child output, generic tool-result content, or arbitrary custom
entry data is forwarded. The extension's end entry is expected to precede the
toolResult in pinned Pi's JSONL ordering; if it reverses, a safe fallback may
precede a later enriched line, but the call is never silent.

The stateful gate stays in `pi-session-stream.ts`; exact-file polling is split
into its own focused module, and external result validation/model normalization
remain in `src/pi/subagent-progress.ts`.

Run-once step accounting remains parent-level: all reported, changed, and
fallback child observations sharing one `toolCallId` contribute one `toolCalls`
unit. Implementation todo-derived progression refreshes on both parent
`tool-call` and `subagent-progress` observations.

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

A child with reported metadata no longer also emits the old agent-only summary.
Each child whose model metadata never arrives receives one task-free, agent-only
fallback at completion or shutdown, including unresolved siblings in
mixed-result calls. When thinking is not determinable, the segment is omitted
rather than guessed. Effective async direct, counted-parallel, and chain starts
return `details.results: []` and therefore emit one agent-only fallback per
inventoried child. Management calls continue through normal tool formatting.

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
observed or when a fallback changes the reported tuple.

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
- A reported child clears only its matching inventory item; unresolved parallel
  and chain siblings remain pending and each receive their own fallback.
- Unknown model suffixes remain part of the model ID rather than being
  misreported as a thinking level.
- Nonempty malformed session JSON, non-record JSON, I/O failures, and async
  reporter rejection fail loudly through the follower's immediate `failure`
  promise. The owner aborts Pi, awaits child close, drains shutdown fallbacks,
  and preserves simultaneous failures in `AggregateError.errors`.
- The owner atomically pre-creates the empty explicit session file; any later
  `ENOENT` is fatal rather than translated to “not ready yet”.
- Process timeouts, spawn failures, package-root failures, and extension-load
  failures remain fatal. Command errors label and preserve stdout and stderr
  separately; final JSON remains stdout-only and progress remains stderr-only.
- A thinking level is never inferred from the parent session; when the child's
  own metadata does not determine one, the `thinking` segment is omitted.

## Security and privacy

The custom entry contains only the tool call identifier, child index, agent,
model ID, and thinking level. Synthetic unresolved-child observations contain
only the parent tool call identifier and agent. Both paths exclude tasks,
prompts, output, provider credentials, usage details, artifact paths, and error
content. Using a custom entry rather than a custom message keeps the reported
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
  - inventories one nonempty aggregate mode before an accompanying agent,
    rejects simultaneous nonempty chain/tasks conflicts, and inventories direct
    agent mode with counted children in pinned result-index order;
  - rejects empty normalized models, arrays, top-level tasks missing the
    schema-required `task`, and malformed result/custom-entry data;
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
  - verifies production `runPiPrompt()` atomically pre-creates and uses a unique
    exact `--session`, enables enrichment, ignores newer nested child JSONL, and
    flushes only unresolved siblings;
  - invokes bundled pinned Pi with a pre-created empty exact session and proves
    Pi initializes a valid session header before the expected invalid-provider
    exit;
  - proves slow observers apply backpressure and simultaneous runner/streamer
    failures are recursively flattened into top-level `AggregateError.errors`.
- `src/pi/resource-profiles.test.ts`
  - updates the exact `profileExtensionArgs()` expectation for all three
    extension paths and their order;
  - verifies every run-once profile includes the observer, triage excludes it,
    package roots resolve from source/dist layouts, and every source-tree
    extension path exists.
- `src/cli/error-causes.test.ts`
  - proves recursive aggregate flattening preserves encounter order and retains
    an empty aggregate as a terminal cause.
- `src/cli/commands/run-once/pi-session-file-follower.test.ts`
  - follows only the exact parent file, awaits line callbacks, and exposes
    missing-file, injected I/O, and callback failures through both `failure` and
    `stop()`.
- `src/cli/commands/run-once/pi-session-stream.test.ts`
  - converts valid custom entries into subagent-resolution observations;
  - ignores malformed and unrelated custom entries;
  - marks toolResult observations with the `completed` completion signal;
  - defaults to immediate pass-through and buffers only when run-once opts in;
  - emits every reported child plus one fallback for each unresolved direct,
    counted-task, or chain child;
  - proves metadata-free effective async direct/parallel/chain completions have
    one fallback per inventoried child;
  - emits changed tuples without resolving a child twice and deduplicates file
    re-reads;
  - deterministically propagates malformed and non-record JSON and preserves
    simultaneous poll/fallback-delivery failures.
- `src/cli/commands/triage/command.test.ts`
  - proves abort signals terminate child processes and runner settlement waits
    for close.
- `src/cli/commands/triage/tool-call-observer.test.ts`, `dry-run-agent.test.ts`,
  and `execute-agent.test.ts`
  - prove triage receives assistant calls immediately, atomically pre-creates
    and forwards the exact `--session` path, preserves `--no-session` without an
    observer, and aborts observed runs when streaming or callback delivery
    fails.
- `src/cli/commands/run-once/pipeline-progress.test.ts`
  - counts one parent invocation across multiple reported, changed, and fallback
    child observations sharing a `toolCallId`.
- `src/cli/commands/run-once/pipeline-progress-scenarios.test.ts`
  - feeds real custom progress entries through implementation observation and
    preserves todo-derived task/final-review transitions after parent-call
    suppression.
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
    `../subagent-progress.ts` import) through a temporary wrapper that writes a
    stable post-initialization sentinel;
  - runs the synchronous child with a process-level timeout, isolated working
    directory, temporary HOME/XDG/Pi-agent paths, no session, and ambient Pi
    resource discovery disabled.

### Direct verification

Run focused tests during implementation, followed by:

```sh
npm test
npm run lint
npm run build
BASE_SHA="$(git merge-base main HEAD)"
git diff --check "$BASE_SHA"...HEAD
git diff --cached --check
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

- Reviewer and worker children render the reported model and thinking tuple when
  available; thinking is omitted when 0.25.0 does not report it, and no
  parent/fallback value is invented.
- Only the leading provider segment and a known thinking suffix are removed;
  nested model-ID segments remain intact.
- Valid direct, counted-task, sequential-chain, and chain-parallel calls render
  one visible line per inventoried child; conflicting nonempty chain/tasks pass
  through without invented child progress.
- Repeated partial/final updates do not duplicate an unchanged tuple, and a
  changed tuple is not hidden.
- Completion and shutdown emit one task-free agent-only fallback for each
  unresolved child. Effective async direct, counted-parallel, and chain starts
  use that same per-child cardinality.
- A child with reported metadata does not also emit the previous agent-only
  line.
- The unique empty parent session file is atomically pre-created, initialized by
  Pi through `--session`, and observed exactly; newer nested child JSONL cannot
  be selected or mixed into parent progress.
- Observation delivery is serial/backpressured. Parsing, non-record JSON, I/O,
  or reporter failure aborts Pi, waits for close, and remains visible alongside
  runner/flush failures in the top-level flattened `AggregateError.errors`.
- Implementation todo-derived step progression refreshes on enriched progress
  after the parent tool-call observation is suppressed.
- Triage remains immediate and non-enriched; management calls retain normal tool
  formatting.
- Custom progress entries and synthetic fallbacks contain no task or child
  output and add no parent LLM context.
- Parent `toolCalls` accounting remains one unit per `toolCallId`.
- The isolated extension smoke uses a stable post-initialization sentinel rather
  than human-readable error text.
- Focused tests, full tests, lint, build, committed/staged diff checks,
  source/npm verification, and the Nix package build pass.
