# Issue 185 GitHub planning pull request adapter design

## Status

The design decisions and review corrections are approved in chat. This
specification records the corrected design.

Issue #185 is a delivery slice of issue #180. Issue #184 supplied the
provider-neutral `PullRequestHost` interface that this adapter implements.

## Summary

Patchmill needs a GitHub adapter for planning pull requests. The adapter uses
the installed `gh` CLI and the neutral `CommandRunner` seam in
`src/process/command.ts`.

Pull request operations use `gh pr`. A focused `gh api graphql` query supplies a
machine-readable pull request existence result before each view.

This slice supports GitHub.com and GitHub Enterprise. It supports a configured
push remote with any valid remote name.

The target repository and every push destination must identify the same
repository. The adapter rejects forks, cross-owner heads, and other
cross-repository pull requests.

This slice does not connect the adapter to a factory or the run-once workflow.
Existing valid runtime behavior stays unchanged.

## Goals

- Implement every method in `PullRequestHost` for GitHub.
- Resolve provider-normalized repository identities through `gh`.
- Resolve every configured push URL for any named Git remote.
- Validate all push destinations before every pull request operation.
- Validate deterministic caller input before command execution.
- Support GitHub.com and authenticated GitHub Enterprise hosts.
- Normalize open, merged, and closed-unmerged pull requests.
- Make successful discovery exhaustive below a configured safety limit.
- Classify proven absence from machine-readable provider fields.
- Give adapter input, command, JSON, and response errors stable identifiers.
- Keep canonical pull request URL syntax in
  `src/host/pull-request-reference.ts`.
- Keep generic command contracts outside CLI command ownership.
- Test exact command contracts and response parsing.

## Non-goals

- Support forks, cross-owner heads, or other cross-repository pull requests.
- Add the Forgejo adapter from issue #186.
- Change `GitHubGhHostProvider` or its existing URL-based body methods.
- Change the host factory or `RunOnceHostProvider`.
- Add project configuration for the discovery limit.
- Connect the adapter to planning phases or the run-once workflow.
- Change run recovery state, labels, publication, or workspace behavior.
- Add a new dependency.

## Fixed foundation interface

The adapter implements `PullRequestHost` from `src/host/pull-requests.ts`. This
issue does not change the provider-neutral interface.

```ts
export interface PullRequestHost {
  readonly id: PatchmillHostProviderId;

  resolveTargetRepositoryIdentity(): Promise<RepositoryIdentity>;
  resolveRemoteRepositoryIdentity(remote: string): Promise<RepositoryIdentity>;
  createPullRequest(input: CreatePullRequestInput): Promise<PullRequestSummary>;
  findPullRequests(
    query: FindPullRequestsQuery,
  ): Promise<readonly PullRequestSummary[]>;
  getPullRequest(reference: PullRequestReference): Promise<PullRequestSummary>;
  readPullRequestBody(reference: PullRequestReference): Promise<string>;
  updatePullRequestBody(
    reference: PullRequestReference,
    body: string,
  ): Promise<void>;
}
```

The adapter uses `sameRepositoryIdentity` for all repository comparisons.
Provider IDs compare exactly. Host, owner, and repository values compare without
case sensitivity.

## Module map

### `src/process/command.ts`

This neutral module owns `CommandRunner`, `CommandResult`, and
`CommandRunOptions`. `src/cli/commands/triage/types.ts` keeps compatibility type
re-exports, but new host code imports the contracts from the neutral module.

### `src/host/pull-request-reference.ts`

This existing module remains the canonical owner of pull request URL syntax. It
adds `parsePullRequestUrl`, and the existing `pullRequestNumber` function
delegates to that structured parser.

### `src/host/github-gh-pull-requests.ts`

This module owns the `GitHubGhPullRequestHost` adapter orchestration and maps
operation outcomes to host errors. Focused command and view modules run `git`
and `gh` commands.

The public constructor accepts these options:

```ts
export type GitHubGhPullRequestHostOptions = {
  runner: CommandRunner;
  repoRoot: string;
  pushRemote: string;
  discoveryLimit?: number;
};
```

The default discovery limit is `1000`. The constructor rejects a blank push
remote or a limit that is not a positive safe integer.

The adapter has `id: "github-gh"`. This module does not export a new factory.

### `src/host/github-gh-pull-request-parsing.ts`

This public facade exports the focused, pure GitHub parsing APIs below.

### `src/host/github-gh-repository-parsing.ts`

This module parses GitHub remote URLs and provider-normalized repository
payloads.

### `src/host/github-gh-pull-request-existence.ts`

This module parses machine-readable pull request existence-probe payloads.

### `src/host/github-gh-pull-request-normalization.ts`

This module normalizes pull request payloads and create-output URLs. It uses
`parsePullRequestUrl` for canonical pull request URLs, then applies GitHub host
and identity rules.

### `src/host/github-gh-pull-request-validation.ts`

This module validates pull request numbers and GitHub head branch names before
command execution.

### `src/host/github-gh-pull-request-commands.ts`

This module executes GitHub and Git commands and resolves repository context.

### `src/host/github-gh-pull-request-view.ts`

This module performs existence probing and normalized pull request views.

The parsing and validation modules have no process, filesystem, or network
access. The command adapter supplies all expected identities and command
context.

### `src/host/github-gh-pull-request-errors.ts`

This module owns stable GitHub adapter error identifiers and diagnostic fields.
It contains no command execution or response parsing.

### Test modules

`src/host/pull-request-reference.test.ts` tests shared pull request URL syntax.

`src/host/github-gh-pull-request-parsing.test.ts` tests GitHub parsing rules.

`src/host/github-gh-pull-requests.test.ts` tests the adapter through a recording
`CommandRunner`. These tests assert required command arguments, dependency
ordering, and observable results.

Each production module must stay below 200 meaningful lines. The focused error
module prevents error contracts from inflating the command or parsing modules.

## Repository identity

A GitHub repository identity has this form:

```ts
{
  provider: "github-gh";
  host: string;
  owner: string;
  repository: string;
}
```

The `host` value is the lowercase hostname from the provider URL. It has no URL
scheme or path.

The `owner` and `repository` values come from `nameWithOwner`. The adapter
preserves the spelling returned by GitHub.

The parser compares `nameWithOwner` with the path in the provider URL. A
mismatch causes `PullRequestIdentityError`.

### Target repository

`resolveTargetRepositoryIdentity()` runs this command from `repoRoot`:

```sh
gh repo view --json nameWithOwner,url
```

The command clears inherited `GH_REPO`. The current Git repository selects the
target repository.

### Named remote

`resolveRemoteRepositoryIdentity(remote)` first runs:

```sh
git remote get-url --push --all -- <remote>
```

`--all` returns every configured push destination. The `--` marker permits a
valid remote name that starts with `-`.

The command must return at least one nonempty URL line. The parser accepts
standard GitHub HTTPS, SSH URL, and scp-like SSH forms. It removes one trailing
`.git` suffix from each URL.

Examples include:

```text
https://github.example.com/team/project.git
ssh://git@github.example.com/team/project.git
git@github.example.com:team/project.git
```

The parser rejects local paths, file URLs, missing owners, missing repository
names, and extra path segments. Error text must not expose URL credentials.

Each parsed URL supplies a repository selector. The adapter runs this command
once for each selector, in returned order:

```sh
gh repo view <host>/<owner>/<repository> --json nameWithOwner,url
```

These commands give provider-normalized identities. GitHub can redirect an old
owner or repository name after a rename or transfer.

Each returned `url` and `nameWithOwner` pair must agree. Each returned host must
match its remote URL host. Returned owners and repository names can differ from
raw URLs after valid provider redirects.

All provider-normalized push identities must match each other through
`sameRepositoryIdentity`. A mismatch causes `PullRequestIdentityError`.

The method returns the shared provider-normalized identity. Repository-context
validation then compares that identity with the target identity.

### Repository context

Before every pull request operation, the adapter resolves the target and every
URL of its configured push remote. The target lookup and configured remote
lookup start together through `Promise.all` because they are independent.

Inside remote resolution, Git URL lookup completes before provider lookup.
Provider lookups for multiple push URLs remain sequential in Git output order.
All provider-normalized identities must match.

A mismatch causes `PullRequestIdentityError` before any `gh pr` command. This
rule applies to create, discovery, get, body read, and body update operations.
Tests assert these dependency boundaries without fixing an order between
independent target and remote work.

## Canonical pull request URLs

`parsePullRequestUrl(value, pathSegment)` in
`src/host/pull-request-reference.ts` owns shared pull request URL syntax. It
accepts HTTP or HTTPS URLs with a hostname, exactly four path segments, a
positive safe integer number, and at most one trailing slash. It rejects
credentials, queries, fragments, empty path segments, and extra path segments
without including raw URLs in errors.

The structured result contains the protocol, lowercase hostname, port, owner,
repository, number, and trailing-slash state. `pullRequestNumber` delegates to
this parser. Existing `sameCanonicalUrl` behavior stays unchanged.

The GitHub parsing module calls this shared parser with path segment `pull`. It
translates shared parser failures to a stable GitHub response error with no raw
URL. It then requires HTTPS, no non-default port, the expected host, repository
owner, repository name, and a number in `1..2147483647`.

## Pull request payload

The adapter requests these exact fields:

```text
number,url,state,mergeCommit,baseRefName,headRefName,headRefOid,headRepository,body
```

A valid payload contains:

- A positive pull request number no greater than `2147483647`.
- A canonical pull request URL for the expected target repository and number.
- A nonempty base branch and head branch.
- A nonempty head commit ID.
- A string body.
- A complete `headRepository.nameWithOwner` value.
- A supported state and consistent merge data.

The target identity comes from the resolved target repository. The URL path must
identify that target.

The head identity uses the target host and `headRepository.nameWithOwner`. The
head identity must match the target identity because cross-repository support is
out of scope.

State mapping is exact:

| GitHub state | Patchmill status  | Merge data                   |
| ------------ | ----------------- | ---------------------------- |
| `OPEN`       | `open`            | No merge commit              |
| `MERGED`     | `merged`          | A required `mergeCommit.oid` |
| `CLOSED`     | `closed-unmerged` | No merge commit              |

An unknown state or inconsistent merge data is a malformed response.

## Pull request operations

All `gh pr` commands use an explicit target selector. The selector has the form
`<host>/<owner>/<repository>`.

All commands run from `repoRoot` and clear inherited `GH_REPO`.

### Create

`createPullRequest(input)` validates `input.headBranch` before any command. The
head branch must be a nonblank, unqualified Git branch name.

The adapter rejects a colon because `gh` uses `<owner>:<branch>` for a
cross-repository head. It also rejects a leading `-`, a `refs/` prefix, the
exact name `HEAD`, control or space characters, `~`, `^`, `?`, `*`, `[`, and
`\`.

The branch cannot contain `..`, `@{`, `//`, a component that starts with `.`, or
a component that ends in `.lock`. It cannot start or end with `/` or end with
`.`. The valid branch name `@` remains accepted.

Invalid input causes `GitHubPullRequestInputError` before repository resolution
or pull request creation.

After input validation, `createPullRequest(input)` resolves the shared
repository context. It throws `PullRequestIdentityError` before creation if the
identities differ.

The adapter derives the provider head operand from the resolved target owner and
the validated branch. Caller input can supply only the branch part.

The adapter then runs:

```sh
gh pr create \
  --repo <target> \
  --base <baseBranch> \
  --head <resolved-owner>:<headBranch> \
  --title <title> \
  --body <body>
```

The command output must contain exactly one valid pull request URL for the
target. Empty output, malformed URLs, or multiple URLs cause a response error.

The adapter uses the machine-readable existence probe and `gh pr view` to read
the created pull request. It reuses the resolved context and returns the
normalized summary.

### Exact discovery

`findPullRequests(query)` first validates `query.headBranch` before any command.
The same unqualified Git branch rules used for creation apply. Invalid input
causes `GitHubPullRequestInputError` before repository resolution or discovery.

The method then resolves the shared repository context. The query target must
match the resolved target.

The query head repository must also match the target. A context or query
mismatch causes `PullRequestIdentityError` before discovery.

The adapter runs:

```sh
gh pr list \
  --repo <target> \
  --state all \
  --base <baseBranch> \
  --head <headBranch> \
  --limit <discoveryLimit> \
  --json <fields>
```

The adapter requires a JSON array. It throws `IncompletePullRequestSearchError`
if the array length reaches the configured limit.

A result below the limit proves that `gh` exhausted the filtered result set. The
adapter then normalizes every item and applies exact identity and branch checks.

A successful result is exhaustive. The adapter never returns a partial array.

### Get

`getPullRequest(reference)` first validates that `reference.number` is an
integer from `1` through `2147483647`. This maximum matches the signed 32-bit
GraphQL `Int` type.

Invalid input causes `GitHubPullRequestInputError` before any command.

The method then resolves the shared repository context. The reference target
must match the resolved target.

Before `gh pr view`, the adapter runs this GraphQL existence query:

```graphql
query PatchmillPullRequestExists(
  $owner: String!
  $repository: String!
  $number: Int!
) {
  repository(owner: $owner, name: $repository) {
    nameWithOwner
    pullRequest(number: $number) {
      number
    }
  }
}
```

The exact command is:

```sh
gh api graphql \
  --hostname <host> \
  --raw-field query=<query> \
  --field owner=<owner> \
  --field repository=<repository> \
  --field number=<number>
```

A present pull request has a matching repository identity and pull request
number in `data.repository`. The command must exit with code `0`.

Only this machine-readable combination proves absence:

- The `gh api graphql` command exits with code `1`.
- `data.repository.nameWithOwner` matches the expected repository.
- `data.repository.pullRequest` is `null`.
- `errors` contains exactly one entry.
- The error `type` is `NOT_FOUND`.
- The error `path` is exactly `["repository", "pullRequest"]`.

The adapter does not inspect the GraphQL error message. Proven absence becomes
`PullRequestNotFoundError` with the original reference.

Exit codes `2` and `4` become `GitHubPullRequestCommandError` before response
parsing. The structured absence payload cannot override cancellation or
authentication.

For exit code `1`, a nonempty response is parsed only to test the complete
absence signature. A different result becomes `GitHubPullRequestCommandError`.

For exit code `0`, only a valid present result can continue. A missing or
provider-error result becomes `GitHubPullRequestResponseError`.

Invalid nonempty JSON causes `GitHubPullRequestJsonError`. The parser never
falls back to diagnostic-text matching.

After a successful presence result, the adapter runs:

```sh
gh pr view <number> --repo <target> --json <fields>
```

It normalizes one payload and rejects a cross-repository head.

### Read body

`readPullRequestBody(reference)` validates the number at its public boundary. It
then uses the shared internal get path and returns the normalized body.

This operation does not use the old URL-based body helper.

### Update body

`updatePullRequestBody(reference, body)` validates the number at its public
boundary. It then uses the shared internal get path to validate the target and
same-repository head before mutation.

The adapter keeps the normalized `PullRequestSummary` from that path. It uses
the summary number and target repository to build the edit command. It does not
read command identity from the caller-owned reference after validation.

The adapter then runs:

```sh
gh pr edit <validated-number> --repo <validated-target> --body <body>
```

The command uses argument arrays, not a shell. Newlines and shell characters in
the body stay inside one argument.

## Discovery limit

The discovery limit is an adapter option, not project configuration. A later
pipeline issue can pass a project value without changing `PullRequestHost`.

The default is `1000`. Tests use small limits to exercise the cap.

A result count equal to the limit is ambiguous. More provider results can exist.
The adapter therefore throws `IncompletePullRequestSearchError` at the limit,
even when the provider has exactly that many results.

The error includes the original query and configured limit.

## Error handling

The adapter fails closed and exposes stable error identifiers. Callers classify
errors by class, `code`, and typed fields. They do not parse error messages.

### Adapter error contract

`src/host/github-gh-pull-request-errors.ts` exports these error categories:

```ts
export type GitHubPullRequestInputReason =
  | "blank-push-remote"
  | "invalid-discovery-limit"
  | "invalid-pull-request-number"
  | "blank-head-branch"
  | "qualified-head-branch"
  | "invalid-head-branch";

export class GitHubPullRequestInputError extends Error {
  readonly code = "github-pull-request-invalid-input" as const;
  readonly reason: GitHubPullRequestInputReason;
}

export type GitHubPullRequestCommandOperation =
  | "resolve-target-repository"
  | "read-push-remote-urls"
  | "resolve-push-repository"
  | "probe-pull-request"
  | "create-pull-request"
  | "list-pull-requests"
  | "view-pull-request"
  | "edit-pull-request";

export class GitHubPullRequestCommandError extends Error {
  readonly code = "github-pull-request-command-failed" as const;
  readonly reason: "authentication-required" | "command-failed";
  readonly operation: GitHubPullRequestCommandOperation;
  readonly command: "git" | "gh";
  readonly exitCode: number;
  readonly diagnostics: CommandResult;
}

export class GitHubPullRequestJsonError extends Error {
  readonly code = "github-pull-request-invalid-json" as const;
  readonly context: string;
  override readonly cause: SyntaxError;
}

export type GitHubPullRequestResponseReason =
  | "remote-url-list"
  | "remote-url"
  | "repository-payload"
  | "pull-request-existence-payload"
  | "pull-request-payload"
  | "pull-request-state"
  | "pull-request-url"
  | "pull-request-list"
  | "pull-request-create-output";

export class GitHubPullRequestResponseError extends Error {
  readonly code = "github-pull-request-malformed-response" as const;
  readonly reason: GitHubPullRequestResponseReason;
  readonly context: string;
}
```

A `gh` exit code of `4` gives command-error reason `authentication-required`.
Except for proven absence, all other nonzero `git` or `gh` results use
`command-failed`.

The adapter does not infer permission, rate-limit, or transport subtypes from
human-readable output. These failures remain command errors with a stable exit
code.

The error message contains only the operation and exit code. The non-enumerable
`diagnostics` field retains a copy of the original `CommandResult` for explicit
inspection.

Default serialization must not expose standard output, standard error,
credentials, pull request bodies, or command arguments. Tests assert stable
classes, codes, reasons, operations, and fields instead of message text.

### Proven absence

Only the complete structured GraphQL result in the Get section proves that a
pull request is absent. The adapter ignores the GraphQL error message.

This result becomes `PullRequestNotFoundError` with the original reference. No
other nonzero command result becomes `PullRequestNotFoundError`.

### Identity and completeness errors

Missing repository identity fields and repository mismatches cause
`PullRequestIdentityError`. The error includes expected and actual identities
when they are available.

Discovery that reaches the configured limit causes
`IncompletePullRequestSearchError` with the original query and limit.

### JSON and response errors

Invalid JSON causes `GitHubPullRequestJsonError`. The original `SyntaxError` is
its cause.

Missing non-identity fields, unknown states, inconsistent merge data, and other
invalid structured payloads cause `GitHubPullRequestResponseError` with a stable
reason.

## Testing

The Testing Value Gate supports automated tests for this slice. The adapter
contains reusable parsing, external command contracts, and important error
classification.

### Parsing tests

The shared and GitHub parsing tests cover:

- Structured pull request URL parsing in the canonical shared module.
- One optional trailing slash and rejection of empty or extra path segments.
- Compatibility of `pullRequestNumber` with the structured parser.
- GitHub.com and GitHub Enterprise identities.
- HTTPS, SSH URL, and scp-like remote forms.
- A trailing `.git` suffix.
- A provider redirect from an old repository slug to its current identity.
- Local, file, incomplete, and overlong remote paths.
- Credential-bearing malformed URLs whose errors do not contain credentials.
- Repository payload and URL mismatches.
- Machine-readable present, missing, and malformed existence payloads.
- Blank, qualified, and invalid GitHub head branch names, including `HEAD`.
- Acceptance of the valid Git branch name `@`.
- Pull request numbers inside and outside the GraphQL signed 32-bit range.
- Stable input, JSON, and malformed-response error fields.
- Open, merged, and closed-unmerged summaries.
- Invalid JSON, missing fields, unknown states, and invalid merge data.
- Pull request URLs that identify a different target or number.
- Cross-repository head identities.

### Adapter command tests

A recording runner returns scripted command results. The tests assert command,
arguments, working directory, and cleared `GH_REPO` values.

The command tests cover:

- Constructor defaults and invalid constructor options.
- Target identity resolution.
- Concurrent target and configured remote resolution.
- Required ordering inside remote resolution without ordering independent work.
- A custom push remote name and a leading-hyphen remote name.
- `--all --` placement in the push-URL lookup command.
- Multiple same-repository push URLs.
- Rejection of one mismatched push URL before a pull request command.
- Host-qualified selectors for GitHub Enterprise commands.
- Same-repository creation and read-back.
- A provider head operand derived from the resolved owner and validated branch.
- Rejection of blank, qualified, and invalid create heads before any command.
- Rejection of invalid discovery heads before any command.
- Empty, malformed, and multiple-URL create responses.
- Rejection of a different push-remote repository before creation.
- Rejection of a different push-remote repository before discovery and update.
- Exact discovery across all states.
- Complete results below the discovery limit.
- Fail-closed behavior at the discovery limit.
- Get, body read, and body update operations.
- Update commands built from the normalized pull request summary.
- No-command rejection of invalid reference numbers at each public method.
- Machine-readable missing pull request classification without message matching.
- Rejection of the same missing payload with exit codes `0`, `2`, and `4`.
- Stable error identifiers for input, command, JSON, and malformed responses.
- Non-disclosure of credentials and pull request bodies in messages and default
  serialization.
- Preservation of authentication, rate-limit, transport, and malformed errors.
- Rejection of mismatched query, reference, payload, and head identities.

No live test creates or edits a GitHub pull request.

### Validation commands

Focused development uses:

```sh
node --test src/host/pull-request-reference.test.ts
node --test src/host/github-gh-pull-request-parsing.test.ts
node --test src/host/github-gh-pull-requests.test.ts
```

Final validation uses:

```sh
npm test
npm run build
npm run lint
npm run check:types
npm run check:architecture
```

No new test asserts that factory or pipeline files remain unchanged. The final
diff verifies this static constraint.

## Compatibility

The new adapter is unreachable from current production workflows. Existing valid
GitHub issue, repository setup, and pull request body behavior stays unchanged.

The shared URL parser now rejects malformed paths and unsafe numeric values that
the old number helper could accept. It also removes raw URLs from validation
errors.

The adapter uses only the neutral `CommandRunner`, Node.js APIs, and installed
`gh` CLI. Triage keeps compatibility type re-exports from the previous path.
This slice adds no package dependency.

No glossary change is necessary. The design uses existing Patchmill and Git
terms. No ADR is necessary because the foundation interface and issue scope
already set the architectural seam.

## Acceptance criteria

- `GitHubGhPullRequestHost` satisfies every `PullRequestHost` method.
- Generic command contracts live in `src/process/command.ts` with compatibility
  re-exports for triage.
- Canonical pull request URL syntax lives in
  `src/host/pull-request-reference.ts`.
- GitHub.com and authenticated GitHub Enterprise identities normalize correctly.
- The configured push remote can have any valid remote name, including one that
  starts with `-`.
- Every configured push URL resolves to the same provider-normalized identity.
- Target and configured remote resolution start concurrently. Dependent remote
  operations remain ordered.
- The target and all push destinations must identify the same repository.
- Invalid caller-supplied head branches and reference numbers outside
  `1..2147483647` fail before any command.
- Create derives its provider head operand from the resolved owner and validated
  branch.
- Every pull request operation validates its repository context before its
  `gh pr` command.
- Redirected repository slugs resolve to the provider-normalized identity.
- Forks, cross-owner heads, and other cross-repository pull requests fail
  closed.
- Create, exact discovery, get, body read, and body update have required
  command-contract tests.
- Body update uses the normalized summary instead of caller-owned reference
  fields.
- Successful discovery is exhaustive below the configured limit.
- Discovery throws `IncompletePullRequestSearchError` at the configured limit.
- Only exit code `1` with the machine-readable GraphQL absence signature becomes
  `PullRequestNotFoundError`.
- Human-readable command output never controls error classification.
- Input, command, JSON, malformed-response, identity, incomplete-search, and
  absence errors have stable identifiers.
- Authentication, rate-limit, and transport failures remain command errors with
  non-enumerable diagnostics.
- Error messages and default serialization do not expose credentials, bodies, or
  raw command output.
- The adapter is not wired into the host factory or run-once workflow.
