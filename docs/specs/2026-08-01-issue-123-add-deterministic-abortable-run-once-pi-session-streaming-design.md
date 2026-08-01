# Issue 123 deterministic abortable run-once Pi session streaming design

## Context

`run-once` currently asks Pi to store session logs in a Patchmill-owned
`--session-dir` and the observation streamer recursively follows the newest
JSONL file it can find there. That was safe only while each observed directory
contained exactly one relevant parent session. Durable session retention and
nested Pi/subagent sessions make that assumption unsafe: a concurrent, stale, or
child JSONL can become the newest file and redirect progress observation away
from the parent Pi process that `run-once` owns.

The current observation path also delivers callback work by accumulating promises
and awaiting them at shutdown. Slow callbacks can therefore overlap and reorder
observable side effects. Poll/read failures and malformed JSON can be skipped or
surface late, and callback failures do not cancel the running Pi command. When
multiple shutdown failures happen together, later cleanup or runner errors can
mask earlier observation failures.

Issue #123 is limited to the exact-session, streaming, cancellation, and
terminal-error portions of parent issue #116. It does not change pi-subagents and
it does not migrate triage to the exact-session API.

## Goals

- `run-once` observes one explicitly owned parent Pi session file per Pi
  invocation.
- The observed parent file is pre-created atomically and passed to Pi with
  `--session <path>`.
- Observation follows only that exact file, never recursive newest-file
  discovery.
- Observations are delivered serially; each consumer callback is awaited before
  the next observation is delivered.
- Malformed JSON, session I/O errors, callback failures, runner failures, and
  cleanup failures are all reported without masking independent causes.
- Observation failure aborts the running Pi command promptly, then awaits process
  close and cleanup before reporting the complete terminal error.
- Successful `run-once` still writes only the final JSON object to stdout.
  Progress, verbose Pi output, and error detail remain on stderr and in the JSONL
  run log.
- Tests use explicit synchronization primitives instead of timing races.

## Non-goals

- Do not parse or render subagent-specific metadata.
- Do not change `pi-subagents`.
- Do not change run-once issue selection, artifact extraction, stage ordering, or
  final result parsing except for preserving richer terminal errors.
- Do not migrate triage to exact-session observation. Triage keeps its current
  directory-based tool-call observer and receives regression coverage only.
- Do not make exact-session streaming a broad public API for every Patchmill
  command in this issue.

## Approaches considered

### Keep `--session-dir` and baseline existing files

The streamer could snapshot all JSONL files before Pi starts and ignore any file
that existed before the invocation. This is compatible with the current CLI
arguments, but it still has to decide which new file is the parent when parent
and child sessions appear close together. It also keeps recursive discovery in
the trusted observation path.

### Use Pi `--session-id` and discover by ID

Patchmill could choose a session id and let Pi create the session file under its
normal directory layout. This avoids partial UUID collisions, but the observer
would still have to discover a path by scanning the session tree. Concurrent or
nested sessions could still race discovery unless the streamer learns more about
Pi internals.

### Pre-create one exact session file and pass `--session` (chosen)

Patchmill creates a unique empty JSONL file with exclusive-create semantics in
the durable invocation leaf, passes that path to Pi as `--session <path>`, and
hands the same path to the observer. Pi initializes empty explicit session files
with a valid session header before appending assistant output. The observer no
longer performs path discovery, so stale, sibling, and nested JSONL files cannot
redirect parent observation.

This is the smallest design that satisfies deterministic ownership and keeps
child/subagent logs available under the same durable invocation directory.

## Proposed behavior

### Exact parent session allocation

When `runPiPrompt()` is called by `run-once` with `observeSession: true`, it
should allocate an exact parent session file instead of only a session directory:

1. Resolve the durable invocation directory using the existing
   `sessionRoot/<stage>/invocation-*` policy from issue #92.
2. Create the invocation directory recursively.
3. Choose a unique parent filename under that directory, for example
   `parent-<session-id>.jsonl` or `parent-<timestamp>_<session-id>.jsonl`.
4. Atomically pre-create the file with exclusive create (`wx`/`open(..., "wx")`)
   and close it immediately, leaving a zero-byte file for Pi to initialize.
5. Pass the exact file path to Pi with `--session <path>`.
6. Do not pass the exact parent path through `--session-dir` discovery. If Pi
   needs a session directory, it can derive it from the explicit file path.

Existing non-observed `streamOutput` behavior may keep the current
`--session-dir` message streamer until a later issue needs exact file semantics
there. The `run-once` stages that require progress/tool observation already use
`observeSession: true`, so this issue can stay focused.

### Exact observation streamer

Add an exact-file observation mode, either by extending
`createPiSessionObservationStreamer()` with `{ sessionPath }` or by adding a new
small wrapper such as `createExactPiSessionObservationStreamer()`.

In exact mode the streamer:

- stores the exact `sessionPath` at construction and never calls
  `findNewestSessionFile()`;
- stats and reads byte ranges only from that file;
- buffers incomplete trailing data until a newline or `stop()`;
- treats malformed non-empty JSON as an observation failure instead of silently
  ignoring it;
- converts each parsed entry with the existing `sessionEntryToObservations()`;
- awaits `onObservation(observation)` before delivering the next observation;
- serializes polling so a new poll cannot start while a previous poll or
  callback is still running; and
- returns/rejects from `stop()` with any pending poll, parse, I/O, or callback
  failure.

The legacy directory-discovery streamer remains available for triage so triage
behavior does not change in this PR.

### Backpressure and ordering

`runPiPrompt()` should not collect observation callback promises in an unordered
array. The exact streamer owns delivery order and awaits each callback inline.
If callback 1 is slow, callback 2 is not delivered until callback 1 resolves,
even if both JSONL entries are already present on disk. This gives consumers a
simple invariant: observation side effects happen in file order.

### Abortable command runner

Extend the reusable command runner only as much as this contract requires:

```ts
type CommandRunOptions = {
  cwd?: string;
  env?: Record<string, string | undefined>;
  onStdout?: (chunk: string) => void;
  onStderr?: (chunk: string) => void;
  signal?: AbortSignal;
};
```

`createCommandRunner()` should listen for `signal.abort`, send a termination
signal to the child process, continue collecting stdout/stderr until `close`, and
then settle exactly once. If the signal is already aborted before spawn, the
runner should fail without spawning. A hard-kill timeout is optional only if the
implementation can test it deterministically; the acceptance contract requires
prompt cancellation and awaiting close, not a new process supervisor.

Mock runners used by tests can observe the signal directly without spawning real
processes.

### Failure and cleanup flow

`runPiPrompt()` should run Pi and exact observation under a single
`AbortController`:

1. Start the exact observation streamer before invoking Pi.
2. Start the Pi command with `signal: controller.signal`.
3. If observation fails first, record that failure and abort the controller.
4. Always await the Pi command result/close after aborting.
5. Stop the streamer and drain any final buffered line.
6. Emit Pi stdout/stderr debug events and parse the final stdout only if no
   terminal failure has already made the run invalid.
7. Run prompt-temp cleanup.
8. Throw a combined error if any independent failure occurred.

Failure combination should preserve every independent cause. A small helper can
normalize errors into an ordered list and throw:

- the single original error when there is only one cause; or
- an `AggregateError` with contextual messages when there are multiple causes.

The combined error should include, when present:

- observation parse/I/O/callback errors;
- command runner spawn, abort, close, or nonzero-exit errors;
- result parsing errors;
- streamer shutdown errors;
- heartbeat/progress emission errors; and
- prompt-temp cleanup errors.

The CLI error path should format aggregate causes for both the JSONL log and the
terminal. The final stdout object can add a `causes` array for error results, but
successful and structured blocked/spec/plan/PR JSON contracts should remain
unchanged.

### stdout and stderr contract

The run-once CLI should continue to reserve stdout for its final JSON object.
Observation progress and verbose Pi output remain stderr-only via existing
progress reporters and `streamPiOutput`. Exact-session debug metadata should be
written to the JSONL run log, including the exact parent session file path and
actual invocation directory.

## Affected components

- `src/cli/commands/run-once/pi.ts`
  - allocate exact parent session files for observed run-once Pi invocations;
  - pass `--session <path>` to Pi;
  - coordinate observer failure, command abort, process close, parsing, and
    cleanup with error aggregation.
- `src/cli/commands/run-once/pi-session-stream.ts`
  - add exact-file observation;
  - make exact observation async/backpressured;
  - surface malformed JSON and I/O failures.
- `src/cli/commands/triage/command.ts` and shared types
  - add optional `AbortSignal` support to the command runner.
- `src/cli/commands/run-once/main.ts` and error reporting helpers
  - format aggregate terminal errors without breaking successful final JSON.
- `src/cli/commands/triage/tool-call-observer.ts`
  - keep behavior unchanged; update only if type signatures require a trivial
    compatibility adjustment.
- Tests under `src/cli/commands/run-once/`, `src/cli/commands/triage/`, and the
  command runner tests.

## Verification strategy

Automated tests are valuable here because this is reusable orchestration,
streaming, cancellation, and error-preservation behavior.

Add focused tests for exact session ownership:

- `runPiPrompt()` pre-creates the exact parent JSONL, passes it as
  `--session <path>`, and records the exact path in debug progress.
- A newer sibling or nested JSONL file under the same durable session root is
  ignored while observations are read from the exact parent file.
- Concurrent observed invocations receive distinct exact parent files and cannot
  observe each other's output.

Add deterministic streaming tests:

- Two observations written before the first callback resolves are delivered in
  file order, and the second callback is not invoked until the first promise is
  resolved.
- Malformed JSON rejects observation immediately instead of being skipped.
- Injected read/stat failures reject observation with the original I/O error.

Add cancellation and terminal-error tests:

- Malformed JSON or callback rejection aborts the Pi command via the runner
  signal before the mock runner is allowed to complete normally.
- After abort, `runPiPrompt()` still awaits runner close and cleanup.
- Observation failure plus runner failure plus cleanup failure are all present in
  the thrown aggregate error and in CLI error formatting.
- A Pi nonzero exit without observation failure still reports stdout/stderr as
  before.

Add command-runner tests:

- Aborting an in-flight spawned process terminates it and resolves after `close`
  with collected stdout/stderr.
- An already-aborted signal does not spawn a child.

Add triage regression coverage:

- `runWithToolCallObservation()` still supplies a session directory to its
  callback and observes tool calls using the legacy directory-based behavior.
- No triage test should require `--session` or exact parent session metadata.

Run at least:

```sh
node --test src/cli/commands/run-once/pi.test.ts src/cli/commands/triage/*.test.ts
npm run test:run-once
npm run lint:ts
npm run lint:md
```

No Nix build is required unless implementation changes npm dependency files.
