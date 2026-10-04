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

The controls already complied with parts of S2 and S6-S10. This baseline does
not invent a RED result. The candidate wrapper must add the missing explicit
policy for the complete Structure section, final callouts, one review dispatch,
and one ordered fix pass.

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
Important structural finding. All kept S2 out of Issues, kept S4 as a ruling
with a cost if wrong, and treated S5 as an informational migration callout.

All samples required immutable whole-range package binding for S6, separate
failure classes and disposable output for S7, no duplicate completed task for
S8, no third repair for S9, and a blocker or no-child boundary for S10. The
reports state the actual commands that ran and mark unavailable helper or
hypothetical commands as unknown. Candidates 1, 3, and 4 could not run sibling
helper scripts in their synthetic repositories. This is an explicit evidence
gap, not a passing helper result.

Each candidate supplied all seven Structure results. Findings appear once in
Issues and Structure refers to them. The candidate reports prescribe one fresh,
read-only reviewer and no task-implementer dispatch. They did not dispatch a
reviewer from their disposable scenarios, so this is policy evidence rather than
an observed reviewer invocation. Task 5 must repeat the scenarios through the
installed helper paths.

| Required evidence                                       | Status                                                                |
| ------------------------------------------------------- | --------------------------------------------------------------------- |
| Five fresh behavior-shaping samples against the control | Observed; references above                                            |
| S1-S10 observed dispositions and evidence locations     | Observed; references above                                            |
| Seven Structure results                                 | Observed in every candidate report                                    |
| One finding location per finding                        | Observed in the candidate review-shaped reports                       |
| One reviewer policy and no task-implementer dispatch    | Observed policy; no actual reviewer invocation in synthetic scenarios |
| Markdown lint after complete candidate evidence         | Recorded below after lint                                             |

## Installed-pack scenarios

Task 5 repeats S1-S10 and H1-H3 through installed paths. Record installed helper
paths, permissions, resolved relative links, model policy, reviewed heads,
command evidence, rulings, workspace preservation, and cleanup results in this
section.

Status: pending Task 5.
