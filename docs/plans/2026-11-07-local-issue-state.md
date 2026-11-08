# Local Issue State Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `workflow.stateTracking: "local"` mode that keeps Patchmill's
workflow status in `.patchmill/state/` and syncs issues from the host, so
Patchmill never writes labels or status comments upstream.

**Architecture:** A four-method `WorkflowState` interface (`sync`, `openIssues`,
`issue`, `setStatus`) becomes the only kernel path for issue reads and status
writes. `LabelWorkflowState` maps it to labels and kernel comments.
`LocalWorkflowState` reads a synced issue copy and appends status lines through
a `StateStore`. Triage and run code keep all policy.

**Tech Stack:** TypeScript on Node (`node --test`), `gh` and `tea` through the
existing `CommandRunner`, JSON and JSONL files. No new dependencies.

**Spec:** `docs/specs/2026-11-07-local-issue-state-design.md`

## Global Constraints

- Config key `workflow.stateTracking`, values `"labels"` (default) or `"local"`.
  Any other value is a `ConfigError`.
- State root is `.patchmill/state/` under the repository root. Layout:
  `issues/sync.json`, `issues/<n>.json`, `status/<n>.jsonl`.
- Statuses are exactly `ready`, `inProgress`, `needsInfo`, `done`, `unsuitable`.
  No file in `status/` means untriaged.
- A status line is
  `{ at, status, runId?, summary?, cost?, warnings?, questionUrl? }`.
- In local mode Patchmill changes no labels, creates no labels, and posts no
  status comments. Its only upstream comments are questions, posted through
  `commentIssue` without `KERNEL_COMMENT`.
- `setStatus` rejects when the status was not recorded, including when a
  required question could not be posted. Only optional comments that fail after
  the status was recorded are warnings. Callers use ordinary error handling,
  with no retries.
- Label mode keeps working with these changes only: every status change leaves
  one workflow label; triage comments use the shared kernel comment format;
  console guidance is not posted. On failure paths: a failed swap posts no
  comment, a question is posted before the swap, and a failed triage comment
  after a successful swap counts the issue as triaged, with a warning. Every
  task ends with the full suite green: `npm test`.
- `WorkflowState` stores and reads status only. Candidate rules, the reply rule,
  outcome choice, and when to ask stay in triage and run code.
- Dependencies are read live from the host, never synced.
- Sync asks for changes since `syncedUpTo` minus 5 minutes.
- Issue files and the cursor are written atomically (temporary file, then
  `rename`). Each status line is appended with one write under an exclusive lock
  on the status file, after discarding any bytes after the last newline.
- A damaged issue copy forces a full sync. Work is never selected from an
  incomplete copy.
- No new runtime dependency.

## Review Focus

1. A local-mode unattended triage then run on one issue changes no labels and
   posts no comments upstream, while an unattended `needs-input` stop posts
   exactly one question. Tests: Task 7,
   `local mode posts no status comments and changes no labels` and
   `unattended needs-input posts one question`.
2. Patchmill's own question is not a reply. A later trusted comment is, and an
   untrusted one is not. Tests: Task 5,
   `hasReply needs a trusted, non-Patchmill comment after the status`; Task 6,
   `own question is fromPatchmill and later comments are not`.
3. A crash-truncated last status line is ignored with a warning, while a bad
   line in the middle stops the command. The next append discards the cut-off
   bytes, so both complete records stay readable. Tests: Task 3,
   `status file recovery` and `append after a cut-off write keeps both records`.
4. A sync that fails part way keeps the old cursor, so the next sync repeats the
   same window. Test: Task 4, `failed sync keeps the cursor`.
5. A state folder copied from another repository is refused before anything is
   written. Test: Task 4, `sync refuses another repository's state`.
6. A failed status write or required question fails the operation and keeps the
   previous status. An optional comment failure is only a warning. Tests: Task
   5, `a failed swap rejects and posts nothing` and
   `a failed required question rejects and leaves the labels`; Task 6,
   `failed question rejects and records nothing`; Task 7,
   `a failed triage question leaves the issue untriaged` and
   `local release fails when the status write fails`.
7. A damaged issue copy forces a full sync before any work is selected. Test:
   Task 4, `damaged issue copy triggers a full sync`.

---

### Task 1: Config key

**Files:**

- Modify: `src/config/config.ts`
- Test: `src/config/config.test.ts`

**Interfaces:**

- Produces: `PatchmillConfig["workflow"]["stateTracking"]: "labels" | "local"`,
  default `"labels"` in `DEFAULT_CONFIG`.

- [ ] **Step 1: Write the failing tests**

```ts
test("stateTracking defaults to labels and accepts local", () => {
  assert.equal(parseConfig({}).workflow.stateTracking, "labels");
  assert.equal(
    parseConfig({ workflow: { stateTracking: "local" } }).workflow
      .stateTracking,
    "local",
  );
});
test("stateTracking rejects other values", () => {
  assert.throws(
    () => parseConfig({ workflow: { stateTracking: "remote" } }),
    /Invalid value for workflow.stateTracking/,
  );
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `node --test src/config/config.test.ts` Expected: FAIL.

- [ ] **Step 3: Implement**

Add the type field and default, a
`{ path: "workflow.stateTracking", kind: "string" }` schema entry, and a value
check beside the `host.provider` check that throws
`Invalid value for workflow.stateTracking`.

- [ ] **Step 4: Run to verify they pass**

Run: `node --test src/config/config.test.ts` Expected: PASS.

- [ ] **Step 5: Commit** `feat(config): add workflow.stateTracking option`

---

### Task 2: Host sync reads and comment URLs

**Files:**

- Modify: `src/host/types.ts`, `src/host/github-gh.ts`,
  `src/host/forgejo-tea.ts`, `test-support/fake-host.ts`
- Test: `src/host/github-gh.test.ts`, `src/host/forgejo-tea.test.ts`

**Interfaces:**

- Produces in `src/host/types.ts`:
  - `IssueComment` gains `url?: string`.
  - `export type SyncedComment = IssueComment & { issue: number; url: string }`
  - `Host.listIssuesSince(since?: string): Promise<Issue[]>`: all states, pull
    requests removed, `comments: []`.
  - `Host.listCommentsSince(since?: string): Promise<SyncedComment[]>`: every
    issue comment in the repository updated since `since`. May include pull
    request comments.
  - `Host.commentIssue(n: number, body: string): Promise<string>`: unchanged,
    except that it now returns the new comment's URL. Existing callers ignore
    it. There is no separate question method; whether a comment is a question is
    workflow policy.
- `viewIssue` comments carry `url` on both hosts.
- `FakeHost` implements both list methods and records them as
  `listIssuesSince:<since or empty>` and `listCommentsSince:<since or empty>`.
  It returns every issue and every comment (it does not model `updatedAt`). A
  comment without `url` gets `${issue.url}#c<index>`. `commentIssue` still
  records `commentIssue:<n>` and appends a comment with author `owner`, and now
  stores the comment's URL and returns it.

- [ ] **Step 1: Write failing GitHub tests**

`github issue sync lists all states, drops pull requests, and passes since`: the
runner answers `gh api --paginate --slurp` with two pages, one containing an
item with `pull_request`. Assert the call is
`repos/{owner}/{repo}/issues?state=all&per_page=100&since=2026-11-07T10%3A00%3A00.000Z`
and the result excludes the pull request. Without `since`, the query has no
`since` parameter.

`github comment sync maps issue number and url`: a comment with
`issue_url: "https://api.github.com/repos/o/r/issues/12"`,
`html_url: "https://github.com/o/r/issues/12#issuecomment-5"` maps to
`{ issue: 12, url: "https://github.com/o/r/issues/12#issuecomment-5", author, body, createdAt }`.

`github commentIssue returns the comment url`: runner answers
`gh api --method POST repos/{owner}/{repo}/issues/7/comments --input -` with
`{ "html_url": "https://github.com/o/r/issues/7#issuecomment-9" }`. Assert the
returned URL and that stdin is `{"body":"Question?"}`. This call replaces
`gh issue comment`, so the URL comes from JSON instead of parsed text. It
replaces the existing `commentIssue sends the body through stdin` test.

- [ ] **Step 2: Write failing Forgejo tests** with the same three names prefixed
      `forgejo`. Endpoints:
      `/repos/{owner}/{repo}/issues?state=all&type=issues&since=<encoded>`
      (paged with the existing `pages` helper),
      `/repos/{owner}/{repo}/issues/comments?since=<encoded>`, and
      `tea api /repos/{owner}/{repo}/issues/7/comments --method POST -d '{"body":"Question?"}' --repo owner/repo`
      through the existing `scoped` helper, returning `html_url`. This replaces
      `tea comment`; update the `tea comment` assertions in the
      `repository operations carry repo context` test to match. Also assert
      `viewIssue` comments carry `url` from `html_url`.

- [ ] **Step 3: Run to verify they fail**

Run: `node --test src/host/github-gh.test.ts src/host/forgejo-tea.test.ts`
Expected: FAIL.

- [ ] **Step 4: Implement** the two list methods and the `commentIssue` change
      on both hosts and `FakeHost`. Share the GitHub REST issue mapping with
      `listOpenIssues`. Encode `since` with `encodeURIComponent`. Parse the
      issue number from `issue_url` with `/\/issues\/(\d+)$/` and throw
      `invalid comment` when it does not match.

- [ ] **Step 5: Run to verify they pass**, then `npm test`. Expected: PASS.

- [ ] **Step 6: Commit**
      `feat(host): add issue sync reads and return comment URLs`

---

### Task 3: State store

**Files:**

- Create: `src/state/store.ts`
- Test: `src/state/store.test.ts`

**Interfaces:**

- Produces:

```ts
export const STATE_DIR = ".patchmill/state";
export type WorkflowStatus =
  | "ready"
  | "inProgress"
  | "needsInfo"
  | "done"
  | "unsuitable";
export type StatusChange = {
  at: string;
  status: WorkflowStatus;
  runId?: string;
  summary?: string;
  cost?: string;
  warnings?: string[];
  questionUrl?: string;
};
export type SyncCursor = {
  repository: string;
  fullSyncAt: string;
  syncedUpTo: string;
};
export class StateStore {
  constructor(root: string, warn?: (message: string) => void);
  readCursor(): Promise<SyncCursor | undefined>;
  writeCursor(cursor: SyncCursor): Promise<void>;
  readIssue(n: number): Promise<Issue | undefined>;
  writeIssue(issue: Issue): Promise<void>;
  /** `damaged` holds the numbers of `<n>.json` files that do not parse. */
  listIssues(): Promise<{ issues: Issue[]; damaged: number[] }>;
  removeIssue(n: number): Promise<void>;
  readStatus(n: number): Promise<StatusChange[]>;
  appendStatus(n: number, change: StatusChange): Promise<void>;
}
```

`root` is the absolute `.patchmill/state` path. A missing or unparsable cursor
or issue file reads as `undefined`. `listIssues` returns the parsed issues
sorted by number and reports unparsable issue files in `damaged` instead of
dropping them silently. It ignores `sync.json` and temporary files.

A status record is complete when it ends with `"\n"`. `appendStatus`:

1. Waits for earlier appends to the same file in this process, through a
   per-path promise chain. This keeps blocked lock calls from filling Node's
   thread pool.
2. Opens `status/<n>.jsonl` for reading and writing, creating `status/` and the
   file if needed, and takes `flock(fd, "ex")` from `fs-ext`, as
   `src/kernel/lock.ts` does. This stops another Patchmill process from
   interleaving.
3. Reads the file. If it is not empty and does not end with `"\n"`, truncates it
   to just after the last `"\n"`, or to empty, and warns with the file path.
4. Writes `JSON.stringify(change) + "\n"` at the end in one write, then closes
   the file, which releases the lock.

- [ ] **Step 1: Write the failing tests** in a temporary directory:
  - `issues and cursor round-trip`: write, read back equal; `listIssues` returns
    issues sorted by number and no `damaged`; no `*.tmp` files remain.
  - `corrupt issue and cursor files read as missing`: write `"{"` to both; reads
    return `undefined`; `listIssues` reports the issue in `damaged`;
    `removeIssue` deletes the file.
  - `status lines append in order`: append `ready` then `inProgress`;
    `readStatus` returns both in order; missing file returns `[]`.
  - `status file recovery`: a file of one valid line plus `{"at":` with no
    trailing newline returns the valid line and calls `warn` with a message
    containing the file path. A file with `not json\n` before a valid line
    rejects with a message containing the path and `line 1`.
  - `append after a cut-off write keeps both records`: start from one valid line
    plus `{"at":` with no trailing newline. `readStatus` returns one record.
    After `appendStatus` of a second change, `readStatus` returns both records
    without error, and the file ends with `"\n"`.
  - `concurrent appends stay whole`: 20 `appendStatus` calls under `Promise.all`
    leave 20 lines that all parse.

- [ ] **Step 2: Run to verify they fail**

Run: `node --test src/state/store.test.ts` Expected: FAIL.

- [ ] **Step 3: Implement `StateStore`.** Atomic writes go to `<file>.<pid>.tmp`
      then `rename`. `appendStatus` follows the four steps above.

- [ ] **Step 4: Run to verify they pass**, then `npm test`.

- [ ] **Step 5: Commit** `feat(state): add local state store`

---

### Task 4: Issue sync

**Files:**

- Create: `src/state/sync.ts`
- Test: `src/state/sync.test.ts`

**Interfaces:**

- Consumes: `Host.listIssuesSince`, `Host.listCommentsSince`, `Host.viewIssue`,
  `Host.repository` (Task 2); `StateStore` (Task 3).
- Produces:

```ts
export const SYNC_OVERLAP_MS = 5 * 60_000;
export async function syncIssues(input: {
  host: Host;
  store: StateStore;
  now: () => Date;
  issue?: number;
  warn: (message: string) => void;
}): Promise<SyncCursor>;
export async function refreshIssue(
  host: Host,
  store: StateStore,
  n: number,
): Promise<Issue>;
```

Behaviour: compare `cursor.repository` with `owner/repo` case-insensitively
before any host list call or write. `started = now()`. The sync is full when
there is no readable cursor or `store.listIssues()` reports any `damaged` file.
A full sync passes no `since`. Otherwise `since` is
`syncedUpTo - SYNC_OVERLAP_MS`. For each listed issue, keep its stored comments
(none on a full sync), replace issue fields, then upsert listed comments by
`url`. Comments for issues not listed but already stored are upserted into that
file. Other comments (pull requests) are dropped. With `issue`, call
`refreshIssue` after the lists. After a full sync, remove each damaged file
whose issue the host did not return, and warn with its path. Write the cursor
last:
`{ repository, fullSyncAt: full ? started : cursor.fullSyncAt, syncedUpTo: started }`.
Sync never reads or writes status files. `refreshIssue` writes `viewIssue(n)`
and returns it.

- [ ] **Step 1: Write the failing tests** with `FakeHost` and a fixed `now`:
  - `first sync stores every issue with its comments`: two issues, one closed,
    one with two comments; both files exist, comments attached, calls include
    `listIssuesSince:` and `listCommentsSince:`; cursor `syncedUpTo` equals
    `now`.
  - `later sync asks since the cursor minus five minutes`: second sync with
    `now` an hour later records `listIssuesSince:<first now minus 5 min ISO>`.
  - `later sync keeps earlier comments and replaces edited ones`: edit one
    comment's body in host state; after sync the file has both comments with the
    new body.
  - `failed sync keeps the cursor`: make `listCommentsSince` throw on the second
    sync; the stored cursor equals the first; a third sync records the same
    `since` as the failed one.
  - `sync refuses another repository's state`: write a cursor for `other/repo`;
    sync rejects with a message naming `other/repo` and `fixture/repo`; no host
    list calls recorded; cursor unchanged.
  - `explicit issue is refreshed`: `issue: 1` records `viewIssue:1`.
  - `damaged issue copy triggers a full sync`: after a first sync, write `"{"`
    to `issues/1.json` and write a status file for issue 1. Wrap the fake host
    so `listIssuesSince` and `listCommentsSince` return `[]` when `since` is
    set, which models no upstream changes. The second sync records
    `listIssuesSince:` with no `since`, restores `issues/1.json` with its
    comments, advances `syncedUpTo` and `fullSyncAt`, and leaves the status file
    byte-for-byte unchanged.
  - `damaged copy of a vanished issue is removed`: a damaged `issues/99.json`
    for an issue the host does not return is deleted after the full sync, with a
    warning naming the path.
  - `failed recovery keeps the cursor`: with a damaged file, make
    `listIssuesSince` throw. The sync rejects, the cursor is unchanged, and the
    damaged file is still reported.

- [ ] **Step 2: Run to verify they fail**

Run: `node --test src/state/sync.test.ts` Expected: FAIL.

- [ ] **Step 3: Implement** `syncIssues` and `refreshIssue`. Refusal message:
      `Local state in .patchmill/state belongs to ${stored}, not ${current}.     Move .patchmill/state aside to start again.`

- [ ] **Step 4: Run to verify they pass**, then `npm test`.

- [ ] **Step 5: Commit** `feat(state): sync issues from the host`

---

### Task 5: WorkflowState interface and label backend

Moves every kernel status write and issue read behind `WorkflowState`, with the
three agreed label-mode changes. Triage and run keep all policy.

**Files:**

- Create: `src/kernel/workflow-state.ts`, `src/kernel/label-workflow.ts`
- Modify: `src/kernel/triage.ts`, `src/kernel/run-once.ts`,
  `src/kernel/issue-selection.ts`, `src/kernel/publish.ts`,
  `src/kernel/review-wait.ts`, `src/kernel/interactive-loop.ts`,
  `src/kernel/comments.ts`, `src/kernel/labels.ts`,
  `src/cli/commands/release/main.ts`
- Test: `src/kernel/label-workflow.test.ts`, `src/kernel/triage.test.ts`, and
  the existing suites listed in Step 5

**Interfaces:**

- Consumes: `WorkflowStatus` from `src/state/store.ts` (Task 3).
- Produces in `src/kernel/workflow-state.ts`:

```ts
export type TrackedComment = IssueComment & { fromPatchmill: boolean };
export type TrackedIssue = Omit<Issue, "comments"> & {
  status: WorkflowStatus | "untriaged";
  statusSince?: string;
  comments: TrackedComment[];
};
export type StatusUpdate = {
  status: WorkflowStatus;
  runId?: string;
  summary?: string;
  cost?: string;
  warnings?: string[];
  ask?: boolean;
};
export interface WorkflowState {
  sync(issue?: number): Promise<void>;
  openIssues(): Promise<TrackedIssue[]>;
  issue(n: number): Promise<TrackedIssue>;
  /**
   * Rejects when the status was not recorded. Resolves to warnings about
   * optional comments that failed after the status was recorded.
   */
  setStatus(n: number, update: StatusUpdate): Promise<string[]>;
}
```

- Produces in `src/kernel/label-workflow.ts`:
  `export class LabelWorkflowState implements WorkflowState` with
  `constructor(host: Host, labels: LabelsConfig)`.
  - `status` from labels with precedence
    `inProgress > ready > done > unsuitable > needsInfo`; no workflow label is
    `untriaged`. This order keeps today's selection for every mixed-label
    combination. `statusSince` is never set.
  - `fromPatchmill` is `body.startsWith(KERNEL_COMMENT)`.
  - `sync` does nothing. `openIssues` maps `host.listOpenIssues()`. `issue` maps
    `host.viewIssue(n)`.
  - `setStatus`: the first call per instance runs `ensureLabels`, and a failure
    rejects. The swap is
    `setLabels(n, [labels[status]], <the other four labels>)`. Then:
    - With `ask` and a `summary`, the comment is a required question. Post
      `commentIssue(n, kernelComment(...))` first. A failure rejects with
      `Comment failed: <reason>`, and the labels stay as they were. Then swap. A
      failure rejects with
      `Label update failed: <reason> (comment posted at <url>)`.
    - Otherwise swap first. A failure rejects with
      `Label update failed: <reason>` and posts nothing. Then, if `summary` is
      set, post the kernel comment. A failure resolves to
      `["Comment failed: <reason>"]`.
    - These are today's `publishStop` messages, so callers can record
      `error.message` unchanged.
- Produces in `src/kernel/comments.ts`:
  `kernelComment(input: { issue: number; label: string; summary: string; cost?: string; warnings?: string[] }): string`,
  which joins `KERNEL_COMMENT`, `Issue #<n>: <label>`, the summary, the cost,
  and each warning with `"\n\n"`, leaving out empty parts. Delete
  `guidanceComment`.
- Produces in `src/kernel/triage.ts`:
  `hasReply(issue: TrackedIssue, trusted: string[]): boolean`. It is true when
  the latest comment by `createdAt` has a trusted author, is not
  `fromPatchmill`, and, if `statusSince` is set, was created after it.
  `selectTriageCandidates(issues: TrackedIssue[], trusted: string[])` keeps open
  issues that are `untriaged`, or `needsInfo` with `hasReply`.
- Call-site changes:
  - `RunOnceDeps` and `TriageDeps` gain `workflow?: WorkflowState`. Entry points
    use `deps.workflow ?? new LabelWorkflowState(deps.host, config.labels)`.
  - `runTriage` lists with `workflow.openIssues()`, reads `needsInfo` issues and
    each candidate with `workflow.issue(n)`, and records the outcome with
    `setStatus(n, { status, summary: comment || undefined, ask: status === "needsInfo" && comment !== "" })`.
    The `ensureLabels` call and direct label writes go. `previousLabels` and
    `finalLabels` in the progress event become `previousStatus` and
    `finalStatus` strings.
  - In `runTriage`, a rejected `setStatus` reaches the existing per-issue
    `catch`: warn and skip, not counted as applied. Each resolved warning is
    printed with the same `warn`, and the issue counts as applied.
  - `selectRunIssue({ workflow, host, issue?, warn })` filters
    `workflow.openIssues()` to `ready` or `inProgress`, oldest first, or reads
    `workflow.issue(issue)` when explicit. It keeps reading dependencies from
    `host`. `selectIssue` and `listRunIssues` go.
  - `runOneIssue` claims with `setStatus(n, { status: "inProgress", runId })`,
    then `workflow.issue(n)` must be open and `inProgress`, else
    `claimed-elsewhere`. A rejected claim propagates, as a failed claim
    `setLabels` does today. All three loop reads use `workflow.issue(n)`.
  - `publishStop` and `publishAttemptStop` take `workflow` instead of `host` and
    `labels`, and call
    `setStatus(n, { status: stop.label, runId, summary, cost, warnings, ask })`.
    `StopPublication.remove` goes; the one swap rule covers it.
    `StopPublication` gains `ask?: boolean`. A rejection becomes one publication
    error with the error's message, and resolved warnings are added as
    publication errors. The run still writes its result and exits 1, as it does
    for publication errors today.
  - `reviewWait` takes `workflow` instead of `labels`. On restart it calls
    `setStatus(issue, { status: "done" })`. `collectReviewFacts` takes
    `workflow` instead of `host`.
  - `workerGuidance` drops the issue comment. `run-once.ts` appends the guidance
    text and a blank line to `<runDir>/guidance.md`.
  - `release` reads `workflow.issue(n)` and, when `inProgress`, calls
    `setStatus(n, { status: "ready" })`. Output stays
    `Issue #N: <inProgress label> -> <ready label>.` and
    `Issue #N: nothing to release.`
  - `claimSwap` and `releaseSwap` go from `labels.ts`.

- [ ] **Step 1: Write failing tests** in `src/kernel/label-workflow.test.ts`
      with `FakeHost`:
  - `label status follows label precedence`: no workflow label is `untriaged`;
    `[needs-info, agent-unsuitable]` is `unsuitable`;
    `[agent-ready, agent-done]` is `ready`; `[in-progress, agent-ready]` is
    `inProgress`.
  - `setStatus leaves exactly one workflow label`: an issue with
    `[bug, in-progress, agent-ready]` set to `needsInfo` ends with
    `[bug, needs-info]`.
  - `setStatus posts the kernel comment only with a summary`: one `commentIssue`
    whose body equals
    `kernelComment({ issue: 9, label: "needs-info", summary: "S", cost: "C", warnings: ["W"] })`;
    a second update without summary posts nothing.
  - `labels are ensured once per instance`: two updates record one `listLabels`.
  - `a failed swap rejects and posts nothing`: a host whose `setLabels` throws
    makes `setStatus` reject with `Label update failed: <message>`, and no
    comment is added.
  - `a failed optional comment is a warning`: a host whose `commentIssue` throws
    resolves to `["Comment failed: <message>"]`, after the labels changed.
  - `a failed required question rejects and leaves the labels`: with `ask`, a
    host whose `commentIssue` throws makes `setStatus` reject with
    `Comment failed: <message>`, and the issue's labels are unchanged.

  In `src/kernel/triage.test.ts`:
  - `hasReply needs a trusted, non-Patchmill comment after the status`: false
    when the latest comment is `fromPatchmill`; false for an untrusted author;
    true for a trusted author; with `statusSince` later than the comment, false.
  - `a failed triage comment after the swap warns and counts`: for a `ready`
    outcome with a comment, a host whose `commentIssue` throws; the issue is in
    the returned outcomes and stderr has `Comment failed`.

- [ ] **Step 2: Run**
      `node --test src/kernel/label-workflow.test.ts     src/kernel/triage.test.ts`.
      Expected: the new tests FAIL.

- [ ] **Step 3: Implement** the interface, the label backend, `kernelComment`,
      and `hasReply`.

- [ ] **Step 4: Move the call sites** listed above. Afterwards
      `grep -n "setLabels\|commentIssue\|createLabel\|ensureLabels\|viewIssue\|listOpenIssues" src/kernel/*.ts src/cli/commands/release/main.ts | grep -v "\.test\.ts"`
      lists only `label-workflow.ts` and `labels.ts`.

- [ ] **Step 5: Run** `npm test`. Update existing assertions only for the agreed
      label-mode changes: the triage comment format in
      `src/kernel/triage.test.ts`; guidance no longer posted in
      `src/kernel/interactive-block.test.ts`; the removed swap helpers in
      `src/kernel/labels.test.ts`; and, in
      `src/kernel/run-once-failures.test.ts`, the `release labels` case of
      `finalization ${site} error ...`, which now expects only the label error
      and no comment attempt. Update `selectRunIssue` and progress-event callers
      (`src/kernel/issue-selection.test.ts`,
      `src/cli/commands/triage/progress-output.ts` and `output.test.ts`) for the
      new signatures. Any other failing assertion is a regression to fix in the
      code, not the test. Expected: PASS.

- [ ] **Step 6: Commit**
      `refactor(kernel): route workflow status through WorkflowState`

---

### Task 6: Local backend

**Files:**

- Create: `src/kernel/local-workflow.ts`
- Test: `src/kernel/local-workflow.test.ts`

**Interfaces:**

- Consumes: `WorkflowState`, `TrackedIssue`, `StatusUpdate` (Task 5);
  `StateStore` (Task 3); `syncIssues`, `refreshIssue` (Task 4);
  `Host.commentIssue` returning the comment URL (Task 2).
- Produces: `export class LocalWorkflowState implements WorkflowState` with
  `constructor(input: { host: Host; store: StateStore; now: () => Date; warn: (message: string) => void })`.

Behaviour:

- `sync(issue)`: `syncIssues({ host, store, now, issue, warn })`.
- `openIssues()`: stored issues with `state === "open"`, tracked. It rejects if
  `listIssues` reports any `damaged` file, so work is never selected from an
  incomplete copy.
- `issue(n)`: `refreshIssue(host, store, n)`, tracked. Errors propagate.
- Tracking an issue: `status` and `statusSince` come from the last line of
  `store.readStatus(n)` (`untriaged` and unset when empty). A comment is
  `fromPatchmill` when its `url` equals any line's `questionUrl`.
- `setStatus(n, update)`: if `ask` and `summary` is set,
  `commentIssue(n, summary)` first. A failed post rejects with
  `Comment failed: <reason>` and appends nothing. Then append
  `{ at: now().toISOString(), status, runId, summary, cost, warnings, questionUrl }`
  without undefined fields. A failed append rejects with
  `Status update failed: <reason>`, followed by `(question posted at <url>)`
  when a question was posted. Otherwise it resolves to `[]`, because it posts no
  optional comments.

- [ ] **Step 1: Write failing tests** with `FakeHost` and a temporary
      `StateStore`. Every test also asserts that the fake host's issue labels
      and label list are unchanged, and that the issue's comments are exactly
      the questions the test expects.
  - `status and statusSince come from the last line`.
  - `own question is fromPatchmill and later comments are not`: after
    `setStatus(9, { status: "needsInfo", summary: "Q?", ask: true })`,
    `issue(9)` has the question with `fromPatchmill: true`; a comment added
    later in host state has `fromPatchmill: false`.
  - `ask posts once; no ask posts nothing`: the issue gains one comment whose
    body is the summary, without `KERNEL_COMMENT`, and the line has that
    comment's URL as `questionUrl`. A second update without `ask` adds no
    comment.
  - `failed question rejects and records nothing`: a host whose `commentIssue`
    throws makes `setStatus` reject with `Comment failed: <message>`, and
    `readStatus(9)` is unchanged.
  - `failed append rejects with the question URL`: make `status/` a regular
    file. With `ask`, `setStatus` rejects with a message containing
    `Status update failed` and the posted comment's URL.
  - `openIssues refuses a damaged copy`: write `"{"` to `issues/9.json`;
    `openIssues` rejects.
  - `issue refreshes from the host`: records `viewIssue:9`.

- [ ] **Step 2: Run** `node --test src/kernel/local-workflow.test.ts`. Expected:
      FAIL.

- [ ] **Step 3: Implement `LocalWorkflowState`.**

- [ ] **Step 4: Run** the file, then `npm test`. Expected: PASS.

- [ ] **Step 5: Commit** `feat(kernel): add local workflow state backend`

---

### Task 7: Wire local mode into triage and runs

**Files:**

- Create: `src/kernel/workflow-factory.ts`
- Modify: `src/kernel/triage.ts`, `src/kernel/run-once.ts`,
  `src/cli/commands/triage/main.ts`, `src/cli/commands/run-once/main.ts`,
  `src/cli/commands/release/main.ts`
- Test: `src/kernel/local-mode.test.ts`, `src/cli/commands/release/main.test.ts`

**Interfaces:**

- Produces:

```ts
export function createWorkflowState(
  config: PatchmillConfig,
  host: Host,
  repoRoot: string,
  now: () => Date,
  warn: (message: string) => void,
): WorkflowState;
```

It returns `LabelWorkflowState` for `"labels"` and `LocalWorkflowState` with
`new StateStore(resolve(repoRoot, STATE_DIR), warn)` and `warn` for `"local"`.

Changes:

- `runTriage` calls `workflow.sync(options.issue)` before listing. A sync error
  propagates and the command fails.
- `runOneIssue` calls `workflow.sync(options.issue)` before `selectRunIssue`.
  The interactive path in `run-once/main.ts` does the same before its
  `selectRunIssue`.
- `runOneIssue` sets `ask: true` on the stop when `!deps.human`, the stop status
  is `needsInfo`, and the last session's result is `ok` with
  `status === "needs-input"`.
- The three CLI commands build `workflow` with `createWorkflowState` and pass it
  in `deps`.

- [ ] **Step 1: Write failing tests** in `src/kernel/local-mode.test.ts`,
      reusing `setupRun` from `test-support/run-once-fixture.ts` with
      `config.workflow.stateTracking = "local"`, the issue's labels emptied, and
      `workflow` passed through `run(options, { workflow })`:
  - `local mode posts no status comments and changes no labels`: triage the
    issue as ready with the fake Pi, then run it to a verified pull request. The
    fake host's issue labels and label list are unchanged, and the issue has no
    new comments. `status/9.jsonl` ends with `ready`, `inProgress`, `done`. The
    pull request body still has the cost report.
  - `unattended needs-input posts one question`: the worker returns
    `needs-input`. The issue gains exactly one comment, whose body is the
    worker's summary without `KERNEL_COMMENT`. The last line is `needsInfo` with
    that comment's URL as `questionUrl`.
  - `errors post nothing`: the worker fails. The issue gains no comment, and the
    last line is `needsInfo` without `questionUrl`.
  - `a failed triage question leaves the issue untriaged`: triage returns
    `needsInfo` with a comment, and `commentIssue` throws. Triage warns, the
    returned outcomes omit the issue, and no status file exists.
  - `a failed triage status write is not applied`: `status/` is a regular file.
    Triage of a `ready` outcome warns, and the returned outcomes omit the issue.
  - `sync failure stops the run before claiming`: `listIssuesSince` throws;
    `runOneIssue` rejects and no status file exists.

  In `src/cli/commands/release/main.test.ts`:
  - `local release fails when the status write fails`: in local mode,
    `status/9.jsonl` ends with `inProgress` and is made read-only. `release`
    returns 1, stderr has `Status update failed`, and the file is unchanged.

- [ ] **Step 2: Run**
      `GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_NOSYSTEM=1 node --test src/kernel/local-mode.test.ts`.
      Expected: FAIL.

- [ ] **Step 3: Implement** the factory and wiring.

- [ ] **Step 4: Run** the file, then `npm test`. Expected: PASS.

- [ ] **Step 5: Commit** `feat: run triage and issue runs in local state mode`

---

### Task 8: Status command

**Files:**

- Create: `src/cli/commands/status/main.ts`
- Modify: `src/cli/main.ts` (register `status`, add to help)
- Test: `src/cli/commands/status/main.test.ts`

**Interfaces:**

- Consumes: `StateStore` (Task 3), `loadConfig`.
- Produces:
  `export async function main(args?: string[], options?: { repoRoot?: string; output?: { stdout(line: string): void; stderr(line: string): void } }): Promise<number>`,
  matching the other command modules.

Behaviour: reads local files only. No host calls. Arguments: none, `--all`, or
`--issue N`.

- [ ] **Step 1: Write the failing tests** with a temporary repo root holding
      `patchmill.config.json` and a state folder:
  - `status lists issues by status`: open issues 3 (`ready`) and 4 (`needsInfo`)
    and closed 5 (`done`). Output contains `ready`, `#3`, the title,
    `needsInfo`, `#4`, and `Synced up to <syncedUpTo>`, and does not contain
    `#5`. With `--all` it contains `#5`.
  - `status --issue shows every change`: two lines; output contains both
    statuses in order, the summary, cost, and question URL.
  - `status requires local mode`: label-mode config exits 1 with
    `patchmill status requires workflow.stateTracking "local".`

- [ ] **Step 2: Run** `node --test src/cli/commands/status/main.test.ts`.
      Expected: FAIL.

- [ ] **Step 3: Implement.** Group order: `inProgress`, `needsInfo`, `ready`,
      `done`, `unsuitable`. Each row: `#<n> <title> (<at of last line>)`. Issues
      without status lines are not listed.

- [ ] **Step 4: Run** the file, then `npm test`. Expected: PASS.

- [ ] **Step 5: Commit** `feat(cli): add patchmill status`

---

### Task 9: Label tools, doctor, excludes, and docs

**Files:**

- Modify: `src/cli/commands/labels/main.ts`,
  `src/cli/commands/doctor/checks.ts`, `src/cli/commands/init/main.ts`,
  `skills/patchmill-label/SKILL.md`, `.gitignore`, `README.md`
- Test: `src/cli/commands/labels/main.test.ts`,
  `src/cli/commands/doctor/checks.test.ts`

- [ ] **Step 1: Write failing tests**
  - `labels setup refuses in local mode`: exit 1, stderr
    `Local state mode does not use labels.`, no host calls.
  - `doctor checks state instead of labels in local mode`: no `listLabels` call;
    a `state` check passes when `.patchmill/state` is writable and its message
    includes `syncedUpTo` when a cursor exists, or `not synced yet`.

- [ ] **Step 2: Run** both files. Expected: FAIL.

- [ ] **Step 3: Implement** both. `patchmill init` adds `.patchmill/state/` to
      the local excludes list, and `doctor`'s excludes check includes it.

- [ ] **Step 4: Update text without new tests** (Testing Value Gate: skill and
      documentation text). Add `.patchmill/state/` to `.gitignore`. In
      `skills/patchmill-label/SKILL.md`, after the config read, add: when
      `workflow.stateTracking` is `"local"`, tell the user Patchmill does not
      use labels in local state mode and change nothing. In `README.md`, add a
      short "Local state mode" section: the config key, what stays upstream
      (questions, pull requests, cost reports, dependency links), what moves to
      `.patchmill/state/`, and `patchmill status`.

- [ ] **Step 5: Verify**: `npm test` and `npm run lint` pass;
      `git check-ignore -q .patchmill/state/x` exits 0.

- [ ] **Step 6: Commit**
      `feat: support local state mode in label tools and doctor`
