# Concurrent Explicit Run-once Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `subagent-driven-development`
> or `executing-plans` to implement this plan task-by-task. Steps use checkbox
> (`- [ ]`) syntax for tracking.

**Goal:** Allow independent explicit Run attempts in one clone without duplicate
issue ownership, evidence loss, or conflicting shared Git mutations.

**Architecture:** A canonical repository namespace coordinates admission, while
the existing common issue lease protects each Issue run. Short Git transactions
protect shared mutations without blocking independent agent work. Both workflows
publish implementation PRs and finish only after verified PR merges.

**Tech Stack:** TypeScript, Node.js `>=22.19.0`, Node test runner, local
filesystem locks, Git worktrees, existing GitHub and Forgejo host adapters.

**Spec:**
`docs/specs/2026-10-03-issue-226-support-concurrent-explicit-run-once-invocations-design.md`

## Global Constraints

- Scope: explicit invocations for different issues in one local clone, including
  planning, legacy work, resume, reset, and lease repair.
- Automatic selection remains serial. Automatic attempts cannot overlap explicit
  attempts or mutating recovery commands.
- Dry-run remains read-only and does not reserve ownership.
- Repository identity is the real path of the Git common directory.
- Acquisition order: admission registration, common issue lease, planning lock
  where applicable, then a Git transaction. Release follows reverse ownership
  order.
- The admission transaction never waits while holding its guard. No exclusive
  repository lock spans independent agent work.
- Same-issue contention reports `issue already in progress.` as a normal stop
  with exit code `0`. It has no repair advice.
- Malformed, foreign-host, and unverifiable ownership records remain
  fail-closed. Age alone never proves safe takeover.
- Legacy state stays at `<runStateDir>/issue-<number>.json`. Planning state
  stays at `<runStateDir>/planning-pr-v1/issues/issue-<number>.json`.
- Planning retains its Run ID, revision checks, immutable review gates, and
  phase-specific workspaces.
- PR creation records `pr-created`, not `merged` or Issue run completion.
- No configuration or skill can authorize an agent to merge and push the target
  branch directly.
- Default todos stay at `.pi/todos` within the issue workspace. Preserve
  existing todo locations, titles, tags, and completion rules on resume.
- Do not add a scheduler, Event ledger, distributed coordination, lock bypass,
  or a dependency on the full #154 refactor.
- Unmanaged shell commands and custom skills are not sandboxed. Custom hooks
  must restrict their effects to owned resources.
- No npm dependency update is planned. If dependency files change, run
  `nix build .#patchmill --print-build-logs`.

## Review Focus

1. A symlink or alternate config path cannot create a second ownership
   namespace. Task 1 proves canonicalization and mismatch rejection.
2. A requested issue changes after advisory selection. Tasks 2–3 prove
   authoritative rereads without labels or workspace mutations.
3. A saved implementation PR merges and closes its issue between attempts. Tasks
   8–9 prove finish-only recovery without fresh agent work.
4. A configured shared todo root contains old completed tasks for another issue.
   Task 5 proves that startup and cleanup preserve them.
5. An obsolete process releases a lock after takeover. Tasks 1, 2, 6, and 11
   prove token checks and checkpoint preservation.

## Source Reconciliation and File Boundaries

The inspected base is `cddfd6e3500544994e18454fe59ace03572d6027`, which includes
the source spec. Before implementation, record any changed base with
`git rev-parse HEAD`.

The public `runOneIssue` facade already pins legacy selection through
`runLegacyOneIssueForSelection`. Do not remove that pin or rewrite private
legacy precedence rules merely to allow explicit concurrency.
`loadSelectionIssues` still lists other issues for explicit execution. Planning
selection filters the target but does not hold the common lease.

Both finish adapters currently mark an issue done after PR creation. Tasks 8–9
change that behavior as the spec requires. Their narrow state extensions record
PR evidence, not a second issue-progress registry.

Issue #159 remains open. It preserves the `runOneIssue` interface and moves
private selection, recovery, and claim ownership. Preserve its pre-claim safety
boundary, post-claim blocked path, dry-run ordering, and serial fallback
behavior. Reconcile any newer #159 changes before editing `pipeline.ts`,
`pipeline-legacy.ts`, or recovery adapters. Do not require #158 or #159 to land
first. Issues #153 and #167 remain separate.

| Responsibility                           | Files                                                                                                     |
| ---------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| Canonical namespace and admission        | New `src/workflow/run-repository-namespace.ts` and `src/workflow/run-admission.ts`                        |
| Common ownership and routing             | Existing `recovery-lease.ts`, pipeline facade, legacy adapter, and planning issue adapter                 |
| Atomic legacy state and attempt evidence | Existing `run-state.ts`, `main.ts`, `progress.ts`, and Pi allocation adapters                             |
| Todo scope                               | New `src/cli/commands/run-once/issue-todo-contract.ts`, existing task adapters, and `extensions/todos.ts` |
| Shared Git transactions                  | New `src/git/repository-mutation.ts`, existing planning Git and legacy recovery adapters                  |
| PR-only policy                           | Existing config, prompts, bundled skills, installed skill copies, and landing policy                      |
| PR identity and merge proof              | New `src/workflow/implementation-pr-reconciliation.ts` and workflow-specific finish adapters              |
| Process regression evidence              | New controlled fixtures in `test-support/run-once/` and focused Run-once suites                           |

Keep namespace, admission, and mutation protocols separate. They have different
lock lifetimes. Keep new modules focused, preferably under 200 meaningful lines.
Add adapters instead of more control flow in the 991-line legacy pipeline or the
large Git module.

## Testing Value Gate and Execution Rules

Ownership, resume, state replacement, publication, and cleanup are risky
production behaviors. Their automated tests prove observable effects and can
detect meaningful regressions. They pass all four Testing Value Gate questions.

Use real temporary repositories and a local bare remote for Git and process
tests. Replace host and Pi effects with controlled substitutes. Use IPC barriers
or explicit command barriers, not sleeps, to prove overlap. No test needs paid
agents or live host mutations.

Do not add tests that assert document text, static config values, package
versions, or skill wording. Use formatting, Markdown lint, direct policy
inspection, and existing installer suites instead. Prompt tests must prove
generated runtime contracts or rejection behavior.

For Tasks 1–10, first run the named suite with the new regression. Record the
intended assertion failure. Then implement the change and run the same suite
until it passes. Commit only the task files after the green checkpoint. Do not
mark implementation todos complete merely because this plan exists.

## Task 1: Bind the Repository Namespace and Register Admission

**Files:**

- Create: `src/workflow/run-repository-namespace.ts`,
  `src/workflow/run-admission.ts`.
- Test: `src/workflow/run-repository-namespace.test.ts`,
  `src/workflow/run-admission.test.ts`.

**Interfaces:**

- `RunRepositoryNamespaceInput` contains `repoRoot: string`,
  `hostRepository: RepositoryIdentity`, `runStateDir: string`,
  `worktreeRoot: string`, and `todoRoot: string`.
- `resolveRunRepositoryNamespace(runner: CommandRunner, input: RunRepositoryNamespaceInput): Promise<RunRepositoryNamespace>`
  resolves identity without issue mutations.
- CLI adapters resolve the host repository before this call. Workflow helpers
  must not import CLI config types.
- `RunRepositoryNamespace` contains `commonDir`, `cloneRoot`,
  `hostRepository: RepositoryIdentity`, `runStateDir`, `worktreeRoot`, and
  `todoRoot`.
- `todoRoot` is
  `{ kind: "workspace-relative"; path: string } | { kind: "absolute"; path: string }`.
- `withRunAdmission<T>(input: { namespace: RunRepositoryNamespace; attemptId: string; mode: "explicit" | "automatic" | "recovery"; issueNumber?: number; signal?: AbortSignal }, action: (admission: RunAdmission) => Promise<T>): Promise<T>`
  owns only its registration.
- `RunAdmission` contains the namespace, attempt ID, selection mode, record
  path, and owner token.

- [ ] Add `canonical aliases share admission`, `explicit attempts coexist`,
      `automatic admission excludes every writer`, and
      `obsolete release preserves replacement`. Assert that two explicit
      registrations exist together. Assert that automatic/automatic and
      automatic/explicit admission rejects the second registration unchanged.
      Change each bound path and the host repository independently. Assert
      rejection before any issue effect.
- [ ] Run
      `node --test src/workflow/run-repository-namespace.test.ts src/workflow/run-admission.test.ts`
      and record the intended failures.
- [ ] Implement canonicalization through
      `git rev-parse --path-format=absolute --git-common-dir` and filesystem
      real paths. Resolve nonexistent configured paths through their nearest
      existing ancestor. Preserve workspace-relative todo configuration as a
      relative definition. Store versioned namespace and admission records under
      `<commonDir>/patchmill/run-once/`.
- [ ] Implement exclusive, token-owned admission transactions and atomic
      namespace initialization. Register explicit and recovery attempts
      together, but exclude automatic overlap in both directions. End the guard
      before the action starts. Reconcile demonstrably dead local records under
      an exclusive reconciliation guard. Recheck exact bytes and owner
      fingerprints before archival. Refuse unknown records without age-based
      takeover. Release only the caller's registration, including error and
      cancellation paths.
- [ ] Run the suite again. Assert that guard contention never waits while
      holding another guard. Include a concurrent first-initialization race,
      malformed records, foreign owners, live owners, and identical timestamps.
- [ ] Commit the namespace and admission files:
      `feat(run-once): coordinate repository admission`.

## Task 2: Hold One Common Lease Across Both Workflows

**Files:**

- Modify: `src/cli/commands/run-once/recovery-lease.ts`, `pipeline.ts`,
  `pipeline-legacy-types.ts`, `pipeline-legacy.ts`, `planning-pipeline.ts`,
  `planning-pipeline-issue.ts`.
- Modify: `src/cli/commands/run-once/types.ts`, `result-diagnostic-types.ts`,
  `result-diagnostic-general.ts`, `result-diagnostic-recovery.ts`,
  `result-summary.ts`.
- Test: existing `recovery-lease.test.ts`, `planning-pipeline-facade.test.ts`,
  `result-output.test.ts`.
- Create: `src/cli/commands/run-once/issue-ownership.test.ts`.

**Interfaces:**

- Add
  `assertIssueRunLeaseOwned(lease: IssueRunLease, expected: { runStateDir: string; issueNumber: number }): Promise<void>`.
- Internal adapters receive the existing `IssueRunLease` and Task 1's
  `RunAdmission`. Borrowed handles never release their owner.
- Allocate a UUID at facade entry and use it as the common lease's `ownerToken`.
  Task 4 also supplies it from the command entrypoint.
- Preserve `runOneIssue(runner, config, options = {})` and the existing
  selected-issue pin.
- Retain `status: "stopped", reason: "issue-locked"` for ordinary contention.
  Expand diagnostic context to describe either workflow's ownership resource.

- [ ] Add `planning and legacy share one owner` and
      `planning lock reacquisition retains common ownership`. Assert that only
      one callback changes the issue. Assert that the competing callback never
      initializes state, claims labels, or writes a started comment. Replace a
      lease token before a borrowed callback. Assert rejection before its first
      effect.
- [ ] Run
      `node --test src/cli/commands/run-once/issue-ownership.test.ts src/cli/commands/run-once/recovery-lease.test.ts src/cli/commands/run-once/planning-pipeline-facade.test.ts src/cli/commands/run-once/result-output.test.ts`.
- [ ] Register admission before any real selection. Acquire the common lease
      before explicit authoritative issue/state reads. For automatic selection,
      acquire it after advisory selection and repeat selected-issue checks under
      ownership. Pass the borrowed lease through legacy recursion, planning
      phases, and planning-lock reacquisition. Preserve planning revision
      authority.
- [ ] Separate live contention from malformed, foreign, and unverifiable lease
      records. Use the exact normal-stop message `issue already in progress.`
      for live common and workflow-lock contention. Return exit code `0` without
      repair guidance. Keep broken ownership records on the fail-closed
      diagnostic path. Do not run the post-claim blocker handler for a losing
      attempt or select another issue as its fallback.
- [ ] Run the suite again. Assert token-owned reverse-order release on success,
      exception, and cancellation. Cover the existing planning lock without a
      common lease, a changed planning Run ID, and a conflicting legacy
      checkpoint.
- [ ] Commit the ownership and diagnostic changes:
      `feat(run-once): unify issue ownership across workflows`.

## Task 3: Load Only the Explicit Target and Repeat Its Checks

**Files:**

- Modify: `src/cli/commands/run-once/pipeline-selection.ts`,
  `planning-selection.ts`, `pipeline-legacy-selection.ts`, `pipeline.ts`.
- Test: existing `pipeline.test.ts`, `pipeline-selection.test.ts`,
  `planning-selection.test.ts`.
- Create: `src/cli/commands/run-once/explicit-selection.test.ts`.

**Interfaces:**

- Keep `loadSelectionIssues(host, config, options): Promise<IssueSummary[]>`.
- For `--issue N`, return only issue N and hydrate only its comments. Tasks 1–2
  provide admission and authoritative lease scope.
- Add
  `planningImplementationNeedsMergeReconciliation(state: PlanningStateV1): boolean`
  and
  `legacyImplementationNeedsMergeReconciliation(state: AgentIssueRunState): boolean`
  to `planning-selection.ts`.
- These predicates identify saved PR handoffs, including older completion
  checkpoints without merge proof. Tasks 8–9 consume them for finish-only
  routing.
- Leave private automatic priority, approval waits, resumable precedence, and
  safe fallback rules unchanged.

- [ ] Add `explicit fresh selection ignores unrelated recovery` and
      `explicit resume never reads another issue` through `runOneIssue`. Make
      `listOpenIssues` and reads of unrelated comments or state throw. Assert
      that the requested issue still reaches its agent barrier. Cover planning,
      legacy, blocked retry, multiple active checkpoints, and malformed
      unrelated state.
- [ ] Run
      `node --test src/cli/commands/run-once/explicit-selection.test.ts src/cli/commands/run-once/pipeline.test.ts src/cli/commands/run-once/pipeline-selection.test.ts src/cli/commands/run-once/planning-selection.test.ts`.
- [ ] Remove the explicit-path open-issue listing and cross-issue hydration.
      Keep the public legacy pin. Retain existing eligibility, approvals,
      artifact checks, and same-issue planning/legacy conflict rejection. Reread
      the issue, comments, and selected checkpoint under the common lease before
      routing or recovery. Validate the requested legacy checkpoint with
      `validateRecoveryRunState(state, issue.number)` before any issue effect.
- [ ] Add `post-lease eligibility change prevents mutation` and
      `requested conflicting state stays blocked`. Assert no changes to labels,
      comments, state bytes, or workspace files. A title or identity change
      cannot redirect the saved workspace. Add finish-only routing for a saved
      implementation PR, including a host-closed issue, as Tasks 8–9 define. An
      unrelated closed issue and a manually closed issue without verified PR
      evidence remain ineligible.
- [ ] Run the suite again. Assert unchanged serial selection traces and
      read-only dry-run behavior.
- [ ] Commit selection changes:
      `fix(run-once): restrict explicit selection to its issue`.

## Task 4: Make Legacy Writes Atomic and Allocate Unique Attempt Evidence

**Files:**

- Modify: `src/cli/commands/run-once/run-state.ts`, `main.ts`, `progress.ts`,
  `pipeline-progress.ts`, `pipeline-legacy-types.ts`, `pipeline-legacy.ts`,
  `planning-pipeline.ts`, `pi.ts`.
- Modify callers: `pipeline-implementation.ts`, `pipeline-finish.ts`,
  `pipeline-failures.ts`, `development-environment-stage.ts`,
  `pipeline-recovery.ts`, `recovery-archive.ts`.
- Test: existing `run-state.test.ts`, `progress.test.ts`, `main.test.ts`,
  `pi.test.ts`.
- Create: `src/cli/commands/run-once/attempt-evidence.test.ts`.

**Interfaces:**

- Add optional `attemptId: string` to `RunOneIssueOptions`. Allocate a random
  UUID for callers that omit it.
- `runLogPath(runStateDir: string, timestamp: string, attemptId: string, issueNumber?: number): string`
  and
  `runPiSessionPath(runStateDir: string, timestamp: string, attemptId: string, issueNumber: number): string`
  use one ID throughout each Run attempt.
- State temporary names include the lease owner token, which is the same attempt
  ID.
- `writeRunState(runStateDir: string, update: AgentIssueRunStateUpdate, lease: IssueRunLease, now?: string): Promise<AgentIssueRunState>`
  replaces ordinary writes.
- Add a required lease argument to reset replacement, protocol adoption, and
  `archiveRunRecovery`.
- Progress events can contain `attemptId`, `phase`, and saved planning `runId`
  in addition to issue identity.

- [ ] Add `failed replacement preserves complete old state`,
      `wrong lease cannot write`, and
      `equal timestamps produce separate evidence`. Read state repeatedly across
      a controlled write barrier. Assert that every read is a complete old or
      new JSON document. Precreate a final log destination. Assert that its
      bytes never change.
- [ ] Run
      `node --test src/cli/commands/run-once/attempt-evidence.test.ts src/cli/commands/run-once/run-state.test.ts src/cli/commands/run-once/progress.test.ts src/cli/commands/run-once/main.test.ts src/cli/commands/run-once/pi.test.ts`.
- [ ] Allocate the attempt ID before preliminary log creation. Create logs
      exclusively. Include the ID in session roots and state temporary
      filenames. Preserve unique Pi invocation directories and exclusive parent
      files. Replace final-log overwrite behavior with a no-replace operation.
      If placement fails, preserve the preliminary log.
- [ ] Use exclusive temporary files and atomic replacement for ordinary legacy
      writes. Assert current lease ownership before merge/read and immediately
      before replacement. Remove only this attempt's temporary files on failure.
      Keep state filenames, checkpoint merge rules, and prior evidence
      compatible. Update every production write caller to pass its lease.
- [ ] Run the suite again. Cover resume with a new attempt ID, log placement
      errors, token replacement, and another issue's unchanged state.
- [ ] Commit state and evidence changes:
      `fix(run-once): isolate attempt evidence and state writes`.

## Task 5: Resolve Todos in the Owned Workspace and Protect Shared Roots

**Files:**

- Create: `src/cli/commands/run-once/issue-todo-contract.ts`,
  `issue-todo-contract.test.ts`.
- Modify: `planning-phase-artifacts.ts`, `planning-implementation-adapter.ts`,
  `implementation-agent.ts`, `implementation-task-progress.ts`, `pi.ts`,
  `issue-todos.ts` under `src/cli/commands/run-once/`.
- Modify: `src/policy/task-contract.ts`, `src/cli/commands/run-once/types.ts`,
  `src/cli/commands/run-once/run-state.ts`, `src/git/planning-workspaces.ts`,
  `src/workflow/planning-state-workspace-codec.ts` for optional saved todo-root
  evidence.
- Modify: `extensions/todos.ts`.
- Test: existing `src/cli/commands/run-once/issue-todos.test.ts`,
  `test-support/todos-extension.test.ts`.

**Interfaces:**

- `resolveIssueTodoContract(worktreeRoot: string, contract: PatchmillPiTaskContract, resumedTodoRoot?: string): PatchmillPiTaskContract`
  returns the effective contract.
- Use the same root for prompts, `PI_TODO_PATH`, task progress, and final
  handoff checks.
- Persist the resolved todo location with owned workspace evidence. It does not
  create another issue directory.

- [ ] Add `default todos stay in workspace`,
      `relative custom roots use actual cwd`, and
      `resume preserves previous todo location`. Assert equal paths across the
      prompt, Pi environment, progress reader, and final gate. Put an older
      closed task for another issue in an absolute shared root. Assert unchanged
      bytes after startup and cleanup.
- [ ] Run
      `node --test src/cli/commands/run-once/issue-todo-contract.test.ts src/cli/commands/run-once/issue-todos.test.ts test-support/todos-extension.test.ts`.
- [ ] Remove clone-root rebasing from planning artifact and implementation
      adapters. Resolve new relative roots against the actual phase workspace.
      Preserve configured absolute roots and saved resumed roots. For older
      planning checkpoints, inspect existing issue-matching todos at the
      previous clone-root location before selecting a new root. If tasks exist
      there, preserve that location. Refuse ambiguous existing locations instead
      of moving tasks or combining completion evidence.
- [ ] Apply isolation only to roots outside the owned workspace. Pass an issue
      scope to the bundled todo extension for genuinely shared roots. Disable
      global garbage collection in this mode. Filter reads and mutations by the
      configured issue title pattern or issue tags. Reject mutation of another
      issue's todo by ID. Leave ordinary interactive todo behavior and
      workspace-local defaults unchanged.
- [ ] Run the suite again. Cover custom title patterns, missing issue
      placeholders, all accepted terminal statuses, and unchanged resumed
      titles/tags. Validate saved root evidence before Pi startup. Assert that a
      saved root for another issue workspace cannot redirect the resumed
      contract.
- [ ] Commit todo isolation:
      `fix(run-once): scope shared todo roots to their issue`.

## Task 6: Guard Shared Git Transactions

**Files:**

- Create: `src/git/repository-mutation.ts`,
  `src/git/repository-mutation.test.ts`.
- Modify: `src/git/planning-remote-base.ts`, `planning-workspace-git.ts`,
  `planning-workspace-inspection.ts`, `planning-workspace-cleanup.ts`,
  `planning-head-adoption-git.ts`.
- Modify: `src/cli/commands/run-once/git.ts`, `recovery-mutation.ts`,
  `recovery-mutation-helpers.ts`, `recovery-mutation-refresh.ts`,
  `recovery-mutation-reset.ts`, `recovery-mutation-recreate.ts`,
  `planning-runtime.ts`.
- Modify: `src/cli/commands/run-once/types.ts`, `pipeline-failures.ts`, result
  diagnostic catalog/types, and result summary/output adapters.
- Test: existing `src/git/planning-workspace-git.test.ts`,
  `planning-head-adoption-git.real.test.ts`, `planning-remote-base.test.ts`.
- Create: `src/cli/commands/run-once/git-concurrency.test.ts`.

**Interfaces:**

- `RepositoryMutationContext` contains Task 1's namespace, attempt ID, and
  `assertOwned: () => Promise<void>`.
- `withRepositoryMutation<T>(context: RepositoryMutationContext, action: (transaction: RepositoryGitTransaction) => Promise<T>, options?: { signal?: AbortSignal; waitMs?: number; commandMs?: number }): Promise<T>`.
- `RepositoryGitTransaction.run(args: string[], options?: CommandRunOptions): Promise<CommandResult>`
  uses the existing runner with an abortable command timeout.
- Defaults: `waitMs = 10_000`, `commandMs = 60_000`. These are internal bounded
  limits, not scheduler configuration.
- A wait timeout throws `RepositoryMutationBusyError` before the action starts.
  Map it to `status: "stopped", reason: "repository-busy"` for the selected
  issue.
- Add cataloged retry guidance for `repository-busy`. Keep malformed ownership
  and interrupted commands separate from ordinary contention.

- [ ] Add `worktree transactions serialize`,
      `busy transaction preserves checkpoint`, and
      `stale deletion observation cannot delete new head`. Hold the first
      transaction at a barrier. Assert that the second cannot mutate
      registrations until release. Change the branch after observation. Assert
      expected-OID deletion fails and preserves the new head.
- [ ] Run
      `node --test src/git/repository-mutation.test.ts src/cli/commands/run-once/git-concurrency.test.ts src/git/planning-workspace-git.test.ts src/git/planning-head-adoption-git.real.test.ts src/git/planning-remote-base.test.ts`.
- [ ] Implement the token-owned mutation guard under
      `<commonDir>/patchmill/run-once/`. Reconcile dead local guards with exact
      fingerprints under an exclusive reconciliation guard. Preserve interrupted
      evidence. Refuse malformed, foreign, and unverifiable records. An
      unrelated explicit attempt can still do agent work without this Git guard.
      Compose command timeout signals with cancellation. Do not release a live
      command's guard before it stops.
- [ ] Wrap fetch-and-snapshot, worktree registration, recovery ref changes, and
      branch deletion as complete transactions. Repeat lease, phase identity,
      path, branch, registration, and expected-OID checks after acquisition. Use
      pinned OIDs or issue/attempt-specific evidence refs. Never read a shared
      `FETCH_HEAD` after another fetch can replace it. Replace legacy
      `git branch -D` with
      `git update-ref -d refs/heads/<branch> <expectedOid>`.
- [ ] Run the suite again. Cover command timeout, cancellation, dead-guard
      reconciliation, and obsolete release. Assert no broad worktree pruning,
      shared-worktree reset, shared Git config mutation, or force publication.
      Keep agent execution, validation, review, and non-force issue-branch push
      outside the guard. Intercept `RepositoryMutationBusyError` before
      `blockIssue` or `unexpectedFailure`. Preserve the checkpoint and lifecycle
      labels. For a command timeout after partial work, preserve mutation
      evidence and unfinished recovery state. Never assert that no mutation
      occurred.
- [ ] Commit Git transaction changes:
      `feat(git): serialize shared run-once mutations`.

## Task 7: Enforce PR-only Publication in Config, Prompts, and Skills

**Files:**

- Modify: `src/git/worktree-strategy.ts`, `src/config/load.ts`,
  `src/config/defaults.ts`, `src/config/types.ts`.
- Modify: `src/cli/commands/run-once/implementation-agent.ts`,
  `implementation-landing-prompt.ts`, `prompt-workflow.ts`,
  `pipeline-lifecycle.ts`, `pipeline-implementation.ts`.
- Modify: `skills/subagent-dev-with-validation-and-pr-checks/SKILL.md`,
  `skills/subagent-dev-with-codex-and-thermo-reviews/SKILL.md`,
  `skills/single-subagent-dev-with-codex-and-thermo-reviews/SKILL.md` and their
  tracked installed copies under `.patchmill/skills/`.
- Modify: `.patchmill/skills/landing/SKILL.md`,
  `.patchmill/skills/patchmill-skill-pack.json`, `src/workflow/skill-pack.ts`,
  `patchmill.config.json`.
- Test: existing `src/config/load.test.ts`,
  `src/cli/commands/run-once/prompts.test.ts`, `pipeline-landing.test.ts`,
  `implementation-agent.test.ts`,
  `src/cli/commands/init/skill-installer.test.ts`.

**Interfaces:**

- Default `git.allowDirectLand` becomes `false`. Keep `false` readable for
  compatibility. Reject explicit `true` with PR-only migration guidance.
- Preserve `skills.landing` as PR review/handoff policy, not authority over
  target refs.
- Agents can return `pr-created` or `blocked`. Only Patchmill's verified PR
  reconciliation can produce a `merged` workflow result.

- [ ] Add runtime regressions for omitted/false/true direct-land policy and a
      legacy agent that returns `merged`. Assert that omitted and false policy
      generate PR-only contracts. Assert that true policy fails before issue
      effects. Assert that an agent-supplied direct merge never reaches the
      finish adapter, even with a custom landing skill.
- [ ] Run
      `node --test src/config/load.test.ts src/cli/commands/run-once/prompts.test.ts src/cli/commands/run-once/pipeline-landing.test.ts src/cli/commands/run-once/implementation-agent.test.ts src/cli/commands/init/skill-installer.test.ts`.
- [ ] Remove direct-target update, squash-merge, push, and direct-merge JSON
      contracts from runtime prompts and bundled workflow skills. Keep normal PR
      validation, independent review, checks, and repair gates. Restrict
      publication to the owned branch and PR. Read `writing-skills` before
      editing skills. Update tracked installed copies and metadata through the
      existing installer procedure. Set the local pack version to `2026.10.1`.
      Keep upstream Superpowers `v6.4.2` and Simple English `v1.2.0` unchanged.
- [ ] Inspect every direct-landing policy surface, including configuration
      examples and development-environment handoffs. Run existing skill-pack and
      installer suites. Verify installed upstream files and version references
      with Task 12's commands. Do not add static skill-text or version tests.
- [ ] Run the runtime regression suite again. Verify that a custom skill does
      not change the enforced output contract.
- [ ] Commit PR-only policy:
      `feat(run-once): require implementation pull requests`.

## Task 8: Reconcile Planning Implementation PRs Before Completion

**Files:**

- Create: `src/workflow/implementation-pr-reconciliation.ts`,
  `src/workflow/implementation-pr-reconciliation.test.ts`.
- Modify: `src/workflow/planning-state-types.ts`,
  `planning-state-implementation-codec.ts`, `planning-state-validation.ts`,
  `planning-state-transitions.ts`, `planning-state-store.ts`.
- Modify: `src/cli/commands/run-once/planning-implementation.ts`,
  `planning-implementation-validation.ts`, `planning-finish.ts`,
  `planning-finish-effects.ts`, `planning-phase-runner-implementation.ts`,
  `planning-phase-runner-shared.ts`, `planning-phase-coordinator.ts`,
  `planning-pipeline.ts`, `planning-pipeline-issue.ts`, `planning-selection.ts`,
  `planning-runtime-state.ts`.
- Test: existing `src/cli/commands/run-once/planning-finish.test.ts`,
  `planning-implementation.test.ts`,
  `planning-pipeline-provider-recovery.test.ts`,
  `src/workflow/planning-state.test.ts`.

**Interfaces:**

- `ImplementationPrEvidence` contains `reference: PullRequestReference`,
  `url: string`, `publication: PlanningPublicationEvidence`, and
  `ownershipMarkerRequired: boolean`.
- `ImplementationPrReconciliation` is
  `{ kind: "open" } | { kind: "merged"; mergeOid: string; mergedBaseOid: string } | { kind: "blocked"; reason: string }`.
- `findOwnedImplementationPullRequest(input: { host: PullRequestHost; issueNumber: number; evidence: Omit<ImplementationPrEvidence, "reference" | "url"> }): Promise<ImplementationPrEvidence | undefined>`
  recovers publication before its local receipt.
- `reconcileImplementationPullRequest(input: { host: PullRequestHost; issueNumber: number; evidence: ImplementationPrEvidence; fetchBase: () => Promise<{ baseOid: string }>; git: Pick<PlanningPublicationOperations, "assertAncestor"> }): Promise<ImplementationPrReconciliation>`.
- Planning implementation phases gain optional
  `merge: { mergeOid: string; mergedBaseOid: string }` evidence. New complete
  phases require this evidence.
- Add
  `{ kind: "implementation-published"; state: PlanningStateV1; result: AgentIssuePrCreatedResult }`
  to both planning runner and coordinator outcomes.
- This outcome exits the coordinator and returns public `pr-created` without a
  complete phase. It must not repeat the same phase indefinitely.
- Verified completion returns public `merged` from saved PR evidence.
- Add
  `durableMergedImplementationResult(phase: ImplementationCompletePlanningPhase): AgentIssueMergedResult`
  to `planning-runtime-state.ts`.
- `PlanningStateStore.reopenUnverifiedImplementation(input: { issueNumber: number; expectedRunId: string; expectedRevision: number; lock: PlanningIssueLock }): Promise<PlanningStateV1>`
  is a narrow compatibility operation.
- It archives exact old state before one revision change. It accepts only an old
  complete implementation PR without merge proof, never a verified completion.

- [ ] Add `open implementation PR leaves Issue run unfinished`,
      `merged PR closes issue but resumes finish`, and
      `publication crash reuses the same PR`. Assert `in-progress`, no done
      label, and a resumable `pull-request-open` checkpoint after handoff. After
      the host merges the PR, assert no new agent invocation, PR, or
      target-branch push.
- [ ] Run
      `node --test src/workflow/implementation-pr-reconciliation.test.ts src/workflow/planning-state.test.ts src/cli/commands/run-once/planning-finish.test.ts src/cli/commands/run-once/planning-implementation.test.ts src/cli/commands/run-once/planning-pipeline-provider-recovery.test.ts`.
- [ ] Implement exact PR identity and merge proof through existing host reads
      and guarded base fetch. Verify repository, URL/reference, base branch,
      head branch/OID, closing reference, and required ownership marker. For
      merged PRs, verify the merge commit against the pinned fetched target
      base. Never treat an absent issue branch as proof of completion. Missing,
      ambiguous, closed-unmerged, or conflicting saved PR evidence blocks
      without a replacement PR. Before agent reentry after a publication crash,
      search the exact owned branch with `findOwnedImplementationPullRequest`.
      Zero matches permit ordinary unpublished resume. One proven match
      preserves that PR. Multiple matches block. If review evidence is absent,
      run normal checks and repair against that PR. Do not fabricate validation
      or publish another PR.
- [ ] Separate publication finish effects from Issue run completion. Preserve
      cost, visual evidence, handoff, hook, and safe cleanup checkpoints. An
      open PR returns after publication effects without done labels. Save
      verified merge evidence before done-label effects. Complete only after the
      remaining finish checkpoints. Extend strict codecs and transitions
      narrowly. Preserve one revision edge per saved change and immutable phase
      identity.
- [ ] Run the suite again with crashes before/after PR publication, merge
      observation, done labels, and workspace/branch cleanup. Cover base
      advancement, normal PR repair, deleted remote branches, host-read errors,
      and a manually closed issue with an unmerged PR. Parse older complete
      implementation phases without merge evidence, but do not interpret them as
      verified landing. For explicit compatibility recovery, verify the saved PR
      before `reopenUnverifiedImplementation`. Hold both ownership handles
      throughout. Change only that phase to `pull-request-open`. Retain its
      identity and publication receipts, but archive and clear old done-label
      receipts. Restore the logical in-progress lifecycle for a proven open PR.
      Never silently reopen a host-closed issue. A merged-and-closed issue
      permits only verified finish recovery. Never fabricate merge evidence or
      weaken ordinary complete-phase immutability.
- [ ] Commit planning PR recovery:
      `fix(run-once): complete planning issues only after PR merge`.

## Task 9: Bring Legacy PR Handoff and Finish Recovery Under the Same Contract

**Files:**

- Create: `src/cli/commands/run-once/legacy-pr-reconciliation.ts`,
  `legacy-pr-reconciliation.test.ts`.
- Modify: `src/cli/commands/run-once/pipeline-legacy.ts`,
  `pipeline-implementation.ts`, `pipeline-finish.ts`, `pipeline-lifecycle.ts`,
  `planning-selection.ts`, `run-state.ts`, `types.ts`.
- Test: existing `pipeline-finish.test.ts`, `pipeline-recovery.test.ts`,
  `pipeline-landing.test.ts`, `run-state.test.ts`.

**Interfaces:**

- Legacy state gains optional `implementationPr: ImplementationPrEvidence` and
  verified `merge` evidence from Task 8.
- Add durable `cleanupHookCompleted`, `worktreeRemoved`, and `branchRemoved`
  checkpoints for resumable PR cleanup.
- Keep saved `implementationStatus: "pr-created"`, PR URL, commits, validation,
  and branch evidence after handoff.
- `reconcileLegacyImplementationPr` adapts an owned legacy checkpoint to Task
  8's reconciler and returns an open, merged, or blocked result.

- [ ] Add `legacy PR handoff retains in-progress`,
      `legacy PR resume skips agents`, and
      `legacy cleanup crash does not repeat another issue's cleanup`. Assert
      that a saved open PR never marks the Issue run finished. Assert that host
      merge, not the agent's result, authorizes completion.
- [ ] Run
      `node --test src/cli/commands/run-once/legacy-pr-reconciliation.test.ts src/cli/commands/run-once/pipeline-finish.test.ts src/cli/commands/run-once/pipeline-recovery.test.ts src/cli/commands/run-once/pipeline-landing.test.ts src/cli/commands/run-once/run-state.test.ts`.
- [ ] Save canonical PR evidence before handoff and route resumed published PRs
      to reconciliation before workspace creation or agent execution. Require
      the ownership marker for new legacy PRs. Adopt older PRs without a marker
      only after exact URL, repository, issue reference, branch, and head proof.
      Preserve the saved PR URL after merge. Do not discard evidence merely
      because `implementationStatus` changes. Use Task 8's owned-PR discovery
      for a crash between publication and state replacement. Resume checks on
      that PR without duplicate publication.
- [ ] Keep legacy publication unfinished until Task 8 proves the PR merge. Use
      owned atomic state writes for each cleanup and done-label receipt. Use
      Task 6 for validated, expected-OID cleanup. Preserve ignored-content
      safety and cleanup-pending recovery. Never recreate a removed workspace
      merely to observe a saved PR.
- [ ] Run the suite again. Cover older `finished`/`pr-created` checkpoints for
      an open issue, merged-and-closed issues, and interrupted finish effects. A
      saved direct-land `merged` checkpoint without a PR cannot authorize new
      mutation or false completion. Preserve that old evidence and return
      migration guidance. Do not invent a PR or reimplement the issue. Archive
      an older false-completion checkpoint before its owned compatibility
      replacement. Clear only premature done-label receipts. Retain all
      publication and cleanup evidence. Restore in-progress only for a proven
      open PR on an open issue. Assert that unrelated state, labels, workspaces,
      and branch heads remain unchanged.
- [ ] Commit legacy PR recovery:
      `fix(run-once): preserve legacy PR ownership through landing`.

## Task 10: Integrate Reset, Repair, and Cancellation With Common Ownership

**Files:**

- Modify: `src/cli/commands/run/reset/reset.ts`,
  `src/cli/commands/run/lease/repair.ts`, `src/cli/commands/run/config.ts`.
- Modify: `src/cli/commands/run-once/recovery-lease-repair.ts`,
  `recovery-archive.ts`, `pipeline-recovery.ts`, `recovery-mutation.ts`,
  `pipeline-failures.ts`.
- Test: existing `src/cli/commands/run/reset/reset.test.ts`,
  `src/cli/commands/run/lease/repair.test.ts`,
  `src/cli/commands/run-once/recovery-lease-repair.test.ts`.
- Create: `src/cli/commands/run-once/recovery-concurrency.test.ts`.

**Interfaces:**

- Reset borrows Task 1's recovery admission and the common issue lease into its
  restarted legacy pipeline.
- Mutating repair registers recovery admission, then uses its existing exclusive
  repair guard and exact fingerprints as issue mutation authority.
- Read-only repair inspection reserves no ownership. Repair never acquires a
  broken lease as permission to remove it.

- [ ] Add `reset cannot take planning ownership`,
      `repair excludes a live common owner`, and
      `recovery admission rejects automatic overlap`. Assert that a losing
      recovery command preserves raw state, locks, labels, comments, workspace
      files, and refs.
- [ ] Run
      `node --test src/cli/commands/run-once/recovery-concurrency.test.ts src/cli/commands/run/reset/reset.test.ts src/cli/commands/run/lease/repair.test.ts src/cli/commands/run-once/recovery-lease-repair.test.ts`.
- [ ] Apply namespace and admission checks before reset or repair mutations.
      Recheck selected-issue ownership and state under their guard. Preserve
      existing exclusive repair and fingerprint boundaries. Token-protect
      repair-guard release. Refuse planning state on legacy reset and never
      remove a planning lock through lease repair.
- [ ] Route cancellation through the existing Run attempt shutdown path. Retain
      unfinished checkpoints. Release only owned handles after affected commands
      stop. If release also fails, preserve the original exception. Do not
      translate exit, a dead PID, or PR creation into Issue run completion.
- [ ] Run the suite again with stale-owner races, changed repair fingerprints,
      borrowed reset leases, and cancellation during a Git transaction.
- [ ] Commit recovery integration:
      `fix(run-once): coordinate recovery and cancellation ownership`.

## Task 11: Prove Overlapping Processes and Conflicting Publication

**Files:**

- Create: `test-support/run-once/concurrent-run-scenario.ts`,
  `concurrent-run-process.ts`, `concurrent-host-fixture.ts`.
- Create: `src/cli/commands/run-once/concurrent-explicit-process.test.ts`,
  `concurrent-recovery-process.test.ts`.
- Modify reusable fixtures: `test-support/run-once/planning-provider-git.ts`,
  `planning-provider-runner.ts`, `planning-provider-scenario.ts` only where
  needed for multi-issue control.
- Modify: `src/cli/commands/run-once/main.ts` for a narrow dependency seam that
  runs the real command entrypoint with controlled effects.

**Interfaces:**

- `main(args?: string[], dependencies?: Partial<{ loadConfig: typeof loadCliConfig; createRunner: typeof createCommandRunner }>): Promise<number>`
  permits controlled test effects.
- Each child runs the production `runOneIssue` facade in the same temporary
  clone with the normal result/exit adapter.
- Include command-entrypoint coverage for explicit loading, logs, and same-issue
  exit behavior. Test dependencies must not create a production environment
  bypass.
- The fixture controls issue/PR host state and fake Pi output through IPC. Real
  Git commands still use the local bare remote.

- [ ] Add barrier-driven process tests for planning/planning, legacy/legacy, and
      planning/legacy explicit attempts. Assert
      `bothAgentBarriersReached === true` before either release. Assert distinct
      owned branches, workspaces, logs, and sessions.
- [ ] Run
      `node --test src/cli/commands/run-once/concurrent-explicit-process.test.ts src/cli/commands/run-once/concurrent-recovery-process.test.ts`.
      Record observable overlap and any meaningful regression failure. Do not
      manufacture failures in already implemented behavior.
- [ ] Add same-issue races through common leases and preexisting workflow locks.
      Assert exactly one agent entry, loser exit code `0`, and
      `issue already in progress.` without repair advice. Compare state bytes,
      lifecycle labels/comments, workspace contents, artifact files, and branch
      heads before and after the loser.
- [ ] Add explicit fresh/resume tests beside unrelated active, blocked,
      resumable, and malformed state. Add automatic/automatic and
      automatic/explicit races in both startup orders. Assert dry-run creates no
      ownership records. Terminate one child after a checkpoint. Resume the same
      Issue run with new evidence, unchanged saved PR identity, and no duplicate
      publication.
- [ ] Add simultaneous worktree/recovery/deletion transactions and overlapping
      PR landing scenarios. Serialize simulated host merges with expected target
      OIDs. Advance the base between attempts or fail one PR check. Assert that
      both changes survive verified merges, or the conflicting PR remains open
      for normal repair. Assert no agent-owned target merge/push, no forced ref
      overwrite, and no Git guard during agent or review barriers. Bound every
      child wait and terminate fixtures in `finally`. Preserve diagnostic
      evidence on timeout.
- [ ] Run both process suites again, then `npm run test:run-once`. Commit the
      process regressions:
      `test(run-once): cover concurrent explicit processes`.

## Task 12: Document the Operator Contract and Run Final Validation

**Files:**

- Modify: `src/cli/commands/run-once/main.ts` help text.
- Modify: `site/src/content/docs/using-patchmill/run-once.md`,
  `site/src/content/docs/reference/git-safety.md`,
  `site/src/content/docs/getting-started/configuration.md`, `README.md`.
- Carry: the source spec and this plan with the implementation branch.

**Interfaces:**

- Documentation describes Tasks 1–11 as one operator contract. It adds no new
  configuration or concurrency scheduler.

- [ ] Document concurrent explicit commands, intentional resume, and the normal
      same-issue stop with exit code `0`. Document busy Git retry guidance,
      PR-only publication, and the distinction between process exit and Issue
      run completion.
- [ ] Document independent-issue selection, spending/capacity, CPU, ports, and
      test-database responsibility. Require one supported version, clone root,
      and bound namespace. Require stopped processes before upgrade or state
      migration. List unsupported separate clones/hosts, concurrent
      config/artifact edits, manual shared Git mutation, and shared-resource
      cleanup hooks. Prohibit removal of another Run attempt's locks or
      destructive cleanup as recovery.
- [ ] Document unchanged default todos, relative custom roots, scoped shared
      roots, and existing-path resume behavior. Remove direct-landing
      authorization from all operator examples. Apply the `simple-english`
      self-check.
- [ ] Verify the skill-pack integration without adding static tests:

  ```bash
  node --input-type=module -e '
  import { access, readFile } from "node:fs/promises";
  import { join } from "node:path";
  import { defaultSkillSourceRoots, sourceRootFor } from "./src/cli/commands/init/skill-installer.ts";
  import { PATCHMILL_RECOMMENDED_SKILL_PACK as pack, hashContent } from "./src/workflow/skill-pack.ts";
  const roots = defaultSkillSourceRoots();
  for (const skill of pack.skills) {
    await access(join(sourceRootFor(skill, roots), skill.name, "SKILL.md"));
  }
  const pkg = JSON.parse(await readFile("package.json", "utf8"));
  const metadata = JSON.parse(await readFile(".patchmill/skills/patchmill-skill-pack.json", "utf8"));
  if (pkg.dependencies.superpowers !== pack.source.tarballUrl) throw new Error("Superpowers source mismatch");
  if (metadata.pack.version !== pack.version) throw new Error("Installed pack version mismatch");
  if (metadata.pack.source.tag !== pack.source.tag) throw new Error("Installed upstream tag mismatch");
  const english = JSON.parse(await readFile("vendor/simple-english/package.json", "utf8"));
  if (!pack.additionalSources.some(source => source.tag === `v${english.version}`)) throw new Error("Simple English source mismatch");
  if (!metadata.pack.additionalSources?.some(source => source.tag === `v${english.version}`)) throw new Error("Installed Simple English tag mismatch");
  for (const file of metadata.files) {
    if (hashContent(await readFile(file.path)) !== file.sha256) throw new Error(`Installed skill hash mismatch: ${file.path}`);
  }
  console.log("Installed skill paths, hashes, and source versions agree");
  '
  npm ls superpowers simple-english --depth=0
  node --test src/workflow/skill-pack.test.ts src/cli/commands/init/skill-installer.test.ts src/cli/commands/init/skill-installer-path-mode.test.ts
  ```

  Expected: every resolved source file exists and all commands exit `0`. Also
  inspect installed metadata hashes, lockfile/shrinkwrap references, and tracked
  installed skill copies for consistency. Verify additional-source metadata
  against the same Simple English version. No upstream dependency upgrade is
  part of this task.

- [ ] Run final validation from the issue worktree:

  ```bash
  node --test src/workflow/run-repository-namespace.test.ts src/workflow/run-admission.test.ts src/cli/commands/run-once/issue-ownership.test.ts src/git/repository-mutation.test.ts src/cli/commands/run-once/concurrent-explicit-process.test.ts src/cli/commands/run-once/concurrent-recovery-process.test.ts
  npm run test:run-once
  npm test
  npm run check:types
  npm run check:architecture
  npm run lint
  npm run build
  npm run site:build
  git diff --check
  ```

  Expected: all commands exit `0`. Record test counts and any repaired failures
  in the corresponding todo. If npm dependency metadata changes, also run
  `nix build .#patchmill --print-build-logs` and require exit `0`. Documentation
  uses lint, formatting, the site build, and direct review instead of new
  document-text tests.

- [ ] Review the complete worktree against the spec's verification table. Verify
      behavioral evidence for each required scenario. Verify token ownership for
      every release. Verify that no exclusive guard spans agent work. Commit
      documentation and validation notes:
      `docs(run-once): explain explicit concurrency and PR-only completion`.

## Planning-only Checkpoint

This phase writes no implementation code and creates no planning pull request.

- [ ] Self-review every task against the source spec, the Testing Value Gate,
      and the five Review Focus cases.
- [ ] Verify exact file paths, interface consistency, task dependencies, and
      short imperative steps.
- [ ] Create one local todo per numbered implementation task with purpose,
      source checklist item, checkpoint, and validation notes.
- [ ] Run direct artifact validation:

  ```bash
  npx --no-install prettier --check docs/plans/2026-10-03-issue-226-support-concurrent-explicit-run-once-invocations.md
  npx --no-install markdownlint-cli2 docs/plans/2026-10-03-issue-226-support-concurrent-explicit-run-once-invocations.md
  git diff --check
  ```

- [ ] Commit only this plan with
      `docs(plan): plan concurrent explicit run-once invocations`.
- [ ] Close the plan-creation todo after the commit. Leave implementation task
      todos open.
