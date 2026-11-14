# Real web board Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `executing-plans` to
> implement this plan inline, task by task. Steps use checkbox syntax for
> tracking. This kernel run does not require subagents.

**Goal:** Show real open issues, workflow columns, PRs, documents, and active
runs on the existing view-only web board.

**Architecture:** Persist a versioned observation of the current kernel, without
changing workflow decisions. A file-backed `RunDataSource` combines those
records with cached host issues and PRs. The existing server and browser keep
their security boundary and gain explicit live-data presentation.

**Tech Stack:** TypeScript, Node HTTP and filesystem APIs, existing `fs-ext`
advisory locks, `gh`/`tea` host adapters, plain browser JavaScript, Node tests.

**Spec:**
[Real board design](../specs/2026-11-14-issue-302-show-real-issues-on-the-web-board-design.md).

## Global Constraints

- Add no npm dependencies, browser framework, or browser build step.
- Preserve the #301 Host, Origin, token, cookie, CSP, and static-confinement
  rules.
- The server and runs use the same repository directory and host for now.
- Honor `paths.runsDir`, `paths.specsDir`, `paths.plansDir`, and workflow mode.
- The server never calls workflow sync or any host mutation method.
- Missing run data must not remove an otherwise visible host issue.
- Use the current workflow model. Do not restore retired roles or file formats.
- A cache period is exactly 60,000 milliseconds, including failed attempts.
- Preserve the existing 15,000-millisecond visible-tab board refresh.
- Keep the implementation view only. Do not implement threads or live chat.
- Keep all product changes on the provided Issue branch. Never force-push.

## Review Focus

1. Concurrent and rejected host requests must not bypass the cache period:
   Task 4.
2. A stale PID or previous attempt must not imply Live or an active phase: Tasks
   1 and 3.
3. PRs from another fork, another issue, or another base must not advance a
   card: Tasks 2 and 3.
4. Local workflow mode and custom labels must not fall back to literal label
   policy: Task 3.
5. Damaged files, unsafe links, and absent refs must not expose private data or
   erase the board: Tasks 3 and 6.

## Inputs and execution checklist

Read the specification and its
[offline companion](../mockups/2026-11-14-issue-302-real-board.html) before
code. Also read the #301 specification, `GLOSSARY.md`, and `AGENTS.md`. The #302
specification supersedes historical role and admission-record rules in the
mockup notes. The maintainer explicitly selected the current model.

- [x] Inspect the current kernel, host adapters, server, browser, and domain
      docs.
- [x] Resolve retired-label compatibility with the maintainer.
- [x] Write the specification and companion.
- [x] Write and self-review the implementation plan.
- [ ] Implement Tasks 1–6 inline, with each task's red/green cycle.
- [ ] Complete Task 7 acceptance and delivery checks.

The first four checks describe planning work, not completed product behavior.

## File responsibilities

| Area                 | Files and responsibility                                                                                                                          |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| Durable observations | New `src/kernel/run-progress.ts`: record types, decoder, atomic writer. Extend `run-snapshot.ts` and `run-once.ts`: ordered observation delivery. |
| Lock ownership       | Extend `src/kernel/lock.ts`: noncreating, read-only ownership probe.                                                                              |
| Host reads           | Extend `src/host/types.ts`, `github-gh.ts`, `forgejo-tea.ts`. New `github-open-pulls.ts` for REST decoding.                                       |
| File observations    | New `src/web/file-run-observations.ts`: validated progress/result selection and local roles.                                                      |
| Document links       | New `src/web/document-links.ts`: names from existing Git trees and immutable host URLs.                                                           |
| Pure projection      | New `src/web/board-projection.ts`: PR association, exclusion, columns, summaries.                                                                 |
| Shared provider      | New `src/web/host-board-cache.ts` and `file-run-data.ts`: host rate limit and snapshots.                                                          |
| CLI composition      | Extend `src/cli/commands/serve/{args,main}.ts`. New `source.ts`: real versus sample provider construction.                                        |
| Browser              | Extend `web/{board,issue,page,app}.js`, `web/index.html`. New `web/sync-status.js`: source-aware sync clock.                                      |
| Shared contract      | Extend `src/web/api-types.ts` and sample projection for `live` and document links.                                                                |
| Verification         | Focused tests beside the modules, reusable temporary fixtures in `test-support/board-fixture.ts`, implementation screenshots.                     |

Keep new modules focused, generally under 200 meaningful lines. The existing
`run-once.ts` and host classes are already large. Keep their changes to wiring.
Put record decoding, I/O, and projection logic in the named modules. Do not turn
`serve/main.ts` into the provider or restructure unrelated kernel code.

## Task 1: Persist current run observations and expose lock ownership

**Files:**

- Create: `src/kernel/run-progress.ts`, `src/kernel/run-progress.test.ts`.
- Modify: `src/kernel/run-snapshot.ts`, `src/kernel/run-once.ts`,
  `src/kernel/interactive-loop.ts`, `src/kernel/review-wait.ts`,
  `src/kernel/lock.ts`, `src/process/flock.ts`.
- Test: `src/kernel/run-snapshot.test.ts`, `src/kernel/lock.test.ts`,
  `src/kernel/run-once-failures.test.ts`.

**Interfaces:**

- Export `RunProgress` with the specification's version-one fields. Its `facts`
  is an explicit projection, not the full kernel `Facts` object.
- Export
  `parseRunProgress(value: unknown, issue: number): RunProgress | undefined`.
- Export
  `writeRunProgress(issueDir: string, record: RunProgress): Promise<void>`.
- Export `probeIssueLock(path: string): Promise<boolean>` from `lock.ts`.
- Extend `runSnapshot(identity, observe, report, persist?)` with
  `persist?: (snapshot: RunSnapshot) => Promise<void>`.
- Observation methods that publish become awaitable, including `facts()`. Keep
  `observe` synchronous for the existing console contract.
- Export `ObservedRunOutcome` from `run-snapshot.ts`, with `status` equal to
  `completed` or `stopped`, and `label` equal to `done`, `inProgress`, or
  `needsInfo`. Add optional `RunSnapshot.outcome` with that type.
- `ended(summary: string, outcome: ObservedRunOutcome): Promise<void>` carries
  the final status and role. Keep the existing `result.json` contract unchanged.
- Widen `continueGate.onWait`, `workerGuidance.onBlocked`, and
  `reviewWait.update` to accept `void | Promise<void>`. Await each callback
  before the human wait, publication, or cleanup that follows it.

- [ ] **Step 1: Add failing record and ownership tests.**

  Name the decoder case `unknown progress versions are absent observations`. Pin
  its assertion:

  ```ts
  assert.equal(parseRunProgress({ schemaVersion: 2 }, 9), undefined);
  ```

  Use temporary directories. Assert that a valid record round-trips. Assert
  `undefined` for mismatched identity, unknown versions, invalid enums, unsafe
  paths, and invalid timestamps. Assert that serialized facts omit `worktree`
  and `runDir`. During repeated replacements, every successful reader sees a
  complete record.

  Extend the existing child-process lock fixture. Assert Live for a held lock,
  then false after release and after owner exit. An unlocked record with
  `pid: process.pid` must return false. A held lock with damaged JSON must still
  return true. An absent probe must leave the path absent.

- [ ] **Step 2: Observe the intended failure.**

  Run: `node --test src/kernel/run-progress.test.ts src/kernel/lock.test.ts`.
  Expected: missing exports or failed observation/ownership assertions.

- [ ] **Step 3: Implement the record and read-only probe.**

  Use a temporary sibling and rename for `progress.json`. Remove temporary files
  on errors. Open an existing lock read-only, attempt `shnb`, and close the
  descriptor in every path. Extend the typed mode union in
  `src/process/flock.ts` with `shnb`. Do not replace it with an unrestricted
  string. Lock contention means held. Do not call `acquireLock()`, create the
  file, or inspect PID liveness as ownership proof.

- [ ] **Step 4: Add failing run integration tests.**

  Extend `run-snapshot.test.ts` with a deferred persistence callback. Assert
  ordered records for deriving, facts, planning, implementation, review wait,
  and ended. Assert that the final record exists before the issue lock releases.
  Cover both console and unattended runs, a planning merge stop, stopped
  needsInfo, and dry run with no progress write. Refused and claimed-elsewhere
  outcomes must also leave no new progress. Defer the gate/blocked observation
  write and assert that human waits do not start before it settles. Cover review
  refresh callbacks before publication and merged-worktree cleanup.

  Inject a persistence rejection. Assert the original completed outcome, final
  result file, console observer calls, and released lock. Assert a local warning
  and no new host comment about the observation error.

- [ ] **Step 5: Observe the integration failure.**

  Run:
  `node --test src/kernel/run-snapshot.test.ts src/kernel/run-once-failures.test.ts`.
  Expected: new durable-observation assertions fail before integration.

- [ ] **Step 6: Wire awaited observations into `runOneIssue()`.**

  Construct the writer inside the issue-lock lifetime. Publish the starting
  record only after the claim re-read succeeds. Then publish facts changes,
  phase/wait changes, and the final outcome. Await publication at each
  observation call. Keep disk and console observer errors isolated from each
  other. Do not leave pending writes after lock release.

- [ ] **Step 7: Run the focused tests to green.**

  Run:
  `node --test src/kernel/run-progress.test.ts src/kernel/lock.test.ts src/kernel/run-snapshot.test.ts src/kernel/run-once-failures.test.ts`.
  Expected: all assertions pass, including existing observer-error behavior.

- [ ] **Step 8: Commit the kernel observation boundary.**

  Run:
  `git add src/kernel src/process/flock.ts && git commit -m "feat(kernel): persist read-only run progress"`.

## Task 2: List open PRs through both host adapters

**Files:**

- Create: `src/host/github-open-pulls.ts`.
- Modify: `src/host/types.ts`, `src/host/github-gh.ts`,
  `src/host/forgejo-tea.ts`, `test-support/fake-host.ts`.
- Test: `src/host/github-gh.test.ts`, `src/host/forgejo-tea.test.ts`,
  `src/kernel/facts.test.ts`, `src/kernel/labels.test.ts`.

**Interfaces:**

- Add `Host.listOpenPullRequests(): Promise<PullRequest[]>`.
- Retain `Host.listPullRequests(branch: string)` unchanged.
- Export `parseGitHubOpenPullRequests(text: string): PullRequest[]` from the new
  REST decoder. Preserve head repository, head branch, base branch, draft, body,
  positive number, URL, and open state.

- [ ] **Step 1: Add failing adapter tests.**

  Name the pagination case `open PRs include every host page`. Put PR #42 on the
  first page and #43 on the second page:

  ```ts
  assert.deepEqual(
    (await host.listOpenPullRequests()).map((pr) => pr.number),
    [42, 43],
  );
  ```

  Assert GitHub uses paginated REST reads for
  `repos/{owner}/{repo}/pulls?state=open&per_page=100`. Two pages must produce
  all PRs. Assert nullable deleted head repositories remain null, rather than
  defaulting to the target repository.

  Assert Forgejo uses its existing `pages()` path for open pulls. Include a
  second page, a fork head, a draft, and a different base. Both adapters must
  preserve identity fields for the projection to filter. Retain existing
  branch-specific tests without changed expectations.

- [ ] **Step 2: Observe the intended failure.**

  Run: `node --test src/host/github-gh.test.ts src/host/forgejo-tea.test.ts`.
  Expected: the new operation is absent or the paginated mapping fails.

- [ ] **Step 3: Implement bulk reads and update host test doubles.**

  Reuse the existing command runners and Forgejo mapper. Keep the GitHub REST
  decoder separate from the class. Update `FakeHost` and the two explicit kernel
  Host literals. Do not weaken Host typing or add optional production methods.

- [ ] **Step 4: Run adapter and type checks.**

  Run:
  `node --test src/host/github-gh.test.ts src/host/forgejo-tea.test.ts src/kernel/facts.test.ts src/kernel/labels.test.ts`.
  Run: `npm run check:types`. Expected: all tests pass and all Host
  implementations satisfy the interface.

- [ ] **Step 5: Commit the read-only host capability.**

  Run:
  `git add src/host test-support/fake-host.ts src/kernel/facts.test.ts src/kernel/labels.test.ts && git commit -m "feat(host): list open pull requests for board projections"`.

## Task 3: Project fixture files, workflow roles, and PRs into cards

**Files:**

- Create: `src/web/file-run-observations.ts`, `src/web/board-projection.ts`,
  `src/web/document-links.ts`, `test-support/board-fixture.ts`.
- Create tests: `src/web/file-run-observations.test.ts`,
  `src/web/board-projection.test.ts`, `src/web/document-links.test.ts`.
- Modify: `src/web/api-types.ts`, `src/web/sample-data.ts`,
  `src/web/samples/board.ts`.

**Interfaces:**

- Add `DocumentLink = { readonly kind: "spec" | "plan"; readonly url: string }`.
- Add required `IssueSummary.live: boolean` and
  `IssueSummary.documentLinks: readonly DocumentLink[]`.
- Export `RunObservation` from `file-run-observations.ts`. It contains `live`,
  `incomplete`, nullable current state/phase/stage/branch, nullable artifact
  paths, nullable outcome role/summary, nullable interactive origin, and
  `pullRequest: HostPullRequest | null` from validated observed facts.
- Export
  `readIssueObservation(input: {repoRoot: string; config: PatchmillConfig; issue: number; warn: (message: string) => void}): Promise<RunObservation>`.
- Export
  `readWorkflowRoles(issue: Issue, input: {config: PatchmillConfig; store: StateStore}): Promise<readonly WorkflowStatus[]>`.
- Export
  `associatePullRequests(input: {issue: number; candidates: readonly HostPullRequest[]; observed: HostPullRequest | null; pushRepository: string; baseBranch: string}): AssociatedPullRequests`.
  Alias host and web types explicitly.
- Export `AssociatedPullRequests` with `pullRequests: readonly WebPullRequest[]`
  and `branches: readonly string[]`. The branches preserve accepted head names
  for document lookup. Persisted open PRs absent from candidates are omitted.
- Export
  `projectBoardIssue(input: {issue: Issue; roles: readonly WorkflowStatus[]; run: RunObservation; pullRequests: readonly WebPullRequest[]; documentLinks: readonly DocumentLink[]}): IssueSummary | null`.
- Export
  `readDocumentLinks(input: {repoRoot: string; config: PatchmillConfig; issue: number; branches: readonly string[]; baseBranch: string; repositoryUrl: string; provider: HostProviderId; runner: CommandRunner}): Promise<readonly DocumentLink[]>`.
  Here `repositoryUrl` names the push repository whose remote-tracking refs the
  reader uses.

- [ ] **Step 1: Write table-driven failing column tests.**

  Pin the exact wire IDs with these cases:

  | Evidence                                 | Expected column |
  | ---------------------------------------- | --------------- |
  | Untriaged or needsInfo only              | `triage`        |
  | ready                                    | `ready`         |
  | inProgress or active deriving/planning   | `planning`      |
  | Open planning PR                         | `review`        |
  | Active implementation                    | `implementing`  |
  | done or open implementation PR           | `code`          |
  | Blocked observation or stopped needsInfo | `blocked`       |

  Name the exclusion case `unsuitable excludes every competing column`. For each
  complete fixture `input`, pin this assertion:

  ```ts
  assert.equal(projectBoardIssue({ ...input, roles: ["unsuitable"] }), null);
  ```

  Assert each adjacent precedence pair. Assert Blocked against every other
  candidate and unsuitable against every state. Assert needsInfo alone stays
  triage. Assert an ended implementation session does not imply implementing.

  Use custom labels such as `queue`, `busy`, `question`, `delivered`, and
  `manual` for all five roles. Assert that literal retired labels alone leave a
  card in triage and cannot override custom roles. Local mode must use local
  status even when host labels disagree. An explicit current-role configuration
  of `labels.ready: "blocked"` must still map that label to Ready. There is no
  blacklist of retired label strings.

- [ ] **Step 2: Write failing file and identity tests.**

  Build fixture files through Task 1's writer and current result-file shape.
  Cover missing progress, malformed JSON, unknown schema, and mismatched
  identity. Cover a newer result versus older progress, ignored console
  directories, and a held newer attempt versus old progress. Cover permission
  errors through an injected I/O seam or error stub. Do not rely on filesystem
  user permissions.

  Assert an inactive unfinished observation becomes blocked with exactly
  `Run ended before recording a result.`. Assert active ownership without a
  matching observation falls back to workflow evidence, not a fabricated phase.
  A damaged optional record must leave the host issue present. Put a private
  absolute path and a fake token in a run summary. Neither string can appear in
  projected board JSON. Assert the generic reason `The run needs attention.`.

  Assert issue #30 never receives #302's PR. A same-named foreign fork and a
  wrong base must not advance a column. A missing PR in a fresh host list must
  not remain open evidence from a saved snapshot. Retain known merged/closed
  links without treating them as review evidence.

- [ ] **Step 3: Write failing document-link tests.**

  Use a temporary Git repository with published remote-tracking refs. Assert
  exact immutable GitHub `/blob/COMMIT/PATH` and Forgejo
  `/src/commit/COMMIT/PATH` links. Encode path segments. Include title edits,
  custom artifact directories, absent branch refs, and branch-before-base
  selection. Reject absolute and parent-traversing paths. Assert that an absent
  ref omits the link without a fetch or checkout.

- [ ] **Step 4: Observe the intended failures.**

  Run:
  `node --test src/web/file-run-observations.test.ts src/web/board-projection.test.ts src/web/document-links.test.ts`.
  Expected: missing interfaces or failed column, identity, and link assertions.

- [ ] **Step 5: Implement the readers and pure projection.**

  Reuse `parseRunProgress()`, `probeIssueLock()`, `StateStore.readStatus()`,
  `isIssueBranch()`, `planningBranchName()`, and artifact naming helpers. Never
  call `WorkflowState.sync()`, `collectFacts()`, or `provisionWorkspace()`.
  Those operations fetch or change workflow state.

  Select the latest current-format attempt and normalize observations. Apply
  unsuitable exclusion first, then the specification's priority table. Preserve
  every visible host label. Use blocked status for blocked cards and done status
  for done evidence. Use working for active planning/implementation and idle for
  other active observations. Otherwise, use none. Never generate waiting or
  paused. Use generic blocked reasons, not raw run summaries.

  Map active implementation to phase `implement`. Use spec/plan phases only when
  the observed stage identifies them. Use the matching review phase for open
  PRs. Otherwise, keep phase null. Keep elapsed time null in this slice. Set
  terminal only for an active, explicitly noninteractive observation.

  Populate sample defaults in `createSampleRunDataSource()`, not by copying new
  fields into every raw sample row. Preserve sample artifact navigation and
  existing visible states. Make raw sample rows omit the two new derived fields.

- [ ] **Step 6: Run projection, sample, and type checks.**

  Run:
  `node --test src/web/file-run-observations.test.ts src/web/board-projection.test.ts src/web/document-links.test.ts src/web/sample-data.test.ts`.
  Run: `npm run check:types`. Expected: fixtures cover all columns and existing
  sample contracts still pass.

- [ ] **Step 7: Commit the tested projection.**

  Run:
  `git add src/web test-support/board-fixture.ts && git commit -m "feat(web): project current workflow observations into board cards"`.

## Task 4: Compose the file-backed source with a shared host cache

**Files:**

- Create: `src/web/host-board-cache.ts`, `src/web/file-run-data.ts`.
- Create tests: `src/web/host-board-cache.test.ts`,
  `src/web/file-run-data.test.ts`.
- Test: `src/web/server-api.test.ts`.

**Interfaces:**

- Export
  `createHostBoardCache(input: {host: Pick<Host, "listOpenIssues" | "listOpenPullRequests">; now: () => Date; warn: (message: string) => void})`.
  Its `read()` returns
  `Promise<{issues: readonly Issue[]; pullRequests: readonly HostPullRequest[]; syncedAt: string}>`.
- Export `BoardRepository` containing the web repository name/URL, configured
  base branch, and push repository slug/public URL.
- Export
  `createFileRunDataSource(input: {repoRoot: string; config: PatchmillConfig; host: Pick<Host, "listOpenIssues" | "listOpenPullRequests">; metadata: BoardRepository; runner: CommandRunner; now: () => Date; warn: (message: string) => void}): RunDataSource`.
- Reuse the existing snapshot/subscribe contract. API handlers gain no second
  path to host or filesystem data.

- [ ] **Step 1: Add failing fake-clock cache tests.**

  Name the shared-fetch case `concurrent board reads share one host refresh`.
  Start ten concurrent reads with deferred host promises. Pin the spy counters:

  ```ts
  assert.equal(issueCalls, 1);
  assert.equal(prCalls, 1);
  ```

  Resolve both host promises and assert identical successful timestamps. At
  59,999ms, assert no new call. At 60,000ms, assert exactly one new shared
  refresh.

  Reject the initial refresh. Reads inside that failed period must reject
  without new host calls. At the next boundary, permit one retry. After a
  successful cache, reject a refresh and assert that data and `syncedAt` remain
  unchanged. Test a pending refresh that lasts longer than one cache period.

- [ ] **Step 2: Add failing provider integration tests.**

  Use temporary fixture files plus a host spy. Assert sorted immutable
  summaries, `source: "live"`, and matching detail summaries. Details must have
  empty thread, participants, previews, and null final usage.

  Inside a warm host period, change progress and release a child-process lock. A
  new snapshot must reflect both changes without another issues call. Verify
  unchanged content has a stable revision. Verify meaningful file changes
  produce a new revision. Caller mutation must not alter later data.

  Assert local-mode repository mismatch rejects rather than reading another
  repository's status. Assert a local damaged run record affects only optional
  data for that issue. Include a repository with no issues.

- [ ] **Step 3: Observe the intended failure.**

  Run:
  `node --test src/web/host-board-cache.test.ts src/web/file-run-data.test.ts`.
  Expected: missing provider/cache or failed cache and projection assertions.

- [ ] **Step 4: Implement the cache and provider.**

  Record the next host-attempt deadline before starting I/O. Always share the
  in-flight refresh, including after its deadline. Replace cached issues and PRs
  together only after success. Cache first-load errors until the deadline.
  Preserve the previous successful pair on refresh errors.

  Re-read local observations per snapshot, associate PRs, read available
  document links, and project issues. Deep-freeze the published snapshot.
  Compute its opaque revision from projected content, not request count, elapsed
  time, or `syncedAt`. Keep host freshness separate from local file freshness.

  Subscriptions can report changes detected by later snapshots. Notify only for
  changed revisions after the initial snapshot. Make unsubscribe idempotent and
  contain listener exceptions. Add no watcher, timer, or EventSource transport.

- [ ] **Step 5: Verify the actual API boundary.**

  Add a real HTTP test with the file provider. Authenticate normally and request
  both APIs concurrently. Assert one shared host refresh, the real source,
  matching summaries, and sanitized errors. Assert unauthenticated requests
  never reach the provider. Cover subscription change and repeated unsubscribe.

  Run:
  `node --test src/web/host-board-cache.test.ts src/web/file-run-data.test.ts src/web/server-api.test.ts`.
  Expected: all tests pass with existing authentication behavior intact.

- [ ] **Step 6: Commit the source and cache.**

  Run:
  `git add src/web && git commit -m "feat(web): serve cached host issues with fresh local run observations"`.

## Task 5: Make real data the default and retain explicit sample mode

**Files:**

- Create: `src/cli/commands/serve/source.ts`,
  `src/cli/commands/serve/source.test.ts`.
- Modify/test: `src/cli/commands/serve/{args,main}.ts` and their existing tests.
- Modify: `README.md`.

**Interfaces:**

- `parseServeArgs()` returns `{host: string; port: number; sample: boolean}` or
  `"help"`. Preserve existing host/port validation.
- Export
  `createServeSource(input: {sample: boolean; repoRoot: string; runner: CommandRunner; warn: (message: string) => void}): Promise<RunDataSource>`
  from `source.ts`.
- Extend `ServeMainOptions` with `repoRoot`, `runner`, and an injectable
  `createSource` matching that function. Keep `startServer` injectable.

- [ ] **Step 1: Add failing CLI and source tests.**

  Name the default case `serve defaults to repository data`:

  ```ts
  assert.deepEqual(parseServeArgs([]), {
    host: "127.0.0.1",
    port: 4280,
    sample: false,
  });
  ```

  Assert real mode by default and `--sample` in any supported flag order. Reject
  duplicate `--sample`, a value after it, unknown flags, and missing host or
  port values. Existing loopback/4280 defaults remain.

  In an unrelated temporary directory, sample mode must succeed with host/config
  seams that throw if called. In real mode, assert the configured host, runs
  directory, workflow mode, base branch, and repository metadata reach the file
  provider. Missing config must fail, not fall back to samples.

  Assert the correct `Patchmill board:` versus `Patchmill sample data:` prefix,
  unchanged token link handling, clean shutdown, and unchanged bind errors.

- [ ] **Step 2: Observe the intended failure.**

  Run: `node --test src/cli/commands/serve/*.test.ts`. Expected: new
  source-selection and flag assertions fail.

- [ ] **Step 3: Implement composition and update operator prose.**

  Short-circuit sample mode before config or Git reads. In real mode, load the
  config and construct the host. Resolve repository identity, the default base,
  and push identity. Read public URLs through existing host capabilities. Use
  the correct push repository URL for document links. Do this once, not per
  browser.

  Update help, the README command table, and the web-board section. Explain the
  real default, explicit samples, view-only controls, 60-second host cache,
  same-directory requirement, and unavailable real thread. Keep access warnings.

- [ ] **Step 4: Run CLI and sample checks to green.**

  Run:
  `node --test src/cli/commands/serve/*.test.ts src/web/sample-data.test.ts`.
  Run: `npm run check:types`. Expected: real and sample composition pass without
  sample host access.

- [ ] **Step 5: Commit source selection and documentation.**

  Run:
  `git add src/cli/commands/serve README.md && git commit -m "feat(serve): use repository data by default and retain sample mode"`.

## Task 6: Show independent Live markers, sync age, and real issue placeholders

**Files:**

- Create: `web/sync-status.js`, `src/web/browser-sync-status.test.ts`.
- Modify: `web/board.js`, `web/state.js`, `web/issue.js`, `web/page.js`,
  `web/app.js`, `web/index.html`.
- Test: `src/web/browser-state.test.ts`, `src/web/browser-presentation.test.ts`,
  `src/web/browser-links.test.ts`.
- Create: `scripts/check-real-board.mjs`, using the existing sample layout
  check's CDP pattern. Keep `scripts/check-serve-layout.mjs` unchanged.

**Interfaces:**

- Export
  `syncText(source: "sample" | "live", syncedAt: string | null, nowMs: number): string`
  from `sync-status.js`.
- Export `mountSyncStatus(node: Pick<HTMLElement, "textContent">, clock)` with
  `update(meta: {source: "sample" | "live"; syncedAt: string | null}): void` and
  idempotent `dispose(): void`. Its clock has `now(): number` and
  `every(ms: number, fn: () => void): () => void`.
- Export `boardMarkers(issue: IssueSummary): readonly Marker[]` from
  `web/state.js`. Test marker policy without a fabricated browser DOM.
- Extend `renderIssue(doc, detail, name, draft, source = "sample")`. Pass the
  response source from `renderPage()`. Retain existing sample callers.

- [ ] **Step 1: Write failing presentation and clock tests.**

  Name the clock case `sync age uses whole nonnegative seconds`:

  ```ts
  assert.equal(
    syncText("live", new Date(0).toISOString(), 12999),
    "synced 12 s ago",
  );
  assert.equal(
    syncText("live", new Date(1000).toISOString(), 0),
    "synced 0 s ago",
  );
  assert.equal(syncText("sample", null, 12999), "Sample data");
  ```

  Assert `live: true` shows Live for idle review and blocked cards. Assert
  `live: false` never gains Live merely from `status: "working"`. Preserve
  existing sample Waiting for reply and Paused markers without generating them
  in real data. Document and PR anchors must not nest in the issue anchor.

  At 12,999ms after sync, assert `synced 12 s ago`. Assert a future timestamp
  clamps to `synced 0 s ago`. Assert unchanged metadata still advances the clock
  text without a page render. Sample mode must show `Sample data`. Assert
  disposal cancels its timer.

  Assert a real issue with an empty thread shows exactly
  `Thread not available yet` and `Real issue threads come in a later update.`.
  It must not show `No run yet`, sample events, or a connected-chat claim. An
  ordinary real composer stays visible but disabled. Retain terminal/finished
  exceptions. Put DOM assertions in a failing `scripts/check-real-board.mjs` CDP
  check, not source-text tests. Prepare that check before implementation.

- [ ] **Step 2: Observe the intended failure.**

  Run:
  `node --test src/web/browser-sync-status.test.ts src/web/browser-presentation.test.ts src/web/browser-state.test.ts src/web/browser-links.test.ts`.
  Run:
  `CHROMIUM=/home/roche/.nix-profile/bin/chromium node scripts/check-real-board.mjs`.
  Expected: new source-aware presentation and sync assertions fail, including
  the browser's missing real placeholder and independent Live behavior.

- [ ] **Step 3: Implement source-aware browser presentation.**

  Drive Live from the explicit field, independent of the status marker. Keep
  blocked styling and show Live alongside it. Render markers from
  `boardMarkers()`. Use role-neutral column descriptions for custom labels and
  local mode. Add safe external document links. Retain existing sample
  artifact-drawer navigation. Use text nodes for labels and the existing
  safe-link constructor for URLs.

  Add the sync-status element and independent clock. Do not announce every tick
  through an aria-live region. Keep the existing 15-second controller timer,
  visibility behavior, generation guard, and draft/focus preservation.

  Render the real placeholder without reading sessions or sample threads. For
  ordinary real issues, disable the composer and Stop reply. Preserve the
  established terminal/finished notes and header mapping. Keep run controls as
  local explanatory notes with no mutations.

  Change shell/loading copy to neutral `Patchmill` and `Loading issues…`, so
  live mode never starts with a false sample-data claim.

- [ ] **Step 4: Run the prepared browser assertions to green.**

  Use the existing Chromium/CDP approach without dependencies. Supply real-mode
  fixture responses for all seven columns, active review, and active blocked.
  Verify marker text, exact placeholder copy, separate link anchors, disabled
  composer, keyboard focus, and no mutation requests. Cover hostile titles and
  executable document URLs. Keep existing sample layout coverage unchanged.

  Run:
  `CHROMIUM=/home/roche/.nix-profile/bin/chromium node scripts/check-real-board.mjs`.
  Expected: all real-board browser assertions pass.

- [ ] **Step 5: Run browser unit and type checks to green.**

  Run: `node --test src/web/browser-*.test.ts`. Run: `npm run check:types`.
  Expected: source-aware presentation and existing sample behavior pass.

- [ ] **Step 6: Commit the browser behavior.**

  Stage the named browser files and tests. Commit with
  `feat(web): show real board freshness and unavailable issue threads`.

## Task 7: Validate the repository board and deliver evidence

**Files:**

- Create: reference screenshots under `docs/screenshots/issue-302-*.png`.
- Create: a concise implementation verification record at
  `docs/reviews/2026-11-14-issue-302-real-board-verification.md`.

**Interfaces:** No new production interface. This task verifies the complete
slice.

- [ ] **Step 1: Run all required repository checks.**

  Run: `npm test`. Run: `npm run check:types`. Run: `npm run lint`. Expected:
  each command exits zero. Record actual results, not predictions.

  Run: `CHROMIUM=/home/roche/.nix-profile/bin/chromium npm run test:web`. Run:
  `CHROMIUM=/home/roche/.nix-profile/bin/chromium node scripts/check-real-board.mjs`.
  Expected: no browser assertions or runtime errors.

- [ ] **Step 2: Compare the real board with host and run facts.**

  Use the Issue branch entry point with the directory that contains the real run
  files as its current directory. For this checkout, use:

  ```bash
  cd /home/roche/projects/patchmill
  node /home/roche/projects/patchmill/.worktrees/agent-issue-302-show-real-issues-on-the-web-board/bin/patchmill.ts serve
  ```

  This reads production facts without editing the base checkout. Open the
  printed authenticated link. Inspect
  `gh issue list --state open --limit 1000 --json number,title,labels,url`.
  Compare the board at the same successful sync timestamp. Explain each excluded
  unsuitable issue and each advanced column.

  Inspect current `progress.json`, current-format results, and read-only lock
  probes. Verify Live follows ownership, including an exited fixture owner. Use
  a temporary fixture repository for states absent in production. Do not change
  labels, comments, run state, or ownership to stage evidence.

- [ ] **Step 3: Capture and review visible changes.**

  Use `patchmill-visual-evidence` and then `patchmill-frontend-review`. Capture
  desktop and 390px views in dark and light themes, the real placeholder,
  document/PR links, and Live independent of column. Record browser/network
  findings and any fixture-only evidence. Verify offline assets and keyboard
  focus. Do not call synthetic fixtures a live GitHub comparison.

- [ ] **Step 4: Verify sample and distribution behavior.**

  From an unrelated directory, start explicit `--sample` and verify no host
  access. Run `npm run build`. Inspect an npm pack dry run for the existing web
  assets and newly added server modules. No packaging layout change is planned.
  If npm dependencies changed, run `nix build` as required by `AGENTS.md`.

- [ ] **Step 5: Commit evidence and verify the complete diff.**

  Commit the screenshots and verification record. Run `git diff --check` and
  inspect `git status --short --branch`. Verify that production changes match
  the spec. Verify that new modules have focused responsibilities. Verify that
  no private run files, tokens, or browser profiles entered Git.

- [ ] **Step 6: Push the Issue branch and report the actual results.**

  Push only `agent/issue-302-show-real-issues-on-the-web-board`. Keep this spec,
  plan, and companion in the implementation PR. Follow the kernel's delivery
  instructions. Planning documents do not close the issue by themselves.

## Testing Value Gate and planning validation

The planned automated tests cover production policy, parsing, identity, I/O,
cache behavior, API boundaries, and browser behavior. Do not add tests that
assert this document's text, static config values, dependency versions, or a
one-off browser script's source. Inspect those artifacts directly.

Before the planning commit, run Prettier on all three artifacts. Run
Markdownlint on both Markdown documents. Resolve the companion link from the
specification. Open the companion directly from disk with network access
disabled at desktop and 390px widths. Review both themes and the issue
placeholder. Run `git diff --check`. The planning result must distinguish these
checks from unrun implementation tests.

The supplied implementation worktree already exists. Do not create another
branch or worktree. The submit tool supplies the only approval dialog. Commit
and push the planning artifacts before submission, without opening a planning
PR.
