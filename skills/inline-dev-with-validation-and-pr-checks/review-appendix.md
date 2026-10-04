# Patchmill Review Appendix

Use this appendix with the installed upstream reviewer template. These specific
criteria govern overlapping general template advice. They do not override
approved scope, authorization, tool restrictions, or the reviewer's read-only
and no-child boundaries.

## Finding filters

Report only discrete, actionable problems introduced or worsened by this diff.
For each finding, identify an affected path, proven impact, and an actionable
correction. Do not report speculation about unknown callers or author intent.

An intentional required change is not a defect by itself. Intent does not excuse
a security fault or a broken requirement. Keep reasonable user expectations in
scope even when the specification has no example. Keep pre-existing problems
outside the fix pass unless this diff worsens them.

## Error boundaries

Evaluate each changed error handler at its actual boundary. Prefer propagation
unless local recovery preserves correctness. Flag swallowed parse errors,
misleading empty results, log-and-continue behavior, and fallback values that
conceal a failure.

A compatibility fallback requires an explicit requirement and tested behavior. A
boundary can translate an error, but it must not report false success. Match
errors by stable identifiers or codes, not message text.

## Security and operations

For changed paths that process untrusted input, inspect trusted redirect
destinations, parameterized SQL, and output escaping. For server-side URLs,
inspect local-resource access through DNS resolution and redirects.

Inspect back pressure and concrete operational risk. A report must name the
failure mechanism or operator intervention that can occur. Do not make a general
reliability claim without that mechanism.

## Structure

Add one Structure result for every item below. Each result gives evidence or a
reason that the item does not apply. State a finding once in Issues, then refer
to it from Structure.

1. **Complexity removal:** Identify new branches, modes, or layers that a
   simpler model can remove.
2. **Module growth:** Identify a file that crosses from fewer than 1,000 lines
   to more than 1,000 lines, or violates a stricter documented project limit.
3. **Shared paths:** Identify new special cases or feature logic spread through
   unrelated shared code.
4. **Abstraction value:** Identify wrappers or generic machinery without a clear
   benefit.
5. **Type boundaries:** Identify casts, optionality, or loose values that hide
   an invariant.
6. **Canonical ownership:** Identify logic that duplicates an existing helper or
   belongs in an established layer.
7. **Orchestration:** Identify unnecessary serialization or partial updates that
   add complexity or correctness risk.

A structural exception needs structural justification. Green tests alone do not
justify it. An in-scope structural defect is presumptively Important. Keep
speculative style suggestions Minor. Make a larger reframe a non-blocking
recommendation for a parent ruling, with its cost if wrong.

## Command evidence and callouts

List each required command, its result, and an evidence location. State every
unrun or unavailable command as an explicit unknown. Keep diff findings,
validation blockers, and operator blockers separate.

End the review report with this exact final section:

## Human Reviewer Callouts (Non-Blocking)

List applicable migrations, dependency changes, permission or authentication
changes, breaking public contracts, and irreversible operations. If none apply,
state `- (none)`. These callouts are informational. A callout alone does not
change the verdict or create a fix item.
