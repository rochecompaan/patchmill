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
from the actual `subagent` result and child `bash` calls in the Pi session, then
reject a successful implementation result unless that receipt covers the
manifest and passes a shared decision function for the final worktree head.
Prior parent, worker, or CI summaries remain context only and cannot substitute
for the receipt.

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

This directly satisfies the existing execution contract, keeps role authority
narrow, and requires no evidence-storage protocol. It also gives init, doctor,
and run-once one stable capability target to resolve.

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
  agent: "patchmill-validator";
  requiredTools: ["read", "grep", "find", "ls", "bash"];
  forbiddenTools: ["edit", "write", "subagent"];
}
```

This is a Patchmill runtime invariant, not a new user configuration surface. The
policy applies when the configured implementation skill resolves to one of
Patchmill's three final-validation wrapper names:

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
context, and renders a copy plus its digest into the implementation prompt. The
parent must pass the same IDs and command text to `patchmill-validator`.
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

A command may create normal build or test outputs. The validator records final
`git status --short`, and unexpected repository changes make the validation
report fail rather than authorizing cleanup or repair.

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
work runs after a failed capability preflight. Resumption repeats the probe and
continues normally once the effective role is ready.

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

The validator dispatch is foreground (`async: false`) because landing depends on
it, uses fresh context, and supplies the shared JSON Schema through
`outputSchema`. Its task contains one bounded machine-readable scope envelope
with the expected base/head, worktree, manifest digest, and unchanged ordered
manifest entries. The envelope is a transport copy; the out-of-model manifest
loaded by Patchmill remains authoritative.

The structured result contains:

- observed head SHA before and after validation;
- normalized repository status before and after validation;
- one entry per required command, preserving its ID and exact command text;
- status `pass`, `fail`, or `blocked`, numeric exit status when a process ran,
  and concise evidence;
- findings and a verdict of `pass`, `pass-with-deferred-minor-findings`, `fail`,
  or `blocked`; and
- concise reasoning.

The repository snapshots use NUL-safe porcelain status including staged,
tracked, and all ordinary untracked paths. The before and after snapshots must
be byte-equivalent. Existing dirty implementation scope is allowed, but a
validator command may not change it. Ignored build/test outputs remain outside
that ordinary status comparison; tracked or ordinary untracked generated changes
fail the receipt and must be handled by a worker.

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
  manifest;
- missing, duplicate, reordered, or text-mismatched manifest command entries;
- a command with no matching child `bash` execution/result;
- non-zero, failed, or blocked commands;
- non-passing verdicts;
- before/after head mismatch or repository-status drift; and
- a receipt whose final head differs from the worktree head that Patchmill
  observes after the Pi process exits.

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

This adds an internal receipt to the implementation-stage result, not to the
public terminal JSON or durable planning schema. Successful command summaries
continue to populate the existing `validation` array after the trusted receipt
passes.

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
- A repository-fixable command failure: use the existing worker repair loop and
  rerun all final validation at the updated head.
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
  context, gate before implementation, validate the trusted receipt against it
  and final HEAD, and force PR-only landing for managed wrappers.
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
  failed exit, blocked command, malformed output, head drift, or repository
  status drift prevents handoff;
- a complete exact-head report backed by matching child command calls permits
  the existing PR handoff path; and
- a worker or PR-check repair invalidates the prior receipt and causes a fresh
  validator pass.

Do not add brittle tests that only search for individual Markdown sentences.
Directly compare canonical and installed skill files, validate skill-pack hashes
and required sidecars, and run Markdown formatting/lint for the prose contract.

Implementation verification should run focused init, doctor, capability, prompt,
run-once, and skill-pack tests, followed by:

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

| Acceptance criterion                                                         | Design response                                                                                                                                                                                                                            |
| ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Fresh initialization has a supported path without overlays                   | Init copies the packaged `patchmill-validator` into the isolated agent directory and verifies its effective launch contract.                                                                                                               |
| Every feasible command runs through the designated validator                 | Reviewed planning supplies the authoritative manifest; all three wrappers dispatch only `patchmill-validator`; the trusted receipt matches every manifest entry to an actual child `bash` call/result at the final head.                   |
| Missing command capability is detected before implementation                 | A shared effective-tool probe runs before development-environment setup, todo creation, or the implementation Pi session.                                                                                                                  |
| Identical configuration cannot fail open or fail closed by parent discretion | The implementation parent cannot shrink the out-of-model manifest; the fixed policy forbids evidence fallback, PR-only landing prevents an unchecked merge, and the outer gate rejects success without a matching session-derived receipt. |
| Regression coverage checks capability and handoff                            | Real resolver fixtures cover effective tools and isolation; receipt/session tests cover command execution, exact-head/state binding, repair invalidation, and handoff refusal.                                                             |
