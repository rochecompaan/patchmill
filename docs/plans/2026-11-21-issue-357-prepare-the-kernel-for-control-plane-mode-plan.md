# Prepare the kernel for control-plane mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use the sibling `executing-plans`
> skill to implement this plan inline, task by task. Steps use checkbox
> (`- [ ]`) syntax for tracking.

**Goal:** Add the state-tracking mode object, the `cleaned` cleanup result, a
caller-held lock for `runOneIssue`, a pre-write check for `runTriage`, and the
Node 24 floor, with no other change in label or local state mode.

**Architecture:** A new module `src/kernel/state-tracking-mode.ts` gives one
object per mode, and six callers ask it instead of comparing strings. The other
three changes are small optional inputs or results on existing kernel functions.
The control-plane mode itself comes in later slices.

**Tech Stack:** TypeScript on Node 24, `node:test`, the existing fake host and
run-once fixtures in `test-support/`.

**Spec:**
[`docs/specs/2026-11-21-issue-357-prepare-the-kernel-for-control-plane-mode-design.md`](../specs/2026-11-21-issue-357-prepare-the-kernel-for-control-plane-mode-design.md)

**Inputs:**

- The spec above, with its inline visual explanation.
- Parent spec
  `docs/specs/2026-11-14-issue-356-patchmill-control-plane-prototype-design.md`
  on `origin/main`. Read it with `git show origin/main:<path>`.
- No mockups. No HTML companions.

## Global Constraints

- Label mode and local state mode keep their behaviour, except the new `cleaned`
  result.
- Existing tests stay unchanged, except the assertion of the old `skipped`
  result at `src/kernel/merged-cleanup-hook.test.ts:86`.
- The parent spec is read-only. Do not edit it.
- `engines.node` is `>=24`.
- Because `package.json` changes, `nix build` is part of verification.
- Run every command in the worktree through `devenv shell --` unless the step
  says otherwise.

## Review Focus

1. A caller passes a held lock for another issue, or no `issue`. Expect a throw
   before any sweep, sync, selection, or write. Tests in Task 3.
2. `runOneIssue` throws while the caller holds the lock. Expect the lock to stay
   held after the throw. Test in Task 3.
3. The pre-write check throws at the status write after dependency links were
   added. Expect the links to stay and no status write. Test in Task 4.
4. A dry run with a check that throws. Expect a normal result, because a dry run
   makes no writes. Test in Task 4.
5. An aborted cleanup with nothing left. Expect `skipped`, not `cleaned`. Test
   in Task 2.

---

### Task 1: State-tracking mode object

**Files:**

- Create: `src/kernel/state-tracking-mode.ts`
- Create: `src/kernel/state-tracking-mode.test.ts`
- Modify: `src/kernel/workflow-factory.ts`
- Modify: `src/cli/commands/doctor/checks.ts:76-97,104`
- Modify: `src/cli/commands/release/main.ts:58-61`
- Modify: `src/cli/commands/labels/main.ts:40-43`
- Modify: `src/kernel/run-once.ts:530-533`

**Interfaces:**

- Consumes: `LabelWorkflowState`, `LocalWorkflowState`, `StateStore`,
  `stateDir`, `STATE_DIR`, `WORKFLOW_STATUS_TITLES`, `WorkflowStatus`.
- Produces:

```ts
export type WorkflowStateInput = {
  config: PatchmillConfig;
  host: Host;
  repoRoot: string;
  now: () => Date;
  warn: (message: string) => void;
};
export type StateTrackingMode = {
  readonly name: PatchmillConfig["workflow"]["stateTracking"];
  createWorkflowState(input: WorkflowStateInput): WorkflowState;
  statusTitles(config: PatchmillConfig): Record<WorkflowStatus, string>;
  readonly labelsSetup: { allowed: true } | { allowed: false; reason: string };
  readonly doctorWorkflowCheck: "labels" | "state";
  readonly ignoredStatePaths: readonly string[];
};
export function stateTrackingMode(config: PatchmillConfig): StateTrackingMode;
```

- [ ] **Step 1: Write the failing tests** in
      `src/kernel/state-tracking-mode.test.ts`. Build configs with
      `parseConfig`, and a host with `new FakeHost(<temp host.json>)`.

```ts
test("labels mode answers from configured labels", async (t) => {
  const config = parseConfig({ labels: { ready: "queue" } });
  const mode = stateTrackingMode(config);
  assert.equal(mode.name, "labels");
  assert.ok(
    mode.createWorkflowState(input(config)) instanceof LabelWorkflowState,
  );
  assert.deepEqual(mode.statusTitles(config), config.labels);
  assert.equal(mode.statusTitles(config).ready, "queue");
  assert.deepEqual(mode.labelsSetup, { allowed: true });
  assert.equal(mode.doctorWorkflowCheck, "labels");
  assert.deepEqual(mode.ignoredStatePaths, []);
});

test("local state mode answers from local state", async (t) => {
  const config = parseConfig({ workflow: { stateTracking: "local" } });
  const mode = stateTrackingMode(config);
  assert.equal(mode.name, "local");
  assert.ok(
    mode.createWorkflowState(input(config)) instanceof LocalWorkflowState,
  );
  assert.deepEqual(mode.statusTitles(config), WORKFLOW_STATUS_TITLES);
  assert.deepEqual(mode.labelsSetup, {
    allowed: false,
    reason: "Local state mode does not use labels.",
  });
  assert.equal(mode.doctorWorkflowCheck, "state");
  assert.deepEqual(mode.ignoredStatePaths, [".patchmill/state/"]);
});
```

`input(config)` is a local helper that returns a `WorkflowStateInput` with a
temp `repoRoot`. Also assert that creating the local backend writes nothing:
`await assert.rejects(fs.readdir(join(repoRoot, ".patchmill/state")), { code: "ENOENT" })`.

- [ ] **Step 2: Run the tests to make sure that they fail**

Run: `devenv shell -- node --test src/kernel/state-tracking-mode.test.ts`
Expected: FAIL, because `./state-tracking-mode.ts` does not exist.

- [ ] **Step 3: Implement `stateTrackingMode` in
      `src/kernel/state-tracking-mode.ts`**

Write two `const` objects, `LABELS_MODE` and `LOCAL_MODE`, of type
`StateTrackingMode`. Move the backend construction from
`src/kernel/workflow-factory.ts` into their `createWorkflowState`. Select the
object with an exhaustive `switch` on `config.workflow.stateTracking`.

- [ ] **Step 4: Move the six callers onto the mode object**

- `createWorkflowState` in `src/kernel/workflow-factory.ts` keeps its signature
  and returns `stateTrackingMode(input.config).createWorkflowState(input)`.
- Doctor: `const mode = stateTrackingMode(config)`. Run the `state` check when
  `mode.doctorWorkflowCheck === "state"`, else the `labels` check. Spread
  `mode.ignoredStatePaths` into the excludes paths in place of the `STATE_DIR`
  expression. Remove the `STATE_DIR` import if it has no other use.
- Release:
  `const { ready, inProgress } = stateTrackingMode(config).statusTitles(config);`
  Remove the `WORKFLOW_STATUS_TITLES` import.
- Run-once:
  `outcomeLabel: stateTrackingMode(config).statusTitles(config)[stop.label]`.
  Remove `WORKFLOW_STATUS_TITLES` from the import if it has no other use.
- Labels: `const setup = stateTrackingMode(config).labelsSetup;` If
  `!setup.allowed`, print `setup.reason` to stderr and return `1`.

- [ ] **Step 5: Run the tests and make sure that they pass**

Run:
`devenv shell -- node --test src/kernel/state-tracking-mode.test.ts src/cli/commands/doctor/checks.test.ts src/cli/commands/release/main.test.ts src/cli/commands/labels/main.test.ts src/kernel/run-once.test.ts`
Expected: PASS, with no change to the existing test files.

Run: `rg -n 'stateTracking === "local"' src` Expected: one match only, in
`src/web/file-run-observations.ts`.

- [ ] **Step 6: Commit**

```bash
git add src/kernel/state-tracking-mode.ts src/kernel/state-tracking-mode.test.ts \
  src/kernel/workflow-factory.ts src/cli/commands/doctor/checks.ts \
  src/cli/commands/release/main.ts src/cli/commands/labels/main.ts src/kernel/run-once.ts
git commit -m "refactor(kernel): answer mode questions from one object per state-tracking mode"
```

### Task 2: `cleaned` when the merge is confirmed and nothing is left

**Files:**

- Modify: `src/kernel/merged-cleanup.ts:120-125`
- Modify: `src/kernel/merged-cleanup-hook.test.ts:86`
- Test: `src/kernel/merged-cleanup-safety.test.ts`

**Interfaces:**

- Consumes: `setupCleanup` from `test-support/merged-cleanup-fixture.ts`.
- Produces: `cleanupMergedIssue` returns `{ status: "cleaned", warnings: [] }`
  when it confirms the merge and finds no registered worktree and no local
  branch. Task 3 does not depend on it.

- [ ] **Step 1: Write the failing tests** in
      `src/kernel/merged-cleanup-safety.test.ts`, and change line 86 of
      `src/kernel/merged-cleanup-hook.test.ts` to expect `"cleaned"`.

```ts
test("a confirmed merge with nothing left is cleaned without a hook or log entry", async (t) => {
  const c = await setupCleanup(t);
  assert.equal((await c.cleanup()).status, "cleaned");
  const log = await fs.readFile(join(c.issueDir, "cleanup.log"), "utf8");
  assert.deepEqual(await c.cleanup(), { status: "cleaned", warnings: [] });
  assert.equal(await fs.readFile(join(c.issueDir, "cleanup.log"), "utf8"), log);
  assert.equal(await fs.readFile(c.counter, "utf8"), "hook ran\n");
});

test("an unconfirmed merge with nothing left is skipped", async (t) => {
  const c = await setupCleanup(t);
  assert.equal((await c.cleanup()).status, "cleaned");
  await c.mutate((state) => {
    state.pullRequests[0]!.state = "open";
  });
  assert.equal((await c.cleanup()).status, "skipped");
});

test("an aborted cleanup with nothing left is skipped", async (t) => {
  const c = await setupCleanup(t);
  assert.equal((await c.cleanup()).status, "cleaned");
  assert.equal(
    (await c.cleanup({ signal: AbortSignal.abort() })).status,
    "skipped",
  );
});
```

- [ ] **Step 2: Run the tests to make sure that they fail**

Run:
`devenv shell -- node --test src/kernel/merged-cleanup-safety.test.ts src/kernel/merged-cleanup-hook.test.ts`
Expected: FAIL. The first test and the changed hook assertion get `skipped`.

- [ ] **Step 3: Change the "no registered worktree and no branch" return in
      `cleanupMergedIssue` from `result("skipped")` to `result("cleaned")`**

Keep the earlier `if (!identity || signal?.aborted) return result("skipped");`
as it is. Update the `CleanupResult` doc comment, if you add one, to name the
three cases.

- [ ] **Step 4: Run the tests and make sure that they pass**

Run: `devenv shell -- node --test src/kernel/merged-cleanup*.test.ts` Expected:
PASS.

- [ ] **Step 5: Commit**

```bash
git add src/kernel/merged-cleanup.ts src/kernel/merged-cleanup-hook.test.ts src/kernel/merged-cleanup-safety.test.ts
git commit -m "feat(kernel): report cleaned when a merged issue has nothing left to remove"
```

### Task 3: Caller-held lock in `runOneIssue`

**Files:**

- Modify: `src/kernel/run-once.ts` (`RunOnceOptions`, the sweep call, the lock
  block at about line 147, and the `finally` at the end)
- Modify: `src/kernel/merged-cleanup-sweep.ts` (`sweepMergedIssues`)
- Create: `src/kernel/run-once-held-lock.test.ts`

**Interfaces:**

- Consumes: `IssueLock`, `acquireLock`, `LockHeldError` from
  `src/kernel/lock.ts`; `setupRun`, `spec`, `plan`, `implement` from
  `test-support/run-once-fixture.ts`.
- Produces:
  - `RunOnceOptions.heldLock?: IssueLock`.
  - `sweepMergedIssues(input: CleanupServices & { skipIssue?: number })`. The
    sweep does not lock, clean, or report the candidate whose issue is
    `skipIssue`.

- [ ] **Step 1: Write the failing tests** in
      `src/kernel/run-once-held-lock.test.ts`

```ts
test("a caller-held lock runs the issue and is still held after the outcome", async (t) => {
  const c = await setupRun(t, [implement]);
  await c.seed({ [spec]: "spec", [plan]: "plan" });
  const lock = await acquireLock(c.lockPath);
  try {
    assert.equal(
      (await c.run({ issue: 9, heldLock: lock })).status,
      "completed",
    );
    await assert.rejects(acquireLock(c.lockPath), LockHeldError);
  } finally {
    await lock.release();
  }
  await (await acquireLock(c.lockPath)).release();
});

test("a caller-held lock is still held when the run throws", async (t) => {
  const c = await setupRun(t);
  c.host.viewIssue = async () => {
    throw new Error("host down");
  };
  const lock = await acquireLock(c.lockPath);
  try {
    await assert.rejects(c.run({ issue: 9, heldLock: lock }), /host down/);
    await assert.rejects(acquireLock(c.lockPath), LockHeldError);
  } finally {
    await lock.release();
  }
});

test("the sweep does not report the issue whose lock the caller holds", async (t) => {
  const c = await setupRun(t, [implement]);
  await c.seed({ [spec]: "spec", [plan]: "plan" });
  assert.equal((await c.run({ issue: 9 })).status, "completed");
  c.output.length = 0;
  const lock = await acquireLock(c.lockPath);
  try {
    await c.run({ issue: 9, heldLock: lock });
  } finally {
    await lock.release();
  }
  assert.doesNotMatch(
    c.output.join("\n"),
    /cleanup skipped \(active issue lock\)/,
  );
});
```

Add two refusal tests. Each asserts that the run rejects, and that
`c.host.state().calls` has no `setLabels:`, `commentIssue:`, or `viewIssue:`
entry, and that `c.worktree` does not exist:

- `heldLock` set and `issue` not set. Rejects with
  `/A held lock requires an issue number/`.
- `heldLock` for `issue-8/lock` (the sibling directory of `c.lockPath`) with
  `issue: 9`. Rejects with `/The held lock does not own issue #9's lock path/`.

If the fixture's `c.output` is not a mutable array, collect the output length
before the second run and slice it afterwards.

- [ ] **Step 2: Run the tests to make sure that they fail**

Run: `devenv shell -- node --test src/kernel/run-once-held-lock.test.ts`
Expected: FAIL. Type checking rejects `heldLock`, or at run time the run refuses
with "another Run attempt is active".

- [ ] **Step 3: Implement the option**

In `runOneIssue`, before the sweep:

- If `options.heldLock` is set and `options.issue` is undefined, throw
  `new Error("A held lock requires an issue number.")`.
- If `resolve(options.heldLock.path)` is not the issue lock path, throw an
  `Error` with the message `The held lock does not own issue #<N>'s lock path.`
  The issue lock path is the `lock` file in the issue directory that
  `runOneIssue` already computes as `issueDir`. Compute it before the sweep.

Pass `skipIssue: options.issue` to `sweepMergedIssues` when `heldLock` is set.
In the lock block, use `options.heldLock` when it is set, and call `acquireLock`
only when it is not. In the `finally`, call `lock.release()` only when the lock
is not the held lock. In `sweepMergedIssues`, `continue` before `acquireLock`
when `candidate.issue === input.skipIssue`.

- [ ] **Step 4: Run the tests and make sure that they pass**

Run:
`devenv shell -- node --test src/kernel/run-once-held-lock.test.ts src/kernel/run-once*.test.ts src/kernel/interactive-*.test.ts src/kernel/merged-cleanup-sweep.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/kernel/run-once.ts src/kernel/merged-cleanup-sweep.ts src/kernel/run-once-held-lock.test.ts
git commit -m "feat(kernel): let runOneIssue use a per-issue lock its caller holds"
```

### Task 4: Pre-write check in `runTriage`

**Files:**

- Modify: `src/kernel/triage.ts` (`TriageOptions`, the candidate loop)
- Test: `src/kernel/triage.test.ts`

**Interfaces:**

- Consumes: the `setup`, `issue`, and `block` helpers in
  `src/kernel/triage.test.ts`.
- Produces: `TriageOptions.beforeWrite?: () => Promise<void>`.

- [ ] **Step 1: Write the failing tests** at the end of
      `src/kernel/triage.test.ts`. Count host writes with
      `const writes = () => f.host.state().calls.filter((call) => /^(addIssueDependency|setLabels|commentIssue):/.test(call)).length;`

- "the pre-write check runs before each dependency link and status write":
  issues
  `[issue(9), issue(1, ["agent-unsuitable"]), issue(2, ["agent-unsuitable"])]`,
  output `block("agent-ready", "Wait", [1, 2])`. The check pushes `writes()` to
  an array. Assert the array is `[0, 1, 2]` and the run resolves to
  `[{ issue: 9, status: "ready", applied: true }]`.
- "a throwing pre-write check stops triage before its first write": issues
  `[issue(9), issue(10), issue(1, ["agent-unsuitable"])]`, outputs
  `[block("agent-ready", "Wait", [1]), block()]`. The check throws
  `new Error("triage lock lost")`. Assert the run rejects with
  `/triage lock lost/`, `writes()` is `0`, and the `launches` file in `f.root`
  has one line.
- "a check that throws at the status write keeps the dependency links": the same
  as the first test, but the check throws on its third call. Assert the run
  rejects, `addIssueDependency:9:1` and `addIssueDependency:9:2` are in the
  calls, and `setLabels:9` is not.
- "a dry run does not call the pre-write check": output
  `block("agent-ready", "Wait", [1])`, `dryRun: true`, and a check that throws.
  Assert the run resolves with `applied: false`.

- [ ] **Step 2: Run the tests to make sure that they fail**

Run: `devenv shell -- node --test src/kernel/triage.test.ts` Expected: FAIL.
Type checking rejects `beforeWrite`, or the check is never called.

- [ ] **Step 3: Implement the check**

In `runTriage`, define a private `class TriageStopped extends Error` with the
check's error as `cause`, and a local `guard()` that awaits
`options.beforeWrite?.()` and wraps a throw in `TriageStopped`. Call `guard()`
before each `host.addIssueDependency`, outside its `try`, and before
`workflow.setStatus`. In the per-candidate `catch`, rethrow `error.cause` when
`error instanceof TriageStopped`, so that the caller gets the original error. Do
not call `guard()` in a dry run.

- [ ] **Step 4: Run the tests and make sure that they pass**

Run:
`devenv shell -- node --test src/kernel/triage.test.ts src/cli/commands/triage/*.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/kernel/triage.ts src/kernel/triage.test.ts
git commit -m "feat(kernel): let runTriage stop before a write when a pre-write check throws"
```

### Task 5: Node 24 and full verification

**Files:**

- Modify: `package.json:77-79`
- Modify: `package-lock.json` (root package `engines` only)
- Modify: `README.md:61`

No automated test. The Testing Value Gate excludes tests that only assert a
version field or document text. Use direct inspection and the full verification
below.

- [ ] **Step 1: Raise the floor**

Set `"node": ">=24"` in `package.json` `engines`. Run
`devenv shell -- npm install --package-lock-only --ignore-scripts`. Change the
README line to `- Node.js 24 or later.`

- [ ] **Step 2: Inspect the change**

Run: `git diff package.json package-lock.json README.md` Expected: only the two
`engines.node` lines and the README line change. If the lock file shows other
changes, revert it and edit the root `engines` line by hand.

Run:
`rg -n '22\.19' --glob '!site/**' --glob '!docs/specs/**' --glob '!docs/plans/**' --glob '!node_modules/**' .`
Expected: no match.

- [ ] **Step 3: Run the full verification**

```sh
devenv shell -- npm test
devenv shell -- npm run lint
devenv shell -- npm run build
nix build
```

Expected: each command exits with code 0. If `nix build` reports an
`npmDepsHash` mismatch, put the hash that it prints in `nix/package.nix` and run
it again.

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json README.md
git commit -m "chore: require Node 24 or later"
```

## Visual explanation

The tree shows the task order and what each task owns. Tasks 1 to 4 do not
depend on each other. Task 5 runs the full verification after them.

```text
Task 1  state-tracking-mode.ts  <- doctor, release, labels, run-once, workflow-factory
Task 2  merged-cleanup.ts       "nothing left" -> cleaned
Task 3  run-once.ts             heldLock option
        merged-cleanup-sweep.ts skipIssue
Task 4  triage.ts               beforeWrite before each dependency link and status write
Task 5  package.json, lock, README -> npm test, lint, build, nix build
```

## Companion artifacts

None.
