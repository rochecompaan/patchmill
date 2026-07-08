# Forgejo Edited Comment Hydration Design

## Goal

Ensure Patchmill's Forgejo-backed issue comment hydration includes edited issue
comments so `patchmill run-once` artifact extraction can see specs and plans
attached in edited comments.

## Background

Issue #71 reports that Forgejo/tea comment hydration can miss edited comments.
The current Forgejo helper fetches comments with
`tea issues <number> --comments` and parses the human-readable output. Unedited
comment headers look like this:

```text
**@user** wrote on 2026-01-02 03:04:
```

Edited comment headers include an extra suffix:

```text
**@user** wrote on 2026-01-02 03:04 *(edited on 2026-01-02 03:05)*:
```

`src/cli/commands/triage/forgejo.ts` only recognizes the unedited header shape,
so the parser can skip edited comments entirely. `run-once` then asks the
artifact-extraction stage to classify issue content without those comments. If a
spec or plan lives in an edited comment, Patchmill can incorrectly conclude that
no artifact exists, create duplicate planning artifacts, or stop at a review
gate.

## Requirements

- Forgejo issue comment hydration must include edited and unedited comments.
- Hydrated comments must preserve comment body text, author login, and creation
  timestamp when Forgejo provides them.
- `IssueHostProvider.hydrateIssueComments()` must keep the same public contract:
  mutate/populate each issue's `comments` field and return the input array.
- Forgejo hydration must continue to honor the configured `tea` login and
  repository context.
- Artifact extraction behavior should improve without changing the
  artifact-extraction prompt, approval policy, or run-once planning state
  machine.
- Issue body and comment content remain untrusted input. Patchmill may pass the
  text to the artifact-extraction prompt, but must not execute instructions from
  it.
- Do not add npm dependencies or change package metadata.

## Proposed behavior

Use Forgejo's structured API response for comments instead of parsing
`tea issues --comments` human output.

`fetchIssueComments()` in `src/cli/commands/triage/forgejo.ts` should call:

```text
tea api /repos/{owner}/{repo}/issues/<issue-number>/comments?page=<page>&limit=1000
```

through the existing `withTeaContext()` helper so `--repo` and `--login` are
applied consistently with other Forgejo commands. `tea api` replaces `{owner}`
and `{repo}` from the repository context and returns JSON comment objects. This
avoids dependence on terminal formatting, edited-header prose, table wrapping,
or ANSI formatting.

Extend the existing JSON comment parser so it accepts the fields Forgejo API
comment payloads use:

- `body` for the Markdown comment body;
- `user.login` for `IssueCommentSummary.authorLogin`;
- `created_at` for `IssueCommentSummary.created`.

Keep support for the already-recognized `author`, `authorLogin`, `created`, and
`createdAt` shapes because issue-list JSON and tests may still use those names.

The API response should be validated as an array. Invalid JSON, a non-array
payload, or a non-zero `tea api` exit should fail hydration with a clear error,
matching the current fail-fast behavior for `tea issues --comments` failures.
Comments without string `body` values should be ignored, as today.

Use a high page size (`1000`) and page through results until a page returns
fewer than `1000` comments. Most issues will complete in one request, while very
long threads still hydrate completely.

## Affected components

- `src/cli/commands/triage/forgejo.ts`
  - Extend `parseIssueComment()` to read `entry.user` and `entry.created_at`.
  - Replace the human-output `tea issues <number> --comments` fetch path with a
    `tea api` JSON fetch path.
  - Validate API payloads as arrays and map them through the JSON comment
    parser.
  - Remove now-unused human-output parsing helpers if they no longer have
    callers.
- `src/host/forgejo-tea.test.ts`
  - Update the comment hydration test to expect `tea api` calls instead of
    `tea issues --comments` calls.
  - Add regression coverage for a comment payload that includes `updated_at` to
    represent an edited comment; the body must still hydrate.
  - Assert `user.login` and `created_at` map to `authorLogin` and `created`.

No user-facing documentation changes are required because this is an internal
bug fix to the Forgejo host provider.

## Alternatives considered

### Accept optional edited suffix in the human-output parser

A smaller regex change could recognize `*(edited on ...)*` after the created
time. That would fix the known header shape, but Patchmill would still depend on
human-oriented terminal output, line wrapping, ANSI cleanup, and future `tea`
formatting changes. It also would not improve author/timestamp fidelity beyond
what the textual output exposes.

### Structured API hydration

The API path uses the same authenticated `tea` CLI and repository/login context
but consumes JSON. It directly addresses edited comments because edit state is a
field on the payload rather than prose in a rendered header. This is the chosen
approach.

## Verification strategy

Focused verification:

```sh
node --test src/host/forgejo-tea.test.ts
```

Full regression verification before merge:

```sh
npm test
npm run lint:ts
```

Manual verification, if a Forgejo test repository is available:

1. Create an issue with a spec or plan in a comment.
2. Edit that comment.
3. Run `patchmill run-once` against the issue.
4. Confirm artifact extraction sees the edited comment content and does not
   create duplicate planning artifacts solely because the source comment was
   edited.

Because package metadata does not change, the Nix build is not required unless
implementation unexpectedly edits `package.json`, `package-lock.json`, or
`npm-shrinkwrap.json`.
