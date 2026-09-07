# Issue 186 Forgejo Planning Pull Request Adapter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement a provider-neutral `PullRequestHost` adapter for Forgejo
through exact `git` and `tea api` command contracts without exposing it through
the current factory or run-once workflow.

**Architecture:** Add a small public `ForgejoTeaPullRequestHost` facade over a
command client, pure Forgejo payload/remote parsers, and stable adapter errors.
Resolve the target and configured push remote before every pull request
operation, normalize complete nested identities, and let the command client own
HTTP status extraction and exhaustive pagination.

**Tech Stack:** TypeScript, Node.js 24, NodeNext modules, `node:test`, the
existing `CommandRunner`, `tea api`, Git, ESLint, Prettier, strict TypeScript,
and dependency-cruiser.

**Spec:**
`docs/specs/2026-09-07-issue-186-implement-the-forgejo-planning-pull-request-adapter-design.md`

## Global Constraints

- Implement the unchanged `PullRequestHost` contract from
  `src/host/pull-requests.ts`; do not extend `ForgejoTeaHostProvider`.
- Keep the adapter unreachable from `src/host/factory.ts` and the run-once
  workflow.
- Do not change GitHub support, planning workspaces, phase publication,
  recovery, merge behavior, branch cleanup, or the legacy URL-based Forgejo pull
  request body adapter.
- Use `CommandRunner`, `withTeaContext()`, and `withTeaRepositoryContext()`;
  invoke commands with argument arrays and never pass a title, body, branch,
  remote, or URL through a shell.
- The constructor rejects a blank configured push remote. Public operations
  reject invalid pull request numbers and invalid or owner-qualified Git branch
  names before running provider commands.
- Resolve both the live target and configured push-remote identity before each
  create, find, get, read-body, or update-body operation. Start those two
  resolutions independently with `Promise.all`.
- Allow target and head owners or repository names to differ, but require the
  provider and Forgejo host to match.
- Treat Forgejo's repository response as authoritative for owner and repository
  spelling, including renamed or transferred repositories.
- Require mutually consistent `name`, `full_name`, `owner.login`, and `html_url`
  repository fields. Never guess a missing nested repository.
- Normalize only the three specified state/merge combinations: `open`, `merged`,
  and `closed-unmerged`.
- List `state=all` with a fixed page size of `50`, starting at page `1`, and
  continue until the raw page has fewer than `50` entries. Never return a
  partial result.
- Convert only a nonzero exact get-endpoint result whose final complete HTTP
  status line is `404` into `PullRequestNotFoundError`.
- Keep command, authentication, rate-limit, transport, invalid-JSON, malformed
  response, identity, incomplete-search, and not-found failures distinct.
- Keep raw stdout and stderr available for explicit inspection but out of error
  messages and default JSON serialization.
- Keep each production module focused and target fewer than 200 meaningful
  lines. Split by the parser/command/facade boundaries below rather than adding
  generic helper modules.
- Add no npm dependencies. If implementation unexpectedly changes
  `package.json`, `package-lock.json`, or `npm-shrinkwrap.json`, run the
  repository-required Nix build.

---

## File and Module Map

### New production modules

- `src/host/forgejo-tea-pull-request-errors.ts` owns stable Forgejo adapter
  error categories, operation names, safe public fields, and non-enumerable raw
  diagnostics.
- `src/host/forgejo-tea-pull-request-parsing.ts` owns pure clone URL parsing,
  public input validation, repository payload normalization, and pull request
  payload normalization.
- `src/host/forgejo-tea-pull-request-commands.ts` owns `git` and `tea api`
  execution, target/explicit repository context, final HTTP status extraction,
  JSON decoding, and page advancement.
- `src/host/forgejo-tea-pull-requests.ts` owns the public
  `ForgejoTeaPullRequestHost` and operation-level live-context validation.

### New test modules

- `src/host/forgejo-tea-pull-request-parsing.test.ts` protects remote URL,
  repository payload, branch/number validation, and pull request normalization
  behavior.
- `src/host/forgejo-tea-pull-requests.test.ts` uses a recording runner to
  protect repository resolution, exact command arguments, pagination, operation
  orchestration, and failure classification.

### Existing modules consumed but not modified

- `src/host/pull-requests.ts:3-136` supplies `RepositoryIdentity`, normalized
  pull request types, identity comparison, foundation errors, and
  `PullRequestHost`.
- `src/host/forgejo-tea-context.ts:72-88` supplies target and explicit
  repository `tea` context argument insertion.
- `src/cli/commands/triage/types.ts:45-65` supplies `CommandResult` and
  `CommandRunner`.
- `test-support/command-runner.ts:20-37` supplies a reusable recording static
  command runner.

Do not modify `src/host/factory.ts`, `src/host/forgejo-tea.ts`,
`src/host/forgejo-pr-body.ts`, or files under `src/cli/commands/run-once/`.

---

### Task 1: Define safe Forgejo errors and pure normalization

**Files:**

- Create: `src/host/forgejo-tea-pull-request-errors.ts`
- Create: `src/host/forgejo-tea-pull-request-parsing.ts`
- Create: `src/host/forgejo-tea-pull-request-parsing.test.ts`

**Interfaces:**

- Consumes: `RepositoryIdentity`, `PullRequestSummary`,
  `PullRequestIdentityError`, and `sameRepositoryIdentity` from
  `src/host/pull-requests.ts`.
- Produces: `ForgejoPullRequestErrorCategory`, `ForgejoPullRequestOperation`,
  and `ForgejoTeaPullRequestError`.
- Produces: `ForgejoRemoteRepositoryCoordinates` and
  `parseForgejoRemoteUrl(remoteUrl)`.
- Produces: `validateForgejoRemoteName(remote)`,
  `validateForgejoBranchName(branch)`, and
  `validateForgejoPullRequestNumber(number)`.
- Produces: `normalizeForgejoRepository(payload, options)` and
  `normalizeForgejoPullRequest(payload, options)`.

- [ ] **Step 1: Write failing URL and public-input parsing tests**

Create `src/host/forgejo-tea-pull-request-parsing.test.ts`. Use table-driven
assertions for these exact successful clone URL cases:

```ts
const acceptedRemotes = [
  [
    "https://forge.example/acme/widgets.git",
    {
      host: "forge.example",
      owner: "acme",
      repository: "widgets",
      slug: "acme/widgets",
    },
  ],
  [
    "http://FORGE.EXAMPLE/acme/widgets",
    {
      host: "forge.example",
      owner: "acme",
      repository: "widgets",
      slug: "acme/widgets",
    },
  ],
  [
    "ssh://git@forge.example/acme/widgets.git",
    {
      host: "forge.example",
      owner: "acme",
      repository: "widgets",
      slug: "acme/widgets",
    },
  ],
  [
    "git@forge.example:acme/widgets.git",
    {
      host: "forge.example",
      owner: "acme",
      repository: "widgets",
      slug: "acme/widgets",
    },
  ],
] as const;
```

Reject all of these without copying the raw URL into the thrown error message or
`JSON.stringify(error)`:

```ts
const rejectedRemotes = [
  "/srv/git/acme/widgets.git",
  "file:///srv/git/acme/widgets.git",
  "https://robot:secret@forge.example/acme/widgets.git",
  "https://forge.example/widgets.git",
  "https://forge.example/group/acme/widgets.git",
  "https://forge.example/acme/widgets.git?token=secret",
  "git@forge.example:widgets.git",
  "git@forge.example:group/acme/widgets.git",
];
```

Also assert that an empty/whitespace remote name, branch values `""`,
`" owner:topic "`, `"owner:topic"`, `"topic..next"`, and `"-topic"`, and pull
request numbers `0`, `-1`, `1.5`, `Number.MAX_SAFE_INTEGER + 1`, and `NaN`
produce the adapter's `invalid-input` category. Assert that `"feature/topic"`
and a leading-hyphen remote name such as `"-publish"` remain valid.

- [ ] **Step 2: Write failing repository payload tests**

Add fixtures with the exact Forgejo repository shape:

```ts
const targetPayload = {
  name: "widgets-renamed",
  full_name: "platform/widgets-renamed",
  owner: { login: "platform" },
  html_url: "https://FORGE.EXAMPLE/platform/widgets-renamed",
};

const targetIdentity = {
  provider: "forgejo-tea",
  host: "forge.example",
  owner: "platform",
  repository: "widgets-renamed",
} as const;
```

Assert that `normalizeForgejoRepository` returns `targetIdentity`, proving that
the response rather than the raw remote slug is authoritative. Add individual
failure cases for:

- a non-object payload;
- missing or non-string `name`, `full_name`, `owner.login`, or `html_url`;
- an empty owner or repository;
- a non-HTTP(S), credential-bearing, query-bearing, or malformed web URL;
- disagreement between `name`, `full_name`, `owner.login`, and the URL path;
- an expected remote host that differs from the response host.

Expect structural failures to be `ForgejoTeaPullRequestError` with category
`malformed-response`. Expect complete but contradictory identity to be
`PullRequestIdentityError`. No failure message may contain credentials or the
raw response JSON.

- [ ] **Step 3: Write failing pull request normalization tests**

Use a complete nested fixture rather than replacing `base.repo` or `head.repo`
with slugs:

```ts
const openPullPayload = {
  number: 42,
  html_url: "https://forge.example/platform/widgets-renamed/pulls/42",
  body: "Refs #186",
  state: "open",
  merged: false,
  merge_commit_sha: null,
  base: { ref: "main", repo: targetPayload },
  head: {
    ref: "agent/issue-186-adapter",
    sha: "abc123",
    repo: {
      name: "widgets",
      full_name: "contributor/widgets",
      owner: { login: "contributor" },
      html_url: "https://forge.example/contributor/widgets",
    },
  },
};
```

Assert exact normalized summaries for:

- open with `merged: false` and no merge commit;
- closed/merged with `merged: true` and a nonblank `merge_commit_sha`;
- closed-unmerged with `merged: false` and no merge commit;
- same-owner and cross-owner heads.

Add rejection cases for an unsafe number, a URL with the wrong host, target,
path kind, or number, a non-string body, blank base/head refs or head SHA,
missing nested repositories, internally contradictory nested repositories,
unknown state, and every inconsistent merged flag/merge commit combination. Pass
`expectedNumber` for the number-mismatch test, `expectedTargetRepository` for
every test, and `expectedHeadRepository` for create/get-style tests. Verify a
structurally complete same-host head can be normalized without an
`expectedHeadRepository`; Task 3 will use that form while examining list results
and will filter it by exact query identity.

- [ ] **Step 4: Run the parsing test to prove RED**

Run:

```sh
node --test src/host/forgejo-tea-pull-request-parsing.test.ts
```

Expected: FAIL because the parsing and error modules do not exist.

- [ ] **Step 5: Implement the stable error surface**

Create `src/host/forgejo-tea-pull-request-errors.ts` with this public surface:

```ts
export type ForgejoPullRequestErrorCategory =
  | "invalid-input"
  | "command-failed"
  | "invalid-json"
  | "malformed-response";

export type ForgejoPullRequestOperation =
  | "validate-input"
  | "resolve-target-repository"
  | "resolve-remote-repository"
  | "create-pull-request"
  | "list-pull-requests"
  | "get-pull-request"
  | "update-pull-request";

export type ForgejoCommandName = "git" | "tea";

export type ForgejoCommandDiagnostics = Readonly<{
  stdout: string;
  stderr: string;
}>;

export class ForgejoTeaPullRequestError extends Error {
  readonly category: ForgejoPullRequestErrorCategory;
  readonly operation: ForgejoPullRequestOperation;
  readonly command?: ForgejoCommandName;
  readonly exitCode?: number;
  readonly httpStatus?: number;
  readonly rawDiagnostics?: ForgejoCommandDiagnostics;

  constructor(input: {
    category: ForgejoPullRequestErrorCategory;
    operation: ForgejoPullRequestOperation;
    command?: ForgejoCommandName;
    exitCode?: number;
    httpStatus?: number;
    rawDiagnostics?: ForgejoCommandDiagnostics;
    cause?: unknown;
  });
}
```

Set the public message only from `operation` and `category`, for example
`Forgejo pull request get-pull-request failed: command-failed`. Assign optional
safe fields only when present. Install `rawDiagnostics` with
`Object.defineProperty(..., { enumerable: false })`; do not put stdout, stderr,
command arguments, remote URLs, pull request titles, or bodies in the message.
Set `name` to `ForgejoTeaPullRequestError` and pass `cause` to `Error` only when
it is defined.

- [ ] **Step 6: Implement strict pure parsers and validators**

Create `src/host/forgejo-tea-pull-request-parsing.ts` with these exact exports:

```ts
export type ForgejoRemoteRepositoryCoordinates = {
  host: string;
  owner: string;
  repository: string;
  slug: string;
};

export function validateForgejoRemoteName(remote: string): void;
export function validateForgejoBranchName(branch: string): void;
export function validateForgejoPullRequestNumber(number: number): void;

export function parseForgejoRemoteUrl(
  remoteUrl: string,
): ForgejoRemoteRepositoryCoordinates;

export function normalizeForgejoRepository(
  payload: unknown,
  options: {
    operation: ForgejoPullRequestOperation;
    expectedHost?: string;
  },
): RepositoryIdentity;

export function normalizeForgejoPullRequest(
  payload: unknown,
  options: {
    operation: ForgejoPullRequestOperation;
    expectedTargetRepository: RepositoryIdentity;
    expectedHeadRepository?: RepositoryIdentity;
    expectedNumber?: number;
  },
): PullRequestSummary;
```

Implement the following rules directly in the pure module:

1. `parseForgejoRemoteUrl` accepts only HTTP, HTTPS, SSH URL, and scp-like
   forms; permits an SSH user but rejects HTTP credentials; rejects query and
   fragment data; requires exactly two nonempty path components; removes one
   trailing `.git`; and returns the lowercased URL host plus provider spelling
   for owner/repository. Throw `PullRequestIdentityError` with a fixed reason
   that does not contain the input URL.
2. Branch validation follows Git branch safety rules without running Git:
   require the original value to be nonblank and trimmed; reject a leading
   hyphen, exactly `@`, `..`, `@{`, control/space characters, `~ ^ : ? * [ \\`,
   leading/trailing or doubled slash, a trailing dot, a dot-leading path
   component, and a component ending in `.lock`. A slash inside a valid branch
   remains allowed.
3. Repository normalization requires exact agreement among `name`, `full_name`,
   `owner.login`, and the two-component HTTP(S) `html_url` path. Use
   `URL.host.toLowerCase()` for the normalized host. Reject URL credentials,
   query, fragment, and extra path components.
4. Pull request normalization parses both nested repositories with the same
   strict repository parser, requires the nested base identity to match the
   expected target, and requires the nested head identity to match the expected
   head whenever that option is present. It validates an exact
   `/owner/repository/pulls/<number>` HTTP(S) URL in the expected target.
5. Map only `open/false/null`, `closed/true/nonblank-string`, and
   `closed/false/null` to the three foundation statuses. Do not coerce strings,
   numbers, booleans, states, or nullability.

Use `PullRequestIdentityError` for complete identity disagreement. Use
`ForgejoTeaPullRequestError` category `malformed-response` for missing,
ill-typed, invalid URL, or inconsistent provider response fields.

- [ ] **Step 7: Format, validate, and commit the parsing slice**

Run:

```sh
npx --no-install prettier --write \
  src/host/forgejo-tea-pull-request-errors.ts \
  src/host/forgejo-tea-pull-request-parsing.ts \
  src/host/forgejo-tea-pull-request-parsing.test.ts
node --test src/host/forgejo-tea-pull-request-parsing.test.ts
npm run check:types
```

Expected: the focused test and strict type check PASS.

Commit:

```sh
git add \
  src/host/forgejo-tea-pull-request-errors.ts \
  src/host/forgejo-tea-pull-request-parsing.ts \
  src/host/forgejo-tea-pull-request-parsing.test.ts
git commit -m "feat(host): parse Forgejo pull request payloads"
```

---

### Task 2: Implement repository identity and command failure boundaries

**Files:**

- Create: `src/host/forgejo-tea-pull-request-commands.ts`
- Create: `src/host/forgejo-tea-pull-requests.test.ts`

**Interfaces:**

- Consumes: `CommandRunner`, `withTeaContext()`, `withTeaRepositoryContext()`,
  Task 1 parsers/errors, and foundation identity comparison/errors.
- Produces: `ForgejoTeaPullRequestCommandOptions` and the internal-facing
  `ForgejoTeaPullRequestCommands` command client.
- Produces now: `resolveTargetRepositoryIdentity(): Promise<RepositoryIdentity>`
  and `resolveRemoteRepositoryIdentity(remote): Promise<RepositoryIdentity>`.
- Produces private command primitives that Task 3 and Task 4 extend without
  duplicating status, diagnostics, or JSON behavior.

- [ ] **Step 1: Build recording-runner fixtures for exact commands**

Create `src/host/forgejo-tea-pull-requests.test.ts`. Import
`createStaticCommandRunner` from `../../test-support/command-runner.ts`, create
a temporary Git repository config with an `origin` URL, and add fixture helpers
with these signatures:

```ts
function repositoryPayload(input: {
  host?: string;
  owner: string;
  repository: string;
}): Record<string, unknown>;

function jsonResult(value: unknown, stderr?: string): CommandResult;

async function withForgejoRepository(
  run: (repoRoot: string) => Promise<void>,
): Promise<void>;
```

`withForgejoRepository` writes this target context and always removes its temp
directory in `finally`:

```ini
[remote "origin"]
    url = git@forge.example:legacy/widgets.git
```

- [ ] **Step 2: Write failing target and remote resolution tests**

Test that target resolution returns provider-normalized renamed identity and
records exactly:

```ts
{
  command: "tea",
  args: [
    "api",
    "/repos/{owner}/{repo}",
    "--include",
    "--repo",
    "legacy/widgets",
    "--login",
    "robot",
  ],
  cwd: repoRoot,
}
```

Test `resolveRemoteRepositoryIdentity("-publish")` with Git stdout containing
two push URLs for the same repository. Assert this first call:

```ts
{
  command: "git",
  args: ["remote", "get-url", "--push", "--all", "--", "-publish"],
  cwd: repoRoot,
}
```

Then assert one `tea api /repos/{owner}/{repo} --include` call per nonempty URL,
each with `--repo contributor/widgets --login robot`. Prove all results must
normalize to the same identity. Add failures for:

- a nonzero Git result;
- successful Git output with no nonempty URL;
- a rejected clone URL;
- a Forgejo response host that disagrees with its source remote host;
- two push URLs resolving to different owners or repositories.

Expect remote/response disagreements to use `PullRequestIdentityError`, not a
not-found error.

- [ ] **Step 3: Write failing status, JSON, and diagnostics tests**

For repository API calls, cover:

```ts
const statusCases = [
  { stderr: "HTTP/2 401 Unauthorized\n", expectedStatus: 401 },
  { stderr: "HTTP/1.1 429 Too Many Requests\n", expectedStatus: 429 },
  {
    stderr: "request failed with 404 in diagnostic text",
    expectedStatus: undefined,
  },
  {
    stderr: "HTTP/1.1 302 Found\nlocation: /next\n\nHTTP/2 403 Forbidden\n",
    expectedStatus: 403,
  },
] as const;
```

Assert nonzero results produce `ForgejoTeaPullRequestError` category
`command-failed` with exact operation, safe command name, exit code, and final
well-formed status when present. Assert invalid JSON on a successful command
produces category `invalid-json`. Assert a successful exit paired with a final
4xx/5xx status remains `command-failed`. Verify `rawDiagnostics` is readable by
explicit property access but absent from the public message, `Object.keys`, and
`JSON.stringify`.

- [ ] **Step 4: Run the command test to prove RED**

Run:

```sh
node --test src/host/forgejo-tea-pull-requests.test.ts
```

Expected: FAIL because the command client does not exist.

- [ ] **Step 5: Implement the command client core and identity methods**

Create `src/host/forgejo-tea-pull-request-commands.ts` with this initial public
surface:

```ts
export type ForgejoTeaPullRequestCommandOptions = {
  runner: CommandRunner;
  repoRoot: string;
  login?: string;
};

export class ForgejoTeaPullRequestCommands {
  constructor(options: ForgejoTeaPullRequestCommandOptions);

  resolveTargetRepositoryIdentity(): Promise<RepositoryIdentity>;

  resolveRemoteRepositoryIdentity(remote: string): Promise<RepositoryIdentity>;
}
```

Use one private raw API runner and one private JSON API runner. The raw runner
must:

- add `--include` to every `tea api` argument list;
- apply `withTeaContext` for target calls and `withTeaRepositoryContext` for
  parsed remote slugs;
- execute with `{ cwd: repoRoot }`;
- extract only complete lines matching
  `/^HTTP\/\d(?:\.\d)?[ \t]+([1-5]\d{2})(?:[ \t]+[^\r\n]*)?$/u` after removing a
  trailing carriage return, and retain the final match across redirect header
  blocks;
- treat nonzero exit or a final status of 400 or greater as `command-failed`;
- never classify based on free-form diagnostic text.

The JSON runner parses stdout only after command success and wraps JSON syntax
failure as category `invalid-json` without embedding stdout. Target resolution
normalizes the repository response. Remote resolution runs the exact Git
command, keeps every nonempty stdout line in order, resolves every URL through
Forgejo with explicit repository context, validates response-host agreement, and
then requires all normalized identities to satisfy `sameRepositoryIdentity`.

Do not deduplicate multiple push URLs: the spec requires every configured push
URL to resolve through Forgejo.

- [ ] **Step 6: Format, validate, and commit repository resolution**

Run:

```sh
npx --no-install prettier --write \
  src/host/forgejo-tea-pull-request-commands.ts \
  src/host/forgejo-tea-pull-requests.test.ts
node --test src/host/forgejo-tea-pull-requests.test.ts
npm run check:types
npm run check:architecture
```

Expected: focused tests, strict types, and architecture checks PASS.

Commit:

```sh
git add \
  src/host/forgejo-tea-pull-request-commands.ts \
  src/host/forgejo-tea-pull-requests.test.ts
git commit -m "feat(host): resolve Forgejo repository identities"
```

---

### Task 3: Add cross-owner creation and exhaustive exact discovery

**Files:**

- Modify: `src/host/forgejo-tea-pull-request-commands.ts`
- Create: `src/host/forgejo-tea-pull-requests.ts`
- Modify: `src/host/forgejo-tea-pull-requests.test.ts`

**Interfaces:**

- Consumes: Task 2 identity methods and Task 1 normalization/validators.
- Produces command methods `createPullRequestPayload(input): Promise<unknown>`
  and
  `listPullRequests(query, normalize): Promise<readonly PullRequestSummary[]>`.
- Produces public facade methods `resolveTargetRepositoryIdentity`,
  `resolveRemoteRepositoryIdentity`, `createPullRequest`, and
  `findPullRequests`.
- The class becomes a complete `PullRequestHost` in Task 4; do not add temporary
  methods that throw `not implemented`.

- [ ] **Step 1: Write failing cross-owner creation tests**

Extend `src/host/forgejo-tea-pull-requests.test.ts` with
`ForgejoTeaPullRequestHost` construction using:

```ts
new ForgejoTeaPullRequestHost({
  runner,
  repoRoot,
  pushRemote: "publish",
  login: "robot",
});
```

Script target resolution to return `platform/widgets` and push-remote resolution
to return `contributor/widgets` on the same Forgejo host. Call:

```ts
await host.createPullRequest({
  title: "Plan for #186",
  body: "Refs #186\n\nDetails",
  baseBranch: "main",
  headBranch: "agent/issue-186-adapter",
});
```

After the target `tea`, Git remote, and explicit remote `tea` calls, assert this
exact creation call:

```ts
{
  command: "tea",
  args: [
    "api",
    "/repos/{owner}/{repo}/pulls",
    "--method",
    "POST",
    "--field",
    "base=main",
    "--field",
    "head=contributor:agent/issue-186-adapter",
    "--field",
    "title=Plan for #186",
    "--field",
    "body=Refs #186\n\nDetails",
    "--include",
    "--repo",
    "legacy/widgets",
    "--login",
    "robot",
  ],
  cwd: repoRoot,
}
```

Assert the returned payload is normalized and that mismatched nested base/head
repositories or response branches fail closed. Add pre-command tests for a blank
constructor `pushRemote`, invalid base branch, and owner-qualified head branch.
Verify invalid input records no runner calls.

- [ ] **Step 2: Write failing exact discovery and pagination tests**

Add a `pullRequestPayload` fixture builder that always emits complete base and
head repository objects. Cover these behaviors:

1. Query target/head identities must match live target/configured push remote
   before the first list call.
2. The first list endpoint is exactly
   `/repos/{owner}/{repo}/pulls?state=all&page=1&limit=50`.
3. A raw page of exactly 50 entries causes page 2 to be fetched. A page of 49,
   one, or zero entries stops pagination.
4. Results are returned only after the short page succeeds and are filtered by
   case-insensitive `sameRepositoryIdentity` plus case-sensitive base and head
   branch equality.
5. A structurally complete, same-host nonmatching head repository is excluded; a
   missing or contradictory nested head repository is a malformed response.
6. A page-2 command error, invalid JSON value, non-array JSON payload, or
   malformed pull request rejects the whole call. Do not expose page-1 matches
   as a successful partial result.
7. A nonzero list response with an exact HTTP 404 remains an adapter
   `command-failed` error rather than `PullRequestNotFoundError`.

Use 50 generated complete payloads for the full page rather than weakening the
page size in production for tests.

- [ ] **Step 3: Run the create/discovery tests to prove RED**

Run:

```sh
node --test src/host/forgejo-tea-pull-requests.test.ts
```

Expected: FAIL because the facade and create/list command methods do not exist.

- [ ] **Step 4: Add create and paginated-list command methods**

Extend `ForgejoTeaPullRequestCommands` with:

```ts
createPullRequestPayload(input: {
  baseBranch: string;
  headOwner: string;
  headBranch: string;
  title: string;
  body: string;
}): Promise<unknown>;

listPullRequests<T>(input: {
  query: FindPullRequestsQuery;
  normalize: (payload: unknown) => T;
}): Promise<readonly T[]>;
```

Creation uses the exact POST fields and target context shown in Step 1. Listing
starts at page 1, validates that each decoded page is an array, normalizes every
entry before advancing, and accumulates privately. Return only after
`rawPage.length < 50`. Before incrementing a full-page number, prove the next
page is a positive safe integer; if it is not, throw
`IncompletePullRequestSearchError(input.query)` without returning the
accumulator. Preserve a later page's existing command, invalid-JSON, or
malformed-response error instead of replacing it with an incomplete-search
error.

- [ ] **Step 5: Implement the facade's shared live context and two operations**

Create `src/host/forgejo-tea-pull-requests.ts` with this initial shape:

```ts
export type ForgejoTeaPullRequestHostOptions = {
  runner: CommandRunner;
  repoRoot: string;
  pushRemote: string;
  login?: string;
};

export class ForgejoTeaPullRequestHost {
  readonly id = "forgejo-tea" as const;

  constructor(options: ForgejoTeaPullRequestHostOptions);

  resolveTargetRepositoryIdentity(): Promise<RepositoryIdentity>;

  resolveRemoteRepositoryIdentity(remote: string): Promise<RepositoryIdentity>;

  createPullRequest(input: CreatePullRequestInput): Promise<PullRequestSummary>;

  findPullRequests(
    query: FindPullRequestsQuery,
  ): Promise<readonly PullRequestSummary[]>;
}
```

The private operation-context method evaluates these promises together:

```ts
const [targetRepository, headRepository] = await Promise.all([
  this.commands.resolveTargetRepositoryIdentity(),
  this.commands.resolveRemoteRepositoryIdentity(this.options.pushRemote),
]);
```

Require matching provider and host while allowing different owner/repository.
For creation, validate branches before resolving context, derive
`<resolved-head-owner>:<head-branch>`, normalize with both expected identities,
and require the response base/head branches to equal the requested branches.

For discovery, validate branches, compare both query identities with live
context, call the command client's exhaustive list method, and normalize every
payload with the live target. Preserve each structurally complete nested head
identity so valid unrelated heads can be excluded by the final exact query
filter; require returned matches to equal the configured push identity. Perform
filtering only after every page has succeeded.

- [ ] **Step 6: Format, validate, and commit create/discovery**

Run:

```sh
npx --no-install prettier --write \
  src/host/forgejo-tea-pull-request-commands.ts \
  src/host/forgejo-tea-pull-requests.ts \
  src/host/forgejo-tea-pull-requests.test.ts
node --test \
  src/host/forgejo-tea-pull-request-parsing.test.ts \
  src/host/forgejo-tea-pull-requests.test.ts
npm run check:types
npm run check:architecture
```

Expected: all focused tests, strict types, and architecture checks PASS.

Commit:

```sh
git add \
  src/host/forgejo-tea-pull-request-commands.ts \
  src/host/forgejo-tea-pull-requests.ts \
  src/host/forgejo-tea-pull-requests.test.ts
git commit -m "feat(host): create and find Forgejo pull requests"
```

---

### Task 4: Complete get, body update, and exact 404 behavior

**Files:**

- Modify: `src/host/forgejo-tea-pull-request-commands.ts`
- Modify: `src/host/forgejo-tea-pull-requests.ts`
- Modify: `src/host/forgejo-tea-pull-requests.test.ts`

**Interfaces:**

- Consumes: `PullRequestReference`, `PullRequestNotFoundError`, live operation
  context, and Task 2's final-status command boundary.
- Produces command methods `getPullRequestPayload(reference): Promise<unknown>`
  and `updatePullRequestBody(reference, body): Promise<void>`.
- Produces the complete `getPullRequest`, `readPullRequestBody`, and
  `updatePullRequestBody` methods.
- Produces `ForgejoTeaPullRequestHost implements PullRequestHost` with no
  factory registration.

- [ ] **Step 1: Write failing exact get and body method tests**

Add tests that assert:

- `getPullRequest` compares the caller's target to live target context before
  calling `/repos/{owner}/{repo}/pulls/42`;
- the exact get command contains `--include`, target `--repo`, optional
  `--login`, and no high-level `tea pulls` command;
- the normalized response number equals the requested number and both complete
  nested identities equal the resolved live target/head;
- `readPullRequestBody` delegates through the same validated get path and
  returns the exact body string;
- an invalid number or mismatched caller target fails before the exact get
  command;
- wrong response number/URL, missing nested identity, or nested target/head
  mismatch fails closed.

Add an update test with a multiline body. Assert the operation first performs
the validated get and only then records this PATCH call:

```ts
{
  command: "tea",
  args: [
    "api",
    "/repos/{owner}/{repo}/pulls/42",
    "--method",
    "PATCH",
    "--field",
    "body=Summary\n\nDetails\n",
    "--include",
    "--repo",
    "legacy/widgets",
    "--login",
    "robot",
  ],
  cwd: repoRoot,
}
```

Assert no PATCH occurs when the validating get fails. Do not use or change
`updateForgejoPullRequestBody` from the legacy URL adapter.

- [ ] **Step 2: Write failing exact HTTP 404 classification tests**

For the exact get endpoint, prove that only this combination becomes
`PullRequestNotFoundError(reference)`:

```ts
{
  code: 1,
  stdout: "",
  stderr: "HTTP/2 404 Not Found\n",
}
```

Add separate tests proving these remain `ForgejoTeaPullRequestError` rather than
not-found:

- diagnostic prose containing `404` with no complete status line;
- exact 401, 403, and 429 status lines;
- a transport/CLI failure with no status;
- other exact 4xx and 5xx statuses;
- exit code 0 with an exact final 404 status;
- exit code 0 with invalid JSON;
- exit code 0 with structurally malformed JSON;
- a successful validating get followed by a PATCH whose nonzero response has an
  exact 404.

Add a redirect case whose stderr contains a complete 302 status followed by a
complete 404 status and assert the final status controls get classification. Add
the inverse 404-then-200 case and assert the successful final status permits
JSON normalization.

- [ ] **Step 3: Run get/body tests to prove RED**

Run:

```sh
node --test src/host/forgejo-tea-pull-requests.test.ts
```

Expected: FAIL because the exact get/PATCH command methods and public body
methods do not exist.

- [ ] **Step 4: Add exact get and PATCH command methods**

Extend the command client with:

```ts
getPullRequestPayload(reference: PullRequestReference): Promise<unknown>;

updatePullRequestBody(
  reference: PullRequestReference,
  body: string,
): Promise<void>;
```

Teach the private JSON API runner to accept an optional `notFoundReference`.
Only when that option is present, the process exit is nonzero, and the final
complete status is exactly 404 may it throw `PullRequestNotFoundError`. A status
404 paired with exit 0 follows the normal contradictory-status command error
path. The PATCH method does not pass a not-found reference, parses its
successful structured JSON response, and retains all ordinary adapter errors.

Both methods use the target repository context. Build the endpoint from the
already validated positive number and pass `body=<body>` as one argument after
one `--field` token.

- [ ] **Step 5: Complete the public `PullRequestHost` implementation**

Change the declaration to:

```ts
export class ForgejoTeaPullRequestHost implements PullRequestHost
```

Add the three interface methods. Each method validates the number before
starting commands. `getPullRequest` resolves target and configured head
independently, compares the reference target to the live target, calls the exact
get command, and normalizes with expected target, expected head, and expected
number. `readPullRequestBody` returns
`(await this.getPullRequest(reference)).body`. `updatePullRequestBody` awaits
`this.getPullRequest(reference)` before calling the PATCH command, ensuring no
caller-controlled URL reconstruction and no edit of an unvalidated pull request.

Do not export this class from the existing host factory and do not add it to
`RunOnceHostProvider`.

- [ ] **Step 6: Format, validate, and commit the complete adapter**

Run:

```sh
npx --no-install prettier --write \
  src/host/forgejo-tea-pull-request-commands.ts \
  src/host/forgejo-tea-pull-requests.ts \
  src/host/forgejo-tea-pull-requests.test.ts
node --test \
  src/host/forgejo-tea-pull-request-parsing.test.ts \
  src/host/forgejo-tea-pull-requests.test.ts
npm run check:types
npm run check:architecture
```

Expected: all focused tests, strict types, and architecture checks PASS.

Commit:

```sh
git add \
  src/host/forgejo-tea-pull-request-commands.ts \
  src/host/forgejo-tea-pull-requests.ts \
  src/host/forgejo-tea-pull-requests.test.ts
git commit -m "feat(host): get and update Forgejo pull requests"
```

---

### Task 5: Verify the complete isolated adapter

**Files:**

- Verify only; no planned file changes.

**Interfaces:**

- Consumes: all Issue 186 implementation commits.
- Produces: evidence that focused behavior, full repository checks, module
  boundaries, non-wiring, and dependency policy all hold.

- [ ] **Step 1: Run all focused Forgejo adapter tests together**

Run:

```sh
node --test \
  src/host/forgejo-tea-pull-request-parsing.test.ts \
  src/host/forgejo-tea-pull-requests.test.ts
```

Expected: both test files PASS, including normalization, exact commands,
pagination, and 404 classification.

- [ ] **Step 2: Run the repository validation commands**

Run exactly:

```sh
npm test
npm run build
npm run lint
npm run check:types
npm run check:architecture
git diff --check
```

Expected: every command exits with status 0.

- [ ] **Step 3: Apply the AGENTS.md dependency/Nix condition**

Run:

```sh
if git diff --name-only main...HEAD -- \
  package.json package-lock.json npm-shrinkwrap.json | grep -q .; then
  nix build .#patchmill --print-build-logs
else
  echo "Nix build skipped: npm dependency metadata unchanged"
fi
```

Expected for the planned implementation: print the skip message. If dependency
metadata changed unexpectedly and is retained, the Nix build must run and
exit 0.

- [ ] **Step 4: Verify scope and non-wiring directly**

Run:

```sh
git diff --name-only main...HEAD
rg -n "ForgejoTeaPullRequestHost" \
  src/host/factory.ts \
  src/cli/commands/run-once || true
```

Expected branch files:

```text
docs/plans/2026-09-07-issue-186-implement-the-forgejo-planning-pull-request-adapter.md
docs/specs/2026-09-07-issue-186-implement-the-forgejo-planning-pull-request-adapter-design.md
src/host/forgejo-tea-pull-request-commands.ts
src/host/forgejo-tea-pull-request-errors.ts
src/host/forgejo-tea-pull-request-parsing.test.ts
src/host/forgejo-tea-pull-request-parsing.ts
src/host/forgejo-tea-pull-requests.test.ts
src/host/forgejo-tea-pull-requests.ts
```

The `rg` command must print no factory or run-once reference. Investigate and
remove any other production or dependency file change before completion.

- [ ] **Step 5: Review module focus and report evidence**

Run:

```sh
wc -l \
  src/host/forgejo-tea-pull-request-errors.ts \
  src/host/forgejo-tea-pull-request-parsing.ts \
  src/host/forgejo-tea-pull-request-commands.ts \
  src/host/forgejo-tea-pull-requests.ts
git status --short
```

Review any production module substantially beyond 200 meaningful lines and split
only along the error/parsing/command/facade responsibilities already specified.
Expected final status is clean after the four implementation commits.

---

## Testing Value Gate

The two new automated test modules pass Patchmill's Testing Value Gate:

- They prove observable parsing, normalization, command arguments, pagination,
  and error-classification behavior rather than restating configuration.
- They fail for meaningful regressions such as accepting credential-bearing
  URLs, truncating a full page, using the wrong remote, omitting nested
  identity, shell-splitting a body, or converting a 403/429/transport failure to
  absence.
- Future provider-adapter maintainers benefit from rerunning deterministic
  command-boundary tests without live Forgejo mutations.
- The covered logic is reusable and safety-sensitive enough to justify test
  maintenance.

Do not add tests that merely assert factory source text, dependency file
contents, or documentation. Task 5 uses direct `rg`, file-list, dependency-diff,
build, lint, type, and architecture verification for those static constraints.

## Implementation Completion Report

The implementation worker reports:

- The four implementation commit hashes.
- Focused parsing and adapter test results.
- Full test, build, lint, strict type, architecture, and `git diff --check`
  results.
- Whether the conditional Nix build was skipped or run, with the dependency diff
  that justified the outcome.
- The final branch file list and confirmation that factory/run-once wiring is
  absent.
- Any deviation from the six planned production/test files and any residual risk
  in Forgejo CLI status formatting or provider payload compatibility.
