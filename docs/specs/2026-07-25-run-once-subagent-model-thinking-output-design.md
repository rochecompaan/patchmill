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

This approach is preferred over parsing only final tool-result messages because
it preserves useful progress visibility. It is preferred over resolving local
settings at tool-call time because it does not duplicate `pi-subagents` agent,
override, model, thinking, and fallback rules.

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

A separate explicit thinking field, if a future `pi-subagents` result provides
one, takes precedence over the active Pi fallback. A known suffix on the
resolved model remains authoritative because it is the exact model argument
used to launch that child. When neither is present, the observer supplies Pi's
active thinking level from `pi.getThinkingLevel()`.

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
session streamer but do not participate in LLM context.

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

The observer lives under `src/pi/extensions/` so TypeScript builds it into the
published `dist/src/pi/extensions/` tree. Resource-path construction detects
whether `resource-profiles` is running from `dist/src/pi` or `src/pi` and
selects the corresponding `.js` or `.ts` observer path.

### Session observation

Extend `src/cli/commands/run-once/pi-session-stream.ts` with a dedicated
subagent-resolution observation. Only a `custom` entry with the exact
`patchmill-subagent-progress` type and a valid payload becomes this observation.
Other custom entries continue to be ignored.

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
metadata for those calls. Calls with `async: true` return
`details.results: []` from the pinned `pi-subagents` version and run children
out of process; they continue to emit the existing agent-only summary until
resolved metadata is available. Subagent management calls, such as
`subagent(action=list)`, continue through normal tool-call formatting.

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
- Unknown model suffixes remain part of the model ID rather than being
  misreported as a thinking level.

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
  - handles active-thinking fallback;
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
  - ignores malformed and unrelated custom entries.
- `src/cli/commands/run-once/console-progress.test.ts`
  - asserts the exact requested output;
  - asserts separate lines for parallel children;
  - verifies foreground execution calls no longer emit agent-only lines;
  - verifies async execution calls retain agent-only summaries;
  - preserves management-call formatting.
- `src/pi/resource-profiles.test.ts`
  - verifies every run-once profile includes the observer extension;
  - verifies triage does not include it.

### Direct verification

Run focused tests during implementation, followed by:

```sh
npm test
npm run lint
npm run build
git diff --check
npm pack --dry-run
```

The package dry-run must show the compiled observer extension. No dependency
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
- Foreground subagent execution calls do not emit the previous agent-only line.
- Async subagent calls retain an agent-only summary until resolved metadata is
  available.
- Subagent management calls retain normal tool-call output.
- Custom progress entries do not enter LLM context and contain no task or child
  output.
- Malformed hook data does not fail the run.
- Focused tests, the full test suite, lint, build, diff checks, and package
  dry-run pass.
