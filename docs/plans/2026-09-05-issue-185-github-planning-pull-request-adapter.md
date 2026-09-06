# GitHub Planning Pull Request Adapter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `gh`-based GitHub adapter that implements the provider-neutral
planning pull request interface without runtime wiring.

**Architecture:** Put shared pull request URL syntax and generic command
contracts in existing neutral seams. Keep GitHub response parsing, stable
adapter errors, and command execution in three focused modules. Validate
deterministic input before commands, then resolve the target and every
provider-normalized push destination before each pull request operation.

**Tech Stack:** TypeScript, Node.js 22 test runner, the neutral `CommandRunner`
interface, Git, and GitHub CLI (`gh`).

**Spec:**
`docs/specs/2026-09-05-issue-185-github-planning-pull-request-adapter-design.md`

## Global Constraints

- Implement the existing `PullRequestHost` interface without changing it.
- Add a separate `GitHubGhPullRequestHost`. Do not extend
  `GitHubGhHostProvider`.
- Accept `runner`, `repoRoot`, `pushRemote`, and optional `discoveryLimit`
  constructor options.
- Use `1000` as the default discovery limit.
- Reject a blank push remote and a discovery limit that is not a positive safe
  integer.
- Support GitHub.com and authenticated GitHub Enterprise hosts.
- Support every valid configured Git remote name, including one that starts with
  `-`.
- Read every push URL with `git remote get-url --push --all -- <remote>`.
- Resolve provider-normalized target and push-remote identities before each pull
  request operation.
- Start independent target and configured remote resolution through
  `Promise.all`.
- Keep Git URL lookup before its provider lookups and process push URLs
  sequentially.
- Require the target and every push destination to resolve to the same
  repository.
- Reject caller-supplied reference numbers outside `1..2147483647` and invalid
  head branches before any command.
- Reject forks, cross-owner heads, and all cross-repository pull requests.
- Use host-qualified selectors in the form `<host>/<owner>/<repository>` for
  every `gh pr` command.
- Clear inherited `GH_REPO` for every `gh` command.
- Run every `git` and `gh` command from `repoRoot`.
- Fail discovery with `IncompletePullRequestSearchError` when the result count
  reaches the configured limit.
- Use structured GraphQL `type`, `path`, repository, and pull request fields to
  prove absence.
- Do not classify errors from human-readable command output.
- Expose stable identifiers for input, command, JSON, malformed-response,
  identity, incomplete-search, and absence errors.
- Own generic command contracts in `src/process/command.ts`.
- Own canonical pull request URL syntax in `src/host/pull-request-reference.ts`.
- Keep each production module below 200 meaningful lines.
- Add no package dependency.
- Do not change Forgejo, factory wiring, pipeline integration, or `run-once`
  wiring.
- Use recording-runner tests only. Do not create or edit a live pull request.

## File Map

- Create `src/process/command.ts` for neutral command contracts.
- Modify `src/cli/commands/triage/types.ts` to re-export the command contracts
  for compatibility.
- Modify `src/cli/commands/triage/command.ts` to import command contracts from
  their neutral owner.
- Modify `test-support/command-runner.ts` to import command contracts from their
  neutral owner.
- Modify `src/host/pull-request-reference.ts` to add the canonical structured
  pull request URL parser.
- Modify `src/host/pull-request-reference.test.ts` for shared URL parser
  behavior.
- Create `src/host/github-gh-pull-request-parsing.ts` for GitHub remote,
  repository, and pull request parsing.
- Create `src/host/github-gh-pull-request-parsing.test.ts` for parser and
  normalization behavior.
- Create `src/host/github-gh-pull-request-errors.ts` for stable adapter error
  identifiers and diagnostic fields.
- Create `src/host/github-gh-pull-requests.ts` for command execution and
  `PullRequestHost` behavior.
- Create `src/host/github-gh-pull-requests.test.ts` for exact `git` and `gh`
  command contracts.
- Do not modify `src/host/pull-requests.ts`. It is the fixed provider-neutral
  seam.
- Do not modify `src/host/github-gh.ts`. The new adapter stays separate from the
  existing large provider.

---

### Task 1: Move command contracts to neutral ownership

**Files:**

- Create: `src/process/command.ts`
- Modify: `src/cli/commands/triage/types.ts`
- Modify: `src/cli/commands/triage/command.ts`
- Modify: `test-support/command-runner.ts`

**Interfaces:**

- Produces: `CommandResult`, `CommandRunOptions`, and `CommandRunner` from
  `src/process/command.ts`.
- Preserves: compatibility type exports from `src/cli/commands/triage/types.ts`.
- Preserves: all existing command-runner behavior.

- [ ] **Step 1: Create the neutral command contract module**

Create `src/process/command.ts` with the existing contracts:

```ts
export type CommandResult = {
  code: number;
  stdout: string;
  stderr: string;
};

export type CommandRunOptions = {
  cwd?: string;
  env?: Record<string, string | undefined>;
  onStdout?: (chunk: string) => void;
  onStderr?: (chunk: string) => void;
  signal?: AbortSignal;
};

export type CommandRunner = {
  run(
    command: string,
    args: string[],
    options?: CommandRunOptions,
  ): Promise<CommandResult>;
};
```

- [ ] **Step 2: Replace triage ownership with compatibility exports**

Remove the three command contract declarations from
`src/cli/commands/triage/types.ts`. Add this export after its imports:

```ts
export type {
  CommandResult,
  CommandRunner,
  CommandRunOptions,
} from "../../../process/command.ts";
```

The compatibility export prevents a repository-wide import migration in this
issue.

Change `src/cli/commands/triage/command.ts` to import `CommandResult` and
`CommandRunner` from `../../../process/command.ts`.

Change `test-support/command-runner.ts` to import both types from
`../src/process/command.ts`.

All new GitHub pull request modules in later tasks must import command contracts
from `src/process/command.ts`, never from triage.

- [ ] **Step 3: Format and verify the moved seam**

Run:

```bash
npx prettier --write \
  src/process/command.ts \
  src/cli/commands/triage/types.ts \
  src/cli/commands/triage/command.ts \
  test-support/command-runner.ts
node --test src/cli/commands/triage/command.test.ts
npm run check:types
```

Expected: the existing command-runner tests and type check pass. Do not add a
test that only asserts an import path.

- [ ] **Step 4: Commit the neutral command seam**

```bash
git add \
  src/process/command.ts \
  src/cli/commands/triage/types.ts \
  src/cli/commands/triage/command.ts \
  test-support/command-runner.ts
git commit -m "refactor(core): move command contracts to neutral module"
```

---

### Task 2: Add shared URL parsing and stable GitHub parsers

**Files:**

- Modify: `src/host/pull-request-reference.ts`
- Modify: `src/host/pull-request-reference.test.ts`
- Create: `src/host/github-gh-pull-request-errors.ts`
- Create: `src/host/github-gh-pull-request-parsing.ts`
- Create: `src/host/github-gh-pull-request-parsing.test.ts`

**Interfaces:**

- Consumes: `RepositoryIdentity`, `PullRequestReference`, `PullRequestSummary`,
  `FindPullRequestsQuery`, `sameRepositoryIdentity`,
  `IncompletePullRequestSearchError`, and `PullRequestIdentityError` from
  `src/host/pull-requests.ts`.
- Produces: `ParsedPullRequestUrl` and `parsePullRequestUrl` from the canonical
  shared URL module.
- Preserves: the `pullRequestNumber` export and its valid-URL results. Its
  malformed-input validation becomes stricter.
- Preserves: existing `sameCanonicalUrl` behavior.
- Produces: stable GitHub adapter error classes and reason unions.
- Produces: `GitHubRepositorySelector`, `githubRepositorySelector`,
  `assertGitHubHeadBranch`, `assertPullRequestNumber`,
  `parseGitHubRemoteRepositorySelector`, `parseGitHubRepositoryIdentity`,
  `parseGitHubPullRequestExistence`, `parseGitHubPullRequest`,
  `parseGitHubPullRequests`, and `parseCreatedGitHubPullRequest`.

- [ ] **Step 1: Write the shared URL and GitHub repository parsing tests**

Extend `src/host/pull-request-reference.test.ts` with structured parser tests:

```ts
import {
  parsePullRequestUrl,
  pullRequestNumber,
  sameCanonicalUrl,
} from "./pull-request-reference.ts";

assert.deepEqual(
  parsePullRequestUrl("https://github.com/acme/repo/pull/42", "pull"),
  {
    protocol: "https:",
    hostname: "github.com",
    port: "",
    owner: "acme",
    repository: "repo",
    number: 42,
    hasTrailingSlash: false,
  },
);
assert.equal(
  parsePullRequestUrl("https://github.com/acme/repo/pull/42/", "pull")
    .hasTrailingSlash,
  true,
);
assert.equal(
  pullRequestNumber("https://github.com/acme/repo/pull/42", "pull"),
  parsePullRequestUrl("https://github.com/acme/repo/pull/42", "pull").number,
);
```

Add rejection tests for FTP and file URLs, credentials, queries, fragments,
empty path segments, extra path segments, a wrong provider path segment, zero,
and a number above `Number.MAX_SAFE_INTEGER`. For a credential-bearing URL,
assert that the error message does not contain the username or password.

Create the GitHub parser test file with fixed GitHub.com and GitHub Enterprise
identities:

```ts
import assert from "node:assert/strict";
import test from "node:test";
import {
  IncompletePullRequestSearchError,
  PullRequestIdentityError,
  type FindPullRequestsQuery,
  type RepositoryIdentity,
} from "./pull-requests.ts";
import {
  GitHubPullRequestInputError,
  GitHubPullRequestJsonError,
  GitHubPullRequestResponseError,
} from "./github-gh-pull-request-errors.ts";
import {
  githubRepositorySelector,
  parseGitHubRemoteRepositorySelector,
  parseGitHubRepositoryIdentity,
} from "./github-gh-pull-request-parsing.ts";

const target: RepositoryIdentity = {
  provider: "github-gh",
  host: "github.com",
  owner: "rochecompaan",
  repository: "patchmill",
};

const enterpriseTarget: RepositoryIdentity = {
  provider: "github-gh",
  host: "github.example.com",
  owner: "Platform",
  repository: "Patchmill",
};
```

Add table tests for these accepted remote values and expected selectors:

```ts
const remoteCases = [
  [
    "https://github.com/rochecompaan/patchmill.git",
    { host: "github.com", owner: "rochecompaan", repository: "patchmill" },
  ],
  [
    "ssh://git@github.example.com/Platform/Patchmill.git",
    {
      host: "github.example.com",
      owner: "Platform",
      repository: "Patchmill",
    },
  ],
  [
    "git@github.example.com:Platform/Patchmill.git",
    {
      host: "github.example.com",
      owner: "Platform",
      repository: "Patchmill",
    },
  ],
] as const;

for (const [remote, expected] of remoteCases) {
  test(`parses GitHub remote ${remote}`, () => {
    assert.deepEqual(parseGitHubRemoteRepositorySelector(remote), expected);
  });
}
```

Add rejection tests for these values:

```text
../patchmill
/home/user/patchmill
file:///home/user/patchmill
https://github.com/owner
https://github.com/owner/repository/extra
ssh://git@github.example.com/owner
```

Use a credential-bearing malformed URL in one rejection test:

```ts
const remote =
  "https://secret-user:secret-token@github.example.com/owner/repository/extra";
const error = assert.throws(() => parseGitHubRemoteRepositorySelector(remote));
assert.doesNotMatch(error.message, /secret-user|secret-token/u);
```

Add tests for these repository payload rules:

- A GitHub.com payload returns `target`.
- A GitHub Enterprise payload returns `enterpriseTarget` and lowercases its
  host.
- `githubRepositorySelector(enterpriseTarget)` returns
  `github.example.com/Platform/Patchmill`.
- A response for a redirected slug can return a different owner and repository
  from the raw remote selector.
- The response host must match the remote host supplied to
  `parseGitHubRepositoryIdentity`.
- `nameWithOwner` must contain one owner and one repository.
- The `url` path and `nameWithOwner` must identify the same repository.
- Invalid JSON throws `GitHubPullRequestJsonError` with code
  `github-pull-request-invalid-json` and retains the `SyntaxError` as
  `error.cause`.
- Invalid remote and repository payloads use `GitHubPullRequestResponseError`
  with stable reason values.

Use this redirect fixture:

```ts
const redirected = parseGitHubRepositoryIdentity(
  JSON.stringify({
    nameWithOwner: "new-owner/new-name",
    url: "https://github.example.com/new-owner/new-name",
  }),
  "github.example.com",
);
assert.deepEqual(redirected, {
  provider: "github-gh",
  host: "github.example.com",
  owner: "new-owner",
  repository: "new-name",
});
```

- [ ] **Step 2: Run the repository parser tests and verify the expected
      failure**

Run:

```bash
node --test src/host/pull-request-reference.test.ts
node --test src/host/github-gh-pull-request-parsing.test.ts
```

Expected: both commands fail because the structured shared parser and GitHub
parsing module do not exist.

- [ ] **Step 3: Implement the shared URL parser, stable errors, and repository
      parsing**

Refactor `src/host/pull-request-reference.ts` around this public structured
result:

```ts
export type ParsedPullRequestUrl = Readonly<{
  protocol: "http:" | "https:";
  hostname: string;
  port: string;
  owner: string;
  repository: string;
  number: number;
  hasTrailingSlash: boolean;
}>;

export function parsePullRequestUrl(
  prUrl: string,
  pathSegment: string,
): ParsedPullRequestUrl;
```

Keep one private URL constructor that rejects credentials, queries, and
fragments. In `parsePullRequestUrl`, require an HTTP or HTTPS protocol, a
hostname, and this exact path shape:

```ts
const match = /^\/([^/]+)\/([^/]+)\/([^/]+)\/([1-9]\d*)(\/?)$/u.exec(
  url.pathname,
);
```

Require `match[3] === pathSegment`. Convert `match[4]` to a number and require a
positive safe integer. Return the protocol, lowercase hostname, port, owner,
repository, number, and `hasTrailingSlash: match[5] === "/"`.

All structured parser failures throw `new Error("Invalid pull request URL")`. Do
not include the raw URL in the message.

Implement `pullRequestNumber` by returning
`parsePullRequestUrl(prUrl, pathSegment).number`. Keep `sameCanonicalUrl`
behavior unchanged, including one optional trailing slash.

Create `src/host/github-gh-pull-request-errors.ts`. Use this complete public
error contract:

```ts
import type { CommandResult } from "../process/command.ts";

export type GitHubPullRequestInputReason =
  | "blank-push-remote"
  | "invalid-discovery-limit"
  | "invalid-pull-request-number"
  | "blank-head-branch"
  | "qualified-head-branch"
  | "invalid-head-branch";

export type GitHubPullRequestCommandOperation =
  | "resolve-target-repository"
  | "read-push-remote-urls"
  | "resolve-push-repository"
  | "probe-pull-request"
  | "create-pull-request"
  | "list-pull-requests"
  | "view-pull-request"
  | "edit-pull-request";

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

export class GitHubPullRequestInputError extends Error {
  readonly code = "github-pull-request-invalid-input" as const;
  constructor(
    readonly reason: GitHubPullRequestInputReason,
    message: string,
  ) {
    super(message);
    this.name = "GitHubPullRequestInputError";
  }
}

export class GitHubPullRequestCommandError extends Error {
  readonly code = "github-pull-request-command-failed" as const;
  readonly reason: "authentication-required" | "command-failed";
  readonly exitCode: number;
  declare readonly diagnostics: Readonly<CommandResult>;

  constructor(
    readonly operation: GitHubPullRequestCommandOperation,
    readonly command: "git" | "gh",
    result: CommandResult,
  ) {
    super(`${operation} failed with exit code ${result.code}`);
    this.name = "GitHubPullRequestCommandError";
    this.reason =
      command === "gh" && result.code === 4
        ? "authentication-required"
        : "command-failed";
    this.exitCode = result.code;
    Object.defineProperty(this, "diagnostics", {
      value: Object.freeze({ ...result }),
      enumerable: false,
      configurable: false,
      writable: false,
    });
  }
}

export class GitHubPullRequestJsonError extends Error {
  readonly code = "github-pull-request-invalid-json" as const;
  override readonly cause: SyntaxError;

  constructor(
    readonly context: string,
    cause: SyntaxError,
  ) {
    super(`${context} returned invalid JSON`, { cause });
    this.name = "GitHubPullRequestJsonError";
    this.cause = cause;
  }
}

export class GitHubPullRequestResponseError extends Error {
  readonly code = "github-pull-request-malformed-response" as const;
  constructor(
    readonly reason: GitHubPullRequestResponseReason,
    readonly context: string,
  ) {
    super(`${context} returned a malformed response: ${reason}`);
    this.name = "GitHubPullRequestResponseError";
  }
}
```

Use fixed operation and context labels when constructing these errors. Do not
place remote URLs, response payloads, pull request bodies, titles, or command
arguments in messages or enumerable fields.

Create `src/host/github-gh-pull-request-parsing.ts` with this public surface:

```ts
export type GitHubRepositorySelector = {
  host: string;
  owner: string;
  repository: string;
};

export function githubRepositorySelector(
  repository: GitHubRepositorySelector,
): string;

export function parseGitHubRemoteRepositorySelector(
  remoteUrl: string,
): GitHubRepositorySelector;

export function parseGitHubRepositoryIdentity(
  stdout: string,
  expectedHost?: string,
): RepositoryIdentity;
```

Use one local JSON helper for every parser in this module:

```ts
function parseJson(stdout: string, context: string): unknown {
  try {
    return JSON.parse(stdout) as unknown;
  } catch (cause) {
    if (!(cause instanceof SyntaxError)) throw cause;
    throw new GitHubPullRequestJsonError(context, cause);
  }
}
```

This catch handles only the expected `JSON.parse` syntax failure. It rethrows
that failure with a stable code and preserves the `SyntaxError` as its cause.

For URL-form remotes, accept only `https:` and `ssh:` URLs. For scp-like
remotes, parse the host and path without a shell.

Normalize remote paths with this sequence:

1. Remove the leading slash from a URL path.
2. Remove one trailing `.git` suffix.
3. Split the remaining path on `/`.
4. Require exactly two nonempty segments.
5. Throw `GitHubPullRequestResponseError` with reason `remote-url` and no input
   URL in the message.

Parse repository payloads as `{ nameWithOwner, url }`. Require a valid provider
URL with exactly two path segments.

Compare the provider URL path with `nameWithOwner` without case sensitivity.
Preserve the owner and repository spelling from `nameWithOwner`.

Throw `PullRequestIdentityError` for a missing identity field, a path mismatch,
or an expected-host mismatch. Include `expected` and `actual` identities when
both values are available.

- [ ] **Step 4: Run the repository parser tests and verify success**

Run:

```bash
node --test src/host/pull-request-reference.test.ts
node --test src/host/github-gh-pull-request-parsing.test.ts
```

Expected: PASS for the shared URL, repository, and remote parser tests.

- [ ] **Step 5: Write the pull request payload tests**

Extend the parser import before the new tests:

```diff
 import {
+  assertGitHubHeadBranch,
+  assertPullRequestNumber,
   githubRepositorySelector,
+  parseCreatedGitHubPullRequest,
+  parseGitHubPullRequest,
+  parseGitHubPullRequestExistence,
+  parseGitHubPullRequests,
   parseGitHubRemoteRepositorySelector,
   parseGitHubRepositoryIdentity,
 } from "./github-gh-pull-request-parsing.ts";
```

Add input-validation tests before payload tests:

```ts
assert.doesNotThrow(() => assertGitHubHeadBranch("agent/issue-185-adapter"));
assert.doesNotThrow(() => assertGitHubHeadBranch("@"));

for (const [headBranch, reason] of [
  ["", "blank-head-branch"],
  ["   ", "blank-head-branch"],
  ["owner:branch", "qualified-head-branch"],
  ["-branch", "invalid-head-branch"],
  ["refs/heads/branch", "invalid-head-branch"],
  ["feature branch", "invalid-head-branch"],
  ["feature..name", "invalid-head-branch"],
  ["feature@{name", "invalid-head-branch"],
  ["feature//name", "invalid-head-branch"],
  ["feature/.hidden", "invalid-head-branch"],
  ["feature/name.lock", "invalid-head-branch"],
  ["HEAD", "invalid-head-branch"],
] as const) {
  assert.throws(
    () => assertGitHubHeadBranch(headBranch),
    (error: unknown) => {
      assert.ok(error instanceof GitHubPullRequestInputError);
      assert.equal(error.code, "github-pull-request-invalid-input");
      assert.equal(error.reason, reason);
      return true;
    },
  );
}

assert.doesNotThrow(() => assertPullRequestNumber(2_147_483_647));

for (const number of [
  0,
  -1,
  1.5,
  2_147_483_648,
  Number.MAX_SAFE_INTEGER + 1,
  NaN,
  Infinity,
]) {
  assert.throws(
    () => assertPullRequestNumber(number),
    (error: unknown) => {
      assert.ok(error instanceof GitHubPullRequestInputError);
      assert.equal(error.reason, "invalid-pull-request-number");
      return true;
    },
  );
}
```

Add machine-readable existence tests with these fixtures:

```ts
const present = {
  data: {
    repository: {
      nameWithOwner: "rochecompaan/patchmill",
      pullRequest: { number: 42 },
    },
  },
};
const missing = {
  data: {
    repository: {
      nameWithOwner: "rochecompaan/patchmill",
      pullRequest: null,
    },
  },
  errors: [
    {
      type: "NOT_FOUND",
      path: ["repository", "pullRequest"],
      message: "This diagnostic text is not an identifier.",
    },
  ],
};

assert.equal(
  parseGitHubPullRequestExistence(JSON.stringify(present), target, 42),
  "present",
);
assert.equal(
  parseGitHubPullRequestExistence(JSON.stringify(missing), target, 42),
  "missing",
);
```

Change the missing fixture message and assert that the result stays `missing`.
Change `type` or `path` and assert `provider-error`, not `missing`.

Add malformed existence tests for invalid JSON, a missing repository, a
mismatched `nameWithOwner`, a missing pull request field, and a present pull
request with the wrong number. Assert stable JSON, response, or identity error
fields.

Add this valid payload helper to the parser test file:

```ts
function pullRequestPayload(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    number: 42,
    url: "https://github.com/rochecompaan/patchmill/pull/42",
    state: "OPEN",
    mergeCommit: null,
    baseRefName: "main",
    headRefName: "agent/issue-185-github-pr-adapter",
    headRefOid: "abc123",
    headRepository: { nameWithOwner: "rochecompaan/patchmill" },
    body: "Refs #185",
    ...overrides,
  };
}
```

Add exact status tests:

```ts
assert.deepEqual(
  parseGitHubPullRequest(JSON.stringify(pullRequestPayload()), target, 42),
  {
    number: 42,
    url: "https://github.com/rochecompaan/patchmill/pull/42",
    status: "open",
    targetRepository: target,
    baseBranch: "main",
    headRepository: target,
    headBranch: "agent/issue-185-github-pr-adapter",
    headSha: "abc123",
    body: "Refs #185",
  },
);

assert.equal(
  parseGitHubPullRequest(
    JSON.stringify(
      pullRequestPayload({
        state: "MERGED",
        mergeCommit: { oid: "def456" },
      }),
    ),
    target,
    42,
  ).mergeCommit,
  "def456",
);

assert.equal(
  parseGitHubPullRequest(
    JSON.stringify(pullRequestPayload({ state: "CLOSED" })),
    target,
    42,
  ).status,
  "closed-unmerged",
);
```

Add malformed-response tests for these cases:

- Invalid JSON with a preserved cause.
- A non-object pull request payload.
- A zero, negative, fractional, greater-than-`2147483647`, or unsafe pull
  request number.
- A missing or blank base branch, head branch, or head commit field.
- A missing or non-string body field. An empty string body remains valid.
- An unknown pull request state.
- An open or closed pull request with merge data.
- A merged pull request without a nonempty `mergeCommit.oid`.
- A pull request URL for a different host, owner, repository, or number.
- A pull request URL that uses HTTP, user information, a non-default port, a
  query, a fragment, an empty path segment, two trailing slashes, or extra path
  segments.
- A missing or incomplete `headRepository.nameWithOwner`.
- A head repository with a different owner or repository.

Assert `PullRequestIdentityError` for target and head repository mismatches. In
representative cases, assert the exact `.expected` and `.actual` fields.

Assert `GitHubPullRequestJsonError` for invalid JSON. Assert
`GitHubPullRequestResponseError.code` and the exact response `.reason` for
non-identity payload faults.

Add discovery tests with this exact query:

```ts
const query: FindPullRequestsQuery = {
  targetRepository: target,
  baseBranch: "main",
  headRepository: target,
  headBranch: "agent/issue-185-github-pr-adapter",
};
```

The discovery tests must prove these behaviors:

- A JSON array below the limit returns all normalized entries.
- Open, merged, and closed-unmerged entries can appear in one result.
- A non-array response fails as malformed.
- A result count equal to the limit throws `IncompletePullRequestSearchError`
  with the exact query and limit.
- The limit error occurs before item normalization.
- A returned base branch or head branch that differs from the query fails as
  malformed.
- A returned head repository that differs from the query fails with
  `PullRequestIdentityError`.

Add create-output tests for one canonical URL, blank output, malformed output,
multiple URLs, a different repository, and a different number shape.

Also reject create-output URLs that use HTTP, user information, a non-default
port, a query, a fragment, an empty path segment, two trailing slashes, or extra
path segments. Accept one optional trailing slash through the shared parser.

Use this success assertion:

```ts
assert.deepEqual(
  parseCreatedGitHubPullRequest(
    "https://github.com/rochecompaan/patchmill/pull/42\n",
    target,
  ),
  { targetRepository: target, number: 42 },
);
assert.deepEqual(
  parseCreatedGitHubPullRequest(
    "https://github.com/rochecompaan/patchmill/pull/42/\n",
    target,
  ),
  { targetRepository: target, number: 42 },
);
```

- [ ] **Step 6: Run the payload tests and verify the expected failure**

Run:

```bash
node --test src/host/github-gh-pull-request-parsing.test.ts
```

Expected: FAIL because the pull request parser exports do not exist.

- [ ] **Step 7: Implement pull request normalization and create-output parsing**

Add this public surface:

```ts
export function assertGitHubHeadBranch(headBranch: string): void;

export function assertPullRequestNumber(number: number): void;

export type GitHubPullRequestExistence =
  | "present"
  | "missing"
  | "provider-error";

export function parseGitHubPullRequestExistence(
  stdout: string,
  targetRepository: RepositoryIdentity,
  expectedNumber: number,
): GitHubPullRequestExistence;

export function parseGitHubPullRequest(
  stdout: string,
  targetRepository: RepositoryIdentity,
  expectedNumber?: number,
): PullRequestSummary;

export function parseGitHubPullRequests(
  stdout: string,
  query: FindPullRequestsQuery,
  limit: number,
): readonly PullRequestSummary[];

export function parseCreatedGitHubPullRequest(
  stdout: string,
  targetRepository: RepositoryIdentity,
): PullRequestReference;
```

Implement the input guards exactly:

```ts
export function assertGitHubHeadBranch(headBranch: string): void {
  if (headBranch.trim().length === 0) {
    throw new GitHubPullRequestInputError(
      "blank-head-branch",
      "Pull request head branch must not be blank",
    );
  }
  if (headBranch.includes(":")) {
    throw new GitHubPullRequestInputError(
      "qualified-head-branch",
      "Pull request head branch must not contain an owner qualifier",
    );
  }

  const components = headBranch.split("/");
  const invalid =
    headBranch.startsWith("-") ||
    headBranch.startsWith("refs/") ||
    headBranch === "HEAD" ||
    headBranch.startsWith("/") ||
    headBranch.endsWith("/") ||
    headBranch.endsWith(".") ||
    headBranch.includes("//") ||
    headBranch.includes("..") ||
    headBranch.includes("@{") ||
    /[\x00-\x20\x7f~^?*\[\\]/u.test(headBranch) ||
    components.some(
      (component) => component.startsWith(".") || component.endsWith(".lock"),
    );
  if (invalid) {
    throw new GitHubPullRequestInputError(
      "invalid-head-branch",
      "Pull request head branch is not a valid unqualified Git branch",
    );
  }
}

export function assertPullRequestNumber(number: number): void {
  if (!Number.isInteger(number) || number <= 0 || number > 2_147_483_647) {
    throw new GitHubPullRequestInputError(
      "invalid-pull-request-number",
      "Pull request number must be an integer from 1 through 2147483647",
    );
  }
}
```

In `parseGitHubPullRequestExistence`, parse JSON once and validate
`data.repository.nameWithOwner` against the expected target. Return `missing`
only for a null pull request plus exactly one `NOT_FOUND` error at path
`["repository", "pullRequest"]`.

Return `present` only for a matching pull request number and no errors. Return
`provider-error` for other structured GraphQL error arrays. Do not inspect
`message`.

Use one internal payload parser for list and object responses. Validate all
payload fields before constructing a `PullRequestSummary`.

Derive the head identity from the target host and
`headRepository.nameWithOwner`. Compare it with the target through
`sameRepositoryIdentity`.

Map states with a local function that returns the discriminated status fields:

```ts
type PullRequestStatusFields =
  | { status: "open"; mergeCommit?: undefined }
  | { status: "merged"; mergeCommit: string }
  | { status: "closed-unmerged"; mergeCommit?: undefined };

function statusFields(
  state: unknown,
  mergeCommit: unknown,
): PullRequestStatusFields {
  if (state === "OPEN" && mergeCommit === null) return { status: "open" };
  if (state === "CLOSED" && mergeCommit === null) {
    return { status: "closed-unmerged" };
  }
  if (
    state === "MERGED" &&
    mergeCommit !== null &&
    typeof mergeCommit === "object" &&
    typeof (mergeCommit as Record<string, unknown>).oid === "string" &&
    (mergeCommit as Record<string, unknown>).oid !== ""
  ) {
    return {
      status: "merged",
      mergeCommit: (mergeCommit as Record<string, string>).oid,
    };
  }
  throw new GitHubPullRequestResponseError(
    "pull-request-state",
    "gh pr response",
  );
}
```

In `parseGitHubPullRequests`, parse the array and compare its length with
`limit` before item normalization. Throw
`IncompletePullRequestSearchError(query, limit)` when `length >= limit`.

After normalization, require exact `baseBranch` and `headBranch` matches for
each result. Use `sameRepositoryIdentity` for target and head repository
comparisons.

Import `parsePullRequestUrl` from `src/host/pull-request-reference.ts`. Use it
for payload and create-output URLs. Do not add another URL constructor or path
parser.

Add one internal GitHub wrapper that translates a shared parser failure to
`GitHubPullRequestResponseError`. Use reason `pull-request-url` for payloads and
`pull-request-create-output` for create output. Use fixed context labels and do
not include the URL.

Layer these GitHub-specific checks on the structured result:

```text
protocol === "https:"
port === ""
hostname matches targetRepository.host
owner matches targetRepository.owner
repository matches targetRepository.repository
number is in 1..2147483647
number matches expectedNumber when one is supplied
```

Compare host, owner, and repository without case sensitivity. Accept the shared
parser's one optional trailing slash.

In `parseCreatedGitHubPullRequest`, require one whitespace-trimmed output token.
Pass that token to `parsePullRequestUrl(token, "pull")`, apply the GitHub
checks, and return the expected target with the parsed number.

- [ ] **Step 8: Format and run the complete parser test file**

Run:

```bash
npx prettier --write \
  src/host/pull-request-reference.ts \
  src/host/pull-request-reference.test.ts \
  src/host/github-gh-pull-request-errors.ts \
  src/host/github-gh-pull-request-parsing.ts \
  src/host/github-gh-pull-request-parsing.test.ts
node --test src/host/pull-request-reference.test.ts
node --test src/host/github-gh-pull-request-parsing.test.ts
```

Expected: PASS.

- [ ] **Step 9: Commit the parser module**

```bash
git add \
  src/host/pull-request-reference.ts \
  src/host/pull-request-reference.test.ts \
  src/host/github-gh-pull-request-errors.ts \
  src/host/github-gh-pull-request-parsing.ts \
  src/host/github-gh-pull-request-parsing.test.ts
git commit -m "feat(host): centralize GitHub pull request parsing"
```

---

### Task 3: Resolve and validate GitHub repository identities

**Files:**

- Create: `src/host/github-gh-pull-requests.ts`
- Create: `src/host/github-gh-pull-requests.test.ts`

**Interfaces:**

- Consumes: `CommandRunner` and `CommandRunOptions` from
  `src/process/command.ts`.
- Consumes: `RepositoryIdentity`, `PullRequestIdentityError`, and
  `sameRepositoryIdentity` from `src/host/pull-requests.ts`.
- Consumes: repository selector, parser, and stable error exports from Task 2.
- Produces: `GitHubGhPullRequestHostOptions` and the repository-resolution
  methods of `GitHubGhPullRequestHost`.

- [ ] **Step 1: Write the recording runner and constructor tests**

Create the adapter test file with a runner that records arguments, working
directories, and environment overrides:

```ts
import assert from "node:assert/strict";
import test from "node:test";
import type {
  CommandResult,
  CommandRunOptions,
  CommandRunner,
} from "../process/command.ts";
import {
  PullRequestIdentityError,
  type RepositoryIdentity,
} from "./pull-requests.ts";
import {
  GitHubPullRequestCommandError,
  GitHubPullRequestInputError,
} from "./github-gh-pull-request-errors.ts";
import { GitHubGhPullRequestHost } from "./github-gh-pull-requests.ts";

type RecordedCall = {
  command: string;
  args: string[];
  cwd?: string;
  env?: Record<string, string | undefined>;
};

type ScriptedResult =
  | CommandResult
  | Promise<CommandResult>
  | (() => CommandResult | Promise<CommandResult>);
type CommandScript = {
  command: string;
  args: string[];
  result: ScriptedResult;
};

const commandKey = (command: string, args: string[]): string =>
  JSON.stringify([command, args]);

const script = (
  command: string,
  args: string[],
  result: ScriptedResult,
): CommandScript => ({ command, args, result });

class RecordingRunner implements CommandRunner {
  readonly calls: RecordedCall[] = [];
  private readonly resultsByCommand = new Map<string, ScriptedResult[]>();

  constructor(scripts: CommandScript[]) {
    for (const entry of scripts) {
      const key = commandKey(entry.command, entry.args);
      const results = this.resultsByCommand.get(key) ?? [];
      results.push(entry.result);
      this.resultsByCommand.set(key, results);
    }
  }

  async run(
    command: string,
    args: string[],
    options: CommandRunOptions = {},
  ): Promise<CommandResult> {
    this.calls.push({
      command,
      args: [...args],
      cwd: options.cwd,
      env: options.env,
    });
    const result = this.resultsByCommand
      .get(commandKey(command, args))
      ?.shift();
    assert.ok(result, `Unexpected command: ${command} ${args.join(" ")}`);
    return typeof result === "function" ? result() : result;
  }
}

const ok = (stdout = ""): CommandResult => ({
  code: 0,
  stdout,
  stderr: "",
});

const repoRoot = "/repo";
const target: RepositoryIdentity = {
  provider: "github-gh",
  host: "github.com",
  owner: "rochecompaan",
  repository: "patchmill",
};
const targetPayload = JSON.stringify({
  nameWithOwner: "rochecompaan/patchmill",
  url: "https://github.com/rochecompaan/patchmill",
});
```

Add constructor tests for these cases:

- The adapter ID is exactly `github-gh`.
- The default discovery limit is observable as `--limit 1000` in Task 4.
- A blank or whitespace-only `pushRemote` throws `GitHubPullRequestInputError`
  with reason `blank-push-remote`.
- Zero, a negative value, a fractional value, an unsafe integer, `NaN`, and
  `Infinity` throw `GitHubPullRequestInputError` with reason
  `invalid-discovery-limit`.
- A positive safe integer is accepted.

- [ ] **Step 2: Write target and remote identity command tests**

Assert the exact target command:

```ts
const runner = new RecordingRunner([
  script(
    "gh",
    ["repo", "view", "--json", "nameWithOwner,url"],
    ok(targetPayload),
  ),
]);
const host = new GitHubGhPullRequestHost({
  runner,
  repoRoot,
  pushRemote: "publish",
});

assert.deepEqual(await host.resolveTargetRepositoryIdentity(), {
  provider: "github-gh",
  host: "github.com",
  owner: "rochecompaan",
  repository: "patchmill",
});
assert.deepEqual(runner.calls, [
  {
    command: "gh",
    args: ["repo", "view", "--json", "nameWithOwner,url"],
    cwd: repoRoot,
    env: { GH_REPO: undefined },
  },
]);
```

Assert the exact named-remote commands:

```ts
const runner = new RecordingRunner([
  script(
    "git",
    ["remote", "get-url", "--push", "--all", "--", "-publish"],
    ok("git@github.example.com:old-owner/old-name.git\n"),
  ),
  script(
    "gh",
    [
      "repo",
      "view",
      "github.example.com/old-owner/old-name",
      "--json",
      "nameWithOwner,url",
    ],
    ok(
      JSON.stringify({
        nameWithOwner: "new-owner/new-name",
        url: "https://github.example.com/new-owner/new-name",
      }),
    ),
  ),
]);
const host = new GitHubGhPullRequestHost({
  runner,
  repoRoot,
  pushRemote: "-publish",
});

const identity = await host.resolveRemoteRepositoryIdentity("-publish");
assert.deepEqual(identity, {
  provider: "github-gh",
  host: "github.example.com",
  owner: "new-owner",
  repository: "new-name",
});
assert.deepEqual(runner.calls, [
  {
    command: "git",
    args: ["remote", "get-url", "--push", "--all", "--", "-publish"],
    cwd: repoRoot,
    env: undefined,
  },
  {
    command: "gh",
    args: [
      "repo",
      "view",
      "github.example.com/old-owner/old-name",
      "--json",
      "nameWithOwner,url",
    ],
    cwd: repoRoot,
    env: { GH_REPO: undefined },
  },
]);
```

This assertion proves option termination and provider redirects without trusting
the raw remote slug.

Add a multiple-push-URL test with these command-keyed scripts:

```ts
const runner = new RecordingRunner([
  script(
    "git",
    ["remote", "get-url", "--push", "--all", "--", "publish"],
    ok(
      "git@github.com:rochecompaan/patchmill.git\n" +
        "https://github.com/rochecompaan/patchmill.git\n",
    ),
  ),
  script(
    "gh",
    [
      "repo",
      "view",
      "github.com/rochecompaan/patchmill",
      "--json",
      "nameWithOwner,url",
    ],
    ok(targetPayload),
  ),
  script(
    "gh",
    [
      "repo",
      "view",
      "github.com/rochecompaan/patchmill",
      "--json",
      "nameWithOwner,url",
    ],
    ok(targetPayload),
  ),
]);
const host = new GitHubGhPullRequestHost({
  runner,
  repoRoot,
  pushRemote: "publish",
});

assert.deepEqual(await host.resolveRemoteRepositoryIdentity("publish"), target);
assert.deepEqual(
  runner.calls.map(({ command, args }) => [command, ...args]),
  [
    ["git", "remote", "get-url", "--push", "--all", "--", "publish"],
    [
      "gh",
      "repo",
      "view",
      "github.com/rochecompaan/patchmill",
      "--json",
      "nameWithOwner,url",
    ],
    [
      "gh",
      "repo",
      "view",
      "github.com/rochecompaan/patchmill",
      "--json",
      "nameWithOwner,url",
    ],
  ],
);
```

Add a mismatched-push-URL test by replacing the second provider result with:

```ts
ok(
  JSON.stringify({
    nameWithOwner: "other/repository",
    url: "https://github.com/other/repository",
  }),
);
```

Assert `PullRequestIdentityError.expected` equals `target`. Assert `.actual`
equals the normalized `other/repository` identity.

Add command-error tests for target lookup, `git remote get-url`, and each remote
repository lookup. Assert `GitHubPullRequestCommandError.code`, `.reason`,
`.operation`, `.command`, `.exitCode`, and non-enumerable `.diagnostics`.

Use exit code `4` for one `gh` fixture and assert reason
`authentication-required`. Use other nonzero results for `command-failed`.

Add a non-disclosure test with `secret-user:secret-token` in a failed remote
command result:

```ts
const exposed = `${error.message}\n${JSON.stringify(error)}`;
assert.doesNotMatch(exposed, /secret-user|secret-token/u);
assert.equal(
  Object.prototype.propertyIsEnumerable.call(error, "diagnostics"),
  false,
);
assert.match(error.diagnostics.stdout, /secret-user:secret-token/u);
```

This test proves that explicit diagnostic inspection retains the result while
default error output does not expose it.

- [ ] **Step 3: Run the repository command tests and verify the expected
      failure**

Run:

```bash
node --test src/host/github-gh-pull-requests.test.ts
```

Expected: FAIL because `github-gh-pull-requests.ts` does not exist.

- [ ] **Step 4: Implement constructor validation and repository resolution**

Create the adapter module with these constants and options:

```ts
const REPOSITORY_JSON_FIELDS = "nameWithOwner,url";
const PULL_REQUEST_JSON_FIELDS =
  "number,url,state,mergeCommit,baseRefName,headRefName,headRefOid,headRepository,body";
const DEFAULT_DISCOVERY_LIMIT = 1000;

export type GitHubGhPullRequestHostOptions = {
  runner: CommandRunner;
  repoRoot: string;
  pushRemote: string;
  discoveryLimit?: number;
};
```

Store a normalized options object in the constructor. Throw
`GitHubPullRequestInputError` with the exact constructor reasons from Step 1.

Do not trim or rename a nonblank remote, because Git owns remote-name
validation.

Add one `runGh` helper and one `runGit` helper:

```ts
private runGh(args: string[]): Promise<CommandResult> {
  return this.options.runner.run("gh", args, {
    cwd: this.options.repoRoot,
    env: { GH_REPO: undefined },
  });
}

private runGit(args: string[]): Promise<CommandResult> {
  return this.options.runner.run("git", args, {
    cwd: this.options.repoRoot,
  });
}
```

Implement `resolveTargetRepositoryIdentity()` with:

```ts
["repo", "view", "--json", REPOSITORY_JSON_FIELDS];
```

Implement `resolveRemoteRepositoryIdentity(remote)` with:

```ts
["remote", "get-url", "--push", "--all", "--", remote];
```

Split successful standard output on line boundaries and remove only empty
trailing lines. If no URL remains, throw `GitHubPullRequestResponseError` with
reason `remote-url-list`.

For each URL, parse the raw selector and run:

```ts
[
  "repo",
  "view",
  githubRepositorySelector(rawSelector),
  "--json",
  REPOSITORY_JSON_FIELDS,
];
```

Pass each `rawSelector.host` to `parseGitHubRepositoryIdentity`. This permits
owner or repository redirects, but it rejects a host redirect.

Resolve selectors sequentially in Git output order. Compare every normalized
identity with the first through `sameRepositoryIdentity`.

If an identity differs, throw `PullRequestIdentityError` with the first identity
as `expected` and the differing identity as `actual`. Return the first identity
only after all URLs pass.

For every nonzero command result, throw `GitHubPullRequestCommandError` with the
operation from Task 2. Do not parse command output to infer a different error
category.

Do not add `resolveRepositoryContext()` in this task. Task 4 adds that private
method with its first behavior tests so the concurrency requirement has direct
coverage.

- [ ] **Step 5: Format and run the repository command tests**

Run:

```bash
npx prettier --write \
  src/host/github-gh-pull-requests.ts \
  src/host/github-gh-pull-requests.test.ts
node --test src/host/github-gh-pull-requests.test.ts
```

Expected: PASS for constructor and repository-resolution tests.

- [ ] **Step 6: Commit repository context resolution**

```bash
git add \
  src/host/github-gh-pull-requests.ts \
  src/host/github-gh-pull-requests.test.ts
git commit -m "feat(host): resolve GitHub pull request repositories"
```

---

### Task 4: Add exhaustive discovery, get, and body reads

**Files:**

- Modify: `src/host/github-gh-pull-requests.ts`
- Modify: `src/host/github-gh-pull-requests.test.ts`

**Interfaces:**

- Consumes: `FindPullRequestsQuery`, `PullRequestReference`,
  `PullRequestSummary`, `PullRequestNotFoundError`, and Task 2 parsers.
- Produces: `findPullRequests`, `getPullRequest`, and `readPullRequestBody` on
  `GitHubGhPullRequestHost`.

- [ ] **Step 1: Write exact `getPullRequest` and body-read tests**

Use command-keyed scripts so test results do not depend on the order of
independent target and remote work:

```ts
const targetArgs = ["repo", "view", "--json", "nameWithOwner,url"];
const remoteUrlArgs = ["remote", "get-url", "--push", "--all", "--", "publish"];
const remoteRepositoryArgs = [
  "repo",
  "view",
  "github.com/rochecompaan/patchmill",
  "--json",
  "nameWithOwner,url",
];

function repositoryContextScripts(
  remoteUrls = "git@github.com:rochecompaan/patchmill.git\n",
): CommandScript[] {
  return [
    script("gh", targetArgs, ok(targetPayload)),
    script("git", remoteUrlArgs, ok(remoteUrls)),
    script("gh", remoteRepositoryArgs, ok(targetPayload)),
  ];
}

function callIndex(
  runner: RecordingRunner,
  command: string,
  args: string[],
): number {
  const index = runner.calls.findIndex(
    (call) => commandKey(call.command, call.args) === commandKey(command, args),
  );
  assert.notEqual(index, -1, `Missing command: ${command} ${args.join(" ")}`);
  return index;
}
```

Define the exact query and pull request commands in the test:

```ts
const existenceQuery =
  "query PatchmillPullRequestExists($owner: String!, $repository: String!, $number: Int!) { repository(owner: $owner, name: $repository) { nameWithOwner pullRequest(number: $number) { number } } }";
const existenceArgs = [
  "api",
  "graphql",
  "--hostname",
  "github.com",
  "--raw-field",
  `query=${existenceQuery}`,
  "--field",
  "owner=rochecompaan",
  "--field",
  "repository=patchmill",
  "--field",
  "number=42",
];
const viewArgs = [
  "pr",
  "view",
  "42",
  "--repo",
  "github.com/rochecompaan/patchmill",
  "--json",
  "number,url,state,mergeCommit,baseRefName,headRefName,headRefOid,headRepository,body",
];
```

Use the valid payload and present-existence helpers from Task 2. Script them by
command:

```ts
const runner = new RecordingRunner([
  ...repositoryContextScripts(),
  script("gh", existenceArgs, ok(JSON.stringify(present))),
  script("gh", viewArgs, ok(JSON.stringify(pullRequestPayload()))),
]);
```

Assert each exact command and these required ordering constraints:

```ts
const targetIndex = callIndex(runner, "gh", targetArgs);
const remoteUrlIndex = callIndex(runner, "git", remoteUrlArgs);
const remoteRepositoryIndex = callIndex(runner, "gh", remoteRepositoryArgs);
const existenceIndex = callIndex(runner, "gh", existenceArgs);
const viewIndex = callIndex(runner, "gh", viewArgs);

assert.ok(remoteUrlIndex < remoteRepositoryIndex);
assert.ok(
  Math.max(targetIndex, remoteRepositoryIndex) < existenceIndex,
  "repository context must finish before the existence probe",
);
assert.ok(existenceIndex < viewIndex);
```

Do not assert an order between `targetIndex` and `remoteUrlIndex` or
`remoteRepositoryIndex`. Assert `cwd: repoRoot` on all calls and
`env: { GH_REPO: undefined }` on each `gh` call.

Add a concurrency test. Hold the target result pending while the remote chain
completes:

```ts
const targetGate = Promise.withResolvers<CommandResult>();
const remoteFinished = Promise.withResolvers<void>();
const runner = new RecordingRunner([
  script("gh", targetArgs, targetGate.promise),
  script(
    "git",
    remoteUrlArgs,
    ok("git@github.com:rochecompaan/patchmill.git\n"),
  ),
  script("gh", remoteRepositoryArgs, () => {
    remoteFinished.resolve();
    return ok(targetPayload);
  }),
  script("gh", existenceArgs, ok(JSON.stringify(present))),
  script("gh", viewArgs, ok(JSON.stringify(pullRequestPayload()))),
]);
const host = new GitHubGhPullRequestHost({
  runner,
  repoRoot,
  pushRemote: "publish",
});

const pending = host.getPullRequest(reference);
const remoteCompletedBeforeTarget = await Promise.race([
  remoteFinished.promise.then(() => true),
  new Promise<boolean>((resolve) => setImmediate(() => resolve(false))),
]);
const probedBeforeTarget = runner.calls.some((call) => call.args[0] === "api");
targetGate.resolve(ok(targetPayload));
await pending;

assert.equal(
  remoteCompletedBeforeTarget,
  true,
  "remote resolution must complete while target resolution is pending",
);
assert.equal(probedBeforeTarget, false);
```

The bounded race fails deterministically if repository context waits for target
resolution before it starts remote resolution. The test releases the target
result before it asserts, so a faulty sequential implementation cannot hang the
test.

Call `readPullRequestBody(reference)` in a separate test. Assert the same
command set, dependency ordering, and exact body string.

Add a reference mismatch test. Use a target identity with a different owner.

Assert all three repository-context calls, the remote URL-before-provider
dependency, and no `gh api graphql` or `gh pr view` call. Do not assert an order
between target and remote resolution. This proves identity rejection before the
existence probe.

Add a cross-repository head payload test. Assert `PullRequestIdentityError` and
no successful summary.

In the reference mismatch test, inspect stable error fields with this pattern:

```ts
const mismatchedRepository = { ...target, owner: "other-owner" };
const reference = { targetRepository: mismatchedRepository, number: 42 };

await assert.rejects(host.getPullRequest(reference), (error: unknown) => {
  assert.ok(error instanceof PullRequestIdentityError);
  assert.deepEqual(error.expected, target);
  assert.deepEqual(error.actual, mismatchedRepository);
  return true;
});
```

Add table tests for reference numbers `0`, `-1`, `1.5`, `2_147_483_648`,
`Number.MAX_SAFE_INTEGER + 1`, `NaN`, and `Infinity`.

For both `getPullRequest` and `readPullRequestBody`, construct the host with an
empty result list. Assert `GitHubPullRequestInputError` reason
`invalid-pull-request-number` and `runner.calls` equal to `[]`.

Add one GitHub Enterprise get test. Use `github.example.com/Platform/Patchmill`
for the target, push remote, payload URL, and head repository.

Assert that the Enterprise test runs the existence command with
`--hostname github.example.com` and repository fields `Platform` and
`Patchmill`.

Then assert this pull request command:

```ts
[
  "pr",
  "view",
  "42",
  "--repo",
  "github.example.com/Platform/Patchmill",
  "--json",
  "number,url,state,mergeCommit,baseRefName,headRefName,headRefOid,headRepository,body",
];
```

- [ ] **Step 2: Write machine-readable absence and stable error tests**

Use a nonzero existence-probe result whose standard output contains the
structured `missing` fixture from Task 2. Set standard error to arbitrary
diagnostic text.

Assert `PullRequestNotFoundError` only when all these conditions are true:

- `data.repository.nameWithOwner` matches the expected target.
- `data.repository.pullRequest` is `null`.
- `errors` contains exactly one entry.
- The entry `type` is `NOT_FOUND`.
- The entry `path` is `["repository", "pullRequest"]`.
- The error `.reference` equals the original `PullRequestReference` object.

Run the same exit-code-`1` test with different GraphQL `message` and command
standard-error text. The classification must stay `PullRequestNotFoundError`.

Pair the same structured missing payload with exit codes `0`, `2`, and `4`.
Assert a response error for `0`. Assert `GitHubPullRequestCommandError` with
reason `command-failed` for `2` and reason `authentication-required` for `4`.
None becomes `PullRequestNotFoundError`.

Add table tests that alter one stable field at a time: repository identity, null
pull request, error count, error type, and error path. Assert that no case
becomes `PullRequestNotFoundError`.

Use exit code `4` with blank standard output to assert
`GitHubPullRequestCommandError` code `github-pull-request-command-failed`,
reason `authentication-required`, and operation `probe-pull-request`.

Use rate-limit and transport diagnostics with nonzero codes. Assert reason
`command-failed`, the stable exit code, and non-enumerable diagnostics. Do not
assert message text.

Use nonblank invalid JSON to assert `GitHubPullRequestJsonError` and its
`SyntaxError` cause. Use malformed structured data to assert
`GitHubPullRequestResponseError` reason `pull-request-existence-payload`.

After a successful presence probe, return a nonzero `gh pr view` result. Assert
`GitHubPullRequestCommandError` operation `view-pull-request`. Do not run
another classifier or inspect human-readable output.

Put `sensitive pull request body` in partial command output. Assert that neither
`error.message` nor `JSON.stringify(error)` contains it.

Assert that `error.diagnostics` is non-enumerable and retains the partial output
for explicit inspection.

- [ ] **Step 3: Write exact discovery tests**

Use a custom `discoveryLimit: 3` and this query:

```ts
const query = {
  targetRepository: target,
  baseBranch: "main",
  headRepository: target,
  headBranch: "agent/issue-185-github-pr-adapter",
} as const;
```

Assert this exact discovery command after repository context completes:

```ts
[
  "pr",
  "list",
  "--repo",
  "github.com/rochecompaan/patchmill",
  "--state",
  "all",
  "--base",
  "main",
  "--head",
  "agent/issue-185-github-pr-adapter",
  "--limit",
  "3",
  "--json",
  "number,url,state,mergeCommit,baseRefName,headRefName,headRefOid,headRepository,body",
];
```

Add these discovery tests:

- Two valid entries below the limit return two normalized summaries.
- Three entries at the limit throw `IncompletePullRequestSearchError` with exact
  `.query` and `.limit` fields.
- Every invalid head branch from Task 2 fails before any command. Assert
  `runner.calls` equals `[]`.
- A different query target fails before `gh pr list`.
- A different query head repository fails before `gh pr list`.
- A different push-remote identity fails before `gh pr list`.
- Authentication, rate-limit, and transport failures produce
  `GitHubPullRequestCommandError` with stable code, reason, operation, and
  stable exit and diagnostic fields.
- Malformed JSON produces `GitHubPullRequestJsonError` with the original
  `SyntaxError` cause.
- A mismatched result branch, target URL, or head repository fails closed.
- Omitting `discoveryLimit` produces the exact `--limit 1000` argument.

- [ ] **Step 4: Run the read-only adapter tests and verify the expected
      failure**

Run:

```bash
node --test src/host/github-gh-pull-requests.test.ts
```

Expected: FAIL because the read-only methods do not exist.

- [ ] **Step 5: Implement concurrent repository context, machine-readable
      existence, and the shared view path**

Add the private repository-context method that the tests exercise:

```ts
private async resolveRepositoryContext(): Promise<{
  targetRepository: RepositoryIdentity;
  repositorySelector: string;
}> {
  const [targetRepository, pushRepository] = await Promise.all([
    this.resolveTargetRepositoryIdentity(),
    this.resolveRemoteRepositoryIdentity(this.options.pushRemote),
  ]);

  if (!sameRepositoryIdentity(targetRepository, pushRepository)) {
    throw new PullRequestIdentityError(
      `target repository does not match push remote ${this.options.pushRemote}`,
      { expected: targetRepository, actual: pushRepository },
    );
  }

  return {
    targetRepository,
    repositorySelector: githubRepositorySelector(targetRepository),
  };
}
```

`Promise.all` starts the independent target and configured remote work together.
`resolveRemoteRepositoryIdentity` still waits for Git URL lookup before its
sequential provider lookups.

Add the exact GraphQL query constant:

```ts
const PULL_REQUEST_EXISTENCE_QUERY =
  "query PatchmillPullRequestExists($owner: String!, $repository: String!, $number: Int!) { repository(owner: $owner, name: $repository) { nameWithOwner pullRequest(number: $number) { number } } }";
```

Add a private existence method that accepts the original `PullRequestReference`.
Run this command before `gh pr view`:

```ts
[
  "api",
  "graphql",
  "--hostname",
  reference.targetRepository.host,
  "--raw-field",
  `query=${PULL_REQUEST_EXISTENCE_QUERY}`,
  "--field",
  `owner=${reference.targetRepository.owner}`,
  "--field",
  `repository=${reference.targetRepository.repository}`,
  "--field",
  `number=${reference.number}`,
];
```

Apply command status and structured parsing in this order:

1. If the exit code is neither `0` nor `1`, throw
   `GitHubPullRequestCommandError` before parsing.
2. If exit code `1` has blank standard output, throw
   `GitHubPullRequestCommandError`.
3. Parse nonblank standard output exactly once with
   `parseGitHubPullRequestExistence`. Do not catch JSON or response errors.
4. If the exit code is `1` and the result is `missing`, throw
   `PullRequestNotFoundError` with the original reference.
5. If the exit code is `1` for any other structured result, throw
   `GitHubPullRequestCommandError`.
6. If exit code `0` produces `missing` or `provider-error`, throw
   `GitHubPullRequestResponseError` with reason
   `pull-request-existence-payload`.
7. Continue only when exit code `0` produces `present`.

This method is the explicit error-translation boundary. It uses stable
structured fields and never catches or interprets diagnostic text.

Add a private view method that accepts the original reference. Call the
existence method, then run:

```ts
[
  "pr",
  "view",
  String(reference.number),
  "--repo",
  repositorySelector,
  "--json",
  PULL_REQUEST_JSON_FIELDS,
];
```

Convert a nonzero view result to `GitHubPullRequestCommandError` with operation
`view-pull-request`. Parse a successful result with `parseGitHubPullRequest` and
`reference.number`.

- [ ] **Step 6: Implement `getPullRequest` and `readPullRequestBody`**

Add a private `getPullRequestAfterInputValidation` method in this order:

1. Call `resolveRepositoryContext()`.
2. Compare `reference.targetRepository` with the resolved target.
3. Throw `PullRequestIdentityError` before the existence probe on mismatch.
4. Pass the original reference to the private view method.

Validate the number at each public boundary before that shared path:

```ts
getPullRequest(reference: PullRequestReference): Promise<PullRequestSummary> {
  assertPullRequestNumber(reference.number);
  return this.getPullRequestAfterInputValidation(reference);
}

async readPullRequestBody(reference: PullRequestReference): Promise<string> {
  assertPullRequestNumber(reference.number);
  return (await this.getPullRequestAfterInputValidation(reference)).body;
}
```

Do not call the old URL-based helper in `github-pr-body.ts`.

- [ ] **Step 7: Implement exhaustive discovery**

Implement `findPullRequests` in this order:

1. Call `assertGitHubHeadBranch(query.headBranch)`.
2. Call `resolveRepositoryContext()`.
3. Compare the query target with the resolved target.
4. Compare the query head repository with the resolved target.
5. Throw `PullRequestIdentityError` before `gh pr list` on either mismatch.
6. Run the exact command from Step 3.
7. Convert a nonzero result to `GitHubPullRequestCommandError` with operation
   `list-pull-requests`.
8. Pass the successful output, original query, and limit to
   `parseGitHubPullRequests`.

A successful parser result is exhaustive. Do not return entries before the
parser completes all validation.

- [ ] **Step 8: Format and run both focused test files**

Run:

```bash
npx prettier --write \
  src/host/github-gh-pull-requests.ts \
  src/host/github-gh-pull-requests.test.ts
node --test src/host/github-gh-pull-request-parsing.test.ts
node --test src/host/github-gh-pull-requests.test.ts
```

Expected: PASS.

- [ ] **Step 9: Commit read-only pull request operations**

```bash
git add \
  src/host/github-gh-pull-requests.ts \
  src/host/github-gh-pull-requests.test.ts
git commit -m "feat(host): read GitHub planning pull requests"
```

---

### Task 5: Add pull request creation and body updates

**Files:**

- Modify: `src/host/github-gh-pull-requests.ts`
- Modify: `src/host/github-gh-pull-requests.test.ts`

**Interfaces:**

- Consumes: `CreatePullRequestInput`, `PullRequestReference`,
  `PullRequestSummary`, and `PullRequestHost` from `src/host/pull-requests.ts`.
- Consumes: `parseCreatedGitHubPullRequest` from Task 2 and the private view
  path from Task 4.
- Produces: a complete `GitHubGhPullRequestHost implements PullRequestHost`.

- [ ] **Step 1: Write fail-fast head validation and exact creation tests**

For each head branch below, construct `RecordingRunner([])` and call
`createPullRequest`:

```text
""
"   "
"owner:branch"
"-branch"
"refs/heads/branch"
"feature branch"
"feature..name"
"feature@{name"
"feature//name"
"feature/.hidden"
"feature/name.lock"
"HEAD"
```

Assert `GitHubPullRequestInputError.code`, the exact reason from Task 2, and
`runner.calls` equal to `[]`. The `owner:branch` case must use reason
`qualified-head-branch`.

Add a successful creation test with head branch `@`. Assert that the create
command uses `rochecompaan:@` as the single `--head` argument. The owner must
come from resolved repository context.

Use the command-keyed repository-context scripts, one create result, one
present-existence result, and one view result. Then call:

```ts
const summary = await host.createPullRequest({
  title: "Spec for #185",
  body: "Refs #185\n\nBody with $shell and `code`.",
  baseBranch: "main",
  headBranch: "agent/issue-185-github-pr-adapter",
});
```

Assert this exact create command:

```ts
[
  "pr",
  "create",
  "--repo",
  "github.com/rochecompaan/patchmill",
  "--base",
  "main",
  "--head",
  "rochecompaan:agent/issue-185-github-pr-adapter",
  "--title",
  "Spec for #185",
  "--body",
  "Refs #185\n\nBody with $shell and `code`.",
];
```

Assert that the next commands are the exact existence probe and `gh pr view 42`
commands from Task 4. Assert that the method returns its normalized summary.

Add create-response tests for blank output, malformed output, multiple URLs, and
a URL for another repository. Assert stable response or identity error fields.

Assert that no existence or view command occurs after each rejected create
response.

Add a nonzero `gh pr create` result with authentication output. Assert
`GitHubPullRequestCommandError` code, reason, operation `create-pull-request`,
`.exitCode` and non-enumerable `.diagnostics`.

Use `sensitive body input` as the requested body. Assert that neither
`error.message` nor `JSON.stringify(error)` contains it because command
arguments are not stored on the error.

Assert that the failed create does not run an existence probe or `gh pr view`.

Add a push-remote mismatch test. Assert `PullRequestIdentityError` before
`gh pr create`.

In that mismatch test, assert `.expected` equals the resolved target. Assert
`.actual` equals the resolved push-remote identity.

- [ ] **Step 2: Write exact body-update tests**

Call:

```ts
await host.updatePullRequestBody(reference, "line one\nline two; $HOME `cmd`");
```

Assert that the command set contains repository resolution and `gh pr view`,
followed by this final call:

```ts
{
  command: "gh",
  args: [
    "pr",
    "edit",
    "42",
    "--repo",
    "github.com/rochecompaan/patchmill",
    "--body",
    "line one\nline two; $HOME `cmd`",
  ],
  cwd: repoRoot,
  env: { GH_REPO: undefined },
}
```

The body must remain one argument. Do not use a shell or a temporary file.

Add a validation/use-gap regression test with a case-variant caller reference:

```ts
const callerReference: PullRequestReference = {
  targetRepository: {
    ...target,
    owner: "ROCHECOMPAAN",
    repository: "PATCHMILL",
  },
  number: 42,
};
const callerExistenceArgs = [
  "api",
  "graphql",
  "--hostname",
  "github.com",
  "--raw-field",
  `query=${existenceQuery}`,
  "--field",
  "owner=ROCHECOMPAAN",
  "--field",
  "repository=PATCHMILL",
  "--field",
  "number=42",
];
const editArgs = [
  "pr",
  "edit",
  "42",
  "--repo",
  "github.com/rochecompaan/patchmill",
  "--body",
  "updated body",
];
const runner = new RecordingRunner([
  ...repositoryContextScripts(),
  script("gh", callerExistenceArgs, ok(JSON.stringify(present))),
  script("gh", viewArgs, ok(JSON.stringify(pullRequestPayload()))),
  script("gh", editArgs, ok()),
]);

await new GitHubGhPullRequestHost({
  runner,
  repoRoot,
  pushRemote: "publish",
}).updatePullRequestBody(callerReference, "updated body");
assert.notEqual(callIndex(runner, "gh", editArgs), -1);
```

Repository identity validation accepts the case variant. The existence probe
uses the validated caller spelling. The edit must still use number `42` and the
provider-normalized target from the returned summary, not the caller spelling.

Add these update tests:

- Every invalid reference number from Task 4 throws
  `GitHubPullRequestInputError` before any command. Assert `runner.calls` equals
  `[]`.
- A target reference mismatch fails before the existence probe.
- A push-remote mismatch fails before the existence probe, `gh pr view`, or
  `gh pr edit`.
- A cross-repository head fails after view and before edit.
- A machine-readable missing existence result becomes `PullRequestNotFoundError`
  before view or edit.
- Authentication, rate-limit, and transport failures from probe or view retain
  stable command-error fields.
- A case-variant caller reference validates successfully, but the edit command
  uses the number and provider spelling from the normalized summary.
- An edit command error has operation `edit-pull-request`, a stable exit code,
  and non-enumerable diagnostics.

- [ ] **Step 3: Run the mutation tests and verify the expected failure**

Run:

```bash
node --test src/host/github-gh-pull-requests.test.ts
```

Expected: FAIL because create and update are not implemented.

- [ ] **Step 4: Implement pull request creation**

Call `assertGitHubHeadBranch(input.headBranch)` before
`resolveRepositoryContext()` or any other command. After context validation,
derive the provider operand from returned context:

```ts
const context = await this.resolveRepositoryContext();
const head = `${context.targetRepository.owner}:${input.headBranch}`;
```

Caller input must never supply the owner part. Use `context.repositorySelector`
for `--repo` and `head` for `--head`, as shown in Step 1.

Convert a nonzero result to `GitHubPullRequestCommandError` with operation
`create-pull-request`. Parse successful standard output with
`parseCreatedGitHubPullRequest`.

Pass the parsed `PullRequestReference` to the private view method. Do not
resolve the repository context a second time during create read-back.

- [ ] **Step 5: Implement body updates**

Call `assertPullRequestNumber(reference.number)` at the public method boundary.
Then call `getPullRequestAfterInputValidation(reference)` to validate repository
context, reference identity, existence, and same-repository head. Keep its
normalized result:

```ts
const pullRequest = await this.getPullRequestAfterInputValidation(reference);
```

Build the edit command only from that result:

```ts
[
  "pr",
  "edit",
  String(pullRequest.number),
  "--repo",
  githubRepositorySelector(pullRequest.targetRepository),
  "--body",
  body,
];
```

Do not read command identity fields from the caller-owned reference after the
validation await.

Convert a nonzero edit result to `GitHubPullRequestCommandError` with operation
`edit-pull-request`.

Declare the final class with the existing interface:

```diff
-export class GitHubGhPullRequestHost {
+export class GitHubGhPullRequestHost implements PullRequestHost {
```

Keep `readonly id = "github-gh" as const` on the class.

Do not export a factory or add the adapter to an existing factory.

- [ ] **Step 6: Format and run both focused test files**

Run:

```bash
npx prettier --write \
  src/host/github-gh-pull-requests.ts \
  src/host/github-gh-pull-requests.test.ts
node --test src/host/github-gh-pull-request-parsing.test.ts
node --test src/host/github-gh-pull-requests.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit mutation support**

```bash
git add \
  src/host/github-gh-pull-requests.ts \
  src/host/github-gh-pull-requests.test.ts
git commit -m "feat(host): mutate GitHub planning pull requests"
```

---

### Task 6: Run final validation and verify the delivery boundary

**Files:**

- Inspect: `src/process/command.ts`
- Inspect: `src/cli/commands/triage/types.ts`
- Inspect: `src/cli/commands/triage/command.ts`
- Inspect: `test-support/command-runner.ts`
- Inspect: `src/host/pull-request-reference.ts`
- Inspect: `src/host/pull-request-reference.test.ts`
- Inspect: `src/host/github-gh-pull-request-errors.ts`
- Inspect: `src/host/github-gh-pull-request-parsing.ts`
- Inspect: `src/host/github-gh-pull-requests.ts`
- Inspect: `src/host/github-gh-pull-request-parsing.test.ts`
- Inspect: `src/host/github-gh-pull-requests.test.ts`
- Verify unchanged: `src/host/factory.ts`
- Verify unchanged: `src/cli/commands/run-once/`

**Interfaces:**

- Consumes: all production and test work from Tasks 1 through 5.
- Produces: a validated implementation slice with no runtime wiring.

- [ ] **Step 1: Review module size and responsibilities**

Use this responsibility test:

```text
src/process/command.ts
  Neutral command contracts only.

src/host/pull-request-reference.ts
  Shared pull request URL syntax and canonical comparison only.

src/host/github-gh-pull-request-errors.ts
  Stable adapter error identifiers and diagnostic fields only.

src/host/github-gh-pull-request-parsing.ts
  Pure input validation plus GitHub identity and JSON normalization only.

src/host/github-gh-pull-requests.ts
  Command execution, repository-context validation, and error mapping only.
```

For this plan, a meaningful line is a nonblank source line outside import
declarations and standalone comments. Braces and type declarations count.

Run this reproducible count:

```bash
node --input-type=module <<'NODE'
import { readFileSync } from "node:fs";

const paths = [
  "src/process/command.ts",
  "src/host/pull-request-reference.ts",
  "src/host/github-gh-pull-request-errors.ts",
  "src/host/github-gh-pull-request-parsing.ts",
  "src/host/github-gh-pull-requests.ts",
];

for (const path of paths) {
  let inImport = false;
  let count = 0;
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const text = line.trim();
    if (!inImport && text.startsWith("import ")) {
      inImport = !text.endsWith(";");
      continue;
    }
    if (inImport) {
      inImport = !text.endsWith(";");
      continue;
    }
    if (text !== "" && !text.startsWith("//")) count += 1;
  }
  console.log(`${path}: ${count} meaningful lines`);
  if (count > 200) process.exitCode = 1;
}
NODE
```

Expected: each count is at most `200`, and the command exits with status 0.

If a module exceeds the limit, reduce repeated validation through focused local
helpers. Do not create a broad utility module.

- [ ] **Step 2: Run focused tests**

Run:

```bash
node --test src/cli/commands/triage/command.test.ts
node --test src/host/pull-request-reference.test.ts
node --test src/host/github-gh-pull-request-parsing.test.ts
node --test src/host/github-gh-pull-requests.test.ts
```

Expected: PASS.

- [ ] **Step 3: Run the complete validation suite**

Run each command separately:

```bash
npm test
npm run build
npm run lint
npm run check:types
npm run check:architecture
```

Expected: every command exits with status 0.

- [ ] **Step 4: Verify the static scope constraints through the final diff**

Run:

```bash
git diff --name-only "$(git merge-base HEAD main)"...HEAD
git diff --exit-code main...HEAD -- \
  src/host/factory.ts \
  src/cli/commands/run-once
```

The first command must list only these issue artifacts and implementation files:

```text
docs/plans/2026-09-05-issue-185-github-planning-pull-request-adapter.md
docs/specs/2026-09-05-issue-185-github-planning-pull-request-adapter-design.md
src/process/command.ts
src/cli/commands/triage/types.ts
src/cli/commands/triage/command.ts
test-support/command-runner.ts
src/host/pull-request-reference.ts
src/host/pull-request-reference.test.ts
src/host/github-gh-pull-request-errors.ts
src/host/github-gh-pull-request-parsing.test.ts
src/host/github-gh-pull-request-parsing.ts
src/host/github-gh-pull-requests.test.ts
src/host/github-gh-pull-requests.ts
```

The second command must produce no diff. This direct verification replaces tests
for unchanged factory and pipeline files.

- [ ] **Step 5: Verify the final worktree state**

Run:

```bash
git status --short
git log --oneline "$(git merge-base HEAD main)"..HEAD
```

Expected: the worktree is clean. The log contains the planning commits and the
focused implementation commits from this plan.
