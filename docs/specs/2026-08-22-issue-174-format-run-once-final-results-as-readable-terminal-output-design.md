# Issue 174 readable run-once final result design

## Context

`patchmill run-once` writes concise progress to stderr, then writes
`JSON.stringify(summarizeResult(...))` as one line on stdout. The structured
summary is useful to scripts, but successful implementation results can contain
long paths, URLs, validation entries, review prose, commits, and visual-evidence
records. The compact object is difficult to scan in a terminal and routinely
exceeds its width.

The pipeline already emits a numbered `final result <status>` progress step, and
`AgentIssueConsoleProgressReporter` already observes total output tokens and
elapsed time. `summarizeResult()` is the existing boundary between the pipeline
result and public structured output. The design should reuse those seams rather
than teach pipeline stages how to lay out terminal text.

No ADR conflicts apply. This design uses **run-once workflow**, **Issue run**,
**Run attempt**, **Run recovery state**, and **Pi session log** as defined in
`CONTEXT.md`.

## Goals

- Make the default interactive final result a readable, status-aware terminal
  report.
- Wrap every dynamic value to the detected terminal width without truncating
  paths, URLs, IDs, or prose.
- Group related fields under stable headings and render arrays vertically.
- Distinguish success, warning, and failure with both text markers and optional
  color.
- Preserve the current compact JSON contract for non-interactive stdout and
  record the same full structured summary in the JSONL run log.
- Keep formatting pure, focused, and independently testable.

## Non-goals

- Changing pipeline result statuses, fields, exit codes, workflow behavior, or
  Run recovery state.
- Adding an interactive pager, table, spinner, or alternate-screen TUI.
- Adding an output-format flag in this change. Redirected stdout remains the
  existing machine-readable mode.
- Hiding, abbreviating, or replacing literal URLs with terminal hyperlinks.
- Reformatting historical JSONL events or Pi session logs.

## Approaches considered

### Structured summary plus a focused terminal renderer (chosen)

Keep `summarizeResult()` as the canonical public result representation. Pass
that summary to a pure, status-aware renderer only when stdout is an interactive
terminal. The renderer knows the semantic sections, wrapping rules, and style
roles; `main.ts` only selects output mode and writes the result.

This preserves the machine contract, avoids duplicating pipeline mapping logic,
and gives tests deterministic width and color inputs.

### Render the result through progress events

The pipeline could attach full result data to its final progress step and let
`AgentIssueConsoleProgressReporter` render it. This couples domain orchestration
to terminal presentation, spreads changes across every terminal return path, and
occurs before `main.ts` resolves the final renamed log path. It is not the
recommended boundary.

### Pretty-print or recursively render JSON

Indented JSON or a generic object renderer would be easier to add, but it would
not provide status-specific headings, validation markers, caption/path pairs,
optional-section omission, or good narrow-width behavior. It would preserve the
object's incidental field order instead of creating a human hierarchy.

## Output-mode contract

After the final issue-scoped log path is known, `main.ts` builds one structured
summary and uses it for every destination:

1. Append the summary to the JSONL run log as a final `result` event.
2. If `process.stdout.isTTY === true`, render human-readable text to stdout.
3. Otherwise, write exactly one `JSON.stringify(summary)` line to stdout as
   today.

This selection applies to normal results and `{ status: "error", ... }` results.
Existing exit-code behavior does not change. `--quiet` continues to suppress
progress, not the final result; an interactive quiet invocation still gets the
formatted final report. `NO_COLOR` affects styling only and does not switch
output modes.

Non-interactive output must retain the current summary field names and shapes so
existing consumers can continue parsing it. It must contain no ANSI sequences.
The help text and run-once operator documentation will explain that interactive
stdout is formatted while redirected stdout is compact JSON.

## Terminal report model

### Header and run metrics

For normal interactive progress, the existing final progress step becomes the
report header rather than being printed once by the progress reporter and again
by the result renderer:

```text
11  Final result: ✓ PR created
    56.0k tokens · elapsed 4h 20m 02s
```

When `main.ts` has selected interactive output, it configures
`AgentIssueConsoleProgressReporter` to recognize a `final result <status>` step,
reserve its normal step number, and retain its final total-token and
elapsed-time accounting without writing that step. `main.ts` supplies the
captured context to the terminal renderer after the structured result exists.
For non-interactive stdout, the reporter prints its final progress step as it
does today while stdout receives JSON. All JSONL step events remain unchanged.

When no final step was emitted, such as an early configuration error, the
renderer uses an unnumbered header and omits unavailable token accounting.
Elapsed time may still be derived from the Run attempt start time. In quiet
mode, the header is unnumbered because progress numbering was intentionally
suppressed.

The existing progress metric is observed assistant output tokens. The display
keeps the established compact `56.0k tokens` wording rather than introducing a
new usage calculation.

### Status severity

Status wording is explicit so color is never the only signal:

| Severity           | Statuses                                                                                                  | Marker and color |
| ------------------ | --------------------------------------------------------------------------------------------------------- | ---------------- |
| Success            | `no-issue`, `dry-run`, `spec-created`, `spec-found`, `plan-created`, `plan-found`, `pr-created`, `merged` | `✓`, green       |
| Warning or partial | `approval-required`, `development-environment-not-ready`                                                  | `!`, yellow      |
| Failure            | `blocked`, `error`                                                                                        | `✗`, red         |

Each machine status maps to a stable human label such as `PR created`, `Merged`,
`Approval required`, `Development environment not ready`, or `Blocked`.

### Sections and fields

The renderer assembles sections in this order, omitting any section with no
renderable fields:

1. **Pull request** — literal PR URL.
2. **Issue and workspace** — issue number and, when present, title, branch, and
   worktree.
3. **Artifacts** — specification and implementation-plan paths.
4. **Transition or approval** — dry-run transition, approval kind, and missing
   label when applicable.
5. **Environment readiness or failure** — reason/error, causes, evidence,
   remediation, and blocker questions as applicable.
6. **Validation (N)** — one `✓` entry per validation result.
7. **Review** — wrapped review summary.
8. **Landing decision** — wrapped decision and merge commit when applicable.
9. **Commits (N)** — one commit ID per bullet.
10. **Visual evidence (N)** — one bullet per record, followed by its caption,
    screenshot path, reference paths, and URL on indented lines.
11. **Run files** — log and Pi session paths.

The smaller statuses use the same vocabulary and primitives rather than empty
placeholders. For example, `spec-created` renders Issue and workspace,
Artifacts, and Run files; `approval-required` additionally renders Approval;
`blocked` renders Failure and Questions. Undefined values, blank strings, and
empty arrays do not create headings, counts, bullets, or extra blank blocks.

All arrays are vertical. Generic collections use `•`; validations use `✓`;
warning/remediation and failure details use visible `!`, `→`, or `✗` markers as
appropriate. A multi-field item such as visual evidence has one bullet for the
item, then hanging-indented detail lines. Field labels align at normal widths
and move above their values when a narrow terminal cannot fit a useful inline
value.

## Wrapping and literal-value safety

The renderer accepts terminal width as an explicit option. Production uses a
positive `process.stdout.columns` value and falls back to 80 only when columns
are unavailable. Tests supply fixed widths.

Use the already-declared `@earendil-works/pi-tui` utilities
`wrapTextWithAnsi()`, `visibleWidth()`, and `stripTerminalSequences()` rather
than adding width or ANSI dependencies. Wrapping follows these rules:

- prose wraps at words;
- long unbroken tokens are split to fit rather than truncated;
- paths and URLs prefer natural punctuation boundaries when possible, but may
  hard-wrap to honor the width;
- wrapped values use a hanging indent under their value, bullet, or label;
- narrow layouts reduce indentation and stack labels before sacrificing value
  text; and
- every rendered content line must have visible width less than or equal to the
  detected width.

No ellipsis is added to result values. Literal paths, URLs, labels, and commit
IDs remain present in the output and therefore copyable across wrapped lines.
The renderer does not emit OSC 8 hyperlinks, which could obscure the literal
URL.

Dynamic strings can originate in issue-host or agent output. Strip ANSI, OSC,
APC, and other terminal sequences from terminal-rendered values before applying
Patchmill's own styles. Normalize embedded newlines through the same indented
wrapping primitives so a value cannot inject an unindented fake heading. The
structured JSON and JSONL summary retain their original data.

## Color behavior

Use a small renderer-local SGR palette; do not add a dependency solely for
color. Styling is enabled only when all of these are true:

- the human-readable stream is a TTY;
- `NO_COLOR` is absent from the environment; and
- `TERM` is not `dumb`.

When enabled:

- status markers and labels use green, yellow, or red by severity;
- the final status and section headings are bold;
- field labels and run metrics are dim or neutral;
- URLs are cyan and underlined;
- paths and commit IDs use one consistent accent color; and
- validation check marks are green.

When disabled, the same words, markers, indentation, and wrapping remain, with
no escape bytes. Styling must be applied or re-applied in a way that
`wrapTextWithAnsi()` preserves across wrapped lines and resets at line ends.

## Components and data flow

### Structured result summary

Move the structured summary union and `summarizeResult()` to a focused
`result-summary.ts` module if needed to avoid a presentation/import cycle.
`main.ts` should re-export `summarizeResult()` so existing callers and tests
keep their current API. Add the CLI error summary to the shared output union
instead of formatting errors through a separate ad hoc branch.

### Terminal result formatter

Add `terminal-result.ts` with a pure API conceptually equivalent to:

```ts
formatTerminalResult(summary, {
  width,
  color,
  stepNumber,
  totalOutputTokens,
  elapsedSeconds,
}): string
```

It owns status labels and severity, section selection, field/list primitives,
wrapping, sanitization, and controlled styling. It performs no process,
filesystem, pipeline, or console I/O.

### Console progress handoff

`AgentIssueConsoleProgressReporter` continues rendering all non-final progress.
An explicit constructor option tells it whether an interactive terminal result
will follow. Only in that mode does it capture a final-result step's reserved
number and accounting instead of printing. A small read-only snapshot method
gives `main.ts` the header context. Non-interactive runs retain the current
final progress line, and interactive runs avoid duplicate final headings without
changing pipeline or JSONL events.

### CLI orchestration and JSONL result

`main.ts` remains responsible for TTY detection, `NO_COLOR`/`TERM`, terminal
columns, output writing, and exit codes. Both success and error branches call
one output helper.

After `finalLogPath()` renames the preliminary log, append a final event through
a `JsonlProgressReporter` targeting the resolved path. The event uses
`stage: "result"`, a level matching the status severity, and the complete
structured summary in `data`. Earlier JSONL events are neither rewritten nor
removed. A final-result persistence failure follows existing progress-reporting
error handling rather than silently claiming that the run log contains the
result.

## Affected components

- `src/cli/commands/run-once/result-summary.ts` (new, if extracted) — structured
  output union and summary mapping.
- `src/cli/commands/run-once/terminal-result.ts` (new) — pure semantic renderer,
  wrapping, sanitization, and style roles.
- `src/cli/commands/run-once/main.ts` — output-mode selection, resolved-log
  result event, formatter invocation, and updated help text.
- `src/cli/commands/run-once/console-progress.ts` — defer final-step display and
  expose its numbering/accounting snapshot.
- Focused tests beside those modules, plus existing `args.test.ts` and
  `console-progress.test.ts` updates.
- `site/src/content/docs/using-patchmill/run-once.md` — interactive versus
  redirected output contract and color behavior.

Pipeline result types, pipeline stages, Run recovery state, and Pi session logs
should not change.

## Verification strategy

These tests pass Patchmill's Testing Value Gate because they prove reusable,
user-visible CLI behavior that can regress across statuses, widths, and output
streams.

### Formatter tests

- Cover every result status plus `error`, checking its human status label,
  severity marker, and relevant sections.
- Verify wide output aligns labels and narrow output stacks them.
- At representative narrow widths, assert `visibleWidth(line) <= width` for
  every line after styling.
- Verify long prose, paths, URLs, labels, and IDs wrap without truncation and
  can be reconstructed from their wrapped fragments.
- Verify arrays are vertical, counts are correct, and visual-evidence details
  stay attached to one bullet.
- Verify missing optional strings and empty arrays omit their headings and do
  not create malformed blank spacing.
- Verify controlled ANSI roles when enabled and zero escape bytes for
  `NO_COLOR`, `TERM=dumb`, and color-disabled rendering.
- Verify injected terminal sequences and embedded newlines cannot escape the
  renderer's styles or indentation.

### Output and progress tests

- Verify interactive stdout selects the terminal renderer while non-TTY stdout
  produces the unchanged compact JSON line.
- Verify `--quiet` suppresses progress but not the interactive final report.
- Verify the console progress reporter captures, but does not separately print,
  a final-result step and preserves its step number, total tokens, and elapsed
  time.
- Verify ordinary progress steps remain byte-for-byte unchanged and a
  non-deferred final step still prints in machine-output mode.
- Verify success, warning/partial, blocked, and unexpected-error exit codes are
  unchanged.
- Verify the resolved JSONL file ends with one structured `result` event and
  still contains all prior events.

### Commands and manual checks

Run focused tests first, then:

```sh
npm run test:run-once
npm test
npm run lint
npm run build
```

Manually run a fixture or disposable Run attempt in a wide TTY, a narrow TTY,
with `NO_COLOR=1`, and with stdout redirected to confirm readable terminal
hierarchy and parseable one-line JSON. No npm dependency change is expected, so
the dependency-triggered Nix build is not required. If implementation does
change `package.json`, `package-lock.json`, or `npm-shrinkwrap.json`, run the
Nix build required by `AGENTS.md`.

## Success criteria

An interactive `run-once` ends with one coherent, numbered report whose status,
sections, arrays, literal paths and URLs, and wrapped prose remain readable at
the current terminal width. Warning and failure outcomes remain unambiguous
without color. A redirected invocation emits the existing compact structured
JSON without ANSI bytes, and the resolved JSONL run log contains that same full
structured summary as its final result event.
