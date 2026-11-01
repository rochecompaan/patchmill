# Interactive Issue Runs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `patchmill run-once --issue N --interactive`, which opens Pi's
chat and runs the same Run-once workflow with the maintainer in the
conversation, from spec and plan through to a merged implementation pull
request.

**Architecture:** `runOneIssue` gets two optional dependencies: a `HumanChannel`
and an `observe` callback. Without them it behaves exactly as today. With a
channel, planning runs in the Console session, implementation runs as a
`pi-subagents` worker with forked context, and planning gates and the review
wait hold the Run attempt in the process instead of ending it. A Patchmill Pi
extension implements the channel, gives the console agent five tools, and stops
stray workers. Every decision still comes from facts derived from git and the
host.

**Tech Stack:** TypeScript on Node (`node --test`), Pi SDK
`@earendil-works/pi-coding-agent` 1.4.0 (`InteractiveMode`,
`createAgentSessionRuntime`, `SessionManager`, `ExtensionAPI`), `pi-subagents`
0.80.0 in-process RPC, `typebox` 1.3.7 for tool schemas.

**Spec:** `docs/specs/2026-10-14-issue-225-interactive-issue-runs-design.md`

**Base:** Branch from current `main` (`feat/issue-225-interactive-runs`), not
from the spec branch. The spec branch predates the kernel (#329). All file paths
below refer to `main`.

## Global Constraints

- Non-interactive runs do not change. Every existing test under `src/kernel/`
  and `src/cli/` passes without edits, except the mechanical import changes in
  Task 1.
- No persisted workflow state. Nothing new is read from disk to decide a phase,
  a wait, or an outcome. Pi session files and `pi-subagents` run state are read
  only to reopen the chat (D2) and to stop stray workers (D7).
- The kernel posts exactly one comment per stop.
- `src/kernel/run-envelope.md` stays one template under 150 lines.
- Pins stay exact: `@earendil-works/pi-coding-agent` 1.4.0, `pi-subagents`
  0.80.0. No npm dependency changes are planned. If one becomes necessary, rerun
  the Nix build.
- The console agent never starts a phase. Only Patchmill code calls `spawn`.
- Tool names: `patchmill_start_issue_run`, `patchmill_submit_planning_result`,
  `patchmill_continue_issue_run`, `patchmill_confirm_block_guidance`,
  `patchmill_run_status`.
- Worker agent name: `patchmill-implementation`.
- Console session directory: `<paths.runsDir>/console/sessions/`.
- Keep modules focused (module-size skill). `src/kernel/run-once.ts` must end
  smaller than or close to its current 410 lines. New logic goes in new files.

## Decisions this plan makes for "Left to the builder"

| Spec item                         | Decision                                                                                                                                                                                                                                            |
| --------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Workflow and chat in one process  | The extension calls `runOneIssue` without awaiting it from the tool call. The run's promise lives on the controller. Channel methods return promises that console tools resolve.                                                                    |
| Tagging workers for the restart   | Workers run as the dedicated agent `patchmill-implementation`. The restart check stops every running or queued run in the Console session whose step agent is that name. It waits up to `STOP_WAIT_MS = 60_000`, polling `status` every 500 ms.     |
| Worker files under the run dir    | The worker's final output is saved to `<runDir>/sessions/<n>/output.md` through the `spawn` `output` field. After completion, its session file is copied into `<runDir>/sessions/<n>/`, so `sumSessionUsage` and the PR cost report work unchanged. |
| Human channel shape               | `HumanChannel` in `src/kernel/human-channel.ts` (Task 2).                                                                                                                                                                                           |
| Snapshot and events               | `RunSnapshot` pushed through `deps.observe` (Task 4). The controller keeps the latest one in memory.                                                                                                                                                |
| Watching merges on its own        | Not in this plan.                                                                                                                                                                                                                                   |
| Slash commands and widget         | None in this plan. Progress lines go to the chat as display-only custom messages.                                                                                                                                                                   |
| Live cost                         | The status tool reports the run's usage so far from `sumSessionUsage(<runDir>/sessions)`, labeled "estimated". Console session usage is not added to the issue cost report in this plan.                                                            |
| Slice 4 (open a `needs-info` run) | Out of scope for this plan, as the spec allows. `--interactive --issue N` on such an issue already claims it and derives the phase again.                                                                                                           |

## Review Focus

1. The PR is closed without merging, or merged into the wrong base, during the
   review wait. Expected: one `needs-info` comment, `agent-done` replaced by
   `needs-info`, the Issue run ends. Test in Task 3.
2. The continue tool is called when nothing waits, or while a worker runs.
   Expected: a clear message and no state change. Test in Task 7.
3. The maintainer quits while planning waits for a submit. Expected: the
   planning run returns `aborted`, the attempt publishes `needs-info` like a
   non-interactive abort, and the lock is released. Tests in Tasks 2 and 7.
4. `pi-subagents` never answers RPC (not loaded, or not ready). Expected: the
   request fails after `REPLY_TIMEOUT_MS = 10_000` and the implementation phase
   stops with that reason instead of hanging. Test in Task 5.
5. A stray worker does not stop within `STOP_WAIT_MS`. Expected: the console
   does not start the Issue run and says why in the chat. Test in Task 6.

---

### Task 1: Launcher seam and stop publication

Refactor only. Move the print-mode session and the stop publication out of
`runOneIssue` so later tasks can swap the launcher and publish mid-run.

**Files:**

- Create: `src/kernel/launch.ts`
- Create: `src/kernel/publish.ts`
- Modify: `src/kernel/run-once.ts` (session block and publication block)

**Interfaces:**

- Produces:

  ```ts
  // src/kernel/launch.ts
  export type PhaseLaunch = {
    phase: Phase;
    envelope: string;
    promptPath: string;
    worktree: string;
    skillPath: string;
    sessionDir: string;
    logPath: string;
    aggregateLogPath: string;
    timeoutMs: number;
    signal?: AbortSignal;
  };
  export type PhaseRun = {
    result: ParsedResult;
    session: Pick<PiSession, "exitCode" | "timedOut" | "aborted">;
  };
  export type PhaseLauncher = (launch: PhaseLaunch) => Promise<PhaseRun>;
  export function printModeLauncher(options: {
    command: PiCommandSpec;
    agentDir: string;
    extensionPaths: string[];
  }): PhaseLauncher;

  // src/kernel/publish.ts
  export type StopPublication = {
    label: OutcomeLabel;
    summary: string;
    cost: string;
    warnings: string[];
    /** Extra labels to remove, such as `done` when a review wait fails. */
    remove?: string[];
  };
  /** Swaps labels and posts the one kernel comment. Returns publication errors. */
  export async function publishStop(
    host: Host,
    labels: LabelsConfig,
    issue: number,
    stop: StopPublication,
  ): Promise<string[]>;
  ```

- [ ] **Step 1: Run the kernel suite to record the baseline**

Run: `npm test` Expected: PASS.

- [ ] **Step 2: Extract `printModeLauncher`**

It wraps the existing `supervisePi` call (same options, `onOutput: () => {}`)
and `parseAgentResult(session.stdout)`. `runOneIssue` writes the envelope to
`promptPath`, then calls the launcher. Use
`printModeLauncher({ command: deps.piCommand, agentDir, extensionPaths })` as
the only launcher for now.

- [ ] **Step 3: Extract `publishStop`**

Move the `releaseSwap` label update and the comment body (`KERNEL_COMMENT`,
`Issue #N: <label>`, summary, cost, warnings, publication errors) without
changing order or text. `remove` labels are appended to the release swap's
`remove` list.

- [ ] **Step 4: Run the suite**

Run: `npm test` Expected: PASS with no test edits.

- [ ] **Step 5: Commit**

```bash
git add src/kernel/launch.ts src/kernel/publish.ts src/kernel/run-once.ts
git commit -m "refactor(kernel): extract phase launcher and stop publication"
```

### Task 2: Human channel and interactive planning

**Files:**

- Create: `src/kernel/human-channel.ts`
- Create: `src/kernel/interactive-loop.ts` (interactive branches of the loop)
- Modify: `src/kernel/run-once.ts`
- Create: `test-support/fake-human.ts`
- Test: `src/kernel/interactive-planning.test.ts`

**Interfaces:**

- Consumes: `PhaseLaunch`, `PhaseRun`, `printModeLauncher`, `publishStop` (Task
  1).
- Produces:

  ```ts
  // src/kernel/human-channel.ts
  export type Wait =
    | { kind: "gate"; message: string }
    | { kind: "review"; message: string };
  export type BlockAnswer =
    | { kind: "guidance"; text: string }
    | { kind: "quit" };
  export type HumanChannel = {
    /** Runs planning in the Console session. Resolves with the confirmed
     * result, or `session.aborted` when the console quits. `feedback` holds the
     * reasons the previous submission failed verification. */
    runPlanning(launch: PhaseLaunch, feedback?: string): Promise<PhaseRun>;
    /** Runs implementation as a background worker. */
    runImplementation(launch: PhaseLaunch): Promise<PhaseRun>;
    /** Slice 2: continues the blocked worker with confirmed guidance. */
    resumeImplementation(
      launch: PhaseLaunch,
      guidance: string,
    ): Promise<PhaseRun>;
    awaitContinue(wait: Wait): Promise<"continue" | "quit">;
    /** Slice 2. */
    awaitGuidance(summary: string): Promise<BlockAnswer>;
    /** A progress or stop line for the chat. */
    notify(text: string): void;
  };

  // src/kernel/run-once.ts
  export type RunOnceDeps = {
    /* existing fields */ human?: HumanChannel;
    observe?: (snapshot: RunSnapshot) => void; // used from Task 4
  };
  export const MAX_SESSIONS_WITHOUT_HUMAN = 3;

  // test-support/fake-human.ts
  export function fakeHuman(
    c: Scenario,
    script?: {
      onWait?: (wait: Wait, count: number) => Promise<"continue" | "quit">;
      onGuidance?: (summary: string) => Promise<BlockAnswer>;
      quitPlanningAt?: number; // 1-based planning call that returns aborted
    },
  ): HumanChannel & { calls: string[]; feedback: string[] };
  ```

  The fake runs `runPlanning`, `runImplementation`, and `resumeImplementation`
  through `printModeLauncher` with the fixture's fake Pi, so scenario steps work
  as in `planning-gates.test.ts`. It records each call as `planning`,
  `implementation`, `resume:<guidance>`, `wait:<kind>`, `guidance`, or
  `notify:<text>`.

- [ ] **Step 1: Write the failing tests**

```ts
test("interactive run goes from planning to a verified PR in one attempt", async (t) => {
  const c = await setupRun(t, [
    {
      writeFiles: { [spec]: "s", [plan]: "p" },
      commit: "Plan",
      push: true,
      result: done,
    },
    implement,
  ]);
  const human = fakeHuman(c, { onWait: async () => "quit" });
  await c.run({ issue: 9 }, { human });
  assert.deepEqual(human.calls.slice(0, 2), ["planning", "implementation"]);
  assert.equal((await c.records()).result.sessions.length, 2);
});

test("a planning result that fails verification goes back to the chat", async (t) => {
  const c = await setupRun(t, [
    {
      writeFiles: { [spec]: "s", [plan]: "p" },
      commit: "Plan",
      result: done,
    }, // not pushed
    { push: true, result: done },
    implement,
  ]);
  const human = fakeHuman(c, { onWait: async () => "quit" });
  await c.run({ issue: 9 }, { human });
  assert.match(human.feedback[0]!, /remote branch does not exist/);
  assert.deepEqual(human.calls.slice(0, 3), [
    "planning",
    "planning",
    "implementation",
  ]);
  const comments = kernelComments(c);
  assert.equal(comments.length, 1); // only the verified-PR stop
  assert.doesNotMatch(comments[0]!.body, /needs-info/);
});

test("quitting while planning waits publishes the abort stop and releases the lock", async (t) => {
  const c = await setupRun(t, []);
  const human = fakeHuman(c, { quitPlanningAt: 1 });
  const outcome = await c.run({ issue: 9 }, { human });
  assert.equal(outcome.status, "stopped");
  assert.deepEqual(c.host.state().issues[0]!.labels, ["needs-info"]);
  assert.match(
    c.host.state().issues[0]!.comments[0]!.body,
    /session was aborted/,
  );
  await (await acquireLock(c.lockPath)).release();
});
```

Extend `setupRun`'s `run` to accept a second argument merged into `deps`. Move
the `implement` step from `planning-gates.test.ts` into `run-once-fixture.ts`,
and add `kernelComments(c)`, which returns the issue comments that contain
`KERNEL_COMMENT`.

- [ ] **Step 2: Run them to see them fail**

Run:
`node --test --test-name-pattern="interactive|quitting" src/kernel/interactive-planning.test.ts`
Expected: FAIL (`human` is ignored).

- [ ] **Step 3: Route phases through the channel**

In `runOneIssue`, choose the launcher per phase: `human.runPlanning` for
planning, `human.runImplementation` for implementation, otherwise
`printModeLauncher`. Put the interactive decisions in
`src/kernel/interactive-loop.ts` as small functions that `runOneIssue` calls, so
`run-once.ts` keeps one loop:

- After a planning verification stop with label `needsInfo` and
  `!run.session.aborted`, call `human.runPlanning(launch, verified.comment)`
  again in the same attempt instead of breaking. Do not publish.
- Replace the fixed `for (index < 3)` with two counters: `sessionNumber` (names
  `sessions/<n>` and `session-<n>.log`, never resets) and `sinceHuman` (resets
  after every confirmed planning submission, continue, or guidance). The loop
  stops with the existing "The session limit was reached." summary when
  `sinceHuman` reaches `MAX_SESSIONS_WITHOUT_HUMAN`. Without a channel,
  `sinceHuman` never resets, so behavior matches today.

- [ ] **Step 4: Run the tests**

Run: `node --test src/kernel/interactive-planning.test.ts` then `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/kernel test-support
git commit -m "feat(kernel): run planning through an optional human channel"
```

### Task 3: Gate wait and review wait

**Files:**

- Create: `src/kernel/review-wait.ts`
- Modify: `src/kernel/interactive-loop.ts`, `src/kernel/run-once.ts`
- Test: `src/kernel/interactive-waits.test.ts`

**Interfaces:**

- Consumes: `HumanChannel.awaitContinue`, `publishStop`, `closesIssue`,
  `wrongTarget`.
- Produces:

  ```ts
  // src/kernel/review-wait.ts
  /** D5: an open, ready implementation PR that closes the issue. */
  export function isReviewWait(
    facts: Facts,
    issue: number,
    repository: Pick<Repository, "owner" | "repo">,
  ): boolean;
  ```

Behavior with a channel (none of it applies without one):

- **Gate wait.** `derivePhase` returns `stop inProgress`, or planning
  verification returns label `inProgress`: call
  `awaitContinue({ kind: "gate", message: planningGateComment(facts) })`. On
  `continue`, reset `sinceHuman` and derive again (an open PR waits again with
  the same message). On `quit`, publish the `inProgress` stop as today.
- **Review wait after verification.** Implementation verification returns label
  `done`: publish it at once with `publishStop` (and the PR cost report, as
  today), mark the attempt `published`, then wait with
  `awaitContinue({ kind: "review", message })`. The message names the PR URL and
  says it waits for the merge.
- **Review wait on restart.** The derived phase is `implementation` and
  `isReviewWait` is true: remove `in-progress`
  (`host.setLabels(issue, [], [labels.inProgress])`), mark `published`, start no
  session, and wait as above.
- **After each review `continue`:** derive again. Merged into the base and
  closing the issue: end with outcome `completed` and publish nothing more.
  Still `isReviewWait`: wait again. Anything else (closed, wrong base, merged
  without closing): publish the `needsInfo` stop with `remove: [labels.done]`
  and end.
- **Quit during the review wait:** publish nothing more.
- When `published` is set, the end of `runOneIssue` skips labels and the comment
  but still writes `result.json` and prints the final result.

- [ ] **Step 1: Write the failing tests**

```ts
test("spec gate waits in the attempt and continues after the merge", async (t) => {
  // spec step opens a Refs PR; plan step; implementation step
  const human = fakeHuman(c, {
    onWait: async (wait, n) => {
      if (wait.kind === "gate" && n === 1) return "continue"; // still open
      if (wait.kind === "gate") {
        await merge(c, specBranch);
        return "continue";
      }
      return "quit";
    },
  });
  await c.run({ issue: 9 }, { human });
  assert.deepEqual(
    human.calls.filter((x) => !x.startsWith("notify")),
    [
      "planning",
      "wait:gate",
      "wait:gate",
      "planning",
      "implementation",
      "wait:review",
    ],
  );
  assert.equal((await c.records()).result.sessions.length, 3); // one Run attempt
});

test("a verified PR gets agent-done at once and the run waits for the merge", async (t) => {
  let labelsDuringWait: string[] = [];
  let lockHeld = false;
  const human = fakeHuman(c, {
    onWait: async () => {
      labelsDuringWait = c.host.state().issues[0]!.labels;
      lockHeld = await isLockHeld(c.lockPath);
      await mergePullRequest(c, branch);
      return "continue";
    },
  });
  const outcome = await c.run({ issue: 9 }, { human });
  assert.deepEqual(labelsDuringWait, ["agent-done"]);
  assert.equal(lockHeld, true);
  assert.equal(outcome.status, "completed");
  assert.equal(kernelComments(c).length, 1);
});

test("a restart in the review wait removes in-progress and starts no session", async (t) => {
  // seed spec, plan, code on the issue branch with an open "Closes #9" PR; label agent-done
  const human = fakeHuman(c, { onWait: async () => "quit" });
  await c.run({ issue: 9 }, { human });
  assert.deepEqual(human.calls, ["wait:review"]);
  assert.deepEqual(c.host.state().issues[0]!.labels, ["agent-done"]);
  assert.equal(kernelComments(c).length, 0);
});

test("a PR closed during the review wait replaces agent-done with needs-info", async (t) => {
  const human = fakeHuman(c, {
    onWait: async () => {
      await c.mutate((s) => {
        s.pullRequests[0]!.state = "closed";
      });
      return "continue";
    },
  });
  await c.run({ issue: 9 }, { human });
  assert.deepEqual(c.host.state().issues[0]!.labels, ["needs-info"]);
  assert.equal(kernelComments(c).length, 2); // agent-done, then needs-info
});

test("quitting during a gate wait publishes the gate stop", async (t) => {
  // spec gate on, spec PR open, onWait returns "quit"
  assert.deepEqual(c.host.state().issues[0]!.labels, ["in-progress"]);
  assert.match(kernelComments(c)[0]!.body, /Waiting for it to be merged/);
});

test("a non-interactive rerun on a ready PR still derives implementation", async (t) => {
  // same seed as the restart test, no human: the fake Pi step runs
  assert.equal((await c.records()).result.sessions[0].phase, "implementation");
});
```

Add `merge` and `mergePullRequest` helpers to `run-once-fixture.ts` (move the
existing `merge` from `planning-gates.test.ts`). `mergePullRequest` merges the
issue branch into the base the same way and sets the fake host PR state to
`merged`.

- [ ] **Step 2: Run them to see them fail**

Run: `node --test src/kernel/interactive-waits.test.ts` Expected: FAIL.

- [ ] **Step 3: Implement `isReviewWait` and the two waits**

`isReviewWait` is true when `facts.stage === "implementation"`, the PR is
`open`, not `draft`, not `wrongTarget`, and `closesIssue` holds.

- [ ] **Step 4: Run the tests**

Run: `node --test src/kernel/interactive-waits.test.ts` then `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/kernel test-support
git commit -m "feat(kernel): hold interactive runs at planning gates and the review wait"
```

### Task 4: Run snapshot

**Files:**

- Create: `src/kernel/run-snapshot.ts`
- Modify: `src/kernel/run-once.ts`, `src/kernel/interactive-loop.ts`
- Test: `src/kernel/run-snapshot.test.ts`

**Interfaces:**

- Produces:

  ```ts
  export type RunState =
    | "deriving"
    | "planning"
    | "implementation"
    | "gate-wait"
    | "review-wait"
    | "blocked"
    | "ended";
  export type RunSnapshot = {
    issue: number;
    runId: string;
    runDir: string;
    startedAt: string;
    state: RunState;
    phase?: Phase;
    session: number; // sessionNumber of the latest session, 0 before any
    facts?: Facts;
    usage?: PiUsage; // sumSessionUsage(<runDir>/sessions) after each session
    summary?: string; // set when state is "ended"
  };
  ```

`runOneIssue` calls `deps.observe?.(snapshot)` on every state change and after
each session. It never reads a snapshot back.

- [ ] **Step 1: Write the failing test**

```ts
test("observe receives each state of an interactive run in order", async (t) => {
  const states: RunState[] = [];
  await c.run(
    { issue: 9 },
    { human, observe: (s) => states.push(s.state) },
  );
  assert.deepEqual(dedupe(states), [
    "deriving",
    "planning",
    "deriving",
    "implementation",
    "review-wait",
    "ended",
  ]);
});
test("the final snapshot carries facts, session count, and usage", ...);
// last.session === 2, last.facts.pullRequest.url set, last.usage.cost > 0
```

- [ ] **Step 2: Run it to see it fail**

Run: `node --test src/kernel/run-snapshot.test.ts` Expected: FAIL.

- [ ] **Step 3: Emit snapshots from `runOneIssue`**

- [ ] **Step 4: Run the tests**

Run: `node --test src/kernel/run-snapshot.test.ts` then `npm test` Expected:
PASS.

- [ ] **Step 5: Commit**

```bash
git add src/kernel
git commit -m "feat(kernel): publish in-memory run snapshots"
```

### Task 5: `pi-subagents` client and worker launcher

**Files:**

- Create: `src/console/subagents-client.ts`
- Create: `src/console/worker-launcher.ts`
- Create: `test-support/fake-subagents.ts`
- Test: `src/console/subagents-client.test.ts`,
  `src/console/worker-launcher.test.ts`

**Interfaces:**

- Consumes: `PhaseLaunch`, `PhaseRun` (Task 1), `parseAgentResult`.
- Produces:

  ```ts
  // src/console/subagents-client.ts
  export const WORKER_AGENT = "patchmill-implementation";
  export const REPLY_TIMEOUT_MS = 10_000;
  export type EventBus = {
    on(event: string, handler: (data: unknown) => void): (() => void) | void;
    emit(event: string, data: unknown): void;
  };
  export type WorkerCompletion = {
    id: string;
    state: string;
    timedOut: boolean;
    stopped: boolean;
    output?: string;
    sessionFile?: string;
  };
  export class SubagentsRpcError extends Error {
    code: string;
  }
  export class SubagentsClient {
    constructor(events: EventBus, options?: { replyTimeoutMs?: number });
    request<T>(method: string, params?: unknown): Promise<T>;
    spawnWorker(input: {
      task: string;
      cwd: string;
      timeoutMs: number;
      output: string;
    }): Promise<string>;
    waitForCompletion(
      id: string,
      signal?: AbortSignal,
    ): Promise<WorkerCompletion>;
    resume(id: string, message: string): Promise<string>;
    stop(id: string): Promise<void>;
    activeWorkers(): Promise<{ id: string; state: string }[]>;
    dispose(): void;
  }

  // src/console/worker-launcher.ts
  export type WorkerLauncher = {
    run(launch: PhaseLaunch): Promise<PhaseRun>;
    resume(launch: PhaseLaunch, guidance: string): Promise<PhaseRun>;
    /** The running worker, for status and shutdown. */
    active(): { id: string; state: string } | undefined;
    stopActive(): Promise<void>;
  };
  export function createWorkerLauncher(client: SubagentsClient): WorkerLauncher;
  ```

Protocol facts, checked against `pi-subagents` 0.80.0 (`src/extension/rpc.js`,
`src/runs/background/result-watcher.js`, `subagent-runner.js`):

- Request on `subagents:rpc:v1:request` with
  `{ version: 1, requestId, method, params, source: { extension: "patchmill" } }`.
  Reply on `subagents:rpc:v1:reply:<requestId>`: `{ success: true, data }` or
  `{ success: false, error: { code, message } }`.
- `spawn` params:
  `{ agent: WORKER_AGENT, task, context: "fork", cwd, output, maxRuntimeMs: timeoutMs }`.
  The run ID is `data.details.asyncId`.
- Completion arrives on `subagent:async-complete` with `id`, `runId`, `state`,
  `timedOut?`, `stopped?`, and `results[0].output` and `results[0].sessionFile`.
  The client listens from construction and buffers completions by ID, so a
  completion that beats the `spawn` reply is not lost.
- `status` with no params returns `data.asyncSnapshot.runs[]`. Each node has
  `id`, `state`, and step `children[]` with `agent`. `activeWorkers` returns
  runs whose state is `running`, `queued`, or `stopping` and that have a step
  with `agent === WORKER_AGENT`.
- `stop` takes `{ id }`. `resume` takes `{ id, message }` and returns the new
  run ID in `data.details.asyncId`.
- Before the first request, wait for readiness: send `ping` every 250 ms until
  one replies, up to `REPLY_TIMEOUT_MS`.

Worker launcher behavior:

- `run` spawns with `output: join(launch.sessionDir, "output.md")` and
  `task: launch.envelope`. It waits for completion. It reads the output file,
  falling back to `completion.output`, writes the same text to `launch.logPath`,
  copies `completion.sessionFile` into `launch.sessionDir`, and returns
  `{ result: parseAgentResult(text), session: { exitCode: state === "complete" ? 0 : 1, timedOut, aborted: stopped } }`.
- `launch.signal` abort calls `stop(id)`, then waits for the completion.
- `resume` does the same through `client.resume(previousId, guidance)`.
- A `SubagentsRpcError` or reply timeout resolves to
  `{ result: { ok: false, reason: "pi-subagents: <message>" }, session: { exitCode: null, timedOut: false, aborted: false } }`,
  so `verifyOutcome` stops with that reason.

- [ ] **Step 1: Write the failing tests**

```ts
test("spawn sends a forked worker and returns the async id", async () => {
  const bus = fakeSubagents();
  const id = await new SubagentsClient(bus).spawnWorker({
    task: "envelope",
    cwd: "/w",
    timeoutMs: 60_000,
    output: "/r/output.md",
  });
  assert.equal(id, "run-1");
  assert.deepEqual(bus.requests.at(-1)!.params, {
    agent: "patchmill-implementation",
    task: "envelope",
    context: "fork",
    cwd: "/w",
    output: "/r/output.md",
    maxRuntimeMs: 60_000,
  });
});
test("a completion that arrives before the spawn reply is still delivered", ...);
test("an RPC error reply rejects with SubagentsRpcError and its code", ...);
test("no reply within the timeout rejects", async () => {
  const client = new SubagentsClient(silentBus(), { replyTimeoutMs: 50 });
  await assert.rejects(client.request("status"), /did not reply/);
});
test("activeWorkers lists only running Patchmill workers", ...);

test("the worker launcher parses the saved output and copies the session file", async (t) => {
  // fake completion: state complete, sessionFile in a temp dir, output.md holds a done JSON block
  const run = await createWorkerLauncher(client).run(launch);
  assert.deepEqual(run.result, { ok: true, result: done });
  assert.equal(run.session.exitCode, 0);
  assert.ok(fs.existsSync(join(launch.sessionDir, "worker.jsonl")));
});
test("output without a JSON block gives the same parse failure as pi -p", ...);
// run.result deepEqual { ok: false, reason: "no result" }
test("abort stops the worker and reports aborted", ...);
test("an unanswered spawn becomes a pi-subagents failure, not a hang", ...);
```

`fakeSubagents()` is an `EventBus` that answers `ping`, `spawn`, `status`,
`stop`, and `resume` from a scripted table, records requests, and exposes
`complete(id, payload)` to emit `subagent:async-complete`.

- [ ] **Step 2: Run them to see them fail**

Run: `node --test src/console/*.test.ts` Expected: FAIL (modules missing).

- [ ] **Step 3: Implement the client and launcher**

- [ ] **Step 4: Check the protocol facts against the installed package**

Run:
`grep -n "asyncId\|subagent:async-complete" node_modules/pi-subagents/src/extension/rpc.js node_modules/pi-subagents/src/shared/types.js`
Expected: both names present. If a field differs, fix the client and the fake
together.

- [ ] **Step 5: Run the tests**

Run: `node --test src/console/*.test.ts` then `npm test` Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/console test-support
git commit -m "feat(console): start implementation workers through pi-subagents RPC"
```

### Task 6: Stray workers

**Files:**

- Create: `src/console/stray-workers.ts`
- Test: `src/console/stray-workers.test.ts`

**Interfaces:**

- Consumes: `SubagentsClient.activeWorkers`, `stop` (Task 5).
- Produces:

  ```ts
  export const STOP_WAIT_MS = 60_000;
  export type StopResult =
    | { ok: true; stopped: string[] }
    | { ok: false; stuck: string[] };
  /** Stops the given worker IDs, or every active Patchmill worker when `ids`
   * is omitted, and waits until none of them is active. */
  export async function stopWorkers(
    client: SubagentsClient,
    options?: { ids?: string[]; waitMs?: number; pollMs?: number },
  ): Promise<StopResult>;
  ```

- [ ] **Step 1: Write the failing tests**

```ts
test("stops every running Patchmill worker and waits for it to leave", async () => {
  // status shows run-1 running, then stopped after the stop request
  assert.deepEqual(await stopWorkers(client, { pollMs: 5 }), {
    ok: true,
    stopped: ["run-1"],
  });
  assert.deepEqual(bus.methods(), ["ping", "status", "stop", "status"]);
});
test("ignores other agents' runs", ...);
test("reports a worker that is still running after the wait", async () => {
  assert.deepEqual(await stopWorkers(client, { waitMs: 20, pollMs: 5 }), {
    ok: false,
    stuck: ["run-1"],
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `node --test src/console/stray-workers.test.ts` Expected: FAIL.

- [ ] **Step 3: Implement `stopWorkers`**

- [ ] **Step 4: Run the tests**

Run: `node --test src/console/stray-workers.test.ts` Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/console
git commit -m "feat(console): stop stray implementation workers"
```

### Task 7: Console controller and Patchmill extension

**Files:**

- Create: `src/console/controller.ts`
- Create: `src/console/extension.ts`
- Create: `src/console/tools.ts`
- Create: `test-support/fake-extension-api.ts`
- Test: `src/console/controller.test.ts`, `src/console/extension.test.ts`

**Interfaces:**

- Consumes: `HumanChannel`, `Wait`, `BlockAnswer` (Task 2), `RunSnapshot` (Task
  4), `WorkerLauncher` (Task 5), `stopWorkers` (Task 6), `runOneIssue`.
- Produces:

  ```ts
  // src/console/controller.ts
  export type StartRun = (
    issue: number,
    channel: HumanChannel,
    observe: (s: RunSnapshot) => void,
  ) => Promise<RunOnceOutcome>;
  export type ConsoleStatus = {
    snapshot?: RunSnapshot;
    worker?: { id: string; state: string };
    waiting?: Wait;
    estimatedCost?: string;
  };
  export class ConsoleController implements HumanChannel {
    constructor(deps: {
      pi: Pick<ExtensionAPI, "sendUserMessage" | "sendMessage">;
      workers: WorkerLauncher;
      startRun: StartRun;
    });
    startIssueRun(issue: number): Promise<string>;
    submitPlanning(result: AgentResult): Promise<string>;
    continueRun(): Promise<string>;
    confirmGuidance(text: string): Promise<string>; // wired in Task 9
    status(): ConsoleStatus;
    shutdown(): Promise<void>;
  }

  // src/console/extension.ts
  export function createPatchmillExtension(options: {
    firstIssue: number;
    startRun: StartRun;
    client?: (events: EventBus) => SubagentsClient; // test seam
  }): ExtensionFactory;
  ```

Controller behavior:

- `startIssueRun` rejects with "An Issue run is already active." when one runs.
  Otherwise it calls `startRun` without awaiting and keeps the promise. On
  settle it clears the active run. `runOneIssue` already prints the outcome
  through `output`, so the controller notifies only a thrown error.
- `runPlanning(launch, feedback)` sends the envelope with
  `pi.sendUserMessage(text, { deliverAs: "followUp" })`. With feedback it sends
  `"Patchmill could not accept the planning result:\n\n${feedback}\n\nFix it and submit again."`
  It resolves when `submitPlanning` is called, with
  `{ result: { ok: true, result }, session: { exitCode: 0, timedOut: false, aborted: false } }`,
  or with `aborted: true` on `shutdown`.
- `runImplementation` and `resumeImplementation` delegate to `workers`.
- `awaitContinue(wait)` stores `wait` and sends its message with
  `pi.sendMessage({ customType: "patchmill", content, display: true }, { triggerTurn: true })`.
  It resolves on `continueRun` or with `quit` on `shutdown`.
- `continueRun` returns "No Issue run is waiting for a merge." when nothing
  waits, including while a worker runs. Otherwise it resolves the wait, then
  returns the next thing the run does: the next wait's message,
  `"The Issue run continues with ${phase}."`, or the end summary.
- `submitPlanning` returns "Patchmill is not waiting for a planning result."
  when no planning call is pending.
- `notify` sends a display-only custom message (`triggerTurn: false`).
- `shutdown` resolves pending planning, waits, and guidance with quit, calls
  `workers.stopActive()`, then awaits the run promise.

Extension behavior:

- Registers the five tools from `src/console/tools.ts` (`typebox` schemas).
  `patchmill_confirm_block_guidance` returns "No worker is blocked." until
  Task 9.
- `patchmill_submit_planning_result` takes `{ status, summary }` with `status`
  in `done | needs-input | failed`. It asks
  `ctx.ui.confirm("Accept planning result?", summary)` and returns "Not
  submitted." on no.
- `patchmill_start_issue_run` takes `{ issue }` and asks
  `ctx.ui.confirm("Start Issue run?", "Claim issue #<n> on the host")`.
- `patchmill_continue_issue_run` takes no input and asks for no confirmation.
- `patchmill_run_status` returns `JSON.stringify(controller.status(), null, 2)`.
- On `session_start`: create the client and controller, run `stopWorkers`. If it
  returns `ok: false`, notify
  `"Worker ${ids} did not stop. Patchmill will not start the Issue run."` and
  stop. Otherwise call `controller.startIssueRun(firstIssue)` without a
  confirmation.
- On `session_shutdown`: `await controller.shutdown()`. Keep it idempotent.

- [ ] **Step 1: Write the failing tests**

```ts
test("the first Issue run starts after stray workers are stopped", async () => {
  const api = fakeExtensionApi();
  const started: number[] = [];
  await createPatchmillExtension({ firstIssue: 9, startRun: async (n) => { started.push(n); return pending; }, client })(api);
  await api.fire("session_start");
  assert.deepEqual(bus.methods().slice(0, 2), ["ping", "status"]);
  assert.deepEqual(started, [9]);
});
test("a stuck stray worker blocks the start and says why", ...);
test("planning sends the envelope and resolves on a confirmed submit", async () => {
  const pending = controller.runPlanning(launch);
  assert.equal(api.userMessages.at(-1)!.text, launch.envelope);
  await api.callTool("patchmill_submit_planning_result", { status: "done", summary: "ok" }, { confirm: true });
  assert.deepEqual((await pending).result, { ok: true, result: { status: "done", summary: "ok" } });
});
test("a declined submit leaves planning pending", ...);
test("continue with nothing waiting changes nothing", async () => {
  assert.equal(await api.callTool("patchmill_continue_issue_run", {}), "No Issue run is waiting for a merge.");
});
test("continue reports the next wait message when the PR is still open", ...);
test("starting a second run while one is active is refused", ...);
test("shutdown during planning resolves it as aborted and stops the worker", async () => {
  const pending = controller.runPlanning(launch);
  await api.fire("session_shutdown");
  assert.equal((await pending).session.aborted, true);
  assert.equal(workers.stopCalls, 1);
});
test("status combines the snapshot, worker, and wait", ...);
```

`fakeExtensionApi()` records `registerTool`, `on`, `sendUserMessage`, and
`sendMessage`, exposes an in-memory `events` bus, `fire(event)`, and
`callTool(name, params, { confirm })`, where `confirm` is the value
`ctx.ui.confirm` resolves to.

- [ ] **Step 2: Run them to see them fail**

Run: `node --test src/console/controller.test.ts src/console/extension.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement the controller, tools, and extension**

- [ ] **Step 4: Run the tests**

Run: `node --test src/console/*.test.ts` then `npm test` Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/console test-support
git commit -m "feat(console): add the Patchmill console extension and tools"
```

### Task 8: Interactive envelope, console startup, and CLI flag

**Files:**

- Modify: `src/kernel/run-envelope.md`, `src/kernel/envelope.ts`
- Modify: `src/kernel/run-once.ts` (pass `interactive` to the envelope)
- Modify: `src/cli/commands/init/agent-dir.ts` (worker agent)
- Create: `src/console/start.ts`
- Modify: `src/cli/commands/run-once/main.ts`
- Test: `src/kernel/envelope.test.ts`,
  `src/cli/commands/init/agent-dir.test.ts`,
  `src/cli/commands/run-once/main.test.ts`

**Interfaces:**

- Produces:

  ```ts
  // src/kernel/envelope.ts
  export type RunEnvelopeInput = {
    /* existing */ interactive?: boolean;
  };

  // src/cli/commands/init/agent-dir.ts
  export const IMPLEMENTATION_AGENT: string; // agents/patchmill-implementation.md

  // src/console/start.ts
  export async function startConsole(input: {
    config: PatchmillConfig;
    deps: RunOnceDeps;
    issue: number;
  }): Promise<number>;
  ```

Envelope: add two placeholders, `{{humanRules}}` and `{{resultRules}}`. For
non-interactive runs and for implementation, they render the current text. For
interactive planning only:

- `humanRules`: "A maintainer is present in this chat. Ask them your questions
  here and wait for their answers. Do not return `needs-input` for questions."
- `resultRules`: "When the maintainer agrees and your work is committed and
  pushed, call `patchmill_submit_planning_result` with `status` and `summary`.
  Do not end with a JSON block."

The rendered non-interactive envelope must stay byte-identical to today's.

`IMPLEMENTATION_AGENT`:

```markdown
---
name: patchmill-implementation
description: Patchmill implementation worker for one issue
tools: read, grep, find, ls, bash, edit, write, subagent
---

Follow the Patchmill envelope in your task. It defines the work, the rules, and
the final JSON result. The conversation before it is context only.
```

`provisionAgentDir` writes it next to `reviewer.md` in the same idempotent way.

`startConsole`:

1. `provisionAgentDir(repoRoot, config.pi.agentDir)`.
2. Set `process.env.PI_CODING_AGENT_DIR` to the resolved `pi.agentDir`.
3. `SessionManager.continueRecent(repoRoot, <runsDir>/console/sessions)`.
4. `createAgentSessionRuntime` with `createAgentSessionServices`, passing
   `resourceLoaderOptions`: `additionalExtensionPaths` =
   `[resolvePiSubagentsPackageRoot()]`, `extensionFactories` =
   `[{ name: "patchmill", factory: createPatchmillExtension({ firstIssue, startRun }) }]`,
   `additionalSkillPaths` = the resolved `config.skills.planning` and
   `config.skills.implementation`.
5. `startRun` calls
   `runOneIssue(config, { ...deps, human, observe, output }, { issue })`, where
   `output` sends lines through `human.notify`.
6. `new InteractiveMode(runtime).run()`, then `runtime.dispose()`. Return 0.

CLI: `--interactive` requires `--issue` ("Use --interactive with --issue N.")
and rejects `--dry-run` and `--plan-only` ("--interactive cannot be combined
with --dry-run or --plan-only."). `main` calls
`(options.startConsole ?? startConsole)(...)` instead of `runOneIssue`.

- [ ] **Step 1: Write the failing tests**

```ts
// envelope.test.ts
test("the non-interactive envelope is unchanged", ...); // snapshot of today's output
test("interactive planning asks the maintainer and submits through the tool", () => {
  const text = renderRunEnvelope({ ...input, phase: "planning", interactive: true });
  assert.match(text, /patchmill_submit_planning_result/);
  assert.doesNotMatch(text, /final `json` block/);
});
test("interactive implementation keeps the JSON result contract", ...);
test("the envelope template stays under 150 lines", ...); // only if no such test exists

// agent-dir.test.ts
test("provisioning writes the implementation worker with the subagent tool", ...);

// main.test.ts
test("--interactive without --issue fails before loading configuration", ...);
test("--interactive with --dry-run or --plan-only fails", ...);
test("--interactive hands the issue and real dependencies to the console", ...);
```

- [ ] **Step 2: Run them to see them fail**

Run:
`node --test src/kernel/envelope.test.ts src/cli/commands/init/agent-dir.test.ts src/cli/commands/run-once/main.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement the envelope switches, agent file, `startConsole`, and
      flag**

- [ ] **Step 4: Run the tests and lint**

Run: `npm test && npm run lint` Expected: PASS.

- [ ] **Step 5: Smoke-test startup**

Run:
`HOME=$(mktemp -d) node bin/patchmill.ts run-once --issue 1 --interactive </dev/null`
in a scratch clone with a `patchmill.config.json`. Expected: the process fails
only at the provider or credential stage, or opens the chat. Any
`Failed to load extension`, `No such built-in module`, or `Cannot find package`
error is a defect.

- [ ] **Step 6: Commit**

```bash
git add src bin
git commit -m "feat(cli): open interactive Issue runs with run-once --interactive"
```

### Task 9: Unblock in place (slice 2)

**Files:**

- Modify: `src/kernel/interactive-loop.ts`, `src/kernel/run-once.ts`
- Modify: `src/console/controller.ts`, `src/console/tools.ts`
- Test: `src/kernel/interactive-block.test.ts`, `src/console/controller.test.ts`

**Interfaces:**

- Consumes: `HumanChannel.awaitGuidance`, `resumeImplementation` (Task 2),
  `WorkerLauncher.resume` (Task 5).
- Produces: `ConsoleController.confirmGuidance(text): Promise<string>`, and
  `export function guidanceComment(text: string): string` in
  `src/kernel/comments.ts`, returning
  `[KERNEL_COMMENT, "Maintainer guidance from the console:", text].join("\n\n")`.

Kernel behavior with a channel: an implementation verification stop whose
`result` is `ok` with status `needs-input` (not aborted, not timed out) does not
publish. The snapshot state becomes `blocked`. Call
`awaitGuidance(result.summary)`:

- `guidance`: post `guidanceComment(text)` with `host.commentIssue` (D3), reset
  `sinceHuman`, and call `resumeImplementation(launch, text)` with a new
  `sessionNumber`. Verify the result as usual.
- `quit`: publish the original `needsInfo` stop as today.

Without a channel, a `needs-input` result still publishes and ends.

Controller: `awaitGuidance` sends the summary with `triggerTurn: true` so the
agent explains it. `patchmill_confirm_block_guidance` takes `{ guidance }`, asks
`ctx.ui.confirm("Send guidance to the worker?", guidance)`, and resolves the
pending block. With no pending block it returns "No worker is blocked."

- [ ] **Step 1: Write the failing tests**

```ts
test("a blocked worker gets confirmed guidance and continues in the same attempt", async (t) => {
  // steps: planning done; implementation needs-input; resumed implementation opens Closes PR
  const human = fakeHuman(c, {
    onGuidance: async () => ({ kind: "guidance", text: "Use OAuth" }),
    onWait: async () => "quit",
  });
  await c.run({ issue: 9 }, { human });
  assert.ok(human.calls.includes("resume:Use OAuth"));
  const bodies = c.host.state().issues[0]!.comments.map((x) => x.body);
  assert.match(bodies[0]!, /Maintainer guidance from the console:\n\nUse OAuth/);
  assert.match(bodies[1]!, /pull request was verified/);
  assert.equal((await c.records()).result.sessions.length, 3);
});
test("quitting while blocked publishes the needs-info stop", ...);
test("a non-interactive needs-input result still posts and exits", ...);

// controller.test.ts
test("confirm guidance with no block changes nothing", ...);
test("confirmed guidance resolves the pending block", ...);
```

- [ ] **Step 2: Run them to see them fail**

Run:
`node --test src/kernel/interactive-block.test.ts src/console/controller.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

- [ ] **Step 4: Run the tests**

Run: `npm test` Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src
git commit -m "feat(console): unblock implementation workers in place"
```

### Task 10: Another issue in the same session (slice 3)

**Files:**

- Modify: `src/console/controller.ts` (only if the tests expose a gap)
- Test: `src/console/controller.test.ts`

The start tool already exists (Task 7). This task proves the session survives an
ended Issue run.

- [ ] **Step 1: Write the failing tests**

```ts
test("after an Issue run ends, the start tool runs a second issue", async () => {
  await controller.startIssueRun(9);
  finish(9, { status: "completed", issue: 9 });
  await settled();
  assert.match(
    await api.callTool("patchmill_start_issue_run", { issue: 10 }, { confirm: true }),
    /#10/,
  );
  assert.deepEqual(started, [9, 10]);
});
test("a declined start claims nothing", ...);
```

- [ ] **Step 2: Run them**

Run: `node --test src/console/controller.test.ts` Expected: FAIL if the
controller keeps the ended run as active, otherwise PASS. Fix only a real
failure.

- [ ] **Step 3: Commit**

```bash
git add src/console
git commit -m "test(console): start another Issue run from the same session"
```

### Task 11: Glossary, docs, and end-to-end check

**Files:**

- Modify: `CONTEXT.md`
- Modify: `README.md` (run-once usage)
- Modify: `CHANGELOG.md` if the repo's release flow expects an entry

Testing Value Gate: documentation only, so no new tests. Verify with lint and a
manual run.

- [ ] **Step 1: Add the glossary terms**

Add to `CONTEXT.md`, next to **Issue run** and **Run attempt**:

- **Interactive Issue run**: An Issue run that takes human input through a
  console instead of issue comments. It uses the same Run-once workflow.
- **Console session**: The Pi session that holds the maintainer's conversation
  for one or more interactive Issue runs. It never decides a phase.
- **Console agent**: The agent in the Console session. It plans with the
  maintainer and calls Patchmill tools, but never chooses a phase.
- **Review wait**: The part of an interactive Issue run after the implementation
  pull request is verified and labeled `agent-done`, and before it is merged.

- [ ] **Step 2: Document `--interactive` in `README.md`**

One short section: the command, that it needs `--issue`, the five tools, and
that quitting stops the worker.

- [ ] **Step 3: Run the full checks**

Run: `npm run lint && npm test && npm run build` Expected: PASS.

- [ ] **Step 4: Manual end-to-end run**

On the test repository (`patchmill setup-test-repo`), run one interactive Issue
run from spec to a merged implementation pull request. Check:

- the chat opens and planning runs in it;
- a declined submit keeps planning open;
- implementation runs in the background and `patchmill_run_status` answers while
  it works;
- the issue gets `agent-done` when the PR is verified, and the run stays open;
- a review fix pushed from the chat posts no comment;
- after the merge, the continue tool ends the run with no second comment;
- killing the process during implementation, then rerunning, stops the stray
  worker before a new one starts.

- [ ] **Step 5: Commit**

```bash
git add CONTEXT.md README.md CHANGELOG.md
git commit -m "docs: describe interactive Issue runs"
```

## Self-review notes

- **Spec coverage.** D1: Tasks 2, 5, 7, 8. D2: Task 8 (`continueRecent`). D3 and
  D4: Task 9. D5 and D6: Task 3. D7: Tasks 6 and 7. Planning in conversation
  with confirmed results and feedback: Tasks 2 and 7. Status snapshot: Tasks 4
  and 7. Session limit since human input: Task 2. Slices 1–3: Tasks 1–10.
  Glossary impact: Task 11. Slice 4 is out of scope by choice.
- **Verification list in the spec.** Each item maps to a named test in Tasks 2,
  3, 5, 6, 7, and 9, except the TUI itself, which the spec excludes, and the
  manual run in Task 11.
