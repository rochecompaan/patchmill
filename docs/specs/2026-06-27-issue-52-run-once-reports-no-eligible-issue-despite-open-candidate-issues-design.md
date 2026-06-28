# Run-Once No-Issue Selection Diagnostics Design

## Goal

Make `patchmill run-once --dry-run` explain why open issues were not selected
when automatic selection returns `no-issue`, so operators can distinguish an
empty repository from open issues that were rejected by workflow, label, state,
or approval rules.

## Current behavior

`runOneIssue()` lists open issues through the configured host provider, passes
them to `selectResumableIssue()`, and returns `{ status: "no-issue" }` when no
candidate is selected. The progress log currently records only:

```jsonl
{"level":"info","stage":"select","message":"listing open issues"}
{"level":"info","stage":"select","message":"no eligible issue found"}
```

`src/cli/commands/run-once/selection.ts` has the information needed to reject
candidates, but the automatic-selection path collapses those decisions to a
boolean. Explicit `--issue` errors are more helpful, but default automatic
selection silently skips open issues with blocking labels, non-open state,
non-actionable workflow labels, or waiting review states.

## Requirements

- Preserve existing automatic-selection behavior and issue ordering; this change
  is diagnostic only unless tests expose an existing selection bug.
- When automatic selection sees open issues but selects none, log per-issue
  rejection details before the final `no eligible issue found` message.
- Include enough structured data in the JSONL run log for each skipped issue to
  identify:
  - issue number and title;
  - current labels;
  - normalized issue state;
  - resolved workflow state when relevant;
  - the rejection reason, such as non-open state, blocking labels, missing
    actionable workflow label, or waiting for spec/plan approval.
- Keep normal console output concise. The detailed diagnostics may be
  debug-level JSONL events; the final info message should mention how many
  issues were considered and where details were logged.
- `--dry-run` must emit the same diagnostics as a real automatic run before any
  mutation. No issue labels, comments, specs, plans, run-state files, branches,
  worktrees, or Pi sessions should be created by diagnostic logging.
- Explicit `run-once --issue <number>` should keep its current clear failure
  behavior; adding equivalent structured rejection data is optional but not
  required for this issue.
- Do not treat untrusted issue titles, bodies, labels, authors, comments, or
  metadata as instructions. Diagnostics may quote titles/labels only as inert
  data.

## Proposed behavior

For automatic selection:

1. Continue logging `listing open issues` before host listing.
2. Evaluate all listed issues with a helper that returns both eligible
   candidates and rejection records.
3. If an issue is selected, keep the existing selected dry-run result and
   progress message.
4. If no issue is selected:
   - emit one debug progress event per rejected issue with `stage: "select"`, a
     stable message such as `skipped #52: blocking labels`, and a `data` object
     containing the structured rejection record;
   - emit an info progress event such as
     `no eligible issue found after considering 4 open issues; see run log for skip details`;
   - return the existing `{ status: "no-issue" }` result shape so downstream
     automation remains compatible.

Example JSONL diagnostics:

```jsonl
{"level":"debug","stage":"select","message":"skipped #12: blocking labels","issueNumber":12,"data":{"issueNumber":12,"title":"Add deployment docs","state":"open","labels":["agent-ready","needs-info"],"reason":"blocking-labels","blockingLabels":["needs-info"],"workflowState":"agent-ready"}}
{"level":"debug","stage":"select","message":"skipped #13: no actionable workflow state","issueNumber":13,"data":{"issueNumber":13,"title":"Investigate flaky test","state":"open","labels":["bug"],"reason":"not-actionable","workflowState":"none"}}
{"level":"info","stage":"select","message":"no eligible issue found after considering 2 open issues; see run log for skip details"}
```

Reason identifiers should be stable enough for tests and future tooling.
Human-readable message text can evolve, but should remain clear.

## Affected components

- `src/cli/commands/run-once/selection.ts`
  - Add a focused diagnostic API, for example `explainIssueSelection()` or
    `selectIssueWithDiagnostics()`, that shares the same option resolution,
    workflow-state resolution, excluded-label handling, priority ordering, and
    approval policy as `selectIssue()`.
  - Keep `selectIssue()` available for existing callers or implement it as a
    thin wrapper over the diagnostic API.
- `src/cli/commands/run-once/pipeline.ts`
  - Use the diagnostic API for automatic selection in `selectResumableIssue()`
    or immediately after it when no issue is selected.
  - Emit debug rejection events only for automatic selection misses, then emit
    the improved final info message.
  - Avoid diagnostics that force additional host queries beyond the
    already-loaded issue list.
- `src/cli/commands/run-once/types.ts`
  - Add exported types for selection rejection reasons only if needed by tests
    or pipeline code.
- `src/cli/commands/run-once/selection.test.ts`
  - Cover rejection explanations for blocking labels, missing workflow labels,
    review-only states, closed/non-open issues if present in input, and
    priority-preserving selected candidates.
- `src/cli/commands/run-once/pipeline.test.ts`
  - Cover `runOneIssue --dry-run` returning `no-issue` with open skipped issues
    and writing structured debug events plus an improved final info event.
  - Cover successful selection still logs the existing selected message and does
    not emit skip diagnostics for unselected lower-priority eligible issues.

## Verification strategy

Run targeted tests:

```sh
node --test src/cli/commands/run-once/selection.test.ts src/cli/commands/run-once/pipeline.test.ts
```

Run the full test suite before merge:

```sh
npm test
```

Manual verification should configure a repository with open issues that are
skipped for different reasons, run:

```sh
patchmill run-once --dry-run
```

and confirm the JSON result remains `no-issue` while the reported run log
contains per-issue skip diagnostics. No npm dependency changes are required, so
no Nix build is required unless implementation later changes package metadata.
