# Triage Tool-Call Output Design

## Goal

Make `patchmill triage` print live Pi tool-call activity by default so users can
see useful progress during long gaps between issue summaries.

## Scope

- Stream observed Pi tool calls to the live console for normal
  `patchmill triage` and `patchmill triage --dry-run` runs.
- Do not require a `--verbose` flag.
- Do not append tool-call events to triage JSON logs.
- Preserve existing issue progress output and triage behavior.

## Architecture

`main()` always wires the progress reporter's `onToolCall` callback into
`runTriage()`. The triage pipeline passes that callback into dry-run and execute
triage agent invocations.

The agent runners reuse the existing Pi session observation stream used by
`run-once`: when a tool-call observer is present, Patchmill creates a temporary
Pi `--session-dir`, starts a session observation streamer, runs `pi`, and stops
the streamer before returning. Tool-call observations are rendered as concise
live lines such as `🔧 bash` or `🤖 subagent (agent=worker)`.

## Data Flow

1. User runs `patchmill triage`.
2. `main()` creates the triage progress reporter and passes its `onToolCall`
   handler to `runTriage()`.
3. Dry-run and execute agents run Pi with a temporary session directory when
   `onToolCall` is present.
4. The session streamer observes structured Pi session entries and calls
   `onToolCall` for each unique tool call.
5. The progress reporter writes the tool-call line to stdout.

## Error Handling

Tool-call streaming is best-effort around a normal Pi invocation: the session
streamer is always stopped in a `finally` block, and the temporary session
directory is removed after the agent finishes. Pi non-zero exits still use the
existing error paths.

## Testing

Automated tests cover the behavior because it changes CLI output and agent
invocation:

- `parseArgs()` rejects `--verbose` as an unknown argument because tool-call
  output is now the default.
- `main()` wires tool-call output to the live console by default.
- Dry-run and execute triage agents pass `--session-dir` when a tool-call
  observer is provided.
- Tool-call formatting renders concise lines and includes arguments when
  available.

## Self-Review

- No placeholders remain.
- The design keeps tool-call output live-console-only.
- Existing JSON logs remain unchanged.
- The implementation is localized to triage CLI wiring, triage agent invocation,
  and a focused helper for Pi tool-call observation/formatting.
