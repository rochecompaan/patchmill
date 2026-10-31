# End-to-end CI check against a real GitHub repository

- **Issue:** #320
- **Status:** Proposed design
- **Scope:** GitHub (`github-gh`) happy path, with CI acting as the reviewer

## Purpose and evidence

Patchmill's unit and contract tests replace the issue host and Pi with fakes.
They miss bugs that only appear when real runs change real state between steps.
Most recent `run-once` regressions came from that kind of change:

- A reviewer revises or merges a planning PR: #252 and #271.
- A crashed run leaves a stale issue lock: #255.
- Selection skips actionable issues: #250 and #256.
- The base branch history is rewritten after a merge: #260.

This design adds an `e2e` check to every pull request. It runs the PR's
Patchmill build against a real GitHub repository and a real model. Between runs,
it acts as the human reviewer. A normal run should take 10 to 15 minutes.

## Decisions

| Topic           | Decision                                                                                                                                |
| --------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| Where it runs   | GitHub-hosted runners. The test repository is on GitHub.                                                                                |
| Trigger         | Every pull request, plus manual `workflow_dispatch` runs.                                                                               |
| Model           | OpenRouter `deepseek/deepseek-v4.1-flash` with OpenRouter's default routing. Pi 1.1.0's built-in catalog includes this model.           |
| Spend cap       | A dedicated OpenRouter key with a credit limit.                                                                                         |
| Test repository | One long-lived private repository, `patchmill/patchmill-e2e`, reset in place before each run. Runs never create or delete repositories. |
| GitHub access   | A private GitHub App, `patchmill-e2e`, installed only on the test repository. Each run gets a new token from the App.                   |
| Test scope      | The happy path plus two reviewer actions that match known regression classes (#252 and #271).                                           |
| Pass criteria   | Patchmill's own results and the final host state. CI does not judge the generated code.                                                 |
| Retries         | None. A failed check stays failed until a maintainer reruns it.                                                                         |
| Fork PRs        | The check fails with a clear message. It never skips.                                                                                   |
| Blocking        | Advisory at first. Required for merge after a clean streak (see [Rollout](#rollout)).                                                   |

The model choice favors uptime over price. The design does not pin a provider or
set `max_price`. OpenRouter's defaults avoid providers with recent outages, rank
providers for tool-calling quality (Auto Exacto) and fall back to other
providers when one fails. Patchmill needs no `models.json` override for this.

## Non-goals

- Judging the code the model writes. CI does not run the fixture's tests.
- Forgejo. It comes after the GitHub check is reliable.
- Blocked-path and recovery scenarios: a stale lock after a crash, selection
  among several issues, and a rewritten base branch. These come later, one at a
  time, after #317 lands.
- Measuring model quality.
- Changing Patchmill's runtime behavior. This design needs no `src/` changes.

## Components

| Part     | Location                    | Job                                                                                                                      |
| -------- | --------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Fixture  | `fixtures/e2e/`             | The seed content for the test repository and the issue for each run.                                                     |
| Driver   | `scripts/e2e/` (TypeScript) | Resets and seeds the test repository, runs Patchmill, acts as reviewer, checks results and collects artifacts.           |
| Workflow | `.github/workflows/e2e.yml` | A thin wrapper. It builds the PR, runs the driver's preflight, gets an App token, runs the driver and uploads artifacts. |
| Docs     | `docs/e2e.md`               | One-time setup, local runs and how to read a failure.                                                                    |

### Fixture

The fixture is a tiny Node project with no dependencies:

- `package.json` with `"test": "node --test"` and no dependencies, so tests run
  without `npm install`.
- One module under `src/` with one existing function, and a test file for it.
  The tests pass at seed time, so the implementation starts from a green
  baseline.
- `README.md` describing the project.
- `issue.md`: the title and body of the issue each run creates. The issue is
  small and fully specified, with examples and acceptance criteria. For example:
  add `formatDuration(seconds)` that returns `1h 2m 3s` for `3723`. Triage must
  judge it ready, so it leaves nothing to ask about.

The fixture does not contain `patchmill.config.json`. `patchmill init` refuses
to run when that file exists. The driver turns on the approval gates after init
instead (see [Run flow](#run-flow)).

The fixture does not set `issueState.trustedAuthors`. Under the default `labels`
provider, the config loader rejects that setting until #317 lands. The happy
path doesn't need it.

`fixtures/` ships in the npm package. The fixture is test-only, so the
implementation plan must keep `fixtures/e2e/` out of the published package and
verify that with `npm pack --dry-run`.

### Driver modules

The driver treats the built CLI as a black box. It imports nothing from `src/`.

- **`preflight`**: fails with a clear message when the PR comes from a fork or a
  required secret or variable is missing.
- **`reset`**: closes open PRs and issues and deletes every branch except
  `main`. It then reads the repository state again and fails if anything is
  left.
- **`seed`**: builds the seed commit, force-pushes `main` and creates a new
  issue for this run.
- **`scenario`**: an ordered list of steps. Each step names the command to run,
  the result it expects (status and phase) and the reviewer action that follows.
- **`reviewer`**: performs reviewer actions with git and `gh` only. It can push
  a commit to a PR branch, merge with a merge commit, squash-merge, and delete a
  branch. It makes no model calls.
- **`assertions`**: checks the final state on the host.
- **`artifacts`**: collects logs and results, removes secrets and writes the
  artifact directory.

## Run flow

Triage prints no JSON result. The driver checks its outcome through issue
labels. `run-once` prints its result as one JSON line when stdout is not a
terminal. The driver parses that line for each `run-once` step. The default
labels are `agent-ready`, `agent-done` and `blocked`.

| #   | Driver step                                                                                                                       | Expected outcome                                                    | Timeout |
| --- | --------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- | ------- |
| 0   | **Preflight**                                                                                                                     | Same-repository PR or manual run; all secrets and variables present | none    |
| 1   | **Reset** the test repository, then read its state again                                                                          | No open PRs or issues; only `main` exists, or the repo is empty     | 2 min   |
| 2   | **Seed** (details below)                                                                                                          | Issue #N is open and has no labels                                  | 2 min   |
| 3   | Clone the test repository into a temp directory. Write `.patchmill/pi-agent/settings.json` with the OpenRouter provider and model | none                                                                | none    |
| 4   | `patchmill triage --issue N`                                                                                                      | #N has `agent-ready`                                                | 4 min   |
| 5   | `patchmill run-once`                                                                                                              | `review-pending`, phase `spec`                                      | 6 min   |
| 6   | Reviewer pushes a commit to the spec PR branch. It appends a marker line to the spec file                                         | none                                                                | none    |
| 7   | `patchmill run-once`                                                                                                              | `review-pending`, phase `spec`                                      | 2 min   |
| 8   | Reviewer merges the spec PR with a merge commit                                                                                   | none                                                                | none    |
| 9   | `patchmill run-once`                                                                                                              | `review-pending`, phase `plan`                                      | 6 min   |
| 10  | Reviewer pushes a marker commit to the plan PR branch, then runs `gh pr merge --squash --delete-branch`                           | none                                                                | none    |
| 11  | `patchmill run-once`                                                                                                              | `pr-created`                                                        | 10 min  |
| 12  | **Assertions**                                                                                                                    | All pass (see [Pass criteria](#pass-criteria))                      | 1 min   |
| -   | **Artifacts**, collected even after a failure                                                                                     | none                                                                | none    |

Step 7 adopts the reviewer's new head and should not need a model call. The
driver does not assert that.

Steps 6 to 10 cover two regression classes. Step 6 pushes to an open planning
PR, like #252. Step 10 revises the plan PR and merges it before Patchmill adopts
the new head, like #271.

### Seed details

1. Copy `fixtures/e2e/` (except `issue.md`) into a new temp Git repository.
   Write the `.patchmill-e2e` marker file. Set `origin` to the test repository.
2. Run the PR build's `patchmill init --provider github-gh`. The installed
   skills therefore match the PR. Without a terminal, `--yes` selects the "add
   to git" policy. Init commits `chore: initialize Patchmill` locally and
   creates the required labels on the host. It does not push.
3. Init always runs a Pi smoke test and exits 0 even when that test fails. The
   driver runs init without `OPENROUTER_API_KEY`, so the smoke test can't call a
   model. The driver checks init's exit code and the setup commit. It ignores
   the smoke result.
4. Force-push `main` to the test repository.
5. Create issue #N from `issue.md`.

### Rules

- **Stop on the first surprise.** If a status, phase or exit code differs from
  what the step expects, the driver stops. It reports the step name, the
  expected and actual results and the result's `diagnostic`, then exits 1. It
  never tries to recover.
- **Timeouts.** When a step runs out of time, the driver sends SIGTERM to the
  `patchmill` process, then SIGKILL after a short grace period. The step limits
  add up to about 33 minutes. The job's `timeout-minutes: 40` sits above that,
  so a driver timeout always fires first and artifacts still upload.
- **No model calls from CI itself.** Reviewer commits are fixed text. Each
  marker line includes the issue number, so it is unique to the run and the
  assertions can find it on `main`.
- **Finding planning files.** A `review-pending` result includes the PR URL. The
  reviewer finds the spec or plan file from the PR's changed files. It fails
  unless it finds exactly one.
- **One build.** The driver runs `dist/bin/patchmill.js` from the current
  checkout. It puts a `patchmill` shim for that file first on `PATH` for child
  processes, so skills that call `patchmill` reach the same build.

## Pass criteria

The check passes only when every step result matches the table above and the
final state shows all of the following:

- The spec PR is merged and the plan PR is squash-merged.
- The plan PR's branch is gone.
- `main` contains both reviewer marker lines.
- The final PR is open against `main`, and its body has a top-level `Closes #N`
  line.
- Issue #N has `agent-done` and does not have `blocked`.

CI does not merge the final PR. Patchmill finishes the issue when it opens that
PR, so a merge would test nothing.

## Credentials and auth

### Secrets and variables

These live in the repository settings of `rochecompaan/patchmill`.

| Name                  | Kind     | Value                                                                                |
| --------------------- | -------- | ------------------------------------------------------------------------------------ |
| `E2E_APP_ID`          | secret   | The `patchmill-e2e` App's ID.                                                        |
| `E2E_APP_PRIVATE_KEY` | secret   | The App's private key.                                                               |
| `OPENROUTER_API_KEY`  | secret   | A dedicated OpenRouter key with a credit limit.                                      |
| `E2E_REPO`            | variable | `patchmill/patchmill-e2e`. A variable lets the repository move without code changes. |

The model ID is a constant in `scripts/e2e/`. Changing it takes a PR, so every
check result maps to a known model. `PATCHMILL_E2E_MODEL` overrides it for local
runs. The workflow never sets it.

The test repository is private. Outside users therefore can't open PRs whose
branch names clash with Patchmill's.

### GitHub App

- `patchmill-e2e` is private, owned by the `patchmill` organization and
  installed only on the test repository.
- Permissions: Contents, Issues and Pull requests write. GitHub adds Metadata
  read. Checks read and Commit statuses read are added only if planning shows
  that Patchmill needs them (see [Checks for planning](#checks-for-planning)).
  It has no Administration permission, so it can't delete repositories.
- The workflow gets the token with `actions/create-github-app-token@v2`. It
  takes the owner and repository name from `E2E_REPO`. The step runs inside the
  job, after the queue clears, so waiting in line doesn't use up the token's
  hour. The job timeout is 40 minutes, so the token can't expire mid-run.
- Only the token step sees the private key. The driver gets the token, never the
  key.
- Issues, commits and PRs show `patchmill-e2e[bot]` as the author.

Patchmill calls `gh api user` in one place
(`GitHubGhProvider.trustedTriageCommentAuthors`). GitHub rejects that call for
App installation tokens. The happy path never reaches it:

- Triage calls it only when an issue is, or becomes, `blocked`.
- `run-once` calls it only when the issue has published-artifact marker
  comments. Only the legacy pipeline posts those, and a fresh issue takes the
  planning-PR path.
- `gh auth status` runs only in `doctor` and `setup-test-repo`, which the driver
  does not use.

If triage blocks the fixture issue, the run fails with `gh api user failed`
instead of "expected `agent-ready`". The check still fails, but the message is
less clear. #317 fixes this. It must land before any blocked-path scenario.

### Git and `gh` auth inside the driver

- The driver and every command it starts get `GH_TOKEN` set to the App token.
- The seed repository and the test clone each get local Git config, not global:
  `credential.helper = !gh auth git-credential` and a fixed author name and
  email (`Patchmill E2E`). Patchmill's worktrees share the clone's config, so
  their pushes use the same token.
- The workflow's own `GITHUB_TOKEN` gets only `contents: read`.

### Checks for planning

The implementation plan must confirm these before it relies on them:

- `patchmill init --provider github-gh` works with an App installation token.
- No installed skill calls `gh api user` on the happy path.
- The implementation skill's PR-check wait works on a repository with no CI.
  Find the smallest App permission set that allows it.
- `gh auth git-credential` uses `GH_TOKEN`.
- With no provider key set, init's Pi smoke test fails fast and init still
  exits 0.
- `run-once` finds the zero-dependency fixture's development environment ready.

## Triggers, concurrency and the required check

- **Triggers:** `pull_request` (`opened`, `synchronize`, `reopened`) and
  `workflow_dispatch`. There is no `paths` filter, because a required check that
  never reports leaves a PR stuck.
- **Per-PR group:** workflow-level
  `concurrency: { group: e2e-pr-<PR number or ref>, cancel-in-progress: true }`.
  A new push cancels the older run for the same PR, even while it waits in line.
- **Shared-repository group:** job-level
  `concurrency: { group: e2e-test-repo, queue: max }`. One run uses the test
  repository at a time, and the rest wait in line. `queue: max` can't be
  combined with `cancel-in-progress` in one group, which is why there are two
  groups.
- **Cancelled runs** can leave the test repository dirty. The next run's reset
  step cleans it up.
- **Fork PRs** get no secrets. The preflight step fails them with a message: a
  maintainer must push the branch to this repository to run the check. The
  workflow never uses `pull_request_target`. GitHub reports a job skipped by
  `if:` as passing, so the job must run and fail, not skip.
- **Bot PRs** from release-please and the upgrade workflows come from branches
  in this repository. They get the secrets, so the check runs on them.
- **Required check:** a ruleset on `main` requires `e2e` plus the existing
  `ci.yml` checks. `main` has no branch protection or rulesets today. This is a
  settings change on a public repository. Maintainers apply it by hand or with
  `gh api` after approval. `docs/e2e.md` documents it.

## Failure reports

The driver records each step: name, command, expected and actual status and
phase, exit code, run time and the `diagnostic` field.

- **Annotation:** on failure, one `::error` line, for example
  `Step 9 (plan PR): expected review-pending/plan, got blocked: <diagnostic>`.
  It appears on the PR's checks page.
- **Job summary:** the driver always writes a step table (pass or fail, and run
  time) to `$GITHUB_STEP_SUMMARY`. For a failed step, it adds the last 50 lines
  of stderr. It links the test repository's issue and PRs. GitHub can't delete
  PRs, so those links keep working after later resets.
- **Artifacts** (uploaded with `if: always()`, kept 14 days): `steps.json`,
  stdout and stderr for each command, `.patchmill/runs/` and
  `.patchmill/triage-runs/` from the test clone. Pi session files live under
  `.patchmill/runs/issue-N/run-*-pi-sessions/`, so the runs directory includes
  them.
- **No cleanup at the end.** The test repository stays as the run left it, so a
  maintainer can inspect it. The next run's reset step cleans it.

### Secret redaction

Any signed-in GitHub user can download artifacts from a public repository.
GitHub masks secrets in logs but not in artifacts. Pi session files can contain
the OpenRouter key or the App token, for example if the model runs `env`.

Before upload, the driver replaces the values of `OPENROUTER_API_KEY` and
`GH_TOKEN` in every artifact file. If redaction fails for any file, the driver
deletes the artifact directory, says so in the job summary and uploads nothing.

## Unit-test seam

These pure functions get `node --test` tests in `scripts/e2e/*.test.ts`:

| Function                      | Why it's worth testing                                                             |
| ----------------------------- | ---------------------------------------------------------------------------------- |
| `parseRunOnceResult(stdout)`  | Finds the one JSON result line. Rejects a missing line, several lines or bad JSON. |
| `checkStep(expected, actual)` | A bug here hides real failures.                                                    |
| `planReset(repoState)`        | Reset is destructive, and this function holds the safety guard.                    |
| `checkFinalState(snapshot)`   | A bug here makes the check pass when it shouldn't.                                 |
| `redact(text, secrets)`       | Security-sensitive.                                                                |
| `preflight(event, env)`       | Fork PRs and missing secrets must fail, not skip.                                  |

The `gh` and Git calls and the workflow YAML get no unit tests. The real run
covers them.

The globs for `npm test`, `lint:ts` and `check:types` don't cover
`scripts/e2e/*.ts` today. The plan extends them.

## Local runs

- Command: `npm run build`, then `node scripts/e2e/run.ts --repo OWNER/NAME`.
  The driver uses the current checkout's build, the developer's own `gh` login
  and `OPENROUTER_API_KEY` from the environment.
- **Safety guard.** A developer's `gh` login can usually rewrite any repository
  they own. `planReset` refuses a repository unless it is empty (no branches) or
  its `main` has the `.patchmill-e2e` marker file. It also refuses the
  repository the driver runs from.
- Local runs should use the developer's own private test repository, not
  `patchmill/patchmill-e2e`, because they bypass the CI queue. `docs/e2e.md`
  says so.
- The driver writes artifacts to a temp directory and prints the path. It
  redacts them the same way as in CI.

## Rollout

1. **One-time setup**, by a maintainer following `docs/e2e.md`:
   - Create the empty private repository `patchmill/patchmill-e2e`. Keep merge
     commits and squash merges enabled.
   - Create the `patchmill-e2e` App and install it only on that repository.
   - Add `E2E_APP_ID`, `E2E_APP_PRIVATE_KEY` and `OPENROUTER_API_KEY` (start
     with a low credit limit, such as $10), and the `E2E_REPO` variable.
2. **First PR:** fixture, driver, unit tests, workflow and docs. The check is
   advisory. The PR's branch is in this repository, so the new workflow runs on
   the PR itself before merge.
3. **Measure** time and cost over the first 10 or so runs, using the OpenRouter
   key's activity page. Then set the credit limit and adjust step timeouts. If
   the model causes frequent failures, revisit the model choice before going
   further.
4. **Make it required** after 10 runs in a row with no failures caused by the
   model or OpenRouter. Add the ruleset after maintainer approval.
5. **Later:** #317 lands. Then the driver sets `issueState.trustedAuthors` after
   init. Add the deferred scenarios one at a time. Forgejo comes after that.

## Risks

- **Model failures.** A cheap model may not follow the skills reliably, so the
  check could fail for reasons other than a Patchmill bug. The advisory period
  and the streak rule measure this before the check blocks merges.
- **Queueing.** One shared repository runs one check at a time. A busy day
  queues runs. `queue: max` allows up to 100 waiting runs.
- **Incomplete reset.** If reset misses some state, runs become flaky. Reset
  reads the state again after cleaning and fails if anything is left.
- **Unknown cost.** The credit limit caps spend until runs are measured.
- **Outages.** Once the check is required, an OpenRouter or GitHub outage blocks
  merges until a rerun passes. A manual rerun is the only retry.
- **Leftover history.** Closed issues and PRs pile up in the test repository,
  because GitHub can't delete PRs. This is harmless. Patchmill lists only open
  issues, and its branch names include the issue number, which GitHub never
  reuses.
- **Docs-only PRs** pay for a full run, because the required check has no path
  filter. This is accepted.

## Verification of this work

- Unit tests for the functions in [Unit-test seam](#unit-test-seam).
- `npm test`, `npm run lint` and `npm run check:types` pass with the extended
  globs.
- `npm pack --dry-run` shows no `fixtures/e2e/` files.
- The `e2e` workflow passes at least once on the first PR itself, and its
  artifacts contain no unredacted secret values.
