# Issue 190 planning pull request migration and documentation design

## Status

This specification awaits manual approval. It contains no implementation plan or
production change.

## Summary

Issue #190 completes the migration to the `planning-pr-v1` workflow delivered by
issues #184 through #189. Fresh Run-once workflows use durable phase state and
planning pull requests. Unfinished legacy Issue runs retain their existing
comment, label, workspace, and recovery behavior.

This change adds deterministic deprecation guidance for `set-spec`, `set-plan`,
and `--plan-only`; synchronizes Patchmill's domain language, planning skill
pack, and user documentation; and proves every review-gate combination through
both GitHub and Forgejo with interruption and recovery scenarios.

## Requirements and constraints

- Fresh eligible issues and active `planning-pr-v1` state use the planning
  pipeline. Only unfinished legacy Run recovery state uses the legacy pipeline.
- The review-gate snapshot is immutable for one Issue run.
- A required planning phase advances only after its exact pull request is merged
  and verified on the saved target base.
- The implementation phase always ends in an independently validated open pull
  request. Direct landing is disabled for `planning-pr-v1`.
- Missing, ambiguous, and closed-unmerged planning pull requests block and are
  not replaced automatically.
- State mutation and cleanup continue to require exact lock, repository, branch,
  object, and workspace ownership evidence.
- Deprecated interfaces remain available during the compatibility window; this
  issue does not remove legacy state, comments, labels, commands, or options.
- The existing `workflow.specApproval` and `workflow.planApproval` keys remain
  unchanged.
- No provider contract, npm dependency, or pinned Superpowers release changes.
- Implementation starts from issue #189's integrated router, coordinator,
  implementation pull request validation, and compatibility tests. If that work
  is absent from the implementation base, update the base instead of recreating
  it here.

## Approaches considered

### Additive migration with provider scenarios (chosen)

Keep legacy behavior, print one stable warning before mutation, update current
guidance in the same release, and generalize issue #189's real-Git facade
scenario into a provider-parameterized harness. This preserves recovery while
making the replacement workflow explicit and testable.

### Remove deprecated interfaces now

Removing the commands and option would simplify the CLI but break unfinished
legacy Issue runs without a warning window. Reject this approach.

### Documentation-only migration

Prose alone would leave scripts unaware of deprecation and would not prove the
complete workflow through both provider adapters. Reject this approach.

## Proposed design

### Domain language

Add these terms to `CONTEXT.md` and use them in current user-facing content:

- **Planning review gate**: An immutable per-Issue-run decision that a spec or
  plan phase requires human review through a planning pull request. _Avoid_:
  Approval label, plan-only stop.
- **Planning pull request**: A non-closing pull request containing one spec or
  plan phase. Its verified merge unlocks the next phase. _Avoid_: Artifact
  comment, approval comment.
- **Phase workspace**: The owned worktree and branch for one spec, plan, or
  implementation phase, pinned to saved remote-base evidence. _Avoid_: Shared
  issue worktree.

The configuration property names remain for compatibility. Documentation calls
`workflow.*Approval.required` a review-gate setting. Its label fields are
compatibility data for unfinished legacy runs; labels do not authorize a fresh
`planning-pr-v1` phase. No ADR is needed because these terms record the already
approved issue #180 model.

### Shared deprecation behavior

Add a small pure CLI helper that owns the legacy artifact-setter and plan-only
messages. Each warning must:

- start with `Deprecated:` and name the command or option;
- explain the replacement workflow and compatibility boundary;
- appear exactly once per public non-help invocation before mutation;
- contain no issue or artifact content, credentials, host output, or state
  bytes; and
- use stderr, preserving stdout, redirected JSON, result shapes, and exit codes.

Help output marks each entry deprecated, gives the same concise replacement, and
continues to perform no configuration, host, Git, or state access.

`set-spec` and `set-plan` remain registered and retain their current validation,
checksum, deterministic issue-comment publication, confirmation, and exit
behavior. Their warning states that those comments are consumed only by
unfinished legacy Issue runs. For a fresh workflow, users either let ordinary
`patchmill run-once --issue N` create the required planning pull request or land
a human-authored artifact under the configured spec or plan directory on the
target base before Run-once starts.

`--plan-only` remains parsed and honored on fresh planning and unfinished legacy
routes during the warning window. It must not select the legacy route for a
fresh issue, alter the saved gate snapshot, imply approval, or bypass an open
review. Every public route that accepts it, including supported reset
forwarding, prints the warning once. The replacements are:

- configure a spec and/or plan review gate and use ordinary Run-once for an
  automated review stop; or
- use the human-invoked `patchmill-plan` skill for local, human-controlled
  planning without automated implementation.

The existing `stopped` result with reason `plan-only` remains unchanged. An open
planning review takes precedence, and a later invocation without the flag
resumes the saved phase.

Deprecation remains a presentation concern. Issue #189's facade is the only
router:

```text
unfinished legacy Run recovery state -> legacy pipeline
valid active planning state           -> planning-pr-v1 pipeline
fresh eligible issue                  -> planning-pr-v1 pipeline
conflicting or malformed state        -> block without fallback
```

### Planning skill and skill-pack migration

Update canonical `skills/patchmill-planning/SKILL.md` and installed
`.patchmill/skills/patchmill-planning/SKILL.md` together. For unattended
Run-once work, the guidance says:

- the prompt identifies dedicated, same-phase, merged-base, or
  implementation-carried review context;
- the agent edits and commits only the requested artifact, self-reviews it, and
  returns the required terminal JSON;
- Run-once owns push, pull request creation, review, merge reconciliation,
  labels, and cleanup;
- the agent does not call `set-spec` or `set-plan`, create or merge a pull
  request, or treat an approval label as evidence; and
- a stricter automation prompt may override interactive approval ceremony after
  the issue has been declared ready, but not document self-review.

Keep the sibling `brainstorming` and `writing-plans` references, Patchmill
paths, active worktree invariant, and Testing Value Gate.

Advance `PATCHMILL_RECOMMENDED_SKILL_PACK.version` from `2026.07.2` to
`2026.09.1`. Add a `2026.09.1` range notice explaining the planning pull request
review behavior and deprecated controls. Users crossing that version see it once
after update; current packs keep the existing up-to-date result.

Regenerate and verify:

- skill-pack configuration, version, membership, updater tests, and notice;
- canonical and installed planning skill bytes and metadata hash;
- `.patchmill/skills/patchmill-skill-pack.json` version and source;
- `patchmill.config.json` and current configuration examples pointing to
  `.patchmill/skills/patchmill-planning`; and
- package metadata, locks, installed upstream sibling files, and skill metadata
  continuing to agree on Superpowers `v6.3.0`.

Use existing updater behavior tests plus direct path, hash, package, and config
checks. Do not add tests that only restate prose or static version text.

### User documentation

Update current pages, not historical specs and plans. The affected content is:

- `site/src/content/docs/using-patchmill/run-once.md`;
- `site/src/content/docs/using-patchmill/workflow-artifacts.md`;
- `site/src/content/docs/using-patchmill/interactive-skills.md`;
- `site/src/content/docs/reference/agent-workflow-lifecycle.md`;
- `site/src/content/docs/reference/workflow-labels.md`;
- `site/src/content/docs/getting-started/configuration.md`;
- `site/src/content/docs/getting-started/quickstart.md`;
- `site/src/content/docs/guides/skills-configuration.md`; and
- `site/src/content/docs/reference/configuration-example.md`.

The docs explain that `agent-ready` initializes strict planning state; the saved
gate snapshot assigns artifacts to phases; one unambiguous artifact on the
fetched target base can satisfy assigned work; and required spec or plan work is
published in a non-closing planning pull request. `review-pending` is an
expected exit-zero stop. Humans merge the pull request, then rerun Patchmill;
labels and comments do not unlock the phase.

The implementation phase always produces an issue-closing pull request. Before
cleanup or done labels, Patchmill validates its marker, closing reference,
repository, base, head, status, and ancestry.

Document the complete matrix:

| Spec review | Plan review | Pull request sequence                                                        |
| ----------- | ----------- | ---------------------------------------------------------------------------- |
| Off         | Off         | Implementation contains spec, plan, and code.                                |
| On          | Off         | Spec planning pull request, then implementation with plan and code.          |
| Off         | On          | Plan planning pull request contains spec and plan, then implementation.      |
| On          | On          | Spec planning pull request, plan planning pull request, then implementation. |

GitHub planning heads remain in the target repository. Forgejo may use the
supported same-host head repository. Both providers share markers, gate rules,
merge verification, and recovery behavior.

Move setter, approval-label, upload, and plan-only instructions into clearly
marked legacy compatibility guidance. Do not recommend them for fresh runs.

### Interruption and operator recovery

Normal recovery is:

```sh
patchmill run-once --issue N
```

A retry observes strict state, the remote, and the host before repeating an
effect. It may adopt an exact pushed head or created pull request, finish
checkpointed cleanup, return the same open review, or verify a merge. It never
force-updates a conflicting branch or replaces a missing, ambiguous, or
closed-unmerged pull request.

Document these cases:

- open review: review or merge the same pull request, then rerun;
- closed-unmerged, missing, or ambiguous review: repair host state manually;
- dirty or uncheckpointed phase workspace: inspect and preserve local work;
- transient host failure: repair connectivity or authentication and retry;
- active lock: wait for the owner and do not remove it;
- stale lock: only after proving the recorded process stopped, archive or move
  the exact `planning-pr-v1/locks/issue-N.lock` bytes and fingerprint, then
  rerun; and
- unverifiable or malformed lock: coordinate with the recorded host/operator or
  inspect archived bytes before manual removal; age alone proves nothing.

State that legacy `run lease repair` and reset do not authorize deleting a
`planning-pr-v1` lock, state file, branch, or workspace.

## Provider scenario tests

Generalize issue #189's Forgejo facade recording test into a shared harness with
a temporary real Git repository and bare remote, the public `runOneIssue()`
facade, fake Pi artifact commits, provider-specific `gh` and `tea` command
fixtures, an in-memory pull request host, and named failure injection. Provider
command encoding stays in provider fixtures; gate and recovery assertions stay
shared.

Run all eight provider/gate cells: GitHub and Forgejo multiplied by the four
gate snapshots. Each starts from `agent-ready`, merges every required planning
pull request between Run attempts, and ends after a validated implementation
pull request and durable finish. Assert exact phase order, review stops,
non-closing planning bodies, closing implementation body, merged-base artifact
inheritance, normalized provider identity, and terminal state.

For each provider, use the both-gates path to interrupt after:

- remote phase push;
- planning pull request creation;
- worktree removal;
- local branch removal;
- external planning pull request merge;
- durable implementation pull request validation; and
- handoff, cleanup hook, workspace cleanup, and done-label checkpoints.

Rerun through the facade and assert one remote update and pull request per
phase, monotonic state, no effect after failed persistence, preserved human
artifact edits, and idempotent finish.

For both providers, also cover closed-unmerged, proven missing, ambiguous, and
transient host outcomes with no replacement or unsafe cleanup. Create a valid
dead-process lock, assert a mutation-free stale result, archive it explicitly in
the fixture, and resume the same Issue run. Keep active, unverifiable,
malformed, dirty-workspace, and conflicting-head diagnostics in focused tests.

These scenarios pass the Testing Value Gate because they protect provider
side-effects, recovery, cleanup, and routing rather than static configuration.

## Affected components

- CLI help, a focused deprecation helper, setter execution, and public
  `--plan-only` command boundaries.
- Issue #189 planning/legacy facade regressions.
- Shared Run-once scenario support plus GitHub and Forgejo process fixtures.
- `CONTEXT.md` and the current site pages listed above.
- Canonical and installed planning skills.
- Skill-pack version, metadata, update notice, config examples, and existing
  install/update tests.

Do not put deprecation policy in phase coordination, strict state codecs, or
host adapters. Keep scenario support out of production modules.

## Verification strategy

Focused verification covers public CLI warnings, setters, Run-once arguments and
routing, reset forwarding, updater behavior, skill installation/resolution,
packaging, all new provider scenarios, and issue #189's phase, implementation,
finish, and legacy regressions.

Direct checks prove that canonical and installed planning skills are
byte-identical; the metadata hash matches; configured planning and sibling skill
paths exist; version and notice threshold are `2026.09.1`; Superpowers
references remain `v6.3.0`; and deprecation warnings never enter redirected
stdout.

Final verification runs from a clean implementation worktree:

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

The Nix checks are required by this issue even without a dependency change. If
npm dependency metadata changes unexpectedly, reconcile all npm lock metadata
before rerunning npm and Nix verification.

## Acceptance criteria

- Deprecated setters and every supported `--plan-only` route emit one stable
  replacement warning without changing legacy side effects, stdout, results, or
  exit codes.
- Deprecated controls never route fresh work to legacy or bypass review.
- Domain, skill, config, installed metadata, hashes, docs, and Superpowers
  source references agree.
- Documentation covers review gates, all four sequences, provider differences,
  merge-based advancement, implementation validation, retry, and manual
  stale-lock handling.
- All eight provider/gate scenarios complete with the expected pull request
  sequence.
- Both providers recover injected remote and cleanup interruptions without
  duplication or lost human edits and fail closed for invalid remote state.
- Targeted tests and complete test, build, lint, type, architecture, site, Nix,
  and diff checks pass.
