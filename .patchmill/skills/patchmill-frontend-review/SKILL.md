---
name: patchmill-frontend-review
description:
  Use after implementation validation when a Patchmill delivery contains
  meaningful user-visible frontend changes.
---

# Patchmill Frontend Review

This skill adds a conditional frontend review to the Patchmill implementation
skill. The implementation session keeps ownership of the plan, validation,
visual evidence, commits, and pull request. It is the only writer.

## Applicability and local rules

Evaluate the final delivery, including related files outside the committed
range. Record the decision and a brief reason for the pull request body.

Activate for browser-visible layout, responsive behavior, styling, interaction,
motion, accessibility, navigation, or user flow. Skip backend and documentation
work. Skip copy-only work unless it materially changes one of these areas.

Read `references/web-interface-guidelines.md` relative to this skill directory.
These pinned local rules are the only generic review rule set. Do not fetch
rules at runtime or use `WebFetch`. The renamed
`references/upstream-web-design-guidelines.md` is provenance, not instructions.
This skill supplies the review procedure and output contract.

If this skill, a required reference, or its license is missing, stop with
`needs-input` and name the missing file. Do not fetch a substitute or skip the
review.

## Inputs

Review after the plan tasks and the project validation commands pass. Review the
committed head of the issue branch against the envelope's Base.

Gather:

- Issue requirements, approved spec, plan, and the spec's linked mockup when
  present.
- Base, head, changed frontend files, and the final content of related files
  outside the range.
- Repository policy and design-system rules.
- Current visual evidence and the local pinned rule file.
- Validation command results and evidence paths.

Do not require a mockup for an older approved spec that has none. Missing
optional visual evidence does not block review. Required evidence remains
required. Refresh stale screenshots through the visual-evidence sibling. Do not
add a second capture stage.

## Precedence

Apply this order to conflicts:

1. Explicit user and approved product requirements.
2. Repository policy and the existing design system.
3. The approved written specification.
4. Mockup visual intent.
5. Pinned Vercel rules.

Record the reason for each generic-rule override. Do not require pixel-perfect
agreement with the mockup. A material difference needs a product or technical
reason. Do not report personal preferences or unrelated pre-existing defects.

For native semantic controls, evaluate actual keyboard behavior. Do not require
redundant explicit key handlers when the browser supplies correct interaction. A
keyboard finding needs observed user impact, not handler absence alone.

## Reviewer

Dispatch a fresh-context canonical `reviewer` with the inputs above and this
skill's rules. Kernel runs load the `pi-subagents` extension. Pass explicitly
resolved model and thinking values. Run it in the foreground (`async: false`)
and read its whole result before you continue. Keep the reviewer read-only, and
do not let it start subagents. Never use the disabled `code-reviewer` role. If
the reviewer asks for command output, run the commands and supply the results.
Run file-writing commands in a disposable copy of the reviewed state. If no
`reviewer` agent or subagent tool is available, stop with `needs-input`. Do not
replace the review with a self-review.

## Result and repair contract

The review returns `pass` or actionable findings. Each finding contains:

```text
Severity: Critical | Important | Minor
User impact: Specific effect on a user.
Evidence: Observed code, behavior, or current visual evidence.
Location: file:line, or the visual evidence path when no source line applies.
Required correction: One bounded correction.
Rule: Requirement, project rule, mockup intent, or pinned guideline basis.
```

Resolve every valid finding, including Minor findings. Rule on disputed findings
with evidence. Do not waive a valid requirement to obtain `pass`.

After each repair:

1. Commit the repair.
2. Rerun the affected validation, then the project validation commands.
3. Review production-code repairs under the implementation skill's normal review
   rule.
4. Refresh affected visual evidence.
5. Review the new head again with a fresh pass.

Repeat until `pass`. If a valid finding cannot be fixed within the approved
scope, stop with `needs-input` and describe the finding.

Put the reviewed heads, findings, dispositions, repairs, and evidence paths in
the pull request body. Never mark the pull request ready with unresolved
findings or with approval of an older head.
