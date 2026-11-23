# Issue #317: Run Patchmill with GitHub App installation tokens

Issue: [#317](https://github.com/rochecompaan/patchmill/issues/317)

## Summary

Patchmill must work on GitHub with a GitHub App installation token. Today every
GitHub command stops at its host check because the check calls `gh api user`,
which GitHub rejects for installation tokens. This change makes the GitHub host
check accept an installation token. Trusted comment authors then come only from
configuration.

## The issue is out of date

The issue describes the code before the skills-first kernel (#329). Its code
paths no longer exist:

- There is no `issueState` configuration and no `trustedTriageCommentAuthors()`
  host method.
- Configuration has `host.login` and `host.trustedAuthors`
  (`src/config/config.ts`). The parser accepts both for every provider and for
  both state-tracking modes. Item 1 of the proposed fix is already true.
- One helper resolves trusted authors already: `trustedAuthors(config, login)`
  in `src/config/config.ts`. It combines the live login, the GitHub
  `host.login`, and `host.trustedAuthors`, without duplicates. Item 2 of the
  proposed fix is already true.

The current failure is wider than the issue says. `GitHubHost.checkCli()`
(`src/host/github-gh.ts`) runs `gh --version`, `gh auth status`, and
`gh api user --jq .login`. These callers stop when the check fails:

| Caller                                     | Effect of a failed check    |
| ------------------------------------------ | --------------------------- |
| `src/cli/commands/triage/main.ts`          | `patchmill triage` exits 1. |
| `src/cli/commands/run/main.ts`             | `patchmill run` exits 1.    |
| `src/cli/commands/labels/main.ts`          | `labels setup` exits 1.     |
| `src/cli/commands/doctor/checks.ts`        | The `host CLI` check fails. |
| `src/cli/commands/init/main.ts`            | Init prints a warning.      |
| `src/cli/commands/setup-test-repo/main.ts` | The command stops.          |

`runTriage` (`src/kernel/triage.ts`) and `launchPhaseSession`
(`src/kernel/interactive-loop.ts`) also call `checkCli()`. They use only its
`login` and do not stop on failure.

So with an App token, Patchmill cannot triage or run any issue on GitHub.

## Goals

- `triage`, `run`, `run-once`, `labels setup`, `doctor`, and `init` work on
  GitHub with an App installation token in `GH_TOKEN`. This change makes the
  host check pass. Git push credentials and the `gh` calls that skills make
  depend on the environment, as before.
- With an App token, trusted comment authors come from `host.login` and
  `host.trustedAuthors` only. Patchmill does not depend on the identity lookup.
  It still tries `gh api user` first, because a user token needs it.
- User tokens work as before. The `gh` login stays a trusted author.
- When the GitHub check fails, the error names `host.trustedAuthors`, so an
  operator with an App token knows which setting to use.
- The docs say how to run Patchmill with an App token.

## Non-goals

- No new configuration key. `host.login` and `host.trustedAuthors` are enough.
- No change to which comments count as trusted, or how Patchmill matches them.
  #276 covers trusted maintainer answers in run-once.
- No change to the Forgejo host.
- No change to how often callers run the host check. `patchmill triage` runs it
  twice, and `run` runs it at startup, per triage cycle, and per phase launch.
  The issue's "at most once per run" limit is not a goal here. With an App
  token, each check makes two API calls, and the first one fails.
- No change to `setup-test-repo`. It creates repositories under a user account.
  It gets the new check for free, but App-token support for repository creation
  is out of scope.
- No edit to the approved E2E design
  (`docs/specs/2026-10-13-issue-320-e2e-ci-design.md`). It still names
  `issueState.trustedAuthors`. The E2E work sets `host.trustedAuthors` instead
  when it adds blocked-path scenarios.

## Anti-goals

- Do not trust an author that nobody configured. With an App token and no
  configured authors, the trusted list is empty. Doctor already warns
  `No trusted authors configured`.
- Do not hide a real authentication failure. A missing or invalid token must
  still fail the check.

## Approaches

The maintainer chose approach 1.

1. **Detect an App token when `gh api user` fails (chosen).** Remove
   `gh auth status`. If `gh api user` fails, call
   `gh api installation/repositories`. Only installation tokens can call that
   endpoint. If it succeeds, the check passes with no login. User tokens behave
   as before, and no new key is necessary.
2. **Prefer the configured login.** If `host.login` is set, skip `gh api user`
   and check access in another way. This is simpler, but it changes behavior for
   user tokens: the active `gh` account is no longer trusted automatically.
3. **Add an explicit setting**, such as `host.auth: "app"`. This is clear, but
   it adds a key. The issue recommends against new keys.

## Design

### GitHub host check

`GitHubHost.checkCli()` keeps its interface:
`checkCli(): Promise<HostCliCheck>`, where
`HostCliCheck = { ok: boolean; message: string; login?: string }`. The new order
is:

1. `gh --version`. On failure, return
   `{ ok: false, message: "gh --version failed: <output>" }`. This is unchanged.
2. `gh api user --jq .login`. On success, return
   `{ ok: true, message: "gh authenticated as <login>", login }`. This is
   unchanged.
3. On failure, run `gh api installation/repositories --jq .total_count`. On
   success, return `{ ok: true, message: APP_TOKEN_MESSAGE }` with no `login`.
4. If both calls fail, return `{ ok: false, message: FAILED_MESSAGE }`.

The check no longer runs `gh auth status`. A successful `gh api user` call
already proves that a user token works. `gh auth status` also looks up the
token's user, so it can report an App token as a failure. Removing it avoids
that risk.

The exact copy:

- `APP_TOKEN_MESSAGE`:
  `gh authenticated with a GitHub App installation token; trusted comment authors come from host.login and host.trustedAuthors`
- `FAILED_MESSAGE`:
  `No usable GitHub token: gh api user failed: <user output>; gh api installation/repositories failed: <installation output>. With a GitHub App installation token, trusted comment authors come only from host.login and host.trustedAuthors.`

`<output>` is the existing `commandOutput(result)` text.

The installation call needs no extra App permission. GitHub allows it for every
installation token. Patchmill does not use its result, only its exit code.

### Trusted authors

`trustedAuthors(config, login)` does not change. With an App token, `login` is
`undefined`, so the list is `host.login` (for GitHub) plus
`host.trustedAuthors`. Callers already pass `(await host.checkCli()).login`, so
they need no change. Bot logins use their GitHub form, for example
`patchmill-e2e[bot]`.

`init` already handles a check with no login. On a new config it sets
`host.login` to `""` and prints `Host: ready`.

### Doctor shows the host check message

Today the doctor `host CLI` check shows `Ready` when it passes, and drops the
check message (`src/cli/commands/doctor/checks.ts`). Change it to show the
message from `checkCli()` on success too. Then an App-token operator sees
`APP_TOKEN_MESSAGE` with its trust guidance, and a user-token operator sees
`gh authenticated as <login>`. The check status and order do not change. This
applies to every provider. Forgejo operators see `tea authenticated as <login>`
instead of `Ready`. The Forgejo adapter does not change.

### Domain and architecture

This change does not change the architecture. It changes one adapter
(`GitHubHost`) behind the existing `Host.checkCli()` seam. No module, interface,
or glossary term changes, so domain modeling and codebase design do not apply.
`GLOSSARY.md` has no entry for trusted authors or host login, and this change
does not need one.

### Frontend design

Frontend design does not apply. The change is a CLI host check and
documentation.

### Docs

Update these pages to describe App tokens:

- `site/src/content/docs/getting-started/configuration.md`, section
  `Host and trust`: Patchmill accepts a GitHub App installation token in
  `GH_TOKEN`. With that token, only `host.login` and `host.trustedAuthors` give
  trust. Set the bot login and maintainer logins in `host.trustedAuthors`.
- `site/src/content/docs/guides/providers.md`, section `GitHub`: it tells the
  reader to make sure that `gh auth status` reports a usable login. Add that an
  App token does not report a login, and link to the trust section.
- `site/src/content/docs/reference/environment-and-config.md`, section
  `Pi environment`: say that GitHub also accepts `GH_TOKEN` with an App
  installation token.
- `site/src/content/docs/using-patchmill/triage.md`, section `Candidates`: add
  one sentence that with an App token, trust comes only from `host.login` and
  `host.trustedAuthors`.

## Testing

Unit tests through the `GitHubHost` interface with the existing
`recordingRunner` fake in `src/host/github-gh.test.ts`:

- A user token returns the login and runs only `gh --version` and `gh api user`.
- An App token (user call fails, installation call succeeds) returns `ok: true`,
  `APP_TOKEN_MESSAGE`, and no `login`.
- No usable token (both calls fail) returns `ok: false` and a message that
  contains both outputs and `host.trustedAuthors`.
- No path runs `gh auth status`.
- A `gh --version` failure stops before any API call.

The `labels setup` failure test in `src/cli/commands/labels/main.test.ts` fails
only `gh auth status` today. Change it to fail both API calls.

A doctor test in `src/cli/commands/doctor/checks.test.ts`: a passing host check
shows its message.

No new triage test. `trustedAuthors` tests in `src/config/config.test.ts`
already cover an empty login. The `runTriage` tests in
`src/kernel/triage.test.ts` already prove that triage uses `checkCli().login`
with `trustedAuthors`.

Docs get no tests. `npm run lint` checks their format.

## Acceptance criteria

The issue's criteria map to the current code as follows:

- **Config loads.** `host.trustedAuthors` already loads for every provider and
  state-tracking mode. No change.
- **No dependency on the host lookup.** Approach 1 replaces this criterion on
  purpose. Patchmill still tries the identity lookup, but with an App token the
  check succeeds without a login, and every caller uses only configured authors.
- **Unset config is unchanged.** User tokens give the same login and the same
  trusted list as before. The number of checks per command does not change.
- **The error names the setting.** `FAILED_MESSAGE` names `host.trustedAuthors`.
- **Docs.** The four pages above describe App tokens.

## Risks

- **`gh auth status` removal.** Without it, a user token that `gh` cannot read
  fails at `gh api user`. The message then comes from that call. This is less
  specific than the old `gh auth status` message, but it is still correct.
- **Network errors.** If both calls fail because of the network, the message
  mentions App tokens even though the token may be fine. Both outputs are in the
  message, so the cause stays visible.
- **Untested GitHub behavior.** All automated tests use fakes. Three assumptions
  are not tested against GitHub: `gh api user` fails for an installation token,
  `installation/repositories` needs no extra permission, and it rejects a user
  token. The plan includes an optional manual check for when an App token is
  available. The E2E work (#320) tests this in CI later.

## Visual explanation

```text
GitHubHost.checkCli()
  gh --version            fail → ok:false (unchanged)
  gh api user             ok   → ok:true, login            (user token)
    └ fail
      gh api installation/repositories
                          ok   → ok:true, no login         (App token)
                          fail → ok:false, names host.trustedAuthors

trustedAuthors(config, login)
  user token: [login, host.login, ...host.trustedAuthors]
  App token:  [host.login, ...host.trustedAuthors]
```

## Planning review

### Pass 1: combined spec and plan review

- **Scope:** specification and implementation plan together (no gates; start of
  implementation). Other document in scope: the plan.
- **Reviewer:** `reviewer` agent, model `claude-bridge/claude-opus-5-5`,
  thinking `high`, base revision `9e93b60b4b670b6593e1cc54cfae4db5af818fc7`.
- **Reviewed body SHA-256 (initial pass):** spec
  `bdd10d0f4fffd32be6a4352af0720316cb2d08dc497d42b720d7537e64842b47`, plan
  `f2b6a1ad395ec122c350759e28da21a43ac1ea0ddc87e8c90c460edd3f3e0e33`.
- **Survey:** the reviewer confirmed that the issue's code paths are gone after
  #329, `host.trustedAuthors` loads for every provider, `trustedAuthors()` is
  the single helper, and `GitHubHost.checkCli()` runs `gh auth status` and
  `gh api user`. `triage`, `run`, `labels setup`, and `setup-test-repo` stop on
  a failed check. The change stays behind the `Host.checkCli()` seam.

Findings and dispositions:

- **B1 (blocker, plan):** `labels/main.test.ts` fails only `gh auth status`.
  Accepted: Task 1 Step 2 updates the harness.
- **M1 (minor):** the failure message pointed at a setting that cannot fix the
  failure. Accepted: new `FAILED_MESSAGE` says no usable token and names
  `host.login` and `host.trustedAuthors`.
- **M2 (minor, spec):** goals said Patchmill never asks who the token belongs
  to. Accepted: goals and acceptance mapping reworded.
- **M3 (minor, spec):** "each caller runs the check once" was wrong. Accepted:
  new non-goal on the check count.
- **M4 (minor, plan):** no `gh --version` failure test exists. Accepted: Task 1
  adds it.
- **M5 (suggestion, spec):** nobody sees the App-token message. Accepted: doctor
  shows the host check message on success (spec section and plan Task 2).
- **M6 (suggestion, plan):** the triage test fails the Testing Value Gate.
  Accepted: dropped; the spec explains the existing coverage.
- **M7 (suggestion):** GitHub behavior is untested. Accepted: new risk and an
  optional manual check in Task 4.
- **M8 (minor, spec):** goals overclaimed. Accepted: goal limited to the host
  check.
- **M9 (suggestion):** `triage.md` also describes trust. Accepted: added to the
  docs list and Task 3.

Inspection limits: the reviewer did not run `npm test` and could not test GitHub
behavior for installation tokens.

**Confirmation:** a fresh scoped confirmation found all ten findings resolved
and no new blocker. It raised two minor items. N1 (plan Task 1 Step 3 listed the
wrong failing tests): accepted, step corrected. N2 (doctor change also affects
Forgejo output): accepted, one sentence added to the spec. These two edits
follow the reviewer's exact fixes and came after the confirmation pass.

- **Final body SHA-256:** spec
  `26c37ddac194572b74435f92610634a78ef473f8c33b10c16dfbb4643da56a47`, plan
  `1ea8fef39e1edcc4ba3b6661a54c246e541d4e01648bbc3b472ba6fb3511e3c6`.
- **Outcome:** `ready`.
