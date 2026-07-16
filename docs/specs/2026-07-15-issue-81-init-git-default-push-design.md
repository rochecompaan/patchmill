# Issue 81 Init Git Default and Setup Push Design

## Goal

Make the recommended shared-config path the default `patchmill init` git policy
while preventing the first `patchmill run-once` from surprising new users with
the existing `git.baseRef HEAD is not contained in refs/remotes/origin/main`
safety error.

## Background

Issue #81 asks Patchmill to default git handling to
`1) Add config and skills to git (recommended for shared config)` and to smooth
the first-run path after Patchmill creates the `chore: initialize Patchmill`
setup commit.

The failure mode comes from two existing behaviors:

- `src/cli/commands/init/git-policy.ts` can create a local setup commit when the
  `add` policy is selected.
- `src/cli/commands/run-once/git.ts` correctly blocks when configured
  `git.baseRef` (`HEAD` by default) contains commits not present in
  `refs/remotes/<git.remote>/<git.baseBranch>` (`refs/remotes/origin/main` by
  default), because those commits would leak into every issue PR.

If a new user accepts the recommended tracked-config policy and immediately runs
`patchmill run-once` before pushing the setup commit, the safety check is
correct but the onboarding experience is poor.

## Current behavior

- Interactive `selectInitGitPolicy()` displays:

  ```text
  1) Add config and skills to git
  2) Add Patchmill files to .gitignore
  3) Add Patchmill files to .git/info/exclude (local only)
  Choose 1, 2, or 3 [3]:
  ```

- Blank, unrecognized, non-interactive, and `--yes` policy selection currently
  resolve to `exclude`.
- `applyInitGitPolicy({ policy: "add" })` appends local runtime entries to
  `.gitignore`, force-stages existing config/skill paths, and creates
  `chore: initialize Patchmill` on success.
- `applyInitGitPolicy()` only returns `{ policy, message }`, so `runInit()` does
  not know whether a setup commit was actually created.
- `runInit()` prints the git policy message but never checks whether the setup
  commit is unpushed and never offers to push it.
- `run-once` later reports the actionable but late safety error from issue #40.

## Desired behavior

### Default tracked-config policy

`patchmill init` should present option 1 as the recommended default:

```text
How should Patchmill files be handled by git?
  1) Add config and skills to git (recommended for shared config)
  2) Add Patchmill files to .gitignore
  3) Add Patchmill files to .git/info/exclude (local only)
Choose 1, 2, or 3 [1]:
```

Selection rules:

- `1`, `a`, `add`, `git`, `add to git`, blank input, unrecognized input,
  non-interactive mode, and `--yes` select `add`.
- Existing explicit option 2 aliases still select `ignore`.
- Existing explicit option 3 aliases still select `exclude`.

This treats `--yes` as accepting Patchmill's new default. It does not imply
network mutation; pushing still requires an interactive prompt.

### Setup commit metadata

When the `add` policy runs, the policy result should expose whether the
Patchmill setup commit was created:

```ts
export type InitSetupCommitStatus =
  | "committed"
  | "nothing"
  | "missing"
  | "stage-warning"
  | "commit-warning";

export type InitGitPolicyResult = {
  policy: InitGitPolicy;
  message: string;
  setupCommit?: {
    status: InitSetupCommitStatus;
    paths: string[];
  };
};
```

Only a successful `setupCommit.status === "committed"` should trigger setup-push
handling. Failed, missing, or no-op commit outcomes should keep the existing
non-fatal init behavior and should not prompt for a push.

### Safe push offer

After a successful `add` setup commit, interactive init should inspect whether
Patchmill can safely offer to push that commit.

The offer is safe only when all of these are true:

1. The current branch is not detached.
2. The current branch tracks exactly `<git.remote>/<git.baseBranch>`.
3. `refs/remotes/<git.remote>/<git.baseBranch>` resolves locally.
4. `refs/remotes/<git.remote>/<git.baseBranch>` is an ancestor of `HEAD`.
5. The unpushed commit set from
   `refs/remotes/<git.remote>/<git.baseBranch>..HEAD` contains exactly one
   commit.
6. That single unpushed commit has subject `chore: initialize Patchmill`.

When safe and interactive, init should ask:

```text
Patchmill committed config and skills locally. patchmill run-once needs this setup commit on origin/main before creating issue branches.
Push it now? [Y/n]
```

- Blank, `y`, and `yes` run `git push <remote> HEAD:<baseBranch>`.
- `n` and `no` skip the push and print next-step guidance.
- `--yes` must not auto-push; it should print guidance instead because pushing
  is a network mutation.

### Guidance when Patchmill does not push

If Patchmill declines, cannot safely offer, is non-interactive, or the push
fails, init should include clear guidance in the final output. For the default
config, the guidance should include:

```bash
git push origin HEAD:main
```

The message should explain why:

```text
Patchmill created a setup commit that must be pushed or merged into origin/main before patchmill run-once can create issue PRs.
```

When Patchmill intentionally does not offer the prompt because safety checks
fail, the message should include a concise reason, for example:

- `current branch does not track origin/main`
- `HEAD has unpushed commits in addition to chore: initialize Patchmill`
- `refs/remotes/origin/main is missing; run git fetch or push the setup commit before run-once`

The command may still be shown as a suggested command, but wording must avoid
implying Patchmill proved it is safe when it did not.

### Scope boundaries

- Do not weaken the `run-once` base containment guard. It remains the final
  safety net.
- Do not run `git fetch` during init.
- Do not push automatically in non-interactive or `--yes` mode.
- Do not push when the unpushed set contains user commits or more than the
  Patchmill setup commit.
- Do not add new config fields for this feature.
- Do not change the behavior of explicit option 2 (`ignore`) or option 3
  (`exclude`) beyond the prompt default change.

## Proposed design

### Approach options considered

1. **Recommended: default to add, then offer an explicitly confirmed safe
   push.** This fixes the recommended-path first-run UX while keeping network
   mutation under user control.
2. **Auto-push after init without asking.** This is smoother but too surprising
   and risky for a setup command, especially in repositories with protected
   branches or unusual remotes.
3. **Do not push; only improve the `run-once` error.** This preserves safety but
   still lets the first `run-once` fail after successful init, which is exactly
   the issue #81 onboarding problem.

Implement option 1.

### Module boundaries

`src/cli/commands/init/git-policy.ts` is already about 323 lines and owns prompt
selection plus ignore/exclude/commit policy application. Pushing has a different
responsibility: checking remote-tracking state, prompting for a network
mutation, running `git push`, and formatting first-run guidance.

Add a focused module:

```text
src/cli/commands/init/git-setup-push.ts
```

Responsibility: decide whether a successful Patchmill setup commit can be safely
pushed, optionally prompt the user, perform the push when confirmed, and return
a message fragment for init output.

Keep `main.ts` as the orchestrator:

1. write initial config;
2. select and apply git policy;
3. if `setupCommit.status === "committed"`, call the setup-push helper;
4. print the policy message plus any setup-push message;
5. continue label setup and Pi setup as before.

### Setup push API

The helper should expose a narrow public API similar to:

```ts
export type InitSetupPushOptions = {
  repoRoot: string;
  runner: CommandRunner;
  remote: string;
  baseBranch: string;
  isInteractive: boolean;
  assumeYes: boolean;
  prompt?: InitGitPolicyPrompt;
};

export type InitSetupPushResult = {
  message?: string;
};

export async function maybeOfferInitSetupPush(
  options: InitSetupPushOptions,
): Promise<InitSetupPushResult>;
```

The result is intentionally message-oriented because init only needs to append
operator guidance to existing output. Internal helpers can use richer types for
safety decisions and test assertions.

### Safety inspection commands

Use the injected `CommandRunner` for all git commands. A safe inspection path
should run commands equivalent to:

```bash
git rev-parse --abbrev-ref HEAD
git rev-parse --abbrev-ref --symbolic-full-name @{u}
git rev-parse --verify refs/remotes/origin/main^{commit}
git merge-base --is-ancestor refs/remotes/origin/main HEAD
git log --format=%H%x00%s refs/remotes/origin/main..HEAD
```

The `%H%x00%s` format gives deterministic parsing of the exact unpushed commit
count and subject. If any inspection command fails, return guidance instead of
throwing. Init should continue unless the later `git push` command itself
returns a warning message.

### Push command

When the user accepts the safe prompt, run:

```bash
git push origin HEAD:main
```

with configured `remote` and `baseBranch` substituted. On success, append a
confirmation such as:

```text
Pushed Patchmill setup commit to origin/main. patchmill run-once can now create issue branches from the configured base.
```

On failure, append a warning with git stderr/stdout and the same manual push
guidance.

### Init output placement

Append the setup-push message immediately after `gitPolicyResult.message`,
before skill, label, and Pi setup sections. This keeps all git guidance together
while preserving existing init flow ordering.

## Affected components

- `src/cli/commands/init/git-policy.ts`
  - Update prompt text and default selection.
  - Export setup commit status metadata through `InitGitPolicyResult` for the
    `add` policy.
- `src/cli/commands/init/git-policy.test.ts`
  - Update selection tests for the new default and prompt text.
  - Assert `setupCommit.status === "committed"` for successful add commits.
  - Assert warning/no-op statuses are exposed and still non-fatal.
- `src/cli/commands/init/git-setup-push.ts` (new)
  - Implement safety inspection, prompt handling, push execution, and guidance
    formatting.
- `src/cli/commands/init/git-setup-push.test.ts` (new)
  - Cover safe accepted push, safe declined push, non-interactive guidance,
    upstream mismatch, missing remote ref, multiple unpushed commits, push
    failure, and detached branch.
- `src/cli/commands/init/main.ts`
  - Import the helper and call it only after a successful `add` setup commit.
  - Use default git remote/base branch from `DEFAULT_PATCHMILL_CONFIG.git`
    because initial config currently omits explicit `git` fields.
- `src/cli/commands/init/main-git-policy.test.ts`
  - Update helper prompt sequencing for multiple prompts.
  - Cover default interactive add, push accepted, push declined/guidance, and
    `--yes` guidance without auto-push.

## Verification strategy

Automated tests should prove behavior rather than restate configuration:

- `selectInitGitPolicy` defaults blank, non-interactive, and `--yes` selection
  to `add`.
- The prompt displays option 1 with `(recommended for shared config)` and `[1]`.
- Explicit option 2 and option 3 inputs still select `ignore` and `exclude`.
- A successful add policy exposes `setupCommit.status === "committed"`.
- Init does not offer a push for `ignore`, `exclude`, failed add commits, or
  no-op add commits.
- Init offers a push only when the safety inspection proves a single unpushed
  `chore: initialize Patchmill` commit on a branch tracking the configured
  target.
- Accepting the safe prompt runs `git push <remote> HEAD:<baseBranch>` and
  prints success.
- Declining, non-interactive mode, `--yes`, unsafe branch state, missing remote
  refs, multiple unpushed commits, or push failure print guidance that explains
  the setup commit must be pushed or merged before `patchmill run-once`.

Run targeted tests:

```bash
node --test \
  src/cli/commands/init/git-policy.test.ts \
  src/cli/commands/init/git-setup-push.test.ts \
  src/cli/commands/init/main-git-policy.test.ts
```

Run the full suite before merge:

```bash
npm test
```

No npm dependency changes are required for issue #81, so no Nix build is
required unless implementation unexpectedly changes `package.json`,
`package-lock.json`, or `npm-shrinkwrap.json`.
