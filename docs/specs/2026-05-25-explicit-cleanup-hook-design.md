# Explicit cleanup hook design

## Context

Patchmill currently supports `cleanupHooks` as an array of structured hook
objects. Each hook can check for a path, scan running processes by command-line
pattern and worktree cwd, terminate matching process groups, and then run an
arbitrary command with arguments.

That behavior is more implicit and more powerful than needed. Cleanup should be
explicit: a repository maintainer should provide the cleanup behavior they want,
and Patchmill should run that behavior without discovering or killing processes
on its own.

## Goals

- Replace implicit process discovery with one explicit cleanup script path.
- Keep cleanup configuration simple enough to understand at a glance.
- Let repository-owned shell code perform repository-specific checks and
  delegation.
- Remove `terminateProcessPatterns`, `whenPathExists`, `command`, and `args`
  from cleanup configuration.
- Remove unit tests that validate process scanning or automatic process
  termination.

## Non-goals

- Supporting multiple cleanup scripts in Patchmill config. A single script can
  call other scripts if needed.
- Preserving backwards compatibility for the old `cleanupHooks` object-array
  shape.
- Providing built-in process termination behavior.

## Configuration

Use a singular optional `cleanupHook` string:

```json
{
  "cleanupHook": "./scripts/cleanup.sh"
}
```

The path is repository-relative and should point to a shell script present in
the worktree. If no `cleanupHook` is configured, cleanup is a no-op.

## Runtime behavior

At the end of a successful issue-agent run, Patchmill will:

1. Check whether `cleanupHook` is configured.
2. If absent, return no cleanup work/results.
3. If present, run the configured script from the worktree root.
4. Report a cleaned result when the script exits `0`.
5. Report a failed result when the script exits non-zero, including
   stderr/stdout context.

Patchmill will not inspect running processes, match process command lines, check
`/proc/<pid>/cwd`, or send signals. Any repo-specific cleanup, safety checks,
process shutdown, or delegation belongs inside the configured shell script.

## Code changes

- Replace `CleanupHookConfig` with a simpler string-based config field on
  Patchmill config, e.g. `cleanupHook?: string`.
- Update config loading, cloning, defaults, and tests from `cleanupHooks: []` to
  optional `cleanupHook`.
- Delete the dedicated `src/cleanup/` directory.
- Add `src/pi/hooks.ts` for small Pi workflow hook helpers, starting with the
  cleanup hook script runner.
- Add focused tests in `src/pi/hooks.test.ts`.
- Remove the process-termination shell script and helper functions.
- Remove tests for `whenPathExists`, `terminateProcessPatterns`, process-group
  safety, and command/args execution.
- Update pipeline code to import from `src/pi/hooks.ts` and pass the singular
  cleanup hook path.
- Update documentation examples.

## Testing

Keep focused tests for the new explicit behavior:

- no cleanup hook configured produces no cleanup work/results
- configured cleanup script runs from the worktree root
- cleanup script failure returns a failed result with hook context
- config loader accepts `cleanupHook: "./scripts/cleanup.sh"`
- config loader rejects non-string `cleanupHook` values

Remove tests that cover automatic process discovery or process termination.
