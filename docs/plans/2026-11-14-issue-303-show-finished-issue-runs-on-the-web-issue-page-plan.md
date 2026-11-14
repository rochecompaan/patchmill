# Finished Issue runs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use the sibling `executing-plans`
> skill for inline, task-by-task execution. Steps use checkbox (`- [ ]`) syntax
> for tracking. This kernel run does not authorize per-task implementation
> delegation.

**Goal:** Show finished and stopped Issue runs as safe, chronological issue
pages with final metadata, tools, progress, and cost.

**Architecture:** Extend the existing `RunDataSource` seam with selected-issue
reads. Keep confined discovery and transcript projection behind a deep detail
module. Add diagnostic history and complete launch-local planning copies where
current writers lose required evidence.

**Tech Stack:** Node.js TypeScript, `node:test`, plain browser JavaScript with
JSDoc, existing CSS, and Chromium through the existing browser-check pattern. No
new dependencies.

**Spec:**
[Finished Issue runs design](../specs/2026-11-14-issue-303-show-finished-issue-runs-on-the-web-issue-page-design.md)

**Mockup input:**
[Full-page issue states](../mockups/2026-11-14-issue-303-finished-runs.html)

**Other inputs:** `AGENTS.md`, `docs/agents/domain.md`, `GLOSSARY.md`, the
linked #302 specification, and `docs/mockups/web/run-once-workflow.md`.

**Inspected base:** `7dbac5292d49753be55e73189b66bfa1ba548192`.

## Global Constraints

- Add no npm dependencies, browser framework, or browser build step.
- Preserve authentication, Host/Origin checks, CSP, and static-file confinement.
- Honor `paths.runsDir`, `paths.specsDir`, `paths.plansDir`, and workflow mode.
- The web server never starts runs, syncs workflow state, fetches Git refs, or
  mutates host data.
- Read detailed logs only for the requested eligible issue, never for a board
  request or an unknown issue number.
- Treat issue bodies, messages, prompts, tool input/output, and errors as text.
- Do not expose detailed text or issue bodies in board JSON.
- Keep sample mode functional and preserve board polling at 15,000 milliseconds.
- Support current run formats only. Do not restore the retired filenames in the
  original issue description.
- Keep live updates, subagent transcripts, closed-issue discovery, and chat
  outside this implementation.

## Review Focus

- A fork copies old messages: show each retained entry once, not a repeated
  planning conversation. Task 2 exercises launch-time filtering and ID reuse.
- Different issues load concurrently: never share one issue's private detail
  with another request. Task 3 exercises keyed in-flight work and unknown IDs.
- A run stops during a tool call: show stopped output, not a forever-running
  tool or a false successful result. Tasks 2 and 4 exercise this state.
- A session file is a symlink or has a huge damaged line: read no outside file
  and retain later valid entries. Task 2 exercises both inputs.
- Billing includes subagents while the thread excludes them: keep the recorded
  total without exposing nested conversations. Tasks 2 and 4 exercise this
  distinction and unavailable prices.

## File structure and ownership

- `src/kernel/run-history.ts`: ordered, best-effort diagnostic history writer.
- `src/kernel/run-once.ts`: retain terminal formatter outputs, launch identity,
  snapshot history, and the optional ended result projection. Keep workflow
  selection and publication unchanged.
- `src/console/planning-usage.ts` and `planning-conversation.ts`: complete,
  sanitized launch-local copies with an explicit injected-prompt marker.
- `src/web/file-run-records.ts`: confined attempt metadata discovery shared by
  `file-run-observations.ts` and the detail reader.
- `src/web/file-issue-detail.ts`: requested issue projection and degradation.
- `src/web/pi-thread.ts`: session-local message/tool normalization. This is an
  internal implementation file, not a new public transport seam.
- `src/kernel/issue-cost.ts`: an optional validated run-ID selection, without
  changes to default cost arithmetic or publication.
- `src/web/run-data.ts`, `api-types.ts`, `api.ts`, `file-run-data.ts`, and
  `sample-data.ts`: selected detail contracts and adapter integration.
- `web/issue.js`, `web/thread.js`, and their CSS: header, prompt details,
  history, no-run body, and active-history message.
- `test-support/issue-thread-fixture.ts`: compact current-format file builders.
- New feature tests live beside their modules. Extend existing source, HTTP,
  console, and sample tests instead of duplicating their assertions.
- `scripts/check-issue-thread-layout.mjs`: authenticated browser regression over
  the real file adapter and sanitized fixture files.

Keep discovery, Pi projection, and browser rendering separate by behavior. Do
not add generic helpers, filesystem adapters, or barrels. `run-once.ts` is
already large. Add only the recording call sites there, not parser logic.

## Task 1: Retain evidence that current runs discard

**Files:**

- Create: `src/kernel/run-history.ts`, `src/kernel/run-history.test.ts`.
- Modify: `src/kernel/run-once.ts`, `src/kernel/run-progress.test.ts`,
  `src/kernel/run-once-output.test.ts`, `src/kernel/run-once-failures.test.ts`.
- Modify: `src/console/planning-usage.ts`, `planning-usage.test.ts`,
  `planning-conversation.ts`.

**Interfaces:**

- Consume `RunProgress`, `Phase`, `PhaseLaunch`, and the existing console
  formatter strings. Preserve `RunOnceOutcome` and all required result fields.
- Produce `createRunHistory({ issue, runId, runDir, now, warn })` with awaited
  `snapshot(progress: RunProgress): Promise<void>`,
  `session({ number, phase, stage }): Promise<void>`, and
  `progress(stream: "stdout" | "stderr", text: string): Promise<void>`.
- Records have `schemaVersion`, `issue`, `runId`, `sequence`, `at`, `kind`, and
  the matching payload defined in the spec. Append to `history.jsonl`.
- Extend `recordPlanningUsage(session, sessionDir, plan, options?)` with
  `options: { prompt?: string; warn?: (message: string) => void }`. Preserve its
  `Promise<PhaseRun>` return and original Pi entry/usage fields.

- [ ] **Step 1: Add failing observable retention tests.**

  Reuse the existing run fixtures and formatter functions. Assert these values:

  ```typescript
  assert.deepEqual(
    records.map((r) => r.sequence),
    [1, 2, 3],
  );
  assert.deepEqual(
    records.map((r) => r.kind),
    ["snapshot", "session", "progress"],
  );
  assert.equal(records[2].text, formatPhaseStart("planning", 1));
  assert.equal(result.progress.state, "ended");
  assert.equal(result.progress.outcome.label, "done");
  assert.deepEqual(
    copied.map((r) => r.message?.role),
    ["user", "assistant", "toolResult"],
  );
  assert.equal(copied[0].patchmillPrompt, true);
  assert.equal(
    JSON.stringify(copied).includes("private-thinking-marker"),
    false,
  );
  ```

  Test an actual print-mode run and an Interactive Issue run copy. Assert that
  earlier console entries, thinking, and attachment payloads are absent. Assert
  that usage totals remain unchanged and the zero-reply fallback stays. Inject
  history and copy write errors. Assert a warning, the unchanged verified
  outcome, observer delivery, and released lock. A failed atomic progress write
  must not prevent history retention, or the reverse.

- [ ] **Step 2: Run the targeted tests and record the expected failure.**

  Run:
  `node --test src/kernel/run-history.test.ts src/kernel/run-progress.test.ts src/kernel/run-once-output.test.ts src/kernel/run-once-failures.test.ts src/console/planning-usage.test.ts`.
  Expect missing history/copy assertions to fail before implementation.

- [ ] **Step 3: Implement the writer and recording call sites.**

  Use the existing issue lock and awaited operations. Record every snapshot,
  session launch, and exact output from the four terminal formatters. Capture
  `facts.stage` at launch. Add an optional ended `progress: RunProgress` field
  to each result without removing existing fields. Catch diagnostic errors
  independently and warn without private text. Never replace the observer.

  Compute the actual injected planning text once in
  `PlanningConversation.run()`. Pass it to the recorder to mark only its exact
  user entry. Keep subsequent human messages expanded. Sanitize copies without
  mutating `SessionManager` entries. Copy errors return the accepted phase
  result and issue a warning. Do not change the main worker launcher or recurse
  into its nested agents.

- [ ] **Step 4: Run targeted tests, including cost compatibility.**

  Run the Step 2 command, then
  `node --test src/kernel/run-once-cost.test.ts src/console/planning-usage.test.ts`.
  Expect all tests to pass with unchanged publication and usage behavior.

- [ ] **Step 5: Commit the diagnostic retention change.**

  Commit the named files with `feat: retain issue thread diagnostics`.

## Task 2: Build a safe finished-run detail snapshot

**Files:**

- Create: `src/web/file-run-records.ts`, `src/web/file-issue-detail.ts`,
  `src/web/pi-thread.ts`, `src/web/file-issue-detail.test.ts`,
  `test-support/issue-thread-fixture.ts`.
- Modify: `src/web/file-run-observations.ts`, `file-run-observations.test.ts`,
  `src/kernel/issue-cost.ts`, `issue-cost.test.ts`, `src/web/api-types.ts`.

**Interfaces:**

- Produce
  `readIssueRunRecords(input: { repoRoot: string; config: PatchmillConfig; issue: number; warn: (message: string) => void }): Promise<readonly IssueRunRecord[]>`.
  Each internal `IssueRunRecord` contains validated `runId`, `startedAt`,
  nullable `finishedAt`, nullable outcome, ordered session phases, and nullable
  final `RunProgress`. Never return a path from untrusted record content.
- Produce
  `readIssueDetail(input: { repoRoot: string; config: PatchmillConfig; issue: Issue; summary: IssueSummary; observation: RunObservation; warn: (message: string) => void }): Promise<IssueDetail>`.
- Enrich `RunObservation` with retained metadata, aggregate start/end/duration,
  latest run identity, and historical final PR facts. Keep existing fields for
  board callers. Reuse the shared reader rather than a second result parser.
- Add `IssueDetail.body`, `IssueDetail.run`, and the `ThreadEvent` prompt
  variant exactly as specified. Keep all existing variants and schema version 1.
- Extend `readIssueCostReport(issueDir, current?, selection?)` with
  `selection?: { runIds: readonly string[] }`. Omitted selection preserves all
  existing kernel behavior. Reuse its arithmetic after confined validation.

- [ ] **Step 1: Add failing fixture-driven tests through `readIssueDetail()`.**

  The fixture builder writes valid result/progress/history and Pi JSONL files
  under a temporary configured run root. Use deterministic dates and IDs. Each
  fixture tests meaningful runtime behavior, not document wording.

  ```typescript
  assert.deepEqual(attemptDividers(detail), ["Run attempt 1", "Run attempt 2"]);
  assert.deepEqual(steps(detail), ["planning", "implementation"]);
  assert.equal(detail.summary.elapsedSeconds, 90); // 30s + 60s, not the gap
  assert.equal(detail.thread.filter((e) => e.kind === "tool").length, 2);
  assert.equal(tool(detail, "read").result, "<script>text only</script>");
  assert.equal(tool(detail, "bash").state, "stopped");
  assert.equal(detail.finalUsage?.cost?.amount, "0.3000");
  assert.equal(detail.body, null);
  ```

  Give the fixture two attempts separated by a long gap. Add a blocked result
  with exact questions and a result without session files. Assert the specified
  fallback progress/transcript notices. Add a no-run case with `body` exactly
  `<script>text only</script>` and an empty thread.

  Assert active ownership withholds history and cost. Assert an unlocked
  unfinished attempt is incomplete. A newer attempt must win over stale
  progress. Preserve older current-format assistant-only planning copies.

  Add invalid middle/tail lines, a line over 16 MiB, unknown records, absent
  timestamps, tied timestamps, and reversed filesystem enumeration. Assert later
  valid text and stable order. Join out-of-order tool results by ID. Preserve
  message/tool content-block order. Assert 8,000-character output limits, the
  shortening notice, failed results, and unsupported attachments.

  Add copied ancestor entries before the launch/header time, exact duplicate
  entries, and equal IDs with different content. Assert only true duplicates
  disappear. A nested subagent message marker must not appear in the thread. Its
  usage must still contribute to the final cost. Missing usage or prices must
  produce null values, not zero or a partial complete total.

  Add file and directory symlinks to outside sentinels. Assert that no sentinel
  reaches output and the issue remains readable. Wrong issue/run IDs and
  non-generated directories must not enter history or costs.

- [ ] **Step 2: Run tests and verify the intended failures.**

  Run:
  `node --test src/web/file-issue-detail.test.ts src/web/file-run-observations.test.ts src/kernel/issue-cost.test.ts`.
  Expect the new module or projection assertions to fail before implementation.

- [ ] **Step 3: Implement confined discovery and projection.**

  Move result discovery/validation from `file-run-observations.ts` into the
  shared metadata reader without changing lock classification. Preserve #302
  precedence and identity checks. Accept older current-format results without
  the optional final projection. Read transcripts only for selected details.

  Stream JSONL with per-line validation and a 16 MiB line limit. Reject symlinks
  and nonregular files. Read only immediate main transcript files inside numeric
  sessions. Never follow `parentSession`. Keep cost traversal separate from
  thread traversal, validate it before use, and supply the accepted run IDs.

  Use the spec's ordering, inheritance cutoff, stable ID, and tool-pairing
  rules. A missing tool result produces `stopped` plus “Output not recorded”.
  Keep prompt classification explicit for new console copies. Collapse the first
  non-inherited user prompt in print/main-worker sessions.

  Return plain text blocks and JSON input. Shorten tool output only after text
  normalization. Reuse the cost module and catch unavailable reports. Add
  blockers only to details, never to public summary text.

- [ ] **Step 4: Run feature and existing observation/cost tests.**

  Run the Step 2 command, then
  `node --test src/kernel/pi-cost.test.ts src/kernel/run-once-cost.test.ts src/web/board-projection.test.ts`.
  Expect all tests to pass. Default cost callers and existing board rules must
  remain unchanged.

- [ ] **Step 5: Commit the detail module.**

  Commit the named files with `feat: project finished issue run details`.

## Task 3: Connect selected details without reading every transcript

**Files:**

- Modify: `src/web/run-data.ts`, `api.ts`, `file-run-data.ts`, `sample-data.ts`.
- Modify: `src/web/file-run-data.test.ts`, `server-api.test.ts`,
  `server-security.test.ts`, `sample-data.test.ts`, `board-projection.ts`,
  `board-projection.test.ts`.

**Interfaces:**

- Consume Task 2's detail interface and enriched observation metadata.
- Produce `RunDataSource.snapshot(selection?: { issue: number })`. The file
  adapter returns `details: {}` for board requests and only the requested detail
  for an eligible issue. The sample adapter retains its complete immutable fixed
  snapshot with null body/run defaults.
- `apiResponse("/api/issues/N", source)` passes `{ issue: N }` after validation.
  Preserve all HTTP routes and existing error codes.
- Keep `IssueSummary` values consistent between the board and selected detail,
  including step, elapsed time, historical final PRs, and document links.

- [ ] **Step 1: Add failing selection, confidentiality, and concurrency tests.**

  Update older tests that assume every `snapshot()` eagerly builds details. Keep
  their original board assertions and request selected details explicitly.

  ```typescript
  assert.deepEqual((await source.snapshot()).details, {});
  assert.equal((await source.snapshot({ issue: 9 })).details["9"]?.body, body);
  assert.equal(
    JSON.stringify(boardResponse).includes("private-thread-marker"),
    false,
  );
  assert.equal(issueResponse.issue.thread.some(hasPrivateMarker), true);
  assert.deepEqual(
    issueResponse.issue.summary,
    boardResponse.issues.find(isNine),
  );
  assert.notEqual(changedDetail.revision, previousDetail.revision);
  assert.equal(unchangedBoard.revision, previousBoard.revision);
  ```

  Defer two different issue detail reads and complete them in reverse order.
  Assert correct details for each caller and one shared cold host refresh.
  Assert same-selection coalescing. Unknown/invalid/excluded issue requests and
  unauthenticated requests must not open transcript files. Use an injected
  blocking sentinel or observable read accessor around the existing fixture, not
  a production filesystem port solely for tests.

  Assert immutable snapshots, detail revisions from content, board-only change
  notifications, and unchanged revisions after a fake clock tick. Preserve
  local-mode repository checks, warm-cache role changes, custom paths, and the
  no-mutation host spy. Test validated closed/merged historical PR links, host
  precedence, wrong fork/base rejection, and no saved-open review promotion.

- [ ] **Step 2: Run source and HTTP tests to verify failure.**

  Run:
  `node --test src/web/file-run-data.test.ts src/web/server-api.test.ts src/web/server-security.test.ts src/web/sample-data.test.ts src/web/board-projection.test.ts`.
  Expect new selection and real-detail assertions to fail.

- [ ] **Step 3: Implement adapter/route integration.**

  Key pending snapshot work by selection, while retaining the existing shared
  host cache. Build summaries without transcript scans. Call the detail module
  only after eligibility. Hash public summaries for the board revision and the
  selected detail for issue revisions. Notify subscriptions only for board
  changes. Freeze returned data as before.

  Enrich summary step and elapsed metadata without changing classification.
  Associate retained final PR facts through the existing repository/base rules.
  Keep Git document discovery immutable and shared per snapshot. Supply null
  fields in samples without changing their content.

- [ ] **Step 4: Run source, HTTP, cache, and document-link tests.**

  Run the Step 2 command, then
  `node --test src/web/host-board-cache.test.ts src/web/document-links.test.ts src/web/server-resources.test.ts`.
  Expect all tests to pass with no extra host calls per issue.

- [ ] **Step 5: Commit selected detail reads.**

  Commit the named files with `feat: load issue snapshots on demand`.

## Task 4: Show real history and verify the complete page

**Files:**

- Modify: `web/issue.js`, `web/thread.js`, `web/styles/issue.css`,
  `web/styles/thread.css`, and `web/dom.js` only if newline handling needs it.
- Modify: `src/web/browser-presentation.test.ts`, `browser-state.test.ts`,
  `browser-client.test.ts`, and existing browser assertions as needed.
- Create: `scripts/check-issue-thread-layout.mjs`.
- Create: `docs/reviews/2026-11-14-issue-303-finished-runs-verification.md`.
- Add implementation screenshots through the installed visual-evidence skill.

**Interfaces:**

- Consume the unchanged `renderIssue(doc, detail, name, draft, source)` and
  `renderThread(doc, detail)` interfaces with Task 2's additional fields.
- Render prompt rows as native closed `details` with stable `data-key` IDs.
  Reuse existing expansion-state capture and restoration.
- Keep `web/controller.js` issue navigation load-only. No issue polling or
  streaming connection is added.

- [ ] **Step 1: Add failing runtime rendering and browser regressions.**

  Follow `scripts/check-serve-layout.mjs`: use Chromium/CDP, an ephemeral
  authenticated server, the real file adapter, and temporary fixture files. Do
  not introduce a browser library or expose test-only production routes.

  ```javascript
  assert.equal(await evaluate('document.querySelectorAll(".tool").length'), 2);
  assert.equal(await evaluate('document.querySelector(".prompt").open'), false);
  assert.equal(await evaluate('document.querySelector(".tool").open'), true);
  assert.equal(await evaluate("window.issueHtmlExecuted ?? false"), false);
  assert.equal(
    await evaluate("document.documentElement.scrollWidth <= innerWidth"),
    true,
  );
  ```

  Open the tool before its open-state assertion. Check actual input/output,
  tool-state text, blocker questions, final cost for stopped and completed runs,
  and the explicit all-attempt label. Verify literal HTML in body, agent text,
  prompts, arguments, output, and errors. Verify no-run body plus empty thread,
  active-history withholding, and unavailable cost without fake zero tokens.
  Include keyboard toggling and focus, both themes, 390px and desktop widths.
  Verify that no issue refresh timer or mutation request starts.

- [ ] **Step 2: Run the new browser check and verify failure.**

  Run:
  `CHROMIUM="$(command -v chromium-browser || command -v chromium)" node scripts/check-issue-thread-layout.mjs`.
  Expect the current live placeholder to fail the real-thread assertions.

- [ ] **Step 3: Implement the page against the mockup and specification.**

  Remove the unconditional live-source placeholder. Show the real thread for
  ended/incomplete runs. Show the no-run body as text and an empty thread. Show
  the explicit future-live message for active runs. Preserve view-only composer
  and header-control behavior. Do not introduce chat.

  Show start/end times, step, elapsed time, existing immutable document links,
  historical PR links, and final all-attempt usage. Cost must not require
  `status === "done"`, because stopped runs also have final usage. Preserve
  unknown token/cost values. Use safe DOM construction, never `innerHTML`.

  Keep the existing theme tokens, typography, rail, gutters, and tool styling.
  Add wrapped prompt text, compact tool previews, readable error text, and code
  overflow confinement. Keep native keyboard disclosure behavior.

- [ ] **Step 4: Validate functionality, visual evidence, and source parity.**

  Run `npm test`, `npm run check:types`, and `npm run lint`. Expect exit code 0
  for each. Run the new browser check and
  `CHROMIUM="$(command -v chromium-browser || command -v chromium)" npm run test:web`.
  Expect both browser checks to pass. If npm dependencies change, run the Nix
  build required by `AGENTS.md`.

  Inspect an eligible finished/stopped repository issue in a browser. Compare
  every attempt's steps and main tool-call count with the retained Pi files.
  Compare terminal progress where history exists. For older files, record the
  specific unavailable evidence rather than invent a successful comparison.
  Compare the header total with `readIssueCostReport()`/the PR cost report and
  the attempt progress cost with that attempt's terminal result.

  Read and follow the installed `patchmill-visual-evidence` and
  `patchmill-frontend-review` skills. Commit desktop/mobile evidence in both
  themes. Cover an expanded tool, collapsed prompt, blocked run, no-run body,
  and active withholding. Record source identity, commands, results, parity
  limits, and frontend-review findings in the verification document.

- [ ] **Step 5: Commit the page and verification artifacts.**

  Commit the named files and screenshots with
  `feat: show finished issue run threads`. Follow the implementation session's
  required final review and publication process. Do not change labels or post
  issue comments from this planning handoff.

## Planner self-review

The four tasks cover retention, projection, selection/security, and visible
behavior. Each task has a failing test, implementation step, passing check, and
commit. The Review Focus inputs map to concrete task assertions. No test asserts
planning prose, dependency versions, or static mockup text. Dependencies remain
unchanged. Full product checks belong to implementation.

## Plan review

### Fresh review receipt

- Reviewer: canonical `reviewer`, fresh context, read-only, no nested agents.
- Model: `openai-codex/gpt-6.1-sol`, high thinking.
- Review run: `07e5f880-8319-4184-a276-4ca57b9dc805`, 2026-11-14.
- Inspected source revision: `7dbac5292d49753be55e73189b66bfa1ba548192`.
- Reviewed plan SHA-256 before this receipt:
  `cd3dc66ef9296b736f67de46632c00a3757fe2e87b037908403bf336a6e15d80`.
- Reviewed spec SHA-256:
  `3e1854e5221264a29423ba28225835e7d20f03f1da07f8f4844208eca5ced5c7`.
- Reviewed mockup SHA-256:
  `886a0046b0f2a8c4108dae0c6587f2af14394e152ad5ce255bd862a3db474ed0`.

The reviewer independently inspected source, callers, tests, and retained run
files. The survey confirmed the real file/sample adapters at `RunDataSource`,
the single pending promise in `createFileRunDataSource()`, and the shared host
cache. It confirmed that `runOneIssue()` owns formatter output and result
publication. `runSnapshot()` isolates observer delivery from persistence.
`recordPlanningUsage()` discards tool results today. Forked main transcripts
contain inherited entries. Existing safe DOM and view-state modules support the
proposed disclosures.

The detail module passed the deletion test: removing it redistributes parsing,
ordering, and tool-joining complexity to callers. Its interface supplies depth
and leverage without a speculative transport adapter. Shared metadata discovery
and tests through observable interfaces preserve locality.

**Findings:** No blocking findings. The builder check reported “nothing
important left”. The reviewer concluded that the plan is ready for the
implementation handoff, not human approval.

**Optional notes and dispositions:**

- Accepted execution caution for Task 2: include mixed valid usage and a
  missing/invalid assistant usage block. Its existing no-partial-total
  requirement covers this case. The default kernel reader skips unusable blocks,
  so the web projection must not mistake that result for complete evidence.
  Preserve default kernel arithmetic.
- Accepted execution caution for Task 1: construct the ended result projection
  deliberately. Today `result.json` precedes `snapshot.ended()`. The existing
  assertion that `result.progress.state === "ended"` guards this ordering.

These notes clarify existing requirements. No task or architecture changed after
review. A scoped correction confirmation was not necessary.

**Inspection limits:** The reviewer did not run product tests or browser checks.
A read-only cost probe on this repository's stopped issue #302 found finite
recorded usage. Historical terminal progress and omitted planning tool results
cannot be recovered. Implementation must record those limits during its source
comparison.

### Planning validation

The planner opened the mockup directly from disk in Chromium with network access
disabled. Sixteen combinations passed: desktop and 390px widths, both themes,
and finished, stopped, no-run, and active states. There were no external
requests, JavaScript exceptions, or horizontal page overflow. Native tool
disclosure worked through the keyboard. The planner inspected desktop dark and
mobile light screenshots with an expanded tool and collapsed prompts.

The first keyboard probe omitted CDP's Enter text payload. The planner matched
the existing browser check's key event and reran all sixteen cases successfully.
No mockup change was necessary. Screenshots and the disposable probe stay
outside the repository. Product tests were not run for this documents-only
stage. Formatting, Markdown lint, relative links, and the Git diff are checked
before the planning commit. No dependency or skill-pack files changed.
