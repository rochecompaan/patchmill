# GitHub App installation tokens Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use the sibling `executing-plans`
> skill to implement this plan inline, task by task. Steps use checkbox
> (`- [ ]`) syntax for tracking.

**Goal:** Let the GitHub host check accept an App installation token, so that
Patchmill commands pass the host check with `GH_TOKEN` set to an App token and
trust only configured authors.

**Architecture:** Change `GitHubHost.checkCli()` behind the existing
`Host.checkCli()` seam. Callers and `trustedAuthors(config, login)` do not
change. Doctor shows the host check message on success, so App-token operators
see the trust guidance.

**Tech Stack:** TypeScript on Node (`node --test`), `gh` CLI, Astro Starlight
docs.

**Spec:**
[docs/specs/2026-11-23-issue-317-triage-and-run-once-ignore-configured-trusted-au-design.md](../specs/2026-11-23-issue-317-triage-and-run-once-ignore-configured-trusted-au-design.md)

## Plan inputs

- The spec above and its `## Visual explanation`. There are no mockups or HTML
  companions.

## Global Constraints

- No new configuration key. Use `host.login` and `host.trustedAuthors`.
- `HostCliCheck` and `Host.checkCli()` keep their types.
- `checkCli()` never runs `gh auth status`.
- App-token success message, exact:
  `gh authenticated with a GitHub App installation token; trusted comment authors come from host.login and host.trustedAuthors`
- Failure message, exact:
  `No usable GitHub token: gh api user failed: <user output>; gh api installation/repositories failed: <installation output>. With a GitHub App installation token, trusted comment authors come only from host.login and host.trustedAuthors.`
- `<output>` is `commandOutput(result)`.
- No change to the Forgejo host, `setup-test-repo`, the number of host checks
  per command, or the approved E2E spec.
- Docs follow the simple-english skill (pragmatic mode).

## Review Focus

1. A user token still returns its login, so the active `gh` account stays
   trusted. Task 1 tests this.
2. A missing or invalid token still fails the check, and `labels setup` still
   stops. Task 1 tests both.
3. A `gh --version` failure stops before any API call. Task 1 adds this test.
4. With an App token, doctor shows the trust guidance, not `Ready`. Task 2 tests
   this.
5. A passing check with an empty message still shows `Ready` in doctor. Task 2
   tests this.

---

### Task 1: GitHub host check accepts App installation tokens

**Files:**

- Modify: `src/host/github-gh.ts` (`GitHubHost.checkCli`)
- Test: `src/host/github-gh.test.ts`
- Test: `src/cli/commands/labels/main.test.ts`

**Interfaces:**

- Consumes: `CommandRunner`, `commandOutput(result)`.
- Produces: `GitHubHost.checkCli(): Promise<HostCliCheck>`. It has no `login`
  for an App token.

- [ ] **Step 1: Update the `checkCli` tests in `src/host/github-gh.test.ts`**

  Replace `checkCli reports auth failure and stops before user lookup` with
  `checkCli stops when gh --version fails`. `gh --version` returns code 1,
  stderr `"not installed\n"`. Expect
  `{ ok: false, message: "gh --version failed: not installed" }` and calls
  `[["gh","--version"]]`.

  Update `checkCli reports the trimmed authenticated login`. Remove the
  `gh auth status` runner entry. Expect calls
  `[["gh","--version"],["gh","api","user","--jq",".login"]]`.

  Add `checkCli accepts a GitHub App installation token`:
  - Runner: `gh --version` ok; `gh api user` code 1, stderr
    `"HTTP 403: Resource not accessible by integration\n"`;
    `gh api installation/repositories` stdout `"1\n"`.
  - Expect `{ ok: true, message: <App-token message> }` with `deepEqual`, so no
    `login` key.
  - Expect calls `gh --version`, `gh api user --jq .login`, and
    `gh api installation/repositories --jq .total_count`.

  Add `checkCli names host.trustedAuthors when no token works`:
  - Runner: `gh --version` ok; `gh api user` code 1, stderr `"no token\n"`; the
    installation call code 1, stderr `"bad credentials\n"`.
  - Expect `ok: false` and the exact failure message, with `no token` and
    `bad credentials` as the outputs.

- [ ] **Step 2: Update `src/cli/commands/labels/main.test.ts`**

  The harness fails only `auth status` for the `"auth"` case. Remove the
  `auth status` branch. Fail both `api user --jq .login` and
  `api installation/repositories --jq .total_count` with `bad` when
  `fail === "auth"`. Keep the case name `auth`. The loop still expects exit 1,
  `/owned fake failure/` on stderr, and no writes.

- [ ] **Step 3: Run the tests and see them fail**

  Run:
  `node --test src/host/github-gh.test.ts src/cli/commands/labels/main.test.ts`
  Expected: the updated login test, the App-token test, the no-token test, and
  every labels test that reaches the host check fail. The version test already
  passes. It is a regression guard.

- [ ] **Step 4: Implement the new order in `GitHubHost.checkCli`**

  Order: `gh --version`, then `gh api user --jq .login`, then on failure
  `gh api installation/repositories --jq .total_count`. Use the exact messages
  from Global Constraints.

- [ ] **Step 5: Run the tests and see them pass**

  Run:
  `node --test src/host/github-gh.test.ts src/cli/commands/labels/main.test.ts`
  Expected: PASS.

- [ ] **Step 6: Commit**

  `git commit -m "fix(host): accept GitHub App installation tokens in the gh check (#317)"`

### Task 2: Doctor shows the host check message

**Files:**

- Modify: `src/cli/commands/doctor/checks.ts` (the `host CLI` check)
- Test: `src/cli/commands/doctor/checks.test.ts`

**Interfaces:**

- Consumes: `Host.checkCli()`.
- Produces: the `host CLI` doctor check message is `result.message` when it is
  not empty, else `Ready`.

- [ ] **Step 1: Add `a passing host CLI check shows its message`**

  Use the existing `fixture(t)`. Set
  `f.host.checkCli = async () => ({ ok: true, message: "app token guidance" })`.
  Expect `checks[0]` to have status `pass` and message `app token guidance`.
  Then set `message: ""` and expect message `Ready`.

- [ ] **Step 2: Run the test and see it fail**

  Run: `node --test src/cli/commands/doctor/checks.test.ts` Expected: FAIL. The
  message is `Ready`.

- [ ] **Step 3: Return the message on success**

  In the `host CLI` callback, return `{ ok: true, message: result.message }`
  when `result.message` is not empty, else `{ ok: true }`.

- [ ] **Step 4: Run the test and see it pass**

  Run: `node --test src/cli/commands/doctor/checks.test.ts` Expected: PASS.

- [ ] **Step 5: Commit**

  `git commit -m "feat(doctor): show the host check message on success (#317)"`

### Task 3: Document App installation tokens

**Files:**

- Modify: `site/src/content/docs/getting-started/configuration.md`
  (`Host and trust`)
- Modify: `site/src/content/docs/guides/providers.md` (`GitHub`)
- Modify: `site/src/content/docs/reference/environment-and-config.md`
  (`Pi environment`)
- Modify: `site/src/content/docs/using-patchmill/triage.md` (`Candidates`)

- [ ] **Step 1: Write the doc changes**
  - `configuration.md`: Patchmill accepts a GitHub App installation token in
    `GH_TOKEN`. With that token, only `host.login` and `host.trustedAuthors`
    give trust. List the bot login, for example `patchmill-e2e[bot]`, and the
    maintainer logins in `host.trustedAuthors`.
  - `providers.md`: an App installation token does not report a login. Link to
    `/getting-started/configuration/#host-and-trust`.
  - `environment-and-config.md`: GitHub also accepts `GH_TOKEN` with an App
    installation token. Link to the same section.
  - `triage.md`: with an App token, trust comes only from `host.login` and
    `host.trustedAuthors`.

- [ ] **Step 2: Lint**

  Run: `npm run lint` Expected: exit 0.

- [ ] **Step 3: Commit**

  `git commit -m "docs: describe GitHub App installation tokens (#317)"`

### Task 4: Full verification

- [ ] Run `npm test`. Expected: exit 0.
- [ ] Run `npm run lint`. Expected: exit 0.
- [ ] No npm dependency changes, so no Nix build is necessary.
- [ ] Optional manual check, only when an App installation token is available:
      with `GH_TOKEN` set to it, run `patchmill doctor` in a test repository.
      Expected: `[pass] host CLI` with the App-token message. Record the result
      in the pull request. If no token is available, say so in the pull request.

## Visual explanation

```text
Task 1  GitHubHost.checkCli + labels test  (src/host, src/cli/labels)  ─┐
Task 2  doctor host CLI message            (src/cli/doctor)            ─┼─ Task 4
Task 3  docs                               (site/)                     ─┘  npm test + lint
```

Tasks 1 to 3 are independent. Task 2 shows whatever message Task 1 returns, but
its test uses a fake host, so it does not need Task 1's code.

## Planning review

### Pass 1: combined spec and plan review

- **Scope:** specification and implementation plan together (no gates; start of
  implementation). Other document in scope: the spec.
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
- **Specification compared:** final spec body SHA-256
  `26c37ddac194572b74435f92610634a78ef473f8c33b10c16dfbb4643da56a47`.
- **Outcome:** `ready`.
