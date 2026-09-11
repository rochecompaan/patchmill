# Planning Pull Request Migration and Documentation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete the `planning-pr-v1` migration with deterministic
compatibility warnings, synchronized planning-skill guidance, current user
documentation, and provider-complete end-to-end recovery evidence.

**Architecture:** Keep deprecation policy in one pure CLI presentation module
and emit it only at command entry points, leaving issue #189's planning/legacy
router as the sole workflow selector. Update the canonical planning skill first,
use the existing managed-skill updater to synchronize installed bytes and
metadata, and organize current docs around planning review gates and strict
recovery. Replace the issue #189 Forgejo-only facade recording test with
provider-specific process fixtures behind a shared real-Git scenario harness so
gate and recovery assertions run identically for GitHub and Forgejo.

**Tech Stack:** TypeScript, Node.js 24, Node's `node:test` runner, Git CLI with
a temporary bare remote, GitHub `gh` and Forgejo `tea` process fixtures, JSON
skill-pack metadata with SHA-256, Astro/Starlight Markdown documentation,
Prettier, markdownlint, ESLint, strict TypeScript, dependency-cruiser, npm, and
Nix.

**Spec:**
`docs/specs/2026-09-11-issue-190-migrate-and-document-the-planning-pull-request-workflow-design.md`

## Global Constraints

- Begin implementation only from a target base that contains issue #189's
  integrated router, phase coordinator, implementation pull-request validation,
  durable finish path, and compatibility tests. If
  `src/cli/commands/run-once/planning-pipeline.ts`,
  `planning-phase-coordinator.ts`, and
  `planning-pipeline-facade-recording.test.ts` are absent, update/rebase the
  implementation base; do not recreate issue #189 in this issue.
- Fresh eligible issues and valid active `planning-pr-v1` state use only the
  planning pipeline. Only unfinished legacy Run recovery state uses the legacy
  pipeline. Conflicting, malformed, or unsupported state blocks without
  fallback.
- Keep the immutable per-Issue-run gate snapshot. `--plan-only` must not change
  it, imply approval, select the legacy route for fresh work, or bypass an open
  planning review.
- A required planning phase advances only after the exact saved pull request is
  merged and verified on the saved target base. Missing, ambiguous, and
  closed-unmerged planning pull requests remain blocking and are never replaced
  automatically.
- The implementation phase always ends in an independently validated open,
  issue-closing pull request. Direct landing remains disabled for
  `planning-pr-v1` regardless of repository policy.
- Preserve exact lock, repository, branch, object, state revision, and workspace
  ownership checks before state mutation or cleanup. Do not add automatic stale
  lock removal, takeover, force update, reset, clean, rebase, merge, or remote
  branch deletion.
- Keep `set-spec`, `set-plan`, `--plan-only`, legacy artifact comments, legacy
  approval labels, legacy state, and legacy reset behavior available during the
  compatibility window. Do not change established stdout, result shapes, exit
  codes, checksums, confirmations, or side effects except for the required
  stderr warnings and help text.
- Keep `workflow.specApproval` and `workflow.planApproval` property names. In
  current prose call their `required` values review-gate settings; their label
  fields are compatibility data for unfinished legacy runs.
- Keep provider command encoding in provider fixtures and all scenario support
  out of production modules. Shared scenario tests assert provider-neutral gate,
  state, recovery, and cleanup behavior.
- Add no provider contract, configuration key, npm dependency, or Superpowers
  pin change. Keep every package, lock, metadata source, and installed upstream
  reference on Superpowers `v6.3.0`.
- Advance only the Patchmill recommended skill-pack version from `2026.07.2` to
  `2026.09.1` and add the matching range notice.
- Keep production modules focused: prefer a pure helper plus CLI shells, and
  split scenario fixture responsibilities before a file grows substantially
  beyond roughly 200 meaningful lines. Test files may be larger when their
  sections and fixtures remain explicit.
- Do not modify historical specs or plans while updating documentation. Do not
  commit `.pi/todos` or any local todo file.
- If npm dependency metadata changes unexpectedly, reconcile `package.json`,
  `package-lock.json`, and `npm-shrinkwrap.json` before rerunning npm and Nix
  verification. Both Nix commands in Task 8 are required even when dependency
  metadata does not change.

## Required Preflight

Before Task 1, update the implementation worktree's base and prove issue #189 is
present:

```sh
git fetch origin main
git rebase origin/main
test -f src/cli/commands/run-once/planning-pipeline.ts
test -f src/cli/commands/run-once/planning-phase-coordinator.ts
test -f src/cli/commands/run-once/planning-pipeline-facade-recording.test.ts
node --test \
  src/cli/commands/run-once/planning-phase-coordinator.test.ts \
  src/cli/commands/run-once/planning-pipeline-facade.test.ts \
  src/cli/commands/run-once/planning-pipeline-facade-recording.test.ts
```

Expected: all files exist and the issue #189 baseline tests pass. If the fetched
target base still lacks them, stop and update the base rather than copying or
cherry-picking predecessor implementation into this issue.

## File and Module Map

### CLI compatibility presentation

- Create `src/cli/legacy-planning-deprecations.ts` as the pure owner of warning
  and help copy for `set-spec`, `set-plan`, and `--plan-only`.
- Create `src/cli/legacy-planning-deprecations.test.ts` for exact stable,
  content-free copy and public entry-point output separation.
- Modify `src/cli/main.ts` and `src/cli/main.test.ts` to mark legacy artifact
  setters deprecated in top-level help without emitting a runtime warning for
  help.
- Modify `src/cli/commands/set-artifact/main.ts` and `main.test.ts` to warn once
  before validation/configuration/publication while retaining legacy behavior.
- Modify `src/cli/commands/run-once/main.ts`, `args.test.ts`, and the new public
  entry-point test to warn for `--plan-only` without contaminating stdout.
- Modify `src/cli/commands/run/reset/main.ts` and `main.test.ts` to warn once
  for forwarded `--plan-only`; leave reset routing in the legacy pipeline.
- Extend issue #189 coordinator/facade tests only to prove review precedence,
  immutable state, and fresh-versus-legacy routing under `--plan-only`.

### Planning skill pack

- Modify canonical `skills/patchmill-planning/SKILL.md` first.
- Regenerate installed `.patchmill/skills/patchmill-planning/SKILL.md` and
  `.patchmill/skills/patchmill-skill-pack.json` through the existing updater.
- Modify `src/workflow/skill-pack.ts` and `skill-pack.test.ts` for version
  `2026.09.1` while preserving membership and Superpowers source.
- Modify `src/cli/commands/skills/update.ts` and `update.test.ts` for one
  `2026.09.1` range notice.
- Verify, but do not change unless inconsistent, `patchmill.config.json`, npm
  package/lock metadata, `THIRD_PARTY_NOTICES.md`, installed upstream sibling
  skills, and existing skill metadata.

### Domain and current documentation

- Modify `CONTEXT.md` with the three approved domain terms.
- Modify the nine current site pages named by the spec; keep historical specs
  and plans unchanged.
- Put fresh `planning-pr-v1` guidance first. Put setters, artifact comments,
  approval-label authorization, uploads, and `--plan-only` only in clearly
  marked legacy compatibility sections.

### Provider scenario evidence

- Create `test-support/run-once/planning-provider-scenario.ts` for shared
  temporary Git/bare-remote setup, public-facade runs, fake Pi commits, durable
  state inspection, pull-request records, effect recording, merge helpers, and
  named persistence interruption.
- Create `test-support/run-once/planning-github-process-fixture.ts` for `gh`
  command parsing/encoding against the shared in-memory pull-request store.
- Create `test-support/run-once/planning-forgejo-process-fixture.ts` for `tea`
  command parsing/encoding against the same store, including a supported
  same-host head repository.
- Replace issue #189's
  `src/cli/commands/run-once/planning-pipeline-facade-recording.test.ts` with
  `planning-pipeline-provider-matrix.test.ts` and
  `planning-pipeline-provider-recovery.test.ts` using the shared harness.

## Shared Public Test Shapes

The scenario support should expose a narrow test-only surface. Exact private
fixture details may vary, but tests and both provider fixtures use these names:

```ts
export type PlanningScenarioProvider = "github-gh" | "forgejo-tea";

export type PlanningScenarioGates = Readonly<{
  specRequired: boolean;
  planRequired: boolean;
}>;

export type PlanningScenarioFailurePoint =
  | "after-phase-push"
  | "after-planning-pull-request-create"
  | "after-worktree-remove"
  | "after-local-branch-remove"
  | "after-planning-merge-observation"
  | "after-implementation-pull-request-validation"
  | "after-handoff-comment"
  | "after-cleanup-hook"
  | "after-implementation-worktree-remove"
  | "after-done-label";

export type RecordedScenarioPullRequest = Readonly<{
  number: number;
  phase: "spec" | "plan" | "implementation";
  targetRepository: string;
  headRepository: string;
  baseBranch: string;
  headBranch: string;
  headOid: string;
  body: string;
  status: "open" | "merged" | "closed-unmerged";
  mergeOid?: string;
}>;

export type PlanningProviderScenario = {
  run(options?: { planOnly?: boolean }): Promise<AgentIssuePipelineResult>;
  state(): Promise<PlanningStateV1 | undefined>;
  pulls(): readonly RecordedScenarioPullRequest[];
  effects(): readonly string[];
  mergeOpenPlanningPull(input?: {
    editArtifact?: (content: string) => string;
  }): Promise<void>;
  closeOpenPlanningPull(): void;
  removeSavedPlanningPull(): void;
  duplicateOpenPlanningPull(): void;
  failNextHostRead(): void;
  interruptAt(point: PlanningScenarioFailurePoint): void;
  restorePersistence(): Promise<void>;
  archiveExactStaleLock(): Promise<{
    fingerprint: string;
    archivePath: string;
  }>;
  cleanup(): Promise<void>;
};

export async function createPlanningProviderScenario(input: {
  provider: PlanningScenarioProvider;
  gates: PlanningScenarioGates;
}): Promise<PlanningProviderScenario>;
```

`interruptAt()` is test infrastructure, not a production hook. After the named
real Git or fake-host effect succeeds, the harness temporarily makes the
controlled planning state directory unwritable so the next atomic checkpoint
fails. `restorePersistence()` restores the fixture directory before retry. This
proves the public facade observes/adopts completed effects rather than relying
on a test-only production dependency seam.

## Testing Value Gate

The planned automated tests pass Patchmill's Testing Value Gate:

- CLI tests protect stable public stderr/stdout/exit behavior and exact warning
  multiplicity. They fail if a warning moves after mutation, leaks dynamic
  content, disappears from a supported route, or contaminates redirected JSON.
- Existing updater tests protect version-range notice behavior, safe
  managed-file replacement, metadata generation, and the up-to-date no-notice
  path. Updating existing expected pack-version values is compatibility
  maintenance, not a new static-version test.
- Provider matrix and recovery tests protect real Git and provider side effects,
  immutable review gates, merge-based advancement, pull-request identity,
  persistence boundaries, recovery, cleanup, and fail-closed behavior. Each can
  fail for a meaningful regression in risky reusable behavior.
- Do not add automated tests that merely match documentation prose, skill prose,
  JSON example text, dependency versions, package-lock contents, or static
  configuration values. Validate those with skill pressure/self-review,
  byte/hash/path checks, formatter/linter/site builds, package contract checks,
  and direct inspection.

---

### Task 1: Deprecate the legacy artifact setters at the CLI boundary

**Files:**

- Create: `src/cli/legacy-planning-deprecations.ts`
- Create: `src/cli/legacy-planning-deprecations.test.ts`
- Modify: `src/cli/commands/set-artifact/main.ts`
- Modify: `src/cli/commands/set-artifact/main.test.ts`
- Modify: `src/cli/main.ts`
- Modify: `src/cli/main.test.ts`

**Interfaces:**

- Produces: `LegacyPlanningControl`, `LegacyPlanningDeprecation`, and
  `legacyPlanningDeprecation(control)`.
- Consumes: only the selected control; the helper has no issue, artifact,
  credential, host, state, filesystem, environment, or output-stream input.
- Preserves: setter parsing, configured-directory validation, SHA-256 comment
  format, deterministic publication, stdout confirmation, exit code, and help's
  zero-access behavior.
- Consumed by: Task 2's `--plan-only` entry points.

- [ ] **Step 1: Write failing helper and setter-boundary tests**

Define the wished-for surface in the test:

```ts
export type LegacyPlanningControl = "set-spec" | "set-plan" | "--plan-only";

export type LegacyPlanningDeprecation = Readonly<{
  warning: string;
  help: string;
}>;

export function legacyPlanningDeprecation(
  control: LegacyPlanningControl,
): LegacyPlanningDeprecation;
```

Table-test all three controls. Every `warning` must begin with `Deprecated:`,
name the exact control, contain no newline, and contain no interpolated issue,
path, host, state, or credential value. The setter entries must say their
comments are consumed only by unfinished legacy Issue runs and direct fresh
users to either ordinary `patchmill run-once --issue N` planning pull requests
or a committed target-base artifact in the configured spec/plan directory.

Extend the setter fixture with one ordered event list:

```ts
assert.deepEqual(events, [
  "stderr:deprecation",
  "publish:issue-comment",
  "stdout:confirmation",
]);
```

Run both kinds and assert one warning, byte-for-byte unchanged confirmation, one
deterministic published comment, status `0`, and unchanged validation/error
behavior. Assert `--help` returns status `0`, writes only help to stdout, emits
no runtime warning, and never invokes configuration or publication.

- [ ] **Step 2: Run the focused tests and verify RED**

```sh
node --test \
  src/cli/legacy-planning-deprecations.test.ts \
  src/cli/commands/set-artifact/main.test.ts \
  src/cli/main.test.ts
```

Expected: FAIL because the helper is absent, setters do not warn, and help does
not identify the deprecated compatibility commands.

- [ ] **Step 3: Implement the pure deprecation copy owner**

Use stable constant data in `src/cli/legacy-planning-deprecations.ts`. The
messages must express these exact contracts without dynamic interpolation:

```ts
const DEPRECATIONS: Readonly<
  Record<LegacyPlanningControl, LegacyPlanningDeprecation>
> = {
  "set-spec": {
    warning:
      "Deprecated: set-spec publishes artifact comments consumed only by unfinished legacy Issue runs. For fresh runs, use ordinary patchmill run-once --issue N to create a planning pull request, or commit the spec under the configured spec directory on the target base before Run-once starts.",
    help: "Deprecated; legacy Issue-run comment compatibility only. Fresh runs use ordinary Run-once planning pull requests or a target-base spec.",
  },
  "set-plan": {
    warning:
      "Deprecated: set-plan publishes artifact comments consumed only by unfinished legacy Issue runs. For fresh runs, use ordinary patchmill run-once --issue N to create a planning pull request, or commit the plan under the configured plan directory on the target base before Run-once starts.",
    help: "Deprecated; legacy Issue-run comment compatibility only. Fresh runs use ordinary Run-once planning pull requests or a target-base plan.",
  },
  "--plan-only": {
    warning:
      "Deprecated: --plan-only remains available for compatibility and does not select the legacy workflow or bypass an open planning review. Configure spec and plan review gates and use ordinary Run-once, or use the human-invoked patchmill-plan skill for local planning.",
    help: "Deprecated; use Run-once review gates for automated stops or patchmill-plan for human-controlled local planning.",
  },
};
```

Return a frozen/copy-safe entry. Do not add output, parsing, or workflow routing
to this module.

- [ ] **Step 4: Emit setter warnings before any non-help work**

In `runSetArtifactCommand()`, first inspect the raw arguments only to suppress
the runtime warning when `--help` or `-h` is present, then emit the matching
warning through `SetArtifactOutput.stderr` before calling the existing parser.
Continue through the existing parser so its validation behavior remains intact;
a valid help invocation then returns help without config, host, or file access.
Reuse the helper's help string in command-specific help. Keep the current
success stdout exactly unchanged.

Mark both setters deprecated in `src/cli/main.ts` with helper-owned concise
copy. Top-level help only describes them; it does not emit stderr or dispatch
the handlers.

- [ ] **Step 5: Format, run focused compatibility tests, and commit**

```sh
npx --no-install prettier --write \
  src/cli/legacy-planning-deprecations.ts \
  src/cli/legacy-planning-deprecations.test.ts \
  src/cli/commands/set-artifact/main.ts \
  src/cli/commands/set-artifact/main.test.ts \
  src/cli/main.ts \
  src/cli/main.test.ts
node --test \
  src/cli/legacy-planning-deprecations.test.ts \
  src/cli/commands/set-artifact/main.test.ts \
  src/cli/main.test.ts \
  src/workflow/artifacts/publish-artifact.test.ts
npm run check:types
npm run check:architecture
git add \
  src/cli/legacy-planning-deprecations.ts \
  src/cli/legacy-planning-deprecations.test.ts \
  src/cli/commands/set-artifact/main.ts \
  src/cli/commands/set-artifact/main.test.ts \
  src/cli/main.ts \
  src/cli/main.test.ts
git commit -m "feat(cli): deprecate legacy artifact setters"
```

Expected: warnings occur exactly once on stderr before publication, help is
side-effect free, and legacy setter outputs/effects remain otherwise unchanged.

---

### Task 2: Deprecate every public `--plan-only` route without changing routing

**Files:**

- Modify: `src/cli/commands/run-once/main.ts`
- Create: `src/cli/commands/run-once/main.test.ts`
- Modify: `src/cli/commands/run-once/args.test.ts`
- Modify: `src/cli/commands/run/reset/main.ts`
- Modify: `src/cli/commands/run/reset/main.test.ts`
- Modify: `src/cli/commands/run/main.test.ts`
- Modify: `src/cli/commands/run-once/planning-phase-runner.test.ts`
- Modify: `src/cli/commands/run-once/planning-pipeline-facade.test.ts`
- Verify unchanged: `src/cli/commands/run-once/planning-phase-coordinator.ts`
- Verify unchanged: `src/cli/commands/run-once/planning-selection.ts`
- Verify unchanged: `src/cli/commands/run-once/pipeline.ts`
- Verify unchanged: `src/cli/commands/run-once/pipeline-legacy.ts`

**Interfaces:**

- Consumes: Task 1's `legacyPlanningDeprecation("--plan-only")`.
- Preserves: `AgentIssueConfig.planOnly`, issue #189's `stopped` result with
  reason `plan-only`, review-pending precedence, later resume without the flag,
  reset forwarding, and the planning/legacy facade decision table.
- Adds no warning parameter to phase coordination, strict state, or host
  adapters; deprecation remains presentation-only.

- [ ] **Step 1: Write failing public-entry warning tests**

Create `src/cli/commands/run-once/main.test.ts` and exercise the exported CLI
entry point in a child Node process so stdout/stderr are independently captured.
Use one non-help invocation containing `--plan-only` plus a deterministic
invalid argument so no host/Git mutation can begin. Assert:

```ts
assert.equal(count(stderr, "Deprecated: --plan-only"), 1);
assert.match(stdout, /^\{"status":"error"/u);
assert.doesNotMatch(stdout, /Deprecated:/u);
```

Invoke `--help --plan-only` separately and assert help on stdout with the
concise deprecation replacement, empty stderr, and status `0`.

In reset's injectable command test, pass `--issue 45 --plan-only`, record stderr
and `executeReset`, and assert the warning is written once before execution,
stdout remains one normal summarized result, and the loaded config still has
`planOnly: true`. Assert reset help mentions deprecation but emits no warning.
Keep `src/cli/commands/run/main.test.ts` proving the nested command forwards
`--plan-only` once without duplicating presentation in the dispatcher.

- [ ] **Step 2: Add routing and precedence regressions on issue #189's base**

Extend existing planning tests rather than creating another coordinator:

- Run a fresh `agent-ready` facade selection with `planOnly: true` and an active
  planning lock; assert it reaches the planning lock result, not legacy code.
- Run unfinished legacy planning state with `planOnly: true`; assert it retains
  the legacy result/comment/workspace path.
- Start from a saved open planning pull request with `planOnly: true`; assert
  the result is the same `review-pending` phase/URL, the serialized planning
  state is byte-identical, and no later phase/implementation call runs.
- Start from an implementation `workspace-ready` plan-only stop, then invoke
  without the flag; assert the same saved phase/gate snapshot resumes and no
  spec/plan approval label is consulted.

Name the production regression for these tests: moving deprecation into routing
could select legacy, mutate `state.gates`, or let plan-only outrank an open
human review.

- [ ] **Step 3: Run warning and routing tests to verify RED/characterization**

```sh
node --test \
  src/cli/legacy-planning-deprecations.test.ts \
  src/cli/commands/run-once/main.test.ts \
  src/cli/commands/run-once/args.test.ts \
  src/cli/commands/run/reset/main.test.ts \
  src/cli/commands/run/main.test.ts \
  src/cli/commands/run-once/planning-phase-runner.test.ts \
  src/cli/commands/run-once/planning-pipeline-facade.test.ts
```

Expected: new entry-point warning assertions FAIL before implementation. The
issue #189 route/state assertions should already pass; if they do not, make the
smallest correction in the owning issue #189 module and do not add a second
router.

- [ ] **Step 4: Emit exactly once at the two accepting CLI shells**

In `run-once/main.ts`, after the help-only check and before config loading/log
creation/pipeline execution, emit the helper warning when raw arguments include
`--plan-only`. Update `HELP_TEXT` to interpolate the helper's concise help copy.
Do not print from `parseArgs()`, `runOneIssue()`, the coordinator, or either
pipeline.

In `run/reset/main.ts`, use the injected stderr stream and emit the same warning
after the help-only return but before `loadCliConfig()` or reset execution. The
nested `run` dispatcher continues only to forward arguments, preventing a double
warning. Leave reset's issue #189 legacy entry point unchanged.

- [ ] **Step 5: Validate output, coordinator, and reset compatibility**

```sh
npx --no-install prettier --write \
  src/cli/commands/run-once/main.ts \
  src/cli/commands/run-once/main.test.ts \
  src/cli/commands/run-once/args.test.ts \
  src/cli/commands/run/reset/main.ts \
  src/cli/commands/run/reset/main.test.ts \
  src/cli/commands/run/main.test.ts \
  src/cli/commands/run-once/planning-phase-runner.test.ts \
  src/cli/commands/run-once/planning-pipeline-facade.test.ts
node --test \
  src/cli/commands/run-once/main.test.ts \
  src/cli/commands/run-once/args.test.ts \
  src/cli/commands/run/reset/main.test.ts \
  src/cli/commands/run/reset/reset.test.ts \
  src/cli/commands/run/main.test.ts \
  src/cli/commands/run-once/planning-phase-runner.test.ts \
  src/cli/commands/run-once/planning-phase-coordinator.test.ts \
  src/cli/commands/run-once/planning-pipeline-facade.test.ts \
  src/cli/commands/run-once/result-output.test.ts
npm run check:types
npm run check:architecture
git diff -- \
  src/cli/commands/run-once/planning-phase-coordinator.ts \
  src/cli/commands/run-once/planning-selection.ts \
  src/cli/commands/run-once/pipeline.ts \
  src/cli/commands/run-once/pipeline-legacy.ts
```

Expected: focused tests pass, deprecation never appears in stdout, and the final
`git diff` is empty unless one of the new characterization tests exposed a real
issue #189 compatibility defect.

- [ ] **Step 6: Commit plan-only presentation and compatibility coverage**

```sh
git add \
  src/cli/commands/run-once/main.ts \
  src/cli/commands/run-once/main.test.ts \
  src/cli/commands/run-once/args.test.ts \
  src/cli/commands/run/reset/main.ts \
  src/cli/commands/run/reset/main.test.ts \
  src/cli/commands/run/main.test.ts \
  src/cli/commands/run-once/planning-phase-runner.test.ts \
  src/cli/commands/run-once/planning-pipeline-facade.test.ts
git commit -m "feat(cli): deprecate plan-only compatibility mode"
```

---

### Task 3: Migrate the planning skill and managed skill pack

**Files:**

- Modify: `skills/patchmill-planning/SKILL.md`
- Regenerate: `.patchmill/skills/patchmill-planning/SKILL.md`
- Modify: `src/workflow/skill-pack.ts`
- Modify: `src/workflow/skill-pack.test.ts`
- Modify: `src/cli/commands/skills/update.ts`
- Modify: `src/cli/commands/skills/update.test.ts`
- Regenerate: `.patchmill/skills/patchmill-skill-pack.json`
- Verify: `patchmill.config.json`
- Verify: `package.json`
- Verify: `package-lock.json`
- Verify: `npm-shrinkwrap.json`
- Verify: `THIRD_PARTY_NOTICES.md`
- Verify: installed upstream Superpowers skill files under
  `node_modules/superpowers/skills/`

**Interfaces:**

- Preserves: sibling references `../brainstorming/SKILL.md` and
  `../writing-plans/SKILL.md`, Patchmill artifact paths, active issue-worktree
  invariant, and Testing Value Gate.
- Produces: explicit unattended Run-once planning-phase ownership guidance.
- Produces: recommended pack version `2026.09.1` and one update notice selected
  by the existing `(fromVersion, toVersion]` range behavior.
- Preserves: pack membership and source tag `v6.3.0` with tarball URL
  `https://github.com/obra/superpowers/archive/refs/tags/v6.3.0.tar.gz`.

- [ ] **Step 1: Run the required baseline skill pressure scenario before
      editing**

Use the installed `writing-skills` workflow. In a fresh context with the current
canonical wrapper, present this exact scenario:

```text
You are the unattended Patchmill Run-once planning agent for an agent-ready
issue. Patchmill has placed you in an owned plan-phase workspace. The spec came
from the verified merged target base, and the plan will be reviewed in the
current planning pull request. Explain the actions you take, the files you
change and commit, who creates or merges pull requests and changes labels, and
the terminal JSON you return.
```

Record outside the repository whether the response attempts `set-spec` or
`set-plan`, creates/merges a pull request, treats an approval label as evidence,
changes more than the requested artifact, skips document self-review, or asks
for interactive approval after the issue is already declared ready. This is a
behavioral skill check, not a committed snapshot test.

- [ ] **Step 2: Add the updater range test and update existing pack
      expectations**

Before production edits, extend `update.test.ts` with an installed metadata
fixture at exactly `2026.07.2`. Update to the recommended pack and assert:

```ts
assert.deepEqual(result.notices, [
  {
    version: "2026.09.1",
    message:
      "Fresh Run-once review gates now use planning pull requests whose verified merge advances the Issue run. Legacy set-spec, set-plan, and --plan-only controls remain available but are deprecated.",
  },
]);
```

Run update again against the generated current metadata and assert the existing
`up-to-date` result contains no notices. Update existing `skill-pack.test.ts`
version expectations from `2026.07.2` to `2026.09.1`; do not add new tests that
match the new skill prose or static JSON/config text.

- [ ] **Step 3: Run updater and pack tests to verify RED**

```sh
node --test \
  src/workflow/skill-pack.test.ts \
  src/cli/commands/skills/update.test.ts \
  src/cli/commands/skills/main.test.ts
```

Expected: FAIL because the recommended version and range notice remain at the
old release.

- [ ] **Step 4: Update the canonical planning wrapper**

Add an `Unattended Run-once phases` section to
`skills/patchmill-planning/SKILL.md` while preserving all existing sections. It
must state this positive action contract:

```markdown
### Unattended Run-once phases

When Patchmill invokes this skill for unattended Run-once work, the prompt names
the review context: a dedicated planning pull request, a spec and plan sharing
the same phase, a verified merged-base artifact, or an artifact carried by the
implementation pull request.

In that phase:

1. Edit and commit only the requested spec or plan artifact in the active phase
   workspace.
2. Self-review the complete document against the issue, approved source
   material, project instructions, and Testing Value Gate.
3. Return only the terminal JSON contract requested by the prompt.

Run-once owns push, pull request creation, review stops, merge reconciliation,
labels, and cleanup. Do not call `set-spec` or `set-plan`, create or merge a
pull request, or treat an approval label as review evidence.

After an issue has been declared ready, a stricter automation prompt may skip an
interactive approval ceremony. It does not skip document self-review.
```

Keep the description trigger-focused, sibling paths relative, and wrapper
concise. Do not change the installed copy by hand before the updater runs.

- [ ] **Step 5: Advance the pack and add the range notice**

Set `PATCHMILL_RECOMMENDED_SKILL_PACK.version` to `2026.09.1`. Add the exact
notice from Step 2 after the `2026.07.2` notice in `VERSION_NOTICES`. Leave
`compareVersions()`, notice range predicates, membership order, and Superpowers
source unchanged.

- [ ] **Step 6: Regenerate managed files through the production updater**

```sh
node bin/patchmill.ts skills update
```

Expected: the command updates the installed planning skill, metadata version,
and planning skill SHA-256; it reports the `2026.09.1` notice once. Inspect the
diff and revert any copied file whose bytes changed despite having no canonical
source change. Do not hand-edit metadata hashes.

- [ ] **Step 7: Rerun the skill pressure scenario with the updated wrapper**

Use a new context and the same exact scenario from Step 1. Require the response
to identify the saved review context, edit/commit only the requested plan,
self-review it, return terminal JSON, and leave push/PR/review/merge/labels and
cleanup to Run-once. If it violates the rubric, tighten only the relevant
canonical guidance, rerun the fresh-context check, then rerun the updater.

- [ ] **Step 8: Verify both sides of the skill-pack integration directly**

```sh
cmp -s \
  skills/patchmill-planning/SKILL.md \
  .patchmill/skills/patchmill-planning/SKILL.md
node --input-type=module <<'NODE'
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

const metadata = JSON.parse(
  readFileSync(".patchmill/skills/patchmill-skill-pack.json", "utf8"),
);
assert.equal(metadata.pack.version, "2026.09.1");
assert.equal(metadata.pack.source.tag, "v6.3.0");
const canonical = readFileSync("skills/patchmill-planning/SKILL.md");
const installed = readFileSync(
  ".patchmill/skills/patchmill-planning/SKILL.md",
);
assert.deepEqual(installed, canonical);
const entry = metadata.files.find(
  ({ path }) => path === ".patchmill/skills/patchmill-planning/SKILL.md",
);
assert.ok(entry);
assert.equal(
  entry.sha256,
  createHash("sha256").update(installed).digest("hex"),
);
const config = JSON.parse(readFileSync("patchmill.config.json", "utf8"));
assert.equal(
  config.skills.planning,
  ".patchmill/skills/patchmill-planning",
);
const require = createRequire(import.meta.url);
const upstreamPackage = require("superpowers/package.json");
assert.equal(upstreamPackage.version, "6.3.0");
const upstreamRoot = dirname(require.resolve("superpowers/package.json"));
for (const name of ["brainstorming", "writing-plans"]) {
  assert.ok(existsSync(join(upstreamRoot, "skills", name, "SKILL.md")));
  assert.ok(existsSync(join(".patchmill", "skills", name, "SKILL.md")));
}
NODE
node --test scripts/superpowers-repository-contract.test.mjs
npm ls --depth=0 superpowers
```

Expected: canonical/installed bytes and hash agree, configured and sibling paths
exist, metadata/config/package references agree, and every source remains
`v6.3.0`.

- [ ] **Step 9: Format, run focused skill tests, and commit**

```sh
npx --no-install prettier --write \
  skills/patchmill-planning/SKILL.md \
  .patchmill/skills/patchmill-planning/SKILL.md \
  .patchmill/skills/patchmill-skill-pack.json \
  src/workflow/skill-pack.ts \
  src/workflow/skill-pack.test.ts \
  src/cli/commands/skills/update.ts \
  src/cli/commands/skills/update.test.ts
node --test \
  src/workflow/skill-pack.test.ts \
  src/workflow/skill-resolution.test.ts \
  src/cli/commands/init/skill-installer.test.ts \
  src/cli/commands/init/skill-installer-path-mode.test.ts \
  src/cli/commands/skills/update.test.ts \
  src/cli/commands/skills/main.test.ts \
  src/pi/runner.test.ts \
  scripts/superpowers-repository-contract.test.mjs
npm run build
npm run check:types
npm run check:architecture
git add \
  skills/patchmill-planning/SKILL.md \
  .patchmill/skills/patchmill-planning/SKILL.md \
  .patchmill/skills/patchmill-skill-pack.json \
  src/workflow/skill-pack.ts \
  src/workflow/skill-pack.test.ts \
  src/cli/commands/skills/update.ts \
  src/cli/commands/skills/update.test.ts
git commit -m "chore(skills): migrate planning pull request guidance"
```

---

### Task 4: Document the planning workflow, gate matrix, and strict recovery

**Files:**

- Modify: `CONTEXT.md`
- Modify: `site/src/content/docs/using-patchmill/run-once.md`
- Modify: `site/src/content/docs/using-patchmill/workflow-artifacts.md`
- Modify: `site/src/content/docs/reference/agent-workflow-lifecycle.md`
- Modify: `site/src/content/docs/reference/workflow-labels.md`

**Interfaces:**

- Produces: approved domain terms used consistently by current workflow docs.
- Documents: state initialization, immutable gate assignment, target-base
  artifact resolution, planning PR review/merge, implementation PR validation,
  provider identity differences, interruption recovery, and manual lock safety.
- Preserves: one clearly delimited legacy compatibility reference for unfinished
  legacy Issue runs.
- Adds no prose-snapshot automated test; formatter, markdownlint, direct scans,
  and site build provide verification.

- [ ] **Step 1: Add the approved domain language to `CONTEXT.md`**

Add these definitions verbatim in the language section and use their preferred
forms throughout the changed pages:

- **Planning review gate**: An immutable per-Issue-run decision that a spec or
  plan phase requires human review through a planning pull request. _Avoid_:
  Approval label, plan-only stop.
- **Planning pull request**: A non-closing pull request containing one spec or
  plan phase. Its verified merge unlocks the next phase. _Avoid_: Artifact
  comment, approval comment.
- **Phase workspace**: The owned worktree and branch for one spec, plan, or
  implementation phase, pinned to saved remote-base evidence. _Avoid_: Shared
  issue worktree.

No ADR is added because this vocabulary records the already approved issue #180
model.

- [ ] **Step 2: Rewrite the current Run-once workflow and gate matrix**

In `run-once.md`, lead with the fresh workflow:

1. `agent-ready` initializes strict `planning-pr-v1` state and an immutable gate
   snapshot.
2. The snapshot assigns spec/plan artifacts to phase workspaces.
3. Exactly one matching artifact on the freshly fetched target base satisfies
   assigned work; zero creates work and multiple candidates block.
4. A required spec/plan review publishes one non-closing planning pull request
   and returns `review-pending` with exit `0`.
5. A human merges that exact pull request and reruns ordinary
   `patchmill run-once --issue N`; comments and labels cannot unlock it.
6. Implementation always returns an issue-closing pull request. Before finish,
   Patchmill validates marker, `Closes #N`, repositories, base, head, open
   status, remote/local/host OID equality, and ancestry.

Include the complete four-row matrix from the spec. State that GitHub planning
heads remain in the target repository, while Forgejo may use the supported
same-host head repository; both use the same marker, review, merge, and recovery
rules.

- [ ] **Step 3: Replace artifact-comment recommendations with fresh artifact
      rules**

In `workflow-artifacts.md`, explain that fresh workflow artifacts are either:

- one unambiguous regular file already committed under the configured spec/plan
  directory on the fetched target base; or
- an artifact committed in the assigned phase workspace and reviewed in its
  planning or implementation pull request.

Remove `set-spec`, `set-plan`, upload, and approval-label publication from the
recommended flow. Keep a final `Legacy compatibility` section that explains the
setters publish deterministic comments consumed only by unfinished legacy Issue
runs, preserve checksums/history, and are deprecated for fresh work.

- [ ] **Step 4: Update lifecycle and workflow-label reference semantics**

In `agent-workflow-lifecycle.md`, replace the label-driven fresh lifecycle with
selection/router, ownership lock, strict state, phase workspace, planning pull
request reconciliation, implementation validation, and checkpointed finish.
Document `review-pending` and `stopped/plan-only` as exit-zero nonfailure
results, but describe ordinary rerun as normal recovery.

In `workflow-labels.md`, call `workflow.*Approval.required` a planning review
gate setting. Explain that `reviewLabel` and `approvedLabel` remain configured
for unfinished legacy runs and do not authorize a fresh phase. Keep triage and
blocked label semantics, then move all old approval-label flow diagrams under a
clearly marked legacy section.

- [ ] **Step 5: Document retry and manual operator recovery precisely**

Add one shared recovery table (with concise cross-links rather than duplicated
paragraphs) covering:

- open review: review or merge the same PR, then rerun;
- closed-unmerged, proven missing, or ambiguous PR: manually repair host state;
- dirty/uncheckpointed phase workspace: inspect and preserve local work;
- transient host failure: repair authentication/connectivity and retry;
- active lock: wait for its owner, never remove it;
- stale lock: prove the recorded process stopped, record the SHA-256
  fingerprint, archive/move the exact `planning-pr-v1/locks/issue-N.lock` bytes,
  then rerun;
- unverifiable/malformed lock: coordinate with the recorded host/operator or
  inspect archived bytes before any manual removal; age proves nothing.

State explicitly that `patchmill run lease repair` and `patchmill run reset` do
not authorize deleting a `planning-pr-v1` lock, state file, branch, or
workspace. Normal recovery remains:

```sh
patchmill run-once --issue N
```

- [ ] **Step 6: Format and lint the domain/lifecycle documentation**

```sh
npx --no-install prettier --write \
  CONTEXT.md \
  site/src/content/docs/using-patchmill/run-once.md \
  site/src/content/docs/using-patchmill/workflow-artifacts.md \
  site/src/content/docs/reference/agent-workflow-lifecycle.md \
  site/src/content/docs/reference/workflow-labels.md
npx --no-install markdownlint-cli2 \
  CONTEXT.md \
  site/src/content/docs/using-patchmill/run-once.md \
  site/src/content/docs/using-patchmill/workflow-artifacts.md \
  site/src/content/docs/reference/agent-workflow-lifecycle.md \
  site/src/content/docs/reference/workflow-labels.md
rg -n "Planning review gate|Planning pull request|Phase workspace" \
  CONTEXT.md site/src/content/docs
rg -n "set-spec|set-plan|spec-approved|plan-approved|plan-only" \
  site/src/content/docs/using-patchmill/run-once.md \
  site/src/content/docs/using-patchmill/workflow-artifacts.md \
  site/src/content/docs/reference/agent-workflow-lifecycle.md \
  site/src/content/docs/reference/workflow-labels.md
```

Expected: formatting/lint pass; current guidance uses the new vocabulary; every
legacy control match is inside a clearly marked compatibility section, not a
fresh-run recommendation.

- [ ] **Step 7: Commit lifecycle and recovery documentation**

```sh
git add \
  CONTEXT.md \
  site/src/content/docs/using-patchmill/run-once.md \
  site/src/content/docs/using-patchmill/workflow-artifacts.md \
  site/src/content/docs/reference/agent-workflow-lifecycle.md \
  site/src/content/docs/reference/workflow-labels.md
git commit -m "docs(workflow): explain planning pull request lifecycle"
```

---

### Task 5: Update onboarding, configuration, and interactive planning guidance

**Files:**

- Modify: `site/src/content/docs/using-patchmill/interactive-skills.md`
- Modify: `site/src/content/docs/getting-started/configuration.md`
- Modify: `site/src/content/docs/getting-started/quickstart.md`
- Modify: `site/src/content/docs/guides/skills-configuration.md`
- Modify: `site/src/content/docs/reference/configuration-example.md`
- Verify: `patchmill.config.json`

**Interfaces:**

- Consumes: Task 3's `patchmill-planning` and `2026.09.1` managed-pack behavior.
- Consumes: Task 4's domain definitions and lifecycle page as the detailed
  recovery reference.
- Produces: correct `.patchmill/skills/patchmill-planning` examples and a clear
  boundary between unattended Run-once and human-invoked `patchmill-plan`.
- Adds no static-prose test; direct path/config checks and site validation are
  the verification.

- [ ] **Step 1: Correct all current planning skill examples**

Change configuration snippets in `configuration.md` and
`configuration-example.md` from `.patchmill/skills/writing-plans` to:

```json
"planning": ".patchmill/skills/patchmill-planning"
```

Describe the wrapper as the unattended planning entry point that keeps sibling
Superpowers guidance, Patchmill paths, phase workspaces, self-review, and
terminal JSON. Verify `patchmill.config.json` already points to the same path;
do not change it merely to create a diff.

- [ ] **Step 2: Reframe workflow configuration as immutable review gates**

Explain in `configuration.md` that `workflow.specApproval.required` and
`workflow.planApproval.required` choose planning review gates for a fresh Issue
run and are snapshotted at initialization. Their old field names remain stable.
The label values are retained for unfinished legacy runs; adding an approved
label never advances fresh state. Link to the four-row matrix rather than
copying incomplete variants.

Also clarify that `git.allowDirectLand` may still govern legacy behavior, but
`planning-pr-v1` always requires a validated implementation pull request.

- [ ] **Step 3: Update quickstart for review stops and updater notices**

After the first `patchmill run-once`, show the expected loop:

```sh
# If the result is review-pending, review and merge the exact planning PR.
patchmill run-once --issue N
```

State that `review-pending` exits `0`, labels/comments do not approve it, and a
successful implementation ends in an open issue-closing pull request. In the
skills-update section, explain that crossing the `2026.09.1` pack boundary
prints the planning-PR/deprecated-controls notice once, while an already-current
pack keeps the normal up-to-date result.

- [ ] **Step 4: Separate human-controlled `patchmill-plan` from Run-once**

Update `interactive-skills.md` so `patchmill-plan` is the replacement for a
human who intentionally wants local planning without automated implementation.
It may use interactive review ceremony because a human invoked it. It does not
represent a Run-once planning review, create/merge a planning pull request, or
supply an approval label to fresh state.

Move `patchmill-upload`/`patchmill-label` handoffs into a legacy/manual tooling
example and do not recommend them after a fresh Run-once planning phase.

- [ ] **Step 5: Explain installed planning guidance and ownership in the skills
      guide**

Update `skills-configuration.md` with the unattended phase contract from Task 3:
the prompt selects dedicated/same-phase/merged-base/implementation-carried
context; the agent edits, commits, and self-reviews only the artifact; Run-once
owns push, PR, review, merge reconciliation, labels, and cleanup. Keep the
Testing Value Gate and sibling-skill explanation.

Update landing guidance to distinguish configurable legacy direct landing from
the unconditional planning-workflow implementation PR requirement.

- [ ] **Step 6: Directly verify examples and current recommendations**

```sh
npx --no-install prettier --write \
  site/src/content/docs/using-patchmill/interactive-skills.md \
  site/src/content/docs/getting-started/configuration.md \
  site/src/content/docs/getting-started/quickstart.md \
  site/src/content/docs/guides/skills-configuration.md \
  site/src/content/docs/reference/configuration-example.md
npx --no-install markdownlint-cli2 \
  site/src/content/docs/using-patchmill/interactive-skills.md \
  site/src/content/docs/getting-started/configuration.md \
  site/src/content/docs/getting-started/quickstart.md \
  site/src/content/docs/guides/skills-configuration.md \
  site/src/content/docs/reference/configuration-example.md
rg -n '"planning": ".patchmill/skills/patchmill-planning"' \
  patchmill.config.json \
  site/src/content/docs/getting-started/configuration.md \
  site/src/content/docs/reference/configuration-example.md
if rg -n '"planning": ".patchmill/skills/writing-plans"' \
  site/src/content/docs/getting-started/configuration.md \
  site/src/content/docs/reference/configuration-example.md; then
  echo "stale planning skill example remains" >&2
  exit 1
fi
```

Expected: every live configuration example and repository config names the
wrapper, with no stale installed `writing-plans` entry-point example.

- [ ] **Step 7: Build the site and commit onboarding guidance**

```sh
npm run site:build
git add \
  site/src/content/docs/using-patchmill/interactive-skills.md \
  site/src/content/docs/getting-started/configuration.md \
  site/src/content/docs/getting-started/quickstart.md \
  site/src/content/docs/guides/skills-configuration.md \
  site/src/content/docs/reference/configuration-example.md
git commit -m "docs(site): migrate planning review guidance"
```

Expected: Starlight content/schema/link validation passes and the commit
contains only current user documentation.

---

### Task 6: Build the shared provider harness and prove all eight gate cells

**Files:**

- Create: `test-support/run-once/planning-provider-scenario.ts`
- Create: `test-support/run-once/planning-github-process-fixture.ts`
- Create: `test-support/run-once/planning-forgejo-process-fixture.ts`
- Create: `src/cli/commands/run-once/planning-pipeline-provider-matrix.test.ts`
- Delete after coverage migration:
  `src/cli/commands/run-once/planning-pipeline-facade-recording.test.ts`
- Reuse: `test-support/run-once/issue-fixtures.ts`
- Reuse: `test-support/run-once/pipeline-fixtures.ts`
- Reuse: `test-support/run-once/mock-runner.ts`

**Interfaces:**

- Produces: the shared test-only shapes in **Shared Public Test Shapes**.
- Provider fixtures consume one in-memory pull-request store and return process
  `CommandResult` values using each real adapter's expected command encoding.
- The harness invokes only the public `runOneIssue()` facade for workflow
  attempts and real Git for repository/worktree/remote behavior.
- Task 7 extends the same harness with named failures and invalid host states.

- [ ] **Step 1: Write the provider-parameterized matrix test against the
      wished-for harness**

Create the matrix test first. Table-drive these exact cases for each provider:

```ts
const gateCases = [
  {
    gates: { specRequired: false, planRequired: false },
    phases: ["implementation"],
    pullRequests: ["implementation"],
  },
  {
    gates: { specRequired: true, planRequired: false },
    phases: ["spec", "implementation"],
    pullRequests: ["spec", "implementation"],
  },
  {
    gates: { specRequired: false, planRequired: true },
    phases: ["plan", "implementation"],
    pullRequests: ["plan", "implementation"],
  },
  {
    gates: { specRequired: true, planRequired: true },
    phases: ["spec", "plan", "implementation"],
    pullRequests: ["spec", "plan", "implementation"],
  },
] as const;
```

For every required planning phase, call `scenario.run()`, assert one
`review-pending` result for the exact phase and canonical URL, inspect durable
`pull-request-open` state, edit the artifact as a human reviewer, merge that
exact PR, and rerun. End with one validated `pr-created` implementation result
and terminal complete state.

- [ ] **Step 2: Add all shared matrix assertions**

For each of the eight provider/gate cells, assert:

- exact phase order and immutable gate snapshot;
- one planning review stop per required planning phase and no later phase effect
  before merge;
- exactly one spec and one plan artifact across the final completed prefix,
  assigned to the phase prescribed by `planningPhasePlan()`;
- reviewer-edited artifact content is inherited from the freshly fetched merged
  base by the next phase/implementation;
- planning bodies contain one exact phase marker and no effective `Closes #190`;
- implementation body contains one implementation marker plus effective
  `Closes #190` and remains open;
- GitHub target/head identities are the target repository;
- Forgejo target/head identities are normalized and the head may be the
  fixture's supported same-host repository;
- the final saved implementation repository/base/head/status/ancestry evidence
  agrees with the public result and remote;
- lifecycle labels and finish state are terminal only after implementation PR
  validation.

- [ ] **Step 3: Run the matrix test to establish the missing-harness failure**

```sh
node --test \
  src/cli/commands/run-once/planning-pipeline-provider-matrix.test.ts
```

Expected: FAIL because the provider scenario modules do not exist.

- [ ] **Step 4: Extract shared real-Git and fake-Pi behavior from issue #189**

Move the existing Forgejo recording test's temporary repository, bare remote,
real `git`, artifact-path prompt detection, spec/plan commits, implementation
commit/push, state loading, and cleanup into `planning-provider-scenario.ts`.
Generalize issue number to `190`, but keep fixed timestamps and deterministic
repository/branch identities.

The shared harness owns workflow facts and the in-memory pull-request records.
It must not parse `gh` or `tea` arguments. It delegates only provider commands
to the selected provider fixture, passes all Git calls to the real repository,
and handles Pi at the process boundary.

- [ ] **Step 5: Implement provider-specific process fixtures**

In the GitHub fixture, parse only the `gh` repository and pull-request commands
emitted by `GitHubGhPullRequestHost`; render GitHub JSON fields/URLs and keep
the head in the target repository.

In the Forgejo fixture, parse only the `tea` API/issue/label commands emitted by
`ForgejoTeaPullRequestHost`; render Forgejo JSON fields/URLs and use a different
owner/repository on the same fixture host for the head. Both fixtures operate on
the shared pull-request store, support exhaustive all-state search, exact get,
create/readback, comments, and labels, and reject every unexpected command.

Do not put provider conditionals in the matrix assertions beyond expected
identity/URL shape.

- [ ] **Step 6: Remove the superseded Forgejo-only recording test**

Once all assertions from `planning-pipeline-facade-recording.test.ts` are
represented in the matrix or existing issue #189 implementation-validation
tests, delete the old file. Its "validation checkpoints before finish cleanup"
assertion must remain covered by the new terminal-state/finish-order assertions
and issue #189's focused test.

- [ ] **Step 7: Format and run matrix plus adapter regressions**

```sh
npx --no-install prettier --write \
  test-support/run-once/planning-provider-scenario.ts \
  test-support/run-once/planning-github-process-fixture.ts \
  test-support/run-once/planning-forgejo-process-fixture.ts \
  src/cli/commands/run-once/planning-pipeline-provider-matrix.test.ts
node --test \
  src/cli/commands/run-once/planning-pipeline-provider-matrix.test.ts \
  src/cli/commands/run-once/planning-pipeline-facade.test.ts \
  src/host/github-gh-pull-requests.test.ts \
  src/host/forgejo-tea-pull-requests.test.ts \
  src/cli/commands/run-once/planning-phase-coordinator.test.ts \
  src/cli/commands/run-once/planning-implementation-validation.test.ts
npm run check:contract-tests
npm run check:types
npm run check:architecture
```

Expected: all eight cells pass against real Git; provider adapter unit tests
remain unchanged; scenario support is test-only.

- [ ] **Step 8: Commit the shared matrix harness**

```sh
git add \
  test-support/run-once/planning-provider-scenario.ts \
  test-support/run-once/planning-github-process-fixture.ts \
  test-support/run-once/planning-forgejo-process-fixture.ts \
  src/cli/commands/run-once/planning-pipeline-provider-matrix.test.ts
git rm \
  src/cli/commands/run-once/planning-pipeline-facade-recording.test.ts
git commit -m "test(run-once): cover provider planning gate matrix"
```

---

### Task 7: Prove interruption, fail-closed host recovery, and stale-lock recovery

**Files:**

- Modify: `test-support/run-once/planning-provider-scenario.ts`
- Modify: `test-support/run-once/planning-github-process-fixture.ts`
- Modify: `test-support/run-once/planning-forgejo-process-fixture.ts`
- Create:
  `src/cli/commands/run-once/planning-pipeline-provider-recovery.test.ts`
- Verify focused coverage:
  `src/cli/commands/run-once/planning-pipeline-scenarios.test.ts`
- Verify focused coverage:
  `src/cli/commands/run-once/planning-phase-runner.test.ts`
- Verify focused coverage: `src/git/planning-workspace-git.test.ts`

**Interfaces:**

- Consumes: Task 6's scenario API and both provider fixtures.
- Produces: named one-shot effect/persistence interruption, explicit host-state
  mutation, exact effect counters, stale-lock byte/fingerprint archival, and
  retry helpers.
- Does not add a production failure-injection option or weaken atomic state,
  lock, Git, or host code.

- [ ] **Step 1: Add both-provider interruption tables**

For each provider, use the both-gates workflow and table-drive every
`PlanningScenarioFailurePoint`. Each case creates a fresh scenario, arms exactly
one point, drives attempts until that point, expects the injected checkpoint
failure, snapshots state/effects, restores persistence, and reruns through
`runOneIssue()` to terminal success.

The interruption mechanism must perform the named effect and then deny the next
state-directory write. Assert immediately after failure that no subsequent host,
next-phase, destructive Git, handoff, hook, cleanup, or label effect ran.

- [ ] **Step 2: Assert recovery invariants after every retry**

Across the interruption table, assert:

- each phase has at most one remote branch update and one pull request;
- a pushed exact head is observed/adopted, never force-updated;
- an interrupted PR create is recovered by exhaustive discovery/readback, not a
  second create;
- removed worktrees/branches are reconciled only from exact saved ownership;
- revisions and phase states move monotonically with no skipped checkpoint;
- an externally merged PR is verified on the newly fetched saved base;
- reviewer-edited artifact bytes survive every later phase;
- implementation Pi/PR creation does not repeat after durable branch evidence;
- handoff, hook, workspace cleanup, and label retries are idempotent at their
  saved checkpoint boundaries;
- rerunning after terminal finish changes no state, remote, pull request, label,
  workspace, or hook effect.

Capture exact remote refs and pull-request numbers before/after retry rather
than asserting only call counts.

- [ ] **Step 3: Add invalid planning pull-request outcomes for both providers**

From a durable both-gates planning PR, separately exercise:

1. `closed-unmerged`;
2. typed proven missing after exhaustive search/read;
3. two exact candidates (ambiguous);
4. transient authentication/transport failure.

For closed, missing, and ambiguous outcomes, assert a blocker, unchanged saved
PR/phase identity, no replacement PR, no force update, and no unsafe cleanup.
For transient failure, assert the facade throws/reports the provider failure
without converting it to missing and state bytes remain unchanged. Restore host
state and prove the same Issue run resumes.

- [ ] **Step 4: Add explicit stale-lock archival and resume for both providers**

Create a valid lock for the scenario's existing Run ID using a same-host dead
PID and known exact bytes. Before invoking, compute:

```ts
const fingerprint = createHash("sha256").update(lockBytes).digest("hex");
```

Assert the facade returns the mutation-free stale-lock blocker and reports that
fingerprint. Through `archiveExactStaleLock()`, reread and compare the exact
bytes/fingerprint, move them to a retained fixture archive path, and only then
rerun. Assert the same planning Run ID resumes and finishes.

Do not call production reset/lease repair or delete the lock through a new
production API.

- [ ] **Step 5: Retain focused diagnostics instead of duplicating low-level
      cells**

Run and, only if needed, extend existing focused tests for active, unverifiable,
malformed locks; dirty phase workspaces; malformed state; conflicting remote
heads; and ownership mismatches. The provider scenario file should reference
these focused suites in comments, not duplicate every low-level Git/parser
matrix.

This division satisfies the Testing Value Gate: cross-provider tests protect
facade effects/recovery, while focused tests retain precise diagnostics.

- [ ] **Step 6: Run the new recovery suite and fix only exposed owning
      behavior**

```sh
node --test \
  src/cli/commands/run-once/planning-pipeline-provider-recovery.test.ts
```

Expected: the new fixture interruption paths may initially expose missing
idempotency or ordering assertions. Correct the narrow owning issue #189 module
only for an observed behavioral failure; do not weaken the scenario, add a
fallback router, or add test-only production bypasses.

- [ ] **Step 7: Run all focused recovery and finish suites**

```sh
npx --no-install prettier --write \
  test-support/run-once/planning-provider-scenario.ts \
  test-support/run-once/planning-github-process-fixture.ts \
  test-support/run-once/planning-forgejo-process-fixture.ts \
  src/cli/commands/run-once/planning-pipeline-provider-recovery.test.ts
node --test \
  src/cli/commands/run-once/planning-pipeline-provider-matrix.test.ts \
  src/cli/commands/run-once/planning-pipeline-provider-recovery.test.ts \
  src/cli/commands/run-once/planning-pipeline-scenarios.test.ts \
  src/cli/commands/run-once/planning-phase-runner.test.ts \
  src/cli/commands/run-once/planning-phase-publisher.test.ts \
  src/cli/commands/run-once/planning-phase-reconciler.test.ts \
  src/cli/commands/run-once/planning-implementation.test.ts \
  src/cli/commands/run-once/planning-finish.test.ts \
  src/workflow/planning-issue-lock.test.ts \
  src/workflow/planning-state-store.test.ts \
  src/git/planning-workspace-git.test.ts \
  src/git/planning-publication-git.test.ts
npm run check:contract-tests
npm run check:types
npm run check:architecture
```

Expected: both providers recover every named interruption without duplicate
remote/PR effects or lost human edits and fail closed for uncertain host state.

- [ ] **Step 8: Commit provider recovery coverage and any narrow fix**

```sh
git add \
  test-support/run-once/planning-provider-scenario.ts \
  test-support/run-once/planning-github-process-fixture.ts \
  test-support/run-once/planning-forgejo-process-fixture.ts \
  src/cli/commands/run-once/planning-pipeline-provider-recovery.test.ts
git add -u src/cli/commands/run-once src/git src/workflow
git diff --cached --check
git commit -m "test(run-once): cover provider planning recovery"
```

Expected: production files are staged only when a new end-to-end test exposed a
real issue #189 regression, with the narrow correction in the owning module.

---

### Task 8: Run final repository, site, package, and Nix verification

**Files:**

- Verify: all files changed by Tasks 1-7
- Verify: `skills/patchmill-planning/SKILL.md`
- Verify: `.patchmill/skills/patchmill-planning/SKILL.md`
- Verify: `.patchmill/skills/patchmill-skill-pack.json`
- Verify: `patchmill.config.json`
- Verify: `package.json`, `package-lock.json`, and `npm-shrinkwrap.json`
- Verify: `THIRD_PARTY_NOTICES.md`
- Do not modify: historical specs/plans or `.pi/todos`

**Interfaces:**

- Consumes: complete implementation and documentation branch.
- Produces: reproducible acceptance evidence with no staged local operator
  state.

- [ ] **Step 1: Run focused CLI, updater, router, and provider suites**

```sh
node --test \
  src/cli/legacy-planning-deprecations.test.ts \
  src/cli/main.test.ts \
  src/cli/commands/set-artifact/main.test.ts \
  src/cli/commands/run-once/main.test.ts \
  src/cli/commands/run-once/args.test.ts \
  src/cli/commands/run/reset/main.test.ts \
  src/cli/commands/run/reset/reset.test.ts \
  src/workflow/skill-pack.test.ts \
  src/workflow/skill-resolution.test.ts \
  src/cli/commands/skills/update.test.ts \
  src/cli/commands/skills/main.test.ts \
  src/cli/commands/run-once/planning-phase-coordinator.test.ts \
  src/cli/commands/run-once/planning-phase-runner.test.ts \
  src/cli/commands/run-once/planning-implementation-validation.test.ts \
  src/cli/commands/run-once/planning-finish.test.ts \
  src/cli/commands/run-once/planning-pipeline-facade.test.ts \
  src/cli/commands/run-once/planning-pipeline-provider-matrix.test.ts \
  src/cli/commands/run-once/planning-pipeline-provider-recovery.test.ts \
  scripts/superpowers-repository-contract.test.mjs
```

Expected: warnings, updater notice range, all eight gate cells, both-provider
interruptions, implementation validation, and legacy routing regressions pass.

- [ ] **Step 2: Re-run direct skill/package/config integrity checks**

Run Task 3 Step 8's `cmp`, Node integrity script, repository contract test, and
`npm ls --depth=0 superpowers` again from the final worktree. Also run:

```sh
rg -n 'v6\.3\.0|6\.3\.0' \
  package.json package-lock.json npm-shrinkwrap.json \
  src/workflow/skill-pack.ts \
  .patchmill/skills/patchmill-skill-pack.json \
  THIRD_PARTY_NOTICES.md
rg -n '2026\.09\.1' \
  src/workflow/skill-pack.ts \
  src/cli/commands/skills/update.ts \
  .patchmill/skills/patchmill-skill-pack.json
```

Expected: installed files exist at resolved paths, all source references remain
`v6.3.0`, and pack/notice/metadata use `2026.09.1`.

- [ ] **Step 3: Run the complete approved verification matrix exactly**

```sh
npm run test:run-once
npm test
npm run build
npm run lint
npm run check:types
npm run check:architecture
npm run site:build
nix build .#patchmill --print-build-logs
nix flake check --accept-flake-config --print-build-logs
git diff --check
```

Expected: every command exits with status `0`. The Nix commands are mandatory
for this issue even though no dependency change is planned.

- [ ] **Step 4: Audit dependency, scope, and compatibility boundaries**

```sh
git diff --name-only origin/main...HEAD
git diff --exit-code origin/main...HEAD -- \
  package.json package-lock.json npm-shrinkwrap.json
rg -n "Deprecated:|legacyPlanningDeprecation" \
  src/cli/legacy-planning-deprecations.ts \
  src/cli/main.ts \
  src/cli/commands/set-artifact/main.ts \
  src/cli/commands/run-once/main.ts \
  src/cli/commands/run/reset/main.ts
if rg -n "Deprecated:|legacyPlanningDeprecation" \
  src/cli/commands/run-once/planning-phase-coordinator.ts \
  src/cli/commands/run-once/planning-selection.ts \
  src/cli/commands/run-once/pipeline.ts \
  src/workflow src/host; then
  echo "deprecation policy leaked below the CLI boundary" >&2
  exit 1
fi
```

Expected: dependency metadata is unchanged; deprecation exists only at CLI
presentation boundaries; scenario support is under test files/test-support;
historical specs/plans are untouched; provider/state contracts are unchanged.

If the dependency diff is not empty, reconcile all three npm metadata files,
explain why the spec's no-dependency constraint changed, and rerun every npm and
Nix command before proceeding.

- [ ] **Step 5: Inspect commits and local operator state**

```sh
git status --short
git log --oneline --decorate -12
git diff --stat origin/main...HEAD
git diff --name-only --cached
```

Expected: no uncommitted tracked changes, no staged files, no `.pi/todos`
entries, and focused Conventional Commits corresponding to Tasks 1-7. Do not
create or merge a live GitHub or Forgejo pull request as part of verification.

- [ ] **Step 6: Record final validation evidence**

Append the exact commands and outcomes to the Task 8 local todo, including any
transient failure and rerun. If any required check remains failing, leave Task 8
open and report the failure instead of claiming completion.
