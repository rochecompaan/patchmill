# Setup Test Repo Seed Progress Design

## Goal

Show plain stdout progress while `patchmill setup-test-repo` performs the
network-bound seeding steps after the disposable repository has been created.
Users should be able to see that the command is still working while it pushes
the seed commit, ensures labels, and creates each fixture issue.

## Current behavior

- `runSetupTestRepo` in `src/cli/commands/setup-test-repo/main.ts` loads the
  fixture, creates a local seed commit, creates or resets the remote repository,
  pushes the commit, ensures labels, creates all fixture issues, then prints
  `Seeded <publicUrl>` and the next-step block.
- Reset runs already print repository lifecycle lines such as `Resetting ...`,
  `Deleting ...`, and `Creating public repository ...`.
- After remote creation, the command can be quiet for several network calls:
  `git push -u origin main`, `provider.listLabels`, missing label creation, and
  one `provider.createIssue` call per parsed fixture issue.
- Fixture issue order is already determined by `loadSetupIssues` in
  `src/cli/commands/setup-test-repo/fixtures.ts`, which sorts issue markdown
  filenames before parsing them.

## Desired behavior

After the remote repository is created, emit low-noise progress lines through
`SetupTestRepoOutput.stdout`:

```text
Pushing seed commit
Ensuring labels
Seeding issues (12)
  [1/12] Create the Team Lunch Poll app scaffold
  [2/12] Define the poll domain model
  ...
  [12/12] Fix votes disappearing after refresh
Seeded https://github.com/OWNER/REPO
```

Formatting requirements:

- Keep output plain text: no ANSI color, cursor control, carriage returns,
  progress bars, or spinners.
- Preserve existing stderr behavior.
- Preserve the final `Seeded <publicUrl>` line and the next-step block.
- Use issue titles exactly as parsed from each `SetupIssue` object.
- Emit per-issue lines in the same order as `loadSetupIssues` returns issues.
- Emit each per-issue line immediately before awaiting the matching
  `provider.createIssue(config.target, issue)` call. The line identifies the
  operation in progress; it does not claim completion.
- If the fixture ever contains zero issues, print `Seeding issues (0)` and then
  continue to the existing success output.

## Proposed design

Keep the host-provider interface and CLI arguments unchanged. Add a small
internal progress formatter/emitter near the setup orchestration in
`src/cli/commands/setup-test-repo/main.ts`:

```ts
type SetupSeedProgressEvent =
  | { type: "push-seed-commit" }
  | { type: "ensure-labels" }
  | { type: "seed-issues-start"; total: number }
  | { type: "seed-issue"; completed: number; total: number; title: string };
```

Map events to stdout lines as follows:

- `push-seed-commit` -> `Pushing seed commit`
- `ensure-labels` -> `Ensuring labels`
- `seed-issues-start` -> `Seeding issues (<total>)`
- `seed-issue` -> an indented `[<completed>/<total>] <title>` line

Update `runSetupTestRepo` so the remote setup section flows as:

1. Prepare the remote repository as today.
2. Emit `Pushing seed commit`, then call `pushSeedCommit`.
3. Emit `Ensuring labels`, then call `createMissingLabels`.
4. Emit `Seeding issues (<issues.length>)`.
5. Iterate over `issues.entries()`; for each issue, emit an indented
   `[index/total] <issue.title>` line and then call `provider.createIssue`.
6. Print `Seeded <publicUrl>` and the next-step block unchanged.

This keeps progress reporting inside the interactive command layer, where tests
already inject output collectors, and avoids widening
`RepositorySetupHostProvider`.

## Affected components

- `src/cli/commands/setup-test-repo/main.ts`
  - Add progress event type and formatter/helper, or inline helpers if the file
    remains small.
  - Emit progress at the three network-bound phases and before each issue
    creation call.
- `src/cli/commands/setup-test-repo/main.test.ts`
  - Extend setup-test-repo tests to assert stdout progress content and ordering.
  - Preserve existing reset lifecycle assertions and rollback assertions.

No changes are required for host providers, fixture parsing, repository
creation/reset behavior, label definitions, or fixture issue content.

## Failure behavior

Existing failure and rollback behavior should remain unchanged:

- `pushSeedCommit`, label creation, and issue creation failures still produce
  exit code `1`.
- If the remote repository has already been created, rollback still runs and the
  rollback result is included in stderr as today.
- Progress already printed to stdout remains visible and is not rewritten or
  hidden.
- On issue creation failure, the last printed per-issue line identifies the
  fixture issue being attempted when the failure occurred.

## Test plan

Update `src/cli/commands/setup-test-repo/main.test.ts` with focused assertions:

- Happy path stdout includes `Pushing seed commit`, `Ensuring labels`,
  `Seeding issues (12)`, the first fixture issue line, the last fixture issue
  line, the existing `Seeded <publicUrl>` line, and existing next-step lines.
- Ordering proves `Pushing seed commit` appears before label/issue seeding
  output, and the first per-issue progress line is emitted before the
  corresponding `createIssue` call resolves. The existing evented provider and
  runner helpers can be extended to record stdout events.
- Reset behavior still includes `Deleting OWNER/REPO` and
  `Creating public repository OWNER/REPO` before the new post-creation progress
  lines.
- Issue creation failure stdout includes the attempted per-issue progress line,
  while stderr still includes `issue create failed` and the rollback message.

Run targeted verification:

```bash
node --test src/cli/commands/setup-test-repo/*.test.ts
```

Run the full suite when the repository baseline is suitable:

```bash
npm test
```

If a known unrelated baseline failure appears, record it in the implementation
handoff rather than changing this feature's scope.

## Out of scope

- Returning issue URLs, issue numbers, or other metadata from host providers.
- Changing fixture issue content or ordering.
- Changing repository creation, reset, rollback, label definitions, or final
  next-step instructions.
- Adding TTY spinners, progress bars, colors, quiet flags, or verbose flags.
