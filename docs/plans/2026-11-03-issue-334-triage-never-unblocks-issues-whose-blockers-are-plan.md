# Native Issue Dependencies Implementation Plan

> **For agentic workers:** Use executing-plans to implement this approved change
> inline, task by task, test first. Steps use checkbox (`- [ ]`) syntax for
> tracking.

**Goal:** Replace the `blocked` triage label with the trackers' native issue
dependencies, so blocked issues become eligible when their blockers close.

**Architecture:** Two new Host operations read and add native dependencies. One
async selection function gates every run entry point. Triage returns
`blockedBy`, and the kernel adds missing links before it applies the ready
label. Labels keep describing suitability and lifecycle only.

**Tech Stack:** TypeScript, `node:test`, existing `gh` and `tea` adapters,
FakeHost, fake Pi fixtures.

**Spec:**
`docs/specs/2026-11-03-issue-334-triage-never-unblocks-issues-whose-blockers-are-design.md`

## Global Constraints

- No automatic migration, no `Blocked by:` comment parsing, no link removal, no
  cross-repository link creation.
- A failed or incomplete dependency read rejects. It never reads as "no
  dependencies".
- Every run entry point uses `selectRunIssue`. `--issue N` keeps its label
  override but gets no dependency override.
- Dry runs write nothing to the host.
- Keep the triage skill read-only. Keep both skill copies and the manifest in
  sync through the installer.
- No npm dependency changes. Do not rewrite historical specs.

## Review Focus

- A later page of a dependency read fails: the read rejects, and selection warns
  and skips (Tasks 1 and 2).
- Another repository's issue `#1` is linked and triage proposes local `#1`: the
  local link is still added (Tasks 1 and 3).
- `--issue N` on an in-progress issue with an open blocker: refused, no claim
  (Task 2).
- A link write fails after the first of two links: no label applied, the first
  link stays, the next run adds only the second (Task 3).
- Reopening a closed blocker: the issue is skipped again on the next selection
  (Task 2).

### Task 1: Native dependency operations on both hosts

**Files:** `src/host/types.ts`, `src/host/github-gh.ts`,
`src/host/forgejo-tea.ts`, `test-support/fake-host.ts`, their existing tests,
and every typed `Host` literal the type check reports
(`src/kernel/facts.test.ts`, `src/kernel/labels.test.ts`).

**Interfaces:**

```ts
// src/host/types.ts
export type IssueDependency = {
  repository: string; // owner/repo
  number: number;
  state: Issue["state"];
};
// Host gains:
listIssueDependencies(n: number): Promise<IssueDependency[]>;
addIssueDependency(n: number, blocker: number): Promise<void>;
```

- [ ] Write failing adapter tests with `recordingRunner`. GitHub:
      `listIssueDependencies(9)` calls
      `gh api --paginate --slurp repos/{owner}/{repo}/issues/9/dependencies/blocked_by?per_page=100`
      and maps `number`, `state`, and `repository_url`
      (`https://api.github.com/repos/owner/repo` becomes `owner/repo`).
      `addIssueDependency(9, 1)` reads `repos/{owner}/{repo}/issues/1` for its
      `id`, then calls
      `gh api --method POST repos/{owner}/{repo}/issues/9/dependencies/blocked_by -F issue_id=<id>`.
      Forgejo: the read pages
      `/repos/{owner}/{repo}/issues/9/dependencies?page=N&limit=50` through the
      existing `pages` helper and maps `repository.full_name`; the add calls
      `tea api /repos/{owner}/{repo}/issues/9/dependencies --method POST -d '{"owner":"owner","repo":"repo","index":1}'`
      through `scoped`. For both: a nonzero exit, invalid JSON, a non-array
      page, or an entry without a number, state, or repository rejects; a
      complete empty response returns `[]`.
- [ ] Run `node --test src/host/github-gh.test.ts src/host/forgejo-tea.test.ts`.
      Expect failures for the missing methods.
- [ ] Implement both adapters inside their existing classes using `ghOk`,
      `pages`, and `scoped`. Add
      `dependencies: Record<string, IssueDependency[]>` to `FakeHostState`
      (default `{}`, keyed by issue number). FakeHost's read returns the stored
      entries and, for entries in the fake repository whose issue exists, takes
      `state` from that issue, so closing or reopening it changes the next read.
      Its add appends a missing entry and is a no-op for a duplicate. Record
      calls as `listIssueDependencies:9` and `addIssueDependency:9:1`.
- [ ] Run the adapter tests and `npm run check:types`. Expect both to pass.
- [ ] Commit: `feat(host): read and add native issue dependencies`.

### Task 2: One dependency gate for every run entry point

**Files:** `src/kernel/issue-selection.ts`, `src/kernel/run-once.ts`,
`src/cli/commands/run-once/main.ts`, new `src/kernel/issue-selection.test.ts`,
`src/kernel/run-once.test.ts`, `src/cli/commands/run-once/main.test.ts`,
`site/src/content/docs/using-patchmill/run-once.md`.

**Interfaces:**

```ts
// src/kernel/issue-selection.ts; selectIssue stays as the pure label helper.
export type RunIssueSelection =
  | { kind: "selected"; issue: Issue }
  | { kind: "none" }
  | { kind: "refused"; issue: number; reason: string };
export async function selectRunIssue(input: {
  host: Host;
  labels: LabelsConfig;
  issue?: number;
  warn: (issue: number, message: string) => void;
}): Promise<RunIssueSelection>;
```

- [ ] Write failing selection tests with FakeHost. Ready issue 9 (older) and 10:
      with 9 blocked by open local `#1`, or by open `other/project#1`, or with a
      rejecting read, select 10; the rejecting read also warns. With all of 9's
      dependencies closed, select 9. Explicit 9 with an open blocker returns
      `refused` with a reason naming `#1`; explicit 9 with a rejecting read
      returns `refused` with the error. Close issue 1 in fake state and assert 9
      is selected with no `setLabels:` or `commentIssue:` calls; reopen it and
      assert 9 is skipped; delete the link from fake state and assert 9 is
      selected. Keep the existing missing-or-closed refusal and the oldest-first
      order.
- [ ] Write failing run and CLI tests. With `setupRun` and
      `c.host.listIssueDependencies` returning an open blocker:
      `run({ issue: 9 })` and `run({ issue: 9, dryRun: true })` return
      `refused`, make no `setLabels:` call, and leave no worktree and no
      `pi.pid`. Repeat for issue 9 labelled in-progress. In the CLI tests,
      `--interactive` with a blocked or unreadable target prints the reason,
      returns 1, and never calls `startConsole`.
- [ ] Run
      `node --test src/kernel/issue-selection.test.ts src/kernel/run-once.test.ts src/cli/commands/run-once/main.test.ts`.
      Expect failures.
- [ ] Implement `selectRunIssue`: list issues as today, apply `selectIssue` for
      the explicit case, otherwise walk the label-eligible issues oldest first
      and read each one's dependencies until one has none open. Replace the
      `listRunIssues` and `selectIssue` block at the top of `runOneIssue` with
      it, mapping `none` and `refused` to the existing outcomes. Use it in the
      CLI's interactive branch for both automatic and explicit issues. Add a
      sentence on dependency gating to the run-once guide.
- [ ] Run the Task 2 tests plus
      `node --test src/kernel/run-once-failures.test.ts src/kernel/interactive-planning.test.ts src/console/start.test.ts`.
      Expect all to pass.
- [ ] Commit: `feat(kernel): gate runs on native issue dependencies`.

### Task 3: Triage contract, retired label, and docs

**Files:** `src/kernel/triage.ts`, `src/kernel/envelope.ts`,
`src/kernel/triage-envelope.md`, `src/cli/commands/triage/progress-output.ts`,
`src/config/config.ts`, `src/kernel/labels.ts`, `patchmill.config.json`,
`skills/patchmill-issue-triage/SKILL.md`, the installed copy and manifest under
`.patchmill/skills/`, their tests (`triage`, `envelope`, `config`, `labels`,
`labels/main`, `triage/output`), `README.md`, `docs/agents/triage-labels.md`,
and the site's `triage.md`, `workflow-labels.md`, `configuration.md`, and
`configuration-example.md`.

**Interfaces:**

```ts
// src/kernel/triage.ts
export type TriageResult = {
  label: string;
  comment: string;
  blockedBy: number[];
};
// The "triaged" TriageProgressEvent gains blockedBy: number[]
// (links added, or links to add in a dry run).
// src/kernel/envelope.ts: TriageEnvelopeInput gains dependencies: IssueDependency[].
```

- [ ] Write failing tests. Config: `parseConfig({ labels: { blocked: "old" } })`
      has no `blocked` key; `{ labels: { blocked: false } }` throws
      `ConfigError`; `labelCatalog` has five entries, and provisioning through
      FakeHost creates no `blocked` label. Validator: accept `blockedBy: []`
      with each outcome and `[1, 2]` with ready; reject `[9]` for issue 9,
      `[1, 1]`, `[0]`, `[1.5]`, `["1"]`, a missing field, a non-empty array with
      needs-info, and a `blocked` label. Orchestrator with fake Pi: a ready
      result with `blockedBy: [1, 2]` where `#1` is already linked makes exactly
      `addIssueDependency:9:2` before `setLabels:9`; the rendered prompt lists
      the existing link; a rejecting `addIssueDependency` leaves no `setLabels:`
      or `commentIssue:` call and does not stop the next candidate; a rejecting
      dependency read warns and skips without starting Pi; dry run makes no host
      writes. Envelope: the issue data shows
      `Dependencies: owner/repo#1 (closed)` or `none`. Progress output prints
      `dependencies added: #2` when applied and `dependencies to add: #2` in a
      dry run.
- [ ] Run
      `node --test src/config/config.test.ts src/kernel/labels.test.ts src/kernel/envelope.test.ts src/kernel/triage.test.ts src/cli/commands/labels/main.test.ts src/cli/commands/triage/output.test.ts`.
      Expect failures.
- [ ] Implement. Remove `blocked` from `LabelsConfig`, `DEFAULT_CONFIG`, the
      schema, `labelCatalog`, `patchmill.config.json`, and the envelope; add
      `labels.blocked` to the retired-key regex in `parseConfig`. In
      `runTriage`, read dependencies before rendering the envelope, extend
      `validateResult` to the three-field contract, add each missing link
      (matched on lower-cased repository and number) before `setLabels`, and
      include `blockedBy` in the progress event. Rewrite the skill's outcome and
      result sections for three outcomes plus `blockedBy`, then refresh the
      installed copy and manifest with the existing installer:
      `node --input-type=module -e 'import { installSkills } from "./src/cli/commands/init/skill-installer.ts"; await installSkills({ repoRoot: process.cwd(), skillDir: ".patchmill/skills", packageRoot: process.cwd() });'`.
      Check that the diff touches only the triage skill and manifest.
- [ ] Update the docs: three outcomes, ready means suitable, native links gate
      runs, eligibility returns when the last blocker closes, the manual upgrade
      steps from the spec, and the retired config key. Remove the `blocked` row
      and the "no automatic recheck" sentence.
- [ ] Run the Task 3 tests plus
      `node --test src/cli/commands/init/skill-installer.test.ts src/cli/commands/init/main.test.ts`.
      Expect all to pass.
- [ ] Commit:
      `feat(triage): replace the blocked label with native dependencies`.

## Final verification

- [ ] `npm test`, `npm run lint`, `npm run build`, and
      `npm --prefix site run build` pass.
- [ ] `grep -rn blocked src README.md docs/agents site/src/content/docs skills`
      shows only the worker-guidance `blocked` state, the GitHub `blocked_by`
      path, and the retired-key handling.
- [ ] Push the issue branch. The spec and plan ship with the implementation PR;
      do not open a separate planning PR.
