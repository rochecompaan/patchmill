# Parent Spec for Sub-issue Runs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use the sibling `executing-plans`
> skill to implement this plan inline, task by task. Steps use checkbox
> (`- [ ]`) syntax for tracking.

**Goal:** Give every planning and implementation session of a Sub-issue the path
of its Parent spec on the base branch, with a read-only rule. Show the Parent
spec in the console, the planning dialog, and run progress.

**Architecture:** A new `Host.parentIssue(issue)` method hides how each host
records a parent: the GitHub sub-issues API, or a leading `Part of #N` body line
on Forgejo/Gitea. `observe()` in the facts module applies the Parent spec rules
(one level, same repository, `origin/<base>` only, newest file) and adds an
optional `parentSpec` fact. The envelope, console, dialog, and progress modules
only display that fact. Phases, gates, and verification do not change.

**Tech Stack:** TypeScript on Node, `node:test`, `gh` and `tea` CLIs, Git.

**Spec:**
[docs/specs/2026-11-14-issue-364-use-a-parent-issue-s-spec-when-a-sub-issue-has-n-design.md](../specs/2026-11-14-issue-364-use-a-parent-issue-s-spec-when-a-sub-issue-has-n-design.md).
The spec has no mockup. Frontend design does not apply.

## Global Constraints

- Fact shape: `parentSpec?: { issue: number; path: string }`. Omit the field
  when there is no Parent spec.
- The Parent spec is the newest `isArtifactFile("spec", parent, name)` match in
  `config.paths.specsDir` on `origin/<baseBranch>`.
- One level only. Same repository only. No GitHub body fallback.
- A `parentIssue` error other than "no parent" propagates. The run stops with
  `needsInfo` and the error text.
- An issue without a Parent spec gets a byte-identical envelope:
  `src/kernel/fixtures/envelope-*.txt` must not change.
- Envelope Facts line, exactly (with `<base>` = `facts.baseBranch`):
  ``- Parent spec: <path> on origin/<base> (from issue #<N>; approved and read-only; read it with `git show origin/<base>:<path>`, because the worktree copy can be missing or old)``.
- No kernel check of Parent spec edits. No change to `derivePhase`,
  `planningWorkspace`, `verifyOutcome`, triage, or selection.
- No npm dependency changes. If any occur, run the Nix build too.

## Review Focus

1. A GitHub parent in another repository is ignored. This is tested in Task 1 by
   comparing `html_url` owner/repo with `issue.url`, case-insensitively.
2. A Forgejo body that starts with blank lines, or with `Part of #356.`, still
   matches. `part of #356` and a later-line match do not. This is tested in
   Task 1.
3. The Parent spec exists only on an unmerged branch or in the worktree, not on
   `origin/<base>`. Then there is no fact. This is tested in Task 2.
4. A sub-issue that has its own spec still gets `parentSpec`, and `specPath`
   stays its own spec. This is tested in Task 2.
5. A run-progress record written before this change, with no `parentSpec` key,
   still parses. A record with `parentSpec.path` = `../x.md` is rejected. This
   is tested in Task 4.

---

## File structure

| File                                                            | Change                                                         |
| --------------------------------------------------------------- | -------------------------------------------------------------- |
| `src/host/types.ts`                                             | `Host.parentIssue`.                                            |
| `src/host/github-gh.ts`, `src/host/github-gh.test.ts`           | Sub-issues API adapter.                                        |
| `src/host/forgejo-tea.ts`, `src/host/forgejo-tea.test.ts`       | `Part of #N` adapter.                                          |
| `test-support/fake-host.ts`                                     | `parents` and `parentError` state.                             |
| `src/kernel/facts.ts`, `src/kernel/facts.test.ts`               | `parentSpec` fact.                                             |
| `src/kernel/labels.test.ts`                                     | Stub host gains `parentIssue`.                                 |
| `src/kernel/run-once-failures.test.ts`                          | Lookup error ends in `needsInfo`.                              |
| `src/kernel/run-envelope.md`, `src/kernel/envelope.ts`, test    | Facts line and planning rule.                                  |
| `src/kernel/console.ts`, `src/kernel/console.test.ts`           | "Parent specification" artifact item.                          |
| `src/kernel/launch.ts`, `src/kernel/interactive-loop.ts`        | `planningReview.parentSpec`.                                   |
| `src/console/planning-dialog*.ts`, `planning-dialog.test.ts`    | Parent line in the dialog.                                     |
| `src/kernel/run-progress.ts`, `src/kernel/run-progress.test.ts` | `parentSpec` in progress facts.                                |
| `skills/patchmill-planning/SKILL.md`, `.patchmill/skills/**`    | "Parent spec" section, refreshed through `skills update`.      |
| Docs                                                            | `agent-workflow-lifecycle.md`, `docs/agents/issue-tracker.md`. |

---

### Task 1: `Host.parentIssue` adapters

**Files:**

- Modify: `src/host/types.ts`, `src/host/github-gh.ts`,
  `src/host/forgejo-tea.ts`, `test-support/fake-host.ts`,
  `src/kernel/facts.test.ts` (stub host), `src/kernel/labels.test.ts` (stub
  host)
- Test: `src/host/github-gh.test.ts`, `src/host/forgejo-tea.test.ts`

**Interfaces:**

- Produces: `Host.parentIssue(issue: Issue): Promise<number | undefined>` with
  doc comment
  `/** Same-repository parent issue number, or undefined when there is none. */`.
  `FakeHostState` gains `parents?: Record<string, number>` (key: issue number)
  and `parentError?: string`. The fake's `parentIssue` records the call
  `parentIssue`, throws `new Error(parentError)` when that is set, and returns
  `parents[String(issue.number)]`.

- [ ] **Step 1: Write failing GitHub tests** in `src/host/github-gh.test.ts`,
      with the existing fake-runner style. The issue under test has
      `url: "https://github.com/Owner/Repo/issues/357"`.
  - `parent lookup returns the same-repository parent`: the runner expects
    `["api", "repos/{owner}/{repo}/issues/357/parent"]` and returns
    `{"number":356,"html_url":"https://github.com/owner/repo/issues/356"}`.
    Expect `356`.
  - `parent lookup treats only "No parent issue found" as no parent`: exit code
    1 with stderr `gh: No parent issue found (HTTP 404)` gives `undefined`. Exit
    code 1 with stderr `gh: Not Found (HTTP 404)` rejects with
    `CommandFailedError`.
  - `parent lookup ignores a parent in another repository`: `html_url` is
    `https://github.com/other/repo/issues/5`. Expect `undefined`.
  - `parent lookup rejects a malformed response`: `{"number":"x"}` and a missing
    `html_url` both reject with `gh api parent returned an invalid parent`.
  - `parent lookup rejects an issue without an issue URL`: `issue.url` is
    `https://github.com/owner/repo`. The method rejects before it calls `gh`,
    and the runner gets no calls.
- [ ] **Step 2: Write failing Forgejo tests** in `src/host/forgejo-tea.test.ts`.
      Use the `fixture()` helper and assert that the runner gets no calls.
  - `Part of #356` gives `356`.
  - `"\n\nPart of #356.\nMore"` gives `356`.
  - `part of #356`, `See #1\nPart of #356`, `""`, and `Part of #357` on issue
    357 give `undefined`.
- [ ] **Step 3: Run**
      `node --test src/host/github-gh.test.ts src/host/forgejo-tea.test.ts`.
      Expected: the new tests FAIL because `parentIssue` is not a function.
- [ ] **Step 4: Implement.**
  - GitHub: use `this.gh` (not `ghOk`). A non-zero exit whose `stdout + stderr`
    contains `No parent issue found` returns `undefined`. Any other non-zero
    exit throws `CommandFailedError`. Parse with
    `parseJson(stdout, "gh api parent")`. Read `owner/repo` from the `html_url`
    path and from `issue.url` with the pattern `^/([^/]+)/([^/]+)/issues/\d+$`,
    and compare them lowercased.
  - Forgejo: read the first non-empty line of `issue.body.trimStart()` and match
    `/^Part of #(\d+)\b/`. Return `undefined` for a self-reference or a value
    that is not a positive safe integer.
  - Add the method to the fake host and to the stub hosts in `facts.test.ts` and
    `labels.test.ts` (`parentIssue: async () => undefined`).
- [ ] **Step 5: Run** the Step 3 command and `npm run lint:ts`. Expected: PASS
      with no type errors.
- [ ] **Step 6: Commit** `feat(host): read a sub-issue's parent issue (#364)`.

### Task 2: `parentSpec` fact

**Files:**

- Modify: `src/kernel/facts.ts`
- Test: `src/kernel/facts.test.ts`, `src/kernel/run-once-failures.test.ts`

**Interfaces:**

- Consumes: `Host.parentIssue` (Task 1), `refArtifacts()`.
- Produces: `Facts.parentSpec?: { issue: number; path: string }`. The path is
  relative to the worktree and uses the configured `specsDir`, like `specPath`.

- [ ] **Step 1: Write failing tests** in `src/kernel/facts.test.ts`. Let
      `setup()` accept a `parentIssue` override for the stub host. Seed specs
      with the existing seed-clone pattern and push them to `origin/main`.
  - `a parent spec on base becomes the parentSpec fact`: the parent is 5, and
    `custom/specs/2026-10-01-issue-5-p-design.md` is on main. Expect
    `parentSpec` to deep-equal
    `{ issue: 5, path: "custom/specs/2026-10-01-issue-5-p-design.md" }`, and
    `specPath` to be `undefined`.
  - `the newest parent spec on base wins`: add `2026-10-02-issue-5-q-design.md`.
    Expect that path.
  - `a parent spec only on a branch is not a parentSpec`: the parent spec is
    pushed only to `agent/issue-5-p`. Expect no `parentSpec` key.
  - `an own spec keeps specPath and still reports the parent spec`: issue 9 has
    its own spec on its branch, and the parent spec is on main. Expect both
    fields with their own paths.
  - `no parent means no parentSpec and the host is asked once`: assert that the
    key is absent and that the stub records exactly one call per `collectFacts`.
  - `a child branch created before the parent spec merged still reports it`:
    push `agent/issue-9-x` from main first, then push the parent spec to main.
    `c.provision()` checks the worktree out from `origin/agent/issue-9-x`. It
    reports the parent spec path, and that file is absent from the worktree. The
    envelope (Task 3) tells the agent to read it from the ref.
  - Extend `fetch, host and non-missing filesystem errors stay visible`: a
    `parentIssue` that throws `parent boom` makes `provisionWorkspace` reject
    with `parent boom`.
- [ ] **Step 2: Write a failing run-once test** in
      `src/kernel/run-once-failures.test.ts`:
      `a parent lookup failure stops with needs-info and its message`. Use the
      fake host with `parentError: "parent boom"`. Expect the `needsInfo`
      outcome, a summary that contains `parent boom`, and no Pi start.
- [ ] **Step 3: Run**
      `node --test src/kernel/facts.test.ts src/kernel/run-once-failures.test.ts`.
      Expected: the new tests FAIL.
- [ ] **Step 4: Implement** in `observe()`, after `specPath` and `planPath` are
      found. Call `deps.host.parentIssue(issue)`. If there is a parent, call
      ``refArtifacts(git, worktree, `origin/${baseBranch}`, parent).find(config.paths.specsDir, "spec")``.
      Spread `parentSpec` only when the path is found. Do not use the parent
      spec in the merged-gate check.
- [ ] **Step 5: Run** the Step 3 command, then `npm test`. Expected: PASS. The
      existing `deepEqual` facts tests do not change.
- [ ] **Step 6: Commit**
      `feat(kernel): observe a sub-issue's parent spec (#364)`.

### Task 3: Envelope

**Files:**

- Modify: `src/kernel/run-envelope.md`, `src/kernel/envelope.ts`
- Test: `src/kernel/envelope.test.ts`

**Interfaces:**

- Consumes: `Facts.parentSpec` (Task 2).

- [ ] **Step 1: Write failing tests.**
  - `a parent spec adds a read-only fact after the Spec line`: with
    `parentSpec: { issue: 356, path: "docs/specs/p-design.md" }`, the text
    contains
    `- Spec: expected: docs/specs/2026-10-15-issue-9-x-design.md\n- Parent spec: docs/specs/p-design.md on origin/main (from issue #356; approved and read-only; read it with`
    followed by
    `` `git show origin/main:docs/specs/p-design.md`, because the worktree copy can be missing or old)\n- Plan:``,
    joined by one space.
  - `planning with a parent spec states the parent spec rules`: the unattended
    planning text contains
    `The parent spec is the approved design for this issue.` and
    ``stop and return `needs-input` ``. The interactive planning text contains
    `ask the maintainer in this chat` and not
    ``stop and return `needs-input` ``. The interactive text already has "Do not
    return `needs-input` for questions", so assert on the longer phrase.
  - `implementation with a parent spec shows the fact and one stop rule`: the
    text contains the Parent spec line and
    `If the parent spec must change, do not change it; stop and return`, and not
    `The parent spec is the approved design`.
  - The existing fixture test `the non-interactive envelope is unchanged`
    continues to pass without any fixture edits.
- [ ] **Step 2: Run** `node --test src/kernel/envelope.test.ts`. Expected: the
      new tests FAIL.
- [ ] **Step 3: Implement.** In the template, write
      `- Spec: {{spec}}{{parentSpec}}`. `parentSpec` renders as `""` or as
      `"\n"` plus the Global Constraints line. Add a `{{parentSpecRules}}`
      placeholder directly after `{{planningRules}}`. It is `""` when there is
      no `parentSpec`. In the implementation phase it is
      `"\n\nIf the parent spec must change, do not change it; <ask>."`. In the
      planning phase it is `"\n\n"` plus this paragraph:

      > The parent spec is the approved design for this issue. Do not change
      > it. If this issue has no spec yet, write it at the Spec path. Link to
      > the parent spec, name the parent sections this issue delivers, and
      > record only decisions the parent spec leaves open. If there are none,
      > say so. If the parent spec is wrong or conflicts with this issue,
      > `<ask>` instead of choosing.

      `<ask>` is `ask the maintainer in this chat` when `interactivePlanning`
      is true. Otherwise it is ``stop and return `needs-input` ``. Interactive
      implementation uses the unattended wording, because its envelope keeps
      the JSON result contract. The template
      must stay under 150 lines.

- [ ] **Step 4: Run** the Step 2 command. Expected: PASS.
- [ ] **Step 5: Commit**
      `feat(kernel): show the parent spec in the run envelope (#364)`.

### Task 4: Console, planning dialog, and run progress

**Files:**

- Modify: `src/kernel/console.ts`, `src/kernel/launch.ts`,
  `src/kernel/interactive-loop.ts`, `src/console/planning-dialog.ts`,
  `src/console/planning-dialog-facts.ts`, `src/kernel/run-progress.ts`
- Test: `src/kernel/console.test.ts`, `src/console/planning-dialog.test.ts`,
  `src/kernel/run-progress.test.ts` (also add `parentSpec: null` to its typed
  `record` fixture), `src/console/planning-approval.test.ts`

**Interfaces:**

- Consumes: `Facts.parentSpec` (Task 2).
- Produces:
  `PhaseLaunch.planningReview.parentSpec?: { issue: number; path: string }`,
  `PlanningDialogFacts.parentSpec?` with the same type, and
  `RunProgress.facts.parentSpec: { issue: number; path: string } | null`.

- [ ] **Step 1: Write failing tests.**
  - Console: `artifacts list the parent specification before the specification`.
    With both facts set, the rendered Artifacts section lists the item "Parent
    specification" with the details `docs/specs/p-design.md` and `from #356`,
    before "Specification". Without `parentSpec`, the existing output does not
    change.
  - Dialog: `a parent spec appears above the spec`. The title contains the two
    lines `Parent   docs/specs/p-design.md (#356)` and
    `Spec     docs/specs/polls-design.md`, in that order, each with two leading
    spaces. Add a narrow-viewport case that truncates the parent line with `…`,
    as `fitLine` does.
  - Progress: `projectRunProgress` maps `parentSpec` to the same object, or to
    `null` when absent. `parseRunProgress` accepts a record with no `parentSpec`
    key and returns `parentSpec: null`. It rejects `{ issue: 0, path: "a.md" }`
    and `{ issue: 5, path: "../x.md" }`.
  - Pass-through: extend `src/console/planning-approval.test.ts` so that a
    launch with `planningReview.parentSpec` produces a dialog title with the
    Parent line.
- [ ] **Step 2: Run**
      `node --test src/kernel/console.test.ts src/console/planning-dialog.test.ts src/kernel/run-progress.test.ts src/console/planning-approval.test.ts`.
      Expected: the new tests FAIL.
- [ ] **Step 3: Implement.**
  - Console: the Artifacts item gets two details: the path with role `path`,
    then `from #<N>` with no role.
  - `interactive-loop.ts` copies `facts.parentSpec` into `planningReview`.
    `collectPlanningDialogFacts` passes it through unchanged. It does not search
    the worktree for it.
  - The dialog line is the text `Parent   <path> (#<N>)` with the same two-space
    indent as the Spec line, passed through `fitLine(…, width)`.
  - Progress validation uses `artifactPath` and
    `Number.isSafeInteger(issue) && issue > 0`.
- [ ] **Step 4: Run** the Step 2 command, then `npm test`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(console): show a sub-issue's parent spec (#364)`.

### Task 5: Planning skill and documentation

**Files:**

- Modify: `skills/patchmill-planning/SKILL.md`,
  `site/src/content/docs/reference/agent-workflow-lifecycle.md`,
  `docs/agents/issue-tracker.md`
- Generate: `.patchmill/skills/patchmill-planning/SKILL.md`,
  `.patchmill/skills/patchmill-skill-pack.json`

- [ ] **Step 1:** Add a `## Parent spec` section to the planning skill, after
      "Planning stages". Write it in Simplified Technical English. Include:
  - the three maintainer rules from the spec;
  - read the Parent spec before brainstorming, and do not ask what it answers;
  - keep the parent's terms;
  - list the Parent spec as a plan input;
  - give the Parent spec to the fresh plan reviewer;
  - read it with `git show origin/<base>:<path>`, because the worktree copy can
    be missing or old.
- [ ] **Step 2:** Add a "Sub-issues" section to `agent-workflow-lifecycle.md`.
      It covers the GitHub sub-issues link, the Forgejo/Gitea first-line
      `Part of #N` link, the base-branch rule, one level only, and the child
      spec rules. In `docs/agents/issue-tracker.md`, add one sentence under
      Wayfinding: on GitHub, Patchmill runs read only native sub-issues as the
      parent link, so the `Part of #<map>` fallback gives no Parent spec.
- [ ] **Step 3: Run** `node bin/patchmill.ts skills update`. Then run
      `git status --short .patchmill`. Expected: only
      `.patchmill/skills/patchmill-planning/SKILL.md` and
      `patchmill-skill-pack.json` change. Run
      `diff -r skills/patchmill-planning .patchmill/skills/patchmill-planning`.
      Expected: no output. Run `node bin/patchmill.ts skills update` again.
      Expected: no further changes.
- [ ] **Step 4: Run** `npm run lint` and the skill-pack tests
      `node --test src/cli/commands/init/skill-installer.test.ts src/cli/commands/skills/main.test.ts src/console/skills.test.ts`.
      Expected: PASS. Do not add tests that assert document text.
- [ ] **Step 5: Commit**
      `docs(skills): plan sub-issues against their parent spec (#364)`.

### Final verification

- [ ] Run `npm test`, `npm run lint`, and `npm run build`. All must pass.
- [ ] Run
      `git diff origin/main --stat -- package.json package-lock.json npm-shrinkwrap.json`.
      Expected: no output. If it is not empty, also run `nix build`.
- [ ] Manual check: run
      `gh api repos/rochecompaan/patchmill/issues/357/parent --jq .number` and
      confirm that it prints `356`. This confirms the live endpoint shape that
      the adapter test uses.

## Plan review

**Initial review:** a fresh canonical `reviewer` (claude-opus-5-5, high
thinking) reviewed commit `b5e5d3f` against base `5be867e`. It inspected
`facts.ts`, `artifact-source.ts`, `git.ts`, `run-once.ts`, `envelope.ts`, the
host adapters, the fake host, the console, the dialog, progress, and the skill
installer. It made read-only live `gh api` calls for #357 and #364.

**Architecture survey:** the facts module owns the Parent spec rules. The host
adapters own how a parent link is read: an API on GitHub, the issue body on
Forgejo. The two production adapters make this a real seam. The display modules
only show the fact. `deps.host` injects the dependency. There are no ADRs and no
conflicts.

**Findings and dispositions:**

- **B1 (blocker, accepted):** the Parent spec comes from `origin/<base>`, but an
  existing issue branch is never rebased. The worktree copy can thus be missing
  or old. Fix: the envelope line names `origin/<base>` and tells the agent to
  use `git show`. The spec's evidence bullet is corrected. Task 2 adds a test in
  which the child branch exists before the parent spec lands.
- **S1 (accepted):** the implementation envelope gets a one-sentence stop rule.
- **S2 (accepted):** the GitHub tracker guide and the glossary now say that only
  native sub-issues link a parent on GitHub.
- **S3 (accepted):** the spec now uses the `html_url` comparison with
  `issue.url`. It also says what happens when `issue.url` is malformed.
- **S4, S5, S6 (accepted):** Task 4 updates the typed progress fixture, adds a
  pass-through test in `planning-approval.test.ts`, and states the dialog line
  width.
- **S7 (noted):** the adapter files are near the module-size limit. This change
  adds about 20 lines to each, so no split is planned. The base has moved, but
  none of the planned source files changed.

**Scoped confirmation:** a second fresh `reviewer` (same model) checked commit
`292e525`. B1 is resolved, and the corrections add no blocker. It found one
older defect: the interactive envelope already contains "Do not return
`needs-input`", so a negative assertion on ``return `needs-input` `` could never
pass. Fixed: the test asserts on ``stop and return `needs-input` ``. These
test-only suggestions were also accepted: the B1 test uses `provisionWorkspace`,
a malformed `issue.url` test is added, the split expected string is joined
explicitly, and the skill names the `git show` route. These edits change no task
or architecture, so no further review is needed.

**Inspection limits:** no tests were run, because there is no implementation
yet. GitHub Enterprise behaviour without the sub-issues API was not checked.
