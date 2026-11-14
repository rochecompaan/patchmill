# Fresh Plan review brief

Review the supplied implementation plan in a fresh context against its
specification, issue requirements, repository instructions, and existing code.
The planner supplies exact repository/worktree, artifact paths, base revision,
resolved decisions, and installed guidance paths. Treat the planner's summary
and candidate file list as claims and discovery hints, not evidence.

## Authority and inputs

Stay read-only. Do not edit files, install dependencies, publish, mutate Git or
hosting state, authenticate, or start agents. Read upstream guidance for its
analysis, not as permission to write domain documents or execute workflows.
Report missing inputs or inaccessible evidence rather than invent findings.

Read the installed `domain-modeling/SKILL.md`, `codebase-design/SKILL.md`, and
`codebase-design/DEEPENING.md` at the supplied sibling paths. Read project
instructions, relevant `GLOSSARY.md`, `GLOSSARY-MAP.md`, context glossaries, and
system-wide or context-specific ADRs when present. Read relevant legacy
`CONTEXT` documents and explicit deferred resolutions. Do not demand new domain
artifacts for a non-architectural change.

## Independent architecture survey

Before judging the plan, independently inspect relevant source, callers, and
tests. Reading only the plan, specification, diff, or planner's architecture
summary is insufficient. Determine:

- Domain concepts, established language, and conflicts with code or ADRs.
- Existing modules, their interfaces, invariants, ordering, errors, and caller
  obligations.
- Internal and external seams and the actual adapters at each seam.
- Responsibilities and files that change together, using history where useful.
- Dependency direction and construction or injection points.
- Current test surfaces and observable outcomes.

Cite the files, symbols, call flows, interfaces, tests, or ADRs that establish
this architecture. Keep inspection proportionate to the proposed change. A
non-architectural plan can preserve the existing architecture without inventing
a redesign.

## Review rubric

Determine whether the plan:

1. Follows the domain model or explicitly justifies an improvement.
2. Gives each affected domain concept clear module ownership.
3. Preserves or improves locality and leverage.
4. Creates deep modules rather than shallow pass-through modules.
5. Keeps interfaces smaller than the complexity they hide.
6. Places seams where behavior genuinely varies.
7. Keeps internal seams out of public interfaces unless callers need them.
8. Justifies adapters with real variation, not speculative future uses.
9. Accepts replaceable dependencies instead of constructing them internally.
10. Tests observable behavior through module interfaces.

Use **module**, **interface**, **depth**, **seam**, **adapter**, **leverage**,
and **locality** consistently. An interface includes everything callers must
know, not only type signatures. Depth measures leverage, not implementation
lines. Apply these principles explicitly:

- **Deletion test:** If deletion removes complexity, the module is probably a
  pass-through. Valuable depth redistributes that complexity to callers.
- **The interface is the test surface:** Tests and callers cross the same seam.
  Internal refactors must not require behavior-test rewrites.
- **One adapter is hypothetical, two establish a real seam:** Actual production
  and test adapters can justify variation. Names or future adapters cannot.

For deepening, classify dependencies with `DEEPENING.md`. In-process computation
needs no adapter. Keep substitutable local seams internal unless callers need
them. Owned remote transports and true external dependencies require justified
injected adapters and appropriate test stand-ins. Replace redundant shallow
tests with interface behavior tests rather than layer both suites without
purpose. Do not require unrelated refactors.

Retain the usual checks for spec coverage, task decomposition, interface/type
consistency, meaningful verification, and buildability. Architectural principles
supplement those checks rather than replace them.

## Findings and report

Return:

1. A short architecture survey with source and test evidence.
2. Blocking findings and optional suggestions, separated by impact.
3. Inspection limits, including evidence or dependencies you could not inspect.
4. A readiness conclusion, not human approval.

Each blocker must identify the violated requirement, concrete codebase evidence,
user or maintenance impact, and the smallest required correction. Cite files and
symbols, call flows, interfaces, seams, tests, or ADRs. Generic architectural
preferences and hypothetical concerns do not block a plan. A conflict with an
ADR must identify that decision and the contradiction.

For a scoped confirmation, review the accepted corrections and their
architectural effects. Do not reopen unrelated design preferences. Never grant
approval, change a human gate, or claim implemented behavior from an unexecuted
plan.
