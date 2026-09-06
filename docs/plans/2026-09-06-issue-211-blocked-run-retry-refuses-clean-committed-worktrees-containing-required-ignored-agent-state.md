# Preserve Ignored Agent State During Blocked-Run Retry Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `subagent-driven-development`
> (recommended) or `executing-plans` to implement this plan task by task. Track
> every checkbox (`- [ ]`) as it is completed.

**Goal:** Let an explicit retry resume a verified clean Issue run worktree in
place while preserving all ignored content, without weakening safeguards for
recovery actions that mutate workspace state.

**Architecture:** Keep recovery assessment read-only and represent ordinary Git
cleanliness, ignored inventory, and intrinsic branch/worktree shape as separate
facts. Derive the candidate recovery action from non-ignored facts, then allow
ignored content only for a verified `resume`; refuse every mutating candidate
with a typed blocked action. Return the applied blocked-recovery outcome to the
pipeline so it can report preservation before invoking Pi, while existing
refresh/reset late-content guards remain unchanged.

**Tech Stack:** TypeScript 6, Node.js 22 filesystem/process APIs, `node:test`,
real-Git integration fixtures, the existing run-once progress pipeline, and
Astro documentation; no new dependency.

**Spec:**
`docs/specs/2026-09-06-issue-211-blocked-run-retry-refuses-clean-committed-worktrees-containing-required-ignored-agent-state-design.md`

## Global Constraints

- Use the domain terms **Issue run**, **Run attempt**, and **Run recovery
  state** from `CONTEXT.md`.
- Only an explicit, acknowledged blocked retry may use this exception; do not
  change issue selection, labels, leases, checkpoints, artifacts, or reset seed
  semantics.
- Ordinary tracked or untracked dirty status remains a refusal even when ignored
  entries are also present.
- A verified current worktree and a verified commit-bearing worktree, including
  one that is behind the base, resume in place without a worktree or ref
  mutation.
- A zero-ahead branch with `behind > 0` remains stale and must not resume stale
  content merely to avoid the ignored-content guard.
- Apply the same preservation policy to every ignored path. Do not add a
  workflow-path allowlist, backup, hash, copy, stash, clean, or force option.
- Ignored content must refuse `refresh-and-resume`, `recreate-and-resume`, and
  `archive-reset-and-start`, including any future action routed through the
  recovery mutation layer.
- Reset of a branch with actual unique commits retains the stronger
  `unmerged-commits` refusal even when ignored entries also exist.
- Do not weaken or filter `assertRecoveryWorkspaceUnchanged()`; late ordinary or
  ignored content during refresh/reset must continue to stop ref update,
  deletion, or publication.
- Preservation means Patchmill performs no mutation of the existing issue
  worktree before Pi starts. It does not promise isolation from unrelated
  processes.
- Keep `pipeline.ts` (currently about 936 lines) as narrow orchestration only.
  Put focused ignored-content tests in new files rather than expanding
  `recovery.test.ts` (currently about 771 lines) or `recovery-mutation.test.ts`
  (currently about 707 lines).
- `recovery-archive.ts` continues to serialize assessment evidence; no persisted
  Run recovery state schema field is added.
- Do not change `package.json`, `package-lock.json`, or `npm-shrinkwrap.json`.
  If a dependency file changes unexpectedly, run the Nix build required by
  `AGENTS.md`.
- The Testing Value Gate approves the planned automated tests: they exercise a
  data-loss boundary, the blocked-retry regression, typed error behavior, and
  late-content races. Do not add a test that only asserts documentation text;
  validate documentation with lint and the site build.

---

## File and Module Map

### Recovery assessment and policy

- `src/cli/commands/run-once/types.ts` — separate intrinsic recovery
  classification from policy refusal reasons, name ordinary cleanliness
  unambiguously, and carry the blocked mutating action on ignored-content
  refusals.
- `src/cli/commands/run-once/recovery-assessment.ts` — inventory ignored entries
  independently, classify branch/worktree shape without ignored precedence, and
  prove whether the expected registered checkout exists.
- `src/cli/commands/run-once/recovery-policy.ts` — derive the candidate action
  first, defensively verify in-place resume facts, and gate ignored content by
  whether the action mutates workspace state.
- `src/cli/commands/run-once/recovery.ts` — format distinct in-place
  preservation and destructive-action refusal diagnostics.
- `src/cli/commands/run-once/recovery-ignored-content.test.ts` — focused
  assessment, policy, path-agnostic behavior, precedence, and diagnostic tests.
- `src/cli/commands/run-once/recovery.test.ts` — update existing typed fixtures
  for the clarified assessment shape without adding the new matrix here.
- `src/cli/commands/run-once/recovery-archive.test.ts` — prove archived
  assessment evidence keeps ordinary cleanliness and ignored inventory
  independently visible.

### Pipeline preservation boundary

- `src/cli/commands/run-once/pipeline-recovery.ts` — return the applied decision
  and optional mutation result instead of discarding recovery outcome details.
- `src/cli/commands/run-once/pipeline.ts` — emit one preservation progress event
  for an ignored-content in-place resume before normal workspace/Pi stages.
- `test-support/run-once/pipeline-fixtures.ts` — let blocked-retry fixtures
  return distinct ordinary and ignored porcelain output and inspect the Pi call
  working directory.
- `src/cli/commands/run-once/pipeline-recovery-ignored-content.test.ts` — verify
  current and commit-bearing retries preserve representative ignored file bytes,
  reuse the exact checkout, perform no recovery mutation, and emit the success
  diagnostic before Pi.

### Destructive recovery safety

- `src/cli/commands/run-once/recovery-mutation-ignored-content.test.ts` — add
  the missing real-Git refresh race where ignored content appears after
  assessment and stops detach, ref update, and publication.
- `src/cli/commands/run/reset/reset.test.ts` — prove pre-existing ignored
  content refuses reset before archive or mutation and reports the blocked reset
  action.
- `src/cli/commands/run-once/recovery-mutation-helpers.ts` — intentionally
  unchanged; its complete ordinary-plus-ignored late check remains
  authoritative.
- `src/cli/commands/run-once/recovery-mutation-refresh.ts` and
  `src/cli/commands/run-once/recovery-mutation-reset.ts` — intentionally
  unchanged unless a new regression test exposes a real safety gap.

### Operator documentation

- `site/src/content/docs/using-patchmill/run-once.md` — distinguish ignored
  content preserved by in-place retry from ignored content that blocks refresh,
  recreation, or reset.

---

### Task 1: Separate recovery facts and make ignored-content policy action-aware

**Files:**

- Modify: `src/cli/commands/run-once/types.ts:334-487`
- Modify: `src/cli/commands/run-once/recovery-assessment.ts:70-340`
- Modify: `src/cli/commands/run-once/recovery-policy.ts:1-176`
- Modify: `src/cli/commands/run-once/recovery.ts:18-53`
- Create: `src/cli/commands/run-once/recovery-ignored-content.test.ts`
- Modify: `src/cli/commands/run-once/recovery.test.ts:394-452`
- Modify: `src/cli/commands/run-once/recovery-archive.test.ts:1-95`

**Interfaces:**

- Consumes: `PlanRunRecoveryInput`, normalized `git status --porcelain=v1`
  output, exact worktree registration evidence, divergence, unique commits, and
  paths allocated by `createRunRecoveryPaths()`.
- Produces:

```ts
export type RunRecoveryClassification =
  | "resumable-current"
  | "resumable-stale-base"
  | "resumable-with-commits"
  | "recreatable-clean"
  | "dirty-worktree"
  | "unmerged-commits"
  | "workspace-unverifiable"
  | "legacy-active-unfenced";

export type RunRecoveryAction =
  | "resume"
  | "refresh-and-resume"
  | "recreate-and-resume"
  | "archive-reset-and-start";

export type RunRecoveryMutatingAction = Exclude<RunRecoveryAction, "resume">;

export type RunRecoveryRefusalReason =
  | RunRecoveryClassification
  | "ignored-worktree-content"
  | "not-blocked";
```

- Replace ambiguous `worktree.clean?: boolean` with
  `worktree.ordinaryClean?: boolean`. `ordinaryClean` is true exactly when the
  configured ordinary-status exclusions leave no blocking line; it remains true
  when `ignoredEntries` is non-empty.
- The assessment refusal variant for `reason: "ignored-worktree-content"`
  carries `blockedAction: RunRecoveryMutatingAction`. Other assessed refusals do
  not claim a blocked action. The existing `active-run` refusal remains
  separate.
- `decideRunRecovery()` remains pure and preserves its current public signature.
  Its internal candidate is a non-refusal `RunRecoveryDecision`; the ignored
  gate either returns that candidate or a typed refusal.

- [ ] **Step 1: Add focused failing assessment and policy tests**

Create `recovery-ignored-content.test.ts` with a local `planRecovery()` helper.
The command runner must return separate status streams so ordinary status is not
confused with ignored inventory:

```ts
if (call.args[0] === "-C" && call.args[2] === "status") {
  return {
    code: 0,
    stdout: call.args.includes("--ignored=matching")
      ? (overrides.ignoredStatus ?? "")
      : (overrides.ordinaryStatus ?? ""),
    stderr: "",
  };
}
```

Use a physically present worktree registered on the expected branch as the safe
default. Add these named cases and exact decision assertions:

```ts
test("current blocked retry preserves ignored workflow state in place", async () => {
  const decision = await planRecovery({
    revList: "0\t0\n",
    log: "",
    ignoredStatus:
      "!! .pi/todos/issue-211-task.md\n" +
      "!! .superpowers/single-writer/progress.md\n",
  });

  assert.equal(decision.action, "resume");
  assert.equal(decision.assessment.classification, "resumable-current");
  assert.equal(decision.assessment.worktree.ordinaryClean, true);
  assert.deepEqual(decision.assessment.worktree.ignoredEntries, [
    ".pi/todos/issue-211-task.md",
    ".superpowers/single-writer/progress.md",
  ]);
});

test("commit-bearing blocked retry preserves unknown ignored content in place", async () => {
  const decision = await planRecovery({
    revList: "3\t2\n",
    log: "def456 verify recovery\nabc123 implement recovery\n",
    ignoredStatus: "!! .cache/generated.bin\n",
  });

  assert.equal(decision.action, "resume");
  assert.equal(decision.assessment.classification, "resumable-with-commits");
  assert.deepEqual(decision.assessment.divergence, {
    behind: 3,
    ahead: 2,
  });
});
```

Add six more cases with these outcomes:

1. Ordinary `" M src/index.ts\n"` plus ignored entries returns a
   `dirty-worktree` refusal.
2. `behind: 3, ahead: 0` plus ignored entries returns
   `reason: "ignored-worktree-content"` and
   `blockedAction: "refresh-and-resume"`.
3. Current reset plus ignored entries returns the same reason with
   `blockedAction: "archive-reset-and-start"`.
4. Reset with actual unique commits plus ignored entries keeps
   `reason: "unmerged-commits"`.
5. A synthetic `recreatable-clean` assessment with ignored entries blocks
   `"recreate-and-resume"`, proving future mutation actions use the same gate.
6. Workflow paths and `.cache/generated.bin` produce the same candidate action
   and refusal rules.

Assert `formatRunRecoveryDecision()` says the destructive action cannot prove
ignored content will survive, lists normalized entries, and does not contain
`resuming in place`. Assert formatting an allowed ignored `resume` says
`resuming in place without workspace mutation` and `preserving ignored entries`.

- [ ] **Step 2: Run the focused test and verify the regression**

Run:

```sh
node --test \
  src/cli/commands/run-once/recovery-ignored-content.test.ts
```

Expected: FAIL because ignored entries currently become the intrinsic
`ignored-worktree-content` classification, current/commit-bearing retries
refuse, `ordinaryClean` and `blockedAction` do not exist, and preservation
formatting is absent.

- [ ] **Step 3: Clarify the recovery types**

In `types.ts`, add the action/refusal aliases above, remove
`"ignored-worktree-content"` from `RunRecoveryClassification`, and replace
`worktree.clean` with `worktree.ordinaryClean`. Split the assessed refusal union
so TypeScript requires a blocked action for ignored content:

```ts
| {
    action: "refuse";
    assessment: RunRecoveryAssessment;
    reason: "ignored-worktree-content";
    blockedAction: RunRecoveryMutatingAction;
    guidance: string[];
  }
| {
    action: "refuse";
    assessment: RunRecoveryAssessment;
    reason: Exclude<RunRecoveryRefusalReason, "ignored-worktree-content">;
    guidance: string[];
  }
```

Keep `ignoredStatus` and `ignoredEntries` on the assessment. Do not add either
field to persisted `AgentIssueRunState`.

- [ ] **Step 4: Make assessment classify non-ignored facts only**

In `recovery-assessment.ts`, continue issuing both status reads. Set
`ordinaryClean: !dirtyStatus` whenever the expected registered worktree can be
read, regardless of ignored entries.

Change `classify()` so its ordered decisions are:

```ts
if (workspaceIdentityIsUnsafe) return "workspace-unverifiable";
if (input.dirty) return "dirty-worktree";
if (!input.branchExists && input.savedCommits.length) return "unmerged-commits";
if (input.active && !input.fenced) return "legacy-active-unfenced";
if (!input.branchExists || !input.worktreeExists) return "recreatable-clean";
if (input.commits.length || (input.divergence?.ahead ?? 0) > 0)
  return "resumable-with-commits";
if ((input.divergence?.behind ?? 0) > 0) return "resumable-stale-base";
return "resumable-current";
```

Do not pass ignored entries into `classify()`. Continue returning their complete
inventory on `assessment.worktree`. Moving recreatable shape before unique
commits ensures a missing checkout uses `recreate-and-resume` rather than a
nominal `resume` followed by an incidental later worktree add.

- [ ] **Step 5: Derive the action before applying the ignored-content gate**

Refactor `decideRunRecovery()` into three explicit phases:

1. Refuse non-blocked retry and intrinsic unsafe classifications.
2. Preserve the reset-specific `unmerged-commits` precedence, then derive the
   existing resume/refresh/recreate/reset candidate.
3. Apply ignored-content policy to the candidate.

Use a defensive in-place predicate:

```ts
function canResumeInPlace(assessment: RunRecoveryAssessment): boolean {
  return (
    assessment.worktree.exists &&
    assessment.worktree.registered &&
    assessment.worktree.ordinaryClean === true &&
    assessment.worktree.registeredBranch ===
      assessment.expectedWorkspace.branch &&
    assessment.branch.checkedOutAt !== undefined &&
    (assessment.classification === "resumable-current" ||
      assessment.classification === "resumable-with-commits")
  );
}
```

If a candidate says `resume` without these facts, return
`workspace-unverifiable`. If ignored inventory is empty, return the candidate.
If ignored inventory is present and the candidate is a verified `resume`, return
it unchanged. Otherwise return `ignored-worktree-content` with
`blockedAction: candidate.action` and guidance naming both the action and
inventory. Keep the unique-commit reset refusal before this generic gate.

- [ ] **Step 6: Format preservation and destructive refusal distinctly**

In `recovery.ts`, format an ignored in-place resume as:

```text
Issue #45 is resuming in place without workspace mutation; preserving ignored entries: .pi/todos/issue-211-task.md, .superpowers/single-writer/progress.md.
```

Format a mutating refusal as:

```text
Issue #45 recovery refused: ignored-worktree-content.
Recovery action refresh-and-resume cannot prove ignored content will survive: .cache/generated.bin.
```

Do not use preservation wording on the refusal path. Retain existing active-run,
dirty, commit-loss, and identity diagnostics.

- [ ] **Step 7: Update existing typed fixtures and archived evidence coverage**

Update `recovery.test.ts` assessment factories and any compile-time fixtures to
use `ordinaryClean`. Preserve all legacy
`BlockedRunRecoveryReport.worktree.clean` uses because that is a separate
compatibility type.

In `recovery-archive.test.ts`, include an assessment fixture with
`ordinaryClean: true`, a non-empty `ignoredStatus`, and a non-empty
`ignoredEntries`; assert the serialized `recovery-assessment.json` retains all
three values under `worktree` while `recoveryClassification` remains intrinsic.

- [ ] **Step 8: Run focused recovery tests**

Run:

```sh
node --test \
  src/cli/commands/run-once/recovery-ignored-content.test.ts \
  src/cli/commands/run-once/recovery.test.ts \
  src/cli/commands/run-once/recovery-archive.test.ts
```

Expected: PASS. Current and commit-bearing checkouts select `resume`; stale,
recreate, and reset candidates with ignored inventory refuse with their blocked
action; ordinary dirty and unique-commit reset precedence remain unchanged.

- [ ] **Step 9: Commit the action-aware policy seam**

```sh
git add \
  src/cli/commands/run-once/types.ts \
  src/cli/commands/run-once/recovery-assessment.ts \
  src/cli/commands/run-once/recovery-policy.ts \
  src/cli/commands/run-once/recovery.ts \
  src/cli/commands/run-once/recovery-ignored-content.test.ts \
  src/cli/commands/run-once/recovery.test.ts \
  src/cli/commands/run-once/recovery-archive.test.ts
git commit -m "fix: make ignored recovery policy action-aware"
```

---

### Task 2: Preserve ignored bytes through the blocked-retry pipeline

**Files:**

- Modify: `src/cli/commands/run-once/pipeline-recovery.ts:69-144`
- Modify: `src/cli/commands/run-once/pipeline.ts:410-430`
- Modify: `test-support/run-once/pipeline-fixtures.ts:307-463`
- Create: `src/cli/commands/run-once/pipeline-recovery-ignored-content.test.ts`

**Interfaces:**

- Consumes: the non-refusal decision returned by `planRunRecovery()`, the
  optional `RunRecoveryMutationResult`, `RunOneIssueOptions.progress`, and the
  exact expected worktree path.
- Produces:

```ts
export type BlockedWorkspaceRecoveryOutcome = {
  decision: Exclude<RunRecoveryDecision, { action: "refuse" }>;
  mutation?: RunRecoveryMutationResult;
};

export async function recoverBlockedWorkspace(
  input: RecoverBlockedWorkspaceInput,
): Promise<BlockedWorkspaceRecoveryOutcome | undefined>;
```

- The function returns `undefined` only when there is no blocked state or no
  held lease. A `resume` returns its decision with no `mutation`; a refresh or
  recreation returns the decision and mutation result. Refusals continue to
  throw `AgentIssueSafetyError`.
- The pipeline emits the preservation diagnostic only when the returned action
  is `resume` and `ignoredEntries.length > 0`.

- [ ] **Step 1: Extend the blocked-retry fixture without changing old callers**

In `pipeline-fixtures.ts`, extend `blockedRecoveryRunner()` options as follows:

```ts
ordinaryStatus?: string;
ignoredStatus?: string;
onPi?: (
  prompt: string,
  call: Call,
) => CommandResult | Promise<CommandResult>;
```

Import `Call` from `mock-runner.ts`. For worktree status, use `ignoredStatus`
only when arguments contain `--ignored=matching`; otherwise use
`ordinaryStatus`. Retain `dirtyStatus` as a backwards-compatible fallback for
existing tests:

```ts
const status = call.args.includes("--ignored=matching")
  ? (options.ignoredStatus ?? options.dirtyStatus ?? "")
  : (options.ordinaryStatus ?? options.dirtyStatus ?? "");
return { code: 0, stdout: status, stderr: "" };
```

Await `options.onPi(prompt, call)` so a test can inspect files at the exact Pi
invocation boundary.

- [ ] **Step 2: Write failing pipeline preservation tests**

Create `pipeline-recovery-ignored-content.test.ts`. For each scenario below,
write these sentinel paths beneath the expected worktree before retry:

```ts
const sentinels = new Map<string, Buffer>([
  [".superpowers/single-writer/progress.md", Buffer.from("step=review\n")],
  [
    ".superpowers/single-writer/oracle-review-ledger.json",
    Buffer.from('{"finding":"F-211"}\n'),
  ],
  [".pi/todos/issue-211-task.md", Buffer.from("# task\n")],
  [".cache/generated.bin", Buffer.from([0, 1, 2, 255])],
]);
```

Run one test with `{ revList: "0\t0\n", log: "" }` and one with
`{ revList: "3\t2\n", log: "def456 verify\nabc123 implement\n" }`. In both,
return these entries from the ignored status read and an empty ordinary status.

Before the retry, record `stat()` values for the worktree and each sentinel. In
the async Pi callback:

```ts
assert.equal(call.cwd, worktreeRoot);
for (const [path, expectedBytes] of sentinels) {
  assert.deepEqual(await readFile(join(worktreeRoot, path)), expectedBytes);
  const before = stats.get(path)!;
  const after = await stat(join(worktreeRoot, path));
  assert.equal(after.dev, before.dev);
  assert.equal(after.ino, before.ino);
}
timeline.push("pi");
```

Pass a progress reporter that records a `recovery` event in the same timeline.
After `runOneIssue()`, assert:

```ts
assert.ok(
  timeline[0]?.includes(
    "resuming in place without workspace mutation; preserving ignored entries",
  ),
);
assert.equal(timeline.at(-1), "pi");
assert.deepEqual(runner.calls.filter(isRecoveryMutationCommand), []);
```

Define `isRecoveryMutationCommand()` to reject `git worktree add`,
`git worktree move`, `git update-ref`, `git reset`, and `git clean`. Also assert
the worktree root keeps the same device/inode, the result reaches `pr-created`,
and the commit-bearing-behind case does not refresh to the base.

- [ ] **Step 3: Run the pipeline test and verify the missing outcome
      diagnostic**

Run:

```sh
node --test \
  src/cli/commands/run-once/pipeline-recovery-ignored-content.test.ts
```

Expected: FAIL because `recoverBlockedWorkspace()` discards its applied decision
and the pipeline cannot emit the required preservation event before Pi.

- [ ] **Step 4: Return the applied recovery outcome**

In `pipeline-recovery.ts`, export the focused outcome type above. Store the
mutation result instead of discarding it:

```ts
const decision = await reassess();
if (decision.action === "refuse") {
  throw new AgentIssueSafetyError(formatRunRecoveryDecision(decision));
}
if (decision.action === "resume") return { decision };
const mutation = await executeRunRecoveryMutation({
  decision,
  runner: input.runner,
  repoRoot: input.config.repoRoot,
  reassess,
});
return { decision, mutation };
```

Keep all snapshot validation, lease checks, and reassessment behavior unchanged.
Do not call `executeRunRecoveryMutation()` for `resume`.

- [ ] **Step 5: Emit preservation progress before normal workspace handling**

In `pipeline.ts`, capture the recovery outcome at the existing call site. When
it is an ignored-content `resume`, call `formatRunRecoveryDecision()` and emit:

```ts
await progress(runOptions, "info", "recovery", message, {
  issueNumber: issue.number,
  consoleMessage: message,
  data: {
    action: "resume",
    mutationApplied: false,
    ignoredEntries: recovery.decision.assessment.worktree.ignoredEntries,
  },
});
```

Place this immediately after `recoverBlockedWorkspace()` and before artifact
workspace inspection, claim-state writes, `ensureIssueWorkspace()`, or any Pi
stage. Do not add recovery implementation to `pipeline.ts`.

- [ ] **Step 6: Run focused pipeline and workspace tests**

Run:

```sh
node --test \
  src/cli/commands/run-once/pipeline-recovery.test.ts \
  src/cli/commands/run-once/pipeline-recovery-ignored-content.test.ts \
  src/cli/commands/run-once/pipeline-workspace-scenarios.test.ts
```

Expected: PASS. Both ignored-content scenarios invoke Pi in the exact existing
worktree with byte-identical sentinels and no recovery mutation; unsafe snapshot
and existing workspace scenarios remain green.

- [ ] **Step 7: Commit the pipeline preservation boundary**

```sh
git add \
  src/cli/commands/run-once/pipeline-recovery.ts \
  src/cli/commands/run-once/pipeline.ts \
  test-support/run-once/pipeline-fixtures.ts \
  src/cli/commands/run-once/pipeline-recovery-ignored-content.test.ts
git commit -m "fix: preserve ignored state on blocked retry"
```

---

### Task 3: Prove destructive recovery remains fail-closed

**Files:**

- Create: `src/cli/commands/run-once/recovery-mutation-ignored-content.test.ts`
- Modify: `src/cli/commands/run/reset/reset.test.ts:1-405`
- Verify unchanged: `src/cli/commands/run-once/recovery-mutation-helpers.ts`
- Verify unchanged: `src/cli/commands/run-once/recovery-mutation-refresh.ts`
- Verify unchanged: `src/cli/commands/run-once/recovery-mutation-reset.ts`
- Verify unchanged:
  `src/cli/commands/run-once/recovery-mutation.test.ts:409-466`

**Interfaces:**

- Consumes: real Git repositories, the typed ignored-content refusal from Task
  1, reset dependency injection, and the existing post-move
  `assertRecoveryWorkspaceUnchanged()` guard.
- Produces: regression evidence that pre-existing ignored content blocks reset
  before archive/mutation and late ignored content blocks refresh before detach,
  branch update, or publication.

- [ ] **Step 1: Add a real-Git pre-existing ignored reset test**

Use the existing `resetFixture()` in `run/reset/reset.test.ts`. Add `.env.local`
to the repository's common `.git/info/exclude`, write a sentinel in the
registered issue worktree, and record the issue branch OID. Inject archive and
mutation spies:

```ts
let archiveCalled = false;
let mutationCalled = false;
await assert.rejects(
  resetIssueRun(
    fixture.runner,
    fixture.runConfig,
    { now: NOW },
    {
      ...fixture.dependencies,
      archiveRecovery: async () => {
        archiveCalled = true;
        return { path: "must-not-exist" };
      },
      executeMutation: async () => {
        mutationCalled = true;
        throw new Error("mutation must not run");
      },
    },
  ),
  (error: unknown) => {
    assert.match(String(error), /ignored-worktree-content/);
    assert.match(String(error), /archive-reset-and-start/);
    assert.match(String(error), /.env.local/);
    return true;
  },
);
assert.equal(archiveCalled, false);
assert.equal(mutationCalled, false);
```

Also assert the sentinel bytes and branch OID are unchanged and no quarantine
path was created. This test should pass after Task 1 and proves the refusal is
positioned before both destructive reset phases.

- [ ] **Step 2: Add the missing late-ignored refresh race test**

Create `recovery-mutation-ignored-content.test.ts` with a real repository whose
initial commit includes `.gitignore` for `.cache/`, a stale issue
branch/worktree, and a newer base commit. Construct the existing pinned
`refresh-and-resume` decision. Wrap the real-Git runner so immediately after the
first successful `git worktree move` it writes `quarantine/.cache/late.bin` and
records all subsequent commands.

Invoke `executeRunRecoveryMutation()` and assert a `RunRecoveryMutationError`.
Then assert:

```ts
assert.deepEqual(
  await readFile(join(quarantine, ".cache/late.bin")),
  Buffer.from([0, 211, 255]),
);
assert.equal(git("rev-parse", branch), oldBranchOid);
assert.equal(
  calls.some(
    (args) =>
      args[0] === "update-ref" &&
      (args[1] === "--no-deref" || args[1] === `refs/heads/${branch}`),
  ),
  false,
);
assert.equal(
  calls.filter((args) => args[0] === "worktree" && args[1] === "move").length,
  1,
);
```

Assert the error reports the quarantine and staging paths. Do not alter the
production helper to make this pass; it must detect the `!!` status after the
move.

- [ ] **Step 3: Run destructive-path regression tests**

Run:

```sh
node --test \
  src/cli/commands/run-once/recovery-mutation-ignored-content.test.ts \
  src/cli/commands/run-once/recovery-mutation.test.ts \
  src/cli/commands/run/reset/reset.test.ts
```

Expected: PASS. The new refresh case and existing
`late ignored quarantine content prevents reset ref deletion` case both retain
the injected bytes and prevent later ref operations. The pre-existing reset case
refuses before archive or mutation.

- [ ] **Step 4: Review the mutation diff for accidental weakening**

Run:

```sh
git diff HEAD~2 -- \
  src/cli/commands/run-once/recovery-mutation-helpers.ts \
  src/cli/commands/run-once/recovery-mutation-refresh.ts \
  src/cli/commands/run-once/recovery-mutation-reset.ts
```

Expected: no production mutation diff. If a test exposes a genuine gap, make the
smallest fail-closed change, rerun Step 3, and document the residual race in the
commit body; do not filter ignored paths or permit publication/ref updates after
a failed complete-status check.

- [ ] **Step 5: Commit destructive-path regression coverage**

```sh
git add \
  src/cli/commands/run-once/recovery-mutation-ignored-content.test.ts \
  src/cli/commands/run/reset/reset.test.ts
git commit -m "test: protect ignored content during destructive recovery"
```

---

### Task 4: Document the policy and run full verification

**Files:**

- Modify: `site/src/content/docs/using-patchmill/run-once.md:172-205`
- Verify: all files changed by Tasks 1-3

**Interfaces:**

- Consumes: the final recovery decisions and diagnostics from Tasks 1-3.
- Produces: operator documentation that explains when ignored content is
  preserved versus refused, plus complete project verification evidence.

- [ ] **Step 1: Update blocked-recovery operator guidance**

Replace the statement that all ignored content refuses automatic recovery with
three explicit rules:

1. A verified ordinary-clean current or commit-bearing worktree resumes at the
   same path without workspace mutation; every ignored entry remains in place
   through Pi invocation.
2. A zero-ahead branch behind the base still requires refresh, so ignored
   content blocks that refresh rather than causing stale content to resume.
3. Ignored content blocks every refresh, recreation, and reset because those
   actions cannot prove preservation; the refusal names the blocked action,
   while an allowed retry reports `resuming in place` and lists preserved
   entries.

State that `.pi/todos/`, `.superpowers/`, environment files, and generated
content follow the same path-agnostic rule. Keep the existing late-content,
quarantine, no-force, and lease-repair paragraphs.

Do not add a documentation text assertion. The Testing Value Gate selects
`npm run lint` and `npm run site:build` as direct verification.

- [ ] **Step 2: Run focused issue verification**

Run:

```sh
node --test \
  src/cli/commands/run-once/recovery-ignored-content.test.ts \
  src/cli/commands/run-once/recovery-archive.test.ts \
  src/cli/commands/run-once/pipeline-recovery.test.ts \
  src/cli/commands/run-once/pipeline-recovery-ignored-content.test.ts \
  src/cli/commands/run-once/pipeline-workspace-scenarios.test.ts \
  src/cli/commands/run-once/recovery-mutation-ignored-content.test.ts \
  src/cli/commands/run-once/recovery-mutation.test.ts \
  src/cli/commands/run/reset/reset.test.ts
```

Expected: PASS with current and commit-bearing in-place preservation, ordinary
dirty precedence, typed destructive refusals, and both refresh/reset late-race
coverage.

- [ ] **Step 3: Run the required project verification**

Run each command separately and retain its exit status:

```sh
npm run test:run-once
npm test
npm run lint
npm run build
npm run site:build
```

Expected: every command exits 0.

- [ ] **Step 4: Confirm dependency metadata did not change**

Run:

```sh
base_commit=$(git merge-base HEAD origin/main)
git diff --name-only "$base_commit"..HEAD -- \
  package.json package-lock.json npm-shrinkwrap.json
```

Expected: no output. If any dependency file is listed unexpectedly, inspect and
remove the out-of-scope change or, if it is truly required, run:

```sh
nix build .#patchmill --print-build-logs
```

Expected when required: exit 0, satisfying `AGENTS.md`.

- [ ] **Step 5: Review acceptance evidence and scope**

Run:

```sh
git status --short
git diff --check
git diff --stat "$base_commit"
```

Expected: only issue-scoped source, tests, fixture support, and run-once
operator documentation are changed; `git diff --check` is silent. Confirm the
pipeline tests observe exact paths and bytes at Pi invocation, mutation command
lists are empty for in-place resume, destructive refusals name their blocked
action, and late refresh/reset checks prevent ref updates.

- [ ] **Step 6: Commit documentation**

```sh
git add site/src/content/docs/using-patchmill/run-once.md
git commit -m "docs: explain ignored state recovery safety"
```

---

## Acceptance Mapping

| Acceptance criterion                                  | Plan evidence                                                                                                          |
| ----------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Clean commit-bearing retry resumes with ignored files | Task 1 selects `resume`; Task 2 exercises an ahead-and-behind branch through Pi.                                       |
| Ignored workflow bytes are identical at agent start   | Task 2 reads four sentinel files and compares bytes/device/inode in the Pi callback.                                   |
| Retry does not refresh, reset, delete, or replace     | Task 2 checks worktree identity and rejects every recovery mutation command.                                           |
| Current zero-ahead worktree resumes                   | Task 1 policy and Task 2 pipeline cases use `ahead = 0`, `behind = 0`.                                                 |
| Destructive mutation remains fail-closed              | Tasks 1 and 3 refuse stale refresh/recreate/reset and preserve reset's stronger commit refusal.                        |
| Refresh/reset late races remain effective             | Task 3 adds refresh race coverage and reruns the existing reset race.                                                  |
| Diagnostics distinguish preserve from refuse          | Task 1 formats separate messages; Task 2 proves preservation is emitted before Pi; Task 3 checks reset refusal action. |
| Workflow and ordinary ignored paths are covered       | Tasks 1 and 2 include `.pi/todos/`, `.superpowers/`, and `.cache/`.                                                    |
