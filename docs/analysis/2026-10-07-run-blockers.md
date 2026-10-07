# Patchmill run blocker audit

Date: October 7, 2026. Repository: `rochecompaan/patchmill`. Parent tracking
issue: [#293](https://github.com/rochecompaan/patchmill/issues/293). Source
checkout:
[`83846f0bcd0717e8c152da510bf6ed9255812bbc`](https://github.com/rochecompaan/patchmill/commit/83846f0bcd0717e8c152da510bf6ed9255812bbc).
Inventory snapshot: `2026-10-07T06:24:01.669378+00:00`.

This report records evidence and proposed follow-up work. It is not an approved
design or implementation plan. The operator approved capturing the analysis, not
implementing its recommendations.

## Recommendation

Keep inline execution and repair mechanical failures first. Evaluate a small,
read-only Oracle after those repairs. An Oracle is an independent adviser for
disputed findings. It cannot grant permission, invent evidence, or waive safety
requirements.

Keep routine choices with the inline parent. Use independent judgment only for
disputed correctness, impact, scope, or contradictory approved inputs. Do not
restore the larger checkpointed, multi-review workflow from
[#265](https://github.com/rochecompaan/patchmill/issues/265).

## Scope and method

The audit covered all retained `run-*.jsonl` files under this project's
`.patchmill/runs/` and their nested Pi transcripts. It also inspected saved Run
recovery state, triage results, source files, skills, and relevant GitHub
issues. No additional run logs existed under project worktrees at inspection
time.

The inventory contained 293 run logs dated June 19 through October 7, 2026. The
transcript scan covered 1,354 files, 975,993,089 bytes, and 171,182 lines. Those
files contained 834 distinct native Pi session IDs and 520 exported child
transcripts. The exports overlap native child sessions. They are not 520
additional independent sessions.

A Run attempt is one process entry into the Run-once workflow. Several Run
attempts can belong to one Issue run. The audit assigned one primary reason to
each interrupted attempt and retained repeated retries as separate rows. It did
not count every secondary failure inside an attempt.

The audit separately inspected 28 triage result files. One recorded a provider
usage-limit failure. These results are not part of the 293 run logs. Two
malformed transcript lines appeared in one #186 child session and its exported
copy. They did not invalidate the event-log inventory.

The original catalog and its `runs.csv`, `interruptions.csv`, `sessions.csv`,
and `summary.json` remain local in
`.patchmill/reports/2026-10-07-run-blockers/`. This directory is ignored by Git.
The public report does not include raw transcripts, session identities, absolute
filesystem paths, or full recorded reasons. The evidence examples below are
paraphrases, not transcript quotations. Local source references preserve
provenance. They are not links to published files.

## Recorded outcomes

| Recorded outcome                        | Logs |
| --------------------------------------- | ---: |
| Blocked                                 |   46 |
| Error, including older error-level logs |   53 |
| Cleanup pending after a PR handoff      |    9 |
| PR created                              |   50 |
| Merged                                  |    1 |
| Spec created or found                   |   17 |
| Planning review pending                 |   11 |
| Dry run                                 |   30 |
| No issue selected                       |   14 |
| No terminal outcome recorded            |   62 |
| Total                                   |  293 |

There were 108 interrupted outcomes: 46 blocked, 53 error, and nine
cleanup-pending outcomes. They are not 108 distinct defects or a measured
failure rate. Dry runs, planning handoffs, preflight probes, and repeated
retries prevent that calculation.

Of the 62 logs without a terminal outcome, 55 ended during selection or Git
preflight. Seven ended in a Pi stage, including the active October 7
implementation of #226. A missing terminal record does not prove that a run
failed.

## Primary stopping reasons

| Primary reason                                    | Attempts | Response to evaluate                                                             |
| ------------------------------------------------- | -------: | -------------------------------------------------------------------------------- |
| Tracked workspace changes                         |       18 | Establish ownership, preserve user changes, and isolate run-owned scratch files. |
| Terminal output contract                          |       12 | Repair the result handoff without repeating completed work.                      |
| Workflow deadlines, handoffs, or stalled children |       10 | Repair delivery and deadlines, then resume eligible retained work.               |
| Real design, safety, or authority gaps            |       10 | Resolve the design and obtain the required operator authority.                   |
| Ignored generated files blocked cleanup           |        9 | Apply the approved cleanup policy and separate cleanup from delivery.            |
| Saved state or head drift                         |        8 | Reconcile proven identity without bypassing ancestry or ownership checks.        |
| Preserved or stale workspace state                |        8 | Explain the saved blocker and offer an exact recovery action.                    |
| Issue labels prevented admission                  |        8 | Reconcile labels against owned run state and authenticated decisions.            |
| Base branch absent from the remote base           |        7 | Use an explicit remote base or require deliberate publication.                   |
| Approved artifact conflict                        |        6 | Compare exact artifact identity and preserve conflicting content.                |
| Model, credentials, or quota                      |        4 | Preflight the isolated runtime without exposing credentials.                     |
| Baseline validation or dependency audit           |        3 | Prove whether the branch introduced the failure.                                 |
| Task ledger evidence missing                      |        2 | Reconcile completion evidence without inventing it.                              |
| External command or forge failure                 |        2 | Inspect uncertain mutations before a safe retry.                                 |
| Upstream tool contract gap                        |        1 | Resolve the pinned contract mismatch.                                            |
| Total                                             |      108 |                                                                                  |

These counts describe recorded stopping conditions. They do not prove that every
stop in a family was avoidable. Unknown tracked changes, conflicting artifacts,
and uncertain ownership often justified preserving the workspace.

## Representative evidence

### Cleanup after delivery

Nine attempts reached a PR handoff before ignored generated files blocked
cleanup. The affected issues were #242, #245, #252, #255, #256, #260, #271,
[#280](https://github.com/rochecompaan/patchmill/issues/280), and #287. Repeated
paths included `.devenv/`, `.husky/_/`, and dependency output.

This is a mechanical cleanup problem, not a judgment problem. Existing
[#262](https://github.com/rochecompaan/patchmill/issues/262) targets the shared
cleanup policy. Do not delete arbitrary files merely because Git ignores them.

Local source:
`.patchmill/runs/issue-255/run-2026-09-29T07-05-27-096Z.jsonl:378`.

### Passing verdicts with timed-out gates

In #156, a reviewer returned passing verdicts twice, but acceptance gates timed
out twice. The recorded blocker reported that both test suites later passed. In
[#245](https://github.com/rochecompaan/patchmill/issues/245), the validation
host gate timed out after a passing reviewer verdict. In
[#255](https://github.com/rochecompaan/patchmill/issues/255), a duplicate
focused-test gate timed out before required reviews started.

These records support removing redundant commands and setting deadlines from
actual command duration. They do not support counting a timed-out command as
passing without final evidence.

Local sources:

- `.patchmill/runs/issue-156/run-2026-09-12T09-43-45-801Z.jsonl:429`
- `.patchmill/runs/issue-245/run-2026-09-16T10-22-14-516Z.jsonl:333`
- `.patchmill/runs/issue-255/run-2026-09-29T03-43-50-430Z.jsonl:201`

### Late supervisor delivery and unfinished work

The #262 blocker reported two supervisor timeouts. Notifications arrived after
the worker stopped. The #271 reviewer timed out while waiting for a supervisor
decision. The #280 workflow stopped at a supervisor checkpoint before its final
reviews. Thirty-minute worker deadlines also stopped #255 and #262 with work
unfinished.

An Oracle through the same unreliable delivery path can introduce another
blocker. Require evidence that a headless parent receives a supervisor answer
before the child deadline.

Local sources:

- `.patchmill/runs/issue-262/run-2026-10-03T18-25-54-944Z.jsonl:178`
- `.patchmill/runs/issue-271/run-2026-09-26T13-33-42-016Z.jsonl:379`
- `.patchmill/runs/issue-280/run-2026-10-02T11-36-57-722Z.jsonl:318`

### Completed artifacts without the required result

Eleven attempts lacked a supported final JSON result. One other attempt lacked a
child `FINAL_STATUS` marker. In #262 planning, the final answer reported a
created, committed, and verified plan. Patchmill rejected the handoff because
the required final JSON result was absent.

At the audited checkout, implementation already supported up to two
result-repair attempts. The planning artifact agent did not supply that repair
configuration. Reuse the existing mechanism across applicable stages instead of
adding another implementation workflow. The host must still establish artifact
identity, required evidence, and unresolved reviewer work.

Local source: `.patchmill/runs/run-2026-10-01T06-25-50-907Z.jsonl:132`.

### Repeated safety questions without trusted authority

Eight interrupted #255 attempts recorded a real design or authority gap. The
approved plan required a regular-file lock and protection against replacement
races. The attempts identified a gap between inode comparison and pathname
deletion. A revised directory protocol then exposed a race around rename.

Several retries asked the same architecture question. The run reported that
approval in issue content did not satisfy its trusted-input contract. Repeating
the model call could not change that contract.

The eventual decision distinguished cooperating Patchmill processes from
arbitrary direct filesystem replacement. That changed the threat model, which
defines the failures and adversaries that a design must resist. An Oracle cannot
silently narrow that requirement or turn arbitrary issue comments into
authority. An authenticated operator answer must reach the resumed session as
trusted input.

Local provenance: the eight #255 design-gap rows in `interruptions.csv`.

## Historical failures and inline execution

[#265](https://github.com/rochecompaan/patchmill/issues/265) closed on October 4
as not planned, not as implemented. Its closure pointed to
[#287](https://github.com/rochecompaan/patchmill/issues/287) and replacement
design [PR #288](https://github.com/rochecompaan/patchmill/pull/288).
Implementation [PR #289](https://github.com/rochecompaan/patchmill/pull/289)
merged on October 5 at `09:23:08Z`. The default then used
`inline-dev-with-validation-and-pr-checks`.

The inline parent is the sole writer. It records routine ambiguities, runs one
independent final review, and makes one ordered fix pass. It does not require
per-task writers or repeated review loops. Do not attribute September failures
to this newer default.

The retained post-merge snapshot contained six attempts:

| Start, UTC       | Recorded outcome   | Evidence                                                            |
| ---------------- | ------------------ | ------------------------------------------------------------------- |
| October 5, 11:03 | No terminal record | Retained log ended during Pi setup.                                 |
| October 5, 11:05 | Blocked            | #226 required a command-lifecycle safety amendment.                 |
| October 6, 08:29 | Blocked            | #226 required authority for a verified PR-target fetch from a fork. |
| October 6, 19:45 | Error              | GitHub GraphQL label mutation failed.                               |
| October 6, 19:48 | No issue           | No eligible work was selected.                                      |
| October 7, 04:19 | No terminal record | #226 implementation was active at the snapshot.                     |

The two terminal implementation blockers were real safety questions. A fixture
changed a ref after its Run owner died, so owner-PID death did not prove safe
guard takeover. The fork case needed proof that the fetch endpoint matched the
saved PR target. Both questions received operator answers in
[#226](https://github.com/rochecompaan/patchmill/issues/226).

Local sources:

- `.patchmill/runs/issue-226/run-2026-10-05T11-05-53-623Z.jsonl:616`
- `.patchmill/runs/issue-226/run-2026-10-06T08-29-33-858Z.jsonl:726`
- `.patchmill/runs/run-2026-10-06T19-45-39-118Z.jsonl:5`

This sample is too small to establish inline reliability. The active #226
attempt continued after the snapshot. Its eventual outcome is outside this
report.

## Follow-up priorities

Track these five workstreams in #293. Give each new implementation issue a
narrow scope and separate approval. Keep this report and its parent issue
outside automated implementation intake.

1. Complete cleanup through existing #262. Keep a ready PR distinct from a local
   cleanup warning and preserve unknown ignored content.
2. Extend bounded terminal-result repair. Recover the handoff without repeating
   completed implementation or accepting invalid artifacts.
3. Improve runtime recovery. Separate failure types, preflight the actual
   runtime, establish baseline command evidence, and repair deadlines and
   supervisor delivery.
4. Make operator answers durable and trusted. Bind each authenticated answer to
   its pending question and artifact revision, then deliver it to resumed
   sessions.
5. Evaluate a narrow Oracle after the mechanical fixes. Require fresh context,
   read-only tools, exact reviewed-head identity, approved scope, and evidence.

Runtime recovery needs a precise blocked phase, supporting evidence, a next
action, and a statement about whether repeating the attempt can help. Preflight
the required role, model, and provider route in the isolated runtime without
printing credentials. Use explicit total and idle deadlines. A heartbeat alone
does not prove useful progress. Reuse command evidence only for identical
content, command, environment, and working directory. Repeat required commands
after accepted fixes change the final state.

An Oracle can accept, reject, defer, or request an operator decision. Bind each
ruling to the reviewed head and finding identity. Permit one adjudication and at
most one challenge based on material new evidence. An optional unavailable
Oracle must not become a blanket blocker for routine choices.

The Oracle must not grant authority, weaken an approved safety requirement,
write code, launch its own workflow, or force publication. It must not waive
required tests, ancestry checks, credential checks, or ownership checks. If a
ruling needs new authority, preserve the workspace and ask the operator once. If
a ruling fits existing authority, record it in the progress ledger and continue
inline execution.

## Evidence needed before claiming improvement

Use meaningful regression cases when the scoped changes reach implementation:

- A planning agent creates a valid artifact but omits its final JSON result.
- A ready PR leaves approved generated ignored content in its owned worktree.
- A long command reports progress within its agreed total budget.
- A supervisor answer reaches a headless parent before the child deadline.
- A forge retry inspects current state after an uncertain mutation failure.
- A base-only failure is reported accurately without speculative source changes.
- A disputed finding receives an evidence-based ruling without another review
  loop.
- A safety amendment cannot proceed without an authenticated operator answer.
- An accepted decision reaches the resumed session without the same repeated
  question.

Measure unnecessary human interventions, repeated blocker reasons, handoff
delays, result-repair success, and cleanup warnings after delivery. Split these
measurements by implementation skill version. Compare new inline attempts with
new inline attempts. Keep unknown outcomes distinct from known failures.

This publication changes documentation only. It does not change source code,
skills, dependencies, saved Run recovery state, or live execution controls. No
new automated test is warranted for this static report. Direct verification
covers inventory totals, cited source locations, formatting, and publication
scope.
