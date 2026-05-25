# Source CLI reorganization design

## Context

Patchmill currently has production TypeScript workflow code under `scripts/`:

- `scripts/agent-issue-triage.ts`
- `scripts/agent-issue-triage/*`
- `scripts/agent-issue-once.ts`
- `scripts/agent-issue/*`

Those modules implement the public `patchmill triage` and `patchmill run-once`
workflows. They include argument parsing, command orchestration, host/Pi/git
integration, workflow pipelines, progress reporting, and tests. This makes
`scripts/` look like a place for one-off developer utilities even though it
contains core product behavior.

Patchmill also has a normal `src/` tree for shared product modules such as
configuration, host adapters, Pi integration, policy, git helpers, and workflow
skills. Moving command implementation code into `src/` will make the codebase
match how the software is described to users.

## Goals

- Put production command implementation code under `src/`.
- Keep `bin/` as the package executable boundary.
- Reserve `scripts/` for actual repository maintenance scripts.
- Use directory names that match public CLI commands.
- Preserve existing CLI behavior while changing organization.
- Make command ownership easier to understand for new contributors.

## Non-goals

- Changing triage or run-once runtime behavior.
- Redesigning command-line flags or help text.
- Reworking workflow internals beyond import-path updates needed for the move.
- Creating a public library API for Patchmill workflows.
- Removing or renaming the public commands `triage` and `run-once`.

## Chosen structure

Use a CLI-focused source layout:

```text
bin/
  patchmill.ts

src/
  cli/
    main.ts
    commands/
      triage/
      run-once/

  config/
  git/
  host/
  pi/
  policy/
  workflow/

scripts/
  audit-generalization.sh
```

The command implementation directories use public command names:

- `src/cli/commands/triage/`
- `src/cli/commands/run-once/`

This keeps the path a user sees in the CLI aligned with the path a developer
uses to find the implementation.

## Alternatives considered

### `src/cli/<command>/`

This would remove one directory level:

```text
src/cli/
  main.ts
  triage/
  run-once/
```

It is compact, but it makes command implementations peers of CLI-level shared
files. Keeping `commands/` makes the dispatcher/adapter layer easier to scan:
`src/cli/main.ts` is the dispatcher, and everything under `src/cli/commands/` is
a public command implementation.

### `src/commands/<command>/`

This would be short and clear, but less explicit about the command surface. A
future reader could interpret `src/commands` as generic application command
objects rather than CLI wiring.

### `src/workflows/<workflow>/`

This would emphasize domain workflows and could fit a future non-CLI surface,
but today these modules include CLI concerns such as args, console progress, and
command entrypoints. Calling them workflows would blur the line between command
adapters and reusable workflow logic.

### Rename `run-once`

Names such as `work`, `implement`, `deliver`, and `process` may describe the
single-issue workflow better than `run-once`. This spec defers public command
renaming so the implementation remains a structure-only refactor. Any command
rename should be handled separately, with compatibility and documentation
migration considered explicitly.

### Keep production TypeScript in `scripts/`

This avoids churn, but preserves the current confusion. The directories in
`scripts/` are not one-off scripts; they are core Patchmill workflows with unit
tests and should live with the rest of the source.

## Component responsibilities

### `bin/patchmill.ts`

`bin/patchmill.ts` remains the executable entrypoint declared by `package.json`.
It should be intentionally small: import the CLI main function, pass process
arguments, and exit with the returned status code.

It should not contain command implementation details or hard-coded paths to
TypeScript files under `scripts/`.

### `src/cli/main.ts`

`src/cli/main.ts` owns the public CLI dispatcher:

- help text
- command name parsing
- unknown-command errors
- command lookup
- top-level exit-code handling

It dispatches directly to command modules rather than spawning separate
TypeScript scripts.

### `src/cli/commands/triage/`

This directory owns the `patchmill triage` implementation. It receives the code
currently under:

- `scripts/agent-issue-triage.ts`
- `scripts/agent-issue-triage/*`

The moved command entrypoint should expose a function that can be called from
`src/cli/main.ts`, while preserving testable parsing and pipeline boundaries.

### `src/cli/commands/run-once/`

This directory owns the `patchmill run-once` implementation. It receives the
code currently under:

- `scripts/agent-issue-once.ts`
- `scripts/agent-issue/*`

The moved command entrypoint should expose a function that can be called from
`src/cli/main.ts`, while leaving the existing pipeline decomposition intact.

### `scripts/`

`scripts/` remains for true repository or development maintenance helpers. After
the move, `scripts/audit-generalization.sh` can stay there because it is a shell
maintenance script rather than product command implementation.

## Migration mapping

```text
scripts/agent-issue-triage.ts      -> src/cli/commands/triage/main.ts
scripts/agent-issue-triage/*.ts    -> src/cli/commands/triage/*.ts
scripts/agent-issue-once.ts        -> src/cli/commands/run-once/main.ts
scripts/agent-issue/*.ts           -> src/cli/commands/run-once/*.ts
```

Tests move alongside their modules:

```text
scripts/agent-issue-triage/*.test.ts -> src/cli/commands/triage/*.test.ts
scripts/agent-issue/*.test.ts        -> src/cli/commands/run-once/*.test.ts
```

## Runtime behavior

The public behavior remains unchanged:

- `patchmill triage` classifies issues and optionally applies labels/comments.
- `patchmill run-once` claims and processes one ready issue.
- `npm run triage` and `npm run run-once`, if retained, call the same command
  implementations through the CLI path.
- Help and unknown-command behavior remain equivalent to the existing CLI.

The main behavior change at the implementation level is that command dispatch
uses imports/function calls instead of `spawnSync` against files in `scripts/`.
This removes script-path coupling and keeps all command code in the source tree.

## Testing and package scripts

Update package scripts and test globs to match the new locations:

- `lint:ts` should continue linting `bin`, `src`, and `test-support`; it no
  longer needs to lint TypeScript under `scripts` once those files move.
- `test` and `test:coverage` should include command tests under
  `src/cli/commands/**/*.test.ts` through the existing `src/**/*.test.ts` glob.
- `test:triage` should target `src/cli/commands/triage/*.test.ts`.
- `test:run-once` should target `src/cli/commands/run-once/*.test.ts`.

Verification should include at least:

- `npm test`
- `npm run lint`
- a smoke check for `node bin/patchmill.ts --help`

## Risks and mitigations

### Import churn

Moving many files will require many relative import updates. Mitigate by moving
without behavior changes first, then running the full test and lint suite.

### Lost executable behavior

The current CLI spawns separate scripts. Replacing that with function dispatch
could change process-level behavior. Mitigate by preserving command return-code
semantics and adding or updating tests around `bin/patchmill.ts` and
`src/cli/main.ts`.

### Overloading `src/cli`

`src/cli` should not become a dumping ground for shared logic. Command-specific
orchestration can live under command directories, but reusable configuration,
host, Pi, policy, git, and workflow code should remain in their existing focused
source modules.

## Acceptance criteria

- No production TypeScript command workflow code remains under `scripts/`.
- `scripts/` contains only maintenance scripts.
- `bin/patchmill.ts` is a thin executable wrapper.
- CLI dispatch lives in `src/cli/main.ts`.
- Triage implementation lives under `src/cli/commands/triage/`.
- Run-once implementation lives under `src/cli/commands/run-once/`.
- Existing public commands and npm scripts keep working.
- Tests and lint pass after the reorganization.
