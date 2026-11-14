# Restore cleanupHook and merged-issue cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use the sibling `executing-plans`
> skill to implement this plan inline, task by task. Steps use checkbox syntax.
> This kernel plan does not require subagent tools.

**Goal:** Restore project resource cleanup after confirmed implementation merges
in interactive and non-interactive runs.

**Architecture:** One cleanup routine accepts an already-held issue lock and
verifies fresh host facts before hook execution or removal. A run-start sweep
finds local candidates independently of open-issue selection. A narrow success
receipt prevents repeated hooks during partial cleanup retries.

**Tech Stack:** TypeScript, Node.js, Git, Bash, existing `CommandRunner`,
existing host adapters, `fs-ext` issue locks, and `node:test` fixtures.

**Spec:**
[Issue #350 design](../specs/2026-11-14-issue-350-restore-cleanuphook-and-run-merged-issue-cleanup-design.md).

## Inputs and scope

- The issue design is the implementation contract.
- `docs/specs/2026-10-15-skills-first-kernel-design.md` contains the required
  cleanup amendment, committed before product implementation.
- `docs/specs/2026-10-16-issue-lock-design.md` defines permanent lock ownership.
- `docs/specs/2026-10-19-planning-merge-gates-design.md` defines gated
  workspaces.
- `GLOSSARY.md` supplies Issue run, Run attempt, Review wait, and Issue branch.
- No mockup applies. No new domain model, ADR, or independent subsystem is
  necessary. Cleanup remains a kernel lifecycle operation using existing host,
  Git, and lock boundaries.

## Global Constraints

- `cleanupHook?: string` is an optional top-level key in
  `patchmill.config.json`.
- Omission means no hook. New default configuration omits the key.
- Every non-string value fails with exactly `Invalid type for cleanupHook`.
- Other unknown keys still fail with `Unknown config key: <name>`.
- The working directory is the issue's implementation worktree.
- The path is one argument. The script does not need an executable bit.
- Every non-dry-run `runOneIssue` entry sweeps before workflow synchronization,
  issue selection, or claiming.
- A dry run skips the sweep entirely.
- A receipt alone never authorizes cleanup.
- Cleanup errors never change a verified done outcome or relabel the issue as
  needs-info.
- Cleanup never removes or replaces the permanent lock file or its parent.
- No dependency, lockfile, remote-branch, issue-comment, or live-project changes
  are required. Preserve both workflow state backends.

## Review Focus

Each condition has a behavioral test in its owning task.

1. A merge closes the issue and removes its remote branch: local discovery still
   finds the workspace before selection refuses it. Task 3.
2. A successful hook leaves dirty files or Git removal fails: later attempts
   resume cleanup without another successful-hook invocation. Task 2.
3. An older merged PR shares a head name with an open replacement: the selected
   open PR blocks cleanup. Task 2.
4. A retained planning branch outlives the implementation directory: the receipt
   supplies identity, but fresh merge verification still controls removal.
   Task 3.
5. A target contains the lock parent, the current directory, or a different
   checkout: cleanup preserves it rather than removing an unsafe path. Task 2.

## File responsibilities

| File                                       | Responsibility                                                                             |
| ------------------------------------------ | ------------------------------------------------------------------------------------------ |
| `src/config/config.ts`                     | Optional string parsing without permissive unknown-key handling.                           |
| `src/kernel/cleanup-state.ts` (new)        | Versioned success receipt, atomic publication, and local cleanup logs.                     |
| `src/kernel/merged-cleanup.ts`             | Merge authorization, hook order, safe local removals, and warnings under an existing lock. |
| `src/kernel/merged-cleanup-sweep.ts` (new) | Candidate discovery and one-lock-at-a-time sweep.                                          |
| `src/kernel/run-once.ts`                   | Startup sweep and cleanup during successful finalization under its existing lock.          |
| `src/kernel/review-wait.ts`                | Existing interactive wait and facts refresh, without owning cleanup.                       |
| `src/cli/commands/run-once/main.ts`        | Sweep before the interactive CLI's preliminary selection.                                  |
| `test-support/run-once-fixture.ts`         | Explicit closed-issue merge fixtures and directory-only run-record discovery.              |
| Existing cleanup skill and site pages      | Manual consent and lifecycle documentation that agree with the kernel.                     |

Keep receipt storage separate from phase derivation and cost aggregation. Keep
sweep discovery separate from the cleanup algorithm. Do not restructure
unrelated parts of `run-once.ts`.

## Task 1: Restore optional hook configuration

**Files:** Modify `src/config/config.ts`, `src/config/config.test.ts`, and
`site/src/content/docs/getting-started/configuration.md`.

**Interfaces:**

- Produces `PatchmillConfig.cleanupHook?: string`.
- `parseConfig(raw: unknown): PatchmillConfig` and
  `loadConfig(repoRoot: string): Promise<PatchmillConfig>` keep their
  signatures.
- `DEFAULT_CONFIG` omits the optional property. Add a string leaf to `schema`.

- [ ] **Step 1: Add failing parser and loader tests.**

Use the existing temporary-directory loader fixture. Pin these assertions:

```ts
assert.equal(
  parseConfig({ cleanupHook: "./scripts/cleanup.sh" }).cleanupHook,
  "./scripts/cleanup.sh",
);
assert.equal(parseConfig({}).cleanupHook, undefined);
assert.equal(parseConfig({ cleanupHook: "" }).cleanupHook, "");
for (const cleanupHook of [null, false, 42, [], {}]) {
  assert.throws(
    () => parseConfig({ cleanupHook }),
    new ConfigError("Invalid type for cleanupHook"),
  );
}
assert.throws(
  () => parseConfig({ cleanupHooks: "script.sh" }),
  new ConfigError("Unknown config key: cleanupHooks"),
);
```

Also load an on-disk string hook and an on-disk non-string hook. Assert the same
value and exact error. Keep existing nested unknown-key tests.

- [ ] **Step 2: Run the parser suite and observe the new string tests fail.**

Run: `node --test src/config/config.test.ts`. Expected before implementation:
`Unknown config key: cleanupHook`.

- [ ] **Step 3: Add the optional property and schema leaf.**

Use the existing string validator. Do not normalize paths, split arguments, or
replace omission with an empty string. Update the configuration page with a
separate optional-hook example, execution directory, failure behavior, and safe
script guidance. Keep the full-defaults example free of a hook path.

- [ ] **Step 4: Run the parser suite and type checks.**

Run: `node --test src/config/config.test.ts && npm run check:types`. Expected:
zero failures and no type errors.

- [ ] **Step 5: Commit this deliverable.**

Commit message: `fix(config): restore optional cleanupHook`.

## Task 2: Run the hook and safe removal under the issue lock

**Files:**

- Create `src/kernel/cleanup-state.ts` and `src/kernel/cleanup-state.test.ts`.
- Modify `src/kernel/merged-cleanup.ts`, `src/kernel/merged-cleanup.test.ts`,
  `src/kernel/merged-planning-cleanup.test.ts`, `src/kernel/review-wait.ts`,
  `src/kernel/run-once.ts`, and `test-support/run-once-fixture.ts`.
- Exercise `src/kernel/interactive-waits.test.ts` and
  `src/kernel/issue-cost.test.ts`.

**Interfaces:**

Define these exported types in `cleanup-state.ts`:

```ts
export type CleanupIdentity = {
  repository: string;
  pushRepository: string;
  issue: number;
  branch: string;
  baseBranch: string;
  pullRequest: number;
};
export type CleanupReceipt = {
  version: 1;
  identity: CleanupIdentity;
  completedAt: string;
  hook: { status: "succeeded"; path: string } | { status: "not-configured" };
};
```

Repository slugs use lowercase for identity comparison. Export:

- `readCleanupReceipt(issueDir: string): Promise<CleanupReceipt | undefined>`.
  Only `ENOENT` returns `undefined`. Invalid shape or version throws.
- `writeCleanupReceipt(issueDir: string, receipt: CleanupReceipt): Promise<void>`.
  Publish through an exclusive temporary file and atomic rename within the issue
  directory. Remove only that temporary file after an error.
- `appendCleanupLog(input: { issueDir: string; at: string; message: string; stdout?: string; stderr?: string; runLogPath?: string }): Promise<void>`.
  Append timestamped diagnostics and raw output to `cleanup.log`. Mirror
  diagnostics to `runLogPath` when supplied.

Export from `merged-cleanup.ts`:

```ts
export type CleanupCandidate = { issue: number; branch: string };
export type CleanupServices = {
  config: PatchmillConfig;
  host: Host;
  git: Pick<KernelGit, "remoteDefaultBranch">;
  runner: CommandRunner;
  repoRoot: string;
  now: () => Date;
  report: (message: string) => void;
  signal?: AbortSignal;
  runLogPath?: string;
};
export type CleanupResult = {
  status: "cleaned" | "kept" | "skipped";
  warnings: string[];
};
export function cleanupMergedIssue(
  input: CleanupServices & CleanupCandidate & { lock: IssueLock },
): Promise<CleanupResult>;
```

The caller owns and releases the lock. The routine checks the expected lock
path, never opens a second lock, and never uses `HumanChannel` or workflow
mutations.

Extend `mergePullRequest` in the fixture with an optional third argument
`options: { closeIssue?: boolean } = {}`. Use explicit closure in cleanup tests
without changing planning merge semantics. Make `records()` count directories,
not `cleanup.json` or `cleanup.log`.

- [ ] **Step 1: Add failing state and cleanup behavior tests.**

Use real Git worktrees and Bash. Place hook counters outside removal targets.
Keep real commands behind a recording runner. Add these named cases and checks:

| Test                                                   | Assertions                                                                                                                                           |
| ------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| Relative, non-executable hook with spaces in its path  | Bash receives one path argument. `pwd` equals the implementation worktree. Its counter increases before any removal command.                         |
| Dirty implementation worktree                          | Hook runs. Post-hook dirty files and branch remain. Notification names the path.                                                                     |
| Hook removes its own generated dirt                    | Status inspection occurs after the hook. The now-clean worktree is removed.                                                                          |
| Non-zero exit, missing script, and thrown runner error | Done outcome remains. All implementation/spec/plan targets remain. Output and cleanup log contain the error and log path. No receipt proves success. |
| Successful hook plus dirty target or removal error     | First attempt writes a receipt. Retry removes the repaired target with the counter still equal to one.                                               |
| Matching receipt and missing implementation directory  | Remaining clean planning workspace can be removed without Bash.                                                                                      |
| Hook configured, directory absent, no receipt          | Branches remain. Warning explains the missing hook directory.                                                                                        |
| Omitted hook and branch-only cleanup                   | No Bash call. Verified local branches can be removed.                                                                                                |
| Corrupt/version-mismatched/identity-mismatched receipt | No Bash or removal. Receipt remains unchanged. Warning explains the refusal.                                                                         |
| Receipt or log error before removal                    | No worktree or branch removal. Done remains. Storage failure is visible.                                                                             |
| Log error after one removal                            | Stop further removal. Report the completed removal and keep all remaining targets.                                                                   |
| Open replacement over older merged PR                  | No hook or removal. Existing `findPullRequest` precedence controls selection.                                                                        |
| Invalid merge facts                                    | Open, closed-unmerged, wrong base, wrong repository, wrong head, non-closing body, open issue, and planning branches all preserve targets.           |
| Unsafe registration or containment                     | Wrong branch/path, checkout elsewhere, primary checkout, current directory, and lock-parent containment cause preservation.                          |
| Hook observes lock contention                          | A competing `acquireLock` rejects during Bash and during removal. Lock and parent device/inode pairs remain unchanged after release.                 |
| Already-aborted signal or interruption during hook     | No initial hook for the first case. An interrupted hook preserves every target and its done outcome.                                                 |

State tests cover receipt round trips, absent versus invalid files, atomic
publication, and timestamped stdout/stderr/exit diagnostics. Cost aggregation
must ignore cleanup files and keep its existing phase totals.

- [ ] **Step 2: Run focused tests and observe the missing behavior fail.**

Run:
`node --test src/kernel/cleanup-state.test.ts src/kernel/merged-cleanup.test.ts src/kernel/merged-planning-cleanup.test.ts`.
Expected before implementation: missing state module or missing hook behavior.

- [ ] **Step 3: Implement receipt storage and the shared cleanup routine.**

Read fresh issue and PR facts with `host.viewIssue`, `host.repository`,
`findPullRequest`, and `closesIssue`. Require closed issue plus merged,
correct-target implementation PR. Derive paths from configuration and canonical
branch names, never receipt-supplied paths. Parse Git worktree registration with
NUL delimiters. Compare filesystem real paths for targets, the primary checkout,
the current directory, and the lock parent. Verify containment before the hook.
Add a symlinked-parent case to the unsafe-path tests.

Invoke
`runner("bash", [config.cleanupHook], { cwd: implementationWorktree, signal })`
only when configured and no matching success receipt exists. Capture both
returned failures and thrown errors. Check the signal before starting. Write the
receipt only after success, before removal. Perform post-hook status checks,
then preserve dirty targets and remove clean registered worktrees and local
branches. Do not issue removal commands for an ineligible merge.

Keep the receipt after partial or complete removal. Continue with independent
siblings after Git errors. Stop further removal after hook, receipt, or log
errors. A log error after a completed removal cannot restore that target. Report
the partial result and keep remaining targets. Report cleanup failures without
throwing them into the workflow outcome handler.

- [ ] **Step 4: Centralize successful in-attempt finalization.**

Remove the cleanup import and call from `reviewWait`. Keep its status
publication, refresh, and `update` behavior. In `runOneIssue`, after stop
publication and before `result.json` and lock release, call the shared routine
for done implementation facts. Pass the held lock, `join(runDir, "pi.log")`, and
`deps.output.stderr`. The routine must freshly reject still-open PRs. Do not
gate it on `deps.human`. Do not call it for planning, needs-info, failed, or
aborted results.

- [ ] **Step 5: Run covering tests and type checks.**

Run:
`node --test src/kernel/cleanup-state.test.ts src/kernel/merged-cleanup.test.ts src/kernel/merged-planning-cleanup.test.ts src/kernel/interactive-waits.test.ts src/kernel/issue-cost.test.ts && npm run check:types`.
Expected: zero failures. Existing interactive wait, quit, and publication counts
remain unchanged. A confirmed closed-issue merge still cleans up before return.

- [ ] **Step 6: Commit this deliverable.**

Commit message:
`fix(kernel): run cleanup hook before locked post-merge removal`.

## Task 3: Sweep merged local issues before every real run

**Files:**

- Create `src/kernel/merged-cleanup-sweep.ts` and
  `src/kernel/merged-cleanup-sweep.test.ts`.
- Modify `src/kernel/run-once.ts`, `src/kernel/merged-cleanup.test.ts`,
  `src/cli/commands/run-once/main.ts`, and
  `src/cli/commands/run-once/main.test.ts`.
- Extend `src/kernel/local-mode.test.ts` for local-state coverage.

**Interfaces:**

- Consumes Task 2's `CleanupServices`, `CleanupCandidate`, receipt reader, and
  `cleanupMergedIssue`.
- Produces
  `discoverCleanupCandidates(input: Pick<CleanupServices, "config" | "runner" | "repoRoot" | "report">): Promise<CleanupCandidate[]>`.
- Produces `sweepMergedIssues(input: CleanupServices): Promise<void>`.
- `runOneIssue`, `RunOnceOptions`, and `RunOnceOutcome` keep their public
  shapes.

- [ ] **Step 1: Add failing discovery and all-mode integration tests.**

Use actual local refs and registered worktrees. Assert these behaviors:

| Test                                                                     | Assertions                                                                                                           |
| ------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------- |
| Closed merged issue, automatic run, no eligible open issue               | Hook and cleanup happen before `no-work`. No Pi session, claim, label mutation, or issue comment occurs for cleanup. |
| Closed merged explicit issue                                             | Sweep completes before normal closed-issue refusal. No attempt to reclaim or reopen it occurs.                       |
| Remote issue branch is gone                                              | Local implementation branch still identifies the merged PR and worktree. Hook runs once.                             |
| Interactive quit before merge, then later run                            | First run does not clean. Merge and close externally. The later sweep cleans without another Review wait.            |
| Initial interactive CLI selection finds no work or closed explicit issue | Sweep happens before selection. The console need not start for cleanup to occur.                                     |
| Plan-only entry                                                          | Prior closed implementation merges can clean up. Planning-only workspaces remain untouched.                          |
| Dry run                                                                  | No Bash, worktree removal, branch deletion, cleanup log, receipt, or cleanup lock creation.                          |
| Several implementation branches for one issue                            | That issue is skipped with an ambiguity warning. Other eligible issues still clean.                                  |
| Only planning branches remain                                            | Matching receipt supplies identity. Fresh host facts still gate removal. No receipt means no cleanup.                |
| Contended lock, unknown diagnostics                                      | No hook or mutation. Another issue can clean. Release preserves the same lock and parent inode.                      |
| Host error for one candidate                                             | That candidate remains. Warning identifies it. Other candidates and normal selection continue.                       |
| Repeated sweep and later in-attempt finalization                         | Successful hook counter stays one. Remaining dirty work survives without another hook.                               |
| Local workflow backend                                                   | Same cleanup, no host label/comment mutation, no status reset or re-claim.                                           |

Tests that currently assert no runner commands for non-interactive merged work
must change. Assert no _mutating cleanup commands_ for unmerged PRs instead of
prohibiting read-only discovery. Preserve dry-run read-only assertions.

- [ ] **Step 2: Run the new tests and observe missing sweep behavior fail.**

Run:
`node --test src/kernel/merged-cleanup-sweep.test.ts src/cli/commands/run-once/main.test.ts src/kernel/local-mode.test.ts`.
Expected before implementation: missing sweep module or preserved merged
targets.

- [ ] **Step 3: Implement bounded discovery and the sweep.**

Enumerate local heads and NUL-delimited registered worktrees. Accept canonical
positive, safe-integer issue numbers. Group branches and exclude exact planning
heads when identifying implementation candidates. Recover planning-only
leftovers from validated receipt identity. Return one candidate per issue,
sorted by number. Do not enumerate remote heads as the source of cleanup
candidates.

For each candidate, acquire `<runsDir>/issue-N/lock` once. Pass the held handle
to Task 2's routine and release it in `finally`. Catch contention and per-issue
errors, report them, and continue. Stop starting new candidates after
cancellation. No candidate path can call `provisionWorkspace` or
`ensureWorktree`.

- [ ] **Step 4: Connect both startup boundaries.**

At the start of `runOneIssue`, sweep unless `options.dryRun` or already
cancelled, before `workflow.sync` and selection. Use the existing output
channel. In the interactive CLI branch, sweep before its preliminary
synchronization/selection. Use temporary termination handlers during that CLI
startup work. Remove them before Pi owns console interaction, so its interrupt
behavior remains unchanged. Keep the existing non-interactive signal lifecycle.

The console's later Issue runs continue through `runOneIssue`. Do not pass an
untrusted skip-cleanup flag or make cleanup depend on the console being present.
Normal no-work, refusal, and completed outcomes remain distinct from cleanup
logs.

- [ ] **Step 5: Run covering suites and the interactive regressions.**

Run:
`node --test src/kernel/merged-cleanup-sweep.test.ts src/kernel/merged-cleanup.test.ts src/kernel/merged-planning-cleanup.test.ts src/kernel/run-once.test.ts src/kernel/local-mode.test.ts src/kernel/interactive-waits.test.ts src/cli/commands/run-once/main.test.ts src/console/start.test.ts && npm run check:types`.
Expected: zero failures. No new issue comments, duplicate Review wait
publication, remote branch deletion, or loss of the permanent lock.

- [ ] **Step 6: Commit this deliverable.**

Commit message: `fix(kernel): sweep merged issue cleanup before selection`.

## Task 4: Align the manual skill and lifecycle documentation

**Files:**

- Modify `skills/patchmill-cleanup/SKILL.md`.
- Finish `site/src/content/docs/getting-started/configuration.md`.
- Modify `site/src/content/docs/using-patchmill/run-once.md`,
  `site/src/content/docs/reference/agent-workflow-lifecycle.md`,
  `site/src/content/docs/reference/git-safety.md`,
  `site/src/content/docs/reference/environment-and-config.md`, and
  `site/src/content/docs/using-patchmill/interactive-skills.md`.
- Preserve the already-amended canonical kernel specification.

**Interfaces:** Consumes Tasks 1–3's public behavior. Produces no new API or
test module. Documentation is verified through inspection, not text assertions.

- [ ] **Step 1: Correct the manual cleanup procedure.**

Distinguish implementation and optional gated spec/plan workspaces. Offer the
configured hook before manual removal, from the implementation directory, with
explicit consent and the same held OS lock. Inspect status again after the hook.
A hook failure keeps all targets. Keep force/loss confirmation rules for manual
unfinished work separate from automatic merged-issue eligibility. Never treat
`patchmill release` as a lasting lock, and never remove the lock parent.

- [ ] **Step 2: Document configuration, lifecycle, and recovery consistently.**

Remove both statements that non-interactive runs never remove worktrees in
Run-once. Replace interactive-only cleanup language in lifecycle and Git safety.
Explain startup and immediate cleanup, closed-issue/no-work behavior, and
dry-run and plan-only semantics. Describe safe hook scripts, dirty preservation,
retries, receipt, and log locations. Explain that a missing hook directory or
corrupt receipt requires inspected manual recovery, not automatic receipt
deletion.

- [ ] **Step 3: Inspect coverage against the design and apply the Testing Value
      Gate.**

Map every acceptance row to the behavioral tests in Tasks 1–3. Do not add tests
for Markdown sentences, skill text, static defaults examples, or dependency
pins. Use direct inspection and lint for those materials. Keep automatic cleanup
code out of the human-only skill workflow itself.

- [ ] **Step 4: Run full verification.**

```sh
npm test
npm run lint
npm run build
node scripts/smoke-packed-artifact.mjs
npm --prefix site ci
npm run site:build
nix build .#patchmill --no-link
```

Expected: zero failures, clean lint, successful package and site builds, and a
packed installation with the updated cleanup skill. If dependencies change
unexpectedly, keep both npm lockfiles aligned and rerun the Nix build.

For skill-pack verification, inspect the packed installed
`.patchmill/skills/patchmill-cleanup/SKILL.md`, the managed manifest hashes, and
all resolved upstream skill paths. Confirm that configuration, metadata, and
live dependency references retain the same upstream versions. Do not update pins
or live projects to perform this check.

- [ ] **Step 5: Commit documentation and record verification evidence.**

Commit message: `docs: align merged cleanup lifecycle and manual hook guidance`.
Update this plan's checkboxes only with observed evidence. Commit and push the
implementation branch without force. The later implementation PR owns the
closing reference for #350.

## Planner self-review

The plan covers every design acceptance row. Tasks 2 and 3 explicitly cover all
five Review Focus conditions. Interface names and receipt fields agree across
tasks. The plan preserves existing host adapters, done publication, interactive
wait behavior, phase derivation, and permanent lock ownership.

The bounded success receipt is an explicit cleanup-only exception, not a phase
checkpoint. Its corruption and the crash window before publication are
specified. The interactive CLI's preliminary selection is included, so a
kernel-only sweep cannot leave an entry-point gap. Product implementation and
behavioral verification remain for the implementation session after the approval
dialog.
