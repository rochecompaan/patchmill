# Issue 177: Planning review verification

This record verifies the Planning review contract from the
[specification](../specs/2026-11-19-issue-177-add-adversarial-spec-and-plan-review-to-planning-design.md)
and the
[plan](../plans/2026-11-19-issue-177-add-adversarial-spec-and-plan-review-to-planning-plan.md).
Line numbers refer to the installed
`.patchmill/skills/patchmill-planning/SKILL.md` (`SKILL`) and
`.patchmill/skills/patchmill-plan/SKILL.md` (`HELPER`) at the implementation
commit. The installed copies are byte-identical to `skills/`.

## Scenario walkthroughs

| ID  | Scenario                                                    | Deciding text                                                  | Expected planner behavior                                                                                                                                 |
| --- | ----------------------------------------------------------- | -------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A   | Spec gate only                                              | SKILL 116–118, 343, 348–351                                    | At stage `spec`, review the spec alone before the spec PR. At stage `implementation`, review the plan against the approved spec before `done`.            |
| B   | Plan gate only                                              | SKILL 344, 348–351                                             | At stage `plan`, one combined pass over the spec and plan before the plan PR.                                                                             |
| C   | Both gates                                                  | SKILL 345, 318–320                                             | Spec at stage `spec`. Plan at stage `plan`. The approved spec is an input, not scope.                                                                     |
| D   | No gate                                                     | SKILL 346, 348–351; brief "Combined checks"                    | One combined pass before `done`, with the combined checks.                                                                                                |
| E   | Unattended human-only question                              | SKILL 376–381; "Final result" (433+)                           | Record a conservative choice in `## Open assumptions`. The run continues and does not return `needs-input` for it.                                        |
| F   | Plan-stage human-only question with an approved spec        | SKILL 376–381                                                  | The open assumption goes in the plan. The approved spec does not change.                                                                                  |
| G   | ADR or Parent spec conflict                                 | SKILL 382–386, 392–394                                         | Disposition `escalated`, outcome `escalated`. Interactive runs ask the maintainer. Unattended runs return `needs-input`.                                  |
| H   | Interactive request after brainstorming, then no spec edits | SKILL 322–333, 425–431                                         | The spec record is current and `ready`. The boundary check reviews only the plan, with the spec as input.                                                 |
| I   | Resumed session, unchanged document, latest outcome blocked | SKILL 392–401, 429–431                                         | The document does not cross. Only a document edit and a new review, or a recorded maintainer ruling, can lead to `ready`. Planner judgement alone cannot. |
| J   | Spec edit after a combined review                           | SKILL 409–410, 425–429                                         | The plan's recorded spec hash no longer matches, so both records are stale. The next boundary reviews both documents together.                            |
| K   | Missing `reviewer` or subagent tool                         | SKILL 31–35, 318; HELPER "Domain analysis and Planning review" | Interactive runs ask the maintainer and wait. Unattended runs return `needs-input`. No self-review substitute.                                            |

Each result follows from the installed text alone. The walkthrough found no
ambiguity that needed a skill change.

The builder check is replaced at SKILL 37–40. Its piles map to the dispositions
at SKILL 370–386.

## Body-hash helper

`scripts/planning-body-hash.test.mjs` covers receipt-only and body edits,
backtick, longer-backtick, and tilde fences, fenced headings inside the record,
a duplicated record, a section after the record, an inline backtick line that is
not a fence, CRLF and mixed line endings, documents with no record, and the
command's success and error exits.

The installed helper on this issue's planning documents:

| Document | Body SHA-256                                                       | Exit |
| -------- | ------------------------------------------------------------------ | ---- |
| Spec     | `bcbba04022ea69323e9c650e3a8b60c2383b971d22d4049771447b76bfbb3887` | 0    |
| Plan     | `ccb46d639e3b9c0706ec268444bcfd2b93310e4de126b2905e1c2dcc928e07b4` | 0    |

Both values match the final hashes in the documents' Planning review records.

## Integration checks

| Command                                                                     | Result                                       |
| --------------------------------------------------------------------------- | -------------------------------------------- |
| Source `skills update` command                                              | 5 written, 80 unchanged, 1 removed           |
| `test ! -e .patchmill/skills/patchmill-planning/plan-review.md`             | Passed                                       |
| `test -x .patchmill/skills/patchmill-planning/scripts/body-hash.mjs`        | Passed                                       |
| `diff -r` of `patchmill-planning` and `patchmill-plan` source and installed | No differences, also after the commit hook   |
| `rg "plan-review\.md\|Fresh Plan review" skills .patchmill/skills site/src` | No matches                                   |
| `npm run lint`                                                              | Passed                                       |
| `npm test`                                                                  | 1341 passed, 0 failed (baseline 1332 passed) |
| `git diff --stat 8f363d0 -- src package.json package-lock.json`             | No changes                                   |

No npm dependency changed, so the Nix build did not need to run again.
