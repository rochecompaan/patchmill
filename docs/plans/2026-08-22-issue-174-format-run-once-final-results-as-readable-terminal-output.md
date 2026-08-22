# Readable Run-Once Final Result Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace compact JSON on interactive `run-once` stdout with a readable,
width-aware, status-aware terminal report while preserving compact JSON for
non-interactive consumers and the full structured summary in the resolved JSONL
run log.

**Architecture:** Keep `summarizeResult()` as the canonical machine-result
boundary, but extract it from the already-large CLI entry module. Build the
human report as a pure semantic formatter over that summary, with a focused
layout module for sanitization, ANSI-aware wrapping, hanging indents, and style
roles. A small output shell will append the structured result event first, then
select terminal text or compact JSON; the console progress reporter will defer
only the interactive final step and expose its captured header metrics.

**Tech Stack:** Node.js 22.19+, TypeScript ESM, `node:test`, Node `fs/promises`,
the existing `@earendil-works/pi-tui` 0.84.2 `wrapTextWithAnsi()`,
`visibleWidth()`, and `stripTerminalSequences()` utilities, and existing
Patchmill run-once progress and JSONL reporters.

**Spec:**
`docs/specs/2026-08-22-issue-174-format-run-once-final-results-as-readable-terminal-output-design.md`

## Global Constraints

- Interactive output means `process.stdout.isTTY === true`; redirected or
  otherwise non-interactive stdout remains exactly one compact
  `JSON.stringify(summary)` line.
- `NO_COLOR` changes styling only. Color is enabled only when stdout is a TTY,
  `NO_COLOR` is absent, and `TERM !== "dumb"`.
- Keep every current non-interactive summary field name and shape unchanged. Add
  only the existing CLI `{ status: "error", error, causes?, logPath? }` object
  to the shared result-summary union.
- Do not change pipeline statuses, exit codes, Run recovery state, pipeline
  stages, Pi session logs, or historical JSONL events.
- Do not add an output-format flag, pager, table, spinner, alternate screen,
  terminal hyperlink, truncation, or ellipsis.
- Strip terminal control sequences from human-rendered dynamic values only;
  structured JSON and JSONL data must retain the original summary strings.
- Use the already-declared `@earendil-works/pi-tui` dependency. Do not add a
  color, width, wrapping, or ANSI dependency.
- Keep responsibilities split: structured mapping in `result-summary.ts`,
  semantic section selection in `terminal-result.ts`, low-level layout in
  `terminal-result-layout.ts`, final persistence/output selection in
  `result-output.ts`, and CLI orchestration in `main.ts`.
- Apply Patchmill's Testing Value Gate. Formatter, sanitization, progress
  handoff, output-mode, JSONL, error, and exit-code tests are required because
  they prove reusable user-visible behavior, security boundaries, and machine
  contracts that can meaningfully regress. Do not add tests that merely assert
  documentation prose; verify help and site documentation directly.
- No npm dependency change is planned. If `package.json`, `package-lock.json`,
  or `npm-shrinkwrap.json` changes, retain it only when necessary and run
  `nix build .#patchmill --print-build-logs` as required by `AGENTS.md`.

---

## File Structure

- `src/cli/commands/run-once/result-summary.ts` will own the public structured
  result union, normal pipeline-result mapping, error-result mapping, and
  question normalization.
- `src/cli/commands/run-once/result-summary.test.ts` will protect the existing
  compact machine contract and the newly shared error shape.
- `src/cli/commands/run-once/terminal-result.ts` will own status labels,
  severity, section order, and conversion from a structured summary to semantic
  fields and lists.
- `src/cli/commands/run-once/terminal-result-layout.ts` will own focused layout
  primitives, sanitization, local SGR roles, ANSI-aware wrapping, aligned versus
  stacked fields, hanging indents, and visible-width guarantees.
- `src/cli/commands/run-once/terminal-result.test.ts` will exercise the public
  formatter across every status, wide and narrow widths, optional fields,
  arrays, literal-value preservation, color, and hostile terminal strings.
- `src/cli/commands/run-once/console-progress.ts` will optionally reserve and
  capture a `final result <status>` step instead of writing it.
- `src/cli/commands/run-once/console-progress.test.ts` will protect ordinary
  progress output and the deferred final-step snapshot.
- `src/cli/commands/run-once/result-output.ts` will append the final JSONL
  event, select interactive versus compact output, derive width/color options,
  write one final stdout payload, and expose the unchanged status-to-exit-code
  rule.
- `src/cli/commands/run-once/result-output.test.ts` will use fake stdout streams
  and real temporary JSONL files to verify output and persistence behavior.
- `src/cli/commands/run-once/main.ts` will remain the process/filesystem shell,
  re-export `summarizeResult()`, configure progress deferral, resolve the final
  log path, and route both normal and error summaries through one output helper.
- `src/cli/commands/run-once/args.test.ts` will stop owning structured-summary
  tests after they move to the focused test module; existing argument and help
  behavior coverage remains.
- `site/src/content/docs/using-patchmill/run-once.md` and `HELP_TEXT` in
  `main.ts` will document formatted interactive stdout, redirected compact JSON,
  quiet mode, color gating, and final JSONL result persistence.

---

### Task 1: Extract the Canonical Structured Result Summary

**Files:**

- Create: `src/cli/commands/run-once/result-summary.ts`
- Create: `src/cli/commands/run-once/result-summary.test.ts`
- Modify: `src/cli/commands/run-once/main.ts:42-239`
- Modify: `src/cli/commands/run-once/args.test.ts:8,159-292`

**Interfaces:**

- Consumes: `AgentIssuePipelineResult` and unknown CLI errors formatted through
  the existing `formatErrorWithCauses()` helper.
- Produces:

  ```ts
  export type RunOnceResultSummary =
    | RunOncePipelineResultSummary
    | {
        status: "error";
        error: string;
        causes?: string[];
        logPath?: string;
      };

  export type RunOnceResultStatus = RunOnceResultSummary["status"];

  export function summarizeResult(
    result: AgentIssuePipelineResult,
  ): RunOncePipelineResultSummary;

  export function summarizeErrorResult(
    error: unknown,
    logPath?: string,
  ): Extract<RunOnceResultSummary, { status: "error" }>;
  ```

- Later tasks consume only `RunOnceResultSummary`, not pipeline result types.
- `main.ts` must continue to export `summarizeResult` so existing importers do
  not break.

- [ ] **Step 1: Write focused structured-summary tests before moving code**

  Create `result-summary.test.ts`. Move the current merged, spec-created,
  approval-required, and development-environment-not-ready assertions from
  `args.test.ts` without changing their literal expected objects. Add a complete
  `pr-created` case that protects arrays and optional visual evidence, plus this
  error case:

  ```ts
  test("summarizeErrorResult preserves aggregate causes and the resolved log path", () => {
    const summary = summarizeErrorResult(
      new AggregateError(
        [new Error("observer failed"), new Error("cleanup failed")],
        "Pi run failed",
      ),
      "/repo/.patchmill/runs/issue-174/run.jsonl",
    );

    assert.deepEqual(summary, {
      status: "error",
      error: "Pi run failed",
      causes: ["observer failed", "cleanup failed"],
      logPath: "/repo/.patchmill/runs/issue-174/run.jsonl",
    });
  });
  ```

  In the PR case, use this expected machine shape so extraction cannot
  accidentally rename or add fields:

  ```ts
  {
    status: "pr-created",
    issueNumber: 174,
    specPath: "docs/specs/result-design.md",
    planPath: "docs/plans/result-plan.md",
    branch: "agent/issue-174-readable-result",
    prUrl: "https://example.test/patchmill/pulls/174",
    worktreePath: ".worktrees/patchmill-issue-174-readable-result",
    commits: ["abc123", "def456"],
    validation: ["npm test passed", "npm run lint passed"],
    reviewSummary: "All findings resolved.",
    landingDecision: "PR required for CLI output change.",
    visualEvidence: [
      {
        screenshotPath: "docs/reference-screenshots/result.png",
        caption: "Readable final result",
        referencePaths: ["docs/reference-screenshots/before.png"],
        url: "https://example.test/evidence/174",
      },
    ],
    logPath: "/repo/.patchmill/runs/issue-174/run.jsonl",
    piSessionPath: "/repo/.patchmill/runs/issue-174/run-pi-sessions",
  }
  ```

- [ ] **Step 2: Run the focused test and verify the new module is missing**

  Run:

  ```sh
  node --test src/cli/commands/run-once/result-summary.test.ts
  ```

  Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `result-summary.ts`; the
  failure must be due to the new boundary not existing, not a malformed fixture.

- [ ] **Step 3: Move the structured union and mapping into the focused module**

  Move `JsonResultLog`, `JsonResult`, `questionText()`, and `summarizeResult()`
  from `main.ts` into `result-summary.ts`. Rename the exported union to
  `RunOnceResultSummary`, retain every current switch branch and optional-field
  rule, and implement the shared error constructor exactly as follows:

  ```ts
  export function summarizeErrorResult(
    error: unknown,
    logPath?: string,
  ): Extract<RunOnceResultSummary, { status: "error" }> {
    const formatted = formatErrorWithCauses(error);
    return {
      status: "error",
      error: formatted.message,
      ...(formatted.causes ? { causes: formatted.causes } : {}),
      ...(logPath ? { logPath } : {}),
    };
  }
  ```

  In `main.ts`, import both summary functions for local use and preserve the old
  API with:

  ```ts
  export { summarizeResult } from "./result-summary.ts";
  ```

  Update `args.test.ts` to remove the moved summary fixtures and keep only
  argument, configuration, and help behavior.

- [ ] **Step 4: Run focused and existing argument tests**

  Run:

  ```sh
  node --test \
    src/cli/commands/run-once/result-summary.test.ts \
    src/cli/commands/run-once/args.test.ts
  ```

  Expected: PASS. The compact expected objects must remain byte-shape compatible
  after `JSON.stringify()`; no title or presentation-only field is added to
  normal summaries.

- [ ] **Step 5: Commit the structured-summary extraction**

  ```sh
  git add \
    src/cli/commands/run-once/result-summary.ts \
    src/cli/commands/run-once/result-summary.test.ts \
    src/cli/commands/run-once/main.ts \
    src/cli/commands/run-once/args.test.ts
  git commit -m "refactor(run-once): extract structured result summary"
  ```

---

### Task 2: Render Plain Semantic Terminal Reports at Wide and Narrow Widths

**Files:**

- Create: `src/cli/commands/run-once/terminal-result.ts`
- Create: `src/cli/commands/run-once/terminal-result-layout.ts`
- Create: `src/cli/commands/run-once/terminal-result.test.ts`

**Interfaces:**

- Consumes: `RunOnceResultSummary` from Task 1.
- Produces:

  ```ts
  export type TerminalResultSeverity = "success" | "warning" | "failure";

  export type TerminalResultOptions = {
    width: number;
    color: boolean;
    stepNumber?: number;
    totalOutputTokens?: number;
    elapsedSeconds?: number;
  };

  export function terminalResultSeverity(
    status: RunOnceResultStatus,
  ): TerminalResultSeverity;

  export function formatTerminalResult(
    summary: RunOnceResultSummary,
    options: TerminalResultOptions,
  ): string;
  ```

- `terminal-result-layout.ts` exposes only the semantic model and one renderer
  to `terminal-result.ts`:

  ```ts
  export type TerminalValue = {
    text: string;
    role?: "plain" | "url" | "path" | "commit";
  };

  export type TerminalField = {
    label?: string;
    value: TerminalValue;
  };

  export type TerminalListItem = {
    value: TerminalValue;
    details?: TerminalField[];
  };

  export type TerminalSectionBlock =
    | { kind: "value"; value: TerminalValue }
    | { kind: "fields"; fields: TerminalField[] }
    | {
        kind: "list";
        marker: "•" | "✓" | "!" | "→" | "✗";
        markerSeverity?: TerminalResultSeverity;
        items: TerminalListItem[];
      };

  export type TerminalSection = {
    heading: string;
    count?: number;
    blocks: TerminalSectionBlock[];
  };
  ```

- The layout renderer accepts header label/severity/metrics, sections, width,
  and color. It returns a string without a trailing newline; the output shell in
  Task 5 owns the final newline.

- [ ] **Step 1: Write status, section-order, and vertical-list tests**

  In `terminal-result.test.ts`, define literal summaries for every status and
  assert these exact marker/label pairs:

  | Status                              | Marker | Human label                         |
  | ----------------------------------- | ------ | ----------------------------------- |
  | `no-issue`                          | `✓`    | `No eligible issue`                 |
  | `dry-run`                           | `✓`    | `Dry run`                           |
  | `spec-created`                      | `✓`    | `Specification created`             |
  | `spec-found`                        | `✓`    | `Specification found`               |
  | `plan-created`                      | `✓`    | `Implementation plan created`       |
  | `plan-found`                        | `✓`    | `Implementation plan found`         |
  | `pr-created`                        | `✓`    | `PR created`                        |
  | `merged`                            | `✓`    | `Merged`                            |
  | `approval-required`                 | `!`    | `Approval required`                 |
  | `development-environment-not-ready` | `!`    | `Development environment not ready` |
  | `blocked`                           | `✗`    | `Blocked`                           |
  | `error`                             | `✗`    | `Error`                             |

  For a full `pr-created` fixture, assert headings occur in this order:
  `Pull request`, `Issue and workspace`, `Artifacts`, `Validation (2)`,
  `Review`, `Landing decision`, `Commits (2)`, `Visual evidence (1)`, and
  `Run files`. Assert validation and commit entries occupy separate physical
  lines:

  ```ts
  assert.match(output, /^  ✓ npm test passed$/mu);
  assert.match(output, /^  ✓ npm run lint passed$/mu);
  assert.match(output, /^  • abc123$/mu);
  assert.match(output, /^  • def456$/mu);
  ```

  Add smaller fixtures and assertions for:
  - dry-run `Transition` with issue number and title;
  - spec/plan `Artifacts` without unrelated sections;
  - approval `Approval` with kind and missing label;
  - environment `Environment readiness`, evidence, and remediation;
  - blocked `Failure` and `Questions (N)`;
  - error `Failure` and causes;
  - merged `Landing decision` with merge commit;
  - `no-issue` with no empty section after the header.

- [ ] **Step 2: Write wrapping, header-metric, and omission tests**

  Use `visibleWidth()` from `@earendil-works/pi-tui` in the tests. Render a full
  summary at widths 100, 40, 32, and 24, and assert every output line satisfies:

  ```ts
  for (const line of output.split("\n")) {
    assert.ok(
      visibleWidth(line) <= width,
      `${visibleWidth(line)} > ${width}: ${JSON.stringify(line)}`,
    );
  }
  ```

  Assert width 100 uses aligned inline labels, width 24 stacks `Branch:` above
  its value, and a long URL, path, commit ID, and prose value remain recoverable
  by joining their wrapped value fragments after removing layout whitespace.
  Assert no output contains `...` or the Unicode ellipsis `…`.

  Cover the header with:

  ```ts
  assert.match(
    formatTerminalResult(summary, {
      width: 80,
      color: false,
      stepNumber: 11,
      totalOutputTokens: 56_000,
      elapsedSeconds: 15_602,
    }),
    /^11  Final result: ✓ PR created\n    56\.0k tokens · elapsed 4h20m02s/mu,
  );
  ```

  Also assert an unnumbered header when `stepNumber` is absent, elapsed-only
  metrics when token accounting is unavailable, and no metrics line when both
  metrics are unavailable.

  Supply undefined, blank-string, and empty-array optional values and assert
  they do not produce headings, `(0)` counts, bullets, duplicate blank blocks,
  or trailing whitespace.

- [ ] **Step 3: Run formatter tests and verify the public module is missing**

  Run:

  ```sh
  node --test src/cli/commands/run-once/terminal-result.test.ts
  ```

  Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `terminal-result.ts`.

- [ ] **Step 4: Implement the semantic status and section model**

  In `terminal-result.ts`, define one exhaustive status descriptor map whose
  values match Step 1 and whose severities are:

  ```ts
  const STATUS = {
    "no-issue": { label: "No eligible issue", severity: "success" },
    "dry-run": { label: "Dry run", severity: "success" },
    "spec-created": { label: "Specification created", severity: "success" },
    "spec-found": { label: "Specification found", severity: "success" },
    "plan-created": {
      label: "Implementation plan created",
      severity: "success",
    },
    "plan-found": {
      label: "Implementation plan found",
      severity: "success",
    },
    "pr-created": { label: "PR created", severity: "success" },
    merged: { label: "Merged", severity: "success" },
    "approval-required": {
      label: "Approval required",
      severity: "warning",
    },
    "development-environment-not-ready": {
      label: "Development environment not ready",
      severity: "warning",
    },
    blocked: { label: "Blocked", severity: "failure" },
    error: { label: "Error", severity: "failure" },
  } as const satisfies Record<
    RunOnceResultStatus,
    { label: string; severity: TerminalResultSeverity }
  >;
  ```

  Assemble sections in the spec order from fields present on the canonical
  summary. Use these exact semantic rules:
  - `Pull request`: one URL value for `prUrl`.
  - `Issue and workspace`: `Issue` as `#<issueNumber>`, then `Title`, `Branch`,
    and `Worktree` when those summary fields exist and are nonblank.
  - `Artifacts`: one `•` item named `Specification` or `Implementation plan`,
    with its path as an indented detail.
  - `Transition`: dry-run transition as a field.
  - `Approval`: approval kind and missing label as fields.
  - `Environment readiness`: reason as a field, evidence as `!` items, and
    remediation as `→` items.
  - `Failure`: blocked reason or CLI error; error causes become `✗` items.
  - `Questions (N)`: one `✗` item per blocker question.
  - `Validation (N)`: one green-capable `✓` item per validation string.
  - `Review`: one prose value.
  - `Landing decision`: landing prose and merged `Merge commit`.
  - `Commits (N)`: one `•` commit-role item per ID.
  - `Visual evidence (N)`: one `•` item per record. Use its caption as the item
    text when present; otherwise use the screenshot path. When a caption is
    present, add `Screenshot` as a path detail. Add each reference as a
    `Reference` path detail and the optional URL as a URL detail.
  - `Run files`: `Log` and `Pi sessions` bullets, each with one path detail.

  Filter blank strings, empty arrays, empty detail collections, empty blocks,
  and empty sections before rendering.

- [ ] **Step 5: Implement width-aware layout without color**

  In `terminal-result-layout.ts`, implement these named primitives:

  ```ts
  function cleanValue(value: string): string;
  function wrapValue(
    value: TerminalValue,
    firstPrefix: string,
    continuationPrefix: string,
    width: number,
    color: boolean,
  ): string[];
  function renderFields(
    fields: TerminalField[],
    width: number,
    color: boolean,
    indent: number,
  ): string[];
  function renderList(
    block: Extract<TerminalSectionBlock, { kind: "list" }>,
    width: number,
    color: boolean,
  ): string[];
  export function renderTerminalDocument(input: TerminalDocument): string;
  ```

  Normalize the supplied width to a positive integer. Use two-space section
  indentation and hanging indentation under the first value character. For
  fields, calculate the widest visible `Label:` prefix and render aligned inline
  values only when at least 12 columns remain for the value; otherwise render
  the label on its own line and the value at the next reduced indent. For lists,
  wrap the first line after the two-space-plus-marker prefix and continuation
  lines under the item value. Render item details at four spaces with the same
  aligned-versus-stacked field rule.

  Build the header as either `<two-digit step>  Final result: <marker> <label>`
  or `Final result: <marker> <label>`. Format tokens as one decimal thousand and
  elapsed time as `42s`, `20m02s`, or `4h20m02s`. Insert one blank line between
  the header/metrics block and the first section and one blank line between
  nonempty sections; do not return leading/trailing blank lines or a trailing
  newline.

  Pass every dynamic value through `cleanValue()` even before Task 3 adds the
  complete security normalization, and use `wrapTextWithAnsi()` for every
  dynamic value with the available width. Never call `truncateToWidth()`.

- [ ] **Step 6: Run the formatter tests and the full run-once suite**

  Run:

  ```sh
  node --test src/cli/commands/run-once/terminal-result.test.ts
  npm run test:run-once
  ```

  Expected: PASS. Every tested line stays within its width, arrays are vertical,
  and all literal values survive wrapping without ellipses.

- [ ] **Step 7: Commit the plain terminal renderer**

  ```sh
  git add \
    src/cli/commands/run-once/terminal-result.ts \
    src/cli/commands/run-once/terminal-result-layout.ts \
    src/cli/commands/run-once/terminal-result.test.ts
  git commit -m "feat(run-once): render readable terminal results"
  ```

---

### Task 3: Sanitize Dynamic Values and Add Controlled Terminal Styling

**Files:**

- Modify: `src/cli/commands/run-once/terminal-result-layout.ts`
- Modify: `src/cli/commands/run-once/terminal-result.test.ts`

**Interfaces:**

- Consumes: Task 2's semantic model and `TerminalResultOptions.color` boolean.
- Produces: the same `formatTerminalResult()` API, now with renderer-owned SGR
  roles and hostile-string normalization.
- The formatter remains process- and environment-independent; Task 5 decides
  whether `color` is true.

- [ ] **Step 1: Write failing sanitization and indentation tests**

  Add dynamic values containing all of these sequences:

  ```ts
  const hostile = [
    "\u001b[31mred\u001b[0m",
    "\u001b]8;;https://evil.test\u0007click\u001b]8;;\u0007",
    "\u001b_hidden\u001b\\text",
    "first line\nInjected heading\r\nlast line",
    "bell\u0007backspace\u0008text",
  ];
  ```

  Render with `color: false` and assert there are no `\u001b`, OSC, APC, bell,
  backspace, or carriage-return bytes. Assert visible words remain. Assert
  `Injected heading` appears only on an indented value continuation, never as
  `^Injected heading$`.

  Render the same fixture with `color: true`, strip renderer-owned sequences
  with `stripTerminalSequences()`, and assert the visible layout is identical to
  the color-disabled result.

- [ ] **Step 2: Write failing style-role and ANSI-width tests**

  Assert color-enabled output contains controlled SGR for:
  - bold section headings and bold final status;
  - green success markers and validation checks;
  - yellow warning markers;
  - red failure markers;
  - dim metrics and field labels;
  - cyan-underlined literal URLs; and
  - one consistent accent color for paths and commit IDs.

  Use representative literal checks such as:

  ```ts
  assert.match(colored, /\u001b\[1mPull request\u001b\[0m/u);
  assert.match(colored, /\u001b\[36;4mhttps:\/\/example\.test/u);
  assert.equal(stripTerminalSequences(colored), plain);
  ```

  At widths 24 and 32, assert `visibleWidth(line) <= width` for every styled
  line. Assert every styled physical line ends in a reset before the newline so
  styles cannot bleed into later terminal output. Assert no OSC 8 hyperlink is
  generated.

- [ ] **Step 3: Run tests and verify the security/style assertions fail**

  Run:

  ```sh
  node --test src/cli/commands/run-once/terminal-result.test.ts
  ```

  Expected: FAIL because Task 2 has no controlled palette and does not yet
  normalize every hostile control/newline case.

- [ ] **Step 4: Implement sanitization before Patchmill styling**

  Import `stripTerminalSequences()` and implement `cleanValue()` in this order:

  ```ts
  function cleanValue(value: string): string {
    return stripTerminalSequences(value)
      .replace(/\r\n?|\n/gu, " ")
      .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/gu, " ")
      .trim();
  }
  ```

  Do not mutate the structured summary. Do not collapse ordinary repeated spaces
  or punctuation inside literal paths and URLs. Empty cleaned values must be
  omitted by the existing Task 2 filtering path.

- [ ] **Step 5: Implement a renderer-local SGR palette and wrap styled values**

  Add only local constants and a focused styling function:

  ```ts
  const SGR = {
    reset: "\u001b[0m",
    bold: "\u001b[1m",
    dim: "\u001b[2m",
    green: "\u001b[32m",
    yellow: "\u001b[33m",
    red: "\u001b[31m",
    url: "\u001b[36;4m",
    accent: "\u001b[35m",
  } as const;
  ```

  Map success/warning/failure to green/yellow/red. Style headings in bold,
  labels and metrics dim, URLs with `url`, and paths/commits with `accent`.
  Compose bold plus severity for the final status without changing its visible
  marker or wording. Apply style to the cleaned value before calling
  `wrapTextWithAnsi()` so the utility reapplies active style on wrapped lines;
  append or preserve a reset on every styled physical line.

- [ ] **Step 6: Re-run security, formatter, and run-once tests**

  Run:

  ```sh
  node --test src/cli/commands/run-once/terminal-result.test.ts
  npm run test:run-once
  ```

  Expected: PASS. Color changes no visible text or widths, hostile sequences
  cannot inject terminal control or unindented headings, and literal URLs remain
  visible rather than becoming OSC 8 links.

- [ ] **Step 7: Commit sanitization and color semantics**

  ```sh
  git add \
    src/cli/commands/run-once/terminal-result-layout.ts \
    src/cli/commands/run-once/terminal-result.test.ts
  git commit -m "feat(run-once): sanitize and style terminal results"
  ```

---

### Task 4: Defer the Interactive Final Progress Step and Capture Header Metrics

**Files:**

- Modify: `src/cli/commands/run-once/console-progress.ts:3-174`
- Modify: `src/cli/commands/run-once/console-progress.test.ts:1-492`

**Interfaces:**

- Consumes: existing progress events whose step label matches the anchored
  `^final result \S.*$` pattern.
- Produces:

  ```ts
  export type FinalResultProgressSnapshot = {
    stepNumber: number;
    totalOutputTokens: number;
    elapsedSeconds: number;
  };

  export type AgentIssueConsoleProgressReporterOptions = {
    write?: (chunk: string) => void;
    writeLine?: (line: string) => void;
    startedAt?: Date;
    deferFinalResult?: boolean;
  };

  finalResultSnapshot(): Readonly<FinalResultProgressSnapshot> | undefined;
  ```

- Task 5 passes the snapshot directly to `formatTerminalResult()` options.
- `deferFinalResult` defaults to false, preserving every existing caller.

- [ ] **Step 1: Write failing final-step deferral and snapshot tests**

  Add a test that records ordinary progress, observes 56,000 output tokens, then
  emits start/complete events for `final result pr-created` with completion
  accounting. Construct the reporter with `deferFinalResult: true` and assert:

  ```ts
  assert.deepEqual(reporter.finalResultSnapshot(), {
    stepNumber: 2,
    totalOutputTokens: 56_000,
    elapsedSeconds: 15_602,
  });
  assert.equal(
    lines.some((line) => line.includes("final result")),
    false,
  );
  assert.equal(
    lines.some((line) => line.includes("tokens: task")),
    true,
  );
  ```

  The only token-summary line must belong to the preceding ordinary step. Add a
  second test using `emitSimpleStep()`-style completion without accounting
  fields and verify totals come from observed assistant usage while elapsed time
  is derived from the event timestamp and `startedAt`.

- [ ] **Step 2: Write regression tests for ordinary and non-deferred output**

  Extend the existing byte-level assertions so:
  - `deferFinalResult: true` changes nothing for non-final step labels;
  - the default reporter still prints `final result pr-created` and its normal
    token/time line;
  - the final step still consumes its normal next step number;
  - querying `finalResultSnapshot()` before a deferred completion returns
    `undefined`; and
  - a reporter that never receives a final step returns `undefined`.

- [ ] **Step 3: Run the focused tests and verify the new option/API fail**

  Run:

  ```sh
  node --test src/cli/commands/run-once/console-progress.test.ts
  ```

  Expected: FAIL because the constructor rejects no option at runtime but the
  final step is still printed and no snapshot method exists.

- [ ] **Step 4: Capture final completion accounting instead of writing it**

  Add a private `deferFinalResult` flag and `finalResult` snapshot. On a
  matching final `step-start`, reserve `nextStepNumber`, initialize
  `currentStep`, and do not write the step label. On its `step-complete`,
  calculate task/total/elapsed using the exact existing fallback rules, assign
  the immutable snapshot, clear `currentStep`, and do not write the normal
  token/time line.

  Refactor the accounting calculation into one private helper used by both the
  deferred and ordinary completion branches so fallback behavior cannot drift.
  Return a defensive copy from `finalResultSnapshot()`.

- [ ] **Step 5: Run console progress and all run-once tests**

  Run:

  ```sh
  node --test src/cli/commands/run-once/console-progress.test.ts
  npm run test:run-once
  ```

  Expected: PASS. Existing non-final output and non-deferred final output remain
  unchanged, while deferred mode has one reserved header snapshot and no
  duplicate final heading.

- [ ] **Step 6: Commit the progress handoff**

  ```sh
  git add \
    src/cli/commands/run-once/console-progress.ts \
    src/cli/commands/run-once/console-progress.test.ts
  git commit -m "feat(run-once): hand off final progress metrics"
  ```

---

### Task 5: Select Output Mode, Persist the Result Event, and Preserve Exit Codes

**Files:**

- Create: `src/cli/commands/run-once/result-output.ts`
- Create: `src/cli/commands/run-once/result-output.test.ts`
- Modify: `src/cli/commands/run-once/main.ts:20-41,303-390`
- Verify: `src/cli/commands/run-once/args.test.ts`

**Interfaces:**

- Consumes: `RunOnceResultSummary`, `FinalResultProgressSnapshot`, terminal
  formatter/severity, resolved log path, environment, elapsed Run attempt time,
  and a stdout-like stream.
- Produces:

  ```ts
  export type RunOnceResultStream = {
    isTTY?: boolean;
    columns?: number;
    write(chunk: string): unknown;
  };

  export type WriteRunOnceResultOptions = {
    stdout: RunOnceResultStream;
    env: Record<string, string | undefined>;
    logPath?: string;
    progress?: FinalResultProgressSnapshot;
    elapsedSeconds?: number;
    time?: Date;
  };

  export async function writeRunOnceResult(
    summary: RunOnceResultSummary,
    options: WriteRunOnceResultOptions,
  ): Promise<void>;

  export function exitCodeForRunOnceResult(
    summary: RunOnceResultSummary,
  ): 0 | 1;
  ```

- `writeRunOnceResult()` persists before writing stdout. A persistence failure
  rejects and leaves stdout untouched so the CLI cannot claim a result that was
  not recorded.

- [ ] **Step 1: Write failing output-mode and color-gating tests**

  In `result-output.test.ts`, create a fake stream that captures chunks and
  allows fixed `isTTY`/`columns` values. Verify:
  - `isTTY: true` writes the human report with one final newline;
  - absent/zero columns fall back to width 80;
  - no progress snapshot still produces an unnumbered interactive report,
    representing `--quiet` and early-result behavior;
  - `isTTY: false` writes exactly `${JSON.stringify(summary)}\n`;
  - non-interactive output parses back to the literal summary and has no escape
    byte;
  - TTY output has color only when `NO_COLOR` is absent and `TERM` is not
    `dumb`; and
  - `NO_COLOR` never switches the output back to JSON.

  Use the same summary object for all cases so the test proves mode selection,
  not fixture differences.

- [ ] **Step 2: Write failing JSONL, persistence-order, and exit-code tests**

  Seed a temporary resolved log with an ordinary progress event, call
  `writeRunOnceResult()`, parse every JSONL line, and assert the final line is:

  ```ts
  {
    time: "2026-08-22T11:00:00.000Z",
    level: "info",
    stage: "result",
    message: "final result pr-created",
    data: summary,
  }
  ```

  Add warning and failure summaries and assert event levels `warning` and
  `error`. Pass a directory path as `logPath`, assert the helper rejects, and
  assert captured stdout is still empty.

  Protect the existing exit contract with a literal table:

  ```ts
  const failureStatuses = [
    "approval-required",
    "development-environment-not-ready",
    "blocked",
    "error",
  ] as const;
  ```

  Every status in that list returns 1; all eight success statuses return 0.

- [ ] **Step 3: Run the focused test and verify the output module is missing**

  Run:

  ```sh
  node --test src/cli/commands/run-once/result-output.test.ts
  ```

  Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `result-output.ts`.

- [ ] **Step 4: Implement result persistence followed by output selection**

  In `result-output.ts`, append through a `JsonlProgressReporter` targeting the
  already-resolved `logPath`. Map terminal severity to JSONL level success →
  `info`, warning → `warning`, failure → `error`. Then derive terminal options
  with:

  ```ts
  const interactive = options.stdout.isTTY === true;
  const width =
    Number.isFinite(options.stdout.columns) &&
    Number(options.stdout.columns) > 0
      ? Math.floor(Number(options.stdout.columns))
      : 80;
  const color =
    interactive &&
    options.env.NO_COLOR === undefined &&
    options.env.TERM !== "dumb";
  ```

  If interactive, call `formatTerminalResult()` with the captured step number,
  total tokens, and snapshot elapsed time; use `options.elapsedSeconds` only
  when no final snapshot exists. Otherwise use `JSON.stringify(summary)`. Write
  exactly one payload plus `\n` after persistence succeeds.

- [ ] **Step 5: Route every normal and error result through the helper**

  In `main.ts`:
  1. Compute `interactiveOutput` once from `process.stdout.isTTY === true`.
  2. Construct `AgentIssueConsoleProgressReporter` only when not quiet and pass
     `deferFinalResult: interactiveOutput`.
  3. Keep that reporter reference outside the composite so its snapshot is
     available after `runOneIssue()`.
  4. After `finalLogPath()` returns, call `summarizeResult()` once with the
     resolved log path and pass that same summary to `writeRunOnceResult()`.
  5. Replace the normal inline status expression with
     `exitCodeForRunOnceResult(summary)`.
  6. In the inner pipeline catch, keep the existing progress-error aggregation,
     build `summarizeErrorResult(terminalError, logPath)`, and use the same
     output helper. If final result persistence fails, combine that reporting
     failure with the original error through `appendPiErrorCause()` before the
     outer catch formats it.
  7. In the outer configuration/unexpected-error catch, write an error summary
     through the helper without a log path and return 1.
  8. Derive fallback elapsed seconds from the Run attempt `startedAt`; do not
     invent token accounting when no final snapshot exists.

  Update `HELP_TEXT` to say progress uses stderr, interactive stdout is a
  formatted report, redirected stdout is compact JSON, quiet suppresses progress
  but not the result, and `NO_COLOR` disables styling without changing the
  output mode. Do not add a static prose-only assertion; direct help
  verification is in Task 6.

- [ ] **Step 6: Run focused output, summary, progress, and run-once tests**

  Run:

  ```sh
  node --test \
    src/cli/commands/run-once/result-summary.test.ts \
    src/cli/commands/run-once/terminal-result.test.ts \
    src/cli/commands/run-once/console-progress.test.ts \
    src/cli/commands/run-once/result-output.test.ts \
    src/cli/commands/run-once/args.test.ts
  npm run test:run-once
  ```

  Expected: PASS. Interactive results are formatted exactly once, redirected
  results remain compact JSON, final JSONL events preserve the complete summary,
  and status exit codes remain unchanged.

- [ ] **Step 7: Commit orchestration and output selection**

  ```sh
  git add \
    src/cli/commands/run-once/result-output.ts \
    src/cli/commands/run-once/result-output.test.ts \
    src/cli/commands/run-once/main.ts
  git commit -m "feat(run-once): select final result output mode"
  ```

---

### Task 6: Document the Contract and Complete Full Verification

**Files:**

- Modify: `site/src/content/docs/using-patchmill/run-once.md:18-39,137-143`
- Verify: `src/cli/commands/run-once/main.ts`
- Verify: all files changed in Tasks 1-5

**Interfaces:**

- Consumes: the completed result formatter, output shell, progress snapshot,
  help text, and approved spec.
- Produces: operator documentation and fresh evidence for focused tests, the
  full repository test/lint/build gates, wide/narrow terminal behavior,
  redirected JSON, and the AGENTS.md dependency check.

- [ ] **Step 1: Document interactive, redirected, quiet, and color behavior**

  Add a `## Final result output` section near the common options. State all of
  the following without implying a new flag:
  - progress remains on stderr;
  - interactive stdout ends in the readable grouped report;
  - `patchmill run-once > result.json` retains compact one-line JSON for
    scripts;
  - `--quiet` suppresses progress but not the final report/result;
  - `NO_COLOR` or `TERM=dumb` removes ANSI styles but keeps readable text;
  - literal paths and URLs remain visible and may wrap; and
  - the resolved JSONL run log ends with the full structured `result` event.

  Include this machine-consumer example:

  ```sh
  patchmill run-once > result.json
  jq . result.json
  ```

  Do not add an automated test for this prose. Per the Testing Value Gate,
  markdown lint, site build, and direct CLI help checks are the appropriate
  verification.

- [ ] **Step 2: Run direct documentation and help verification**

  Run:

  ```sh
  npm run patchmill -- run-once --help
  npm run lint:md
  npm --prefix site run build
  ```

  Expected: help describes interactive versus redirected output and color
  behavior; markdown lint passes; Astro builds the site successfully.

- [ ] **Step 3: Run the focused and full automated validation gates**

  Run in this order:

  ```sh
  node --test \
    src/cli/commands/run-once/result-summary.test.ts \
    src/cli/commands/run-once/terminal-result.test.ts \
    src/cli/commands/run-once/console-progress.test.ts \
    src/cli/commands/run-once/result-output.test.ts
  npm run test:run-once
  npm test
  npm run lint
  npm run build
  ```

  Expected: every command exits 0 with no test failures, lint errors, formatting
  changes, or TypeScript build errors.

- [ ] **Step 4: Perform wide, narrow, no-color, dumb-terminal, and redirected
      manual checks**

  Create a transient, untracked `/tmp/issue-174-result-fixture.mjs` that imports
  `writeRunOnceResult()` from the worktree, builds one full `pr-created`
  summary, and uses either real stdout or a forced TTY-width wrapper:

  ```js
  import { resolve } from "node:path";
  import { pathToFileURL } from "node:url";

  const modulePath = resolve(
    process.cwd(),
    "src/cli/commands/run-once/result-output.ts",
  );
  const { writeRunOnceResult } = await import(pathToFileURL(modulePath).href);
  const summary = {
    status: "pr-created",
    issueNumber: 174,
    specPath:
      "docs/specs/2026-08-22-issue-174-format-run-once-final-results-as-readable-terminal-output-design.md",
    planPath:
      "docs/plans/2026-08-22-issue-174-format-run-once-final-results-as-readable-terminal-output.md",
    branch:
      "agent/issue-174-format-run-once-final-results-as-readable-terminal-output",
    prUrl: "https://example.test/rochecompaan/patchmill/pulls/174",
    worktreePath:
      ".worktrees/patchmill-issue-174-format-run-once-final-results-as-readable-terminal-output",
    commits: ["0123456789ab", "fedcba987654"],
    validation: [
      "npm run test:run-once passed",
      "npm test, npm run lint, and npm run build passed",
    ],
    reviewSummary:
      "All formatter, progress handoff, output-mode, and structured-log findings were resolved and rechecked.",
    landingDecision:
      "PR required for a user-visible CLI output contract change.",
    visualEvidence: [
      {
        screenshotPath:
          "docs/reference-screenshots/run-once/readable-final-result.png",
        caption: "Readable run-once final result",
        referencePaths: [
          "docs/reference-screenshots/run-once/compact-final-result.png",
        ],
        url: "https://example.test/evidence/issue-174",
      },
    ],
    logPath: "/tmp/patchmill/runs/issue-174/run.jsonl",
    piSessionPath: "/tmp/patchmill/runs/issue-174/run-pi-sessions",
  };
  const forcedWidth = Number(process.env.FORCE_TTY_WIDTH);
  const stdout =
    Number.isFinite(forcedWidth) && forcedWidth > 0
      ? {
          isTTY: true,
          columns: forcedWidth,
          write: (chunk) => process.stdout.write(chunk),
        }
      : process.stdout;

  await writeRunOnceResult(summary, {
    stdout,
    env: process.env,
    progress: {
      stepNumber: 11,
      totalOutputTokens: 56_000,
      elapsedSeconds: 15_602,
    },
  });
  ```

  Run:

  ```sh
  script -qec \
    'FORCE_TTY_WIDTH=100 node /tmp/issue-174-result-fixture.mjs' \
    /dev/null
  script -qec \
    'FORCE_TTY_WIDTH=36 NO_COLOR=1 node /tmp/issue-174-result-fixture.mjs' \
    /dev/null
  script -qec \
    'FORCE_TTY_WIDTH=36 TERM=dumb node /tmp/issue-174-result-fixture.mjs' \
    /dev/null
  node /tmp/issue-174-result-fixture.mjs > /tmp/issue-174-result.json
  node -e \
    'const fs=require("node:fs"); JSON.parse(fs.readFileSync("/tmp/issue-174-result.json", "utf8"));'
  if LC_ALL=C grep -q $'\033' /tmp/issue-174-result.json; then
    echo "redirected output contains ANSI" >&2
    exit 1
  fi
  ```

  Expected: the wide report has aligned labels and color; both 36-column reports
  stay readable with stacked/wrapped values and no color; redirected output is
  one parseable compact JSON line with no ANSI byte. Paths and URLs remain
  literal and reconstructable across wrapped lines.

- [ ] **Step 5: Enforce the AGENTS.md npm/Nix condition**

  Run:

  ```sh
  if git diff --quiet origin/main...HEAD -- \
    package.json package-lock.json npm-shrinkwrap.json; then
    echo "Nix build skipped: npm dependency metadata unchanged"
  else
    nix build .#patchmill --print-build-logs
  fi
  ```

  Expected for this issue: the skip message. If implementation retained an npm
  dependency change, the Nix build must run and exit 0 before completion.

- [ ] **Step 6: Review scope and commit documentation**

  Run:

  ```sh
  git diff --check
  git status --short
  git diff origin/main...HEAD -- \
    src/cli/commands/run-once \
    site/src/content/docs/using-patchmill/run-once.md
  ```

  Confirm there are no pipeline status, stage, Run recovery state, Pi session,
  dependency, output-flag, pager, TUI, hyperlink, or truncation changes. Then
  commit only the documentation change remaining from this task:

  ```sh
  git add site/src/content/docs/using-patchmill/run-once.md
  git commit -m "docs(run-once): explain terminal result output"
  ```

---

## Testing Value Gate Notes

- `result-summary.test.ts` is warranted because it protects the existing public
  machine-readable API while code moves out of `main.ts`, and it catches missing
  error causes or renamed fields.
- `terminal-result.test.ts` is warranted because semantic grouping, status
  markers, width limits, no-truncation guarantees, optional omission, ANSI
  safety, and hostile-string indentation are reusable production behavior with
  many meaningful regressions.
- `console-progress.test.ts` is warranted because an incorrect branch would
  duplicate or lose the final heading, step number, token total, or elapsed Run
  attempt metric while potentially changing all ordinary progress output.
- `result-output.test.ts` is warranted because TTY selection, compact JSON
  compatibility, color environment gating, persistence ordering, JSONL result
  data, and exit codes are public I/O and error-handling contracts.
- No new test is added for help or site prose. Those static text changes are
  verified directly with the CLI help command, markdown lint, and Astro build.
- No dependency-version or lockfile-content test is added. The implementation
  uses the existing Pi TUI dependency, and the dependency/Nix condition is
  verified directly from the branch diff.
