# Native Issue Dependencies Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use the sibling `executing-plans`
> skill for inline, task-by-task implementation. Steps use checkbox (`- [ ]`)
> syntax for tracking. This kernel plan does not require subagent tools.

**Goal:** Replace the blocked triage label with native issue dependencies that
prevent premature work and require no automatic unblock pass.

**Architecture:** Host adapters normalize native dependency reads and writes.
One kernel policy controls run eligibility, while a separate triage apply module
protects dependency writes with the existing issue lock. Labels describe
suitability and lifecycle, not dependency completion.

**Tech Stack:** TypeScript, Node.js, `node:test`, existing `gh` and `tea`
adapters, existing `fs-ext` issue locks.

**Spec:**
[Approved native dependency specification](../specs/2026-11-03-issue-334-triage-never-unblocks-issues-whose-blockers-are-design.md).

## Global Constraints

- GitHub's **Blocked by** and Forgejo/Gitea's **Depends on** become the
  dependency source of truth.
- Closed dependencies remain in the native graph.
- Triage creates only same-repository links in this change.
- An explicit issue number retains its existing label override, but never
  overrides the dependency gate.
- There is no fallback to labels or comment parsing.
- There is no automatic migration, even for comments with clear blocker numbers.
- The skill remains read-only and does not call dependency mutation APIs.
- It performs no dependency, label, or comment writes and does not create
  missing labels. This applies to triage dry runs.
- Do not rewrite historical approved specifications.
- Do not change npm dependencies for this feature. If dependency files change,
  rerun the Nix build as repository policy requires.

## Review Focus

These five risks need explicit regression coverage in the tasks that own them:

1. A later dependency page fails: reject the whole read instead of treating it
   as an empty or complete list. Task 1.
2. Two repositories contain issue `#1`: a foreign link must not satisfy a
   proposed local link. Tasks 1 and 3.
3. A worker claims the issue while triage calls Pi: the returning result must
   not change dependencies during the active attempt. Tasks 3 and 4.
4. Cancellation follows the first successful dependency write: retain that link,
   do not restore ready, and release the issue lock. Task 3.
5. A dependency write succeeds remotely but its response fails: reread before
   treating it as a duplicate or retrying it. Task 1.

---

## Inputs, execution, and testing policy

Read the specification and this plan before implementation. The specification
has no mockup because no browser-visible interface changes. Use only the issue
branch and worktree supplied by the kernel. Do not create another branch or
worktree. Implement inline through `executing-plans`, with test-driven
development and its local progress ledger. Planning ends after this document is
committed, pushed, and submitted. The kernel starts implementation separately.

Apply the Testing Value Gate as follows:

- Add behavioral tests for API translation, parsing, dependency policy, failure
  recovery, concurrency, and dry-run effects.
- Extend existing config-reader and label-provisioning tests because they
  exercise runtime upgrade behavior.
- Reuse the installer integration test for installed bytes, manifest hashes, and
  source versions.
- Do not add tests that search documentation or skill prose for particular
  sentences.
- Review documentation, generated examples, and tracked installed files
  directly.
- Use mocked command runners, FakeHost, and local fake Pi sessions. Do not
  mutate real issue trackers during verification.

Run commands from the supplied worktree. Use its installed dependencies, with
`npm ci` first if they are absent. Use
`GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_NOSYSTEM=1` for direct Node test
commands, as the npm test script does. Record baseline failures separately
instead of changing unrelated code.

## File structure and interfaces

Keep provider translation outside kernel policy. The existing `run-once.ts` has
445 lines, so add only gate wiring there. The Forgejo adapter has 353 lines. Put
new dependency operations in dedicated provider modules instead of expanding its
private API machinery. Keep triage validation and application separate from the
225-line session orchestrator.

| Files                                                                             | Responsibility                                                 |
| --------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| `src/host/types.ts`                                                               | Normalized dependency types and host methods                   |
| New `src/host/github-dependencies.ts`, `src/host/forgejo-dependencies.ts`         | Provider-specific dependency APIs and strict response decoding |
| `src/host/github-gh.ts`, `src/host/forgejo-tea.ts`                                | Delegate through existing authenticated command wrappers       |
| `test-support/fake-host.ts`                                                       | Durable native links for local integration tests               |
| New `src/kernel/issue-dependencies.ts`                                            | Dependency eligibility and refusal reasons                     |
| `src/kernel/issue-selection.ts`                                                   | Shared asynchronous run selection                              |
| `src/kernel/run-once.ts`, `src/cli/commands/run-once/main.ts`                     | Apply the shared gate before console startup and claiming      |
| New `src/kernel/triage-result.ts`, `src/kernel/triage-apply.ts`                   | Structured result validation and locked application            |
| New `test-support/triage-fixture.ts`                                              | Extract the existing triage fixture without behavior changes   |
| `src/kernel/triage.ts`, `src/kernel/envelope.ts`, `src/kernel/triage-envelope.md` | Session orchestration and the new triage contract              |
| `src/cli/commands/triage/progress-output.ts`                                      | Dependency previews and applied-link output                    |
| `src/config/config.ts`, `src/kernel/labels.ts`, `patchmill.config.json`           | Retire the blocked outcome and its provisioned label           |
| `skills/patchmill-issue-triage/SKILL.md`, tracked installed copy and manifest     | Keep the shipped and installed skill contracts aligned         |
| README, agent guidance, current site guides, fixture README                       | Explain native dependencies and manual tracker updates         |

## Task 1: Native dependency operations for both hosts

**Files:**

- Modify: `src/host/types.ts`, `src/host/github-gh.ts`,
  `src/host/forgejo-tea.ts`, `test-support/fake-host.ts`.
- Create: `src/host/github-dependencies.ts`, `src/host/forgejo-dependencies.ts`.
- Create tests: `src/host/github-dependencies.test.ts`,
  `src/host/forgejo-dependencies.test.ts`.
- Extend tests: `src/host/github-gh.test.ts`, `src/host/forgejo-tea.test.ts`.
- Update typed Host literals: `src/kernel/facts.test.ts`,
  `src/kernel/labels.test.ts`.

**Interfaces:**

```ts
// src/host/types.ts
export type IssueDependency = {
  repository: string; // owner/repo, not the dependent issue's repository
  number: number;
  state: Issue["state"];
};
export type DependencyOperations = {
  listIssueDependencies(n: number): Promise<IssueDependency[]>;
  addIssueDependency(n: number, blocker: number): Promise<void>;
};
// Host extends DependencyOperations; existing Host members stay unchanged.

// src/host/github-dependencies.ts
export function createGitHubDependencyOperations(
  gh: (args: string[], options?: CommandRunOptions) => Promise<CommandResult>,
): DependencyOperations;

// src/host/forgejo-dependencies.ts
export function createForgejoDependencyOperations(
  scoped: (args: string[]) => Promise<CommandResult>,
  slug: () => Promise<string>,
): DependencyOperations;
```

The callbacks use the adapters' existing wrappers, which throw on nonzero
command status. GitHub passes its `ghOk` wrapper. Forgejo passes `scoped` and
`slug`, preserving repository and Tea profile context. Both adapters expose the
two Host methods through these operations.

- [ ] **Step 1: Add failing provider tests with the existing
      `recordingRunner`.**

Use GitHub's paginated issue API shape and Forgejo's issue
`repository.full_name` metadata. Include these normalization assertions in both
provider suites:

```ts
assert.deepEqual(await host.listIssueDependencies(9), [
  { repository: "owner/repo", number: 1, state: "closed" },
  { repository: "other/project", number: 1, state: "open" },
]);
await assert.rejects(host.listIssueDependencies(9)); // failure on a later page
```

Add table-driven cases for `[]`, malformed JSON, non-array pages, invalid issue
numbers, unknown states, and missing repository identity. Assert rejection, not
`[]`, for every malformed or unsuccessful read. Include unavailable endpoints
and permission errors.

For writes, assert that GitHub resolves blocker `#1` to database ID `1001`
before `POST`. Assert that an absent, non-integer, or unsafe database ID
prevents the POST. Assert that Forgejo posts
`{owner: "owner", repo: "repo", index: 1}` to issue `9`'s `/dependencies`
endpoint. Assert repository cwd and explicit or default Tea profile behavior
through the public adapter.

For duplicate and uncertain writes, cover these exact outcomes:

| Response or reread                                | Expected outcome             |
| ------------------------------------------------- | ---------------------------- |
| POST succeeds                                     | Resolve once                 |
| POST fails, reread contains that exact local link | Resolve without another POST |
| POST fails, reread contains only a foreign `#1`   | Reject                       |
| POST rejects a cycle, reread lacks the link       | Reject                       |
| POST response and confirming reread both fail     | Reject                       |

- [ ] **Step 2: Run the new provider suites and observe failure.**

Run:
`node --test src/host/github-dependencies.test.ts src/host/forgejo-dependencies.test.ts`.
Expected: failure because dependency operations do not exist.

- [ ] **Step 3: Implement the provider operations and FakeHost methods.**

Use `gh api --paginate --slurp` for complete GitHub reads. Read `repository_url`
from each dependency response and preserve its repository identity. Resolve the
blocker's raw API `id` for writes, not its issue number or GraphQL node ID. Use
an explicit POST and a JSON integer for `issue_id`.

Use Tea API pages with `page` and `limit=50` for Forgejo reads. Use
`tea api <endpoint> --method POST --data <JSON>` for additions, through the
existing scoped wrapper. Keep `index` as a JSON integer, not a string field. An
exact full page requires the next page, even if that next page is empty. Decode
`repository.full_name`, or the response's explicit repository owner and name. Do
not substitute the dependent repository for absent blocker metadata.

Validate the complete response before returning a normalized list. Do not infer
closed state from any value other than the provider's closed state. After an
unsuccessful POST, reread and accept success only if the exact requested link
exists. Otherwise preserve the write error, including cycle rejections.

Add `dependencies: Record<string, IssueDependency[]>` to FakeHostState, with
`{}` as its default. Record calls as `listIssueDependencies:9` and
`addIssueDependency:9:1`. For local links, resolve current issue state on each
read so closure and reopening affect the next selection. For foreign links,
preserve the explicitly seeded state. Make duplicate additions idempotent, and
keep existing state files without dependency data readable.

- [ ] **Step 4: Run provider tests and type checks.**

Run:
`node --test src/host/github-dependencies.test.ts src/host/forgejo-dependencies.test.ts src/host/github-gh.test.ts src/host/forgejo-tea.test.ts`.
Expected: all tests pass, including the existing host tests.

Run: `npm run check:types`. Expected: exit 0 after all Host implementations and
typed test literals implement the new methods.

- [ ] **Step 5: Commit the host contract and implementations.**

Suggested message: `feat(host): support native issue dependencies`.

## Task 2: One dependency gate for run selection and claiming

**Files:**

- Create: `src/kernel/issue-dependencies.ts`,
  `src/kernel/issue-dependencies.test.ts`, `src/kernel/issue-selection.test.ts`,
  `src/kernel/run-once-dependencies.test.ts`.
- Modify: `src/kernel/issue-selection.ts`, `src/kernel/run-once.ts`,
  `src/cli/commands/run-once/main.ts`.
- Extend tests: `src/cli/commands/run-once/main.test.ts`,
  `src/console/start.test.ts`.
- Update user-facing selection guidance:
  `site/src/content/docs/using-patchmill/run-once.md`.

**Interfaces:**

Consumes Task 1's `IssueDependency` and Host methods.

```ts
// src/kernel/issue-dependencies.ts
export type DependencyEligibility =
  | { kind: "eligible" }
  | { kind: "blocked"; blockers: IssueDependency[]; reason: string }
  | { kind: "unreadable"; reason: string };
export function evaluateIssueDependencies(
  host: Pick<Host, "listIssueDependencies">,
  issue: number,
): Promise<DependencyEligibility>;

// src/kernel/issue-selection.ts
export type RunIssueSelection =
  | { kind: "selected"; issue: Issue }
  | { kind: "none" }
  | { kind: "refused"; issue: number; reason: string };
export function selectRunIssue(input: {
  host: Host;
  labels: LabelsConfig;
  issue?: number;
  warn: (issue: number, message: string) => void;
  signal?: AbortSignal;
}): Promise<RunIssueSelection>;
```

Keep `selectIssue` as the existing pure label-and-order helper for its current
tests. Production run entry points must use `selectRunIssue`, not the pure
helper directly. Refusal reasons identify the target and include
repository-qualified blocker references or the failed operation. No new
RunOnceOutcome variant is necessary: use its existing `refused` and `no-work`
forms.

- [ ] **Step 1: Add failing dependency-policy and selection tests.**

Use these policy expectations:

```ts
// Seed each row as the host's complete dependency response.
const eligibilityCases = [
  { dependencies: [], expected: "eligible" },
  {
    dependencies: [{ repository: "owner/repo", number: 1, state: "closed" }],
    expected: "eligible",
  },
  {
    dependencies: [{ repository: "owner/repo", number: 1, state: "open" }],
    expected: "blocked",
  },
  {
    dependencies: [{ repository: "other/project", number: 1, state: "open" }],
    expected: "blocked",
  },
] as const;
```

Assert `unreadable` after a rejected host read. For automatic selection, seed
ready issue `9` older than ready issue `10`. Assert selection of `10` when `9`
is blocked or unreadable. Assert that unreadable `9` produces a warning, and
that exhaustion returns `none`. Assert refusal for explicit `9`, including when
it has no ready label or has in-progress. Preserve the existing missing or
closed issue refusals and oldest-created-first ordering.

- [ ] **Step 2: Add failing run and interactive entry-point tests.**

Use `setupRun` from `test-support/run-once-fixture.ts` for real kernel
integration:

```ts
const c = await setupRun(t);
c.host.listIssueDependencies = async () => [
  { repository: "fixture/repo", number: 1, state: "open" },
];
assert.equal((await c.run({ issue: 9 })).status, "refused");
assert.equal(
  c.host.state().calls.some((name) => name.startsWith("setLabels:")),
  false,
);
await assert.rejects(fs.stat(c.worktree), { code: "ENOENT" });
await assert.rejects(fs.stat(join(c.dir, "pi.pid")), { code: "ENOENT" });
```

Repeat for dry run and for an issue with the in-progress label. For the locked
recheck, return closed on selection and open on the second dependency read.
Assert refusal, no claim, no result-publication comment, no Pi, and subsequent
lock acquisition succeeds.

In the CLI tests, exercise automatic and explicit `--interactive`. Assert that
`startConsole` is never called for a blocked or unreadable target. Update
existing recording runners to answer dependency API calls instead of returning
issue-list responses for every API request. Through `createStartRun`, assert the
real kernel refuses the same issue without requesting planning or implementation
from the HumanChannel. An existing console's next Issue run still passes through
the real kernel.

- [ ] **Step 3: Run the new suites and observe failure.**

Run:
`node --test src/kernel/issue-dependencies.test.ts src/kernel/issue-selection.test.ts src/kernel/run-once-dependencies.test.ts src/cli/commands/run-once/main.test.ts src/console/start.test.ts`.
Expected: failures for missing policy functions and dependency bypasses.

- [ ] **Step 4: Implement selection, CLI wiring, and the locked recheck.**

Implement `evaluateIssueDependencies` without a model call or any host mutation.
Treat any open dependency as blocking and a failed complete read as unreadable.
Do not cache results across selections or Run attempts.

Implement `selectRunIssue` using existing list and label rules, followed by
sequential dependency evaluation in oldest-created-first order. Warn and
continue after an unreadable automatic candidate. Return an explicit refusal
instead of selecting another issue for `--issue N`. Honor cancellation before
another candidate read.

Use it at the start of `runOneIssue`, before dry-run phase collection. Use the
same function in the CLI before either automatic or explicit console startup.
Map no-work and refusal to the existing CLI output and exit behavior.

Inside the run's existing lock `try/finally`, evaluate dependencies again
immediately before `claimSwap` and `host.setLabels`. Return a refusal directly
on a failed recheck, without calling attempt-stop publication. Keep the lock
release in `finally` on every path. Do not add dependency polling within an
active attempt or change gate and review-wait behavior.

Update the current run guide with the explicit dependency restriction.

- [ ] **Step 5: Run the focused suites and existing run regressions.**

Run the command from Step 3. Expected: all tests pass.

Run:
`node --test src/kernel/run-once.test.ts src/kernel/run-once-failures.test.ts src/kernel/interactive-planning.test.ts src/kernel/interactive-waits.test.ts`.
Expected: all tests pass with no change to planning or resume behavior for
issues without dependencies.

- [ ] **Step 6: Commit the shared dependency gate.**

Suggested message: `feat(kernel): gate issue runs on native dependencies`.

## Task 3: Structured triage validation and safe dependency application

**Files:**

- Create: `src/kernel/triage-result.ts`, `src/kernel/triage-result.test.ts`,
  `src/kernel/triage-apply.ts`, `src/kernel/triage-apply.test.ts`.
- Create: `test-support/triage-fixture.ts` by extracting the existing private
  fixture.
- Modify: `src/kernel/triage.test.ts` only for that fixture extraction in this
  task.

**Interfaces:**

Consumes Task 1's host operations and the existing `acquireLock` and
`ensureLabels` behavior.

```ts
// src/kernel/triage-result.ts
export type TriageResult = {
  label: string;
  comment: string;
  blockedBy: number[];
};
export function validateTriageResult(
  value: unknown,
  labels: Pick<LabelsConfig, "ready" | "needsInfo" | "unsuitable">,
  issue: number,
): TriageResult | string;

// src/kernel/triage-apply.ts
export type TriageApplied = {
  previousLabels: string[];
  finalLabels: string[];
  comment: string;
  dependenciesAdded: IssueDependency[];
  applied: boolean;
};
export type TriageApplyInput = {
  host: Host;
  config: PatchmillConfig;
  repoRoot: string;
  now: () => Date;
  issue: number;
  result: TriageResult;
  dryRun: boolean;
  signal?: AbortSignal;
  canApply: (fresh: Issue) => boolean;
  ensureLabels: () => Promise<void>;
};
export function applyTriageResult(
  input: TriageApplyInput,
): Promise<TriageApplied | undefined>;
```

`undefined` means stale eligibility caused a skip. Errors reject with the target
issue, failed operation, and known partial changes in their message. The
orchestrator warns and does not count an error as successful triage. The
`ensureLabels` callback preserves the existing once-per-batch provisioning
cache. Dry runs never invoke that callback.

Export `triageIssue` and `setupTriage` from the extracted fixture. Keep its
existing defaults and fake Pi behavior unchanged until Task 4 wires the new
contract.

- [ ] **Step 1: Add failing validator tests with configured labels.**

```ts
const labels = { ready: "queue", needsInfo: "question", unsuitable: "nope" };
const valid = { label: "queue", comment: "Clear work", blockedBy: [1, 2] };
assert.deepEqual(validateTriageResult(valid, labels, 9), valid);
for (const blockedBy of [
  [9],
  [1, 1],
  [0],
  [-1],
  [1.5],
  ["1"],
  [9007199254740992],
  null,
]) {
  assert.equal(
    typeof validateTriageResult({ ...valid, blockedBy }, labels, 9),
    "string",
  );
}
assert.equal(
  typeof validateTriageResult({ label: "queue", comment: "" }, labels, 9),
  "string",
);
assert.equal(
  typeof validateTriageResult({ ...valid, label: "question" }, labels, 9),
  "string",
);
assert.equal(
  typeof validateTriageResult({ ...valid, label: "blocked" }, labels, 9),
  "string",
);
```

Also assert acceptance of an empty array with each of the three configured
outcomes. Reject extra keys, non-string comments, non-array blockers, and
non-object results.

- [ ] **Step 2: Add failing apply tests for ordering, preservation, and failure
      paths.**

Seed issue `9` and existing local blocker issues `1` and `2` through
`setupTriage`. With issue `9` already ready and both links missing, assert this
order:

1. Acquire the exact issue lock and reread the target and native links.
2. Resolve every proposed blocker before host mutations.
3. Provision labels, then remove ready.
4. Add link `1`, then link `2`.
5. Publish ready and the optional kernel-marked comment.

Observe call order with host spies, not only final labels. Require these state
assertions after the second addition fails:

```ts
assert.equal(target.labels.includes(config.labels.ready), false);
assert.equal(target.labels.includes(config.labels.needsInfo), true);
assert.deepEqual(
  nativeLinks.map((link) => link.number),
  [1],
);
assert.equal(target.comments.length, 0);
```

Add named cases for each condition:

| Test condition                                               | Required assertions                                                |
| ------------------------------------------------------------ | ------------------------------------------------------------------ |
| Unknown or unreadable proposed blocker                       | No dependency, label, or comment writes                            |
| Failure to remove ready                                      | No dependency writes and no success result                         |
| Existing local `#1` and foreign `#2`, with proposed `[1, 2]` | Preserve both and add only local `#2`                              |
| Empty `blockedBy` with existing links                        | Preserve every existing link                                       |
| Duplicate proposal across separate triage runs               | No duplicate addition                                              |
| Partial write or cycle rejection                             | Retain links already added, use needs-info, reject success         |
| Error while publishing needs-info                            | Report both errors and never restore ready                         |
| Cancellation before apply                                    | No host mutation                                                   |
| Cancellation after the first addition                        | Retain that link, use needs-info, release lock                     |
| Existing local worker holds the issue lock                   | No apply writes                                                    |
| Fresh target is in-progress and new links are necessary      | Refuse without mutations, even for explicit triage                 |
| Target becomes automatically ineligible before apply         | Return `undefined` without writes                                  |
| Dry run                                                      | Preview only missing links and final labels, with zero host writes |

Release test-owned competing locks before asserting reacquisition. Attempt
another acquisition of the same lock after every error and success path. Use
`resolve(repoRoot, config.paths.runsDir, "issue-9", "lock")`, matching run-once
and release.

- [ ] **Step 3: Run the new helper suites and observe failure.**

Run:
`node --test src/kernel/triage-result.test.ts src/kernel/triage-apply.test.ts`.
Expected: failure because the validator and apply functions do not exist.

- [ ] **Step 4: Implement validation and the locked apply state transition.**

Validate exactly three result fields and the three configured outcomes. Require
distinct positive safe integer blockers, excluding the target issue. Require an
empty array for needs-info and unsuitable results.

For dry runs, prepare a fresh preview without an issue lock or host writes. For
applied results, acquire the permanent per-issue lock and release it in
`finally`. Reread the target, apply `canApply`, and reread native links under
the lock. Resolve all proposed local blockers before label provisioning or
mutation. Compare native link identities by repository and issue number, not by
number alone. Compare repository names without case sensitivity while preserving
their original spelling in output. If new links are necessary and the fresh
target is in-progress, refuse without host mutation. This conservative guard
prevents a partial triage update from leaving a resumable issue runnable with
missing links. It does not affect explicit classification without new links or
introduce automatic release of an existing claim.

Preserve all native links. Add only missing proposed links. For an already-ready
issue with missing links, remove ready before the first addition. After a
dependency error or cancellation during writes, attempt needs-info publication
without a success comment. Retain known partial additions and include them in
the error. Do not roll back native links or restore ready after an error. Apply
the requested label and comment only after all required links exist. Do not
remove unrelated labels, in-progress, or done through the normal three-outcome
swap.

- [ ] **Step 5: Run helper and fixture regression tests.**

Run:
`node --test src/kernel/triage-result.test.ts src/kernel/triage-apply.test.ts src/kernel/triage.test.ts src/kernel/lock.test.ts`.
Expected: all tests pass. The fixture extraction does not change old
orchestrator behavior yet.

- [ ] **Step 6: Commit the validated, locked triage helpers.**

Suggested message: `feat(triage): safely apply structured native blockers`.

## Task 4: Wire triage, retire blocked, and document the manual upgrade

**Files:**

- Modify: `src/kernel/triage.ts`, `src/kernel/envelope.ts`,
  `src/kernel/triage-envelope.md`, `src/cli/commands/triage/progress-output.ts`.
- Modify: `src/config/config.ts`, `src/kernel/labels.ts`,
  `patchmill.config.json`.
- Modify: `skills/patchmill-issue-triage/SKILL.md`,
  `.patchmill/skills/patchmill-issue-triage/SKILL.md`,
  `.patchmill/skills/patchmill-skill-pack.json`.
- Extend tests: `src/kernel/triage.test.ts`, `src/kernel/envelope.test.ts`,
  `src/config/config.test.ts`, `src/kernel/labels.test.ts`,
  `src/cli/commands/labels/main.test.ts`,
  `src/cli/commands/triage/output.test.ts`.
- Create integration test: `src/kernel/native-dependency-workflow.test.ts`.
- Update docs: `README.md`, `docs/agents/triage-labels.md`,
  `docs/agents/issue-tracker.md`, `fixtures/patchmill-test-repo/README.md`.
- Update site docs: `site/src/content/docs/using-patchmill/triage.md`,
  `site/src/content/docs/reference/workflow-labels.md`,
  `site/src/content/docs/getting-started/configuration.md`,
  `site/src/content/docs/reference/configuration-example.md`.

**Interfaces:**

Consumes Tasks 1–3 without changing their contracts. Re-export `TriageResult`
from `triage.ts` for existing callers. Add `dependencies: IssueDependency[]` to
`TriageEnvelopeInput`. Add required `dependenciesAdded: IssueDependency[]` to
the `triaged` progress event. Keep runTriage's returned
`{issue, label, applied}` records unchanged.

- [ ] **Step 1: Add failing config, orchestrator, CLI, and workflow
      regressions.**

Runtime upgrade assertions belong in the existing config and label suites:

```ts
const config = parseConfig({ labels: { blocked: "old-wait" } });
assert.equal("blocked" in config.labels, false);
assert.throws(() => parseConfig({ labels: { blocked: false } }), ConfigError);
assert.equal(
  labelCatalog(config.labels).some((label) => label.name === "old-wait"),
  false,
);
```

Test provisioning through the fake host, not only the returned catalog. Update
custom LabelsConfig fixtures and existing label-count expectations. Retain tests
for old review-label compatibility and unrelated workflow labels.

Update fake model result builders to include `blockedBy: []` by default. Add an
orchestrator case with `blockedBy: [1, 2]` and an otherwise suitable issue.
Assert two native additions, one ready outcome, and one comment. Assert
structured dependency context in the actual prompt sent to fake Pi. Assert that
a dependency-context read error warns and skips the candidate without starting
Pi. Assert that an invalid structured result makes no host writes and does not
prevent the next candidate.

Hold the issue lock after fake Pi starts but before its result returns. Assert
that the result cannot change dependencies or labels while the worker owns the
lock. Release the lock during cleanup, without deleting its permanent inode.

In the CLI suite, assert these distinct output patterns:

```ts
assert.match(appliedOutput, /dependencies added:/);
assert.match(previewOutput, /dependencies to add:/);
assert.doesNotMatch(previewOutput, /dependencies added:/);
```

Assert blocker references and zero host writes in the preview. Retain
raw-model-output isolation, progress totals, comments, and partial-run output
tests.

In `native-dependency-workflow.test.ts`, compose `runTriage` and real run
selection with one FakeHost:

1. Triage issue `9` as ready with native blocker `1` open.
2. Assert run selection refuses it without another model call.
3. Close issue `1` in fake host state.
4. Assert selection now succeeds without label writes, resolution comments, or
   another triage session.
5. Reopen `1` and assert selection refuses again.
6. Remove the native link manually in fixture state and assert selection
   succeeds.

- [ ] **Step 2: Run the changed suites and observe failure.**

Run:
`node --test src/config/config.test.ts src/kernel/labels.test.ts src/kernel/envelope.test.ts src/kernel/triage.test.ts src/kernel/native-dependency-workflow.test.ts src/cli/commands/labels/main.test.ts src/cli/commands/triage/output.test.ts`.
Expected: failures for the old blocked outcome, missing structured context, and
missing native apply integration.

- [ ] **Step 3: Wire the result and apply modules into triage.**

Read complete current dependencies before each triage session and include them
in the envelope as issue data. Keep the issue-content boundary and delimiter
escaping intact. Choose only ready, needs-info, or unsuitable in the envelope.
Use `validateTriageResult` through the existing `parseJsonBlock` callback. Use
`applyTriageResult` instead of the inline label-and-comment apply block. For
automatic mode, pass `canApply` through `selectTriageCandidates` using the
freshly read issue. For explicit triage, retain its normal label override and
existing closed-issue classification behavior, subject to Task 3's in-progress
apply guard. The issue lock still prevents application during an active local
attempt.

Pass a once-per-batch `ensureLabels` callback and the existing cancellation
signal. Emit successful or preview progress from `TriageApplied` only. Keep
errors as warnings and partial progress, not applied outcomes. Show missing
proposed links in dry runs and confirmed additions in applied runs. Do not add
an automatic blocker-resolution pass or resolution comment.

- [ ] **Step 4: Retire the blocked outcome and update both skill copies.**

Remove blocked from LabelsConfig, defaults, the label catalog, and active
examples. Add `labels.blocked` to the existing retired-string-key compatibility
branch in `parseConfig`. Accept a string but discard it. Continue rejecting
other types. Do not recognize historical blocked labels as workflow policy or
remove them automatically.

Change the canonical triage skill to return exactly `label`, `comment`, and
`blockedBy`. Explain that suitable dependent work uses ready, while unidentified
blockers require needs-info. Keep issue data untrusted, the skill read-only, and
the existing AI comment header. Do not modify the distinct worker `blocked`
snapshot state or guidance tools.

Refresh the installed skill and its managed manifest with the existing
installer:

```bash
node --input-type=module -e 'import { installSkills } from "./src/cli/commands/init/skill-installer.ts"; await installSkills({ repoRoot: process.cwd(), skillDir: ".patchmill/skills", packageRoot: process.cwd() });'
```

Inspect the resulting diff for unrelated pack changes. Verify source versions
against installed packages and hashes against actual installed bytes. Do not
hand-edit a version or hash to hide an inconsistent installation.

- [ ] **Step 5: Document the manual upgrade and native workflow.**

Explain that ready means suitable, while native dependencies determine whether
work can start. Explain automatic eligibility after closure, explicit-run
restrictions, conservative errors, and dry-run behavior. Remove current guidance
that requires a blocked outcome or a `Blocked by:` comment parser. Keep
human-readable explanations distinct from machine-readable native links.

Document the required manual sequence before users run the upgraded Patchmill:

1. Add the correct native dependencies in GitHub or Forgejo/Gitea.
2. Verify the links.
3. Remove the old blocked label or its configured replacement.
4. If suitable for automation, apply the configured ready label.
5. Remove the retired configuration key.

State that old blocked labels no longer enforce a dependency gate. Do not
provide an automatic conversion command or historical-comment fallback. Update
the test-repository README so its triage expectations use native links instead
of blocked labels. Do not expand repository setup into an automatic migration
feature.

- [ ] **Step 6: Run contract, integration, and installer suites.**

Run the command from Step 2. Expected: all tests pass.

Run:
`node --test src/kernel/triage-result.test.ts src/kernel/triage-apply.test.ts src/kernel/run-once-dependencies.test.ts src/cli/commands/init/skill-installer.test.ts src/cli/commands/init/main.test.ts src/cli/commands/setup-test-repo/fixtures.test.ts`.
Expected: all tests pass, including installed source bytes, hashes, and
idempotent installation.

Run: `npm run check:types`. Expected: exit 0 with no active runtime reference to
`labels.blocked`.

- [ ] **Step 7: Commit the complete triage contract and manual upgrade
      documentation.**

Suggested message:
`feat(triage): replace blocked labels with native dependencies`.

## Final verification and handoff

- [ ] Run `npm test`. Expected: all tests and type checks pass.
- [ ] Run `npm run lint`. Expected: formatting, TypeScript lint, and Markdown
      lint pass.
- [ ] Run `npm run build`. Expected: the packaged TypeScript build succeeds.
- [ ] Install site dependencies if necessary, then run
      `npm --prefix site run build`. Expected: documentation build succeeds.
- [ ] Run `git diff --check`. Expected: no whitespace errors.
- [ ] Inspect remaining `blocked` references in current runtime code, current
      guides, and examples.

Keep worker-guidance states, native API path names, negative tests, and
retired-key handling where they are intentional. There must be no active
blocked-label policy, comment-based dependency parser, or automatic migration.
Review every specification section against the task tests before declaring
implementation complete. Review the full branch inline. This kernel plan does
not require a reviewer tool. Use fresh verification evidence before any
completion claim.

Commit any final fixes and push only the supplied issue branch without force. Do
not open a separate planning pull request. The specification and this plan
accompany the eventual implementation pull request. No product code is part of
this planning delivery.
