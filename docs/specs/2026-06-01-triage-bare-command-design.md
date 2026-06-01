# Bare `patchmill triage` Command Design

## Goal

Make `patchmill triage` perform a real first-time triage run, while moving help
display exclusively to `patchmill triage --help` and `patchmill triage -h`.

## Current behavior

- `patchmill triage` shows help because empty args are treated as help-only.
- `patchmill triage --dry-run` previews the default triage selection.
- The default triage selection already skips open issues with active
  triage/protection labels.
- `--all` includes issues that already have triage/protection labels such as
  `in-progress`, `needs-info`, or `blocked`.

## Desired behavior

- `patchmill triage` executes the configured triage skill against all eligible
  open issues that do not have active triage/protection labels.
- `patchmill triage --dry-run` previews the same eligible issue set without
  mutating the issue host.
- `patchmill triage --help` and `patchmill triage -h` show help.
- `--all` keeps its existing recovery/re-triage semantics and includes issues
  that would normally be skipped.

## CLI copy

The help text should explain the default behavior directly:

- Bare `patchmill triage` runs triage for eligible untriaged open issues.
- `--dry-run` previews that run.
- `--all` includes already-triaged/protected issues and should be described as a
  re-triage/recovery option.

## Implementation notes

- Change argument parsing so an empty arg list does not set `showHelp`.
- Change the main command help-only check so only `--help` and `-h` skip config
  loading and execution.
- Update tests for empty-arg parsing, help text, and CLI config loading.
- Keep issue selection logic unchanged because it already implements the desired
  safe default.
