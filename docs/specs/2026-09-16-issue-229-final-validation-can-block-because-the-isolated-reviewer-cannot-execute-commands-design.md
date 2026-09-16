# Command-capable final validation in the isolated Pi runtime

- **Issue:** #229
- **Status:** Proposed design

## Summary

Patchmill will adopt one final-validation policy for its three owned
implementation wrappers: a dedicated fresh-context `patchmill-validator`
subagent executes every feasible required validation command. The ordinary
`reviewer` remains review-only and is no longer asked to run commands.

`patchmill init` will provision the validator under the repository's isolated
`.patchmill/pi-agent/agents/` directory. `patchmill doctor` and the run-once
implementation preflight will resolve the effective agent through `pi-subagents`
and inspect its effective tool allowlist, rather than assuming that a named or
executable role can run commands. A wrapper that requires final validation will
not start development-environment setup or implementation until the validator
resolves with file-inspection tools and `bash`.

The implementation plan will contain a machine-readable final-validation
manifest assembled during reviewed planning from repository instructions and
configured policy. Patchmill—not the implementation parent—loads that manifest.
The implementation prompt, all three wrapper skills, and the shared final
validation prompt will name the same policy and role. The validator will return
a structured exact-head command report. Patchmill will derive a trusted receipt
from the actual `subagent` result and child `bash` calls in the Pi session.
Validation requires a clean, committed implementation tree before and after the
commands. Patchmill will persist a minimal verification record bound to the
head, manifest digest, and policy version. A shared finalization gate will
require that record for fresh and recovered results before completion effects.
It will also verify that the tree remains clean at the same head before handoff.
Prior parent, worker, or CI summaries remain context only and cannot substitute
for verified evidence.

## Context

Patchmill launches Pi with:

```text
PI_CODING_AGENT_DIR=<repository>/.patchmill/pi-agent
```

That isolation is intentional: Patchmill's provider, model, and subagent
settings do not depend on a user's ordinary global Pi directory. It also hides
any user-global custom agent definitions.

The recommended project-local implementation skill and the two optional
Codex/thermo wrappers all dispatch the canonical `reviewer` for final
validation. Their shared prompt requires that child to run every feasible test,
lint, formatting check, type-check, build, and repository-state command. In the
pinned `pi-subagents` dependency, however, the bundled `reviewer` exposes
`read`, `grep`, `find`, and `ls`, and its system prompt forbids shell commands.
The bundled `worker` has `bash`, but worker evidence is explicitly not accepted
as a replacement for reviewer execution.

`src/cli/commands/init/pi-agent-settings.ts` currently creates local Pi settings
only when it persists a model. Neither init nor doctor provisions or verifies a
validation role. The implementation wrappers check that `reviewer` and `worker`
exist and are executable, but role existence does not prove command capability.
The parent model therefore has to choose between blocking on an impossible
contract and weakening the contract to accept indirect evidence.

## Goals

- Give a default `patchmill init` repository a supported final-validation path
  inside its isolated Pi runtime.
- Select one explicit policy: the designated validator executes required
  commands itself.
- Preserve the ordinary `reviewer` as a read-only code, plan, and architecture
  reviewer.
- Inspect the effective validator definition and tools before implementation
  work begins.
- Fail closed before development-environment setup or implementation when the
  configured final-validation policy cannot be satisfied.
- Bind a reviewed, machine-readable command manifest to a structured exact-head
  validator report and machine-enforced receipt gate.
- Require a clean, committed tree throughout final validation and handoff.
- Preserve verified evidence across recovery and reject unverifiable legacy
  checkpoints before completion effects.
- Prevent direct landing from bypassing receipt verification.
- Keep canonical skills, installed project-local copies, metadata, tests, and
  documentation synchronized.

## Non-goals

This issue will not:

- implement the alternative policy in which a read-only reviewer audits command
  evidence produced by another executor;
- make the final-validation policy or validator role name configurable;
- give the ordinary `reviewer` shell or write access;
- turn the validator into a repair agent or let it edit source files;
- move command execution into the Patchmill CLI or add a generic
  orchestrator-owned command runner;
- replace task-level, Codex, thermo-nuclear, pull-request, or host checks;
- change the public `pr-created` or `blocked` JSON result shapes; or
- rely on a user-global agent definition outside the isolated
  `PI_CODING_AGENT_DIR`.

## Approaches considered

### Provision a dedicated validator (chosen)

Patchmill owns a `patchmill-validator` agent with read/search tools plus `bash`.
The three wrappers use it only for final validation and continue to use
`reviewer` for review-only passes.

This directly satisfies the existing execution contract and keeps role authority
narrow. Init, doctor, and run-once share one capability target. Recovery
requires a durable verification record, but not a separate executor-to-reviewer
evidence protocol.

### Override the bundled reviewer

Patchmill could add `bash` and replacement prompt text to the isolated
`reviewer`. This is rejected because it conflates adversarial review with
command execution, silently broadens every review pass, and is vulnerable to
future bundled-reviewer prompt changes. A dedicated role makes the boundary and
its preflight requirement explicit.

### Audit exact-head executor evidence

Patchmill could retain the bundled read-only reviewer and define final
validation as an audit of a worker- or parent-produced command record bound to
an exact commit. This is a valid future policy, but implementing it safely needs
a durable evidence producer, command/output schema, head binding, stale-evidence
rules, and an audit contract. The existing wrappers already require direct
execution, so provisioning the missing capability is the smaller complete fix.
Patchmill must not silently fall back to this policy when the validator is
unavailable.

## Proposed design

### Fixed validation policy

Add a CLI-neutral final-validation policy module with stable values equivalent
to:

```ts
{
  kind: "validator-executes-commands";
  version: 1;
  agent: "patchmill-validator";
  requiredTools: ["read", "grep", "find", "ls", "bash"];
  forbiddenTools: ["edit", "write", "subagent"];
}
```

This is a Patchmill runtime invariant, not a new user configuration surface.
Changes to the required verification semantics increment the policy version and
invalidate records from earlier versions. The policy applies when the configured
implementation skill resolves to one of Patchmill's three final-validation
wrapper names:

- `subagent-dev-with-validation-and-pr-checks`;
- `subagent-dev-with-codex-and-thermo-reviews`; or
- `single-subagent-dev-with-codex-and-thermo-reviews`.

Use one shared classifier in init, doctor, prompt construction, and run-once.
For a path-like skill reference, resolve the same `SKILL.md` target used for Pi
invocation and read its frontmatter `name`; for a namespace-style name, use its
exact terminal name. Match only the three exact names above. This recognizes a
renamed directory containing an unchanged wrapper, conservatively applies the
gate to a copy that retains a reserved wrapper name, and does not infer policy
from directory basename or skill-pack metadata alone. A missing or malformed
path is a configuration failure, not an unknown custom skill.

A well-formed custom implementation skill with another name remains responsible
for declaring and checking its own finalization contract. Doctor identifies it
as unverified rather than claiming it uses Patchmill's validator policy.

### Authoritative validation manifest

Extend the Patchmill plan artifact contract with one fenced, versioned JSON
manifest under a dedicated **Final validation manifest** heading. It contains an
ordered array of stable command IDs, exact command strings, and source citations
back to the plan, repository instructions, or configured validation category.
The planning prompt requires the plan author to synthesize the complete minimum
set from:

- validation commands selected by the plan's implementation tasks;
- applicable rules in `projectPolicy.validation.rules`; and
- repository instructions such as `AGENTS.md`.

Patchmill adds fixed base/head and repository-state probes at runtime because
their exact SHAs are not known during planning; these probes are required in
addition to every manifest command.

The planning phase validates the block's schema, unique IDs, non-empty command
text, and source citations before accepting the plan artifact. Human planning
review therefore sees the exact command contract before implementation. A plan
without a valid manifest cannot enter a policy-managed implementation phase;
Patchmill returns a `final-validation-manifest` blocker rather than asking the
implementation parent to reconstruct commands from prose. Existing in-flight
plans need an updated/re-reviewed plan before they can use the managed wrappers.
There is no permissive legacy fallback.

At implementation start, Patchmill reads the manifest directly from the
materialized plan before launching Pi, retains the parsed value outside model
context, and renders a copy plus its digest into the implementation prompt.
Finalization reloads the authoritative manifest on both fresh and recovered
paths. Its source remains the approved plan artifact and commit, not saved
`validation` strings. Recovery can read that artifact from its commit after
worktree removal. A missing or invalid manifest blocks finalization too.

The parent must pass the same IDs and command text to `patchmill-validator`.
Validator-discovered extra focused commands may be reported, but they do not
replace or remove a manifest command. If implementation scope changes enough to
require a different minimum command set, the plan must be updated through the
normal planning authority boundary rather than silently changing the envelope.

### Managed validator definition

Patchmill will ship one canonical `patchmill-validator` agent definition and
copy it to:

```text
.patchmill/pi-agent/agents/patchmill-validator.md
```

The generated role will:

- use `systemPromptMode: replace`, fresh context, and `completionGuard: false`
  because `bash` is mutation-capable even though this is not an implementation
  role;
- inherit project context but not ambient skills;
- expose `read`, `grep`, `find`, `ls`, `bash`, and the supervisor coordination
  tool when available;
- omit `edit`, `write`, and subagent fanout;
- inherit the isolated runtime's default model unless the operator supplies a
  model/thinking override for `patchmill-validator`; and
- state that it may execute supplied validation and Git-inspection commands but
  may not manually modify source, commit, push, land, or repair findings.

A command can create ignored build or test outputs. The validator records
NUL-safe porcelain status before and after validation. Both snapshots must be
empty, and both head SHAs must match the expected committed head. Any tracked
change or ordinary untracked path fails validation. The validator cannot clean
or repair the tree to manufacture a passing report.

The generated definition is ignored runtime state, like local Pi settings. The
canonical source remains in the published Patchmill package so init and repair
do not depend on a user-global overlay or a network fetch.

`patchmill init` writes the definition before reporting Pi setup complete.
`patchmill doctor --fix` refreshes the Patchmill-owned copy for existing
repositories; ordinary `patchmill doctor` remains read-only. The repair action
is deterministic and covered by the existing explicit `--fix` authorization.
Model, thinking, and provider selection remain in `settings.json`, not in the
generated agent file.

### Effective capability resolution

Add a shared validator-readiness probe backed by the pinned public
`pi-subagents/preflight` API. The probe resolves a launch contract for
`patchmill-validator` in the target repository/worktree under the exact
repository-local `PI_CODING_AGENT_DIR`.

Run the probe in a short child process with that environment rather than
mutating `process.env` around asynchronous discovery. Its bounded JSON result
will include the resolved role identity, source path, diagnostics, and effective
tool allowlist needed by Patchmill. It does not launch a model or execute a
validation command.

A ready result requires:

- unambiguous resolution of the enabled `patchmill-validator` role;
- no blocking agent-definition or launch-contract diagnostic;
- all required inspection and command tools in the effective allowlist; and
- no direct edit, write, or nested-subagent tool in that allowlist.

The check deliberately uses the effective launch contract after agent shadowing,
settings overrides, exclusions, extension configuration, and tool policy. A file
named `patchmill-validator.md`, a successful role lookup, or an
`executable: true` listing is not sufficient.

The probe returns a typed readiness value. It distinguishes missing, disabled,
ambiguous, malformed, command-incapable, and over-capable/mutation-enabled roles
so doctor and run-once can provide exact remediation. Provisioning and launch
tests also verify that the managed role keeps `completionGuard: false`.

### Init, doctor, and implementation preflight

`patchmill init` will provision the role and immediately run the same capability
probe used elsewhere. Failure leaves the generated config and local runtime
files available for inspection but reports Pi setup as incomplete and points to
`patchmill doctor` or `patchmill doctor --fix`.

`patchmill doctor` adds a required **final validator** check when the configured
implementation skill is one of the three Patchmill wrappers. It reports the
effective role source and required command capability on success. Missing or
incompatible capability is a failure with remediation to refresh the managed
role and rerun doctor. If a higher-precedence project definition or settings
override still wins after repair, the report names that effective source so the
operator can remove or correct it.

At the start of `runImplementationAgent`, before invoking the optional
development-environment skill, creating implementation todos, or launching the
implementation Pi session, run the same probe against the implementation
worktree. A failed probe returns the existing blocked result with a stable
`final-validation-capability` reason and concise doctor/repair guidance. No
parent model gets an opportunity to downgrade the final-validation task.

Workspace and planning artifacts may already exist because they are prepared by
the phase coordinator, but no development-environment setup or implementation
work runs after a failed capability preflight. Any resumed agent execution
repeats the probe. Recovery that skips agent execution still passes the shared
finalization gate described below.

### Final-validation handoff

Update the canonical and installed copies of all three wrappers so that:

- `reviewer` remains the role for task and final code-quality reviews;
- `patchmill-validator` is the only role used for final command execution;
- the preflighted `validator-executes-commands` policy is repeated in the
  generated implementation prompt;
- parent, worker, prior validator, and CI summaries are evidence only;
- failure to launch the designated validator is an operator blocker, never a
  reason to substitute another role or indirect evidence; and
- every repair changes the final scope and therefore requires a fresh validator
  pass against the new head.

Rename the shared prompt's role language from reviewer to validator while
retaining its complete base-to-head scope and failure-classification rules. The
validator receives the expected base SHA, head SHA, worktree, plan/spec paths,
required commands, and prior summaries.

Before validator dispatch, the worker commits the complete implementation and
leaves a clean tree. Dirty scope blocks validation, even when its porcelain
status would remain unchanged. The parent must not discard uncommitted fixes
after validation and claim that the unchanged head was validated.

The validator dispatch is foreground (`async: false`) because landing depends on
it, uses fresh context, and supplies the shared JSON Schema through
`outputSchema`. Its task contains one bounded machine-readable scope envelope
with the expected base/head, worktree, manifest digest, policy version, and
unchanged ordered manifest entries. The envelope is a transport copy; the
out-of-model manifest loaded by Patchmill remains authoritative.

The structured result contains:

- observed head SHA before and after validation;
- normalized repository status before and after validation;
- one entry per required command, preserving its ID and exact command text;
- status `pass`, `fail`, or `blocked`, numeric exit status when a process ran,
  and concise evidence;
- findings and a verdict of `pass`, `pass-with-deferred-minor-findings`, `fail`,
  or `blocked`; and
- concise reasoning.

The repository snapshots use
`git status --porcelain=v1 -z --untracked-files=all` and include staged,
tracked, and all ordinary untracked paths. Both snapshots must be empty.
Equality between two non-empty snapshots is not content-integrity evidence. Head
probes before and after validation must equal the expected committed head.

Ignored build/test outputs remain outside this cleanliness requirement. Tracked
or ordinary untracked generated changes fail the receipt. A worker must resolve
them before a new full validation pass. After Pi exits and immediately before
handoff, Patchmill independently requires an empty status and the same head. A
clean tree only at handoff is insufficient without clean validation snapshots.

### Trusted receipt gate

Add a bounded parent-session receipt collector and a pure
`validateFinalValidationReceipt()` decision function. After Pi exits, but before
`runImplementationAgent` accepts `pr-created`, the collector reads the exact
parent session log allocated for that attempt and finds terminal `subagent` tool
results. It accepts only a successful, fresh-context, direct single-child result
whose resolved agent is `patchmill-validator`, whose structured output passed
the supplied schema, and whose final output is available in the documented
`pi-subagents` result details or referenced artifact.

The collector inspects the child's recorded messages/tool summaries rather than
the parent's final prose. For each authoritative manifest command and fixed
runtime scope probe, it requires one matching `bash` tool call and terminal tool
result, then matches that execution to the structured command entry. The
decision function receives the out-of-model parsed manifest and rejects:

- no validator result, another role, forked context, or multiple ambiguous
  candidate results;
- absent or invalid structured output;
- a scope-envelope digest or command set that differs from the authoritative
  manifest, or a policy version that differs from the active policy;
- missing, duplicate, reordered, or text-mismatched manifest command entries;
- a command with no matching child `bash` execution/result;
- non-zero, failed, or blocked commands;
- non-passing verdicts;
- a non-empty before/after repository status or a head that differs from the
  expected committed head; and
- a dirty worktree after Pi exits, or a receipt whose final head differs from
  the head that Patchmill independently observes.

When multiple validator passes exist, only the newest complete receipt matching
the final observed head and authoritative manifest can satisfy the gate. A later
worker or PR-check repair makes an earlier receipt stale and forces another full
validator pass. The parent-provided `validation` strings remain display evidence
and are never the source of the command set or gate decision.

For these policy-managed wrappers, Patchmill forces the effective landing policy
to pull-request-only and rejects a returned `merged` result. This prevents an
irreversible direct merge before the outer process verifies the receipt. A pull
request may have been opened when receipt verification fails, but Patchmill does
not accept the handoff, apply completion effects, or clean the worktree; it
returns the existing blocked result and resumes against the preserved branch.
Planning workflows already require this pull-request behavior.

### Durable verification and shared finalization

Receipt collection belongs to the agent execution path. Authorization to finish
belongs to one shared finalization gate for both legacy and planning workflows.
`runImplementationAgent` cannot be the only enforcement boundary because
recovery can skip it.

After receipt verification, Patchmill creates a minimal internal verification
record with:

- the verification-record schema version;
- the issue-run and phase/workspace identity;
- the verified base and head SHAs;
- the authoritative manifest digest;
- the policy kind and version; and
- the accepted verdict and verified clean-tree result.

Only Patchmill's receipt decision function can create this record. Neither model
output nor public terminal JSON can supply it. Full command transcripts remain
session evidence, not durable run-state payloads. Successful command summaries
continue to populate the existing display-only `validation` array.

Both legacy run state and durable planning state retain the record in a separate
internal `finalValidationVerification` field. The state write that first marks
implementation complete or `branch-pushed` must also save it atomically. Later
transitions, including `pull-request-open`, preserve it. Persistence failure
blocks completion effects. State readers accept older state for recovery, but
missing, malformed, or unsupported records never authorize success. Internal
state schemas and serializers change; public `pr-created` and `blocked` JSON
shapes do not.

The shared gate accepts a newly verified record or a saved record with the same
bindings. It reloads the authoritative manifest and compares the record with the
active policy, run identity, and observed head. It requires a clean tree at that
head before handoff, cleanup, or other pending completion effects. Existing
remote-head and PR checks remain required. Each resumed finish attempt passes
this gate before it can use completion checkpoints to skip work.

All fresh and recovered success paths use this gate:

- Legacy `runPipelineImplementationStage` can reconstruct a saved result through
  `successfulImplementationFromState`, but reconstruction does not authorize
  `runPipelineFinishStage` to perform effects.
- Planning recovery from `branch-pushed` can validate PR facts without rerunning
  the agent, but it cannot advance without a matching verification record.
- Planning recovery from `pull-request-open` must pass the gate before
  `finishPlanningImplementation` resumes handoff, cleanup, or done-label
  effects.

A missing, legacy, or stale record returns a `final-validation-evidence` blocker
and preserves the branch/worktree. It invalidates the checkpoint's authority to
finish without erasing completed-effect history. Recovery must obtain a fresh
validator receipt and atomically replace the record before finalization resumes.
Legacy `validation` strings, matching head SHAs alone, and completed-effect
flags cannot substitute for the record. An already-applied direct merge cannot
be undone by this gate and must not be retroactively certified.

The phase runner owns a shared `runFinalValidationRecovery` operation for
recoverable evidence blockers. On the next attempt, both adapters call it before
retrying finalization. It accepts legacy completed-implementation checkpoints
and planning `branch-pushed` or `pull-request-open` checkpoints without
regressing their status. The original owned phase worktree must still exist in
`ready` or `cleanup-pending` state. It performs capability and manifest
preflight, then launches a validation-only Pi session against the saved
committed head. That session only dispatches the designated validator and uses
the same envelope, collector, and receipt decision function. It does not rerun
implementation, environment setup, PR creation, or completed finish effects.
Command failures remain blockers, not permission to repair source in this
operation.

A successful recovery receipt permits an atomic evidence-upgrade transition
under the existing issue lock and state revision check. Planning transition
validation must allow same-status replacement of `finalValidationVerification`
for `branch-pushed` and `pull-request-open`. Legacy checkpoint updates use the
same rule. The upgrade preserves phase status, implementation result, base/head,
artifacts, publication, PR identity, finish flags, and cleanup history. It does
not relax the current immutability rules for those fields. A changed head or
required source repair needs the existing explicit reset/manual recovery path,
not an evidence-only upgrade. The shared gate runs again after the new record
persists.

If cleanup already removed the worktree, recovery requires the saved
verification record and durable cleanup evidence for the same verified head. It
reloads the manifest from the approved plan commit and verifies the published
branch/PR head. Without matching evidence, recovery returns an operator blocker
that requires explicit reset or manual recovery. In-place revalidation after
worktree removal is not supported. `runFinalValidationRecovery` cannot recreate
a removed phase workspace, accept a replacement worktree, or rewind cleanup
checkpoints. This avoids a second workspace lifecycle that conflicts with
pending branch deletion. A missing worktree is not an exemption. Fully terminal
historical runs with no pending effects remain history, not newly verified
executions.

### Error and repair behavior

- A missing generated file: `patchmill doctor --fix`, then rerun doctor.
- A disabled or shadowed effective role: report the winning definition or
  override and require the operator to correct it.
- A role without `bash`: block before implementation; do not use `reviewer`,
  `worker`, or the parent as a substitute.
- A role with direct mutation tools: block because the designated role no longer
  satisfies the review-only validator boundary.
- A validator launch, structured-output, session-receipt, or receipt-decision
  failure after implementation: return the existing blocked contract and
  preserve the branch/worktree for resumption.
- Missing, legacy, or stale durable evidence: block finalization and obtain a
  fresh validator receipt. Do not fall back to saved `validation` strings.
- A dirty tree before validation, after validation, or before handoff: fail the
  gate and preserve the worktree for worker repair.
- A repository-fixable command failure: use the existing worker repair loop,
  commit the repair, and rerun all final validation from a clean tree.
- An external tooling, credential, quota, or infrastructure failure: return the
  existing operator blocker with command evidence.

## Affected components

- `src/pi/` — add the canonical validator definition, fixed policy, and isolated
  effective-capability probe using `pi-subagents/preflight`.
- `src/cli/commands/init/pi-agent-settings.ts` and init flow/tests — provision
  the managed agent without losing unrelated local settings.
- `src/cli/commands/doctor/checks.ts`, doctor fix flow, reporting, and tests —
  inspect and optionally repair the effective validator path.
- Planning prompt/artifact parsing and tests — require and validate the
  versioned final-validation manifest before managed implementation.
- `src/cli/commands/run-once/implementation-agent.ts`, Pi session parsing, and
  prompt rendering/tests — load the authoritative manifest outside model
  context, gate before implementation, validate the trusted receipt against a
  clean committed tree, and force PR-only landing for managed wrappers.
- Legacy implementation/recovery/finish paths and planning
  implementation/recovery/finish paths — use one finalization gate and one
  validation-only recovery operation before completion effects.
- Legacy run-state and durable planning-state types, readers, serializers, and
  reconstruction helpers — preserve the verification record atomically and
  reject missing, legacy, or stale evidence as authorization to finish.
- `src/workflow/planning-state-transitions.ts` and legacy checkpoint updates —
  permit same-status evidence upgrades without changing implementation facts,
  completed effects, or cleanup history.
- `skills/subagent-dev-with-validation-and-pr-checks/`,
  `skills/subagent-dev-with-codex-and-thermo-reviews/`, and
  `skills/single-subagent-dev-with-codex-and-thermo-reviews/` — dispatch the
  designated validator and consume the structured exact-head result.
- `.patchmill/skills/` copies and `.patchmill/skills/patchmill-skill-pack.json`
  — stay byte-aligned with canonical skill resources and metadata.
- `src/workflow/skill-pack.ts` and installer/doctor skill-pack tests — publish
  the updated wrapper contracts under one new pack version.
- `site/src/content/docs/guides/pi-and-subagents.md` and relevant
  setup/lifecycle guidance — document the managed validator, supported
  model/thinking overrides, doctor result, and repair path.

No npm dependency or public configuration-schema change is planned.

## Verification strategy

These tests pass the Testing Value Gate because they protect executable runtime
selection, fail-fast behavior, and the regression boundary; they do not merely
assert Markdown wording.

### Provisioning and capability tests

- A fresh init creates the canonical agent under the isolated agent directory
  while preserving unrelated `settings.json` values.
- Re-provisioning is idempotent, and doctor fix restores a missing or stale
  managed definition.
- Under an isolated temporary `PI_CODING_AGENT_DIR`, the real
  `pi-subagents/preflight` resolver selects `patchmill-validator` with all
  required tools, no direct mutation tools, and a launch that is not rejected by
  the implementation completion guard.
- Missing, disabled, malformed, ambiguous, shadowed, no-`bash`, excluded-`bash`,
  and edit/write-enabled fixtures return the expected typed failure.
- A user-global validator outside the isolated directory is not accepted as the
  supported local role.

### Doctor and implementation tests

- Doctor passes for a fresh initialized repository and reports the effective
  validator capability.
- Read-only doctor never creates or rewrites the role; `doctor --fix` does so
  only through its explicit repair path.
- Doctor names the effective conflicting source when refresh cannot win over a
  higher-precedence definition or override.
- The shared implementation-skill classifier handles canonical installed paths,
  explicit `SKILL.md` paths, namespace names, renamed directories with matching
  frontmatter, malformed paths, reserved-name copies, and unrelated custom
  skills identically in init, doctor, prompts, and run-once.
- Plan artifact tests accept valid manifests and reject missing, malformed,
  duplicate-ID, empty-command, or uncited entries before implementation. A
  prompt-rendering test proves the parsed manifest/digest—not a parent-created
  list—is supplied to implementation.
- Both planning and legacy implementation adapters block on capability or
  manifest failure. Spies prove that development-environment setup, todo
  creation, the implementation Pi process, and landing do not run.
- Managed wrappers force PR-only landing and reject `merged`; unrelated custom
  implementation skills preserve existing landing policy.
- A repaired role lets the same implementation path continue.

### Workflow handoff verification

Exercise the pure receipt decision function, bounded session collector, and each
wrapper with the same scenarios:

- the final command pass uses a foreground fresh `patchmill-validator`, not
  `reviewer`, and supplies the required output schema;
- prior parent/worker summaries, a parent-omitted manifest command, a changed
  envelope digest, or fabricated top-level `validation` strings do not satisfy
  the gate;
- wrong agent/context, missing child `bash` calls, command omission/duplication,
  failed exit, blocked command, malformed output, head drift, or any non-empty
  repository status prevents handoff;
- staged changes, tracked modifications, and ordinary untracked paths block
  validation before manifest commands run;
- changing an already-dirty file cannot pass through equal porcelain snapshots
  because the initial dirty snapshot rejects the pass;
- validation against an uncommitted fix remains invalid after that fix is
  discarded, even when final HEAD and cleanliness checks pass;
- validation commands that modify tracked or ordinary untracked files fail,
  while ignored build/test outputs remain permitted;
- a dirty tree or changed head after validator completion, after Pi exits, or
  between receipt collection and handoff prevents completion effects;
- a complete exact-head report backed by matching child command calls permits
  the existing PR handoff path only while the committed tree remains clean; and
- a worker or PR-check repair invalidates the prior receipt and causes a fresh
  validator pass after the worker commits the repair.

### Recovery and finalization verification

Exercise the shared gate through both workflow adapters, not only through
`runImplementationAgent`:

- A legacy `implementationCompleted` checkpoint with only `validation` strings
  cannot reach handoff, done-label effects, cleanup, or terminal success.
- Planning `branch-pushed` and `pull-request-open` checkpoints without verified
  evidence cannot advance, even when remote-head and PR checks pass.
- Missing, malformed, and unsupported records, changed heads, changed manifest
  digests, changed policy versions, and mismatched run identities block
  recovery.
- State round-trips retain the record. Interrupted writes cannot save a
  successful implementation checkpoint without its verification record.
- A valid saved record permits recovery without another validator pass, after
  the gate verifies the current manifest, policy, head, and clean tree.
- Validation-only recovery from legacy completed-implementation,
  `branch-pushed`, and `pull-request-open` checkpoints acquires and persists a
  fresh receipt without rerunning implementation or completed effects.
- Same-status evidence upgrades preserve immutable implementation facts, finish
  flags, and cleanup history. Stale revisions and unrelated field changes fail.
- No completion effect runs before the evidence upgrade persists and passes the
  shared gate. A failed upgrade leaves the prior checkpoint recoverable.
- A crash after a completion effect but before its checkpoint does not bypass
  the gate on the next attempt. Existing effect-idempotency rules still apply.
- Worktree-removal recovery requires matching verification, cleanup, manifest,
  and published-head evidence. Missing evidence requires explicit reset/manual
  recovery instead of skipping verification because the tree is absent.
- Validation-only recovery refuses removed or replacement worktrees. It creates
  no recovery worktree, rewinds no cleanup checkpoint, and cannot obstruct
  pending branch deletion.
- Historical terminal state is not relabeled as verified. Managed wrappers never
  accept a legacy `merged` result as new verified success.

Do not add brittle tests that only search for individual Markdown sentences.
Directly compare canonical and installed skill files, validate skill-pack hashes
and required sidecars, and run Markdown formatting/lint for the prose contract.

Implementation verification should run focused init, doctor, capability, prompt,
run-once, state-persistence, recovery, finalization, and skill-pack tests,
followed by:

```sh
npm test
npm run lint
npm run build
npm run site:build
```

Because no dependency file should change, a Nix build is not expected. If
`package.json`, `package-lock.json`, or `npm-shrinkwrap.json` changes during
implementation, rerun the Nix build as required by repository policy.

## Acceptance mapping

| Acceptance criterion                                                         | Design response                                                                                                                                                                                                                                               |
| ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Fresh initialization has a supported path without overlays                   | Init copies the packaged `patchmill-validator` into the isolated agent directory and verifies its effective launch contract.                                                                                                                                  |
| Every feasible command runs through the designated validator                 | Reviewed planning supplies the authoritative manifest; all three wrappers dispatch only `patchmill-validator`; the trusted receipt matches every manifest entry to a child `bash` call/result on a clean committed tree.                                      |
| Missing command capability is detected before implementation                 | A shared effective-tool probe runs before development-environment setup, todo creation, or the implementation Pi session.                                                                                                                                     |
| Identical configuration cannot fail open or fail closed by parent discretion | The implementation parent cannot shrink the out-of-model manifest; the fixed policy forbids evidence fallback, PR-only landing prevents an unchecked merge, and shared finalization rejects fresh or recovered success without matching durable verification. |
| Regression coverage checks capability and handoff                            | Real resolver fixtures cover effective tools and isolation; receipt/session and recovery tests cover clean committed-tree binding, durable evidence, repair invalidation, and handoff refusal.                                                                |
