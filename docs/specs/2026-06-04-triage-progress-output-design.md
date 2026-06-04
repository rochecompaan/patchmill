# Triage Progress Output Design

## Goal

Show `patchmill triage` progress while the run is still in progress, with one
issue summary printed as soon as that issue has been triaged. The final output
should follow the layout demonstrated by `docs/mockups/triage-output-demo.mjs`:
command header, selected issue count, per-issue dividers and details,
`progress: N/M triaged`, then final status and log path.

## Current behavior

- `runTriage` selects all eligible issues, runs the triage agent, writes the
  log, and returns one `TriageResult` only after the whole run finishes.
- `src/cli/commands/triage/main.ts` prints the status, issue count, log path,
  and compact issue summaries after `runTriage` resolves.
- Execute mode sends all selected issues to one Pi triage execution prompt, then
  snapshots all issues after the agent exits. Patchmill cannot know which issue
  has completed until the full batch is done.
- Dry-run mode already receives structured preview entries, but those entries
  are also printed only after the full dry-run returns.

## Desired behavior

- After issue selection, print the command and selected issue count:

  ```text
  > patchmill triage

  issues: 49
  ```

- In execute mode, process selected issues one at a time. After each issue's Pi
  triage invocation finishes and Patchmill snapshots that issue, print that
  issue's observed changes immediately.
- In dry-run mode, keep the current single preview invocation, then stream the
  preview entries through the same progress formatter in preview order.
- Each issue block should include:
  - divider line;
  - `#<number> <title>`;
  - `link: <url>` when the host provider supplies a URL;
  - `labels: <before> -> <after>`;
  - `state: <before> -> <after>` when state changed;
  - `comment added:` plus up to five comment lines when a comment was added;
  - `progress: <completed>/<total> triaged`.
- At the end, print:

  ```text
  agent issue triage: applied
  log: .patchmill/triage-runs/triage-2026-06-03T21-37-28-290Z.json
  ```

- Preserve machine-readable triage logs with the same final shape as today.
- If a run fails after some issues complete, write a failure log that includes
  completed issue entries plus the error message, then return the existing
  non-zero CLI behavior.

## Design decisions and alternatives

### Recommended: progress callback plus per-issue execute loop

Add a small progress event API to the triage pipeline and have the CLI attach a
console reporter. Execute mode changes from one all-issue Pi invocation to a
sequential per-issue loop. After each issue is processed, Patchmill snapshots
that issue, builds a `TriageLogIssueEntry`, appends it to the in-memory log, and
emits an issue progress event.

This is the only approach that can honestly print observed label, state, and
comment changes as each issue is completed. It keeps formatting out of the core
pipeline and makes the progress behavior testable without real console output.

### Alternative: keep batch execution and print entries after the batch

This would reuse the current architecture and only move formatting around, but
it would not satisfy the requirement. Output would still appear only after the
whole batch finishes because Patchmill would not have per-issue snapshots.

### Alternative: parse agent stdout for issue progress

This would keep one Pi invocation and attempt to infer progress from the triage
agent's text output. It is brittle because the execute agent is not required to
produce structured output, and stdout may not reflect actual host mutations.
Patchmill should report verified observed changes, not inferred agent narration.

## Architecture

### Types

Extend `IssueSummary` and `TriageLogIssueEntry` with optional `url?: string`.
Host providers should populate it when their CLI payload includes `url` or
`html_url`. The progress formatter should omit the link line when no URL is
available.

Add progress event types in `src/cli/commands/triage/types.ts`:

```ts
export type TriageProgressEvent =
  | { type: "selected"; total: number }
  | {
      type: "issue";
      issue: TriageLogIssueEntry;
      completed: number;
      total: number;
    };

export type TriageProgressHandler = (event: TriageProgressEvent) => void;
```

Add `onProgress?: TriageProgressHandler` to `TriageConfig`.

### Pipeline flow

1. List and filter issues using the current selection logic.
2. Emit `{ type: "selected", total: issues.length }` once the final issue set is
   known, including `total: 0` for no-issue runs.
3. For dry-run mode, keep the existing `runTriageDryRunAgent` batch call,
   convert previews to log entries, emit one issue event for each preview, write
   the log, and return the final result.
4. For execute mode, copy the selected issues as before, then iterate
   sequentially:
   - call `runTriageExecuteAgent` with a one-issue array;
   - fetch and hydrate the after snapshot for that issue only;
   - call `createObservedChangeEntries` for that single before/after pair;
   - append the entry to `logIssues`;
   - emit the issue progress event.
5. Write the final log with all accumulated issue entries.
6. On errors after selection, write a failure log containing all entries already
   completed and the error message.

### CLI output reporter

Move progress-oriented formatting into `src/cli/commands/triage/main.ts` or a
new focused formatter module if `main.ts` grows too much. The reporter owns
terminal presentation only; it does not decide triage behavior.

Formatting rules:

- Use the divider from the mockup:
  `──────────────────────────────────────────────────────────────────────────────`.
- Label empty arrays as `(none)`.
- Use `comment added:` for observed added comments and `comment:` for dry-run
  preview comments.
- Print at most five comment lines so long comments do not flood the terminal.
- Do not print ANSI colors in tests; color can be added later behind the
  existing `NO_COLOR`/TTY convention from the demo.

### Failure behavior

- Selection/listing failures still write a failure log with no issue entries.
- Per-issue execute failures write a failure log with completed entries and the
  error message.
- The CLI continues to print the error to stderr and return exit code `1`.
- The progress reporter should not print a success footer if `runTriage` throws.

## Test plan

- Unit-test issue progress formatting against the demo layout, including labels,
  state changes, comments, truncation, and progress count.
- Unit-test `runTriage` dry-run progress events: one selected event and one
  issue event per preview.
- Unit-test execute mode with two issues to prove Patchmill emits an issue event
  after the first issue snapshot before the second Pi invocation completes.
- Unit-test failure logging after a per-issue execute failure preserves
  completed issue entries.
- Run `npm run test:triage`, then `npm test`.

## Out of scope

- Parallel triage execution.
- Live spinner animation.
- Streaming raw Pi stdout/stderr into the progress report.
- Changing triage labels, project policy, or the bundled triage skill.
