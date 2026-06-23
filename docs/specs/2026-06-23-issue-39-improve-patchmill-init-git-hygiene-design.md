# Improve Patchmill Init Git Hygiene Design

## Goal

Make `patchmill init` consistently protect local implementation artifacts and
finish interactive git-hygiene setup with an appropriate best-effort commit.

## Current behavior

- `src/cli/commands/init/git-policy.ts` owns the init git policy prompt and
  policy application.
- `PATCHMILL_GIT_IGNORE_ENTRIES` is used for the `ignore` and `exclude` policy
  entry lists and currently contains only `patchmill.config.json` and
  `.patchmill/`.
- `PATCHMILL_ADD_TO_GIT_IGNORE_ENTRIES` is used by the `add` policy to keep
  local Patchmill runtime state out of tracked config and currently contains
  `.patchmill/pi-agent`, `.patchmill/runs`, and `.patchmill/triage-runs`.
- The `add` policy appends runtime entries to `.gitignore`, stages existing
  `patchmill.config.json`, skill roots, and `.gitignore` with `git add -f`, and
  reports staged files. It does not commit.
- The `ignore` policy appends entries to `.gitignore` and does not stage or
  commit `.gitignore`.
- The `exclude` policy appends entries to `.git/info/exclude` and reports
  non-fatal warnings if git metadata cannot be resolved or written.
- `src/cli/commands/init/main.ts` orchestrates config writing, skill install,
  git policy application, label setup, and Pi setup; git mutation details are
  already isolated in `git-policy.ts`.

## Desired behavior

### Shared local artifact protection

`patchmill init` must treat these directories as local implementation artifacts
that should never become project configuration:

- `.worktrees/`
- `.pi/todos/`

The artifact entries must be appended idempotently and recognized as duplicates
when users already have slash or root-anchored variants such as `.worktrees`,
`.worktrees/`, `/.worktrees/`, `.pi/todos`, or `/.pi/todos/`.

### Add config and skills to git

When the selected policy is `add`:

1. Append these entries to `.gitignore` if missing:
   - `.patchmill/pi-agent`
   - `.patchmill/runs`
   - `.patchmill/triage-runs`
   - `.worktrees/`
   - `.pi/todos/`
2. Stage only existing repo-relative Patchmill config, configured skill roots,
   and `.gitignore`.
3. Preserve existing force-add behavior for skill roots that may live below
   ignored parents.
4. If staging succeeds and there is something to commit, create a commit with a
   Conventional Commit message such as:

   ```text
   chore: initialize Patchmill
   ```

5. Report that Patchmill config, skills, and local artifact ignore rules were
   committed when the commit succeeds.
6. If staging or committing fails, complete init and include an actionable
   warning containing git stdout/stderr.

### Add Patchmill files to `.gitignore`

When the selected policy is `ignore`:

1. Append these entries to `.gitignore` if missing:
   - `patchmill.config.json`
   - `.patchmill/`
   - `.worktrees/`
   - `.pi/todos/`
2. If `.gitignore` changed, stage and commit `.gitignore` only.
3. Do not stage or commit `patchmill.config.json` or `.patchmill/`, because the
   user selected local-only Patchmill config.
4. If all required `.gitignore` entries already existed, report that no git
   hygiene commit was needed and do not run `git add` or `git commit`.
5. Treat staging or commit failures as non-fatal warnings.

### Add Patchmill files to `.git/info/exclude`

When the selected policy is `exclude`:

1. Append these entries to `.git/info/exclude` if missing:
   - `patchmill.config.json`
   - `.patchmill/`
   - `.worktrees/`
   - `.pi/todos/`
2. Never stage or commit files for this policy.
3. Keep missing or unwritable git metadata non-fatal and include the full manual
   entry list in warning output.

## Proposed design

### Entry constants

Extend the existing constants in `src/cli/commands/init/git-policy.ts` rather
than adding a parallel policy path:

- Add `.worktrees/` and `.pi/todos/` to `PATCHMILL_GIT_IGNORE_ENTRIES` so both
  `ignore` and `exclude` policies share the same complete local-only list.
- Add `.worktrees/` and `.pi/todos/` to `PATCHMILL_ADD_TO_GIT_IGNORE_ENTRIES` so
  the `add` policy tracks config and skills while ignoring local implementation
  state.

The current `normalEntry` and `hasEntry` helpers already strip a leading slash
and trailing slashes. Keep using them for idempotent append behavior.

### Commit helper

Add a focused helper near `applyInitGitPolicy` in `git-policy.ts` so `main.ts`
remains orchestration-only. The helper should:

- accept `repoRoot`, injected `CommandRunner`, exact repo-relative paths to
  commit, commit message, a force-add flag, and text used for result messages;
- filter paths through the existing safe relative path and existence checks
  before staging;
- run `git add` with only those paths, using `-f` when the `add` policy stages
  skill roots;
- run a path-limited commit flow for the same paths, for example:

  ```bash
  git commit -m "chore: initialize Patchmill" -- <paths...>
  ```

- treat git output indicating nothing to commit/no changes as a non-error;
- return a small result object or message fragment that distinguishes committed,
  no-op, staging warning, and commit warning outcomes;
- include git stderr or stdout in warnings so users can act on failures.

For the `ignore` policy, call this helper only when `appendEntries` reports that
`.gitignore` changed, and pass only `.gitignore` as the commit path. For the
`add` policy, call it after appending runtime artifact entries and pass existing
`patchmill.config.json`, skill roots, and `.gitignore`.

### Init output

Keep the public prompt choices unchanged. Update success text from staged-only
language to committed-language:

- `add`: Patchmill config, skills, and local artifact ignore rules were
  committed.
- `ignore`: `.gitignore` git hygiene rules were committed, or no git hygiene
  commit was needed when entries already existed.
- `exclude`: local-only exclude messages remain unchanged apart from the larger
  entry list.

Warning text should make clear that init is continuing despite git staging or
commit failures. Label setup and Pi setup must still run after git warnings.

## Affected components

- `src/cli/commands/init/git-policy.ts`
  - Extend policy entry constants.
  - Add the best-effort, path-limited git commit helper.
  - Update `add`, `ignore`, and `exclude` policy messages.
  - Keep append and duplicate normalization behavior centralized.
- `src/cli/commands/init/git-policy.test.ts`
  - Update direct policy tests for new entries, staging, commits, no-op commit
    behavior, duplicate variants, and non-fatal commit failures.
- `src/cli/commands/init/main-git-policy.test.ts`
  - Update integration-style init output and command-call expectations from
    staged-only to committed behavior.
- `src/cli/commands/init/main.ts`
  - No git logic changes expected beyond consuming the updated policy result
    message if necessary.

## Verification strategy

Add focused automated tests covering:

- `add` appends `.worktrees/` and `.pi/todos/` to `.gitignore`, force-stages
  config, skills, and `.gitignore`, then commits those paths.
- `add` still force-stages skill roots when `.patchmill/` is ignored.
- `ignore` appends `patchmill.config.json`, `.patchmill/`, `.worktrees/`, and
  `.pi/todos/` to `.gitignore`, then stages and commits `.gitignore` only.
- `ignore` does not call `git add` or `git commit` when all required entries
  already exist.
- `exclude` appends all four local-only entries to `.git/info/exclude` and never
  calls `git add` or `git commit`.
- `.worktrees`, `.worktrees/`, `/.worktrees/`, `.pi/todos`, and `/.pi/todos/`
  are treated as duplicate entries.
- Staging and commit failures are reported as warnings and `runInit` still
  returns the Pi setup result rather than failing because of git hygiene.
- Existing `main` git policy tests assert committed output and the expected
  `CommandRunner` call sequence.

Run targeted tests:

```bash
node --test src/cli/commands/init/git-policy.test.ts src/cli/commands/init/main-git-policy.test.ts
```

Run the full suite before merge:

```bash
npm test
```

## Acceptance criteria

- `.worktrees/` and `.pi/todos/` are protected for `add`, `ignore`, and
  `exclude` policies.
- Interactive `add` creates a best-effort commit for Patchmill config, skills,
  and `.gitignore` changes.
- Interactive `ignore` creates a best-effort commit for `.gitignore` only when
  init changed `.gitignore`.
- `exclude`, non-interactive default behavior, and `--yes` default behavior stay
  local-only and do not commit.
- Git staging/commit failures produce warnings but do not prevent label setup,
  Pi setup, or init completion.
- Tests verify command invocations through the injected `CommandRunner`.

## Out of scope

- Changing init prompt choices or adding a commit confirmation prompt.
- Committing anything for the `exclude` policy.
- Committing local Patchmill config for users who choose the `ignore` policy.
- Managing, deleting, or migrating existing `.worktrees/` or `.pi/todos/`
  contents.
