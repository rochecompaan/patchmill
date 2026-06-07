# Triage Verbose Tool Logging Design

## Goal

Add `patchmill triage --verbose` so users can see live tool-call activity from
the triage Pi agents while triage runs.

## Scope

- Add a `--verbose` CLI option for `patchmill triage`.
- Log observed Pi tool calls to the live console only.
- Do not append verbose tool-call events to triage JSON logs.
- Preserve existing progress output and triage behavior when verbose mode is not
  enabled.

## Architecture

`parseArgs()` records `verbose` on `TriageConfig`. `main()` wires verbose
console logging into the progress reporter, and the pipeline passes an optional
tool-call observer into the dry-run and execute triage agent invocations.

The agent runners reuse the existing Pi session observation stream used by
`run-once`: when a tool-call observer is present, Patchmill creates a temporary
Pi `--session-dir`, starts a session observation streamer, runs `pi`, and stops
the streamer before returning. Tool-call observations are rendered as concise
live lines such as `🔧 bash` or `🔧 subagent`.

## Data Flow

1. User runs `patchmill triage --verbose`.
2. CLI parsing sets `TriageConfig.verbose = true`.
3. `main()` creates a progress reporter with verbose support and passes
   `onToolCall` into `runTriage()`.
4. Dry-run and execute agents run Pi with a temporary session directory when
   `onToolCall` is present.
5. The session streamer observes structured Pi session entries and calls
   `onToolCall` for each unique tool call.
6. The progress reporter writes the tool-call line to stdout.

## Error Handling

Verbose streaming is best-effort around a normal Pi invocation: the session
streamer is always stopped in a `finally` block, and the temporary session
directory is removed after the agent finishes. Pi non-zero exits still use the
existing error paths.

## Testing

Add tests that prove behavior rather than implementation details:

- `parseArgs()` accepts `--verbose` and rejects unknown flags as before.
- `main()` wires verbose tool-call output to the live console without changing
  JSON log behavior.
- Dry-run and execute triage agents pass `--session-dir` only when a tool-call
  observer is provided.
- Verbose tool-call formatting renders concise lines and includes arguments when
  available.

## Self-Review

- No placeholders remain.
- The design keeps verbose output live-console-only, as requested.
- Existing non-verbose behavior remains unchanged.
- The implementation is localized to triage CLI wiring, triage agent invocation,
  and a focused helper for Pi tool-call observation/formatting.
