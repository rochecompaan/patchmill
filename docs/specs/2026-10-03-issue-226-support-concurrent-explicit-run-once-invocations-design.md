# Support concurrent explicit run-once invocations

Issue: #226. Review context: the current planning pull request.

## Outcome and scope

A maintainer can run separate `patchmill run-once --issue N` processes for
different issues in one local clone. Each Run attempt owns one Issue run and
only its phase workspaces. Independent agent work proceeds concurrently.

The maintainer selects independent issues and controls capacity and spending.
Patchmill prevents duplicate ownership, state corruption, and conflicting shared
Git mutations. This contract covers fresh planning work, unfinished legacy
workflows, explicit resume, and supported recovery commands.

An issue remains in progress until its implementation PR lands and its Issue run
completes. A stopped Run attempt, a crash, or PR creation does not complete the
Issue run. Saved Run recovery state identifies unfinished work across later Run
attempts.

Automatic selection remains serial. This design does not add a scheduler,
budgets, an Event ledger, distributed coordination, or conflict prediction. It
does not permit concurrent writers for one issue or provide a lock bypass.

## Current behavior

- During explicit execution, `pipeline-selection.ts` lists all open issues. With
  comment-based storage, it also reads their comments.
- The public command pins the selected issue through
  `runLegacyOneIssueForSelection`. The legacy runner receives only that issue,
  so its cross-issue rejection checks do not run on this path.
- `planning-selection.ts` already filters explicit targets. Planning ownership
  uses `planning-pr-v1` locks, separate from legacy Issue run leases.
- Both workflows already keep local per-issue Run recovery state. Legacy uses
  `<runStateDir>/issue-<number>.json`. Planning uses
  `<runStateDir>/planning-pr-v1/issues/issue-<number>.json`.
- Planning state uses atomic replacement, revisions, and ownership checks.
  Ordinary legacy state writes overwrite the state file directly.
- Workspaces and artifacts include issue identity. Preliminary JSONL logs use
  only a timestamp, before the selected issue is known.
- Pi invocation directories and parent session files already use unique names.
  The session root still uses a timestamp. The default `.pi/todos` root resolves
  within each issue's worktree. A configured root can be shared, and its todo
  extension can perform global garbage collection.
- Planning implementation requires a pull request. Legacy implementation can
  authorize the agent to update, squash-merge, and push the shared target
  branch.

Per-issue locks provide useful foundations, but these boundaries do not yet
prove safe end-to-end concurrency.

## Design choice

The design adds common admission and atomic ownership checks around the existing
workflows and reuses their per-issue state files. Short Git transactions protect
shared mutations. Both workflows require implementation PRs instead of a legacy
direct-landing path.

Two alternatives do not meet the complete contract:

- Selection-only changes leave cross-workflow ownership, log collisions, and
  agent-controlled landing unsafe.
- A repository lock for the complete Run attempt prevents independent progress.
  A full Issue Run refactor adds an unnecessary dependency on #154.

## Selection and admission

An explicit invocation loads only the requested issue and its Run recovery
state. It does not list other issues or read their planning or legacy state.
Fresh selection, blocked retry, and resume retain their existing eligibility,
approval, and artifact checks. Invalid state for another issue is irrelevant.
Conflicting planning and legacy state for the requested issue still blocks.

This selection change removes unnecessary host reads. It does not redesign
legacy rejection rules that the public command already bypasses.

Coordination uses the real path of the Git common directory as repository
identity. A small namespace record binds that identity to the canonical clone
root, host repository, Run recovery directory, workspace root, and configured
todo root. Existing state files stay in place. A conflicting namespace stops
before issue mutations. Namespace changes require stopped processes and
deliberate state migration, not a second ownership namespace.

A short admission transaction registers each Run attempt with a unique token and
selection mode. Explicit attempts can coexist. Automatic selection admits only
one attempt and rejects overlap with explicit attempts or mutating recovery
commands. Explicit attempts also reject an active automatic attempt. Dry-run
remains read-only and does not reserve ownership.

Admission records coordinate active Run attempts, not Issue run completion. A
review or recovery checkpoint between attempts does not prevent another explicit
issue from starting. The admission transaction ends before agent work starts. No
exclusive repository lock spans independent agent work.

Automatic priority, eligibility, and recovery-selection rules stay unchanged.
The initial unattended coordinator uses this same serial admission contract.

## One owner across workflows

Atomic local checks cover saved Run recovery state and issue ownership as one
claim decision. An unfinished checkpoint identifies the existing Issue run, not
fresh work. Without a current owner, that Issue run can resume under its
existing eligibility, approval, and artifact rules. An in-progress checkpoint
does not prevent intentional resume.

Both workflow paths acquire the common Issue run lease from `recovery-lease.ts`.
An explicit attempt acquires it before authoritative selection and recovery. An
automatic attempt acquires it after advisory selection, then repeats all
selected-issue checks. Each attempt reads the selected issue and state again
under ownership before it changes labels, comments, artifacts, or workspaces.

Planning retains its planning lock as the authority for strict state
replacement. The common lease excludes competing active Run attempts and
recovery commands. It does not replace the saved lifecycle checkpoint. The lease
remains held across phase changes and planning-lock reacquisition. Legacy
recursion and reset borrow this lease instead of acquiring or releasing another
owner's lease.

The acquisition order is admission registration, common issue lease, planning
lock where applicable, then a Git transaction. The admission transaction never
waits while holding its guard. Release follows the reverse ownership order.

For same-issue contention, both workflows report `issue already in progress.` as
a normal stop. The command returns exit code 0. This rule covers contention at
the common issue-ownership check and workflow-specific locks. Ordinary
contention is not a command failure and does not suggest lease repair.

The losing attempt can write its own log, but cannot change the issue's
lifecycle labels, comments, workspace, artifacts, or Run recovery state. It
never selects another issue as a fallback.

Reset and lease repair participate in common admission and ownership checks.
Repair uses its existing exclusive repair guard and exact fingerprints. Legacy
reset still refuses planning state. Neither command gains authority to remove a
planning lock or rewrite planning state. Other artifact-edit commands are
unsupported during active Run attempts.

## Isolated state and evidence

Each Run attempt receives a random attempt ID before log creation. Log paths, Pi
session roots, and temporary files include this ID, not only a timestamp. Final
log placement never replaces an existing file. Logs identify the issue, phase,
and attempt, plus the saved planning Run ID where available.

Existing per-issue state files remain the source for lifecycle and resume
checkpoints. This design adds no duplicate issue-progress registry. Their paths
and artifact filenames remain compatible. Legacy writes use atomic
temporary-file replacement under the current lease. State writes and cleanup
assert the current ownership token. Planning keeps its revision and Run ID
checks. Resume preserves the logical Issue run but allocates new attempt
evidence.

Planning retains its phase-specific branches and workspaces. Legacy work remains
in its owned issue workspace. Artifact generation and materialization never
write into the shared clone worktree. Saved paths and branches must match the
selected issue's expected identity before use.

The default `.pi/todos` path stays unchanged within each issue's worktree.
Relative configured todo roots resolve against the actual issue worktree, not
the shared clone root. No extra issue directory or task migration applies to
this default layout. Resume preserves existing todo locations, titles, tags, and
completion rules.

Additional isolation applies only to configured roots that are genuinely shared
between issues. Startup and cleanup never collect another issue's todos. Pi
session allocation keeps its exclusive parent-file and invocation-directory
behavior.

Cleanup targets only saved, validated resources for the owned issue and phase.
It preserves ignored-content safety and resumable cleanup checkpoints. Custom
environment and cleanup hooks must operate only on those resources. Shared Pi
configuration and credentials remain project resources, not session storage.

## Shared Git transactions and pull requests

A repository mutation guard lives under the Git common directory. It protects
shared remote-ref fetch and snapshot operations, worktree registration changes,
recovery ref changes, and branch deletion. These transactions repeat ownership,
path, branch, and expected-OID checks after guard acquisition. Branch deletion
uses the expected OID, not unconditional deletion after an old observation.
Broad worktree pruning and shared-worktree reset are not permitted.

Transactions use bounded waits and command timeouts. Busy transactions stop with
retry guidance and preserve the affected issue's checkpoint. Independent agent
work continues. Native Git ref locks remain a second protection layer. Fetch
results use pinned OIDs or issue-specific evidence refs, not a shared
`FETCH_HEAD` observation after another process can replace it.

Agents edit and commit only in their owned workspace. Non-force publication to
the owned issue branch can proceed concurrently. Publication cannot change
shared Git configuration or another issue's refs. Patchmill owns shared
mutations. Prompts alone do not protect an agent-controlled target-branch merge.

Both planning and legacy implementation must create PRs and use the normal PR
checks, review, and repair flow. Bundled skills, skill-pack configuration,
implementation prompts, landing-policy configuration, and operator documentation
must enforce this PR-only contract. No configuration or skill can authorize an
agent to merge and push the target branch directly. Target-branch updates occur
through the PR merge flow. This contract does not require human-only PR merges.

PR creation records `pr-created`, not `merged` or Issue run completion. The
issue remains in progress until its implementation PR lands and its Issue run
completes the remaining finish checkpoints. Existing host operations and PR
checkpoints handle publication, merge verification, and completion. This design
adds no host operations or checkpoints for a direct-landing path.

If the base advances or PR checks fail, the normal PR repair flow preserves the
branch and evidence. Resume reconciles the saved PR and finish checkpoints
before another action. Agent validation and review do not hold the Git guard.
Unmanaged shell commands and custom skills that violate workspace ownership are
not sandboxed.

## Cancellation, crashes, and recovery

Cancellation uses the existing Run attempt shutdown path and preserves
unfinished Run recovery state. A process stopping or crashing does not mean that
the issue is complete. This design adds no PID monitoring, execution fences, or
process-containment machinery for hypothetical surviving subagents.

A later Run attempt acquires ownership atomically and reads the saved issue
state again before resume. It continues the same unfinished Issue run through
the existing workflow checks. A saved implementation PR remains authoritative
across attempts. PR publication, PR merge, and unfinished cleanup resume from
their existing checkpoints instead of fresh work.

Existing stale-lease checks establish only whether ownership can change. A dead
PID is not evidence of Issue run completion. Recovery preserves unfinished state
and uses existing transition guards and exact ownership fingerprints. Live,
malformed, foreign-host, and unverifiable owners remain fail-closed. Broken
ownership records use the existing repair path, not the ordinary contention
result. Age alone never proves safe takeover.

Guard release checks its own token. A cancelled or obsolete attempt cannot
release another attempt's issue lease, admission record, or Git guard. Stale
admission records and crashed Git transactions require reconciliation before
reuse. An unrelated explicit issue can still work outside a Git transaction.

## Affected components and narrow dependencies

- `pipeline.ts`, `pipeline-legacy.ts`, `pipeline-selection.ts`, and
  `planning-selection.ts`: admission, target-only explicit loading, and
  post-lease routing. The existing public legacy selection pin stays in place.
- `recovery-lease.ts`, `planning-pipeline-issue.ts`,
  `workflow/planning-issue-lock.ts`, and `run/{reset,lease}`: common ownership,
  atomic state checks, borrowed leases, and existing repair boundaries.
- A focused repository coordination helper: canonical namespace, admission
  transactions, and mutation-guard ownership. It is not a Coordinator.
- `run-state.ts`, `main.ts`, `progress.ts`, and `pi.ts`: atomic legacy state
  writes and unique attempt evidence.
- Common and workflow-specific ownership diagnostics, result output, and exit
  mapping: the same normal-stop result with exit code 0 and no repair advice.
- `src/git/planning-*`, Run-once `git.ts`, recovery mutation helpers, and finish
  cleanup: guarded shared operations and expected-OID checks.
- `implementation-agent.ts`, `implementation-landing-prompt.ts`, legacy
  implementation and finish adapters: PR-only publication and the normal PR
  checks, review, and repair flow.
- Bundled skills, skill-pack configuration, and landing-policy configuration:
  removal of direct-to-target-branch authorization from every workflow.
- Todo task-contract adapters and the bundled todo extension: worktree-relative
  configured roots and isolation only for genuinely shared roots. Default paths
  and resumed todo locations stay unchanged.
- CLI help, `site/src/content/docs/using-patchmill/run-once.md`, and
  `site/src/content/docs/reference/git-safety.md`: the operator contract.

The required dependencies are these narrow ownership, state, and Git helpers.
This work does not wait for #147, the full Phase I design suite, or #154.

Issue #159 covers overlapping selection and recovery interfaces. The later plan
must reconcile those interfaces. Delivery-order work in #153 and module-contract
work in #167 remain separate. New helpers keep existing large pipeline modules
focused.

## Verification strategy

New regression tests pass the Testing Value Gate because they exercise risky,
reusable production behavior. Process tests use a temporary real Git clone, a
local bare remote, and controlled host and Pi substitutes. Explicit barriers
prove overlap without paid agents, live host mutations, or timing-only sleeps.

| Scenario                       | Required evidence                                                                                                                                                                                                                                                                                     |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Different explicit issues      | Both processes reach agent barriers before either finishes. Cover planning/planning, legacy/legacy, and mixed workflows.                                                                                                                                                                              |
| Same-issue contention          | Exactly one owner makes progress. Both workflows report `issue already in progress.` with exit code 0 and no repair advice. The loser preserves state bytes, lifecycle labels, comments, workspace files, and branch heads. Cover common leases, workflow locks, and planning versus legacy recovery. |
| Explicit fresh work and resume | Public command tests show that only the requested issue, its comments, and its recovery state are read. Other active, resumable, blocked, or malformed states remain untouched. Direct legacy-runner tests do not establish public selection behavior.                                                |
| Evidence isolation             | Equal timestamps still produce distinct logs and sessions. Artifacts, todos, cleanup, and atomic state writes preserve another issue's data.                                                                                                                                                          |
| Shared mutations               | Overlapping worktree, recovery, and deletion transactions either serialize or stop unchanged. Git registrations and expected refs remain valid.                                                                                                                                                       |
| Todo roots                     | Default todos stay in each issue worktree. Relative configured roots use that worktree. Shared-root cleanup preserves other issues' tasks. Resume uses existing todo locations.                                                                                                                       |
| PR-only completion             | Planning and legacy workflows publish only their owned branches and create PRs. Target refs change only through PR merges. PR creation alone never completes the Issue run.                                                                                                                           |
| PR and finish recovery         | A crash before or after PR publication or merge resumes the existing checkpoints without duplicate PRs or false completion. Base advancement uses normal PR checks and repair.                                                                                                                        |
| Cancellation and takeover      | Exceptions, termination, stale-owner races, and obsolete releases preserve unfinished state and another owner's locks. Process exit or a dead PID never marks the issue complete.                                                                                                                     |
| Automatic selection            | Automatic attempts remain serial, mixed admission stops safely, and existing automatic selection behavior remains unchanged. Dry-run creates no ownership records.                                                                                                                                    |

The implementation step runs focused process and ownership suites, then
`npm run test:run-once`, `npm test`, `npm run check:types`, `npm run lint`, and
`npm run build`. Dependency changes also require the Nix build. For this
spec-only step, direct Markdown and formatting checks replace new tests that
merely assert document text.

## Operator responsibilities and unsupported cases

Operators select independent issues and manage model spending, CPU, ports, test
databases, and other external resources. All concurrent processes use the same
supported Patchmill version, clone root, and bound configuration namespace.
Operators stop old processes before upgrade or state migration.

Automatic selection cannot overlap explicit work. Other unsupported cases
include separate clones or hosts, concurrent config or artifact-edit commands,
shared resource cleanup hooks, and manual Git mutations outside the guard
protocol. Patchmill does not predict semantic conflicts between selected issues.

Documentation explains the normal same-issue stop with exit code 0 and retry
after a busy Git transaction. It describes PR-only publication, normal PR
repair, and intentional resume from unfinished local state. It distinguishes
process exit from Issue run completion and keeps the default todo path
unchanged. It explicitly prohibits removal of another run's locks or destructive
cleanup as recovery.

The artifact proceeds to the next Patchmill plan-creation step without another
manual spec-approval gate. Review remains in the current planning pull request.
