# Local Issue State Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `workflow.stateTracking: "local"` mode that keeps Patchmill's
workflow status in `.patchmill/state/` and syncs issues from the host, so
Patchmill never writes labels or status comments upstream.

**Architecture:** A `WorkflowState` interface becomes the only kernel path for
workflow status. `LabelWorkflowState` wraps today's label and comment calls
unchanged. `LocalWorkflowState` reads a synced issue copy and appends status
lines through a `StateStore`. A `syncIssues` function keeps the copy current.

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
- In local mode Patchmill never calls `setLabels`, `createLabel`, `listLabels`,
  or `commentIssue`. It posts only question comments, through `postComment`,
  without `KERNEL_COMMENT`.
- Label mode behaviour, output, and existing tests stay unchanged. Every task
  ends with the full suite green: `npm test`.
- Dependencies are read live from the host, never synced.
- Sync asks for changes since `syncedUpTo` minus 5 minutes.
- Issue files and the cursor are written atomically (temporary file, then
  `rename`). Each status line is appended with one write.
- No new runtime dependency.

## Review Focus

1. A local-mode unattended triage then run on one issue makes zero `setLabels`,
   `createLabel`, `listLabels`, or `commentIssue` host calls. Test: Task 7,
   `local mode never writes labels or status comments`.
2. Patchmill's own question is not a reply. A later trusted comment is, and an
   untrusted one is not. Test: Task 6, `needsInfo reply rule`.
3. A crash-truncated last status line is ignored with a warning, while a bad
   line in the middle stops the command. Test: Task 3, `status file recovery`.
4. A sync that fails part way keeps the old cursor, so the next sync repeats the
   same window. Test: Task 4, `failed sync keeps the cursor`.
5. A state folder copied from another repository is refused before anything is
   written. Test: Task 4, `sync refuses another repository's state`.

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

### Task 2: Host sync reads and question comments

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
  - `Host.postComment(n: number, body: string): Promise<string>`: returns the
    comment URL.
- `viewIssue` comments carry `url` on both hosts.
- `FakeHost` implements all three. It records calls as
  `listIssuesSince:<since or empty>`, `listCommentsSince:<since or empty>`,
  `postComment:<n>`. It returns every issue and every comment (it does not model
  `updatedAt`). A comment without `url` gets `${issue.url}#c<index>`.
  `postComment` appends a comment with author `owner` and returns its URL.

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

`github postComment returns the comment url`: runner answers
`gh api --method POST repos/{owner}/{repo}/issues/7/comments --input -` with
`{ "html_url": "https://github.com/o/r/issues/7#issuecomment-9" }`. Assert the
returned URL and that stdin is `{"body":"Question?"}`.

- [ ] **Step 2: Write failing Forgejo tests** with the same three names prefixed
      `forgejo`. Endpoints:
      `/repos/{owner}/{repo}/issues?state=all&type=issues&since=<encoded>`
      (paged with the existing `pages` helper),
      `/repos/{owner}/{repo}/issues/comments?since=<encoded>`, and
      `tea api /repos/{owner}/{repo}/issues/7/comments --method POST -d     {"body":"Question?"}`
      returning `html_url`. Also assert `viewIssue` comments carry `url` from
      `html_url`.

- [ ] **Step 3: Run to verify they fail**

Run: `node --test src/host/github-gh.test.ts src/host/forgejo-tea.test.ts`
Expected: FAIL.

- [ ] **Step 4: Implement** the three methods on both hosts and `FakeHost`.
      Share the GitHub REST issue mapping with `listOpenIssues`. Encode `since`
      with `encodeURIComponent`. Parse the issue number from `issue_url` with
      `/\/issues\/(\d+)$/` and throw `invalid comment` when it does not match.

- [ ] **Step 5: Run to verify they pass**, then `npm test`. Expected: PASS.

- [ ] **Step 6: Commit** `feat(host): add issue sync reads and postComment`

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
  listIssues(): Promise<Issue[]>;
  readStatus(n: number): Promise<StatusChange[]>;
  appendStatus(n: number, change: StatusChange): Promise<void>;
}
```

`root` is the absolute `.patchmill/state` path. A missing or unparsable cursor
or issue file reads as `undefined` and is left out of `listIssues`.

- [ ] **Step 1: Write the failing tests** in a temporary directory:
  - `issues and cursor round-trip`: write, read back equal; `listIssues` returns
    issues sorted by number; no `*.tmp` files remain.
  - `corrupt issue and cursor files read as missing`: write `"{"` to both; reads
    return `undefined`.
  - `status lines append in order`: append `ready` then `inProgress`;
    `readStatus` returns both in order; missing file returns `[]`.
  - `status file recovery`: a file of one valid line plus `{"at":` with no
    trailing newline returns the valid line and calls `warn` with a message
    containing the file path. A file with `not json\n` before a valid line
    rejects with a message containing the path and `line 1`.

- [ ] **Step 2: Run to verify they fail**

Run: `node --test src/state/store.test.ts` Expected: FAIL.

- [ ] **Step 3: Implement `StateStore`.** Atomic writes go to `<file>.<pid>.tmp`
      then `rename`. `appendStatus` creates `status/` and uses one `appendFile`
      of `JSON.stringify(change) + "\n"`.

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
}): Promise<SyncCursor>;
export async function refreshIssue(
  host: Host,
  store: StateStore,
  n: number,
): Promise<Issue>;
```

Behaviour: compare `cursor.repository` with `owner/repo` case-insensitively
before any host list call or write. `started = now()`. `since` is undefined
without a cursor, else `syncedUpTo - SYNC_OVERLAP_MS`. For each listed issue,
keep its stored comments (none on a full sync), replace issue fields, then
upsert listed comments by `url`. Comments for issues not listed but already
stored are upserted into that file. Other comments (pull requests) are dropped.
With `issue`, call `refreshIssue` after the lists. Write the cursor last:
`{ repository, fullSyncAt: cursor?.fullSyncAt ?? started, syncedUpTo: started }`.
`refreshIssue` writes `viewIssue(n)` and returns it.

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

- [ ] **Step 2: Run to verify they fail**

Run: `node --test src/state/sync.test.ts` Expected: FAIL.

- [ ] **Step 3: Implement** `syncIssues` and `refreshIssue`. Refusal message:
      `Local state in .patchmill/state belongs to ${stored}, not ${current}.     Move .patchmill/state aside to start again.`

- [ ] **Step 4: Run to verify they pass**, then `npm test`.

- [ ] **Step 5: Commit** `feat(state): sync issues from the host`

---

### Task 5: WorkflowState interface and label backend

A refactor. Label behaviour must not change. The existing suite is the test.

**Files:**

- Create: `src/kernel/workflow-state.ts`, `src/kernel/label-workflow.ts`
- Modify: `src/kernel/triage.ts`, `src/kernel/run-once.ts`,
  `src/kernel/issue-selection.ts`, `src/kernel/publish.ts`,
  `src/kernel/review-wait.ts`, `src/kernel/interactive-loop.ts`,
  `src/cli/commands/release/main.ts`, `src/cli/commands/run-once/main.ts`
- Test: existing suites; `src/kernel/label-workflow.test.ts`

**Interfaces:**

- Produces in `src/kernel/workflow-state.ts`:

```ts
export type StopRecord = StopPublication & {
  runId: string;
  /** Unattended needs-input question. Local mode posts it; labels ignore it. */
  question?: string;
};
export interface WorkflowState {
  sync(issue?: number): Promise<void>;
  viewIssue(n: number): Promise<Issue>;
  /** Open issues eligible to run, oldest first, or [issue] when explicit. */
  runCandidates(explicit?: number): Promise<Issue[]>;
  triageCandidates(trusted: string[]): Promise<number[]>;
  isTriageCandidate(issue: Issue, trusted: string[]): boolean;
  /** Labels or statuses shown in triage progress, before and after. */
  triagePreview(
    issue: Issue,
    label: string,
  ): { previous: string[]; final: string[] };
  /** `label` is a configured triage label name. */
  recordTriage(issue: Issue, label: string, comment: string): Promise<void>;
  /** Returns the claimed issue, or undefined when claimed elsewhere. */
  claim(n: number, runId: string): Promise<Issue | undefined>;
  restoreDone(n: number): Promise<void>;
  publishStop(n: number, stop: StopRecord): Promise<string[]>;
  recordGuidance(n: number, runId: string, text: string): Promise<void>;
  /** True when an in-progress issue was released to ready. */
  release(n: number): Promise<boolean>;
}
```

- Produces in `src/kernel/label-workflow.ts`:
  `export class LabelWorkflowState implements WorkflowState` with
  `constructor(host: Host, labels: LabelsConfig)`. It moves today's code: `sync`
  does nothing; `viewIssue` is `host.viewIssue`; `runCandidates` is today's
  `listRunIssues` plus `selectIssue`; `triageCandidates` and `isTriageCandidate`
  are today's loop and `selectTriageCandidates`; `triagePreview` is today's
  `finalLabels` formula; `recordTriage` runs `ensureLabels` once per instance,
  `setLabels`, then the kernel comment; `claim` is the claim swap plus today's
  open and `inProgress` check; `restoreDone` removes `inProgress`; `publishStop`
  is today's `publishStop(host, labels, n, stop)`; `recordGuidance` posts
  `guidanceComment(text)`; `release` is today's release command logic.
- `RunOnceDeps` and `TriageDeps` gain `workflow?: WorkflowState`. Kernel entry
  points use
  `deps.workflow ?? new LabelWorkflowState(deps.host, config.labels)`, so
  existing tests need no changes.
- `selectRunIssue` input becomes `{ workflow, host, issue?, warn }`. It gets
  candidates from `workflow.runCandidates(issue)` and keeps reading dependencies
  from `host`.
- `publishAttemptStop` input replaces `labels` with `workflow` and passes
  `{ ...stop, cost, runId: current.runId }` to `workflow.publishStop`.
- `reviewWait` input replaces `labels` with `workflow` and calls
  `workflow.restoreDone(issue)` on restart. Its `publish` callback keeps passing
  `[labels.done]` as `remove`. Pass `config.labels.done` in from run-once.
- `workerGuidance` takes `record: (text: string) => Promise<void>` instead of
  using `host.commentIssue`.
- Every kernel issue read goes through `workflow.viewIssue`: the three calls in
  `run-once.ts` (claim check moves into `claim`, the loop read, and the
  after-session read), the per-candidate read in `runTriage`, and
  `collectReviewFacts`, which takes `workflow` instead of `host`. After this
  task, `grep -n "host.viewIssue\|host.listOpenIssues" src/kernel/*.ts` lists
  only `label-workflow.ts` and tests.

- [ ] **Step 1: Write `src/kernel/label-workflow.test.ts`** with `FakeHost`:
  - `label claim swaps labels and reports claimed elsewhere`: claim on an open
    `agent-ready` issue returns the issue with `in-progress`; claim on a closed
    issue returns `undefined`.
  - `label release swaps in-progress back to ready`: returns `true`, then
    `false` once ready.

- [ ] **Step 2: Run** `node --test src/kernel/label-workflow.test.ts`. Expected:
      FAIL.

- [ ] **Step 3: Implement** the interface and backend, then move each call site
      listed above onto `WorkflowState`. After this step,
      `grep -n     "setLabels\|commentIssue\|createLabel\|ensureLabels" src/kernel/*.ts     src/cli/commands/release/main.ts`
      lists only `label-workflow.ts`, `labels.ts`, and tests.

- [ ] **Step 4: Run** `npm test`. Expected: PASS with no edits to existing test
      files other than the `selectRunIssue` call in
      `src/kernel/issue-selection.test.ts`, which now passes
      `workflow: new     LabelWorkflowState(host, DEFAULT_CONFIG.labels)`.

- [ ] **Step 5: Commit**
      `refactor(kernel): route workflow status through WorkflowState`

---

### Task 6: Local backend

**Files:**

- Create: `src/kernel/local-workflow.ts`
- Test: `src/kernel/local-workflow.test.ts`

**Interfaces:**

- Consumes: `WorkflowState` (Task 5); `StateStore` (Task 3); `syncIssues`,
  `refreshIssue` (Task 4); `Host.postComment` (Task 2).
- Produces: `export class LocalWorkflowState implements WorkflowState` with
  `constructor(input: { host: Host; store: StateStore; labels: LabelsConfig; runsDir: string; now: () => Date })`,
  where `runsDir` is absolute.

Behaviour, per method:

- `sync(issue)`: `syncIssues`.
- `viewIssue(n)`: `refreshIssue`. If that fails, the error propagates (the run
  treats it as today's failed `viewIssue`).
- `runCandidates()`: stored open issues whose last status is `ready` or
  `inProgress`, oldest `createdAt` first. `runCandidates(n)`: stored issue `n`
  (refreshed if missing) when open, else `[]`.
- `isTriageCandidate(issue, trusted)`: open, and either no status, or last
  status `needsInfo` with a reply. A reply is a comment by a trusted author,
  whose `url` is not the line's `questionUrl`, created after the question
  comment's `createdAt` (found by `questionUrl` in the issue's comments), or
  after the line's `at` when the question is absent.
- `triageCandidates(trusted)`: numbers of stored issues passing
  `isTriageCandidate`.
- `triagePreview(issue, label)`: `previous` is `[last status]` or `[]`; `final`
  is `[status for label]`.
- `recordTriage(issue, label, comment)`: map the label name to its
  `LabelsConfig` key. For `needsInfo` with a non-empty comment, `postComment`
  first and set `questionUrl`. Append
  `{ at, status, summary: comment, questionUrl? }`.
- `claim(n, runId)`: refresh `n`; return `undefined` when closed; else append
  `{ status: "inProgress", runId }` and return it.
- `restoreDone(n)`: append `{ status: "done" }`.
- `publishStop(n, stop)`: if `stop.question` is set, `postComment` it; a failed
  post adds `Comment failed: <reason>` to the returned errors and no
  `questionUrl`. Append
  `{ status: stop.label, runId, summary, cost, warnings, questionUrl? }`. An
  append failure is returned as `Status update failed: <reason>`. `stop.remove`
  is ignored.
- `recordGuidance(n, runId, text)`: append text plus a blank line to
  `<runsDir>/issue-<n>/<runId>/guidance.md`.
- `release(n)`: if the last status is `inProgress`, append
  `{ status: "ready", summary: "Released" }` and return `true`; else `false`.

- [ ] **Step 1: Write the failing tests** with `FakeHost` and a temporary
      `StateStore`:
  - `needsInfo reply rule`: after `recordTriage` with `needs-info` and a
    comment, the issue is not a candidate (its own question is the latest
    comment, authored by trusted `owner`); an untrusted later comment keeps it
    out; a later `owner` comment makes it a candidate.
  - `triage posts only needsInfo questions`: `agent-ready` and
    `agent-unsuitable` record a status and make no `postComment` call.
  - `run candidates are ready or in progress, oldest first`.
  - `stop posts the question only when given`: with `question` the line has
    `questionUrl` and one `postComment`; without it, no call.
  - `failed question post is reported and the status still recorded`.
  - `release only releases in-progress issues`.
  - `guidance goes to the run log`: file contents equal the text; no host write
    calls.
  - Every test asserts the host `calls` contain no `setLabels`, `createLabel`,
    `listLabels`, or `commentIssue`.

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
- Test: `src/kernel/local-mode.test.ts`

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
`new StateStore(resolve(repoRoot, STATE_DIR), warn)` for `"local"`.

Changes:

- `runTriage` calls `workflow.sync(options.issue)` before selecting. A sync
  error propagates and the command fails.
- `runOneIssue` calls `workflow.sync(options.issue)` before `selectRunIssue`.
  The interactive path in `run-once/main.ts` does the same before its
  `selectRunIssue`.
- `runOneIssue` sets `question` when `!deps.human`, the phase stopped with
  `needsInfo`, and
  `run.result.ok && run.result.result.status === "needs-input"`. The question is
  `run.result.result.summary`. Pass it on the stop to `publishAttemptStop`.
- The three CLI commands build `workflow` with `createWorkflowState` and pass it
  in `deps`. `release` calls `workflow.release(n)` and prints today's messages
  in label mode, and `Issue #N: inProgress -> ready.` in local mode.

- [ ] **Step 1: Write failing tests** in `src/kernel/local-mode.test.ts`,
      reusing `setupRun` from `test-support/run-once-fixture.ts` with
      `config.workflow.stateTracking = "local"` and the issue's labels emptied:
  - `local mode never writes labels or status comments`: triage the issue as
    ready with the fake Pi, then run it to a verified pull request. Assert host
    calls contain none of `setLabels`, `createLabel`, `listLabels`,
    `commentIssue`; `status/9.jsonl` ends with `ready`, `inProgress`, `done`;
    the pull request body still has the cost report.
  - `unattended needs-input posts one question`: the worker returns
    `needs-input`; one `postComment:9`, no `KERNEL_COMMENT` in its body, last
    line `needsInfo` with `questionUrl`.
  - `sync failure stops the run before claiming`: `listIssuesSince` throws;
    `runOneIssue` rejects and no status file exists.

- [ ] **Step 2: Run**
      `GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_NOSYSTEM=1 node --test     src/kernel/local-mode.test.ts`.
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
