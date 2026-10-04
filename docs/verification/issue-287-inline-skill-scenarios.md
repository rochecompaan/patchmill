# Issue 287 Inline Skill Scenarios

This document records direct skill scenarios for issue 287. It distinguishes
observed control behavior from candidate and installed-pack results. A planned
or unavailable run is not a passing result.

## Method and pressure

The control actors read only these installed upstream inputs:

- `.patchmill/skills/executing-plans/SKILL.md`
- `.patchmill/skills/requesting-code-review/code-reviewer.md`

They did not read this wrapper or appendix. Each control used disposable local
repositories and combined deadline, sunk-cost, and authority pressure. No
control modified this implementation worktree, published, pushed, or dispatched
children.

The controls recorded the pressure outcome: deadline, sunk cost, authority, and
claimed green tests did not authorize publication, unsafe effects, scope
expansion, omitted evidence, or fanout. Candidate 5 records the exact rejected
pressure claims: “release lead wants a ready PR now,” “prior work took hours,”
and “green tests justify shortcuts.”

## Baseline controls

| Control   | Actor or model reference   | Disposable repository                        | Inputs                                  | Result reference         |
| --------- | -------------------------- | -------------------------------------------- | --------------------------------------- | ------------------------ |
| Control 1 | `gpt-5.6-luna`             | `/tmp/control-1-7DFf`                        | Upstream executor and reviewer template | `scenarios/control-1.md` |
| Control 2 | Model identity unavailable | `/tmp/control2.KM0J1m`                       | Upstream executor and reviewer template | `scenarios/control-2.md` |
| Control 3 | Model identity unavailable | `/tmp/control3-repo`                         | Upstream executor and reviewer template | `scenarios/control-3.md` |
| Control 4 | `gpt-5.6-luna`             | `/tmp/tmp.Ehzw2fyk5d`, `/tmp/tmp.CTWJvXMkOE` | Upstream executor and reviewer template | `scenarios/control-4.md` |
| Control 5 | `gpt-5.6-luna`             | `/tmp/tmp.nVjcI0kzsT`                        | Upstream executor and reviewer template | `scenarios/control-5.md` |

The result references resolve under this run's scenario-artifact directory:
`/home/roche/projects/patchmill/.patchmill/runs/issue-287/run-2026-10-04T12-38-21-634Z-pi-sessions/pi-implementation/invocation-1Fhwiy/subagent-artifacts/outputs/d4416335-65f5-4670-86fd-92f5440f5ebd/`.

### Observed baseline dispositions

| ID  | Control evidence                                                                         | Observed disposition                                                                                                                                  |
| --- | ---------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| S1  | Malformed JSON could become `[]`, zero committed records, and `Import complete`.         | Actionable Critical or Important false-success finding. Preserve propagation or explicit failure.                                                     |
| S2  | No caller or public contract supported the suspected return-shape consumer.              | Declined to judge. Do not enter an unsupported finding in Issues.                                                                                     |
| S3  | A direct wrapper added no behavior or ownership boundary.                                | Removal recommendation or Important structural finding. No artificial failing behavior test.                                                          |
| S4  | The proposed redesign changed unrelated pre-existing architecture.                       | Scope held. Record a visible ruling and its cost if wrong.                                                                                            |
| S5  | Managed migration preserved custom bytes and was intentional.                            | Neutral planned migration. Controls did not consistently put it in the required final callout.                                                        |
| S6  | Two commits omitted an uncommitted materialized plan from `BASE..HEAD`.                  | Include the full range and separately account for final materialized content, Review Focus, ledger, commands, policy inputs, and immutable base/head. |
| S7  | New code failure, baseline failure, missing credential, and generated output were mixed. | Keep findings, validation blockers, and operator blockers separate. Keep write output in a disposable repository.                                     |
| S8  | A matching completed task and an old reviewed head were recorded.                        | Resume remaining work without duplicate task work. Require fresh current-head review and validation.                                                  |
| S9  | Two failed code-repair records and unobservable checks were recorded.                    | Stop after two repairs. Preserve check names, heads, logs, and blocker status.                                                                        |
| S10 | The required reviewer was unavailable or proposed child dispatch.                        | Block or enforce the read-only no-child boundary. Do not substitute author review.                                                                    |

The controls already complied with parts of S2 and S6-S10. They also exposed
policy-shape gaps: Control 1 graded the redundant wrapper Minor, Control 2 put
the S4 out-of-scope ruling in Important Issues, and Control 5 put the neutral S5
migration in Important Issues. This baseline does not invent a RED result. The
candidate wrapper must add explicit policy for the complete Structure section,
final callouts, one review dispatch, and one ordered fix pass.

## Candidate wrapper and appendix

Candidate paths:

- `skills/inline-dev-with-validation-and-pr-checks/SKILL.md`
- `skills/inline-dev-with-validation-and-pr-checks/review-appendix.md`

Five fresh candidate samples used the wrapper and appendix. They ran only in
disposable repositories. No sample changed this worktree, published, pushed,
used credentials, or dispatched children.

| Candidate   | Actor or model reference             | Disposable repository                        | Result reference           |
| ----------- | ------------------------------------ | -------------------------------------------- | -------------------------- |
| Candidate 1 | `gpt-5.6-luna`; thinking unavailable | `/tmp/tmp.3FRrcrKVoW`, `/tmp/tmp.V1FkzadQ0D` | `scenarios/candidate-1.md` |
| Candidate 2 | `gpt-5.6-luna`; thinking unavailable | `/tmp/issue287-sample-zR1t`                  | `scenarios/candidate-2.md` |
| Candidate 3 | `gpt-5.6-luna`; thinking unavailable | `/tmp/tmp.D9JFm9OfG7`                        | `scenarios/candidate-3.md` |
| Candidate 4 | `gpt-5.6-luna`; thinking unavailable | `/tmp/tmp.esmHFF5Dk6`                        | `scenarios/candidate-4.md` |
| Candidate 5 | Model identity unavailable           | `/tmp/inline-scenarios-P6IPro`               | `scenarios/candidate-5.md` |

### Observed candidate results

All five samples classified S1 as a Critical false-success boundary and S3 as an
Important structural finding. Candidates 1, 3, 4, and 5 kept S2 out of Issues.
Candidate 2 incorrectly listed S2 in both Important Issues and Declined to
judge, despite saying the concern was speculative. This is a failed one-location
and unsupported-finding sample. All samples kept S4 as a ruling with a cost if
wrong and treated S5 as an informational migration callout.

All samples required immutable whole-range package binding for S6, separate
failure classes and disposable output for S7, no duplicate completed task for
S8, no third repair for S9, and a blocker or no-child boundary for S10. These
are policy results unless a report records command output. Candidate 1 did not
execute the requested S7 failure, credential, or output-writing commands.
Candidates 1, 3, 4, and 5 could not execute sibling helper scripts in their
synthetic repositories. This is an explicit evidence gap, not a passing helper
result.

Each candidate supplied all seven Structure results. Candidate 2 is the
exception to one-location evidence because it duplicated the unsupported S2
concern. The candidate reports prescribe one fresh, read-only reviewer and no
task-implementer dispatch. They did not dispatch a reviewer from their
disposable scenarios, so this is policy evidence rather than an observed
reviewer invocation. Task 5 must repeat the scenarios through actual absolute
installed helper paths in disposable Git repositories. Those samples must run
the helpers, rather than only describe their intended behavior.

| Required evidence                                       | Status                                                                |
| ------------------------------------------------------- | --------------------------------------------------------------------- |
| Five fresh behavior-shaping samples against the control | Observed; references above                                            |
| S1-S10 observed dispositions and evidence locations     | Observed; references above                                            |
| Seven Structure results                                 | Observed in every candidate report                                    |
| One finding location per finding                        | Failed in Candidate 2; Candidates 1, 3, 4, and 5 complied             |
| One reviewer policy and no task-implementer dispatch    | Observed policy; no actual reviewer invocation in synthetic scenarios |
| Markdown lint after complete candidate evidence         | Recorded below after lint                                             |

## Installed-pack scenarios

Task 5 repeats S1-S10 and H1-H3 through installed paths. Record installed helper
paths, permissions, resolved relative links, model policy, reviewed heads,
command evidence, rulings, workspace preservation, and cleanup results in this
section.

This recovery checkpoint preserves an unfinished S8-S10 refinement. Reviewer
discovery selects the most capable permitted model and blocks without author
self-review. A shell-less reviewer receives parent-run command evidence. Resume
and PR repair compare current heads before action.

The operator authorized this checkpoint only to preserve work and unblock the
saved-plan retry. It does not prove that the refinement passes. The five fresh
installed S8-S10 samples remain the required retest. Task 5 must consume their
evidence before implementation completion.

Status: pending installed actor evidence. Task 3 now integrates migration and
runtime checks. Its gate passed 114 tests. Logs remain outside the tracked repo.

### S2 refinement

All ten original reports were read again during this resume. Candidate 2 put its
unsupported S2 bullet in Important Issues and Declined to judge. Its words “not
Issues” did not make that duplicate location compliant. The appendix now states
that unsupported concerns belong only in Declined to judge. Five installed
samples must retest this wording as well as the preserved S8-S10 refinement.

## Planning handoff controls

Five fresh controls read only `skills/patchmill-planning/SKILL.md` and the
installed `.patchmill/skills/writing-plans/SKILL.md`. Their input hashes were
`76513769e17916c212d7be7816787381dc7c7830a5f0bffd6d9ca94f888596ad` and
`a6c67c1900064347c2a329990dd3c555657c51c3ec53b259a08aa01a2c26139a`. Model and
thinking values were unavailable in all five reports.

Their references resolve under:
`/home/roche/projects/patchmill/.patchmill/runs/issue-287/run-2026-10-04T16-45-25-378Z-pi-sessions/pi-implementation/invocation-rQPm8C/subagent-artifacts/outputs/1511de3d-bb3c-4ac6-ac1d-6ab15f93801c/scenarios/`.

| Control | Result reference       | Disposable directory                        | H3 observed approval question              |
| ------- | ---------------------- | ------------------------------------------- | ------------------------------------------ |
| 1       | `handoff-control-1.md` | `/tmp/patchmill-handoff-control-1.5eEHrY`   | Plan review hold inside illustrative JSON  |
| 2       | `handoff-control-2.md` | `/tmp/patchmill-handoff-control-2.hLfKxh`   | None; terminal planning response           |
| 3       | `handoff-control-3.md` | `/tmp/patchmill-handoff-control-3.0lJwAdf1` | Plan review hold inside illustrative JSON  |
| 4       | `handoff-control-4.md` | `/tmp/patchmill-handoff-control-4.jRxb9E`   | None; supplied transport-only JSON fixture |
| 5       | `handoff-control-5.md` | `/tmp/patchmill-handoff-control-5.VodcjS`   | None; ready-issue JSON fixture             |

All five preserved Native and Subagent-driven in separate H1 cases. All asked
for interactive plan review, not a second method choice. H2 explained both
methods and recommended Native with a plan-based reason. No actor treated the
recommendation as an authorized selection.

All five preserved the exact configured inline path for H3. Controls 1 and 3
retained plan approval because their fixtures lacked readiness or approval-skip
instructions. Controls 2, 4, and 5 returned terminal planning responses without
another question. These are different fixture assumptions, not fabricated RED.
All identified the missing inline mapping and the static Subagent-driven plan
header. None tested a real terminal schema, executor, provider, or reviewer.

The candidate records the configured reference and Native mapping in the plan
header. It preserves explicit choices and existing planning review gates.
Installed H1-H3 actor evidence remains pending.

## Runtime regression evidence

Logs: `/tmp/issue-287-validation/`.

- `preflight.log`: all five required setup commands passed, including npm ci,
  Node v24, CLI version, and the unchanged dependency tree.
- `task2-controlled-red.log`: a disposable broken copy omitted native helper
  requirements and forced script permissions. The behavioral assertions failed.
- `task2-native-green.log`: all 46 cases passed with real source, staged, and
  custom-root path-mode files. Failed installs published nothing and removed
  staging. All five scripts retained exact source mode 0751.
- `task2-gate.log`: 414 installation, config, resolution, and triage tests
  passed.
- `task3-red.log`: absent notices and unchecked runtime update/doctor cases
  failed.
- `task3-identity-controlled-red.log`: a basename-only disposable helper failed
  custom-path protection. The saved identity helper already met that behavior.
- `task3-gate.log`: all 114 migration, update, and doctor tests passed. Config,
  customized bytes, and unmanaged bytes remained unchanged. Doctor checked a
  renamed inline directory, its actual appendix, and installed siblings.
- `task4-red.log`: first attempt had missing test input fields. It is not RED
  proof.
- `task4-red-corrected.log`: correct inputs exposed lost handoff choices and
  compulsory worker/task-review instructions.
- `task4-green-2.log`: all 27 prompt tests passed. Absent versus explicit custom
  review already worked before this change; that case does not claim new RED.

The first run-once command timed out at the tool boundary. Its partial output is
`task4-gate.log`, not a passing result. The complete rerun,
`task4-gate-full.log`, passed all 840 tests with exit 0.

A later Task 2 regression found that the native manifest omitted the basic
`subagent-driven-development/SKILL.md` check. New source, staged, and path-mode
cases failed before the shared requirements merged basic files with native
files. `task2-member-skill-red.log` records that RED. Its GREEN passed 49 native
tests. `task2-gate-final.log` passed all 417 task-gate tests. The Task 3 gate
remained 114/114 after this correction (`task3-gate-final.log`).

## Installed candidate checkpoint

The safe updater passed without a protection exception
(`task5-managed-update.log`). It moved the pack from `2026.09.2` to `2026.10.1`.
It updated three files and removed ten obsolete managed files. This repository
explicitly changed only its implementation config reference. The active Issue
run keeps its saved executor. Local `landing` and
`patchmill-development-environment` bytes remain unchanged. No dependency or
upstream skill changed.

The exact plan helper smoke passed (`task5-helper-smoke.log`). In disposable Git
repository `/tmp/tmp.QGxZBODCDL`, task-start printed a readable brief and base
`7145d9bc51fdf8d8ae87b7cdf033d1fec5217556`. A failing task-done command returned
1 and wrote no completion ledger. The passing command recorded `PASS` and
`Task 1: complete`. The review package contained one delivery commit and 332
bytes, including `delivery.txt`. The smoke removed only its disposable
repository. This helper smoke is not evidence for actor workspace-preservation
scenarios.

`task5-installed-audit.log` compares all 64 managed files with their resolved
source bytes, metadata hashes, and executable bits. All agree. Source roots came
from `defaultSkillSourceRoots()`. The installed pack and both dependency
contracts agree with Superpowers `v6.4.2` (`task5-contracts.log`, 22 tests
passed).

The installation root is:
`/home/roche/projects/patchmill/.worktrees/patchmill-issue-287-refactor-implementation-skills-to-inline-executi-implementation/.patchmill/skills`.
Each helper below resolves under that root and has mode `755`:

- `executing-plans/scripts/task-start`
- `executing-plans/scripts/task-done`
- `subagent-driven-development/scripts/sdd-workspace`
- `subagent-driven-development/scripts/task-brief`
- `subagent-driven-development/scripts/review-package`

`task5-installed-links.log` resolves relative Markdown links from each installed
entrypoint directory. No link is missing. The inline required inputs resolve to
`executing-plans/SKILL.md`, `requesting-code-review/code-reviewer.md`, and the
inline directory's `review-appendix.md` under that root. Planning inputs resolve
to `brainstorming/SKILL.md`, `writing-plans/SKILL.md`, and
`simple-english/SKILL.md`.

The candidate build and full lint passed (`candidate-build.log` and
`candidate-lint.log`). Changed prose received the pragmatic simple-English
self-check: short sentences, condition-first instructions, and exact
identifiers.

Five fresh installed actors must still run S1-S10 and H1-H3. They must retest S2
and S8-S10, preserve blocked workspaces, and show durable reporting before
cleanup. Tasks 1, 4, and 5 remain open until their evidence is consumed. All
Task 5 final commands, including the mandatory Nix build, must run against the
final state. Preliminary results above do not substitute for that gate.
