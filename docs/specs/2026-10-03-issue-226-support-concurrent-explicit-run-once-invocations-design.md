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

Automatic selection remains serial. This design does not add a scheduler,
budgets, an Event ledger, distributed coordination, or conflict prediction. It
does not permit concurrent writers for one issue or provide a lock bypass.

## Current behavior

- `pipeline-selection.ts` loads other open issues for an explicit invocation.
  Legacy selection rejects unrelated resumable state, including multiple runs.
- `planning-selection.ts` already filters explicit targets. Planning ownership
  uses `planning-pr-v1` locks, separate from legacy Issue run leases.
- Planning state uses atomic replacement, revisions, and ownership checks.
  Ordinary legacy state writes overwrite the state file directly.
- Workspaces and artifacts include issue identity. Preliminary JSONL logs use
  only a timestamp, before the selected issue is known.
- Pi invocation directories and parent session files already use unique names.
  The session root still uses a timestamp. Planning agents share a configured
  todo root, whose extension can perform global garbage collection.
- Planning implementation requires a pull request. Legacy implementation can
  authorize the agent to update, squash-merge, and push the shared target
  branch.

Per-issue locks provide useful foundations, but these boundaries do not yet
prove safe end-to-end concurrency.

## Design choice

The recommended approach adds common admission and ownership checks around the
existing workflows. Short Git transactions protect shared mutations. A narrow
legacy landing handoff moves shared target mutations from the agent to
Patchmill.

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

Coordination uses the real path of the Git common directory as repository
identity. A small namespace record binds that identity to the canonical clone
root, host repository, Run recovery directory, workspace root, and todo root.
Existing state files stay in place. A conflicting namespace stops before issue
mutations. Namespace changes require stopped processes and deliberate state
migration, not a second ownership namespace.

A short admission transaction registers each Run attempt with a unique token,
process identity, and selection mode. Explicit attempts can coexist. Automatic
selection admits only one attempt and rejects overlap with explicit attempts or
mutating recovery commands. Explicit attempts also reject an active automatic
attempt. Dry-run remains read-only and does not reserve ownership.

Admission records track active processes, not resumable Issue runs. An inactive
review or recovery checkpoint does not prevent another explicit issue from
starting. The admission transaction ends before agent work starts. No exclusive
repository lock spans independent agent work.

Automatic priority, eligibility, and recovery-selection rules stay unchanged.
The initial unattended coordinator uses this same serial admission contract.

## One owner across workflows

Both workflow paths acquire the common Issue run lease from `recovery-lease.ts`.
An explicit attempt acquires it before authoritative selection and recovery. An
automatic attempt acquires it after advisory selection, then repeats all
selected-issue checks. Each attempt reads the selected issue and state again
under ownership before it changes labels, comments, artifacts, or workspaces.

Planning retains its planning lock as the authority for strict state
replacement. The common lease only excludes competing workflows and recovery
commands. The lease remains held across phase changes and planning-lock
reacquisition. Legacy recursion and reset borrow this lease instead of acquiring
or releasing another owner's lease.

The acquisition order is admission registration, common issue lease, planning
lock where applicable, then a Git transaction. The admission transaction never
waits while holding its guard. Release follows the reverse ownership order.

Same-issue contention uses the workflow's existing non-mutating ownership
result: planning returns `stopped / issue-locked`, and legacy reports
`active-run`. The losing attempt can write its own log, but cannot change the
issue's lifecycle labels, comments, workspace, artifacts, or Run recovery state.
It never selects another issue as a fallback.

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

Existing per-issue state paths and artifact filenames remain compatible. Legacy
writes use atomic temporary-file replacement under the current lease. State
writes and cleanup assert the current ownership token. Planning keeps its
revision and Run ID checks. Resume preserves the logical Issue run but allocates
new attempt evidence.

Planning retains its phase-specific branches and workspaces. Legacy work remains
in its owned issue workspace. Artifact generation and materialization never
write into the shared clone worktree. Saved paths and branches must match the
selected issue's expected identity before use.

Runtime todos use an issue-specific directory under the configured todo root.
Existing selected-issue tasks are adopted under ownership without changing other
tasks. Task titles, tags, and completion rules remain compatible. Startup and
cleanup never collect another issue's todos. Pi session allocation keeps its
exclusive parent-file and invocation-directory behavior.

Cleanup targets only saved, validated resources for the owned issue and phase.
It preserves ignored-content safety and resumable cleanup checkpoints. Custom
environment and cleanup hooks must operate only on those resources. Shared Pi
configuration and credentials remain project resources, not session storage.

## Shared Git transactions and landing

A repository mutation guard lives under the Git common directory. It protects
shared remote-ref fetch and snapshot operations, worktree registration changes,
recovery ref changes, branch deletion, and direct landing. These transactions
repeat ownership, path, branch, and expected-OID checks after guard acquisition.
Branch deletion uses the expected OID, not unconditional deletion after an old
observation. Broad worktree pruning and shared-worktree reset are not permitted.

Transactions use bounded waits and command timeouts. Busy transactions stop with
retry guidance and preserve the affected issue's checkpoint. Independent agent
work continues. Native Git ref locks remain a second protection layer. Fetch
results use pinned OIDs or issue-specific evidence refs, not a shared
`FETCH_HEAD` observation after another process can replace it.

Agents edit and commit only in their owned workspace. Non-force publication to
the owned issue branch can proceed concurrently. Publication cannot change
shared Git configuration or another issue's refs. Patchmill owns shared
mutations. Prompts alone do not protect an agent-controlled target-branch merge.

Planning continues to require implementation pull requests. Legacy direct-land
policy remains available through a narrow internal candidate result:

1. The implementation agent completes validation and reviews, then reports its
   owned head, base evidence, commit message, and policy decision without
   landing.
2. Patchmill acquires the Git guard and repeats lease, head, and remote-base
   checks.
3. If the remote base changed, Patchmill refuses direct landing and uses PR
   fallback.
4. Otherwise, Patchmill prepares the squash commit in an issue-owned temporary
   landing workspace. It does not change the shared clone worktree or base
   branch.
5. Patchmill saves a landing intent with the expected base, source head, and
   candidate commit before the non-force push to the target ref.
6. Patchmill verifies the remote result before it records `merged` or closes the
   issue. Host effects retain their existing checkpoint behavior.

A conflict, rejected push, or uncertain result preserves the branch and
evidence. Recovery examines the recorded candidate and remote ancestry before
another landing action. It never repeats an uncertain squash or push blindly.
Two candidates from the same base cannot silently overwrite each other. The
second transaction observes the changed base or receives a rejected push.

This handoff changes internal agent results, not public `pr-created` and
`merged` results. Agent validation and review do not hold the Git guard.
Unmanaged shell commands and custom skills that violate workspace ownership are
not sandboxed.

## Cancellation, crashes, and recovery

Cancellation stops owned Pi and command descendants before ownership release. A
bounded shutdown escalates termination and waits for child completion. A
persistent per-issue execution fence precedes child startup. It records child
ownership and remains present until Patchmill proves that all writers stopped.

Parent-process death alone does not authorize takeover with an outstanding
fence. Lease acquisition examines the fence under the same per-issue transition
guard. Admission retains uncertain writers and never treats them as inactive
automatically.

A hard crash preserves the fence, locks, and recovery evidence. Recovery
archives only exact stale ownership records under transition guards. Live,
malformed, foreign-host, and unverifiable owners remain fail-closed. An
uncertain child startup or surviving descendant requires operator inspection and
fingerprinted repair after the affected writers stop. Common-fence repair does
not remove planning locks. Age alone never proves safe takeover.

Guard release checks its own token. A cancelled or obsolete attempt cannot
release another attempt's issue lease, admission record, or Git guard. A crashed
Git transaction requires evidence reconciliation before retry. An unrelated
explicit issue can still work outside that transaction.

## Affected components and narrow dependencies

- `pipeline.ts`, `pipeline-legacy.ts`, `pipeline-legacy-selection.ts`,
  `pipeline-selection.ts`, and `planning-selection.ts`: admission, pinned
  explicit selection, and post-lease routing.
- `recovery-lease.ts`, `planning-pipeline-issue.ts`,
  `workflow/planning-issue-lock.ts`, and `run/{reset,lease}`: common ownership,
  borrowed leases, child fences, and safe repair boundaries.
- A focused repository coordination helper: canonical namespace, admission
  transactions, and mutation-guard ownership. It is not a Coordinator.
- `run-state.ts`, `main.ts`, `progress.ts`, `pi.ts`, and command process
  management: atomic state, attempt evidence, and descendant shutdown.
- `src/git/planning-*`, Run-once `git.ts`, recovery mutation helpers, and finish
  cleanup: guarded shared operations and expected-OID checks.
- `implementation-agent.ts`, `implementation-landing-prompt.ts`, legacy
  implementation and finish adapters: the candidate handoff and landing receipt.
- Todo task-contract adapters and the bundled todo extension: issue-scoped
  runtime storage without global startup cleanup.
- CLI help, `site/src/content/docs/using-patchmill/run-once.md`, and
  `site/src/content/docs/reference/git-safety.md`: the operator contract.

The required dependencies are these narrow ownership, process, and Git helpers.
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

| Scenario                       | Required evidence                                                                                                                                                          |
| ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Different explicit issues      | Both processes reach agent barriers before either finishes. Cover planning/planning, legacy/legacy, and mixed workflows.                                                   |
| Same-issue contention          | Exactly one owner makes progress. The loser preserves state bytes, lifecycle labels, comments, workspace files, and branch heads. Include planning versus legacy recovery. |
| Explicit fresh work and resume | Several other active, resumable, blocked, or malformed states remain untouched. Only the requested issue is read and resumed.                                              |
| Evidence isolation             | Equal timestamps still produce distinct logs and sessions. Artifacts, todos, cleanup, and atomic state writes preserve another issue's data.                               |
| Shared mutations               | Overlapping worktree, recovery, and deletion transactions either serialize or stop unchanged. Git registrations and expected refs remain valid.                            |
| Concurrent landing             | Two candidates share a base. One lands, and the other preserves its work through PR fallback or a safe stop. A separate remote writer causes non-force rejection.          |
| Crash during landing           | A push before the finish checkpoint resumes from its intent without a duplicate commit or lost remote changes.                                                             |
| Cancellation and takeover      | Exercise exceptions, termination, surviving children, stale-owner races, and obsolete releases. No uncertain writer loses its fence or another owner's lock.               |
| Automatic selection            | Automatic attempts remain serial, mixed admission stops safely, and existing automatic selection behavior remains unchanged. Dry-run creates no ownership records.         |

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

Documentation explains same-issue refusal, retry after a busy Git transaction,
PR fallback after base advancement, and safe child-fence recovery. It explicitly
prohibits deleting another run's locks or using destructive cleanup as recovery.

The artifact proceeds to the next Patchmill plan-creation step without another
manual spec-approval gate. Review remains in the current planning pull request.
