# Planning review brief

Review the supplied planning documents in a fresh context. Be adversarial: look
for gaps, contradictions, wrong assumptions, and risky design choices. The scope
is a specification, an implementation plan, or both, as the planner supplies.
Review each document in scope against the issue requirements and acceptance
criteria, repository instructions, existing code, and the other documents. The
planner supplies exact repository/worktree, scope, artifact paths, input
documents, base revision, resolved decisions, and installed guidance paths.
Treat the planner's summary and candidate file list as claims and discovery
hints, not evidence. Approved documents and a Parent spec are inputs, not scope.

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

## Conceptual explanations

Inspect the `## Visual explanation` of each new or materially revised document
in scope, including its inline diagrams or sketches and every linked HTML
companion. Read relevant explanations of input documents too. Verify agreement
with the document's concepts, behavior, task order, dependencies, and ownership.
A UI mockup does not replace a conceptual explanation.

For HTML, verify the actual file exists in the specification's directory. Check
that contextual and companion links resolve from the owning document and stay
within the worktree. Check its title, issue number, owning document name,
embedded assets, and direct-from-disk portability. Report any limits of visual
inspection. Do not install tooling or start a browser/server to perform review.

Confirm stage ownership: no early plan at a Spec gate, no backfill of unchanged
approved documents, and no approved-spec edit merely to link a plan visual.
Review a fallback as a useful inline explanation, not prose-only success or a
link to an absent file. Committed, linked HTML is sufficient. Do not demand
hosting, image previews, or a UI-design review for conceptual documents.

## Independent architecture survey

Before judging the documents in scope, independently inspect relevant source,
callers, and tests. Reading only the plan, specification, diff, or planner's
architecture summary is insufficient. Determine:

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

## Specification checks

Apply these checks when a specification is in scope:

- Each issue requirement and acceptance criterion is addressed or explicitly out
  of scope.
- No contradiction exists within the specification, or with the issue, the
  Parent spec, the glossary, or an ADR.
- Claims about current behavior match the source: names, call flows,
  configuration, and tests.
- Risky choices are explicit: irreversible actions, security boundaries, data
  loss, compatibility, and unattended runs that wait for a human.
- **Builder question:** find each place where a builder must guess and a wrong
  guess would matter. Skip what the document leaves to the builder and what a
  sensible builder can decide.
- Each acceptance criterion has a verification method.

## Plan checks

Apply these checks when an implementation plan is in scope:

- Each acceptance criterion and specification decision maps to a task.
- Each path, symbol, signature, command, and configuration key exists in the
  inspected base, or an earlier task creates it.
- Review code blocks as code: correct logic, types, and imports. Each test must
  fail before the change and assert meaningful behavior.
- Commands can run, and the expected output is plausible.
- Task order respects dependencies. The Testing Value Gate holds.

## Combined checks

Apply these checks only when the specification and the plan are both in scope:

- The plan does not contradict or silently extend the specification.
- Each specification decision that needs work has a task.

## Review rubric

Apply this rubric to each plan in scope, and to each specification in scope that
defines or changes modules, interfaces, seams, or adapters.

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

Retain the specification, plan, and combined checks, and the usual checks for
spec coverage, task decomposition, interface/type consistency, meaningful
verification, and buildability. Architectural principles supplement those checks
rather than replace them.

## Findings and report

Return:

1. A short architecture survey with source and test evidence.
2. Blocking findings and optional suggestions, separated by impact.
3. Inspection limits, including evidence or dependencies you could not inspect.
4. A readiness conclusion, not human approval.

Give each finding an identifier, the document, and the severity: blocker or
suggestion. Each finding must identify the violated requirement, concrete
codebase evidence, user or maintenance impact, and the smallest correction. Cite
files and symbols, call flows, interfaces, seams, tests, or ADRs. Generic
architectural preferences, style preferences, and hypothetical concerns do not
block a document. Mark a question that only a human can answer as such, so that
the planner can record it as an open assumption or ask the maintainer. A
conflict with an ADR must identify that decision and the contradiction.

For a scoped confirmation, review the accepted corrections and their effects,
including architectural effects. Do not reopen unrelated design preferences.
Never grant approval, change a human gate, or claim implemented behavior from an
unexecuted plan.
