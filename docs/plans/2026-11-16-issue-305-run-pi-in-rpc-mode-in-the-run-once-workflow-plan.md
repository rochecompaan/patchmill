# Run Pi in RPC Mode in the Run-once Workflow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use the sibling `executing-plans`
> skill to implement this plan inline, task by task. Steps use checkbox
> (`- [ ]`) syntax for tracking.

**Goal:** Run-once phase sessions run `pi --mode rpc` through a small Patchmill
RPC client, with the same results, logs, and failure handling as `pi -p`.

**Architecture:** A new deep module, `src/kernel/pi-rpc.ts`, takes the same
`PiSessionOptions` and returns the same `PiSession` as `supervisePi`. It hides
the JSONL protocol, dialog answers, the finish rule, exit-code parity, logs, and
process-group shutdown. A small background-work extension,
`src/pi/background-work-extension.ts`, reads `pi-subagents`' own liveness check
through the v1 session-liveness registry, reports it at each `agent_settled`,
and stops active runs at shutdown. `printModeLauncher` becomes
`rpcModeLauncher`, which loads the extension first. Triage and the doctor smoke
check keep print mode.

**Tech Stack:** TypeScript on Node (type stripping), `node:test`, Pi 1.5.2 RPC
mode, `pi-subagents` 0.80.0 in-process RPC.

**Spec:**
[docs/specs/2026-11-16-issue-305-run-pi-in-rpc-mode-in-the-run-once-workflow-design.md](../specs/2026-11-16-issue-305-run-pi-in-rpc-mode-in-the-run-once-workflow-design.md).
Parent spec: `docs/specs/2026-10-14-issue-225-interactive-issue-runs-design.md`
on `origin/main` (read-only). The spec has no mockup. Frontend design does not
apply. The spec and this plan explain themselves with inline Mermaid; there is
no HTML companion.

## Global Constraints

- Pi argv for a phase:
  `--mode rpc --session-dir <dir> [--skill <path>] -e <background-work extension> -e <ext>...`.
  The background-work extension is first. No `@<prompt>` argument.
- Prompt text, exactly as print mode builds it:
  `` `<file name="${absolutePromptPath}">\n${stripBom(contents)}\n</file>\n` ``,
  sent in one `prompt` command.
- `PiSessionOptions` and `PiSession` do not change. `stdout` holds the final
  assistant text that `parseAgentResult` reads. Build it from the last
  `message_end` message as print mode does: each text block followed by `\n`. Do
  not use `get_last_assistant_text`.
- Status key: `patchmill-background-work`. Value: `"<settle>:<count>"`, where
  `<settle>` is the 1-based `agent_settled` number in the process.
- Reports can arrive before or after their `agent_settled` (real Pi sends the
  report first). The client keeps reports by settle number.
- Report wait: 15 s after each `agent_settled`, then count `0` with a log
  warning.
- Liveness registry:
  `globalThis[Symbol.for("@agegr/pi-web/session-liveness/v1")]`, shape
  `{ version: 1, register({ name, sessionId, sessionFile?, isActive }) → release }`.
  Count is `1` when any live registration for the current session ID returns
  `true` from `isActive()`, else `0`.
- Shutdown stops: at most 3 s in total, only when the count is still `1`.
- Dialog answer: `{"type":"extension_ui_response","id":<id>,"cancelled":true}`
  for `select`, `confirm`, `input`, and `editor`.
- Exit-code parity with print mode: last assistant `stopReason` `error` or
  `aborted` → `stdout` `""`, log `errorMessage` (or `Request <stopReason>`),
  `exitCode` `1`. `length` → `stdout` is the text, log
  `Response was truncated: the model reached its output token limit.`,
  `exitCode` `1`. A non-zero exit or a signal from Pi always wins.
- Abort and timeout: send `abort`, wait at most `graceMs` for its response,
  close stdin, wait at most `graceMs` for exit, then `SIGTERM` the process group
  and `SIGKILL` after `graceMs`.
- JSONL framing: split stdout only on `\n`, strip one trailing `\r`. Do not use
  `node:readline`.
- No npm dependency changes. If any occur, rerun the Nix build.
- Triage, the doctor smoke check, and `src/cli/commands/auth/pi-smoke-test.ts`
  keep `-p`.

## Review Focus

1. **Pi dies while a command is outstanding.** `get_last_assistant_text` or
   `abort` gets no response because Pi exited. Expect: `done` resolves from the
   process exit, never hangs. Test in Task 1 (`crash before settle`).
2. **Writes to stdin after Pi exits.** An `EPIPE` on stdin must not throw out of
   `done` or crash Patchmill. Test in Task 1 (`abort after exit`).
3. **A stdout record split across chunks, or one with U+2028 in a string.**
   Expect: one record, parsed once. Test in Task 1 (`framing`).
4. **The background-work extension does not load.** No report arrives. Expect:
   the session ends 15 s after settle with a warning in the log, not at the
   phase timeout. Test in Task 1 (`missing report`), with the report wait
   injectable as an internal option.
5. **A background run finishes after a settle reported 1.** Its delivery turn
   ends with a new settle that reports 0. Expect: `stdout` is the text of that
   later turn. Test in Task 1 (`background work`) and the liveness rules in
   Task 2.
6. **Report and settle order.** Real Pi sends the report before `agent_settled`.
   Expect: no 15 s wait in either order. Test in Task 1 (`report order`).
7. **Prompt parity.** Expect: the fake receives the exact print-mode wrapped
   text. Test in Task 1 (`prompt text`).

---

## File structure

```text
src/kernel/
├── pi-rpc.ts               # new: RPC phase session (process, finish rule, logs)
├── pi-rpc-protocol.ts      # new: JSONL framing and record types
├── pi-rpc.test.ts          # new: runner against the fake RPC Pi
├── pi-supervisor.ts        # export signalGroup only
├── launch.ts               # printModeLauncher -> rpcModeLauncher
└── interactive-loop.ts     # uses rpcModeLauncher
src/pi/background-work-extension.ts       # new: liveness report + shutdown stops
src/pi/background-work-extension.test.ts
src/console/subagents-client.ts   # add activeRuns()
test-support/fake-pi.mjs          # learns --mode rpc
test-support/fake-human.ts        # uses rpcModeLauncher
docs/mockups/web/run-once-workflow.md  # answers to the two questions
```

---

### Task 1: RPC phase session and fake RPC Pi

**Files:**

- Create: `src/kernel/pi-rpc-protocol.ts`, `src/kernel/pi-rpc.ts`,
  `src/kernel/pi-rpc.test.ts`
- Modify: `src/kernel/pi-supervisor.ts` (export `signalGroup`),
  `test-support/fake-pi.mjs`

**Interfaces:**

- Consumes: `PiSessionOptions`, `PiSession`, `signalGroup` from
  `pi-supervisor.ts`; `piCommandArgs` from `src/cli/pi-cli.ts`.
- Produces:

  ```ts
  // pi-rpc-protocol.ts
  export function jsonlRecords(
    onRecord: (record: unknown) => void,
    onText: (line: string) => void,
  ): (chunk: string) => void; // per-chunk feeder
  export const BACKGROUND_WORK_STATUS = "patchmill-background-work";
  export function parseBackgroundReport(
    text: string,
  ): { settle: number; count: number } | undefined;
  // pi-rpc.ts
  export type PiRpcSession = {
    steer(message: string): Promise<void>;
    followUp(message: string): Promise<void>;
    abort(): Promise<void>;
    done: Promise<PiSession>;
  };
  export function piRpcArgs(options: PiSessionOptions): string[];
  export function startPiRpc(
    options: PiSessionOptions & { reportWaitMs?: number },
  ): PiRpcSession;
  export function runPiRpc(options: PiSessionOptions): Promise<PiSession>;
  ```

  `reportWaitMs` defaults to `15_000` and exists so tests can shorten it.
  `abort()` acts like the `AbortSignal`: it sets `aborted`.

**Fake RPC Pi.** When `process.argv` contains `--mode rpc`, `fake-pi.mjs` keeps
all current step side effects (session file, `writeFiles`, `commit`, `push`,
`pullRequest`, `issuePatch`, `stderr`, `ignoreSigterm`) and changes only how it
talks:

0. Write `process.pid` to `${script}.pid`, so tests can check the group.
1. Read JSONL commands from stdin. Answer `abort`, `steer`, `follow_up`, and
   `get_last_assistant_text` (with `data: { text }`) with `success: true`.
   Append each received command as one JSON line to `${script}.commands.log`.
2. On `prompt`, answer `{disposition:"started"}`, run side effects, then emit a
   `message_end` with an assistant message. Its text is the `stdout` lines, the
   `printEnv` lines, and the fenced result block, joined with `\n`. Its
   `stopReason` is `step.stopReason ?? "stop"`, with `step.errorMessage`.
3. If `step.dialog` is set (`"select"` etc.), emit one `extension_ui_request`
   with that method, wait for the response, and append `dialog:<json response>`
   to the text before the `message_end`.
4. Sleep `sleepMs`. If `exitCode` is non-zero, exit with it now (crash before
   settle).
5. For each entry of `step.backgroundCounts ?? [0]` (index `i`): unless
   `step.noReport`, emit a `setStatus` request with
   `statusKey: "patchmill-background-work"` and `statusText: "<i+1>:<count>"`;
   then emit `agent_settled`. With `step.reportAfterSettle`, swap the two. If
   the count is above 0, wait 50 ms and emit another assistant `message_end`
   with text `background turn <i+2>` before the next settle.
6. On stdin end, exit 0 unless `ignoreSigterm`.

Print mode in the fake is unchanged.

- [ ] **Step 1: Write the failing tests** in `src/kernel/pi-rpc.test.ts`, with a
      `fake(t, steps)` helper like the one in `pi-supervisor.test.ts`:
  - `piRpcArgs` returns exactly
    `["--mode","rpc","--session-dir","/s","--skill","/k","-e","/one","-e","/two"]`
    for the same input as the existing `piArgs` test, and omits `--skill` when
    there is no skill.
  - `normal result`: step `{stdout:"ok", stderr:"warning", result:done}` →
    `exitCode 0`, `signal null`, `parseAgentResult(stdout)` deep-equals
    `{ ok: true, result: done }`, log contains `ok`, `warning`, and the result
    JSON.
  - `prompt text`: a prompt file with a BOM and `hello` → the first line of
    `${script}.commands.log` is a `prompt` command whose `message` is exactly
    `<file name="<abs path>">\nhello\n</file>\n`.
  - `report order`: `reportAfterSettle` `false` and `true`, with
    `reportWaitMs: 60_000` → each session ends in under 5 s.
  - `pi error`: step
    `{stopReason:"error", errorMessage:"overloaded", stdout:"x"}` → `stdout ""`,
    `exitCode 1`, log contains `overloaded`.
  - `truncated`: `stopReason:"length"` → `stdout` contains the text,
    `exitCode 1`, log contains `Response was truncated`.
  - `dialog`: for each of `select`, `confirm`, `input`, `editor`, `stdout`
    contains
    `dialog:{"type":"extension_ui_response","id":"<id>","cancelled":true}`
    (match on `"cancelled":true`).
  - `crash before settle`: `{result:done, exitCode:7}` → `exitCode 7`,
    `parseAgentResult(stdout).ok` is `true`, and `done` resolves.
  - `abort`: `{result:done, sleepMs:5000}`, abort the signal after the result is
    in the log → `aborted true`; `signalGroup(pid, 0)` is `false` after `done`
    (no process left). Read the pid from `${script}.pid`.
  - `abort after exit`: call `session.abort()` after `done` resolved → no throw.
  - `timeout` for `ignoreSigterm` `false` and `true` → `timedOut true`, `signal`
    `SIGTERM` or `SIGKILL`.
  - `background work`: `backgroundCounts:[1,0]` → `stdout` is
    `background turn 2`.
  - `missing report`: `noReport:true`, `reportWaitMs:100` → session ends,
    `exitCode 0`, log contains `background-work report`.
  - `framing`: feed `jsonlRecords` the chunks `'{"a":"x y"}\r'` and
    `'\n{"b":1}\nnot json\n'` → records `[{a:"x y"},{b:1}]`, text
    `["not json"]`.
  - `steer and follow_up`: call both before settle on a `sleepMs` step → the
    fake's `${script}.commands.log` holds both commands; after `done`, `steer`
    rejects.
- [ ] **Step 2: Run** `node --test src/kernel/pi-rpc.test.ts`. Expected: FAIL,
      module not found.
- [ ] **Step 3: Implement `jsonlRecords`** in `pi-rpc-protocol.ts`. Non-JSON
      lines go to `onText`. Keep record type unions here.
- [ ] **Step 4: Implement `startPiRpc`** in `pi-rpc.ts`. Spawn as `supervisePi`
      does (`detached`, `PI_CODING_AGENT_DIR`, `stdio: ["pipe","pipe","pipe"]`).
      Log writes, `onOutput`, and sink error handling follow `supervisePi`.
      Assistant `message_end` text and non-JSON stdout lines go to the logs when
      they arrive; stderr as it arrives; `extension_error` as
      `Extension error (<path>): <error>`. Keep the last assistant message for
      parity and the crash fallback. After a normal exit, if
      `signalGroup(pid, 0)` is `true`, run the same `SIGTERM`/`SIGKILL`
      escalation. Catch stdin `error` events.
- [ ] **Step 5: Run**
      `node --test src/kernel/pi-rpc.test.ts src/kernel/pi-supervisor.test.ts`.
      Expected: PASS.
- [ ] **Step 6: Commit**
      `git commit -m "feat(kernel): add Pi RPC phase session client"`.

### Task 2: Background-work extension

**Files:**

- Create: `src/pi/background-work-extension.ts`,
  `src/pi/background-work-extension.test.ts`
- Modify: `src/console/subagents-client.ts`, its test

**Interfaces:**

- Consumes: `SubagentsClient`; `BACKGROUND_WORK_STATUS` from
  `src/kernel/pi-rpc-protocol.ts` (Task 1, constant only). Write the constant
  first if you run this task before Task 1.
- Produces:
  `export default function backgroundWorkExtension(pi: ExtensionAPI): void` and
  `SubagentsClient.activeRuns(): Promise<{ id: string; state: string }[]>`.

Rules (from the spec):

- At load (in the factory, before any `session_start`), read the registry
  symbol. If it is missing, install
  `{ version: 1, register(r) { keep r; return release } }`. If a v1 registry is
  there, replace `register` with a wrapper that keeps `r` and calls the
  original. Any other value: leave it, and report `0`.
- `agent_settled` handler: count = `1` if any kept registration with
  `sessionId === ctx.sessionManager.getSessionId()` returns `true` from
  `isActive()` (a throw counts as `true`), else `0`. Call
  `ctx.ui.setStatus(BACKGROUND_WORK_STATUS, "<n>:<count>")`.
- `session_shutdown` handler: if the count is `1`, call `activeRuns()` and
  `stop(id)` for each, all within 3 s in total, then dispose the client.

- [ ] **Step 1: Write the failing tests** with `fakeExtensionApi`, a fake
      registration, and `fakeSubagents`. Delete the registry symbol in
      `t.after`.
  - `activeRuns` returns runs in `queued`, `running`, and `stopping` for any
    agent; `activeWorkers` still returns only `patchmill-implementation` runs
    (existing test passes).
  - No registration → two settles give `"1:0"` then `"2:0"`.
  - A registration for the session with `isActive` `true`, then `false` →
    `"1:1"`, then `"2:0"`.
  - A registration for another session ID with `isActive` `true` → `"1:0"`.
  - A released registration is ignored.
  - An existing v1 registry: its `register` still gets the registration, and the
    extension still sees it.
  - `isActive` throws → `"1:1"`.
  - `session_shutdown` while active with one running run → one `stop` request
    with that ID. While idle → no `status` request.
  - `session_shutdown` with no `pi-subagents` reply → resolves within 3.5 s.
- [ ] **Step 2: Run**
      `node --test src/pi/background-work-extension.test.ts src/console/subagents-client.test.ts`.
      Expected: FAIL.
- [ ] **Step 3: Implement** `activeRuns()` and make `activeWorkers()` filter it.
      Implement the extension.
- [ ] **Step 4: Run** the same tests. Expected: PASS.
- [ ] **Step 5: Commit**
      `git commit -m "feat(pi): report background subagent work in RPC sessions"`.

### Task 3: Switch run-once phases to RPC mode

**Files:**

- Modify: `src/kernel/launch.ts`, `src/kernel/interactive-loop.ts`,
  `test-support/fake-human.ts`, `src/console/worker-launcher.test.ts`

**Interfaces:**

- Consumes: `runPiRpc` (Task 1), the extension module (Task 2).
- Produces:
  `rpcModeLauncher(options: { command: PiCommandSpec; agentDir: string; extensionPaths: string[] }): PhaseLauncher`
  and `BACKGROUND_WORK_EXTENSION_PATH: string`, the absolute path of
  `src/pi/background-work-extension`, resolved from `import.meta.url`, with the
  same file extension as the running `launch` module (`.ts` from source, `.js`
  from `dist`).

- [ ] **Step 1: Write the failing test** in a new `src/kernel/launch.test.ts`:
      `rpcModeLauncher` with a command that records its argv (a fake RPC Pi step
      with `printEnv` is not enough; use a wrapper that writes `process.argv` to
      a file, then imports `fake-pi.mjs`) passes
      `-e <BACKGROUND_WORK_EXTENSION_PATH> -e <ext1>` in that order, and
      `existsSync(BACKGROUND_WORK_EXTENSION_PATH)` is `true`.
- [ ] **Step 2: Run** `node --test src/kernel/launch.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.** Rename `printModeLauncher` to `rpcModeLauncher`,
      call `runPiRpc`, put the extension path first. Update the three callers.
      In `worker-launcher.test.ts`, rename the test to
      `missing JSON matches rpcModeLauncher parsing ...`; its non-RPC command
      exits before settle, so `stdout` is `""` and the result stays
      `{ ok: false, reason: "no result" }`.
- [ ] **Step 4: Run** `npm test`. Expected: PASS. The run-once suites
      (`run-once*.test.ts`, `planning-gates.test.ts`, `interactive-*.test.ts`,
      `local-*.test.ts`) pass with no edits. If one fails, fix the runner or the
      fake, not the test, unless the test checks Pi arguments.
- [ ] **Step 5: Run** `npm run build`, then confirm that
      `dist/src/pi/background-work-extension.js` (or the build's equivalent
      path) exists.
- [ ] **Step 6: Commit**
      `git commit -m "feat(kernel): run run-once phases in Pi RPC mode"`.

### Task 4: Record the answers and check a real run

**Files:**

- Modify: `docs/mockups/web/run-once-workflow.md`

- [ ] **Step 1:** Replace the "Things to test before live chat" section with
      "Answers from #305": the two answers from the spec (fork, tool list), and
      the `ctx.hasUI` effect on `pi-subagents` with the finish rule. Use simple
      English. Run `npm run lint`.
- [ ] **Step 2: Extension load check.** Start the bundled Pi with
      `--mode rpc --no-session -e <extension path>` and an empty
      `PI_CODING_AGENT_DIR`, send `{"type":"get_state"}`, close stdin. Expected:
      a `get_state` response and no `extension_error` record.
- [ ] **Step 3: Test repository run.** Run `patchmill setup-test-repo`, then one
      `patchmill run-once` on its issue. Compare with a run from `main`: run
      state, progress log, `session-<n>.log`, Pi session files, and result have
      the same shape. The first user message in the Pi session file is the same
      wrapped prompt. Then `pgrep -f "mode rpc"` and `pgrep -f subagent-runner`
      print nothing. Repeat with Ctrl-C during a phase; both `pgrep` calls again
      print nothing.
- [ ] **Step 4: Commit**
      `git commit -m "docs(web): record Pi RPC answers from #305"`.

### Final verification

- [ ] `npm test`, `npm run check:types`, and `npm run lint` pass.
- [ ] The maintainer posts the two answers as an issue comment. Agents do not
      post issue comments.

## Visual explanation

Task order and ownership:

```mermaid
flowchart LR
    T1["Task 1: pi-rpc client + fake RPC Pi"] --> T3["Task 3: rpcModeLauncher switch"]
    T1 -. "BACKGROUND_WORK_STATUS" .-> T2
    T2["Task 2: background-work extension + activeRuns"] --> T3
    T3 --> T4["Task 4: docs, extension load check, test-repo run"]
```

Task 2 uses only the status constant from Task 1. Task 3 joins them and runs the
full suite.

## Plan review

**Initial review:** a fresh `reviewer` (claude-opus-5-5, high thinking) checked
commit `f6f5083` against base `7c78eb5`. It read the launcher, supervisor,
fixtures, run-once tests, and the console `pi-subagents` client. It also read
the Pi 1.5.2 `dist` sources (print mode, RPC mode, file processor, agent
session, extension runner) and the `pi-subagents` 0.80.0 sources.

**Architecture survey:** the Pi command (`PiCommandSpec`) is a real seam with
two adapters, the bundled CLI and `fake-pi.mjs`. No new port is needed. The RPC
client is a deep module behind the unchanged `PiSession` interface.

**Findings and dispositions:**

- **B1 (blocker, accepted):** the planned count of outstanding work missed owed
  results, intercom delivery, and suppressed wakes. Fix: the extension reads the
  `isActive()` check of `pi-subagents` through the v1 session-liveness registry.
  Task 2 is rewritten.
- **B2 (blocker, accepted):** real Pi sends the report before `agent_settled`.
  Fix: the client keeps reports by settle number; the fake sends the report
  first by default; Task 1 tests both orders.
- **B3 (blocker, accepted):** print mode wraps the prompt file in a
  `<file name=...>` block. Fix: the client sends the same text; Task 1 checks it
  exactly.
- **B4 (blocker, accepted):** shutdown stops ran after `pi-subagents` removed
  its RPC bridge, and runners are detached. Fix: the extension loads first, the
  stops have a 3 s limit, the abort path waits for exit before signals, and Task
  4 also checks for runner processes.
- **Suggestions (accepted):** the extension lives in `src/pi/`, not
  `src/kernel/`; the status constant is in the protocol module; `stdout` is
  built from the last `message_end` with print-mode joining, not from
  `get_last_assistant_text`; the spec names the two model-visible `hasUI`
  branches and the longer abort; test wording for `pi.pid` and
  `parseAgentResult` is fixed.
- **Suggestion (declined):** a missing report stays a log warning, not a phase
  warning. The extension is part of Patchmill, so a missing report means a load
  failure, which Pi already logs as an `extension_error`.

**Inspection limits:** no tests or builds ran, because there is no
implementation yet. The liveness-registry route was read from source and not
exercised.
