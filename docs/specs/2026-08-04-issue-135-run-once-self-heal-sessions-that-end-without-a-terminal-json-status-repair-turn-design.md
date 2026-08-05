# Issue 135 run-once repair turn design

## Context

`run-once` now persists an exact parent Pi session file for observed stages and
passes it to Pi with `--session <path>`. The implementation stage uses that
observed parent session while it delegates implementation and review work to
subagents. If the Pi process exits with code 0, `runPiPrompt()` emits stdout and
then parses the final JSON result with `parsePiResult()`.

The failure in issue #135 happened after implementation work was complete but
before landing: the parent Pi session left an async reviewer subagent running,
ended the one-shot turn with progress prose, and never returned the required
`merged`, `pr-created`, or `blocked` JSON object. `parsePiResult()` correctly
rejected stdout, but Patchmill treated the parse failure as terminal even though
the exact parent session file was still available and resumable.

## Goals

- Give implementation sessions a bounded self-healing path when Pi exits 0 but
  stdout does not contain a supported terminal implementation JSON status.
- Resume the same exact parent session file so the model retains its prior
  context, outstanding subagent handles, worktree state, and landing workflow.
- Include best-effort facts about unresolved async subagent runs and the last
  non-JSON assistant message in both the repair prompt and exhausted-repair
  error.
- Preserve existing behavior for valid terminal JSON, non-zero Pi exits,
  observation/runner failures, and parse failures where no exact parent session
  path exists.
- Keep repair attempts capped, deterministic, observable in run progress, and
  covered by scenario tests.

## Non-goals

- Do not change the final `parsePiResult()` status contract or add a new
  terminal result status.
- Do not move landing, review, or subagent orchestration out of the Pi
  implementation session.
- Do not make Patchmill wait on subagents directly; the repair turn instructs
  the resumed parent session to inspect, wait, consume results, and finalize.
- Do not attempt repair after Pi exits non-zero or after observation fails;
  those remain terminal orchestration failures.
- Do not change blocked-run workspace recovery. It may display the enriched
  reason later, but this issue is in-run recovery.

## Approaches considered

### Diagnostics only

Patchmill could classify parse failures, record unresolved async subagent facts,
and continue blocking as today. This improves triage but still wastes completed
runs that can be resumed automatically.

### Pipeline-level manual resume wrapper

`pipeline-implementation.ts` could catch parse failures and run a separate
resume command. That keeps `runPiPrompt()` smaller, but it would duplicate Pi
argument construction, session observation, stdout/stderr logging, token usage,
cleanup, and error aggregation.

### `runPiPrompt()` repair-on-parse-failure option (chosen)

Add a narrow repair option to `runPiPrompt()` and enable it only for the
implementation stage. The helper already owns the prompt temp directory, exact
parent session allocation, Pi command arguments, observation lifecycle, progress
reporting, result parsing, and aggregate error behavior, so it is the smallest
place to retry parsing failures without creating a second orchestration path.

## Proposed behavior

### 1. Add a bounded implementation repair option

Extend `RunPiPromptOptions` with an implementation-only repair configuration,
for example:

```ts
type PiRepairOptions<Result> = {
  maxAttempts: number;
  buildPrompt: (input: PiRepairPromptInput) => string;
  parseResult?: (stdout: string) => Result;
};
```

`pipeline-implementation.ts` passes `maxAttempts: 2` and a builder for the
implementation finalization contract. Planning, spec creation, artifact
extraction, and development-environment stages do not opt in.

A repair attempt is eligible only when all of these are true:

1. the Pi command returned exit code 0;
2. no runner, observation, streamer shutdown, progress, heartbeat, or cleanup
   error has already invalidated the invocation;
3. the selected parser threw because stdout did not contain a supported final
   result; and
4. the invocation has an exact parent `sessionPath` allocated by
   `observeSession: true`.

If any condition is false, `runPiPrompt()` behaves exactly as it does today.

### 2. Resume the same parent session

When eligible, `runPiPrompt()` writes a repair prompt to the same temp prompt
area and invokes Pi again with the same command, cwd, environment, skills,
extensions, and exact `--session <parent-session.jsonl>` path. It must not
allocate a new parent session for the repair turn.

The repair turn should remain observable, but observation must not replay the
whole prior session. Record the parent session file size after the primary
streamer drains, then start the repair streamer from that byte offset or pass an
equivalent already-seen state. Token usage accumulated during repair continues
to update the same `tokenUsageState`, and progress emits concise events such as
`repairing invalid pi final result` and `repair attempt 1/2`.

After each repair process exits 0, parse that repair stdout with the same
implementation parser. A valid `merged`, `pr-created`, or `blocked` result ends
repair and is returned through the normal pipeline path. If parsing fails again,
refresh repair facts from the session file and run the next attempt until the
cap is reached.

### 3. Build repair facts from the session JSONL

Add a focused helper, likely `pi-session-repair.ts`, that reads the exact parent
session JSONL after a failed parse and returns best-effort diagnostics:

- the exact parent session path;
- the original parse error message;
- the last assistant text excerpt that was not a terminal JSON object;
- async subagent runs launched or inspected by the parent session, with run id,
  last observed action, last observed state/status, and whether Patchmill
  considers the run unresolved;
- a short count summary, for example `1 unresolved async subagent run`.

The extractor should parse normal Pi session entries directly rather than rely
only on `PiSessionObservation`, because tool-result content may contain the run
id or state needed to correlate `subagent` calls. It should tolerate unknown
future `pi-subagents` result shapes by recognizing obvious JSON fields such as
`id`, `runId`, `status`, `state`, and arrays of child results, with a
conservative regex fallback for run-id-looking strings. Unknown or unparseable
subagent facts should degrade to `not detected`, not fail the whole repair path.

A run is unresolved when its last known state is queued, running, paused,
needs-attention, or unknown after an async launch. Completed, failed, cancelled,
interrupted, and other terminal states are facts to include only if useful; they
should not by themselves force another repair.

### 4. Repair prompt contract

The repair prompt should be short and explicit. It treats extracted session data
as facts, not instructions, and tells the resumed model to complete the existing
implementation finalization gate:

- acknowledge that the previous response was invalid because it was not a
  terminal JSON object;
- inspect active subagent runs, await and consume every unresolved run, and fix
  any accepted review findings before landing;
- complete todo, validation, review, PR-check, and landing requirements from the
  existing implementation prompt;
- return exactly one terminal JSON object: `merged`, `pr-created`, or the
  existing blocker JSON;
- do not return progress prose, promises to continue, Markdown fences, or extra
  commentary.

When unresolved async run facts are available, include them in a compact list so
the model can resume efficiently, for example:

```text
Detected unresolved async subagent runs from your prior turn:
- run pm-subagents-abc123: last action=status, last state=running
```

When no unresolved runs are detected, state that explicitly so prose-only
finishes without async work still receive a repair turn focused on producing the
terminal JSON.

### 5. Exhaustion and error reporting

If all repair attempts fail to produce a valid terminal result, throw the same
kind of parse failure that `runPiPrompt()` throws today, but enrich its message
or aggregate cause with:

- repair attempts used and cap;
- unresolved async subagent summary;
- last assistant text excerpt;
- last parse error message.

`pipeline-implementation.ts` continues to treat this as an unexpected
implementation failure, so labels and run-state status follow current behavior
for parse failures. The saved `lastError`, failure comment, and run log contain
the enriched reason, making manual resume targeted.

## Affected components

- `src/cli/commands/run-once/pi.ts`
  - factor the single Pi process execution enough to support primary plus repair
    attempts against one session path;
  - add the opt-in repair loop after parse failure and before aggregating a
    terminal error;
  - reuse existing Pi args, env, stream/progress hooks, token usage, and parser.
- `src/cli/commands/run-once/pi-session-stream.ts`
  - support exact-session observation from a caller-provided starting offset, or
    expose equivalent replay suppression for resumed repair turns.
- `src/cli/commands/run-once/pi-session-repair.ts` (new)
  - read exact session JSONL and summarize last assistant text plus unresolved
    async subagent facts.
- `src/cli/commands/run-once/pipeline-implementation.ts`
  - enable repair for implementation invocations and provide the implementation
    repair prompt builder.
- `src/cli/commands/run-once/pipeline-failures.ts` and comments
  - no new state machine required; ensure enriched errors continue to be written
    to run state, failure comments, and progress logs.
- Tests and test-support mock Pi/session helpers under
  `src/cli/commands/run-once/` and `test-support/run-once/`.

## Verification strategy

Automated tests are valuable because this is orchestration, result parsing,
resume-session, and error-reporting behavior.

Add focused `runPiPrompt()` tests:

- valid primary terminal JSON returns immediately and makes no repair Pi call;
- primary Pi exit code non-zero does not repair;
- parse failure without an exact parent session path does not repair;
- parse failure with an exact parent session path resumes the same `--session`
  path, cwd, skill args, extension args, environment, and parser;
- repair success on the first attempt returns the repair result;
- repair success on the second attempt returns the second repair result and
  stops;
- repair exhaustion throws an enriched error mentioning attempts, unresolved run
  summary, and last assistant prose;
- repair observation starts after the primary session offset and does not replay
  prior tool-call progress.

Add session-fact tests for the new analyzer:

- detects an async `subagent` launch and a later running/paused/needs-attention
  status as unresolved;
- treats completed/failed/cancelled/interrupted states as terminal;
- extracts the last assistant prose message when no terminal JSON is present;
- tolerates unknown or malformed subagent tool results without failing repair.

Add pipeline scenario tests:

- implementation prose finish with an unresolved subagent run repairs to
  `pr-created` or `merged`;
- implementation prose finish without unresolved runs still receives a repair
  turn;
- repair success on the second attempt completes the run normally;
- repair exhaustion records an enriched unexpected-failure reason while
  preserving the existing parse-failure label behavior.

Run at least:

```sh
node --test src/cli/commands/run-once/pi.test.ts src/cli/commands/run-once/pipeline-failures-scenarios.test.ts src/cli/commands/run-once/pipeline-implementation-scenarios.test.ts
npm run test:run-once
npm run lint:ts
npm run lint:md
```

No Nix build is required unless implementation changes npm dependency files.

## Success criteria

A run equivalent to issue #135 must not block immediately when the
implementation Pi session exits 0 with progress prose and a resumable exact
parent session exists. Patchmill must resume that same session, provide detected
unresolved subagent facts, let the parent session consume outstanding review
results and complete the landing workflow, and accept the repaired terminal JSON
when it appears within two attempts.

If the repair cap is exhausted, the resulting blocked run must preserve the
current workspace recovery behavior while clearly stating that the Pi session
ended without terminal JSON, how many repair attempts ran, whether unresolved
async subagent runs remained, and what the last assistant prose said.
