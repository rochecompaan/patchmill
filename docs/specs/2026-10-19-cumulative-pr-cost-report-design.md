# Cumulative PR cost report

## Approved scope

Restore the phase and model cost table removed by the skills-first refactor. The
user confirmed that an implementation PR must include earlier local runs,
including the separate specification PR. This change restores reporting only. It
does not restore the old pipeline or change phase selection.

This design supersedes the original skills-first design's exclusion of PR cost
publication. Run results remain diagnostic records, not workflow state.

## Collection

Read retained attempts under the selected issue's run directory. Use each
`result.json` session's phase to classify the numbered session directory. The
current attempt supplies its phases in memory because its result is not yet
written. Phase selection never reads these records.

Read Pi JSONL files recursively, including subagent sessions. Group usage by
phase and model. Prompt tokens include input, cache reads, and cache writes. Sum
Pi's recorded dollar estimates. Copied entries with the same message ID, model,
and normalized usage count once. Entries without IDs count separately.

A missing price leaves that group's dollar cost unavailable. The issue total
also stays unavailable rather than presenting a partial estimate as complete.
Missing or corrupt session data or phase metadata prevents publication. An
attempt that never started Pi adds no usage.

## Publication

After outcome checks, update the PR for the observed branch. Read its current
body before publication. Add or replace exactly one marked cost section.
Preserve every byte outside that section, including issue references. Reject
malformed or repeated markers without editing the PR. Skip unchanged bodies.

The host interface gains only a PR body update operation. GitHub uses `gh` with
body text on stdin. Forgejo uses a repository-scoped `tea api` PATCH request.
The agent still owns PR creation and the rest of its body.

Reporting errors become warnings. They cannot change a verified outcome, skip
issue label cleanup, or prevent release of the issue lock. Console and issue
comment costs remain scoped to the current attempt.

## Limits and verification

Reports include only locally retained runs. They are estimates, not provider
billing records. Removing earlier runs removes their costs from later totals. No
configuration, price table, background process, or model call is added.

Regression tests cover earlier specification runs, phase and model groups,
cached tokens, copied history, unknown prices, malformed data, preserved PR
text, repeat publication, host requests, and non-blocking failures. Run the full
test suite, lint, TypeScript build, Nix build, and flake check. Inspect the real
retained issue logs without starting Pi or changing the live PR.
