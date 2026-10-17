# Skills-first Patchmill kernel implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the deterministic workflow engine with a kernel that
supervises Pi, claims and releases issues, derives the phase from git and the
host, verifies the outcome, and fixes names. All judgment moves into skills.

**Architecture:** Task 1 deletes the old production tree and quality gates so
the repository is small and green before anything new lands. Tasks 2 to 13 build
the kernel bottom-up as small pure modules (config, names, result parsing,
hosts, lock, Pi supervision, git facts, phase table, envelope, verification,
labels). Task 14 composes them into `runOneIssue` and proves it end to end
against a fake host and a fake Pi. Tasks 15 to 19 add triage, the skills,
`init`/`auth`/`doctor`, and packaging and docs.

**Tech Stack:** Node 22+ TypeScript run directly (`node bin/patchmill.ts`),
`node --test`, `gh` and `tea` CLIs, bundled `@earendil-works/pi-coding-agent`,
`pi-subagents`.

**Spec:** `docs/specs/2026-10-15-skills-first-kernel-design.md`

## Global Constraints

- Blank slate: no code is ported from the deleted tree for compatibility. Old
  files on `main` may be read (`git show main:<path>`) only as a record of which
  `gh`/`tea` invocations and JSON fields worked.
- No upgrade path: no code reads, renames, or warns about run state, config
  keys, labels, specs, or plans from an earlier Patchmill.
- The config loader recognises exactly the keys in the spec's Configuration
  section; any other key fails loading and names the key. Loader under 200
  lines.
- The run envelope is one file under 150 lines. The agent result block has
  exactly `status` and `summary`.
- The kernel never sets `agent-done` without an open, non-draft pull request
  whose head is the issue branch and whose body closes the issue.
- No persisted workflow state. `result.json` and logs are write-only.
- Names: branch `agent/issue-<N>-<slug>` (slug at most 48 characters); worktree
  `<worktreeDir>/<branch with "/" replaced by "-">`; spec
  `<specsDir>/<YYYY-MM-DD>-issue-<N>-<slug>-design.md`; plan
  `<plansDir>/<YYYY-MM-DD>-issue-<N>-<slug>.md`; run directory
  `<runsDir>/issue-<N>/<run-id>/` with `prompt.md`, `pi.log`, `sessions/`,
  `result.json`.
- Pi invocation:
  `PI_CODING_AGENT_DIR=<repoRoot>/<pi.agentDir> pi -p --session-dir <runDir>/sessions --skill <skillPath> @<runDir>/prompt.md`,
  cwd = worktree, own process group, `SIGTERM` then `SIGKILL`.
- Size targets (review checks, not CI gates): production code at most 4,300
  lines measured with
  `find src bin -name '*.ts' ! -name '*.test.ts' | xargs cat | wc -l`; bundled
  skills under 1,500 lines.
- Quality gates kept: `tsc`, ESLint, Prettier, markdownlint, `node --test`.
  Removed: Stryker, CRAP, dependency-cruiser, property tests, contract-tests
  type check.
- Apply the Testing Value Gate. No new tests for package.json, workflow YAML,
  docs, or static config; verify those with the relevant command.
- Commits use Conventional Commits (release-please). The whole change is a
  breaking release: use `!` on the first commit (Task 1) so the changelog
  records it.
- After `package.json` or lockfile changes, rerun the Nix build
  (`nix build .#default` from the repo root) and update `npmDepsHash` in
  `nix/package.nix` with the existing `scripts/update-npm-deps-hash` helper.

## Review Focus

1. An issue title with no letters or digits (for example `???`) yields an empty
   slug. Expected: branch `agent/issue-<N>` with no trailing hyphen, and the
   remote-branch match still finds it. Pinned in Task 3.
2. The worktree directory exists on disk but git no longer knows it (a human
   deleted it from `git worktree list` or it is a leftover empty directory).
   Expected: `git worktree prune` then recreate; the run does not fail with
   "already exists". Pinned in Task 9.
3. Pi output contains more than one fenced `json` block (the agent quotes the
   contract, then prints the real result) or prose after the block. Expected:
   the last block wins; trailing prose is ignored. Pinned in Task 4.
4. Two clones claim the same issue. On the re-read after the label swap the
   issue already carries `in-progress` added by someone else, or `agent-ready`
   is gone. Expected: this attempt releases its lock, changes no labels, posts
   no comment, and reports "claimed elsewhere". Pinned in Task 14.
5. `--issue N` names an issue that is closed, or that carries `in-progress`.
   Expected: no claim, no Pi run, a clear message, exit code 1. Pinned in
   Task 14.

---

## File map

Kept from the current tree: `bin/patchmill.ts` and its tests,
`src/package-root.ts`, `src/runtime-dependency-preflight.ts`,
`src/pi/pi-subagents-package.ts`, `src/cli/pi-cli.ts`,
`src/cli/commands/version/`, `src/cli/commands/setup-test-repo/` (its `main.ts`
is rewritten in Task 6), `scripts/`, `fixtures/patchmill-test-repo/`, `vendor/`.

New tree:

| Path                                                              | Responsibility                                                                         |
| ----------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| `src/cli/main.ts`                                                 | Command dispatch and help text.                                                        |
| `src/cli/commands/<cmd>/main.ts`                                  | One thin CLI entry per command: init, auth, doctor, labels, triage, run-once, release. |
| `src/cli/commands/init/skill-installer.ts`                        | Pinned, idempotent copy of bundled and third-party skills into `.patchmill/skills`.    |
| `src/cli/commands/init/agent-dir.ts`                              | Provision `.patchmill/pi-agent` and local git excludes.                                |
| `src/config/config.ts`                                            | Config types, defaults, strict loader.                                                 |
| `src/host/types.ts`                                               | `Host`, `RepositorySetupHost`, `Issue`, `PullRequest`, label types.                    |
| `src/host/github-gh.ts`, `forgejo-tea.ts`                         | Adapters. `src/host/factory.ts` picks one from config.                                 |
| `src/process/command.ts`                                          | `CommandRunner`: spawn, capture, env, cwd.                                             |
| `src/kernel/names.ts`                                             | Slug, branch, worktree, spec, plan, run directory rules.                               |
| `src/kernel/result.ts`                                            | Last fenced JSON block to `{ status, summary }`.                                       |
| `src/kernel/lock.ts`                                              | Permanent-inode OS advisory issue lock.                                                |
| `src/kernel/pi-supervisor.ts`                                     | Spawn Pi in its own group, timeout, log tee.                                           |
| `src/kernel/pi-cost.ts`                                           | Best-effort usage sum from session files.                                              |
| `src/kernel/git.ts`                                               | Fetch, remote branch lookup, worktree creation, dirty and unpushed checks.             |
| `src/kernel/facts.ts`, `phase.ts`                                 | Collect F1 to F5; pure phase table.                                                    |
| `src/kernel/envelope.ts`, `run-envelope.md`, `triage-envelope.md` | Prompt rendering. The run envelope is the one-file template.                           |
| `src/kernel/verify.ts`                                            | Pure outcome table.                                                                    |
| `src/kernel/labels.ts`                                            | Label catalog and claim/release swaps.                                                 |
| `src/kernel/run-once.ts`                                          | `runOneIssue`.                                                                         |
| `src/kernel/triage.ts`                                            | `runTriage`.                                                                           |
| `test-support/fake-host.ts`                                       | File-backed in-memory `Host` shared with the fake Pi process.                          |
| `test-support/fake-pi.mjs`                                        | Scripted stand-in for the `pi` binary.                                                 |
| `test-support/git-fixture.ts`                                     | Bare origin plus clone in a temp directory.                                            |
| `skills/patchmill-implementation/`                                | New skill replacing `inline-dev-with-validation-and-pr-checks`.                        |

---

### Task 1: Clear the old tree and the removed quality gates

**Files:**

- Delete:
  `src/cli/commands/{run,run-once,set-artifact,skills,triage,init,auth,doctor,labels}/`,
  `src/cli/legacy-planning-deprecations.ts` and its test,
  `src/{workflow,git,issue,issue-run,issue-state,policy,host,config,process,command}/`,
  `src/pi/` except `pi-subagents-package.ts` and
  `pi-subagents-dependency-contract.test.ts`,
  `src/cli/commands/setup-test-repo/main.ts` and `main.test.ts`, `extensions/`,
  `fixtures/run-once-extension-load-sentinel.ts`,
  `fixtures/run-once-installed-extension-load.mjs`, `quality/`,
  `stryker.config.mjs`, `dependency-cruiser.config.mjs`,
  `tsconfig.contract-tests.json`, `.c8rc.json`, and every file in
  `test-support/` except `npm-shrinkwrap.test.ts`,
  `update-npm-deps-hash.test.ts`, and
  `patchmill-bootstrap-{loader,main,register}.mjs`.
- Create: `src/host/types.ts`
- Modify: `package.json`, `tsconfig.quality.json`, `eslint.config.js`,
  `nix/package.nix`, `scripts/smoke-packed-artifact.mjs`,
  `bin/package-files.test.ts`, `src/cli/main.ts`, `src/cli/main.test.ts`,
  `src/cli/commands/setup-test-repo/args.ts`,
  `src/cli/commands/setup-test-repo/labels.ts`
- Test: `src/cli/main.test.ts`

**Interfaces:**

- Produces: `src/host/types.ts` exporting

```ts
export type HostProviderId = "github-gh" | "forgejo-tea";
export type IssueComment = { author: string; body: string; createdAt: string };
export type Issue = {
  number: number;
  title: string;
  body: string;
  labels: string[];
  state: "open" | "closed";
  url: string;
  author: string;
  createdAt: string;
  comments: IssueComment[];
};
export type PullRequest = {
  number: number;
  url: string;
  state: "open" | "merged" | "closed";
  draft: boolean;
  body: string;
  headBranch: string;
};
export type LabelDefinition = {
  name: string;
  color: string;
  description: string;
};
export type HostCliCheck = { ok: boolean; message: string; login?: string };
export type Repository = { owner: string; repo: string; defaultBranch: string };
export interface Host {
  checkCli(): Promise<HostCliCheck>;
  repository(): Promise<Repository>;
  listOpenIssues(): Promise<Issue[]>; // comments may be empty
  viewIssue(n: number): Promise<Issue>; // comments populated
  listLabels(): Promise<string[]>;
  createLabel(label: LabelDefinition): Promise<void>;
  setLabels(n: number, add: string[], remove: string[]): Promise<void>;
  commentIssue(n: number, body: string): Promise<void>;
  findPullRequestByHead(branch: string): Promise<PullRequest | undefined>;
}
export type RepositoryTarget = { owner: string; repo: string; slug: string };
export interface RepositorySetupHost {
  displayName: string;
  checkCli(): Promise<HostCliCheck>;
  getRepository(
    target: RepositoryTarget,
  ): Promise<{ publicUrl: string; gitRemoteUrl: string } | undefined>;
  createPublicRepo(target: RepositoryTarget): Promise<void>;
  deleteRepo(target: RepositoryTarget): Promise<void>;
  cloneCommand(target: RepositoryTarget): string;
  listLabels(target: RepositoryTarget): Promise<string[]>;
  createLabel(target: RepositoryTarget, label: LabelDefinition): Promise<void>;
  createIssue(
    target: RepositoryTarget,
    issue: { title: string; body: string; labels: string[] },
  ): Promise<void>;
}
```

- Produces: `src/cli/main.ts` keeps `createCliMain(commands, output)` and
  `resolveCommand` as today. `HELP_TEXT` lists exactly: init, auth, doctor,
  labels, triage, run-once, release, version, setup-test-repo. `COMMANDS`
  registers only `version` in this task; later tasks add entries.

- [ ] **Step 1: Delete the listed paths with `git rm -r`**

- [ ] **Step 2: Edit `package.json`**

Remove scripts `check:architecture`, `check:coverage`, `check:crap`,
`check:crap:strict`, `check:mutation`, `check:property`, `test:mutation`,
`check:contract-tests`, `check:static`, `test:coverage`, `test:triage`,
`test:run-once`. Set `test` to:

```text
npm run check:types && GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_NOSYSTEM=1 node --test "bin/*.test.ts" "src/**/*.test.ts" "test-support/*.test.ts" "scripts/*.test.mjs"
```

Remove `extensions` from `files`. Remove devDependencies
`@stryker-mutator/core`, `c8`, `crap-ts`, `dependency-cruiser`, `fast-check`.
Run `npm install` so `package-lock.json` and `npm-shrinkwrap.json` follow.

- [ ] **Step 3: Trim tooling config**

`tsconfig.quality.json`: include only `bin`, `src`, `test-support`, `scripts`.
`eslint.config.js`: drop the `extensions/**` ignore. `nix/package.nix`: remove
the `cp -R .../extensions` line and any `installCheckPhase` step beyond
`patchmill --help` and `patchmill version`. `scripts/smoke-packed-artifact.mjs`:
keep pack, install, `--help`, `init`, and the
`.patchmill/skills/patchmill-issue-triage/SKILL.md` existence check; delete the
resource-profile and extension-load section. `bin/package-files.test.ts`: remove
the `extensions/todos.ts` assertion.

- [ ] **Step 4: Write `src/host/types.ts` and repoint `setup-test-repo/args.ts`
      and `labels.ts` imports to it**

- [ ] **Step 5: Write the failing CLI test**

In `src/cli/main.test.ts` keep only tests of `createCliMain`: help returns 0 and
prints `HELP_TEXT`; unknown command returns 1; `version` dispatches. Assert
`HELP_TEXT` contains `release` and does not contain `set-spec`, `skills`, or the
word `run` followed by a space.

- [ ] **Step 6: Rewrite `src/cli/main.ts` and run `npm test`**

Run: `npm test` Expected: PASS. `npm run lint` and `npm run build` also pass.

- [ ] **Step 7: Rebuild Nix and update the hash**

Run: `nix build .#default` after `scripts/update-npm-deps-hash`. Expected: build
succeeds.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "refactor!: remove the workflow engine and its quality gates

BREAKING CHANGE: the planning state machine, recovery, todo contract, and the run, skills, set-spec, and set-plan commands are gone. A skills-first kernel replaces them in the following commits."
```

---

### Task 2: Strict config loader

**Files:**

- Create: `src/config/config.ts`
- Test: `src/config/config.test.ts`

**Interfaces:**

- Produces:

```ts
export const CONFIG_FILE = "patchmill.config.json";
export type LabelsConfig = {
  ready: string;
  inProgress: string;
  specReview: string;
  specApproved: string;
  needsInfo: string;
  done: string;
  unsuitable: string;
  blocked: string;
};
export type PatchmillConfig = {
  host: { provider: HostProviderId; login: string; trustedAuthors: string[] };
  labels: LabelsConfig;
  paths: {
    specsDir: string;
    plansDir: string;
    worktreeDir: string;
    runsDir: string;
  };
  git: { baseBranch: string | null };
  skills: { triage: string; planning: string; implementation: string };
  pi: { agentDir: string; timeoutMinutes: number };
  workflow: { specApproval: { required: boolean } };
};
export const DEFAULT_CONFIG: PatchmillConfig; // exactly the spec's JSON
export class ConfigError extends Error {}
export function parseConfig(raw: unknown): PatchmillConfig; // partial over defaults
export async function loadConfig(repoRoot: string): Promise<PatchmillConfig>;
export function trustedAuthors(config: PatchmillConfig): string[]; // login (if non-empty) + trustedAuthors, deduplicated
```

- [ ] **Step 1: Write failing tests**

`parseConfig({})` equals `DEFAULT_CONFIG`.
`parseConfig({ pi: { timeoutMinutes: 5 } }).pi.timeoutMinutes === 5` with the
rest default. Unknown top-level key `planning` throws `ConfigError` whose
message contains `planning`. Unknown nested key `workflow.planApproval` throws
with message containing `workflow.planApproval`. Wrong type
`pi.timeoutMinutes: "5"` throws naming `pi.timeoutMinutes`.
`host.provider: "gitlab"` throws naming `host.provider`. `git.baseBranch: null`
is accepted. `loadConfig` on a directory without the file throws `ConfigError`
whose message contains `patchmill init`. `trustedAuthors` with login `""`
returns only `trustedAuthors`.

- [ ] **Step 2: Run tests; expect failure on missing module**

- [ ] **Step 3: Implement `src/config/config.ts`**

Walk a schema table of `{ path, kind }` entries; report the first unknown or
mistyped key by dotted path. No deep-merge helper library.

- [ ] **Step 4: Run tests; expect PASS. Check `wc -l src/config/config.ts` is
      under 200.**

- [ ] **Step 5: Commit** `feat(config): add the strict kernel config loader`

---

### Task 3: Names and paths

**Files:**

- Create: `src/kernel/names.ts`
- Test: `src/kernel/names.test.ts`

**Interfaces:**

- Produces:

```ts
export function slugify(title: string): string; // lowercase, [a-z0-9] runs joined by "-", trimmed, max 48 chars
export function branchName(issue: number, title: string): string; // "agent/issue-N-slug" or "agent/issue-N" when slug is empty
export function isIssueBranch(issue: number, branch: string): boolean; // matches /^agent\/issue-N(-|$)/
export function worktreeDirName(branch: string): string; // branch with "/" replaced by "-"
export function isSpecFile(issue: number, fileName: string): boolean; // /^\d{4}-\d{2}-\d{2}-issue-N-.+-design\.md$/
export function isPlanFile(issue: number, fileName: string): boolean; // /^\d{4}-\d{2}-\d{2}-issue-N-.+\.md$/
export function specFileName(date: Date, issue: number, title: string): string;
export function planFileName(date: Date, issue: number, title: string): string;
export function newRunId(now: Date): string; // "YYYYMMDD-HHMMSS-xxxx" (4 random hex)
export function runDirectory(
  runsDir: string,
  issue: number,
  runId: string,
): string;
```

- [ ] **Step 1: Write failing tests**

`slugify("Fix: login  crashes!")` is `fix-login-crashes`. A 60-character title
slug is cut to 48 characters and does not end with `-`. `slugify("???")` is `""`
and `branchName(7, "???")` is `agent/issue-7` (Review Focus 1).
`isIssueBranch(1, "agent/issue-12-foo")` is false;
`isIssueBranch(1, "agent/issue-1")` is true.
`isSpecFile(5, "2026-10-15-issue-5-login-design.md")` true;
`isSpecFile(5, "2026-10-15-issue-50-login-design.md")` false;
`isSpecFile(5, "issue-5-design.md")` false.
`isPlanFile(5, "2026-10-15-issue-5-login.md")` true.
`worktreeDirName("agent/issue-5-login")` is `agent-issue-5-login`.
`runDirectory(".patchmill/runs", 5, "x")` is `.patchmill/runs/issue-5/x`.

- [ ] **Step 2: Run tests; expect failure**
- [ ] **Step 3: Implement**
- [ ] **Step 4: Run tests; expect PASS**
- [ ] **Step 5: Commit**
      `feat(kernel): add branch, worktree, artifact, and run naming rules`

---

### Task 4: Result block parsing

**Files:**

- Create: `src/kernel/result.ts`
- Test: `src/kernel/result.test.ts`

**Interfaces:**

- Produces:

````ts
export type AgentStatus = "done" | "needs-input" | "failed";
export type AgentResult = { status: AgentStatus; summary: string };
export type ParsedResult =
  | { ok: true; result: AgentResult }
  | { ok: false; reason: string };
export function lastJsonBlock(text: string): string | undefined; // content of the last ```json fence
export function parseAgentResult(stdout: string): ParsedResult;
export function parseJsonBlock<T>(
  stdout: string,
  validate: (value: unknown) => T | string,
): { ok: true; value: T } | { ok: false; reason: string };
````

`parseAgentResult` is `parseJsonBlock` with the two-field validator. Triage
(Task 15) reuses `parseJsonBlock`.

- [ ] **Step 1: Write failing tests**

No fence: `{ ok: false, reason: "no result" }`. A fence whose opening line uses
an upper-case `JSON` info string and CRLF line endings parses. Two blocks, the
first `{"status":"done","summary":"example"}` and the last
`{"status":"needs-input","summary":"q"}`, followed by two lines of prose: result
is `needs-input` (Review Focus 3). Invalid JSON: `ok: false` with reason
containing `invalid JSON`. `status: "complete"`: reason names the allowed
values. Extra field `prUrl`: reason contains `prUrl`. Missing `summary`: reason
contains `summary`.

- [ ] **Step 2: Run tests; expect failure**
- [ ] **Step 3: Implement**
- [ ] **Step 4: Run tests; expect PASS**
- [ ] **Step 5: Commit** `feat(kernel): parse the agent result block`

---

### Task 5: Command runner and the GitHub adapter

**Files:**

- Create: `src/process/command.ts`, `src/host/github-gh.ts`,
  `src/host/factory.ts`, `test-support/recording-runner.ts`
- Test: `src/process/command.test.ts`, `src/host/github-gh.test.ts`

**Interfaces:**

- Produces:

```ts
// src/process/command.ts
export type CommandResult = { code: number; stdout: string; stderr: string };
export type CommandRunOptions = {
  cwd?: string;
  env?: Record<string, string | undefined>;
  signal?: AbortSignal;
};
export type CommandRunner = (
  command: string,
  args: string[],
  options?: CommandRunOptions,
) => Promise<CommandResult>;
export const runCommand: CommandRunner; // spawn, stdio piped, never throws on non-zero exit
export class CommandFailedError extends Error {
  constructor(command: string, args: string[], result: CommandResult);
}

// src/host/github-gh.ts
export class GitHubHost implements Host, RepositorySetupHost {
  constructor(options: { runner: CommandRunner; repoRoot: string });
}
// src/host/factory.ts
export function createHost(
  config: PatchmillConfig,
  runner: CommandRunner,
  repoRoot: string,
): Host & RepositorySetupHost;
export function createHostForProvider(
  provider: HostProviderId,
  login: string,
  runner: CommandRunner,
  repoRoot: string,
): Host & RepositorySetupHost;

// test-support/recording-runner.ts
export function recordingRunner(
  responses: Array<{ match: RegExp; result: Partial<CommandResult> }>,
): CommandRunner & { calls: string[][] };
```

`gh` invocations, all with `cwd: repoRoot`:

| Method                  | Command                                                                                                                                                                                                                       |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `checkCli`              | `gh --version`, then `gh auth status`; `login` from `gh api user --jq .login` when auth passes.                                                                                                                               |
| `repository`            | `gh repo view --json nameWithOwner,defaultBranchRef`                                                                                                                                                                          |
| `listOpenIssues`        | `gh issue list --state open --limit 200 --json number,title,body,labels,state,url,author,createdAt`                                                                                                                           |
| `viewIssue`             | `gh issue view N --json number,title,body,labels,state,url,author,createdAt,comments`                                                                                                                                         |
| `listLabels`            | `gh label list --limit 200 --json name`                                                                                                                                                                                       |
| `createLabel`           | `gh label create NAME --color C --description D`                                                                                                                                                                              |
| `setLabels`             | `gh issue edit N --add-label a,b --remove-label c` (omit a flag when its list is empty; no call when both are empty)                                                                                                          |
| `commentIssue`          | `gh issue comment N --body-file -` with the body on stdin (`CommandRunOptions` gains `stdin?: string`)                                                                                                                        |
| `findPullRequestByHead` | `gh pr list --head BRANCH --state all --limit 20 --json number,url,state,isDraft,body,headRefName`; keep entries whose `headRefName` equals the branch; prefer `OPEN`, then `MERGED`, then `CLOSED`; map state to lower case. |
| Setup methods           | Use the `gh repo view/create/delete` and `gh issue create` forms recorded in `git show main:src/host/github-gh.ts`.                                                                                                           |

- [ ] **Step 1: Write failing tests**

`command.test.ts`:
`runCommand(process.execPath, ["-e", "process.stdout.write('hi'); process.exit(3)"])`
gives `{ code: 3, stdout: "hi" }`; `stdin` option is delivered to the child.

`github-gh.test.ts` with `recordingRunner`:
`findPullRequestByHead("agent/issue-3-x")` given a list with a CLOSED and an
OPEN draft entry returns the open one with `draft: true` and `state: "open"`; an
entry whose `headRefName` differs is ignored; an empty list returns `undefined`.
`setLabels(3, ["a"], [])` records argv without `--remove-label`. `viewIssue`
maps `labels[].name`, `author.login`, and `comments[].author.login` into
`Issue`. `checkCli` returns `ok: false` when `gh auth status` exits non-zero.

- [ ] **Step 2: Run tests; expect failure**
- [ ] **Step 3: Implement the three files**
- [ ] **Step 4: Run tests; expect PASS**
- [ ] **Step 5: Commit**
      `feat(host): add the command runner and the GitHub gh adapter`

---

### Task 6: Forgejo adapter and `setup-test-repo` rewiring

**Files:**

- Create: `src/host/forgejo-tea.ts`, `src/cli/commands/setup-test-repo/main.ts`
- Modify: `src/host/factory.ts`, `src/cli/main.ts` (register `setup-test-repo`)
- Test: `src/host/forgejo-tea.test.ts`,
  `src/cli/commands/setup-test-repo/main.test.ts`

**Interfaces:**

- Produces:
  `export class ForgejoHost implements Host, RepositorySetupHost { constructor(options: { runner: CommandRunner; repoRoot: string; login: string }) }`.
- Every `tea` call runs with `cwd: repoRoot`, appends `--login <login>` when
  `login` is non-empty, and `--repo <owner/repo>` derived from
  `git remote get-url origin` (fail with a clear error when the URL does not
  parse). The exact `tea` subcommands, flags, and JSON fields are those recorded
  in `git show main:src/host/forgejo-tea.ts` and
  `git show main:src/host/forgejo-tea-pull-request-commands.ts`; reuse the
  invocations, not the code.
- `setup-test-repo/main.ts` keeps the behaviour and flags of the version on
  `main` (`--provider`, `--repo`, `--login`, `--reset`) and takes its host from
  `createHostForProvider`.

- [ ] **Step 1: Write failing tests**

`forgejo-tea.test.ts`: every recorded argv contains `--repo owner/repo` and,
when login is set, `--login name`; `findPullRequestByHead` filters by head
branch and maps draft and state; `setLabels` sends add and remove flags.

`setup-test-repo/main.test.ts`: with a fake `RepositorySetupHost`, `--reset`
deletes then creates the repository and creates the fixture issues; missing
`--repo` exits 1 with a message.

- [ ] **Step 2: Run tests; expect failure**
- [ ] **Step 3: Implement; register `setup-test-repo` in `COMMANDS`**
- [ ] **Step 4: Run `npm test`; expect PASS**
- [ ] **Step 5: Commit**
      `feat(host): add the Forgejo tea adapter and restore setup-test-repo`

---

### Task 7: Issue lock

**Spec revision:**
[Approved OS-managed lock design](../specs/2026-10-16-issue-lock-design.md).
This revision replaces the unsafe `wx`/PID-check/unlink algorithm.

**Files:**

- Create: `src/kernel/lock.ts`
- Test: `src/kernel/lock.test.ts`
- Create if needed: `test-support/issue-lock-child.mjs` for subprocess barriers
- Modify: `package.json`, `package-lock.json`, `npm-shrinkwrap.json`
- Modify: `nix/package.nix` for the dependency hash and necessary native build
  support

**Interfaces:**

- Produces:

```ts
export type LockRecord = { pid: number; startedAt: string };
export class LockHeldError extends Error {
  readonly record: LockRecord | undefined;
}
export type IssueLock = { path: string; release(): Promise<void> };
export async function acquireLock(
  path: string,
  options?: { pid?: number; now?: () => Date },
): Promise<IssueLock>;
export async function readLock(path: string): Promise<LockRecord | undefined>;
```

Use `fs-ext@2.1.1` nonblocking exclusive `flock` on a permanent file. Open
without truncation, acquire once, then publish JSON through the held handle.
Keep that handle until release. Never unlink or replace the file or its
containing directory. PID metadata never authorizes ownership. `readLock` is
diagnostic-only. Missing, empty, or malformed JSON gives `undefined`; genuine
filesystem errors propagate. Contention can lack valid owner metadata. Close
losing/error handles. Release clears JSON while locked, then closes in
`finally`. Repeated release calls share one promise.

- [ ] **Step 1: Write failing behavioral tests**

Use real OS locks and temporary directories. Use IPC barriers for subprocess
ordering, not sleep-based stress loops. Prove these cases:

1. Acquire writes `pid` and `startedAt`; an independent open contends even in
   the same process. Missing metadata never permits a second owner.
2. Two contenders recovering stale or corrupt diagnostic JSON yield one owner.
3. A preopened contender cannot acquire an old inode while a successor owns the
   permanent file. The inode stays unchanged across ownership changes.
4. Release clears diagnostics but leaves the file. Repeated/concurrent old
   release calls cannot disturb a successor or close a reused descriptor.
5. Owner process exit releases ownership without PID-based reclamation. An
   ordinary spawned child does not keep the owner's descriptor alive.
6. Metadata-write failure closes ownership. Genuine open/read/lock errors
   propagate rather than triggering recovery.

- [ ] **Step 2: Run `node --test src/kernel/lock.test.ts`; expect behavioral
      RED**
- [ ] **Step 3: Add the native dependency and implement the lock**

Use suitable development typings. Keep both npm lock artifacts identical.
Refresh the Nix dependency hash. Add native toolchain inputs only if the pinned
Nix builder needs them. Do not change Pi or skill-pack versions.

- [ ] **Step 4: Run covering tests, `npm test`, `npm run lint`, `npm run build`,
      and `nix build .#patchmill --no-link`; expect PASS**

Stage new tracked sources before the normal git-backed Nix build. Report which
platform was tested. Do not claim a Linux run proves Darwin support.

- [ ] **Step 5: Commit** `feat(kernel): add the per-issue run lock`

---

### Task 8: Pi supervisor and cost

**Files:**

- Create: `src/kernel/pi-supervisor.ts`, `src/kernel/pi-cost.ts`,
  `test-support/fake-pi.mjs`
- Test: `src/kernel/pi-supervisor.test.ts`, `src/kernel/pi-cost.test.ts`

**Interfaces:**

- Consumes: `PiCommandSpec` and `resolveBundledPiCommand()` from
  `src/cli/pi-cli.ts`.
- Produces:

```ts
// pi-supervisor.ts
export type PiSessionOptions = {
  command: PiCommandSpec;
  cwd: string;
  agentDir: string;
  sessionDir: string;
  skillPath: string;
  promptPath: string;
  logPath: string;
  extensionPaths: string[];
  timeoutMs: number;
  graceMs?: number; // graceMs default 5_000
  signal?: AbortSignal;
  onOutput?: (chunk: string) => void;
  env?: Record<string, string | undefined>;
};
export type PiSession = {
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  timedOut: boolean;
  aborted: boolean;
  stdout: string;
  durationMs: number;
};
export async function supervisePi(
  options: PiSessionOptions,
): Promise<PiSession>;
export function piArgs(options: PiSessionOptions): string[]; // ["-p", "--session-dir", sessionDir, "--skill", skillPath, ...extensionPaths.flatMap(p => ["-e", p]), "@" + promptPath]

// pi-cost.ts
export type PiUsage = {
  inputTokens: number;
  outputTokens: number;
  costUsd?: number;
};
export async function sumSessionUsage(
  sessionDir: string,
): Promise<PiUsage | undefined>; // undefined on any read or parse problem
export function costLine(usage: PiUsage | undefined): string; // "Cost: 12,345 in / 678 out tokens, $0.12" or "Cost: unavailable"
```

Spawn with `detached: true`, `stdio: ["ignore", "pipe", "pipe"]`, env
`{ ...process.env, ...env, PI_CODING_AGENT_DIR: agentDir }`. Tee stdout and
stderr to `logPath` and `onOutput`. On timeout or abort:
`process.kill(-pid, "SIGTERM")`, wait `graceMs`, then `SIGKILL` if still
running. `sumSessionUsage` walks every `*.jsonl` under `sessionDir`, parses each
line, and adds `usage.input`, `usage.output`, and `usage.cost.total` from any
object that has a numeric `usage` block at top level or under `message`.

`test-support/fake-pi.mjs` is the `pi` stand-in for every later end-to-end test.
It reads `PATCHMILL_FAKE_PI_SCRIPT` (path to a JSON array), keeps an invocation
counter in `<script>.counter`, and runs the step for this invocation in the
current directory:

````ts
type FakePiStep = {
  writeFiles?: Record<string, string>; // relative to cwd
  commit?: string; // git add -A && git commit -m
  push?: boolean; // git push -u origin HEAD
  pullRequest?: {
    draft: boolean;
    body: string;
    state?: "open" | "merged" | "closed";
  }; // appended to PATCHMILL_FAKE_HOST_STATE (Task 14)
  stdout?: string; // printed before the result
  result?: unknown | null; // printed as a ```json block when not null
  sleepMs?: number;
  ignoreSigterm?: boolean;
  exitCode?: number;
};
````

It also writes `<session-dir>/fake.jsonl` with one line
`{"usage":{"input":100,"output":20,"cost":{"total":0.05}}}` so cost is
exercised.

- [ ] **Step 1: Write failing tests**

`pi-supervisor.test.ts` uses
`command: { command: process.execPath, argsPrefix: [fakePiPath] }`: `piArgs`
produces the exact argv above; a step with `stdout: "ok"` returns `exitCode 0`
and the log file contains `ok`; `timeoutMs: 300` with `sleepMs: 5000` returns
`timedOut: true` and the process is gone within `graceMs + 1s`;
`ignoreSigterm: true` still ends through `SIGKILL`; an aborted signal returns
`aborted: true`; `PI_CODING_AGENT_DIR` reaches the child (fake step `stdout` of
`$PI_CODING_AGENT_DIR` via a `printEnv` option).

`pi-cost.test.ts`: two lines summing to `inputTokens 300`, `outputTokens 60`,
`costUsd 0.15`; a malformed line makes the whole result `undefined`; missing
directory gives `undefined`; `costLine(undefined)` is `Cost: unavailable`.

- [ ] **Step 2: Run tests; expect failure**
- [ ] **Step 3: Implement the three files**
- [ ] **Step 4: Run tests; expect PASS**
- [ ] **Step 5: Commit**
      `feat(kernel): supervise one Pi process and sum its cost`

---

### Task 9: Git facts and worktrees

**Files:**

- Create: `src/kernel/git.ts`, `test-support/git-fixture.ts`
- Test: `src/kernel/git.test.ts`

**Interfaces:**

- Produces:

```ts
export type KernelGit = {
  fetch(): Promise<void>; // git fetch --prune origin
  remoteDefaultBranch(): Promise<string | undefined>; // from refs/remotes/origin/HEAD
  remoteBranches(issue: number): Promise<string[]>; // names under origin/ that satisfy isIssueBranch
  ensureWorktree(input: {
    path: string;
    branch: string;
    base: string;
    remoteExists: boolean;
  }): Promise<"created" | "existing">;
  hasUncommittedChanges(worktree: string): Promise<boolean>; // git status --porcelain
  unpushedCommits(
    worktree: string,
    branch: string,
  ): Promise<number | "no-remote-branch">;
};
export function createKernelGit(
  runner: CommandRunner,
  repoRoot: string,
): KernelGit;
// test-support/git-fixture.ts
export async function createGitFixture(): Promise<{
  dir: string;
  originPath: string;
  repoRoot: string;
  env: Record<string, string>;
}>;
```

`ensureWorktree`: run `git worktree prune`; if `path` is a registered worktree,
return `existing`; if `path` exists on disk but is not registered, remove it
when empty or fail with a message naming the path; then
`git worktree add --track -b <branch> <path> origin/<branch>` when
`remoteExists`, else `git worktree add <path> <branch>` when the local branch
exists, else `git worktree add -b <branch> <path> origin/<base>`. The fixture
creates a bare `origin.git` with one commit on `main`, clones it to `repoRoot`,
and returns `env` with `GIT_AUTHOR_NAME`, `GIT_AUTHOR_EMAIL`,
`GIT_COMMITTER_NAME`, `GIT_COMMITTER_EMAIL`, `GIT_CONFIG_GLOBAL=/dev/null`,
`GIT_CONFIG_NOSYSTEM=1`.

- [ ] **Step 1: Write failing tests (real git in a temp fixture)**

`remoteBranches(4)` after pushing `agent/issue-4-a` and `agent/issue-40-b`
returns only the first. `ensureWorktree` with no remote branch creates the
worktree on a new branch from `origin/main` and returns `created`; a second call
returns `existing`. With a remote branch it checks out that branch with upstream
set. After `rm -rf` of the worktree directory, `ensureWorktree` recreates it
(Review Focus 2). An empty directory left at `path` is replaced.
`hasUncommittedChanges` is true after writing a file. `unpushedCommits` is `1`
after a local commit and `0` after push; `"no-remote-branch"` when origin lacks
the branch.

- [ ] **Step 2: Run tests; expect failure**
- [ ] **Step 3: Implement**
- [ ] **Step 4: Run tests; expect PASS**
- [ ] **Step 5: Commit**
      `feat(kernel): read git facts and manage the issue worktree`

---

### Task 10: Facts and the phase table

**Files:**

- Create: `src/kernel/facts.ts`, `src/kernel/phase.ts`
- Test: `src/kernel/facts.test.ts`, `src/kernel/phase.test.ts`

**Interfaces:**

- Consumes: `KernelGit`, `Host`, names from Task 3.
- Produces:

```ts
// facts.ts
export type Facts = {
  branch: string;
  remoteBranchExists: boolean;
  worktree: string;
  baseBranch: string;
  specPath?: string;
  planPath?: string; // relative to the worktree
  expectedSpecPath: string;
  expectedPlanPath: string; // names for today when missing
  specApproved: boolean;
  pullRequest?: PullRequest;
};
export type FactsResult =
  | { kind: "facts"; facts: Facts }
  | { kind: "ambiguous-branches"; branches: string[] };
export async function collectFacts(
  deps: {
    git: KernelGit;
    host: Host;
    config: PatchmillConfig;
    repoRoot: string;
    now: () => Date;
  },
  issue: Issue,
): Promise<FactsResult>;

// phase.ts
export type Phase = "planning" | "implementation";
export type Derived =
  | { kind: "phase"; phase: Phase }
  | { kind: "stop"; label: "done" | "specReview" };
export function derivePhase(facts: Facts, gateRequired: boolean): Derived;
```

`collectFacts` fetches, resolves the base branch (`config.git.baseBranch` or
`remoteDefaultBranch()` or `host.repository().defaultBranch`), picks the branch
(one remote match; none means `branchName(issue.number, issue.title)`; several
means `ambiguous-branches`), ensures the worktree, lists `paths.specsDir` and
`paths.plansDir` in the worktree with `isSpecFile`/`isPlanFile`, reads
`specApproved` from the issue labels or the gate being off, and calls
`findPullRequestByHead(branch)`.

- [ ] **Step 1: Write failing tests**

`phase.test.ts` covers every row of the spec table in order: merged PR stops
with `done` even when spec and plan are missing; no spec gives `planning`; spec
without approval and gate on stops `specReview`; spec approved and no plan gives
`planning`; spec, plan, approval gives `implementation`; gate off and no
`spec-approved` label still gives `implementation` when plan exists.

`facts.test.ts` with the git fixture and a stub host: two remote issue branches
give `ambiguous-branches`; a spec file named `2026-10-15-issue-9-x-design.md`
sets `specPath` while `notes-issue-9.md` does not; `baseBranch` falls back to
the remote HEAD when config is `null`.

- [ ] **Step 2: Run tests; expect failure**
- [ ] **Step 3: Implement**
- [ ] **Step 4: Run tests; expect PASS**
- [ ] **Step 5: Commit**
      `feat(kernel): derive the phase from git and host facts`

---

### Task 11: The prompt envelope

**Files:**

- Create: `src/kernel/run-envelope.md`, `src/kernel/triage-envelope.md`,
  `src/kernel/envelope.ts`
- Test: `src/kernel/envelope.test.ts`

**Interfaces:**

- Produces:

```ts
export type RunEnvelopeInput = {
  repository: Repository;
  issue: Issue;
  phase: Phase;
  facts: Facts;
  skill: { name: string; path: string };
  gateRequired: boolean;
  timeoutMinutes: number;
  trusted: string[];
};
export function renderRunEnvelope(input: RunEnvelopeInput): string;
export type TriageEnvelopeInput = {
  repository: Repository;
  issue: Issue;
  skill: { name: string; path: string };
  labels: LabelsConfig;
  trusted: string[];
};
export function renderTriageEnvelope(input: TriageEnvelopeInput): string;
export function renderIssue(issue: Issue, trusted: string[]): string; // boundary block shared by both
export const UNTRUSTED_BEGIN = "<<<UNTRUSTED ISSUE CONTENT BEGIN>>>";
export const UNTRUSTED_END = "<<<UNTRUSTED ISSUE CONTENT END>>>";
```

Templates are read from the package root (`findPackageRoot` +
`src/kernel/<file>`) and use `{{name}}` placeholders only. `run-envelope.md`
holds, in order: the one-line role; the skill name and path; a facts list
(worktree, branch, base, spec path or expected path, plan path or expected path,
pull request URL and state or `none`, gate state, time limit); the result
contract with the two-field example; the untrusted boundary with `{{issue}}`;
the hard rules (commit and push before finishing; never push the base branch;
never force-push; never change labels or post issue comments; put questions in
the summary; end with the JSON block). `triage-envelope.md` holds the role,
skill, the four allowed labels, the triage result contract
(`{ "label": "...", "comment": "..." }`), the boundary, and a read-only rule.
Comments render as `### Comment by <author> (<trusted|untrusted>, <date>)`.

- [ ] **Step 1: Write failing tests**

`run-envelope.md` has fewer than 150 lines. Rendered output has no `{{` left.
The boundary markers wrap the issue body and every comment. A comment whose
author is in `trusted` is marked `trusted`; others `untrusted`. The issue body
containing `<<<UNTRUSTED ISSUE CONTENT END>>>` is rendered with that line
escaped (prefix with a backslash) so the boundary cannot be closed early. Facts
for a missing spec show `expected: docs/specs/2026-10-15-issue-9-x-design.md`.
The triage envelope lists the four label names from `LabelsConfig`.

- [ ] **Step 2: Run tests; expect failure**
- [ ] **Step 3: Write the two templates and `envelope.ts`**
- [ ] **Step 4: Run tests; expect PASS**
- [ ] **Step 5: Commit** `feat(kernel): render the run and triage envelopes`

---

### Task 12: Verification table

**Files:**

- Create: `src/kernel/verify.ts`
- Test: `src/kernel/verify.test.ts`

**Interfaces:**

- Produces:

```ts
export type OutcomeLabel = "done" | "needsInfo" | "specReview";
export type Outcome = {
  label: OutcomeLabel;
  advance: boolean;
  comment: string;
  warnings: string[];
};
export type VerifyInput = {
  issue: number;
  phase: Phase;
  result: ParsedResult;
  session: Pick<PiSession, "exitCode" | "timedOut" | "aborted">;
  facts: Facts;
  gateRequired: boolean;
  logPath: string;
  uncommitted: boolean;
  unpushed: number | "no-remote-branch";
};
export function closesIssue(body: string, issue: number): boolean; // /\b(close|closes|closed|fix|fixes|fixed|resolve|resolves|resolved)\s+(?:[\w.-]+\/[\w.-]+)?#N(?!\d)/i
export function verifyOutcome(input: VerifyInput): Outcome;
```

Rows, in order: no result (`ok: false`, timeout, or abort) gives `needsInfo`
with a comment naming the reason, exit code, and log path. `needs-input` and
`failed` give `needsInfo` with the summary. `done` in `planning` with
`remoteBranchExists && specPath`: `specReview` with `advance: false` when the
gate is on and `specApproved` is false, else `advance: true` with no label
change yet (`label: "done"` is not used here; use `advance: true` and label
`specReview` only when stopping). `done` in `implementation` with an open,
non-draft pull request on the branch whose body `closesIssue`: `done`. Any other
`done`: `needsInfo` with a comment that says the claim was not verified and
which fact failed. Warnings: `uncommitted` adds "uncommitted changes in the
worktree"; `unpushed` greater than 0 or `"no-remote-branch"` adds "unpushed
commits".

To keep `Outcome` honest when planning advances, the type is
`{ kind: "advance" } | { kind: "stop"; label: OutcomeLabel; comment: string; warnings: string[] }`.
Use that shape instead of the `advance` boolean.

- [ ] **Step 1: Write failing tests**

One test per row above. `closesIssue("Fixes #12", 12)` true;
`closesIssue("Fixes #123", 12)` false;
`closesIssue("resolves owner/repo#12", 12)` true; `closesIssue("see #12", 12)`
false. A draft PR with a closing body does not verify. An open PR whose body
closes another issue does not verify. A `done` result with exit code 1 still
goes through the table (exit code appears in the comment only when stopping).

- [ ] **Step 2: Run tests; expect failure**
- [ ] **Step 3: Implement**
- [ ] **Step 4: Run tests; expect PASS**
- [ ] **Step 5: Commit**
      `feat(kernel): verify the agent's outcome against the world`

---

### Task 13: Label catalog and `labels setup`

**Files:**

- Create: `src/kernel/labels.ts`, `src/cli/commands/labels/main.ts`
- Modify: `src/cli/main.ts`
- Test: `src/kernel/labels.test.ts`, `src/cli/commands/labels/main.test.ts`

**Interfaces:**

- Produces:

```ts
export function labelCatalog(labels: LabelsConfig): LabelDefinition[]; // all eight, colours and descriptions from git show main:src/policy/label-catalog.ts where present, else "ededed"
export async function ensureLabels(
  host: Host,
  labels: LabelsConfig,
): Promise<string[]>; // returns created names
export function claimSwap(labels: LabelsConfig): {
  add: string[];
  remove: string[];
}; // add inProgress; remove ready, specReview, needsInfo
export function releaseSwap(
  labels: LabelsConfig,
  outcome: OutcomeLabel,
): { add: string[]; remove: string[] }; // add labels[outcome]; remove inProgress
// labels/main.ts: `patchmill labels setup` prints one line per created label, "all labels present" otherwise.
```

- [ ] **Step 1: Write failing tests**

`ensureLabels` with a stub host that lists three labels creates the other five
and returns their names. `claimSwap` and `releaseSwap` return the exact lists.
`labels setup` exit code 0; `labels` without a subcommand prints help and
returns 1.

- [ ] **Step 2: Run tests; expect failure**
- [ ] **Step 3: Implement and register `labels`**
- [ ] **Step 4: Run tests; expect PASS**
- [ ] **Step 5: Commit** `feat(labels): add the label catalog and labels setup`

---

### Task 14: `runOneIssue`, `run-once`, and `release`

**Files:**

- Create: `src/kernel/run-once.ts`, `src/cli/commands/run-once/main.ts`,
  `src/cli/commands/release/main.ts`, `test-support/fake-host.ts`
- Modify: `src/cli/main.ts`, `test-support/fake-pi.mjs` (pull request step
  writes to the host state file)
- Test: `src/kernel/run-once.test.ts`, `src/cli/commands/run-once/main.test.ts`,
  `src/cli/commands/release/main.test.ts`, `src/kernel/run-fixtures.test.ts`
- If needed, split kernel failure cases into
  `src/kernel/run-once-failures.test.ts` and shared setup into
  `test-support/run-once-fixture.ts` to keep test files focused.

Implement this task in four serial stages with one writer per checkout:

1. Add the fake host and fake Pi pull request step. Prove their shared file
   behavior with focused tests and commit the fixture stage.
2. Add the kernel run loop and end-to-end tests. Commit after its focused
   behavior and type checks pass.
3. Add the release command and its real issue-lock tests. Commit after its
   focused checks pass.
4. Add the run-once CLI and register both commands. Run the full test suite,
   lint, and build. Review the combined Task 14 diff independently.

**Interfaces:**

- Consumes: everything from Tasks 2 to 13.
- Produces:

```ts
// run-once.ts
export type RunOnceOptions = {
  issue?: number;
  dryRun?: boolean;
  planOnly?: boolean;
  signal?: AbortSignal;
};
export type RunOnceDeps = {
  host: Host;
  runner: CommandRunner;
  git: KernelGit;
  piCommand: PiCommandSpec;
  extensionPaths: string[];
  repoRoot: string;
  now: () => Date;
  output: { stdout: (line: string) => void; stderr: (line: string) => void };
};
export type RunOnceOutcome =
  | { status: "no-work" }
  | {
      status: "dry-run";
      issue: number;
      derived: Derived | "ambiguous-branches";
    }
  | { status: "claimed-elsewhere"; issue: number }
  | { status: "refused"; issue: number; reason: string }
  | { status: "stopped"; issue: number; label: OutcomeLabel; summary: string }
  | { status: "completed"; issue: number }; // agent-done
export async function runOneIssue(
  config: PatchmillConfig,
  deps: RunOnceDeps,
  options: RunOnceOptions,
): Promise<RunOnceOutcome>;
export function selectIssue(
  issues: Issue[],
  labels: LabelsConfig,
  explicit?: number,
): Issue | undefined; // explicit: must be open and not inProgress; else oldest by createdAt with ready and not inProgress

// test-support/fake-host.ts
export type FakeHostState = {
  repository: Repository;
  issues: Issue[];
  labels: string[];
  pullRequests: PullRequest[];
  calls: string[];
};
export class FakeHost implements Host {
  constructor(stateFile: string);
  state(): FakeHostState;
}
export function writeFakeHostState(
  stateFile: string,
  state: Partial<FakeHostState>,
): void;
```

Flow of `runOneIssue`:

1. `selectIssue` over `host.listOpenIssues()`; none gives `no-work`. An explicit
   issue that is closed or `inProgress` gives `refused` (Review Focus 5).
2. `dryRun`: `collectFacts`, `derivePhase`, print, return `dry-run`. No lock, no
   labels.
3. `acquireLock(<runsDir>/issue-N/lock)`; `LockHeldError` gives `refused` with
   "another Run attempt is active".
4. `setLabels(claimSwap)`; `viewIssue` once; if `inProgress` is missing or the
   issue is closed give `claimed-elsewhere`, release the lock, change nothing
   else (Review Focus 4).
5. Create the run directory. Loop at most three sessions: `collectFacts`
   (ambiguous branches stop with `needsInfo`), `derivePhase`. On the first
   decision only, an issue that carried `ready` before claim can revise an
   existing spec that lacks required approval. Run one `planning` session in
   place of the `specReview` stop. Keep the facts and approval unchanged. A
   verified revision stops at `specReview` without entering implementation.
   Other results follow normal verification. A merged PR still stops at `done`.
   All other derived stops end the loop. Otherwise write `prompt.md`,
   `supervisePi` with the phase skill, `parseAgentResult`, `collectFacts` again,
   `hasUncommittedChanges`, `unpushedCommits`, `verifyOutcome`. `advance`
   continues unless `planOnly` and the phase was `planning` (then stop with
   `specReview` when the gate is on, else `needsInfo` with summary "planning
   complete"). If the re-derived phase equals the phase just run, stop with
   `needsInfo` and a comment naming the expected artifact path.
6. `finally`: `setLabels(releaseSwap(outcome))`, one `commentIssue` with the
   outcome line, summary, `costLine`, warnings; write `result.json`
   (`{ runId, issue, startedAt, finishedAt, outcome, sessions: [{ phase, exitCode, timedOut, status }] }`);
   release the lock. A thrown error maps to `needsInfo` with the error message.
   Console: the final JSON block, one outcome line, the cost line.

`run-once/main.ts` parses `--issue N`, `--dry-run`, `--plan-only`, loads config,
builds deps (`createHost`, `runCommand`, `createKernelGit`,
`resolveBundledPiCommand()`,
`extensionPaths: [resolvePiSubagentsPackageRoot()]`), installs
`SIGINT`/`SIGTERM` handlers that abort the signal, and maps outcomes to exit
codes: `completed`, `stopped`, `dry-run`, `no-work` give 0; `refused` and
`claimed-elsewhere` give 1.

`release/main.ts`: `--issue N` required. Acquire the same issue lock before
reading or changing the issue's labels. On `LockHeldError`, print "Run attempt
is active" and return 1, even if owner metadata is unavailable. While holding
the lock, when the issue carries `inProgress`, call
`setLabels([ready], [inProgress])`; print what changed. Always release in
`finally`. Do not use `readLock` or PID liveness to authorize mutations. Never
remove the permanent lock file or its containing directory.

The fake Pi `pullRequest` step reads `PATCHMILL_FAKE_HOST_STATE`, appends or
updates a `PullRequest` with `headBranch` = current branch
(`git rev-parse --abbrev-ref HEAD`), and writes the file back. `FakeHost` reads
the file on every call and writes after mutations.

- [ ] **Step 1: Write failing end-to-end tests in `run-once.test.ts`**

Each test builds a git fixture, a `FakeHost` state file with issue 9 titled
`Add login`, a fake Pi script, and a config with `pi.timeoutMinutes` small.
Assert on `host.state()` labels, comments, pull requests, and on files in the
worktree and `origin`.

1. Fresh issue to spec stop: fake Pi writes
   `docs/specs/2026-10-15-issue-9-add-login-design.md`, commits, pushes, opens a
   draft PR, returns `done`. Expect labels `spec-review` only (no `in-progress`,
   no `agent-ready`), one comment containing the summary and `Cost:`, lock
   released with its permanent file retained, `result.json` present.
2. Approved spec to ready PR: start with the spec on
   `origin/agent/issue-9-add-login`, `spec-approved` on the issue; session 1
   writes the plan and returns `done`; session 2 commits code, pushes, marks the
   PR ready with body `Closes #9`, returns `done`. Expect `agent-done`, outcome
   `completed`, exactly one comment.
3. Revise after review: spec exists, gate on, no `spec-approved`, issue labelled
   `agent-ready` again. Expect phase `planning` in the envelope (`prompt.md`
   contains the existing spec path and `spec-review` state), and after a `done`
   result the issue stops at `spec-review` again.
4. Unverified `done`: implementation session returns `done` with a draft PR.
   Expect `needs-info` and a comment containing `not verified`.
5. Timeout: `sleepMs: 60000`, `timeoutMinutes: 0.01`. Expect `needs-info`,
   comment names the log path, process gone.
6. Invalid result: fake Pi prints prose only. Expect `needs-info` with
   `no result`.
7. Diagnostic JSON with pid 999999 or the current PID does not block an unlocked
   file. Expect the run proceeds. A real held OS lock gives `refused`, including
   when its diagnostic JSON is empty.
8. Merged PR: state has a merged PR on the branch. Expect `agent-done`, no Pi
   invocation (counter file absent).
9. Several branches: push `agent/issue-9-a` and `agent/issue-9-b`. Expect
   `needs-info` naming both.
10. Claimed elsewhere: a `FakeHost` whose `setLabels` leaves `in-progress`
    absent. Expect `claimed-elsewhere`, no comment, lock released.
11. `--plan-only` with gate off: after planning `done`, no second session; label
    `needs-info` with "planning complete".
12. Phase does not advance: planning returns `done` with the spec pushed under
    the wrong name `spec.md`. Expect `needs-info` and the expected path in the
    comment.
13. Warnings: implementation verified but a file left uncommitted; expect
    `agent-done` and the comment contains `uncommitted`.

- [ ] **Step 2: Run tests; expect failure**
- [ ] **Step 3: Implement `fake-host.ts`, the fake Pi PR step, `run-once.ts`**
- [ ] **Step 4: Run `run-once.test.ts`; expect PASS**
- [ ] **Step 5: Write failing CLI tests**

`run-once/main.test.ts`: `--issue x` returns 1 with a message; `--dry-run` with
an injected `runOneIssue` stub prints the derived phase; outcome to exit code
mapping. `release/main.test.ts`: held OS lock returns 1 without label mutation,
including when owner metadata is missing; unlocked stale diagnostics with
`in-progress` swap to `agent-ready`; no label prints "nothing to release". Prove
a competing run cannot acquire during the label reset. Prove successful and
failing host operations release the handle without removing the lock file.

- [ ] **Step 6: Implement the two CLI files; register `run-once` and `release`;
      run `npm test`; expect PASS**
- [ ] **Step 7: Commit**
      `feat(run-once): add the kernel run loop, run-once, and release commands`

---

### Task 15: Triage

**Files:**

- Create: `src/kernel/triage.ts`, `src/cli/commands/triage/main.ts`
- Modify: `src/cli/main.ts`, `skills/patchmill-issue-triage/SKILL.md` (result
  contract section only)
- Test: `src/kernel/triage.test.ts`, `src/cli/commands/triage/main.test.ts`

**Interfaces:**

- Produces:

```ts
export type TriageResult = { label: string; comment: string }; // label must be one of labels.ready, unsuitable, blocked, needsInfo
export type TriageDeps = Pick<
  RunOnceDeps,
  "host" | "piCommand" | "repoRoot" | "now" | "output"
>;
export type TriageOptions = {
  issue?: number;
  dryRun?: boolean;
  signal?: AbortSignal;
};
export function selectTriageCandidates(
  issues: Issue[],
  labels: LabelsConfig,
  trusted: string[],
): Issue[];
export async function runTriage(
  config: PatchmillConfig,
  deps: TriageDeps,
  options: TriageOptions,
): Promise<Array<{ issue: number; label: string; applied: boolean }>>;
```

Candidates: open issues carrying none of the eight configured labels, plus
issues carrying `needsInfo` whose latest comment author is trusted. `--issue N`
triages that issue regardless. Per candidate: `viewIssue`, render the triage
envelope, `supervisePi` in `repoRoot` with the triage skill, session dir
`<runsDir>/triage/<run-id>/`, `parseJsonBlock` with the `TriageResult`
validator. Apply: `setLabels(n, [label], otherThreeTriageLabels ∪ [needsInfo])`
and `commentIssue` when `comment` is non-empty. Dry run prints label and
comment, applies nothing. A missing or invalid block skips the issue with a
console warning.

- [ ] **Step 1: Write failing tests**

`selectTriageCandidates`: unlabeled issue included; `agent-ready` excluded;
`needs-info` with last comment by a trusted author included, by an untrusted
author excluded. `runTriage` end to end with `FakeHost` and fake Pi returning
`{ "label": "agent-ready", "comment": "Looks clear." }`: label added, comment
posted; `dryRun` leaves state untouched and prints both; a result with
`label: "wontfix"` is skipped with a warning.

- [ ] **Step 2: Run tests; expect failure**
- [ ] **Step 3: Implement; register `triage`; update the triage skill's result
      section to the `{ label, comment }` contract**
- [ ] **Step 4: Run `npm test`; expect PASS**
- [ ] **Step 5: Commit**
      `feat(triage): run the triage skill per candidate issue`

---

### Task 16: Skills

**Files:**

- Create: `skills/patchmill-implementation/SKILL.md`
- Modify: `skills/patchmill-planning/SKILL.md`,
  `skills/patchmill-issue-triage/SKILL.md`, `skills/patchmill-plan/SKILL.md`,
  `skills/patchmill-cleanup/SKILL.md`, `skills/patchmill-label/SKILL.md`,
  `skills/patchmill-visual-evidence/SKILL.md`, `THIRD_PARTY_NOTICES.md`,
  `bin/package-files.test.ts`
- Delete: `skills/inline-dev-with-validation-and-pr-checks/`,
  `skills/patchmill-upload/`

No new automated tests (Testing Value Gate: prose). Verification is
markdownlint, the line budget, and the package-files test.

Content each skill must carry:

- `patchmill-planning`: read review comments on the issue and on the draft pull
  request when the envelope names one; write the spec at the expected path from
  the envelope (brainstorming and writing style via the sibling `brainstorming`
  and `simple-english` skills); commit and push; open a draft pull request with
  `gh pr create --draft` or `tea pulls create` whose body says `Closes #N`; when
  the gate is on, end with `done` and a summary pointing to the spec and pull
  request; when the gate is off, continue to the plan at the expected plan path
  (via `writing-plans`), push, then end with `done`; when the envelope says the
  spec exists, write only the plan.
- `patchmill-implementation`: set up the development environment (read
  `AGENTS.md`, install, run the test suite once); execute the plan (sibling
  `executing-plans` or `subagent-driven-development` with the `reviewer` agent);
  validate with the project's own commands; commit and push; mark the pull
  request ready (`gh pr ready` or `tea pulls` equivalent) with a body that
  contains `Closes #N`; address review comments when the envelope names an open
  ready pull request; end with `done`. Visual evidence and module size are
  referenced as sibling advice.
- `patchmill-issue-triage`: result contract `{ "label", "comment" }`, the four
  labels, questions go in `comment`.
- `patchmill-plan`, `patchmill-cleanup`, `patchmill-label`: rewritten for one
  branch and worktree per issue; cleanup removes the worktree, the lock, and
  optionally the branch; label is unchanged in intent.

- [ ] **Step 1: Write and rewrite the skills**
- [ ] **Step 2: Verify**

Run: `npm run lint:md` (pass) and `find skills -type f | xargs wc -l | tail -1`
(under 1,500). Update `bin/package-files.test.ts` to assert
`skills/patchmill-implementation/SKILL.md` is packed and
`skills/inline-dev-with-validation-and-pr-checks/SKILL.md` and
`skills/patchmill-upload/SKILL.md` are not; update `THIRD_PARTY_NOTICES.md`
wrapper list; run `npm test` (pass).

- [ ] **Step 3: Commit**
      `feat(skills): rewrite the planning and implementation skills for the kernel`

---

### Task 17: `init`

**Files:**

- Create: `src/cli/commands/init/main.ts`,
  `src/cli/commands/init/skill-installer.ts`,
  `src/cli/commands/init/agent-dir.ts`
- Modify: `src/cli/main.ts`, `scripts/smoke-packed-artifact.mjs`
- Test: `src/cli/commands/init/skill-installer.test.ts`,
  `src/cli/commands/init/agent-dir.test.ts`,
  `src/cli/commands/init/main.test.ts`

**Interfaces:**

- Produces:

```ts
// skill-installer.ts
export const PATCHMILL_SKILLS = [
  "patchmill-issue-triage",
  "patchmill-planning",
  "patchmill-implementation",
  "patchmill-visual-evidence",
  "module-size",
  "patchmill-cleanup",
  "patchmill-label",
  "patchmill-plan",
];
export const SUPERPOWERS_SKILLS = [
  "brainstorming",
  "writing-plans",
  "executing-plans",
  "subagent-driven-development",
  "dispatching-parallel-agents",
  "test-driven-development",
  "systematic-debugging",
  "verification-before-completion",
  "requesting-code-review",
  "receiving-code-review",
  "using-git-worktrees",
  "finishing-a-development-branch",
  "using-superpowers",
];
export const SIMPLE_ENGLISH_SKILLS = ["simple-english"];
export type SkillPackManifest = {
  installedAt: string;
  sources: { patchmill: string; superpowers: string; simpleEnglish: string };
  files: Array<{ path: string; sha256: string }>;
}; // versions from the three package.json files
export async function installSkills(options: {
  repoRoot: string;
  skillDir: string;
  packageRoot: string;
}): Promise<{ written: number; unchanged: number }>; // copies directories, overwrites, writes patchmill-skill-pack.json
// agent-dir.ts
export const REVIEWER_AGENT: string; // markdown with frontmatter name: reviewer, description, tools: read, grep, find, ls, bash; body: fresh-context adversarial review instructions
export async function provisionAgentDir(
  repoRoot: string,
  agentDir: string,
): Promise<void>; // mkdir agents/, write reviewer.md when content differs
export async function ensureLocalExcludes(
  repoRoot: string,
  patterns: string[],
): Promise<string[]>; // append missing lines to .git/info/exclude
// main.ts: `patchmill init [--provider github-gh|forgejo-tea] [--login NAME]`
```

`init` order: load config if present (invalid fails); else write
`DEFAULT_CONFIG` with `host.provider` from the flag. An explicit `--login` sets
`host.login`. Without that flag, `github-gh` uses `checkCli().login` when
available, else `""`. For `forgejo-tea`, keep the default `""` unless `--login`
names a Tea login alias. The authenticated username returned by `checkCli()` is
not a Tea login alias. A host CLI failure prints a warning and never fails
`init`. Then call `installSkills`; `provisionAgentDir`; `ensureLocalExcludes`
with `.worktrees/`, `.patchmill/pi-agent/`, `.patchmill/runs/`. Print one line
per step. Idempotent: a second run reports `unchanged` for every file and
exit 0.

Copy every file and subdirectory within each selected skill directory, including
sibling prompt templates. Keep both `using-git-worktrees` and
`finishing-a-development-branch` in the installed Superpowers list. The packed
smoke fixture must be a git repository before it calls `init`.

- [ ] **Step 1: Write failing tests**

Installer: installs the three lists into a temp dir, manifest lists every file
with a sha256 that matches the file, a modified installed file is restored on
rerun, rerun reports `written: 0`. Agent dir: `agents/reviewer.md` written;
rerun does not rewrite (mtime unchanged). Excludes: appends only missing
patterns. `main.test.ts` with a stub host: `github-gh` writes config with
`login` from `checkCli`; `forgejo-tea` keeps the empty default when no login
flag is given; an explicit `--login` wins for either provider. Existing valid
config is untouched byte for byte; invalid config returns 1 naming the key; host
CLI failure still exits 0 with a warning.

- [ ] **Step 2: Run tests; expect failure**
- [ ] **Step 3: Implement; register `init`**
- [ ] **Step 4: Run `npm test`; expect PASS. Run
      `node scripts/smoke-packed-artifact.mjs`; expect PASS.**
- [ ] **Step 5: Commit**
      `feat(init): provision config, skills, and the Pi agent directory`

---

### Task 18: `auth` and `doctor`

**Files:**

- Create: `src/cli/commands/auth/main.ts`, `src/cli/commands/doctor/main.ts`,
  `src/cli/commands/doctor/checks.ts`
- Modify: `src/cli/main.ts`
- Test: `src/cli/commands/auth/main.test.ts`,
  `src/cli/commands/doctor/checks.test.ts`

**Interfaces:**

- Produces:

```ts
// auth/main.ts
export function authSpawnPlan(
  repoRoot: string,
  config: PatchmillConfig,
  pi: PiCommandSpec,
): { command: string; args: string[]; env: Record<string, string | undefined> }; // interactive pi, no -p, PI_CODING_AGENT_DIR set
// doctor/checks.ts
export type DoctorCheck = {
  name: string;
  status: "pass" | "warn" | "fail";
  message: string;
};
export async function runDoctorChecks(deps: {
  repoRoot: string;
  config: PatchmillConfig;
  host: Host;
  runner: CommandRunner;
  piCommand: PiCommandSpec;
  packageRoot: string;
}): Promise<DoctorCheck[]>;
```

Checks, in order: host CLI (`checkCli`), labels (list missing names, fail),
excludes (`git check-ignore -q` for worktreeDir, runsDir, agentDir; warn),
skills (each configured skill path has `SKILL.md`; fail), reviewer agent file
present (warn), pi-subagents resolves (`resolvePiSubagentsPackageRoot`; fail),
Pi smoke (`supervisePi` with a prompt file containing `Reply with exactly OK`,
120 s timeout, pass when stdout contains `OK`; fail otherwise with the log
path), trusted authors non-empty (warn). `doctor` prints
`[pass|warn|fail] name: message` per check and returns 1 when any check fails.

- [ ] **Step 1: Write failing tests**

`authSpawnPlan` args contain no `-p` and env has `PI_CODING_AGENT_DIR` ending in
`.patchmill/pi-agent`. `runDoctorChecks` with stubs: missing label gives a
`fail` naming it; missing `SKILL.md` gives `fail`; smoke stdout `OK` gives
`pass`; `trustedAuthors` empty gives `warn`.

- [ ] **Step 2: Run tests; expect failure**
- [ ] **Step 3: Implement; register `auth` and `doctor`**
- [ ] **Step 4: Run `npm test`; expect PASS**
- [ ] **Step 5: Commit** `feat(cli): add auth and doctor for the kernel`

---

### Task 19: Packaging, repository self-setup, docs, and glossary

**Files:**

- Modify: `patchmill.config.json`, `.patchmill/skills/` (reinstalled),
  `README.md`, `CONTEXT.md`, `docs/quality-checks.md`,
  `docs/agents/triage-labels.md`, `site/src/content/docs/**`,
  `.github/workflows/*.yml`, `scripts/*` (references to removed commands),
  `docs/specs/2026-10-13-issue-320-e2e-ci-design.md` (command lines only)
- Delete: `site/src/content/docs/reference/task-contracts.md`,
  `site/src/content/docs/using-patchmill/workflow-artifacts.md`

No new tests (docs and config). Verification is the command list in Step 4.

- [ ] **Step 1: Re-initialise this repository**

Run `git rm -r .patchmill/skills`, delete `patchmill.config.json`, then
`node bin/patchmill.ts init --provider github-gh`. Commit the new config and
installed skills.

- [ ] **Step 2: Update references to removed commands and files**

`grep -rnE 'set-spec|set-plan|patchmill skills|patchmill run |run reset|lease|todo|extensions/todos|planning pull request|plan-approved|plan-review' README.md docs site/src/content/docs .github scripts`
and fix every hit. In `docs/specs/2026-10-13-issue-320-e2e-ci-design.md` replace
the `init --yes --skills project` line with `init --provider github-gh` and drop
the plan-approval step; leave the rest.

- [ ] **Step 3: Rewrite the docs**

README: what Patchmill is, the five kernel responsibilities in one paragraph
each, the command table from the spec, the config block from the spec, the label
lifecycle table, and a "Branch protection" note that direct landing is a host
control. Site pages: `run-once.md`, `triage.md`, `workflow-labels.md`,
`configuration.md`, `configuration-example.md`, `environment-and-config.md`,
`agent-workflow-lifecycle.md`, `skills-configuration.md`,
`interactive-skills.md`, `git-safety.md` rewritten to the spec; delete the two
listed pages and remove them from the site navigation. `docs/quality-checks.md`:
list only the kept gates. `CONTEXT.md`: replace the entries for Planning review
gate, Planning pull request, Phase workspace, and Run recovery state with **Spec
gate** (the `spec-approved` label; _Avoid_: planning review gate, plan
approval), **Issue branch** (one branch and worktree per issue; _Avoid_: phase
workspace), and remove Run recovery state; keep the other terms.

- [ ] **Step 4: Verify**

Run, all expected to pass: `npm test`, `npm run lint`, `npm run build`,
`node scripts/smoke-packed-artifact.mjs`, `npm --prefix site run build`,
`nix build .#default`,
`find src bin -name '*.ts' ! -name '*.test.ts' | xargs cat | wc -l` at most
4,300, `wc -l src/kernel/run-envelope.md` under 150,
`wc -l src/config/config.ts` under 200. Then run the acceptance walk by hand
once against a disposable repository: `setup-test-repo`, `init`, `labels setup`,
`triage`, `run-once` to `spec-review`, add `spec-approved` and `agent-ready`,
`run-once` to `agent-done`; record the commands and the resulting pull request
URL in the pull request description for this change.

- [ ] **Step 5: Commit**
      `docs: describe the skills-first kernel and retire the old workflow terms`

---

## Self-review notes

- Spec coverage: supervision (Task 8), claim and release (Tasks 7, 13, 14),
  derived phase (Tasks 9, 10), verification (Task 12), names (Task 3), labels
  lifecycle (Tasks 13, 14), envelope (Task 11), result contract (Task 4), skills
  (Task 16), commands (Tasks 6, 13, 14, 15, 17, 18), config (Task 2), host
  adapters (Tasks 5, 6), deletions and quality gates (Task 1), no upgrade path
  (Tasks 2, 10 by construction), tests (Tasks 8, 9, 14), glossary and docs (Task
  19), acceptance walk (Task 19 Step 4).
- Decisions the spec left open, fixed here: `SIGKILL` grace 5 s;
  `timeoutMinutes` default 90; `result.json` shape in Task 14; copy-and-hash
  installer with versions from the three `package.json` files; the old tree is
  deleted in one commit (Task 1); `pi-subagents` is loaded with `-e` rather than
  copied into the agent directory, and `init` provisions the reviewer agent
  file; `checkCli` returns the CLI's login so `init` can seed `host.login`; the
  triage envelope is a separate short template because its contract differs from
  the run contract.
