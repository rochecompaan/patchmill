# Issue 92 keep Pi session logs design

## Context

Issue #92 was opened after a `patchmill run-once` execution for issue #88 ended
with no supported final JSON status and no recoverable parent Pi session JSONL.
The Patchmill run log still existed at
`.patchmill/runs/issue-88/run-2026-07-16T06-56-46-497Z.jsonl`, and the
pi-subagents async metadata still existed under `/tmp/pi-subagents-uid-1000/`,
but the parent Pi `--session-dir` was gone.

The failure sequence was:

- Patchmill ran implementation with session observation enabled.
- The parent Pi session dispatched a `worker` subagent with `async: true`.
- The parent Pi process returned plain text only:
  `Implementation worker started for issue #88 and task todos were created.`
- Patchmill blocked because Pi output did not include final JSON.
- The async worker failed shortly after with an `ENOENT` opening a JSONL file
  under `/tmp/agent-issue-prompt-vuFOip/sessions/...`.
- That `/tmp/agent-issue-prompt-*` directory had already been deleted by
  Patchmill's prompt cleanup.

`runPiPrompt()` currently creates one temporary directory for both the prompt
file and, when observation or streaming is enabled, the Pi `--session-dir`. Its
`finally` block removes the whole temporary directory. That is safe for the
prompt file but unsafe for diagnostic session logs and async subagent children
that inherit the parent session location.

The existing Pi session streamers also assume the session directory they watch
is fresh enough that the newest JSONL belongs to the current invocation. A
durable directory reused across multiple Pi invocations can contain stale JSONL
files. If Patchmill passes a reusable stage directory directly to Pi, the
streamer can bind to stale output before the current Pi session writes its
JSONL.

## Decision

Patchmill should treat Pi session logs as durable run artifacts. Prompt files
can remain temporary and cleaned up after each Pi invocation, but Pi
`--session-dir` should point at a Patchmill-owned durable invocation leaf when
`run-once` invokes Pi.

The durable session artifact root should live beside the final issue run log:

```text
.patchmill/runs/issue-<number>/run-<safe-timestamp>-pi-sessions/
```

That root is not passed to Pi directly. `runPiPrompt()` should own session path
policy at the Pi boundary. Given a durable root and the Pi stage, it should
create a fresh per-invocation leaf beneath the stage directory and pass that
leaf to Pi.

Example layout:

```text
.patchmill/runs/issue-92/run-2026-07-16T09-00-00-000Z-pi-sessions/
  pi-plan/
    invocation-a1b2c3/
      --home-roche-projects-patchmill--/
        2026-07-16T09-00-03-000Z_<session-id>.jsonl
    invocation-d4e5f6/
      --home-roche-projects-patchmill--/
        2026-07-16T09-01-20-000Z_<session-id>.jsonl
  pi-development-environment/
    invocation-g7h8i9/
      --home-roche-projects-patchmill-.worktrees-issue-92--/
        2026-07-16T09-04-10-000Z_<session-id>.jsonl
  pi-implementation/
    invocation-j1k2l3/
      --home-roche-projects-patchmill-.worktrees-issue-92--/
        2026-07-16T09-08-20-000Z_<parent-session-id>.jsonl
        2026-07-16T09-09-00-000Z_<worker-session-id>.jsonl
```

Fresh invocation leaves are the lifecycle boundary. They preserve logs without
requiring broad changes to the streamers and prevent stale JSONL files from
previous invocations from being treated as current output.

## Goals

- Preserve parent Pi session JSONL files for every `run-once` Pi invocation.
- Preserve child and async subagent session JSONL files when they are written
  beneath the parent Pi `--session-dir`.
- Keep temporary prompt cleanup without deleting durable session logs.
- Ensure the Pi session streamers observe only the current invocation when
  durable session artifacts from earlier invocations already exist.
- Centralize durable session path derivation in the Pi boundary instead of
  spreading stage-specific `join()` policy through orchestration code.
- Surface the durable Pi session artifact root in run logs and JSON summaries so
  blocked or failed runs are debuggable from a single result object.
- Keep existing console output behavior unless verbose Pi output is requested.
- Add regression coverage for the temp cleanup failure mode, stale pre-existing
  JSONL files, and pipeline propagation into planning, development-environment,
  and implementation Pi invocations.

## Non-goals

- Do not preserve every pi-subagents artifact file from `/tmp/pi-subagents-*` in
  this issue. The required durable artifact is the Pi session JSONL tree. The
  pi-subagents extension may still keep its own copied summaries or artifacts.
- Do not change how Pi final JSON is parsed or how blocked results are decided.
- Do not change issue selection, worktree recovery, or artifact resolution.
- Do not introduce a retention policy or cleanup command for old run artifacts.
- Do not make session observation mandatory for callers outside `run-once`.
  Direct `runPiPrompt()` users without a configured durable session root keep
  the current temporary fallback.
- Do not add local fallback behavior that silently uses temporary session logs
  when a durable session root cannot be created.

## Runtime behavior

### Session artifact root

Patchmill should add a helper next to `runLogPath()` that derives the durable Pi
session artifact root from the same run timestamp and issue number:

```ts
runPiSessionPath(runStateDir, timestamp, issueNumber);
```

The helper should return a path under the issue-specific run directory and use
the same safe timestamp transformation as run logs:

```text
<runStateDir>/issue-<number>/run-<safe-timestamp>-pi-sessions
```

This avoids depending on the preliminary run log path. The preliminary JSONL run
log starts outside the issue directory and is moved after the issue is known,
but the selected issue is known inside `runOneIssue()` before any Pi stages run.

The helper returns the artifact root that should appear in Patchmill result
metadata as `piSessionPath`. It does not return the exact per-invocation
`--session-dir` passed to Pi.

### `runPiPrompt()` ownership boundaries

`runPiPrompt()` should own only the temporary prompt file directory it creates.
It should accept two session-related options:

- `sessionRoot?: string` — durable artifact root used by `run-once`. This is the
  normal pipeline integration point.
- `sessionDir?: string` — exact low-level override for tests or specialized
  direct callers. This bypasses per-invocation derivation and should not be used
  by the run-once pipeline.

When observation or streaming requires a session directory:

1. If `options.sessionDir` is provided, use that exact directory as Pi
   `--session-dir`, create it if needed, and never delete it.
2. Else if `options.sessionRoot` is provided, create the stage root
   `<sessionRoot>/<stage>` and create a fresh child directory with a stable
   prefix such as `invocation-` using `mkdtemp()`. Pass that fresh child
   directory to Pi and never delete it.
3. Otherwise, preserve the current temporary fallback of
   `<prompt-temp-dir>/sessions`.
4. Always remove the prompt temporary directory in `finally`.
5. Never remove caller-provided session roots, exact session dirs, or generated
   durable invocation leaves.

This keeps direct unit-level behavior backward compatible, makes durable session
retention opt-in for the pipeline, and centralizes session path policy in one
boundary.

`runPiPrompt()` should emit a debug progress event that records the actual
session directory passed to Pi. That event gives operators a precise path even
when the final result is an unexpected error before a normal summary is
produced. The result metadata still points to the durable artifact root.

### Streamer lifecycle

The current `createPiSessionMessageStreamer()` and
`createPiSessionObservationStreamer()` find the newest JSONL under their session
directory and then follow that file. That behavior is acceptable only if the
session directory is fresh for the current invocation.

The durable-session implementation should therefore prefer fresh per-invocation
leaf directories instead of making the streamers inspect global durable roots.
With this design, existing streamer semantics remain valid:

- stale JSONL files in earlier invocation leaves are outside the watched
  `--session-dir`;
- the first JSONL discovered under the fresh leaf belongs to the current Pi
  invocation; and
- async child sessions written under the same leaf remain available after the
  parent Pi process exits.

If a future change chooses to pass reusable directories directly to streamers,
it must first update the streamers to baseline existing files and ignore stale
JSONL. That is not the chosen implementation for this issue.

### Pipeline propagation

After `runOneIssue()` selects an issue and computes the run timestamp, it should
compute one durable Pi session artifact root and attach it to the pipeline
options used by subsequent stages. The field should also be included on selected
issue pipeline results via the same helper that currently attaches `logPath`.

Run-once orchestration should pass the durable root to Pi invocations without
constructing stage-specific paths. The Pi boundary should derive:

```text
<piSessionPath>/<stage>/invocation-<suffix>/
```

where `<stage>` is the `RunPiPromptStage` value, such as `pi-plan`,
`pi-development-environment`, or `pi-implementation`.

The artifact extraction stage currently does not invoke Pi. If a future artifact
extraction path invokes Pi, it should pass the same durable root and let
`runPiPrompt()` derive the `pi-artifact-extraction` invocation leaf.

### Result and log visibility

Pipeline results should support a `piSessionPath` field alongside `logPath`.
`summarizeResult()` should include `piSessionPath` for selected-issue result
statuses when it is present, including blocked and error-like handoff statuses.

A `no-issue` result should remain log-only because no issue was selected and no
issue-specific durable Pi session root can be derived.

The JSONL progress log should include at least one debug event per Pi invocation
with:

- `stage`: the Pi stage, such as `pi-implementation`;
- `message`: `pi session dir`; and
- `data`: the actual per-invocation session directory passed to Pi.

### Async subagent compatibility

The issue #88 failure showed the async worker reading a child session JSONL path
under the parent Pi `--session-dir`. Durable invocation leaves fix the cleanup
race because Patchmill no longer deletes that directory when the parent Pi
process exits.

Patchmill should not wait for async subagents merely to preserve the parent
session directory. A parent Pi session that returns before an async child is
finished may still produce an unsupported final JSON result, but the diagnostic
session tree remains available for post-run debugging.

### Path shape and safety

The durable session artifact root should be under `config.runStateDir` and the
selected issue directory. It should not be under `.pi`, `.patchmill/pi-agent`,
or a worktree-specific temporary directory. This makes the run log and session
logs co-located and keeps them outside agent-managed todo state.

The implementation should use `mkdir(..., { recursive: true })` for durable
stage roots and `mkdtemp()` for per-invocation leaves. It should not attempt to
delete or rotate session logs.

## Error handling

- If Patchmill cannot create the durable session root, stage root, or invocation
  leaf, the Pi stage should fail before launching Pi and surface the filesystem
  error as the run failure. Silent fallback to temp session logs would hide the
  diagnostic problem this issue is meant to fix.
- If a Pi command exits nonzero, `runPiPrompt()` should continue to emit stdout,
  stderr, and the session-dir debug event before throwing.
- If Patchmill exits with a structured `blocked` result after issue selection,
  the result should carry both `logPath` and `piSessionPath`.
- If Patchmill exits through the CLI error path, the CLI should continue to
  print `logPath`. Adding `piSessionPath` there is best effort unless an issue
  was selected and the path is already known.

## Testing strategy

Automated tests are valuable because this is reusable control-flow and
filesystem behavior with a proven regression.

Add focused unit coverage for `runPiPrompt()`:

- configured `sessionRoot` creates a fresh per-invocation child under
  `<sessionRoot>/<stage>/invocation-*`;
- stale JSONL files elsewhere under the durable root are not streamed or
  observed for the current invocation;
- configured exact `sessionDir` remains available as a low-level override and
  survives prompt temp cleanup; and
- debug progress includes the actual per-invocation session directory.

Add pipeline coverage for run-once:

- selected issue results include a deterministic `piSessionPath` artifact root
  for the run timestamp;
- planning Pi invocations receive a fresh directory under
  `<piSessionPath>/pi-plan/`;
- development environment Pi invocations receive a fresh directory under
  `<piSessionPath>/pi-development-environment/`; and
- implementation Pi invocations receive a fresh directory under
  `<piSessionPath>/pi-implementation/`.

Add summary coverage so `summarizeResult()` includes `piSessionPath` in JSON
output for selected-issue results. Do not codify `piSessionPath` on `no-issue`
results.

No new test should assert documentation text. Documentation changes should be
verified with markdown linting or a focused formatting check.
