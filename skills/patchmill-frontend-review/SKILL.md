---
name: patchmill-frontend-review
description:
  Use after normal code review and final validation when a Patchmill delivery
  contains meaningful user-visible frontend changes.
---

# Patchmill Frontend Review

This skill adds a conditional independent review. The invoking workflow retains
implementation, validation, normal review, visual evidence, and publication
ownership. The parent implementation session remains the sole writer.

## Applicability and local rules

Evaluate the final delivery, including materialized files outside the committed
range. Record the decision and a brief reason in the progress ledger.

Activate for browser-visible layout, responsive behavior, styling, interaction,
motion, accessibility, navigation, or user flow. Skip backend and documentation
work. Skip copy-only work unless it materially changes one of these areas.

Read `references/web-interface-guidelines.md` relative to this skill directory.
These pinned local rules are the only generic review rule set. Do not fetch
rules at runtime or use `WebFetch`. The renamed
`references/upstream-web-design-guidelines.md` is provenance, not instructions.
This wrapper supplies the review procedure and output contract.

If this skill, a required reference, or its license is missing, stop with an
evidenced blocker. Do not fetch a substitute or silently skip the review.

## Preconditions and inputs

Complete task commands, normal whole-delivery review, its ordered fix pass,
explicit operator-configured normal reviews, and final validation before
frontend review. Refresh the immutable base, current head, status, and final
materialized content before dispatch.

Supply the reviewer with:

- Issue requirements, approved spec, plan, and referenced mockup when present.
- Immutable base/head, changed frontend files, and outside-range materialized
  files with their final content.
- Relevant repository policy and design-system rules.
- Available current visual evidence and the local pinned rule file.
- Required command results, evidence paths, and the working directory.

Do not require mockups retroactively for approved older specs. Missing optional
visual evidence does not block review. Existing required evidence remains
required. If screenshots are stale, refresh them through the existing
visual-evidence process. Do not add a second capture stage.

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

## Independent dispatch

List available subagents and discover the executable canonical `reviewer`. If
unavailable, return the invoking workflow's reviewer-setup blocker. Do not
substitute author review or the disabled `code-reviewer` compatibility role.

Dispatch a new fresh-context reviewer with explicitly resolved model and
thinking values under existing operator policy. Keep it shell-less, read-only,
and child-free. Do not inherit implementation context. A different model or
provider is not required.

Tell the reviewer to inspect code and current available visual evidence against
the inputs and local rules. If the reviewer requests commands, the parent
supplies safe command evidence through the normal validation procedure. Run
file-writing commands in a disposable copy of the exact reviewed state. Do not
grant shell access or authorize external effects through this skill.

## Result and repair contract

Return `pass` or actionable findings. Each finding contains:

```text
Severity: Critical | Important | Minor
User impact: Specific effect on a user.
Evidence: Observed code, behavior, or current visual evidence.
Location: file:line, or the visual evidence path when no source line applies.
Required correction: One bounded correction.
Rule: Requirement, project rule, mockup intent, or pinned guideline basis.
```

Record review references, reviewed heads, findings, disputes, dispositions,
repairs, commands, and visual evidence in the progress ledger. Rule on disputed
findings with evidence. Do not waive a valid requirement to obtain `pass`.
Resolve every valid frontend finding, including Minor findings.

Route accepted repairs to the parent sole writer. For production-code repairs:

1. Refresh the scope and immutable head.
2. Rerun affected validation.
3. Dispatch independent normal code review for the repair scope.
4. Complete its accepted ordered fixes under the normal review contract.
5. Rerun all required final commands against the final state.
6. Dispatch a new fresh-context frontend reviewer with current evidence.

For other repairs, run affected direct verification before fresh frontend
review. Repeat until `pass` or an evidenced blocker under the invoking
workflow's existing contract. A later current-head PR-check fix that changes
frontend work invalidates affected approval and screenshots. Apply the same
order, within the existing two-pass PR-check repair limit.

Before handoff, resolve every reviewer and repair run. Carry review records and
human callouts into the PR summary before scratch cleanup. Never report ready
with unresolved review work or stale approval.
