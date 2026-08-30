# Run-once Recovery and Reset Implementation Plan

> **For agentic workers:** Follow the project worker and reviewer workflow. Implement this plan task by task and track each checkbox (`- [ ]`).

**Goal:** Let an explicit Run attempt safely resume an acknowledged blocked Issue run or archive and reset saved Run recovery state before immediately starting a fresh Run attempt.

**Architecture:** Keep `recovery.ts` as a deep, typed recovery facade. Put evidence gathering, pure policy, leases, archives, and guarded Git mutation in focused internal modules, while CLI and pipeline callers only select an intent and execute the returned decision. Hold one per-issue lease across recovery and the complete Run attempt, and let the normal claim transition replace reset state without adding a persisted status.

**Tech Stack:** TypeScript 6, Node.js 22 built-in filesystem/process APIs, `node:test`, existing `CommandRunner` Git/host adapters, and the current run-once pipeline; no new npm dependency.

**Spec:** `docs/specs/2026-08-28-issue-183-run-once-recovery-reset-design.md`

## Global Constraints

- Use the domain terms **Issue run**, **Run attempt**, and **Run recovery state** from `CONTEXT.md`.
- `agent-ready` is the only explicit human acknowledgment for blocked recovery; issue comments are not control signals.
- Only explicit `patchmill run-once --issue N` may recover blocked Run recovery state; bare selection must not select it.
- Retry preserves valid checkpoints, artifact references, and same-Issue-run effect receipts, but clears `lastError` and `blockerQuestions` before execution.
- Retry preserves and resumes a verified clean branch with unique commits without merging, rewriting, or deleting those commits.
- A clean branch with zero unique commits, no ignored content, and `behind > 0` is refreshed to one pinned base OID through a preserved checkout quarantine.
- Commit-bearing retry keeps its existing branch head and base; it does not promise current-base content.
- Dirty or ignored worktree content, saved commit loss evidence when the branch is missing, and unverifiable workspace identity always refuse retry and reset.
- Actual unique commits refuse reset but do not refuse retry when branch and worktree identity are verified.
- There is no force option. Recovery must not stash, clean, commit, rewrite, recursively remove, or force-delete human work.
- Recovery pins base and branch OIDs, moves the old checkout to quarantine, and updates refs only with expected-OID compare-and-swap.
- Recovery reports and retains every quarantine or staging path; it never erases these paths automatically.
- Reset accepts `claimed`, `planning`, `implementing`, `blocked`, and `finished` Run recovery status when safety is proved; it adds no persisted status.
- Reset must prove reset-aware saved-status eligibility and normal approvals before archive or quarantine, preserve issue labels until normal pipeline claim, archive exact state bytes first, and immediately enter the normal issue-specific pipeline.
- Reset preserves only validated `specPath`, `specCommit`, `planPath`, `planCommit`, and the issue-scoped `startedCommentPosted` receipt; it clears Run-attempt and Issue-run-scoped failure/blocker receipts.
- Every real Run attempt records `leaseProtocolVersion = 1`; active legacy state without that marker or an exact migration fence refuses recovery.
- A lease from a live same-host process or any other host blocks automatic recovery. A transaction guard serializes all lease observation, takeover, creation, and release.
- A dead same-host lease may be replaced only while the transaction guard is held. An abandoned guard requires fingerprinted operator repair.
- `patchmill run lease repair --issue N` provides fingerprinted, operator-confirmed repair for abandoned remote leases and active legacy state.
- `patchmill run reset --dry-run` is rejected before mutation because no reset-preview contract exists.
- The lease owner token controls release, and the lease remains held through recovery and the complete Run attempt.
- Keep `pipeline.ts`, already about 760 lines, as a caller of the recovery facade. Do not add assessment, policy, archive, or Git-mutation implementation to it.
- Do not change host workflow approval policy or add a dependency.
- Apply the Testing Value Gate. The planned automated tests cover destructive Git behavior, concurrency, persisted state, selection, workflow transitions, and CLI contracts; documentation and help copy use direct verification instead of new text-only tests.
- The planning workspace remains unbootstrapped. Run implementation tests only after plan approval and normal development-environment setup.

---

## File Structure and Responsibilities

### New recovery modules

- `src/cli/commands/run-once/recovery-assessment.ts` — gather saved-state, expected workspace, ordinary and ignored Git status, divergence, actual/saved commit evidence, worktree registration, migration-fence, and artifact-validity facts without mutation.
- `src/cli/commands/run-once/recovery-policy.ts` — pure retry/reset decision table and reset-seed selection.
- `src/cli/commands/run-once/recovery-lease.ts` — serialize lease acquisition, stale takeover, and release with `locks/issue-N.lease-guard`; honor repair locks and owner tokens.
- `src/cli/commands/run-once/recovery-lease.test.ts` — ownership, liveness, three-party serialization, abandoned-guard, remote-owner, repair-lock, and non-owner release tests.
- `src/cli/commands/run-once/recovery-lease-repair.ts` — inspect exact lease/guard/state fingerprints, hold the repair lock, quarantine an expected abandoned lease or guard, and write exact-state legacy migration fences.
- `src/cli/commands/run-once/recovery-lease-repair.test.ts` — changed-fingerprint, atomic quarantine, repair-lock, exact migration-fence, and no-workspace-mutation tests.
- `src/cli/commands/run-once/recovery-archive.ts` — atomically finalize reset archives while preserving exact original state bytes.
- `src/cli/commands/run-once/recovery-archive.test.ts` — exact-byte, archive metadata, path, and archive-failure tests.
- `src/cli/commands/run-once/recovery-mutation.ts` — execute typed pinned-OID refresh, recreation, quarantine, detach, and ref-update plans without merge or recursive removal.
- `src/cli/commands/run-once/recovery-mutation.test.ts` — real-Git, adversarial late-content, OID-CAS, quarantine, staging, and partial-failure tests.

### Existing run-once modules

- `src/cli/commands/run-once/recovery.ts` — replace the blocked-only implementation with the narrow public facade: `planRunRecovery()`, blocked-state compatibility detection, and decision formatting.
- `src/cli/commands/run-once/recovery.test.ts` — test the complete retry/reset decision table, including retry preservation and reset refusal for unique commits.
- `src/cli/commands/run-once/types.ts` — define recovery assessment/decision, reset seed/context, cleanup, and lease-handle types without changing `AgentIssueRunStateStatus`. This declarative domain-schema module may cross 400 lines; keep implementation out of it and group the new recovery declarations beside Run recovery state types so the exception remains navigable.
- `src/cli/commands/run-once/run-state.ts` — read exact state snapshots, persist lease-protocol and blocker-comment receipt fields, clear blocker questions on retry, and perform an exact fresh-claim replacement after reset.
- `src/cli/commands/run-once/run-state.test.ts` — prove receipt merging, lease markers, and exact replacement preserve only the approved seed with fresh timestamps/checkpoints.
- `src/cli/commands/run-once/pipeline-selection.ts` — require explicit issue selection plus `agent-ready` for blocked recovery and revalidate the selected issue after lease acquisition.
- `src/cli/commands/run-once/pipeline-selection-scenarios.test.ts` — prove bare selection and comments do not trigger recovery, and stale issue data is rejected after lease acquisition.
- `src/cli/commands/run-once/pipeline-workspace.ts` — unchanged; callers reuse its existing `configuredWorktreeStrategy()` and `expectedIssueWorkspace()` exports instead of duplicating identity rules.
- `src/cli/commands/run-once/pipeline-lifecycle.ts` — compute recovery claim labels and approved retry/reset checkpoint receipts without embedding recovery policy.
- `src/cli/commands/run-once/pipeline-lifecycle.test.ts` — prove blocked claim removes obsolete recovery labels and reset checkpoint seeding keeps only the start-comment receipt.
- `src/cli/commands/run-once/pipeline-failures.ts` — derive versioned blocker-body receipts, skip only matching comments, and persist a receipt after a successful post.
- `src/cli/commands/run-once/pipeline-failures.test.ts` — prove same-body deduplication, changed-body posting, and no receipt after a failed post.
- `src/cli/commands/run-once/pipeline.ts` — acquire or borrow the Issue run lease after selection, re-read issue and Run recovery state, execute the typed retry decision, pass reset context into fresh claim, and release an owned lease in `finally`.
- `src/cli/commands/run-once/pipeline-workspace-scenarios.test.ts` — end-to-end retry behavior, pinned-base refresh, state/receipt preservation, recreation, quarantine, and refusal-before-effects.
- `src/cli/commands/run-once/pipeline.test.ts` — retain the facade regression that a blocked implementation result can later resume.
- `test-support/run-once/pipeline-fixtures.ts` — make the default blocked fixture zero-ahead and expose explicit dirty, ignored, unique-commit, stale-base, lease, and legacy-fence overrides.

### New reset command modules

- `src/cli/commands/run/main.ts` — nested `patchmill run` command-family dispatch for `reset` and `lease`.
- `src/cli/commands/run/main.test.ts` — behavior tests for nested dispatch and unknown subcommands, not help-copy assertions.
- `src/cli/commands/run/lease/main.ts` — dispatch `patchmill run lease repair`.
- `src/cli/commands/run/lease/main.test.ts` — nested lease dispatch behavior.
- `src/cli/commands/run/config.ts` — load repo root and run-state path without Git base detection or provider construction.
- `src/cli/commands/run/config.test.ts` — real filesystem config loading with Git and provider access unavailable.
- `src/cli/commands/run/lease/repair.ts` — parse repair inspection/confirmation arguments and format fingerprints and outcomes.
- `src/cli/commands/run/lease/repair.test.ts` — positive issue parsing, mutually exclusive fingerprints, required confirmations, and delegation tests.
- `src/cli/commands/run/reset/reset.ts` — perform the ordered reset preflight, lease, re-read, recovery plan, archive, cleanup, and immediate `runOneIssue()` delegation.
- `src/cli/commands/run/reset/reset.test.ts` — realistic status/label eligibility matrices, reset orchestration, quarantine, and all mutation-stopping failures.
- `src/cli/commands/run/reset/main.ts` — parse applicable run-once options, require a positive issue number, report archive/action on stderr, and preserve the existing run-once stdout result contract after execution starts.
- `src/cli/commands/run/reset/main.test.ts` — issue parsing, delegation, exit status, absent-state guidance, and redirected structured-output tests.

### CLI and documentation

- `src/cli/main.ts` — add the `run` command family to top-level dispatch and help.
- `src/cli/main.test.ts` — add behavior coverage that top-level dispatch forwards `run reset --issue N`; do not add a test whose only purpose is help text.
- `README.md` — list `patchmill run reset --issue N` as the supported safe recovery reset command.
- `site/src/content/docs/using-patchmill/run-once.md` — document explicit blocked retry, `agent-ready`, refusal cases, archive behavior, reset, and the absence of force cleanup.

### Intentionally unchanged

- `package.json`, lock files, and Nix files — no dependency is required.
- Host providers — reset uses the existing `RunOnceHostProvider` read and label/comment interfaces.
- Persisted status union — no reset or recovering status is added.
- Existing successful-handoff cleanup — `cleanupIssueWorkspace()` uses `git branch -D` and recursive worktree removal, so recovery must not reuse it. Recovery uses quarantine and expected-OID ref updates.

---

### Task 1: Typed Recovery Assessment and Decision Facade

**Files:**
- Modify: `src/cli/commands/run-once/types.ts:79-180`
- Create: `src/cli/commands/run-once/recovery-assessment.ts`
- Create: `src/cli/commands/run-once/recovery-policy.ts`
- Modify: `src/cli/commands/run-once/recovery.ts:1-410`
- Modify: `src/cli/commands/run-once/recovery.test.ts:1-397`

**Interfaces:**
- Consumes: `CommandRunner`, `AgentIssueRunState`, `ResolvedIssueArtifactSources`, `blockingStatusOutput()`, and `{ branch, worktreePath }` from `expectedIssueWorkspace()`.
- Produces:

```ts
export type RunRecoveryIntent = "retry" | "reset";

export type RunRecoveryClassification =
  | "resumable-current"
  | "resumable-stale-base"
  | "resumable-with-commits"
  | "recreatable-clean"
  | "dirty-worktree"
  | "ignored-worktree-content"
  | "unmerged-commits"
  | "workspace-unverifiable"
  | "legacy-active-unfenced";

export type RunRecoveryLeaseOwner = {
  version: 1;
  issueNumber: number;
  pid: number;
  hostname: string;
  ownerToken: string;
  acquiredAt: string;
};

export type RunResetSeed = {
  issueNumber: number;
  title: string;
  specPath?: string;
  specCommit?: string;
  planPath?: string;
  planCommit?: string;
  startedCommentPosted?: true;
};

export type RunLegacyMigrationFence = {
  version: 1;
  issueNumber: number;
  status: "claimed" | "planning" | "implementing";
  stateSha256: string;
  repairedAt: string;
};

export type RunRecoveryRefreshPlan = {
  branch: string;
  expectedWorktreePath: string;
  expectedBranchOid: string;
  baseOid: string;
  quarantinePath: string;
  stagingPath: string;
};

export type RunRecoveryRecreationPlan = {
  branch: string;
  expectedWorktreePath: string;
  mode: "reuse-existing" | "create-from-base" | "advance-to-base";
  expectedBranchOid?: string;
  targetOid: string;
  pruneStaleRegistration: boolean;
  stagingPath: string;
};

export type RunRecoveryCleanupPlan = {
  branch?: string;
  expectedWorktreePath?: string;
  expectedBranchOid?: string;
  quarantinePath?: string;
  pruneStaleRegistration: boolean;
};

export type RunRecoveryDecision =
  | { action: "resume"; assessment: RunRecoveryAssessment }
  | {
      action: "refresh-and-resume";
      assessment: RunRecoveryAssessment;
      refresh: RunRecoveryRefreshPlan;
    }
  | {
      action: "recreate-and-resume";
      assessment: RunRecoveryAssessment;
      recreation: RunRecoveryRecreationPlan;
    }
  | {
      action: "archive-reset-and-start";
      assessment: RunRecoveryAssessment;
      seed: RunResetSeed;
      cleanup: RunRecoveryCleanupPlan;
    }
  | {
      action: "refuse";
      assessment: RunRecoveryAssessment;
      reason: RunRecoveryClassification | "not-blocked";
      guidance: string[];
    }
  | {
      action: "refuse";
      reason: "active-run";
      resource: "lease" | "lease-guard" | "repair-lock";
      leasePath: string;
      owner?: RunRecoveryLeaseOwner;
      guidance: string[];
    };

export type PlanRunRecoveryInput = {
  intent: RunRecoveryIntent;
  runner: CommandRunner;
  repoRoot: string;
  runStatePath: string;
  state: AgentIssueRunState;
  baseRef: string;
  expectedWorkspace: { branch: string; worktreePath: string };
  ignoredPaths?: string[];
  resolvedArtifacts?: ResolvedIssueArtifactSources;
  leaseOwnerToken: string;
  snapshotRaw: string;
  legacyMigrationFence?: RunLegacyMigrationFence;
};

export async function planRunRecovery(
  input: PlanRunRecoveryInput,
): Promise<RunRecoveryDecision>;

export function formatRunRecoveryDecision(
  decision: RunRecoveryDecision,
): string;
```

- `RunRecoveryAssessment` contains status/blocker facts, pinned base/branch OIDs, exact expected and saved workspace identity, physical/registered worktree facts, ordinary status, ignored-content status, `{ ahead, behind }`, actual unique commit lines, saved loss evidence, lease-protocol and exact migration-fence validity, validated artifact references and source (`base` or `published`), and planned safety guidance. It is JSON-serializable and never contains raw state bytes.
- `PlanRunRecoveryInput` contains intent, runner, repo root, base ref, run-state path, exact state bytes, parsed state, expected workspace, configured ordinary-status exclusions, a possible legacy migration fence, validated published artifact sources, and the acquired lease owner token.
- Lease acquisition happens before workspace assessment. Task 2 converts lease conflicts into the typed `active-run` refusal variant without reading mutable workspace/state under another owner; successful assessments record the acquired owner token in archive metadata.
- Test helpers in this file are local and explicit: `planRecovery(intent, overrides)` creates a temp expected path, constructs a `PlanRunRecoveryInput`, and calls `planRunRecovery()`; its defaults include fixed base/branch OIDs. Overrides set branch existence/OID, registration record, ordinary/ignored status, divergence output, Git log, physical-path existence, saved commits/status, fences, and published artifacts.

- [ ] **Step 1: Replace the old recovery tests with failing facade decision-table tests**

Use the current `runnerFor()` and temp directory pattern, but make the safe default report `rev-list` output `0\t0\n`, empty `git log`, a correctly registered expected branch, and a clean worktree. Add named tests with these exact outcomes:

```ts
test("planRunRecovery resumes a clean current blocked Issue run", async () => {
  const decision = await planRecovery("retry", {
    revList: "0\t0\n",
    log: "",
  });

  assert.equal(decision.action, "resume");
  assert.equal(decision.assessment.classification, "resumable-current");
  assert.deepEqual(decision.assessment.divergence, { ahead: 0, behind: 0 });
});

test("planRunRecovery refreshes a clean zero-commit branch to the pinned base", async () => {
  const decision = await planRecovery("retry", {
    revList: "3\t0\n",
    log: "",
  });

  assert.equal(decision.action, "refresh-and-resume");
  assert.equal(decision.assessment.classification, "resumable-stale-base");
  assert.equal(decision.refresh.expectedBranchOid, "old-base-oid");
  assert.equal(decision.refresh.baseOid, "current-base-oid");
  assert.doesNotMatch(formatRunRecoveryDecision(decision), /landed/i);
});

test("planRunRecovery preserves actual unique commits on retry", async () => {
  const decision = await planRecovery("retry", {
    revList: "0\t2\n",
    log: "def456 add verification\nabc123 implement feature\n",
  });

  assert.equal(decision.action, "resume");
  assert.equal(decision.assessment.classification, "resumable-with-commits");
  assert.deepEqual(decision.assessment.actualUniqueCommits, [
    "def456 add verification",
    "abc123 implement feature",
  ]);
});

test("planRunRecovery refuses to delete actual unique commits on reset", async () => {
  const decision = await planRecovery("reset", {
    revList: "0\t2\n",
    log: "def456 add verification\nabc123 implement feature\n",
  });

  assert.equal(decision.action, "refuse");
  assert.equal(decision.reason, "unmerged-commits");
});
```

Also cover ordinary dirty status, ignored file and directory status, saved `commits` as loss evidence only when the branch is missing, recreation around an existing commit-bearing branch, safe missing-branch recreation, stale registration with absent path, a physical unregistered path, a registered branch/path mismatch, malformed Git output, current and legacy blocked-state detection, retry refusal for non-blocked status, active legacy status with exact/missing/mismatched fences, and reset approval for each saved status after fencing. For reset seed tests, assert that only base/published-validated artifact references plus `startedCommentPosted` survive; `failureCommentKeys` and `blockerCommentKeys` must not survive.

- [ ] **Step 2: Run the recovery test and confirm the old interface cannot satisfy it**

Run:

```sh
node --test src/cli/commands/run-once/recovery.test.ts
```

Expected: FAIL because `planRunRecovery`, the new classifications, ignored-content evidence, migration fences, and reset seed do not exist.

- [ ] **Step 3: Add the recovery types without changing persisted statuses**

Add the interfaces above to `types.ts`. Add optional `leaseProtocolVersion?: 1` and `blockerCommentKeys?: string[]` fields to `AgentIssueRunState` and its update type without changing the status union. Define these supporting shapes with exact field names so archive, mutation, pipeline, and reset code share one vocabulary:

```ts
export type RunRecoveryArtifactAssessment = {
  path?: string;
  commit?: string;
  valid: boolean;
  source?: "base" | "published";
};

export type RunRecoveryAssessment = {
  runStatePath: string;
  issueNumber: number;
  title: string;
  status: AgentIssueRunStateStatus;
  lease: { status: "owned"; ownerToken: string };
  leaseProtocolVersion?: 1;
  legacyMigrationFenceValid: boolean;
  blocked: boolean;
  blockerReason?: string;
  blockerQuestions?: AgentIssueBlockerQuestion[];
  expectedWorkspace: { branch: string; worktreePath: string };
  savedWorkspace: { branch?: string; worktreePath?: string };
  baseOid: string;
  branch: { exists: boolean; oid?: string; checkedOutAt?: string };
  worktree: {
    exists: boolean;
    registered: boolean;
    registeredBranch?: string;
    clean?: boolean;
    dirtyStatus?: string;
    ignoredStatus?: string;
    ignoredEntries: string[];
  };
  divergence?: { ahead: number; behind: number };
  actualUniqueCommits: string[];
  savedCommits: string[];
  artifacts: {
    spec: RunRecoveryArtifactAssessment;
    plan: RunRecoveryArtifactAssessment;
  };
  classification: RunRecoveryClassification;
};
```

Keep `AgentIssueRunStateStatus` exactly `claimed | planning | implementing | blocked | finished`.

- [ ] **Step 4: Implement read-only assessment in `recovery-assessment.ts`**

Implement `assessRunRecovery()` with injected `CommandRunner` and filesystem functions. It must:

```ts
export async function assessRunRecovery(
  input: PlanRunRecoveryInput,
): Promise<RunRecoveryAssessment>;
```

Resolve `baseRef^{commit}` and the branch ref to exact OIDs before other Git decisions. Use `git worktree list --porcelain` to prove both path and branch registration. Run `git status --porcelain=v1 --untracked-files=all` for ordinary status and run the same command with `--ignored=matching` to inventory every `!!` path. Apply `blockingStatusOutput()` only to ordinary status; configured exclusions must not hide ignored content. Use the pinned OIDs for divergence and actual unique-commit queries. Validate a saved artifact only when `git cat-file -t ${baseOid}:${path}` returns `blob`, or when an already validated published source has the same path and a non-conflicting commit. Hash `snapshotRaw` and validate a legacy migration fence only for the same issue, active status, and exact hash. Never run a Git mutation in this module.

Classification precedence must be: unverifiable identity, dirty ordinary status, ignored content, missing-branch saved loss evidence, legacy-active fence failure, recreatable absence, existing unique commits, stale zero-ahead base, current zero-ahead base. An existing branch with `ahead > 0` is `resumable-with-commits`; policy, not assessment, refuses its deletion for reset.

- [ ] **Step 5: Implement pure policy and the narrow facade**

Implement a pure `decideRunRecovery(intent, assessment)` in `recovery-policy.ts`. Retry requires current or legacy blocked state. It accepts `resumable-with-commits` without a Git mutation. A stale retry returns an explicit refresh plan. Recreation returns an explicit mode, expected OID, target OID, stale-registration flag, and staging path. Reset accepts every saved status after legacy fencing, but converts actual unique commits to an `unmerged-commits` refusal and returns a cleanup plan with the expected branch OID and quarantine path. A reset decision derives `RunResetSeed` from valid assessed artifacts and `startedCommentPosted` only. In `recovery.ts`, export `planRunRecovery()` as the single assessment-plus-policy entry point and keep `hasBlockedRunRecoveryState()` for current/legacy compatibility.

Format refusal guidance from the typed decision. Dirty guidance lists blocking status; unmerged guidance lists commits; unverifiable guidance names the mismatched path/branch. A zero-ahead ancestor must be described as “empty” or “stale,” never “landed” or “already merged.”

- [ ] **Step 6: Run the focused recovery tests**

Run:

```sh
node --test src/cli/commands/run-once/recovery.test.ts
```

Expected: PASS for every retry/reset decision-table case.

- [ ] **Step 7: Commit the assessment and policy seam**

```sh
git add src/cli/commands/run-once/types.ts \
  src/cli/commands/run-once/recovery.ts \
  src/cli/commands/run-once/recovery-assessment.ts \
  src/cli/commands/run-once/recovery-policy.ts \
  src/cli/commands/run-once/recovery.test.ts
git commit -m "feat: model safe issue run recovery decisions"
```

---

### Task 2: Per-Issue Process Lease

**Files:**
- Create: `src/cli/commands/run-once/recovery-lease.ts`
- Create: `src/cli/commands/run-once/recovery-lease.test.ts`
- Create: `src/cli/commands/run-once/recovery-lease-repair.ts`
- Create: `src/cli/commands/run-once/recovery-lease-repair.test.ts`
- Modify: `src/cli/commands/run-once/types.ts` (lease, repair, and migration-fence aliases only)
- Modify: `src/cli/commands/run-once/recovery.ts` (typed active-run refusal conversion)
- Modify: `src/cli/commands/run-once/recovery.test.ts` (active-run formatting)

**Interfaces:**
- Consumes: configured `runStateDir`, issue number, Node `open(..., "wx")`, atomic rename, SHA-256, `hostname()`, `process.pid`, `process.kill(pid, 0)`, and an owner token from `randomUUID()`.
- Produces:

```ts
export type IssueRunLeaseRecord = RunRecoveryLeaseOwner;
export type IssueRunLeaseGuardRecord = RunRecoveryLeaseOwner;

export type IssueRunLease = {
  path: string;
  record: IssueRunLeaseRecord;
};

export class IssueRunLeaseConflictError extends Error {
  readonly classification = "active-run";
  readonly leasePath: string;
  readonly resource: "lease" | "lease-guard" | "repair-lock";
  readonly owner?: IssueRunLeaseRecord;
}

export type IssueRunLeaseOptions = {
  pid?: number;
  hostname?: string;
  ownerToken?: string;
  now?: () => Date;
  processState?: (pid: number) => "alive" | "dead" | "unverifiable";
};

export async function acquireIssueRunLease(
  runStateDir: string,
  issueNumber: number,
  options?: IssueRunLeaseOptions,
): Promise<IssueRunLease>;

export async function releaseIssueRunLease(
  lease: IssueRunLease,
): Promise<void>;

export async function withIssueRunLease<T>(
  input: {
    runStateDir: string;
    issueNumber: number;
    lease?: IssueRunLease;
  },
  action: (lease: IssueRunLease) => Promise<T>,
): Promise<T>;

export function activeRunRecoveryDecision(
  error: IssueRunLeaseConflictError,
): Extract<RunRecoveryDecision, { action: "refuse"; reason: "active-run" }>;

export type IssueRunLeaseRepairInspection =
  | { kind: "remote-lease"; sha256: string; owner: IssueRunLeaseRecord }
  | { kind: "abandoned-guard"; sha256: string; owner?: IssueRunLeaseGuardRecord }
  | { kind: "legacy-active-state"; sha256: string; status: RunLegacyMigrationFence["status"] }
  | { kind: "nothing-to-repair" };

export async function readRunLegacyMigrationFence(
  runStateDir: string,
  issueNumber: number,
): Promise<RunLegacyMigrationFence | undefined>;

export async function inspectIssueRunLeaseRepair(
  runStateDir: string,
  issueNumber: number,
): Promise<IssueRunLeaseRepairInspection>;

export async function repairIssueRunLease(input: {
  runStateDir: string;
  issueNumber: number;
  expectedLeaseSha256?: string;
  expectedGuardSha256?: string;
  expectedStateSha256?: string;
  confirmedProcessesStopped: boolean;
  now?: () => Date;
}): Promise<{ kind: "lease-quarantined" | "guard-quarantined" | "legacy-fence-written"; path: string }>;
```

`withIssueRunLease()` owns and releases a lease it acquires. It validates but does not release a borrowed reset lease. Acquisition and release both hold `locks/issue-N.lease-guard` from before the first canonical-lease read through the final write or unlink. The guard uses exclusive creation and owner-token release. A guard conflict refuses; automatic code never replaces it. Lease acquisition also refuses when `locks/issue-N.repair.lock` exists. Lease tests define `runStateDir` from `mkdtemp()`, `fixedClock` as `() => new Date("2026-08-28T12:00:00.000Z")`, `localOwner` as `{pid:101, hostname:"build-host", ownerToken:"owner-a", now:fixedClock}`, and `secondOwner` with pid `202` and token `owner-b`; each test overrides only `processState`.

Repair inspection is read-only. Confirmed repair requires exactly one expected SHA-256 value and the matching confirmation flag. It exclusively creates the repair lock, re-reads exact bytes, and refuses if the fingerprint changed. Remote lease repair also acquires the transaction guard, then atomically renames only the expected lease into `archive/leases/issue-N/`. Guard repair requires all runners stopped and quarantines the exact guard under the repair lock. Legacy repair writes `locks/issue-N.legacy-fence.json` for the exact active-state hash. No mode reads or mutates a worktree, host label, comment, or active state file.

- [ ] **Step 1: Write failing lease ownership and liveness tests**

Use a temporary `runStateDir` and injected deterministic `pid`, hostname, token, clock, and process-liveness function. Add these exact behaviors:

```ts
test("one owner acquires and releases the Issue run lease", async () => {
  const lease = await acquireIssueRunLease(runStateDir, 45, localOwner);
  assert.equal(JSON.parse(await readFile(lease.path, "utf8")).ownerToken, "owner-a");

  await releaseIssueRunLease(lease);
  await assert.rejects(readFile(lease.path, "utf8"), { code: "ENOENT" });
});

test("a live same-host owner blocks another Run attempt", async () => {
  await acquireIssueRunLease(runStateDir, 45, localOwner);

  await assert.rejects(
    acquireIssueRunLease(runStateDir, 45, {
      ...secondOwner,
      processState: () => "alive",
    }),
    (error: unknown) =>
      error instanceof IssueRunLeaseConflictError &&
      error.classification === "active-run",
  );
});
```

Also test dead same-host replacement while the guard is held, remote owner refusal without a local liveness probe, malformed/unverifiable record refusal, `EPERM`/unknown liveness refusal, active repair-lock refusal, abandoned-guard refusal, non-owner release refusal, borrowed lease issue mismatch, borrowed lease retained after callback, owned lease release under a guard when the callback throws, and conversion/formatting of guard/lease conflicts as typed `active-run` refusals. Add a controlled three-party test: contender A pauses after observing a dead lease, while B and C must fail on the guard and cannot rename or create the canonical lease; after A completes, later acquisition observes A's live lease.

- [ ] **Step 2: Run the lease test and confirm it fails**

Run:

```sh
node --test src/cli/commands/run-once/recovery-lease.test.ts
```

Expected: FAIL because the lease module does not exist.

- [ ] **Step 3: Implement exclusive creation and stale takeover**

Before any canonical lease read, create `locks/issue-45.lease-guard` with `open(path, "wx", 0o600)` and a newline-terminated owner record. If it exists, refuse without liveness-based takeover. While the guard is held, recheck the repair lock, then create `locks/issue-45.lock` with exclusive creation when no active lease exists.

For stale same-host takeover, keep the same guard from before observation through archival and replacement. Atomically rename the observed lease to a unique stale archive path, verify its exact owner token, and create the replacement lease before releasing the guard. No second or third acquirer can observe or mutate the canonical path during this sequence. Never unlink an unvalidated path occupant.

Implement liveness as:

```ts
function localProcessState(pid: number): "alive" | "dead" | "unverifiable" {
  try {
    process.kill(pid, 0);
    return "alive";
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ESRCH") return "dead";
    return "unverifiable";
  }
}
```

Release must acquire the transaction guard, re-read the current lease, compare `ownerToken`, unlink only the matching lease, and then release the matching guard. Acquisition checks the repair lock before and after guard creation. If repair starts in that interval, it releases its guard and refuses.

- [ ] **Step 4: Write failing fingerprinted repair tests**

Add tests that inspect exact remote-lease, abandoned-guard, and active legacy-state fingerprints. Confirmed repair must require the matching confirmation mode. Prove that a changed byte refuses without quarantine or fence creation, a repair lock blocks lease acquisition, and a concurrent lease replacement is never moved. Prove that remote repair holds the transaction guard, guard repair requires all-runners-stopped confirmation, each successful repair archives exact source bytes, and legacy repair writes a fence for the exact state hash and status. Record filesystem calls and assert that no Git or host adapter runs.

- [ ] **Step 5: Implement fenced operator-assisted repair**

Use `createHash("sha256")` over exact bytes. Inspection returns guidance data only. Confirmation creates `locks/issue-45.repair.lock` with `open(..., "wx")`, re-reads the selected source, compares the hash, and performs one action. For a lease, acquire the transaction guard, rename the expected lease to a temporary quarantine name, recheck its hash, restore it on mismatch when possible, and finalize it under `archive/leases/issue-45/`. For the guard itself, require `--confirm-all-runners-stopped` and quarantine only the exact expected guard while the repair lock excludes new acquisition. For legacy state, atomically write `locks/issue-45.legacy-fence.json` with issue, active status, exact state hash, and repair time. Release only owned guard and repair locks.

- [ ] **Step 6: Run the lease and repair tests**

Run:

```sh
node --test \
  src/cli/commands/run-once/recovery-lease.test.ts \
  src/cli/commands/run-once/recovery-lease-repair.test.ts
```

Expected: PASS with no owned guard left after completed transitions, no competing lease renamed, exact lease/guard quarantine bytes, and exact-state legacy fences.

- [ ] **Step 7: Commit the lease modules**

```sh
git add src/cli/commands/run-once/types.ts \
  src/cli/commands/run-once/recovery.ts \
  src/cli/commands/run-once/recovery.test.ts \
  src/cli/commands/run-once/recovery-lease.ts \
  src/cli/commands/run-once/recovery-lease.test.ts \
  src/cli/commands/run-once/recovery-lease-repair.ts \
  src/cli/commands/run-once/recovery-lease-repair.test.ts
git commit -m "feat: lease and repair issue runs"
```

---

### Task 3: Preserving Recovery Git Mutations

**Files:**
- Create: `src/cli/commands/run-once/recovery-mutation.ts`
- Create: `src/cli/commands/run-once/recovery-mutation.test.ts`

**Interfaces:**
- Consumes: a non-refusal typed decision with pinned OIDs and explicit refresh, recreation, or cleanup plans; `CommandRunner`; repo root; and a `reassess()` callback.
- Test helpers create real repositories and expose command barriers that can add files or move refs immediately before each Git command.
- Produces:

```ts
export type RunRecoveryMutationResult = {
  action: Exclude<RunRecoveryDecision["action"], "refuse">;
  completed: Array<
    | { kind: "stage-worktree"; path: string; oid: string }
    | { kind: "quarantine-worktree"; from: string; to: string }
    | { kind: "restore-worktree"; from: string; to: string }
    | { kind: "detach-quarantine"; path: string; oid: string }
    | { kind: "update-branch"; branch: string; from?: string; to?: string }
    | { kind: "prune-stale-registration" }
    | { kind: "publish-worktree"; from: string; to: string }
    | { kind: "recreate-worktree"; worktreePath: string; oid: string }
  >;
  quarantinePaths: string[];
  stagingPaths: string[];
};

export async function executeRunRecoveryMutation(input: {
  decision: Exclude<RunRecoveryDecision, { action: "refuse" }>;
  runner: CommandRunner;
  repoRoot: string;
  reassess: () => Promise<RunRecoveryDecision>;
}): Promise<RunRecoveryMutationResult>;
```

- [ ] **Step 1: Write failing real-Git refresh and quarantine tests**

Build a temporary repository with a main branch, an issue branch/worktree at the old base, and a later base commit. Use fixed old-branch and base OIDs in the decision.

Prove that stale refresh creates a detached staging worktree at `baseOid`, moves the complete old worktree to quarantine, detaches the quarantined `HEAD` without changing its files, advances the branch with expected-OID `git update-ref`, and publishes the staging worktree at the expected path. Assert that the expected worktree contains current-base content and the quarantine remains registered, detached, and readable.

Add a moving-ref test. Advance the configured base name after assessment and assert that refresh still uses the pinned `baseOid`. Move the issue branch after assessment and assert that expected-OID update refuses without deleting either checkout.

- [ ] **Step 2: Write failing adversarial late-content tests**

Use command barriers to inject content at the narrowest race points:

- add ignored `.env` after final reassessment but immediately before old-worktree movement;
- add ignored content through an open handle after the move and before branch update;
- add ignored content to the staging worktree before branch attachment;
- create a non-empty expected target path before staging publication;
- add ignored content after worktree recreation but before recovery returns;
- add ignored content immediately before reset quarantine movement.

Assert that no injected byte is deleted or overwritten. Pre-move content must cause restore-and-refuse when restoration is safe, or remain in the reported quarantine. Staging content must refuse publication and remain at the staging path. A target-path race must refuse without replacing the target. Post-recreation content must refuse before pipeline effects. Reset must keep late content in its detached quarantine and must not delete the branch until the quarantine is detached.

Assert that recovery never invokes `git merge`, `git worktree remove`, recursive filesystem removal, `git branch -D`, or a force flag.

- [ ] **Step 3: Run the mutation test and confirm it fails**

Run:

```sh
node --test src/cli/commands/run-once/recovery-mutation.test.ts
```

Expected: FAIL because the preserving mutation module does not exist.

- [ ] **Step 4: Implement refresh, recreation, and reset only from typed plans**

For `refresh-and-resume`, create the detached staging worktree at `refresh.baseOid`. Reassess and require the same action plus identical OIDs and paths. Move the registered expected worktree with `git worktree move` to `refresh.quarantinePath`. Inspect ordinary and ignored status at the moved path. If new content exists, restore only when the expected path is absent; otherwise retain quarantine and refuse.

Detach the quarantined administrative `HEAD` with `git update-ref --no-deref HEAD <expectedBranchOid>` and an expected old value. Advance `refs/heads/<branch>` with `git update-ref <baseOid> <expectedBranchOid>`. Recheck staging status, attach its administrative `HEAD` to the branch without checking out files, and publish it with `git worktree move`. If the target exists or later work fails, preserve and report staging/quarantine paths. Do not dereference `baseRef` during mutation.

For recreation, use only `decision.recreation`. Prune a stale registration only when the plan says so. Apply any zero-ahead branch advance by expected-OID update before worktree creation. Create the worktree at a staging path, inspect it, and publish it to the expected absent path. Recheck the published worktree before returning. A unique-commit recreation uses `reuse-existing` and never changes the branch OID.

For reset, move the registered worktree to `cleanup.quarantinePath`, inspect it, and keep it registered. Detach its `HEAD` by expected OID without changing worktree files. Delete the branch with `git update-ref -d refs/heads/<branch> <expectedBranchOid>`. Never remove the quarantine. Return every completed action and preserved path when a later action fails.

- [ ] **Step 5: Run mutation and existing Git tests**

Run:

```sh
node --test \
  src/cli/commands/run-once/recovery-mutation.test.ts \
  src/cli/commands/run-once/git.test.ts \
  src/cli/commands/run-once/pipeline-workspace.test.ts
```

Expected: PASS. Successful-handoff cleanup remains unchanged. Recovery uses pinned OIDs, quarantine, and compare-and-swap without destructive checkout removal.

- [ ] **Step 6: Commit preserving mutations**

```sh
git add src/cli/commands/run-once/recovery-mutation.ts \
  src/cli/commands/run-once/recovery-mutation.test.ts
git commit -m "feat: preserve workspaces during issue run recovery"
```

---

### Task 4: Exact Archives and Fresh Reset State

**Files:**
- Create: `src/cli/commands/run-once/recovery-archive.ts`
- Create: `src/cli/commands/run-once/recovery-archive.test.ts`
- Modify: `src/cli/commands/run-once/run-state.ts:20-281`
- Modify: `src/cli/commands/run-once/run-state.test.ts:1-552`
- Modify: `src/cli/commands/run-once/pipeline-lifecycle.ts:45-118`
- Modify: `src/cli/commands/run-once/pipeline-lifecycle.test.ts:1-85`
- Modify: `src/cli/commands/run-once/types.ts` (snapshot/reset context types)

**Interfaces:**
- Consumes: raw active state bytes, parsed Run recovery state, typed recovery assessment/decision, reset seed, command name, base ref, and clock.
- Produces:

```ts
export type RunStateSnapshot = {
  path: string;
  raw: string;
  state: AgentIssueRunState;
};

export type RunResetContext = {
  lease: IssueRunLease;
  archivePath: string;
  quarantinePaths: string[];
  seed: RunResetSeed;
};

export async function readRunStateSnapshot(
  runStateDir: string,
  issueNumber: number,
): Promise<RunStateSnapshot | undefined>;

export async function archiveRunRecovery(input: {
  runStateDir: string;
  snapshot: RunStateSnapshot;
  assessment: RunRecoveryAssessment;
  decision: Extract<
    RunRecoveryDecision,
    { action: "archive-reset-and-start" }
  >;
  command: "patchmill run reset";
  baseRef: string;
  now: Date;
}): Promise<{ path: string }>;

export async function replaceRunStateAfterReset(
  runStateDir: string,
  input: { issueNumber: number; title: string; seed: RunResetSeed },
  now?: string,
): Promise<AgentIssueRunState>;

export async function adoptRunStateLeaseProtocol(input: {
  snapshot: RunStateSnapshot;
  expectedStateSha256: string;
  lease: IssueRunLease;
  now?: string;
}): Promise<AgentIssueRunState>;
```

- [ ] **Step 1: Write failing archive tests**

Write an active state file with deliberate whitespace and no trailing newline. Define `archiveFixture(raw)` in the test to write the active file, call `readRunStateSnapshot()`, and return a complete `archiveRunRecovery()` input with fixed base ref, decision, seed, command, and clock. Then assert exact byte equality:

```ts
test("archiveRunRecovery preserves exact state bytes and records the decision", async () => {
  const raw = '{\n  "issueNumber": 45,\n  "title": "Recover",\n  "status": "blocked"\n}';
  const input = await archiveFixture(raw);
  const archived = await archiveRunRecovery(input);

  assert.equal(await readFile(join(archived.path, "run-state.json"), "utf8"), raw);
  const assessment = JSON.parse(
    await readFile(join(archived.path, "recovery-assessment.json"), "utf8"),
  );
  assert.equal(assessment.command, "patchmill run reset");
  assert.equal(assessment.issueNumber, 45);
  assert.equal(assessment.baseRef, "origin/main");
  assert.equal(assessment.recoveryClassification, "resumable-current");
  assert.deepEqual(assessment.fieldsSelectedForPreservation, [
    "issueNumber",
    "title",
    "specPath",
    "specCommit",
    "startedCommentPosted",
  ]);
});
```

Also assert the ISO-derived directory contains no `:`, the final directory contains both files, a collision gets a stable numeric suffix rather than overwriting, and a write/rename failure leaves no finalized archive that reset could mistake for complete.

- [ ] **Step 2: Write failing exact reset-state and retry-clear tests**

Add `run-state.test.ts` cases that start from a fully populated `implementing` state, then call `replaceRunStateAfterReset()` and assert deep equality to a fresh `claimed` state containing only validated spec/plan fields, `checkpoints: {claimed: true, startedCommentPosted: true}`, `leaseProtocolVersion: 1`, and new `createdAt`, `updatedAt`, and `claimedAt`. Explicitly assert absence of `failureCommentKeys`, `blockerCommentKeys`, branch, worktree, blocker, implementation, PR/merge, validation, review, landing, cost, visual evidence, handoff, and old lifecycle timestamps.

Add an adoption test that starts from active legacy state and an exact fingerprint. `adoptRunStateLeaseProtocol()` must preserve every field, add only `leaseProtocolVersion: 1` plus `updatedAt`, and use atomic replacement. A changed current file, mismatched issue lease, or mismatched fingerprint must refuse without rewriting state.

Add a retry update test:

```ts
const resumed = await writeRunState(runStateDir, {
  issueNumber: 45,
  title: "Recover blocked run",
  status: "claimed",
  clearLastError: true,
  clearBlockerQuestions: true,
});
assert.equal(resumed.lastError, undefined);
assert.equal(resumed.blockerQuestions, undefined);
assert.equal(resumed.blockedAt, blockedAt);
assert.equal(resumed.checkpoints?.startedCommentPosted, true);
assert.deepEqual(resumed.failureCommentKeys, ["unexpected-failure:planning"]);
assert.deepEqual(resumed.blockerCommentKeys, ["blocker-comment:v1:abc123"]);
assert.equal(resumed.leaseProtocolVersion, 1);
```

- [ ] **Step 3: Run the archive, run-state, and lifecycle tests and confirm failure**

Run:

```sh
node --test \
  src/cli/commands/run-once/recovery-archive.test.ts \
  src/cli/commands/run-once/run-state.test.ts \
  src/cli/commands/run-once/pipeline-lifecycle.test.ts
```

Expected: FAIL because snapshot/archive/exact-replacement and blocker-question clearing do not exist.

- [ ] **Step 4: Implement snapshot reads and archive finalization**

`readRunStateSnapshot()` must read once, preserve the exact string, parse it, and return both. `readRunState()` may delegate to it.

`archiveRunRecovery()` must create a sibling temporary directory, write `run-state.json` unchanged, and write newline-terminated formatted assessment JSON containing format version/archive time, command, issue number, base ref plus pinned base/branch OIDs, recovery classification, divergence, unique commits, ordinary/ignored worktree status, lease-protocol/migration-fence evidence, fields selected for preservation, and typed quarantine/ref/recreation plans. Rename the temporary directory to:

```text
archive/issue-45/2026-08-28T12-34-56-789Z/
```

Only return after the final directory exists. Leave active Run recovery state untouched.

- [ ] **Step 5: Implement exact reset replacement and recovery lifecycle helpers**

Add `clearBlockerQuestions?: boolean` to `AgentIssueRunStateUpdate`. Implement merge behavior for the Task 1 `blockerCommentKeys` and `leaseProtocolVersion` fields. Clearing questions takes precedence over merge preservation. Merge failure and blocker keys uniquely within the same Issue run. The first claim write under a lease sets `leaseProtocolVersion: 1`; later merge writes preserve it.

Implement `replaceRunStateAfterReset()` by constructing a new object rather than spreading old state. Preserve only the `RunResetSeed`, map `startedCommentPosted` to the checkpoint receipt, add `claimed: true` and `leaseProtocolVersion: 1`, set status/timestamps to fresh claim values, and use a same-directory temporary file plus rename so readers never see partial JSON. Do not copy failure or blocker receipt keys.

Implement `adoptRunStateLeaseProtocol()` as an exact-byte compare-and-swap. Validate the lease issue, fingerprint, active legacy status, and unchanged current bytes. Then write the same parsed state with `leaseProtocolVersion: 1` and a new `updatedAt` through same-directory temporary-file rename. Do not change status, checkpoints, receipts, artifacts, or lifecycle timestamps.

In `pipeline-lifecycle.ts`, add narrow helpers for:

```ts
export function recoveryClaimLabels(
  labels: string[],
  input: {
    ready: string;
    inProgress: string;
    needsInfo: string;
    recoveringBlocked: boolean;
  },
): string[];

export function resetReceiptCheckpoints(
  seed: RunResetSeed,
): AgentIssueRunCheckpoints;
```

Blocked recovery removes `ready` and obsolete `needsInfo`, then adds `inProgress` once. Reset receipt checkpoints return only `startedCommentPosted` when present; the fresh claim writer adds `claimed`.

- [ ] **Step 6: Run the focused persistence tests**

Run:

```sh
node --test \
  src/cli/commands/run-once/recovery-archive.test.ts \
  src/cli/commands/run-once/run-state.test.ts \
  src/cli/commands/run-once/pipeline-lifecycle.test.ts
```

Expected: PASS, including exact archive bytes and exact fresh state shape.

- [ ] **Step 7: Commit archive and state semantics**

```sh
git add src/cli/commands/run-once/types.ts \
  src/cli/commands/run-once/recovery-archive.ts \
  src/cli/commands/run-once/recovery-archive.test.ts \
  src/cli/commands/run-once/run-state.ts \
  src/cli/commands/run-once/run-state.test.ts \
  src/cli/commands/run-once/pipeline-lifecycle.ts \
  src/cli/commands/run-once/pipeline-lifecycle.test.ts
git commit -m "feat: archive and replace issue run recovery state"
```

---

### Task 5: Explicit Blocked Retry in the Normal Pipeline

**Files:**
- Modify: `src/cli/commands/run-once/pipeline-selection.ts:61-164`
- Modify: `src/cli/commands/run-once/pipeline-selection.test.ts`
- Modify: `src/cli/commands/run-once/pipeline-selection-scenarios.test.ts:252-990`
- Modify: `src/cli/commands/run-once/pipeline.ts:103-760`
- Modify: `src/cli/commands/run-once/pipeline-failures.ts:35-162`
- Modify: `src/cli/commands/run-once/pipeline-failures.test.ts`
- Modify: `src/cli/commands/run-once/pipeline-comments.ts` (versioned blocker-comment key helper only)
- Modify: `src/cli/commands/run-once/pipeline-workspace-scenarios.test.ts:209-666`
- Modify: `src/cli/commands/run-once/pipeline.test.ts:390-431`
- Modify: `test-support/run-once/pipeline-fixtures.ts:234-447`

**Interfaces:**
- Consumes: `planRunRecovery({intent:"retry"})`, `executeRunRecoveryMutation()`, `withIssueRunLease()`, `recoveryClaimLabels()`, `writeRunState()` clear flags, and existing workspace/artifact pipeline functions.
- Produces:

```ts
export async function revalidateSelectedIssue(input: {
  issue: IssueSummary;
  state?: AgentIssueRunState;
  config: AgentIssueConfig;
  selectedAsResume: boolean;
}): Promise<{ issue: IssueSummary; recovery: "ordinary" | "blocked" | "fresh" }>;
```

`runOneIssue()` keeps its public signature. `RunOneIssueOptions` gains an optional borrowed `lease` and later an optional reset context, but ordinary callers remain source-compatible.

- [ ] **Step 1: Make safe blocked fixtures represent zero unique commits**

Change `writeBlockedRecoveryRunState()` safe defaults to `commits: []`. Change `blockedRecoveryRunner()` defaults to `revList: "0\t0\n"`, `log: ""`, and empty ignored status. Add explicit fixture options for `savedCommits`, `actualCommits`, `behind`, `ignoredStatus`, `leaseRecord`, `leaseProtocolVersion`, `legacyFence`, existing comment bodies, and `onGitMutation` so safety and ordering tests state their evidence.

Do not weaken existing unsafe tests: update them to pass explicit commits/divergence.

- [ ] **Step 2: Write failing selection tests for explicit acknowledgment**

Add these behavior tests:

```ts
test("explicit blocked retry requires agent-ready even when a comment says ready", async () => {
  await writeBlockedRecoveryRunState(config);
  const selected = issue(45, ["needs-info"], "Recover blocked run");
  selected.comments = [{ body: "agent-ready", authorLogin: "maintainer" }];

  await assert.rejects(
    runOneIssue(blockedRecoveryRunner(config, {
      selectedLabels: ["needs-info"],
      selectedComments: selected.comments,
    }), { ...config, issueNumber: 45 }),
    /not labeled agent-ready/,
  );
});

test("bare run-once does not select blocked Run recovery state", async () => {
  await writeBlockedRecoveryRunState(config);
  const result = await runOneIssue(
    blockedRecoveryRunner(config, { selectedLabels: ["agent-ready", "needs-info"] }),
    { ...config, issueNumber: undefined },
  );
  assert.equal(result.status, "no-issue");
});
```

Add a stale-data test in which first selection sees `agent-ready`, the lease is acquired, the re-read issue lacks `agent-ready`, and no label, comment, state, worktree, or Pi mutation occurs.

- [ ] **Step 3: Write failing retry pipeline tests**

In `pipeline-workspace-scenarios.test.ts`, prove an explicit acknowledged retry:

- acquires `locks/issue-45.lock` before recovery inspection and retains it through the Pi result;
- re-reads issue and Run recovery state after acquisition;
- changes `[agent-ready, needs-info]` to `in-progress` through the normal claim transition;
- clears `lastError` and `blockerQuestions` while retaining `blockedAt`;
- preserves valid spec/plan paths and commits, monotonic stage checkpoints, `startedCommentPosted`, publication/handoff receipts, `failureCommentKeys`, and `blockerCommentKeys`;
- exact-matches the canonical saved blocker comment against existing comments and persists a legacy receipt before clearing blocker fields;
- does not post a second start or matching blocker comment, but posts and receipts a changed blocker body;
- reuses `resumable-current` worktree;
- resumes `resumable-with-commits` without merge, reset, branch deletion, or commit rewrite;
- refreshes `resumable-stale-base` to the pinned base through quarantine before artifact/Pi reads;
- recreates an absent worktree around an existing unique-commit branch without changing its head;
- refuses dirty, ignored, missing-branch saved commit, unfenced legacy-active, and unverifiable path cases before label/comment/state/Git mutation.

Assert Git call order for stale base:

```ts
const quarantineIndex = runner.calls.findIndex(
  (call) => call.command === "git" && call.args.includes("move"),
);
const updateRefIndex = runner.calls.findIndex(
  (call) => call.command === "git" && call.args.includes("update-ref"),
);
const piIndex = runner.calls.findIndex((call) => call.command === "pi");
assert.ok(quarantineIndex >= 0);
assert.ok(updateRefIndex > quarantineIndex);
assert.ok(piIndex > updateRefIndex);
```

Use the real-Git test from Task 3 as proof that a refreshed zero-ahead worktree contains the pinned base content and retains its quarantine. The pipeline scenario proves ordering, preserved-path reporting, and delegation. Add a commit-bearing scenario that records old base/head OIDs and proves that both remain unchanged through Pi entry.

- [ ] **Step 4: Run the selection/workspace scenarios and confirm failure**

Run:

```sh
node --test \
  src/cli/commands/run-once/pipeline-selection.test.ts \
  src/cli/commands/run-once/pipeline-selection-scenarios.test.ts \
  src/cli/commands/run-once/pipeline-workspace-scenarios.test.ts \
  src/cli/commands/run-once/pipeline.test.ts
```

Expected: FAIL because blocked selection does not require `agent-ready`, the pipeline does not lease/re-read/refresh/recreate, and blocker questions are not cleared.

- [ ] **Step 5: Revalidate selection after lease acquisition**

Update `selectResumableIssue()` so its blocked-state exception applies only when all are true: `config.issueNumber` is set, execution is real, the current/legacy state is blocked recovery, and the issue has the configured ready label. Keep automatic selection unchanged.

Implement `revalidateSelectedIssue()` to accept ordinary resumable `in-progress` state, explicit blocked recovery with `agent-ready`, or a normally actionable fresh issue. Reuse existing workflow-state and approval logic; do not inspect comments.

- [ ] **Step 6: Wrap each selected Run attempt in the Issue run lease**

After initial selection and before reading `existingState`, call `withIssueRunLease()` for every real Run attempt. Inside its callback, re-read `host.viewIssue(issue.number)`, the exact state snapshot, and `readRunLegacyMigrationFence()`, then call `revalidateSelectedIssue()`. Active `claimed`, `planning`, or `implementing` state without `leaseProtocolVersion = 1` requires a fence that matches the exact snapshot hash. A supplied reset lease is borrowed and remains owned by reset orchestration. An automatically acquired lease is released in `finally` for every terminal result and thrown error.

Keep dry-run outside lease acquisition because it mutates neither state nor Git. For an ordinary resume of exact-fenced legacy active state, call `adoptRunStateLeaseProtocol()` before any host, Git, artifact, or Pi mutation. The normal claim transition records `leaseProtocolVersion = 1` for fresh and blocked-retry state; later state writes preserve it.

- [ ] **Step 7: Replace blocked-only recovery branching with typed decisions**

For a blocked retry, call `planRunRecovery({intent:"retry", leaseOwnerToken: lease.record.ownerToken, snapshotRaw, ...})`. Throw `AgentIssueSafetyError(formatRunRecoveryDecision(decision))` for refusal. Execute resume, pinned-OID refresh, or typed recreation through `executeRunRecoveryMutation()` before artifact preflight. A `resumable-with-commits` decision performs no Git recovery mutation and retains its existing base/head OIDs.

Before clearing blocker fields, derive `blocker-comment:v1:<sha256>` from the canonical saved blocker body. If an exact issue comment body matches, merge that key into `blockerCommentKeys`. Do not use partial text, author identity, or comments for acknowledgment or eligibility.

Update `blockIssue()` to derive the key for the new canonical body, skip only when the same key exists, and persist the key only after `commentIssue()` succeeds. A changed reason or question set produces a different key and a new comment. A failed post produces no receipt.

Set `recoveringBlocked` from the accepted decision, use `recoveryClaimLabels()`, and force the normal claim step even when the old `claimed` checkpoint is true. In that claim write, preserve checkpoints, artifacts, and same-Issue-run receipts, set status `claimed`, and pass both clear flags:

```ts
await writeRunState(config.runStateDir, {
  issueNumber: issue.number,
  title: issue.title,
  status: "claimed",
  checkpoints: { claimed: true },
  clearLastError: true,
  clearBlockerQuestions: true,
  leaseProtocolVersion: 1,
});
```

Do not clear `blockedAt`, same-Issue-run receipts, or valid monotonic checkpoints.

- [ ] **Step 8: Run focused retry tests**

Run:

```sh
node --test \
  src/cli/commands/run-once/recovery.test.ts \
  src/cli/commands/run-once/recovery-lease.test.ts \
  src/cli/commands/run-once/recovery-mutation.test.ts \
  src/cli/commands/run-once/pipeline-selection.test.ts \
  src/cli/commands/run-once/pipeline-selection-scenarios.test.ts \
  src/cli/commands/run-once/pipeline-workspace-scenarios.test.ts \
  src/cli/commands/run-once/pipeline-failures.test.ts \
  src/cli/commands/run-once/pipeline.test.ts
```

Expected: PASS; retry requires explicit `agent-ready`, clean committed work resumes unchanged, ignored content refuses, and same-body blocker comments deduplicate.

- [ ] **Step 9: Commit explicit retry integration**

```sh
git add src/cli/commands/run-once/pipeline-selection.ts \
  src/cli/commands/run-once/pipeline-selection.test.ts \
  src/cli/commands/run-once/pipeline-selection-scenarios.test.ts \
  src/cli/commands/run-once/pipeline.ts \
  src/cli/commands/run-once/pipeline-comments.ts \
  src/cli/commands/run-once/pipeline-failures.ts \
  src/cli/commands/run-once/pipeline-failures.test.ts \
  src/cli/commands/run-once/pipeline-workspace-scenarios.test.ts \
  src/cli/commands/run-once/pipeline.test.ts \
  test-support/run-once/pipeline-fixtures.ts
git commit -m "feat: resume acknowledged blocked issue runs"
```

---

### Task 6: Safe Reset Orchestration and Immediate Run Attempt

**Files:**
- Create: `src/cli/commands/run/reset/reset.ts`
- Create: `src/cli/commands/run/reset/reset.test.ts`
- Modify: `src/cli/commands/run-once/pipeline.ts` (borrowed lease/reset context only)
- Modify: `src/cli/commands/run-once/pipeline-selection.ts` (reset-aware eligibility helper)
- Modify: `src/cli/commands/run-once/pipeline-selection.test.ts` (saved-status label matrices)
- Modify: `src/cli/commands/run-once/run-state.ts` (call exact reset replacement from claim)
- Modify: `src/cli/commands/run-once/types.ts` (reset result type only)
- Modify: `test-support/run-once/pipeline-fixtures.ts` (reset orchestration fixture)

**Interfaces:**
- Consumes: explicit `AgentIssueConfig` with `issueNumber`, `RunOnceHostProvider`, `validateResetIssueEligibility()`, `runArtifactSourceStage()`, snapshot/lease/recovery/archive/mutation modules, and `runOneIssue()`.
- Test helper: `resetFixture({status, labels})` creates issue `45`, writes safe zero-commit Run recovery state for the requested status, records ordered host/filesystem/Git/pipeline events, and returns `{runner, config, options, pipelineCalls, events}`.
- Produces:

```ts
export type ResetIssueRunResult =
  | {
      status: "nothing-to-reset";
      issueNumber: number;
      guidance: string;
    }
  | {
      status: "reset-started";
      issueNumber: number;
      archivePath: string;
      recoveryAction: "archive-reset-and-start";
      quarantinePaths: string[];
      pipelineResult: AgentIssuePipelineResult;
    };

export async function resetIssueRun(
  runner: CommandRunner,
  config: AgentIssueConfig & { issueNumber: number },
  options?: RunOneIssueOptions,
): Promise<ResetIssueRunResult>;

export function validateResetIssueEligibility(input: {
  issue: IssueSummary;
  state?: AgentIssueRunState;
  config: AgentIssueConfig;
}): void;
```

- [ ] **Step 1: Write failing reset status and ordering tests**

Use a table over every persisted status:

```ts
for (const [status, labels] of [
  ["claimed", ["in-progress"]],
  ["planning", ["in-progress"]],
  ["implementing", ["in-progress"]],
  ["blocked", ["agent-ready", "needs-info"]],
  ["finished", ["agent-ready"]],
  ["finished", ["in-progress"]],
] as const) {
  test(`reset safely replaces ${status} ${labels.join("+")} state and starts immediately`, async () => {
    const fixture = await resetFixture({ status, labels });
    const result = await resetIssueRun(fixture.runner, fixture.config, fixture.options);

    assert.equal(result.status, "reset-started");
    assert.equal(fixture.pipelineCalls.length, 1);
    assert.equal(fixture.pipelineCalls[0]?.config.issueNumber, 45);
    assert.equal(fixture.pipelineCalls[0]?.options.reset?.archivePath, result.archivePath);
  });
}
```

Add refusal cases for active state without `in-progress`, blocked state without `agent-ready`, and `finished` with only `needs-info`. Prove that `[in-progress]` remains an idempotent claim and that `[agent-ready, needs-info]` becomes exactly `[in-progress]` only when pipeline claim begins.

The fixture must record host reads/mutations, state reads/writes, archive finalization, Git quarantine/ref updates, and pipeline entry in one ordered event list. Assert the sequence:

```text
view issue -> read eligibility snapshot -> reset eligibility -> repair-lock check -> acquire guarded lease -> view issue -> read exact state -> reset eligibility -> assess ordinary/ignored status and OIDs -> archive finalized -> exact-state/OID reassessment -> move checkout to quarantine -> detach quarantine -> delete branch by expected OID -> pipeline claim
```

- [ ] **Step 2: Write failing safety, preservation, and crash-window tests**

Add reset tests proving:

- closed/not-actionable issues and absent required approvals stop before lease/archive/Git/label mutation;
- a live or remote lease owner and an active repair lock return active-run refusal;
- active legacy `claimed`, `planning`, or `implementing` state refuses without an exact migration fence;
- a matching exact-state migration fence permits preflight, while a changed state hash refuses;
- dirty status, ignored files/directories, actual unique commits, missing-branch saved commits, and unverifiable identity stop before archive or cleanup;
- archive failure leaves active state and workspace untouched;
- quarantine-move failure leaves active state and workspace untouched, retains the completed archive, and never enters the pipeline;
- detach or expected-OID branch-delete failure reports the preserved quarantine, retains active state/archive, and never enters the pipeline;
- ignored content injected immediately before movement survives in quarantine and prevents unsafe continuation;
- a concurrent branch update makes expected-OID deletion fail without deleting the new ref;
- old active state remains readable during archive and each mutation command;
- a byte change to active state after archive stops cleanup and retains both active state and archive;
- issue labels do not change before normal pipeline claim;
- exact archived bytes contain every original field;
- the fresh claim keeps only validated spec/plan references plus the issue-scoped start-comment receipt;
- old `failureCommentKeys` and `blockerCommentKeys` do not survive, so a new same-stage effect can post;
- invalid workspace-only artifact references are cleared, while a matching validated published artifact reference survives;
- ordinary checkpoints, blocker data, implementation/PR/merge/cost/review/visual data, and old active timestamps do not survive;
- the normal pipeline starts in the same command and receives the borrowed lease;
- a pipeline failure result is returned through normal Run attempt handling while stderr/progress diagnostics retain archive and quarantine paths;
- absent state returns `patchmill run-once --issue 45` guidance and performs no archive, cleanup, label, comment, or pipeline mutation.

- [ ] **Step 3: Run the reset test and confirm it fails**

Run:

```sh
node --test src/cli/commands/run/reset/reset.test.ts
```

Expected: FAIL because reset orchestration does not exist.

- [ ] **Step 4: Implement read-only eligibility preflight before the lease**

Create the existing run-once host provider. Load the exact issue and a read-only state snapshot. Call `validateResetIssueEligibility({issue, state: snapshot?.state, config})`. The helper reuses open-issue, triage, and approval checks, then applies the saved-status label matrix. If no snapshot exists, run only the common issue/approval checks and defer `nothing-to-reset` until after lease acquisition. Convert eligibility errors to refusal without local or host mutation.

Do not return `nothing-to-reset` before the lease; another Run attempt can still create or replace state between preflight and acquisition.

- [ ] **Step 5: Acquire the lease, re-read, and reapply all preflight rules**

Wrap the remaining operation in `withIssueRunLease()`. Inside, re-read the exact issue and snapshot, then re-run `validateResetIssueEligibility()` with authoritative saved state. If no snapshot exists under the lease, return `nothing-to-reset` with:

```text
No saved Run recovery state exists for issue #45. Run: patchmill run-once --issue 45
```

Otherwise hydrate/validate authoritative published artifact sources through the read-only artifact source stage, compute expected workspace identity, read any legacy migration fence, and call `planRunRecovery({intent:"reset", leaseOwnerToken: lease.record.ownerToken, snapshotRaw: snapshot.raw, legacyMigrationFence, ...})`.

If state disappears, eligibility changes, or the decision refuses, stop before archive or cleanup. Lease conflict guidance must identify `locks/issue-45.lock` and the known owner without claiming a remote owner is dead.

- [ ] **Step 6: Archive, clean, and enter the pipeline in order**

Call `archiveRunRecovery()` and wait for its finalized path. Then call `executeRunRecoveryMutation()` with a reassessment callback that re-reads the current snapshot, repair-lock/lease evidence, migration fence, ordinary/ignored status, and pinned OIDs. The callback must require `currentSnapshot.raw === archivedSnapshot.raw` and the same cleanup plan. The mutation module moves the checkout to quarantine before it detaches `HEAD` or deletes the branch. It uses expected-OID updates and never removes the quarantine. If state or OID evidence changes, stop the next action and retain active state, archive, quarantine, and staging paths. Only after successful cleanup call:

```ts
const pipelineResult = await runOneIssue(runner, config, {
  ...options,
  lease,
  reset: {
    lease,
    archivePath: archive.path,
    quarantinePaths: mutation.quarantinePaths,
    seed: decision.seed,
  },
});
```

Do not delete or rewrite active state in reset orchestration.

- [ ] **Step 7: Make the normal claim exactly replace reset state**

When `RunOneIssueOptions.reset` is present, pipeline recovery assessment must ignore old attempt progress but retain the supplied seed for artifact resolution and the issue-scoped start-comment receipt. The claim label helper removes `agent-ready` and `needs-info`, then adds `in-progress` exactly once; an existing `in-progress` label remains valid. At the claim checkpoint call `replaceRunStateAfterReset()` instead of merge-writing old state. The fresh state sets `leaseProtocolVersion = 1` and contains no old failure or blocker receipt keys.

Keep the borrowed lease through the complete pipeline result; reset orchestration releases it after `runOneIssue()` returns or throws. Include reset archive and quarantine paths in progress/error context without changing the redirected run-once result JSON schema.

- [ ] **Step 8: Run reset, retry, and persistence tests**

Run:

```sh
node --test \
  src/cli/commands/run/reset/reset.test.ts \
  src/cli/commands/run-once/run-state.test.ts \
  src/cli/commands/run-once/pipeline-workspace-scenarios.test.ts \
  src/cli/commands/run-once/pipeline-selection-scenarios.test.ts
```

Expected: PASS for every saved-status label matrix, ordered archive/quarantine/pipeline entry, and every refusal or preservation case.

- [ ] **Step 9: Commit reset orchestration**

```sh
git add src/cli/commands/run/reset/reset.ts \
  src/cli/commands/run/reset/reset.test.ts \
  src/cli/commands/run-once/pipeline.ts \
  src/cli/commands/run-once/pipeline-selection.ts \
  src/cli/commands/run-once/pipeline-selection.test.ts \
  src/cli/commands/run-once/run-state.ts \
  src/cli/commands/run-once/types.ts \
  test-support/run-once/pipeline-fixtures.ts
git commit -m "feat: safely reset saved issue runs"
```

---

### Task 7: `patchmill run reset` CLI and Result Contract

**Files:**
- Create: `src/cli/commands/run/main.ts`
- Create: `src/cli/commands/run/main.test.ts`
- Create: `src/cli/commands/run/config.ts`
- Create: `src/cli/commands/run/config.test.ts`
- Create: `src/cli/commands/run/lease/main.ts`
- Create: `src/cli/commands/run/lease/main.test.ts`
- Create: `src/cli/commands/run/lease/repair.ts`
- Create: `src/cli/commands/run/lease/repair.test.ts`
- Create: `src/cli/commands/run/reset/main.ts`
- Create: `src/cli/commands/run/reset/main.test.ts`
- Modify: `src/cli/main.ts:1-117`
- Modify: `src/cli/main.test.ts:1-318`

**Interfaces:**
- Consumes: exported `loadCliConfig()`, `resetIssueRun()`, `summarizeResult()`, `summarizeErrorResult()`, `writeRunOnceResult()`, and `exitCodeForRunOnceResult()`.
- Produces:

```ts
export type ResetCommandDependencies = {
  loadConfig: typeof loadCliConfig;
  executeReset: typeof resetIssueRun;
  runner: CommandRunner;
  stdout: RunOnceResultStream;
  stderr: Pick<NodeJS.WriteStream, "write">;
  env: Record<string, string | undefined>;
  now: () => Date;
};

export async function runResetCommand(
  args: string[],
  dependencies?: Partial<ResetCommandDependencies>,
): Promise<number>;

export type RunCommandHandler = (
  args: string[],
) => number | Promise<number>;

export async function runRunCommand(
  args: string[],
  commands?: ReadonlyMap<string, RunCommandHandler>,
): Promise<number>;

export async function runLeaseCommand(
  args: string[],
  commands?: ReadonlyMap<string, RunCommandHandler>,
): Promise<number>;

export type RunStateCommandConfig = {
  repoRoot: string;
  runStateDir: string;
};

export async function loadRunStateCommandConfig(
  args: string[],
): Promise<RunStateCommandConfig>;

export type LeaseRepairCommandDependencies = {
  loadConfig: typeof loadRunStateCommandConfig;
  inspect: typeof inspectIssueRunLeaseRepair;
  repair: typeof repairIssueRunLease;
  stdout: Pick<NodeJS.WriteStream, "write">;
  stderr: Pick<NodeJS.WriteStream, "write">;
};

export async function runLeaseRepairCommand(
  args: string[],
  dependencies?: Partial<LeaseRepairCommandDependencies>,
): Promise<number>;
```

- [ ] **Step 1: Write failing nested dispatch and reset argument tests**

Define `dependencies` with a temp config whose issue number is `45`, a recording `executeReset`, the existing mock `CommandRunner`, array-backed stdout/stderr streams, an empty environment, and a fixed clock. Add behavior tests:

```ts
test("run command dispatches reset with remaining arguments", async () => {
  const calls: string[][] = [];
  const exitCode = await runRunCommand(
    ["reset", "--issue", "45", "--plan-only"],
    new Map([["reset", async (args) => { calls.push(args); return 0; }]]),
  );

  assert.equal(exitCode, 0);
  assert.deepEqual(calls, [["--issue", "45", "--plan-only"]]);
});

test("reset requires an issue number", async () => {
  await assert.rejects(
    runResetCommand([], dependencies),
    /patchmill run reset requires --issue <number>/,
  );
});
```

Also test `--issue 0`, negative, fractional, and non-numeric values through the existing positive-integer parser; unknown `--force`; applicable `--plan-only`, `--quiet`, `--verbose-pi-output`, and host-login forwarding; unknown nested commands; top-level forwarding of `run reset --issue 45` and `run lease repair --issue 45`; and help without config/provider/Git access.

Treat `--dry-run` as not applicable to the immediate mutating Run attempt. Reject it before `resetIssueRun()`, provider access, lease acquisition, or state/workspace mutation with a direct message that no reset preview contract exists.

For lease repair, test inspection without confirmation, remote repair requiring exact `--expect-lease-sha256` plus `--confirm-owner-stopped`, abandoned-guard repair requiring exact `--expect-guard-sha256` plus `--confirm-all-runners-stopped`, and legacy repair requiring exact `--expect-state-sha256` plus `--confirm-all-runners-stopped`. Reject mixed fingerprints, a confirmation without its matching fingerprint, and all pipeline options. Assert that inspection prints the exact follow-up command and the correct stop-process warning.

Add a real `loadRunStateCommandConfig()` test with a temporary `patchmill.config.json`. Remove Git from `PATH`, configure an invalid provider command, and prove that `patchmill run lease repair --issue 45` reaches filesystem inspection without Git base detection, provider construction, or a `CommandRunner`.

- [ ] **Step 2: Write failing output-contract tests**

For a successful reset, inject `stdout.isTTY = false` and assert stdout contains exactly one compact existing run-once summary JSON line, while stderr contains archive path, quarantine paths, and `archive-reset-and-start`. Assert exit code comes from the nested pipeline result.

For `nothing-to-reset`, assert non-zero exit, no pipeline-shaped stdout, and stderr contains:

```text
No saved Run recovery state exists for issue #45.
Run: patchmill run-once --issue 45
```

For a pre-execution error, assert the normal error summary path. Do not add tests that only compare help text.

- [ ] **Step 3: Run CLI tests and confirm failure**

Run:

```sh
node --test \
  src/cli/commands/run/main.test.ts \
  src/cli/commands/run/config.test.ts \
  src/cli/commands/run/lease/main.test.ts \
  src/cli/commands/run/lease/repair.test.ts \
  src/cli/commands/run/reset/main.test.ts \
  src/cli/main.test.ts
```

Expected: FAIL because the command family, reset entry point, and lease-repair entry points do not exist.

- [ ] **Step 4: Implement the nested run family**

`run/main.ts` recognizes help plus the `reset` and `lease` subcommands, forwards remaining arguments unchanged, and returns `1` with command-family help for an unknown subcommand. `run/lease/main.ts` does the same for `repair`. Neither dispatcher implements continuous coordinator behavior.

Add `run` to the top-level `COMMANDS` map and describe it as recovery commands in top-level help. Preserve `run-once` unchanged.

- [ ] **Step 5: Implement reset parsing and output**

Call `loadCliConfig(args)` so positive issue parsing and applicable pipeline options stay identical to run-once. Require `config.issueNumber`, reject `config.dryRun`, and call `resetIssueRun()`.

After reset starts, write archive/action progress to stderr and pass `pipelineResult` through existing `summarizeResult()`, `writeRunOnceResult()`, and `exitCodeForRunOnceResult()`. Do not wrap successful redirected stdout in a reset-specific envelope. Before execution starts, format absent-state and refusal guidance directly and return `1`.

Implement `loadRunStateCommandConfig()` as a focused reader of repo-root discovery plus `patchmill.config.json` run-state path resolution. It must not resolve a Git base, construct a provider, or create a `CommandRunner`.

Implement lease-repair inspection with that loader, `inspectIssueRunLeaseRepair()`, and the exact fingerprinted follow-up command. Confirmed modes call `repairIssueRunLease()` only after argument pairing succeeds. Print the lease/guard archive or migration-fence path on success. Do not load a host provider or create a `CommandRunner` because repair touches only run-state files.

- [ ] **Step 6: Run CLI and direct help verification**

Run:

```sh
node --test \
  src/cli/commands/run/main.test.ts \
  src/cli/commands/run/config.test.ts \
  src/cli/commands/run/lease/main.test.ts \
  src/cli/commands/run/lease/repair.test.ts \
  src/cli/commands/run/reset/main.test.ts \
  src/cli/main.test.ts
node bin/patchmill.ts run --help
node bin/patchmill.ts run reset --help
node bin/patchmill.ts run lease repair --help
```

Expected: tests PASS; help shows reset and lease repair commands, no reset force option, and the three fingerprinted repair modes. The real config test proves lease repair needs no Git/provider access. Direct help replaces a new automated test for static help copy.

- [ ] **Step 7: Commit the CLI**

```sh
git add src/cli/main.ts src/cli/main.test.ts \
  src/cli/commands/run/main.ts \
  src/cli/commands/run/main.test.ts \
  src/cli/commands/run/config.ts \
  src/cli/commands/run/config.test.ts \
  src/cli/commands/run/lease/main.ts \
  src/cli/commands/run/lease/main.test.ts \
  src/cli/commands/run/lease/repair.ts \
  src/cli/commands/run/lease/repair.test.ts \
  src/cli/commands/run/reset/main.ts \
  src/cli/commands/run/reset/main.test.ts
git commit -m "feat: add run reset command"
```

---

### Task 8: Operator Documentation and Full Verification

**Files:**
- Modify: `README.md:58-72`
- Modify: `site/src/content/docs/using-patchmill/run-once.md:16-140`
- Verify only: `package.json`, dependency files, and generated output remain unchanged

**Interfaces:**
- Consumes: final CLI behavior and archive/repair messages.
- Produces: operator guidance that uses the approved domain terms and commands exactly.

- [ ] **Step 1: Update concise README command guidance**

Add one main-command bullet stating:

```md
- `patchmill run reset --issue N` safely archives and resets saved Run recovery
  state before an immediate issue-specific Run attempt.
```

Do not describe force cleanup or comment-driven control.

- [ ] **Step 2: Expand the run-once retry section**

In `site/src/content/docs/using-patchmill/run-once.md`, document:

- a blocked Issue run retains Run recovery state;
- the human answers outside Patchmill, restores `agent-ready`, and explicitly runs `patchmill run-once --issue N`;
- comments are context, not control signals;
- clean current, stale-base, commit-bearing, and safely recreatable workspaces can resume;
- retry preserves unique commits and their existing base without merge or rewrite, while reset refuses to delete them;
- only a zero-ahead stale branch refreshes to pinned current-base content;
- ordinary dirty status, ignored files/directories, live leases, unfenced legacy-active state, saved commit loss, and unverifiable paths refuse with repair guidance;
- blocker-comment bodies are effect evidence only; exact legacy matches bootstrap same-Issue-run receipts;
- refresh and reset move the full checkout before ref changes, so late ignored content remains in quarantine instead of being overwritten or deleted;
- `patchmill run reset --issue N` archives exact diagnostics, evacuates the expected checkout into a retained quarantine, deletes only a zero-unique-commit branch by expected OID, and immediately starts the normal pipeline;
- reset eligibility accepts active `in-progress`, blocked `agent-ready` plus optional `needs-info`, and finished `agent-ready` or `in-progress` state;
- reset preserves only the issue-scoped start-comment receipt, so new failure and blocker comments are not suppressed;
- reset rejects `--dry-run`, has no force option, and does not change labels before normal claim;
- `patchmill run lease repair --issue N` inspects abandoned remote leases, transaction guards, or active legacy state and prints a fingerprinted, operator-confirmed repair command;
- the old statement about `patchmill run` being a continuous factory loop is no longer correct now that `run` is a command family, so replace it with explicit run-once, reset, and lease-repair guidance.

Use this command block exactly:

```sh
patchmill run-once --issue 123
patchmill run reset --issue 123
patchmill run lease repair --issue 123
```

- [ ] **Step 3: Run focused recovery and CLI suites**

Run:

```sh
node --test \
  src/cli/commands/run-once/recovery.test.ts \
  src/cli/commands/run-once/recovery-lease.test.ts \
  src/cli/commands/run-once/recovery-lease-repair.test.ts \
  src/cli/commands/run-once/recovery-archive.test.ts \
  src/cli/commands/run-once/recovery-mutation.test.ts \
  src/cli/commands/run/config.test.ts \
  src/cli/commands/run/lease/*.test.ts \
  src/cli/commands/run/reset/*.test.ts \
  src/cli/main.test.ts
```

Expected: PASS.

- [ ] **Step 4: Run the complete run-once regression suite**

Run:

```sh
npm run test:run-once
```

Expected: PASS, including planning, implementation, failure, finish, landing, progress, cost, artifact, and workspace scenarios affected by lease/state changes.

- [ ] **Step 5: Run project verification**

Run:

```sh
npm test
npm run lint
npm run check:architecture
npm run build
```

Expected: all commands PASS. `npm run lint` directly verifies README/site Markdown and help-adjacent source formatting; no new docs-text test is needed.

No dependency change is planned, so the Patchmill Nix dependency-build rule is not triggered. If `package.json`, `package-lock.json`, or `npm-shrinkwrap.json` changes unexpectedly, stop, explain why, and run the required Nix build before continuing.

- [ ] **Step 6: Verify safety properties in the final diff**

Run:

```sh
rg -n --glob '*.ts' --glob '!*.test.ts' 'worktree remove|branch.*-D|--force|rmSync|fs\.rm' src/cli/commands/run-once/recovery-* src/cli/commands/run/reset src/cli/commands/run/lease
git diff --check
git status --short
```

Expected: the recovery/reset search finds no force cleanup command or option; `git diff --check` is silent; status contains only intended source, test, and documentation changes.

- [ ] **Step 7: Commit documentation after all checks pass**

```sh
git add README.md site/src/content/docs/using-patchmill/run-once.md
git commit -m "docs: explain issue run recovery and reset"
```

---

## Acceptance and Test Mapping

| Requirement | Primary task and proof |
| --- | --- |
| `agent-ready` plus explicit issue command acknowledges blocked recovery | Task 5 selection and comment-non-control tests |
| Bare run-once does not recover blocked state | Task 5 automatic-selection scenario |
| Current clean empty branch resumes | Tasks 1 and 5 decision/pipeline tests |
| Clean unique-commit branch resumes without rewrite | Tasks 1, 3, and 5 decision/head-preservation tests |
| Reset refuses unique commits | Tasks 1 and 6 reset no-mutation tests |
| Trailing zero-commit branch refreshes to one pinned base OID | Task 3 real-Git/OID tests; Task 5 call-order test |
| Commit-bearing retry keeps its existing base and head | Tasks 1, 3, and 5 OID-preservation tests |
| Ignored content blocks or survives every recovery race | Tasks 1, 3, 5, and 6 adversarial file-injection tests |
| Missing safe workspace is recreated from an explicit typed plan | Tasks 1, 3, and 5 recreation mode/OID/head tests |
| Retry clears blocker reason/questions and retains diagnostics/checkpoints | Tasks 4 and 5 Run recovery state assertions |
| Legacy blocker comments bootstrap exact-body receipts | Task 5 existing-comment and state tests |
| Same-body blocker comments deduplicate and changed bodies post | Task 5 failure/comment receipt tests |
| Reset clears Issue-run-scoped failure/blocker receipts | Tasks 1, 4, and 6 exact state-shape tests |
| Dirty, saved-loss, and unverifiable state refuses without mutation | Tasks 1, 3, 5, and 6 no-mutation assertions |
| Transaction guard serializes lease observation, takeover, creation, and release | Task 2 three-party interleaving tests |
| Lease blocks live/remote owner and guarded takeover replaces dead same-host owner | Task 2 lease tests; Task 6 orchestration test |
| Abandoned transaction guard requires fingerprinted repair | Tasks 2 and 7 guard-repair tests |
| Active pre-lease state requires an exact migration fence | Tasks 1, 2, 5, and 6 legacy-state tests |
| Abandoned remote lease has fingerprinted operator repair | Tasks 2 and 7 inspection/CAS/quarantine tests |
| Repair lock fences ordinary lease acquisition | Task 2 repair/lease race tests |
| Lease remains held through complete Run attempt | Tasks 2, 5, and 6 callback/order tests |
| Reset supports realistic saved-status label matrices after applicable fencing | Task 6 active/blocked/finished eligibility tables |
| Reset rejects `--dry-run` before mutation | Task 7 parser/delegation no-call tests |
| Eligibility and approval precede mutation | Task 6 ordered event/no-mutation tests |
| Archive finalizes before quarantine and preserves exact bytes | Tasks 4 and 6 exact-byte/order tests |
| Reset preserves the checkout in quarantine and deletes only the expected branch OID | Tasks 3 and 6 quarantine/CAS tests |
| Active state remains until normal fresh claim | Task 6 crash-window/order test |
| Reset preserves only validated artifact refs and start-comment receipt | Tasks 1, 4, and 6 exact state-shape tests |
| Reset immediately starts normal run-once pipeline | Task 6 delegation and label-transition tests |
| No reset persisted status or dependency is added | Tasks 1 and 8 type/diff verification |
| CLI parsing, nested dispatch, exit code, and redirected result stay stable | Task 7 CLI tests |
| Lease repair loads run-state configuration without Git or provider access | Task 7 real-command config test |
| Operators get accurate recovery, reset, and lease-repair guidance | Task 8 Markdown lint/direct CLI verification |
