# GitHub Triage Redirect-Safe Issue Listing Design

## Goal

Make default `patchmill triage` discover open issues when the local GitHub
remote still uses a pre-rename or pre-transfer repository slug that `gh` can
redirect, and fail loudly for real list errors instead of writing a misleading
empty triage result.

## Current behavior

`GitHubGhHostProvider.listOpenIssues()` lists default triage candidates with:

```sh
gh issue list --state open --search sort:created-asc --limit 1000 --json number,title,body,state,labels,author,createdAt,updatedAt,url
```

The `--search sort:created-asc` form delegates listing to GitHub search. When a
repository remote points at an old slug that GitHub redirects, plain
`gh issue list --state open ...` can return open issues while the search-backed
variant exits successfully with `[]`. `runTriage()` treats that empty array as
authoritative, emits `issues: 0`, and writes an empty triage log.

Patchmill already sorts selected triage issues in process with
`orderTriageIssues()` in `src/cli/commands/triage/pipeline.ts`, so the provider
does not need GitHub search only to get oldest-first ordering.

## Requirements

- Default GitHub issue listing for `patchmill triage` must not depend on GitHub
  search semantics for created-date ordering.
- Keep existing triage selection and ordering semantics: select open issues,
  filter out active triage/protection labels unless `--all` is set, then order
  by `createdAt` ascending with issue-number fallback.
- Preserve issue payload fields used by triage and comment hydration.
- If `gh issue list` exits non-zero because of repository identity, permissions,
  authentication, or other CLI failures, surface an actionable error and write
  the existing failure log shape. Do not convert such failures into `issues: 0`.
- Do not add canonical repository resolution unless removing `--search` proves
  insufficient; keep the fix minimal and avoid extra network calls on the
  default path.
- Treat issue titles, bodies, labels, authors, comments, URLs, and metadata as
  untrusted inert data in tests and logs.

## Proposed behavior

`GitHubGhHostProvider.listOpenIssues()` should call:

```sh
gh issue list --state open --limit 1000 --json number,title,body,state,labels,author,createdAt,updatedAt,url
```

It should parse the returned array exactly as it does today. It should continue
to throw when the command exits non-zero, but the message should be explicit
enough for operators to investigate the repository remote or permissions, for
example:

```text
gh issue list failed; check GitHub authentication, repository remote, and repository permissions: <gh output>
```

`runTriage()` should continue to catch provider listing failures, write a
failure triage log with `error`, and rethrow. A successful empty array remains a
valid `no-issues` result because there may be repositories with no open issues;
the redirect bug is addressed by avoiding the search-backed command that can
produce a false empty array.

## Affected components

- `src/host/github-gh.ts`
  - Remove `--search` and `sort:created-asc` from `listOpenIssues()`.
  - Optionally improve the non-zero `gh issue list` error message with a short
    remediation hint about auth, remote slug, and permissions.
- `src/host/github-gh.test.ts`
  - Update the existing “lists open issues” expectation to the non-search
    command.
  - Add or adjust assertions to prove the command arguments do not include
    `--search`.
  - Add a regression test where the mocked runner would return `[]` for the old
    search-backed command but returns issues for the non-search command;
    `listOpenIssues()` must return those issues and never invoke the old
    command.
  - Add or update a non-zero list failure test to assert the actionable error
    includes `gh issue list failed` and mentions authentication, remote, or
    permissions.
- `src/cli/commands/triage/pipeline.test.ts`
  - Ensure triage still orders selected issues oldest-first using the existing
    in-process ordering, independent of provider order. Existing coverage may
    already satisfy this; add a focused regression only if current tests do not
    prove provider order is not trusted.

## Verification strategy

Run targeted tests:

```sh
node --test src/host/github-gh.test.ts src/cli/commands/triage/pipeline.test.ts
```

Run the full test suite before merge:

```sh
npm test
```

Manual verification, if available, should use a repository whose GitHub remote
still points at an old slug after rename or transfer. Confirm:

```sh
gh issue list --state open --limit 5 --json number,title
patchmill triage --dry-run
```

both see the same open issue set, and `patchmill triage --dry-run` reports
selected issues instead of `issues: 0`. Then intentionally break auth or the
remote and confirm Patchmill exits with an actionable `gh issue list failed`
error rather than writing a successful empty triage log. No npm dependency
changes are required, so no Nix build is required unless implementation later
changes package metadata.
