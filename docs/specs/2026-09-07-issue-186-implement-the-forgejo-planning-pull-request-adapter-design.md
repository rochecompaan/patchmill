# Issue 186 Forgejo planning pull request adapter design

## Status

This written specification awaits manual approval. Planning and implementation
must not continue until that approval is explicit.

Issue #184 supplied the provider-neutral `PullRequestHost` foundation. This
issue adds only its Forgejo implementation.

## Summary

Add a dedicated `ForgejoTeaPullRequestHost` that implements `PullRequestHost`
through `tea api`. The adapter resolves the current target repository and the
configured Git push remote through Forgejo before operating on pull requests.

The target and head may have different owners or repository names, but they must
resolve to the same Forgejo host. Pull request payloads must repeat those
complete identities in their nested base and head repository objects.

Discovery reads every API page and filters normalized results by the exact
target repository, base branch, head repository, and head branch. Get maps only
a machine-readable HTTP 404 for the requested pull request endpoint to
`PullRequestNotFoundError`; all other failures retain a distinct adapter error.

The adapter remains separate from the existing `ForgejoTeaHostProvider`, host
factory, and run-once workflow.

## Goals

- Implement every `PullRequestHost` method for Forgejo.
- Resolve provider-normalized target and push-remote repository identities.
- Support any valid Git remote name and all of its configured push URLs.
- Support same-host, cross-owner pull request heads.
- Create, discover, and get pull requests through structured Forgejo API JSON.
- Normalize open, merged, and closed-unmerged pull requests.
- Fetch list pages until Forgejo returns a page shorter than the requested page
  size.
- Validate nested target and head repository identities without guessing.
- Treat only an exact API 404 as a missing pull request.
- Test pure normalization, pagination, and exact command contracts.

## Non-goals

- GitHub support.
- Host-factory or `RunOnceHostProvider` changes.
- Planning workspace, phase publisher, recovery, or pipeline integration.
- Automatic pull request merge or remote branch cleanup.
- Changes to the existing URL-based Forgejo pull request body adapter.
- Live Forgejo mutations in the automated test suite.
- New npm dependencies.

## Recommended structure

Use a dedicated adapter instead of extending `ForgejoTeaHostProvider`. The
existing provider already combines issue, repository-setup, and legacy
body-update responsibilities; adding identity resolution, pagination, and API
error classification would give it another reason to change and would make the
new interface reachable through the current factory.

Split the new behavior by responsibility:

- `src/host/forgejo-tea-pull-requests.ts` owns the public adapter and operation
  orchestration.
- `src/host/forgejo-tea-pull-request-commands.ts` owns `git` and `tea api`
  execution, repository context, pagination, and HTTP status extraction.
- `src/host/forgejo-tea-pull-request-parsing.ts` owns pure remote URL,
  repository payload, and pull request normalization.
- `src/host/forgejo-tea-pull-request-errors.ts` owns stable Forgejo adapter
  error categories and fields.
- Colocated parsing and adapter tests cover the pure and command boundaries.

Reuse `CommandRunner`, `withTeaContext()`, and `withTeaRepositoryContext()`.
This slice does not relocate command contracts or add a factory. Each production
module should remain focused and target fewer than 200 meaningful lines; split
parsing from execution before allowing a module to grow substantially beyond
that target.

### Alternatives considered

1. **Extend `ForgejoTeaHostProvider`.** This minimizes constructor code, but it
   grows an already broad class and risks accidental factory exposure. Reject.
2. **Use high-level `tea pulls` commands.** Their list and display contracts do
   not provide the required API pagination and exact HTTP-status boundary.
   Reject.
3. **Use a separate `tea api` adapter.** This keeps the foundation interface
   isolated, consumes structured payloads, and makes command and failure
   semantics testable. Choose this approach.

## Adapter contract

The public constructor accepts:

```ts
export type ForgejoTeaPullRequestHostOptions = {
  runner: CommandRunner;
  repoRoot: string;
  pushRemote: string;
  login?: string;
};
```

A blank `pushRemote` is invalid. The adapter has `id: "forgejo-tea"` and
implements the unchanged `PullRequestHost` interface from
`src/host/pull-requests.ts`.

Public methods validate positive safe-integer pull request numbers and nonblank,
unqualified Git branch names before executing provider operations. Commands use
argument arrays; pull request bodies and branch names never pass through a
shell.

## Repository identity and context

### Target repository

`resolveTargetRepositoryIdentity()` calls the repository endpoint through the
existing target context:

```text
tea api /repos/{owner}/{repo} --include --repo <target-slug> [--login <login>]
```

`withTeaContext()` supplies the target slug selected by the current repository.
The Forgejo response, rather than the raw Git slug, is authoritative so renamed
or transferred repositories normalize to their current identity.

### Configured push remote

`resolveRemoteRepositoryIdentity(remote)` first runs:

```text
git remote get-url --push --all -- <remote>
```

The `--` separator permits a valid remote name beginning with `-`. The command
must return at least one nonempty URL. The parser accepts standard HTTP(S), SSH,
and scp-like Forgejo clone URLs, removes one trailing `.git`, and rejects local,
file, credential-bearing HTTP, incomplete, or ambiguous paths without exposing
the raw URL in errors.

For each returned push URL, the adapter calls the repository endpoint with an
explicit repository context. The provider response must agree with the remote
hostname. Every push URL must normalize through Forgejo to the same
`RepositoryIdentity`; otherwise resolution fails with
`PullRequestIdentityError`.

### Provider-normalized repository payload

A repository payload must contain mutually consistent `name`, `full_name`,
`owner.login`, and `html_url` fields. The normalized identity is:

```ts
{
  provider: "forgejo-tea";
  host: string;
  owner: string;
  repository: string;
}
```

The host is the lowercase host from Forgejo's returned web URL, without scheme
or path. Owner and repository spelling comes from Forgejo. Missing fields,
malformed URLs, or disagreement among the nested fields cause
`PullRequestIdentityError` or a malformed-response error.

Before each pull request operation, target resolution and configured push-remote
resolution start independently. The two identities may differ in owner or
repository, which enables fork heads, but must use the same provider and host.
Each operation compares caller-supplied target and head identities with this
live context before mutation or adoption.

## Pull request normalization

Forgejo pull request responses are normalized into `PullRequestSummary`. A valid
payload requires:

- a positive safe-integer number;
- an HTTP(S) `html_url` identifying that number in the expected target
  repository;
- a string body;
- nonblank `base.ref`, `head.ref`, and `head.sha` values;
- complete `base.repo` and `head.repo` objects accepted by the repository
  identity parser; and
- a supported state with consistent merge fields.

`base.repo` must equal the resolved target identity. `head.repo` must equal the
resolved configured push-remote identity. Cross-owner heads are valid; missing
or contradictory nested repositories fail closed.

State mapping is exact:

| Forgejo payload                                 | Patchmill status  |
| ----------------------------------------------- | ----------------- |
| `state: "open"`, not merged, no merge commit    | `open`            |
| `state: "closed"`, merged, merge commit present | `merged`          |
| `state: "closed"`, not merged, no merge commit  | `closed-unmerged` |

Unknown states and inconsistent merge flags or commit data are malformed
responses.

## Operations

### Create

After validating input and resolving repository context, create sends a
structured request to the target repository's pull endpoint:

```text
tea api /repos/{owner}/{repo}/pulls \
  --method POST \
  --field base=<base-branch> \
  --field head=<resolved-head-owner>:<head-branch> \
  --field title=<title> \
  --field body=<body> \
  --include --repo <target-slug> [--login <login>]
```

The adapter derives the owner-qualified head from the resolved push repository;
the caller supplies only the branch. This supports cross-owner heads without
accepting a caller-provided owner qualifier. The returned pull request payload
must normalize against the resolved target and head identities before it is
returned.

### Exact discovery

`findPullRequests(query)` first verifies that the query target and head match
the resolved target and push identities. It then requests all states from the
target endpoint with a fixed supported page size:

```text
tea api /repos/{owner}/{repo}/pulls?state=all&page=<page>&limit=50 \
  --include --repo <target-slug> [--login <login>]
```

Pages start at one. The adapter validates each response as an array, normalizes
its entries, and continues while the raw page length equals 50. It stops only
when the raw page is shorter than 50, including an empty page.

Only after all pages succeed does it return entries whose target repository,
base branch, head repository, and head branch exactly match the query.
Repository comparison uses `sameRepositoryIdentity`; branch comparison is
case-sensitive. A later-page command, JSON, or payload failure throws its
original adapter error and returns no partial results.

### Get and body methods

`getPullRequest(reference)` verifies the reference target against live context,
then requests the exact target endpoint with `--include`. The payload must have
the requested number and the resolved nested target and head identities.

`readPullRequestBody(reference)` delegates to the same validated get path and
returns its normalized body.

`updatePullRequestBody(reference, body)` first uses the validated get path so it
cannot edit an unrelated pull request. It then sends a structured PATCH to the
validated target and number with `body` as one argument. It does not use the
legacy URL-based helper or reconstruct identity from caller-owned URL text.

## HTTP and error handling

All `tea api` calls use `--include`, which writes HTTP status information to
standard error while leaving JSON on standard output. Status parsing accepts
only a complete HTTP status line and uses the final response status when a
redirect produced more than one header block. Human-readable diagnostics never
control classification.

For the exact get endpoint, and only there, a nonzero `tea` result whose final
well-formed API status is exactly `404` becomes
`PullRequestNotFoundError(reference)`.

These do **not** become not-found errors:

- output text that merely contains `404`;
- authentication or authorization responses such as 401 or 403;
- rate-limit responses such as 429;
- transport or CLI failures with no valid HTTP status;
- other 4xx or 5xx responses;
- a contradictory success exit with a 404 status; or
- invalid JSON or structurally malformed success payloads.

Forgejo-specific errors expose stable categories for invalid input, failed
commands, invalid JSON, and malformed responses. Command errors retain the
operation, command, exit code, and exact HTTP status when available. Raw command
diagnostics remain available for explicit inspection but are not included in
public messages or default serialization, preventing remote credentials and pull
request bodies from leaking.

Foundation errors remain authoritative:

- `PullRequestIdentityError` for incomplete or mismatched repository identity;
- `PullRequestNotFoundError` only for the exact get 404 rule; and
- `IncompletePullRequestSearchError` if pagination cannot safely advance before
  a short page, rather than returning accumulated results.

## Verification strategy

The Testing Value Gate supports automated tests because this adapter contains
reusable parsing, pagination, external command contracts, and safety-sensitive
error classification.

Pure parsing and normalization tests cover:

- HTTP(S), SSH, and scp-like remote URLs, `.git`, malformed paths, and safe
  credential handling;
- renamed or transferred repositories returned by Forgejo;
- complete and inconsistent repository payloads;
- same-repository and cross-owner head identities;
- open, merged, and closed-unmerged normalization;
- missing or mismatched nested base and head repositories; and
- malformed JSON, URLs, branches, numbers, states, and merge data.

Recording-runner command tests cover:

- target and custom push-remote resolution, including a leading-hyphen remote;
- every configured push URL and rejection of divergent destinations;
- exact `tea api`, `git`, `--repo`, `--login`, method, field, and working
  directory arguments;
- owner-qualified cross-owner creation;
- full pages followed by a short page and no partial result after a later-page
  failure;
- exact target, base, head repository, and head branch discovery;
- get, body read, and body update;
- exact API 404 conversion; and
- preservation of authentication, rate-limit, transport, invalid-JSON, and
  malformed-response failures.

Focused validation will run the new parsing and adapter tests. Final validation
will run:

```sh
npm test
npm run build
npm run lint
npm run check:types
npm run check:architecture
git diff --check
```

No dependency changes are planned, so a Nix build is not required. If npm
dependency metadata changes unexpectedly, the implementation must also run the
repository-required Nix build.

## Compatibility and acceptance

The new class is unreachable from current production workflows. Existing Forgejo
issue, setup, and URL-based pull request body behavior remains unchanged.

The design is accepted when:

- `ForgejoTeaPullRequestHost` satisfies the complete foundation interface;
- target and every push destination resolve through Forgejo;
- custom remotes and same-host cross-owner heads work;
- normalized responses strictly validate nested target and head identities;
- discovery requests all states and every page until a short page;
- discovery returns only exact repository and branch matches and never partial
  results;
- only the exact get-endpoint API 404 becomes `PullRequestNotFoundError`;
- command, authentication/rate-limit, transport, JSON, and malformed-response
  failures remain distinguishable from absence;
- command and normalization tests protect the external contract; and
- neither the factory nor run-once is wired to the adapter.
