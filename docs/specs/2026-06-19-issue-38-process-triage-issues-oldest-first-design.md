# Process Triage Issues Oldest First Design

## Goal

Make `patchmill triage` process batch issue selections in deterministic
oldest-created order so default and limited triage runs handle incoming work in
creation order instead of prioritizing newer issues returned first by GitHub.

## Current behavior

- `runTriage` in `src/cli/commands/triage/pipeline.ts` obtains open issues from
  the configured issue host unless `--issue <number>` is used.
- `selectIssues` filters the listed issues for default, `--all`, or targeted
  selection and currently applies `--limit` by slicing the provider's incoming
  order.
- `GitHubGhHostProvider.listOpenIssues` calls
  `gh issue list --state open --limit 1000 --json number,title,body,state,labels,author,updatedAt,url`.
  GitHub CLI returns newest-created issues first by default, so `--limit 1` can
  select the newest eligible issue.
- Forgejo/tea open issue listing already sorts by ascending issue number after
  pagination, but the triage pipeline does not state or enforce a provider-
  independent ordering invariant.
- Triage prompts, dry-run logs, execution logs, blocked-issue preprocessing, and
  progress events preserve the order of the selected issue array they receive.

## Desired behavior

Batch triage must sort selected issues oldest first before applying `--limit`:

- Default `patchmill triage` filters out excluded/protection labels as today,
  orders the remaining open issues oldest-created first, then applies `--limit`
  when present.
- `patchmill triage --all` includes open issues that would normally be skipped,
  orders that full selected set oldest-created first, then applies `--limit`
  when present.
- `patchmill triage --issue N` continues to use `viewIssue(N)`, validates the
  issue is open, and is effectively unaffected because the selected set has at
  most one issue.
- Dry-run prompts, execution prompts, triage logs, blocked preprocessor direct
  entries, agent-handled entries, and progress output continue to preserve the
  post-selection order.

Ordering rules:

1. Prefer valid issue creation timestamps ascending.
2. If either compared issue is missing a valid creation timestamp, or the
   timestamps are equal, compare issue numbers ascending.
3. Never use update timestamps for creation ordering.

This gives GitHub and Forgejo deterministic behavior while keeping Forgejo's
existing issue-number fallback useful when tea does not expose creation time.

## Proposed design

### Shared issue shape

Add an optional `created?: string` field to both issue summary type definitions:

- `src/host/types.ts` `IssueSummary`
- `src/cli/commands/triage/types.ts` `IssueSummary`

Keep the field optional so existing providers, tests, and fixture objects remain
valid.

### Host parsing

Update GitHub issue listing and viewing to request and parse creation time:

- Change `ISSUE_LIST_JSON_FIELDS` in `src/host/github-gh.ts` to include
  `createdAt` alongside the existing fields.
- Keep `ISSUE_VIEW_JSON_FIELDS` based on the list fields plus `comments`, so
  targeted views can also carry `created` when available.
- In `parseIssuePayload`, set `parsed.created = issue.createdAt` when it is a
  string.
- Update `listOpenIssues` arguments to include `--search sort:created-asc` so
  GitHub's `--limit 1000` window aligns with the desired oldest-first order. The
  pipeline sort remains the authoritative safety net.

Update Forgejo/tea parsing opportunistically:

- Add creation fields to the tea issue field list only if supported by the
  project's existing tea JSON output contract. If unsupported, do not force a
  provider CLI change.
- In `src/cli/commands/triage/forgejo.ts`, parse a creation timestamp from a
  string `created`, `createdAt`, or other confirmed tea creation field into
  `IssueSummary.created`.
- Preserve the existing final `issues.sort((a, b) => a.number - b.number)` in
  `listIssuesByState` as a fallback for Forgejo responses without timestamps.

### Triage selection helper

Add a small helper near `selectIssues` in `src/cli/commands/triage/pipeline.ts`:

- `createdMillis(issue)` returns a finite epoch millisecond value for a valid
  `issue.created`, otherwise `undefined`.
- `compareTriageIssueOrder(a, b)` compares valid creation times ascending and
  falls back to `a.number - b.number` when either timestamp is missing/invalid
  or both valid timestamps are equal.
- `orderTriageIssues(issues)` returns a sorted copy so callers do not mutate the
  provider's original array unexpectedly.

Apply this helper in `selectIssues` after default/`--all`/`--issue` filtering
and before `slice(0, config.limit)`. That placement makes `--limit N` select the
oldest `N` eligible issues rather than the oldest `N` open issues before policy
filtering.

## Affected components

- `src/host/types.ts`
  - Add optional `created` to host-facing `IssueSummary`.
- `src/cli/commands/triage/types.ts`
  - Add optional `created` to triage-facing `IssueSummary`.
- `src/host/github-gh.ts`
  - Request `createdAt`, parse it into `created`, and pass
    `--search sort:created-asc` for list calls.
- `src/cli/commands/triage/forgejo.ts`
  - Parse creation timestamp when tea exposes one; keep issue-number sorting as
    fallback behavior.
- `src/cli/commands/triage/pipeline.ts`
  - Introduce the ordering helper and sort filtered selections before limiting.
- `src/host/github-gh.test.ts`
  - Cover GitHub command arguments and `createdAt` parsing.
- `src/cli/commands/triage/pipeline.test.ts`
  - Cover limit-after-ordering for default selection and `--all`.
- `docs/issue-agent-workflows.md`
  - Document the oldest-created-first batch selection rule and that `--limit` is
    applied after ordering.

## Test plan

Add focused automated coverage:

- GitHub provider test:
  - expect `gh issue list` to include `--search sort:created-asc`;
  - expect the requested JSON fields to include `createdAt`;
  - assert returned `IssueSummary` objects include `created` parsed from
    `createdAt`.
- GitHub view/hydration expectations:
  - update command strings in existing tests because `ISSUE_VIEW_JSON_FIELDS`
    now includes `createdAt`;
  - assert targeted views still work and comments still parse.
- Triage default selection test:
  - supply open issues in newest-first order;
  - make the oldest eligible issue distinct;
  - run dry-run with `limit: 1`;
  - assert the selected preview/log issue is the oldest eligible issue.
- Triage `--all` selection test:
  - supply skipped/protected and normal open issues in reverse order;
  - run dry-run with `all: true` and `limit: 1`;
  - assert the oldest open issue wins even when it has an excluded label.
- Ordering fallback test coverage can be included in the pipeline cases by using
  equal, missing, or invalid `created` values and asserting lower issue number
  is chosen.

Run targeted verification:

```bash
node --test src/host/github-gh.test.ts src/cli/commands/triage/pipeline.test.ts
```

Run the full suite when the baseline allows:

```bash
npm test
```

## Documentation

Update `docs/issue-agent-workflows.md` under “Issue triage workflow” to state
that batch triage processes selected issues oldest-created first, using issue
number as the fallback/tie-breaker, and applies `--limit` after this ordering.
Mention that targeted `--issue` triage is unchanged.

## Acceptance criteria

- Dry-run and execute triage select batch issues oldest first for GitHub and
  Forgejo.
- `patchmill triage --limit 1 --dry-run` on the current repository would preview
  issue `#34` before newer eligible open issues.
- `--issue` behavior remains unchanged.
- GitHub list calls request `--search sort:created-asc` and `createdAt`.
- `IssueSummary` carries creation timestamps where available and uses issue
  number as fallback/tie-breaker ordering.
- Tests cover GitHub host ordering/parsing and pipeline limit-after-ordering for
  default and `--all` selection.
- Documentation states the ordering rule.

## Out of scope

- Changing `patchmill run-once` issue selection or priority-label behavior.
- Adding triage priority labels or a configurable triage sort mode.
- Changing label policy, classification behavior, comments, or closure logic.
- Changing the blocked issue preprocessor beyond preserving the selected order
  it already receives.
