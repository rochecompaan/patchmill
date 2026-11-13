# Domain modeling and codebase design in Patchmill planning

- **Issue:** [#173](https://github.com/rochecompaan/patchmill/issues/173)
- **Status:** Proposed specification
- **Stage:** Specification only. The implementation plan belongs to a later
  stage.
- **Maintainer decision:** Plan review requires a fresh reviewer, not planner
  self-review.
- **Frontend design:** Not applicable. This change affects skills, installation,
  and documentation, not visible UI behavior.

## Intent

Patchmill planning must use the existing domain model and explain its
architectural choices. A plan must receive an independent, codebase-backed
review before planning reports success. The review must assess design quality,
not only completeness and buildability.

The design favors deep modules: substantial behavior behind a small interface at
a clean seam. It keeps architectural judgment in skills, not in the kernel.

## Goals and limits

The change must:

- Use Matt Pocock `domain-modeling` during specification work that defines or
  changes architecture.
- Use Matt Pocock `codebase-design` for specifications that define or change
  modules, interfaces, seams, or adapters.
- Preserve established domain language and expose conflicts with code or
  architectural decision records (ADRs).
- Require explicit ownership, interfaces, hidden implementation, dependencies,
  and test surfaces in architectural specifications.
- Require a fresh, read-only `reviewer` to inspect the relevant code before
  judging a plan.
- Install both upstream skills and their resources in every managed planning
  environment.
- Keep dependency references, installed files, metadata, tests, and
  documentation consistent.

The change does not add a kernel phase, configuration hook, architecture score,
or persisted review state. It does not automatically refactor the target
repository or replace human approval gates. It does not fork Superpowers
workflows or install the whole Matt Pocock skill collection. It does not require
domain documents for changes that resolve no domain concept or architectural
decision.

## Approaches

### Extend the managed pack and planning wrapper — selected

Install two pinned upstream skills through the existing installer. Add
applicability rules and a local review prompt to the Patchmill planning wrapper.
Reuse the canonical `reviewer` and existing subagent runtime.

This approach concentrates planning policy in one place and preserves the
existing workflow interfaces. The maintainer selected fresh review rather than
planner self-review. The pack and wrapper integration are planner
recommendations based on the current code.

### Vendor modified upstream workflows — rejected

Copying and editing Superpowers or Matt Pocock workflows permits direct
customization. However, it creates another source of workflow behavior and makes
upstream updates harder to inspect. Patchmill can express its repository
conventions and review requirements in its own wrapper instead.

### Add a kernel architecture-review gate — rejected

A deterministic phase can record that a review ran, but cannot determine whether
its architectural judgment is sound. It adds workflow machinery without
replacing the required source inspection. Existing human gates remain sufficient
for approval and publication.

## Existing architecture and evidence

The inspected base is `d4a9ba4` on `main`.

| Evidence                                                         | Current responsibility and implication                                                                                                                                   |
| ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `CONTEXT.md` and `docs/agents/domain.md`                         | Patchmill declares one domain context and uses `CONTEXT.md` for its language.                                                                                            |
| Repository domain files                                          | No `CONTEXT-MAP.md` or `docs/adr/` exists at this base. Their absence does not require creation.                                                                         |
| `skills/patchmill-planning/SKILL.md`                             | Owns stage boundaries, required siblings, artifact publication, and the Testing Value Gate. It currently forbids required subagents.                                     |
| `.patchmill/skills/writing-plans/SKILL.md`, `Self-Review`        | The installed Superpowers workflow reviews coverage, steps, types, Review Focus, and proportion. This is planner self-review, not independent review.                    |
| `src/cli/commands/init/skill-installer.ts`, `installSkills`      | Resolves dependencies from `packageRoot`, recursively copies selected skills, and records versions and file hashes. Its source layout currently assumes `skills/<name>`. |
| `src/cli/commands/skills/main.ts`, `main`                        | Verifies managed hashes before update, calls `installSkills`, and removes resources no longer shipped.                                                                   |
| `src/cli/commands/init/agent-dir.ts`, `REVIEWER_AGENT`           | Provisions the canonical fresh-context reviewer with read-only instructions and a prohibition on nested agents.                                                          |
| `src/cli/commands/run-once/main.ts`, `main`                      | Supplies the `pi-subagents` extension for Run-once workflow phases, including planning.                                                                                  |
| `src/console/start.ts`, `startConsole`                           | Provisions the agent directory and loads the subagent runtime and configured skill directories for Interactive Issue runs.                                               |
| `src/console/skills.ts`, `consoleSkillPaths`                     | Discovers supporting skills from the configured planning and implementation pack directories.                                                                            |
| `src/kernel/phase-skill.ts`, `resolvePhaseSkill`                 | Resolves the configured planning entry point. Supporting skills must follow this pack, not a global installation.                                                        |
| `skills/patchmill-implementation/SKILL.md`, `Independent review` | Already requires a fresh canonical reviewer. Plan review can reuse this role without adding another agent type.                                                          |
| `nix/package.nix`                                                | Packages dependencies beside the executable and runs the test suite. Dependency changes require a new Nix verification build.                                            |

The installer tests exercise recursive copying, source-package resolution, file
hashes, repair, permissions, and idempotence. The skills-update tests exercise
managed-file protection and resource removal. The console skill tests exercise
discovery and worker skill resolution. These are the existing behavior-level
test surfaces.

## Domain model

### Language and context relationships

Patchmill remains a single-context repository. Planning, skill installation, and
review are responsibilities within that context, not new bounded contexts. The
planning wrapper consumes the installed pack and delegates evidence gathering to
the reviewer. The kernel retains phase selection and human-gate enforcement.

The following distinctions apply:

- **Plan review** is a fresh reviewer's assessment of an implementation plan
  against its specification and the existing codebase.
- **Plan gate** is the existing human-control pause defined in `CONTEXT.md`.
- **Spec gate** is the existing human-control pause for a specification.
- A reviewer verdict supplies evidence. It does not satisfy either human gate.

The maintainer resolved the previously ambiguous reviewer identity: Plan review
requires a fresh reviewer. During implementation of this issue, add the Plan
review definition to `CONTEXT.md`. Its rejected synonyms are “Plan gate” and
“Planner self-review.” General programming terms such as module and adapter
remain in the architecture vocabulary, not the Patchmill domain glossary.

### Domain modeling during specification work

Before drafting an architectural specification, the planner must read and follow
the installed `domain-modeling/SKILL.md`. The planner must actively challenge
terminology and relationships, not only read a glossary.

The planner must:

1. Read repository instructions and the root `CONTEXT.md` and `CONTEXT-MAP.md`
   when present.
2. Use an existing context map to find relevant context documents and their
   relationships.
3. Read relevant system-wide and context-specific ADRs.
4. Use established domain terms consistently in the specification, examples, and
   proposed interfaces.
5. Identify ambiguous, overloaded, or conflicting terms.
6. Cross-check proposed behavior and ownership against relevant code and
   concrete scenarios.
7. Record the affected contexts and their relationships, including a
   single-context conclusion when applicable.
8. Capture each resolved domain term immediately in the repository's canonical
   domain document, subject to explicit envelope limits.
9. Surface conflicts with code or ADRs for an explicit decision.

An ADR conflict must identify the ADR and explain the contradiction. The planner
must not silently override the decision or describe a proposed replacement as
accepted. Unresolved conflicts block completion of the affected design.

Domain documents remain domain documents, not specifications or implementation
notes. An ADR requires a real trade-off, meaningful reversal cost, and a
decision that otherwise needs explanation. Absent documents are not errors. No
empty glossary, context map, or ADR directory is required.

The upstream revision uses `GLOSSARY.md` and `GLOSSARY-MAP.md` names.
Patchmill's wrapper must explicitly adapt those references to repository policy
without modifying upstream skill bytes. For this repository, `CONTEXT.md` is
canonical. Do not create a parallel `GLOSSARY.md`. For repositories with an
explicit glossary convention, preserve that convention and still read existing
`CONTEXT` documents. If competing documents disagree, surface the conflict
rather than choose silently.

### Domain documents as planning artifacts

Ordinary specification work permits relevant domain-document changes alongside
the specification. This includes resolved terms, resolved context relationships,
and justified ADRs, not product code or an implementation plan.

The planning wrapper and interactive `patchmill-plan` helper must explicitly
permit these companion planning artifacts. They must preserve the existing stops
before the implementation plan and product implementation.

Capture a resolution immediately in the canonical document during authorized
planning work. List changed domain documents in the specification's top-level
`## Companion artifacts` section, with repository paths and relative links.
Commit and publish those documents with the specification through its existing
approval path. They receive the same human review as the specification.

If an explicit envelope permits fewer artifacts, obey that narrower limit.
Record the resolved definition, target document, and reason for deferral in the
specification immediately. Assign the update to the next authorized stage. Later
planning and review must read this resolution alongside existing domain
documents. They must not claim that the canonical document already contains it.

This run records the resolved Plan review term for the later implementation
stage. Its explicit spec-only envelope permits only this specification, not a
separate domain-document edit. No new ADR is necessary for this reversible
skill-workflow extension.

## Specification-time architecture analysis

The planner determines applicability from the proposed behavior, not file
extensions or issue labels. A documentation-only proposal can still define
architecture.

Architecture changes include changes to domain ownership, context relationships,
module responsibilities, interfaces, seams, adapters, or dependency direction.
Specifications that define or change architecture require domain modeling.
Specifications that define or change modules, interfaces, seams, or adapters
require codebase design. A specification can require both skills.

For codebase design, the planner must read `codebase-design/SKILL.md` and
`codebase-design/DEEPENING.md` before settling the design. The planner must use
these terms consistently:

| Term          | Meaning                                                                                                                    |
| ------------- | -------------------------------------------------------------------------------------------------------------------------- |
| **Module**    | Behavior with an interface and an implementation, independent of its size.                                                 |
| **Interface** | Everything callers must know, including invariants, ordering, errors, configuration, and relevant performance constraints. |
| **Depth**     | The behavior available per unit of interface knowledge, not a count of implementation lines.                               |
| **Seam**      | A location where behavior can vary without edits at that location.                                                         |
| **Adapter**   | A concrete implementation that satisfies an interface at a seam.                                                           |
| **Leverage**  | The capability that callers gain from module depth.                                                                        |
| **Locality**  | The concentration of related behavior, knowledge, changes, and verification.                                               |

An applicable specification must explain:

- Which modules own the affected domain behavior and why that ownership fits the
  domain model.
- What callers must know, including contracts beyond type signatures.
- Which implementation details remain hidden.
- Where external and internal seams belong, and what genuinely varies there.
- Which adapters exist or are justified, including concrete production and test
  uses.
- How dependencies enter modules instead of modules constructing replaceable
  dependencies internally.
- How the design preserves or improves locality and leverage.
- How tests exercise observable behavior through module interfaces.

The analysis must cite relevant existing files, symbols, call flows, interfaces,
tests, and ADRs. It must not justify a new pass-through module merely because a
file-size target suggests a split. It must distinguish a real test adapter from
a speculative future implementation.

For a non-architectural change, record a short reason that these design steps do
not apply. Do not invent module decompositions, domain terms, or domain
documents to fill a template.

## Module design for this change

### Planning module

The planning wrapper keeps its existing interface: the envelope, repository
instructions, issue data, and stage-specific artifact paths. Callers do not need
another configuration key, review phase, result field, or agent type.

The wrapper owns applicability decisions, skill invocation, architectural
specification requirements, and Plan review orchestration. A supporting prompt
at `skills/patchmill-planning/plan-review.md` owns the review brief and rubric.
The installer already copies supporting resources recursively, so this prompt
travels with the wrapper.

The wrapper hides prompt assembly and review sequencing from kernel callers. It
must remove its current prohibition on required subagents for Plan review. It
must permit the domain companions defined in this specification while preserving
stage gates and publication rules. Frontend, result, and Testing Value Gate
requirements remain unchanged. Interactive approval and PR selection remain
controlled by the interactive envelope.

This interface gains depth by hiding design and review coordination behind the
existing planning entry point. Locality keeps both the policy and its reviewer
prompt in the planning skill directory. Leverage gives unattended and
interactive planning the same requirements.

### Installation module

`installSkills({ repoRoot, skillDir, packageRoot })` keeps its current interface
and result counts. The caller supplies package location and destination
dependencies. The installation module hides upstream directory layouts,
recursive copying, license copying, hashes, and source-version recording.

The installer must support the selected Matt Pocock source layout without
changing the installed sibling layout. It must resolve the source dependency
from the supplied `packageRoot`, never the current directory or a global
package. The existing update command remains a caller of this interface. No
generic skill-provider registry or new adapter interface is necessary for one
additional filesystem layout.

Tests call `installSkills` against temporary destinations and isolated package
fixtures. They observe installed bytes, metadata, permissions, repair, and
repeat-install behavior through that interface. They do not depend on a private
copy helper or expose internal seams for testing.

### Reviewer seam

The existing subagent runtime is the seam between the planning module and a
fresh reviewer. The planner passes an explicit review brief. The reviewer
returns an evidence report. The reviewer does not edit artifacts, install
dependencies, publish, mutate host state, or start agents.

This change adds no new runtime adapter. It reuses the established `reviewer`
role and runtime rather than building a planning-only transport. The review
prompt supplies the skill paths and target code explicitly, so reviewer skill
auto-discovery is not required.

## Pinned upstream skills and distribution

Use the inspected MIT-licensed `mattpocock/skills` revision:

- Package name: `mattpocock-skills`.
- Upstream package version: `1.3.2`.
- Immutable revision: `5863806dd4e15c63174bee4e7515a4256792ecfa`.
- Dependency archive:
  `https://github.com/mattpocock/skills/archive/5863806dd4e15c63174bee4e7515a4256792ecfa.tar.gz`.

The root manifest exists, so no generated vendor package is necessary. Use one
production dependency for both skills, not separate downloads or moving branch
references. Record archive integrity in both npm lockfiles through the normal
dependency workflow. Keep `package.json`, `package-lock.json`, and
`npm-shrinkwrap.json` consistent.

| Upstream source directory             | Installed directory                  |
| ------------------------------------- | ------------------------------------ |
| `skills/engineering/domain-modeling/` | `.patchmill/skills/domain-modeling/` |
| `skills/engineering/codebase-design/` | `.patchmill/skills/codebase-design/` |

Copy each complete selected directory without modifying its upstream contents.
This includes `ADR-FORMAT.md`, `GLOSSARY-FORMAT.md`, `DEEPENING.md`, and
`DESIGN-IT-TWICE.md`. Include any other files shipped within those two
directories. Copy the upstream root MIT `LICENSE` into each installed skill
directory and include it in the managed hashes.

Add `sources.mattPocock` to the manifest with the upstream package version. The
dependency archive identifies the revision, and managed file hashes identify the
exact installed bytes. `THIRD_PARTY_NOTICES.md` must record the repository,
version, revision, source paths, installed paths, and license. Regenerate this
repository's tracked `.patchmill/skills` pack and manifest from the
implementation's installed dependencies. Preserve the existing updater refusal
for locally edited or missing managed files. Do not disguise mismatches with
hand-edited hashes.

Both `init` and `skills update` must install these resources. They must remain
available in npm and Nix installations, unattended planning, and Interactive
Issue runs. Planning resolves siblings from its configured entry point, not a
hard-coded user-home path. Custom planning entry points remain operator-owned
and must supply the required supporting pack. No planning or review session
fetches upstream guidance at runtime.

If a required skill, resource, reviewer, or subagent tool is absent, planning
cannot report success. Unattended planning returns `needs-input` with the
missing prerequisite. Interactive planning asks the maintainer and waits for
guidance. It never silently substitutes self-review.

## Fresh Plan review

Every new or revised implementation plan receives this review, including a plan
written during an ungated implementation-stage planning session. The spec-only
stage does not invent an implementation plan to review. Superpowers self-review
remains useful preparation, but cannot replace the fresh reviewer.

### Handoff and independent inspection

After the complete plan passes planner self-review, dispatch one fresh-context
canonical `reviewer`. Do not use the disabled `code-reviewer` role or pass the
planner's conversation history. Use the most capable available review model with
explicit model and thinking settings, consistent with implementation review.

The brief supplies:

- The issue requirements, specification, plan, repository instructions,
  worktree, and inspected base revision.
- Exact paths to the installed domain-modeling and codebase-design guidance and
  supporting review prompt.
- Any resolved domain decisions and known conflicts, as claims for the reviewer
  to verify.
- Candidate source and test locations as discovery hints, not an exhaustive or
  authoritative architecture summary.

The reviewer must independently read the relevant source and tests before
assessing the plan. The reviewer must determine:

1. Domain concepts, established language, relevant context documents, and ADRs.
2. Existing modules, their interfaces, and caller obligations.
3. Important internal and external seams and actual adapters.
4. Responsibilities and files that change together, using call sites and history
   where useful.
5. Dependency direction and construction or injection points.
6. Current test surfaces and observable outcomes.

Reading only the specification, plan, diff, or planner-provided architecture
summary is insufficient. For non-architectural work, inspection remains
proportionate and can conclude that architecture changes do not apply.

### Required rubric

The reviewer must determine whether the plan:

- Follows the domain model or explicitly proposes a justified improvement.
- Gives each affected domain concept clear ownership.
- Preserves or improves locality and leverage.
- Creates deep modules instead of shallow pass-through modules.
- Keeps each interface smaller than the complexity that it hides.
- Places seams where behavior genuinely varies.
- Keeps internal seams out of public interfaces unless callers need them.
- Justifies adapters with real variation rather than hypothetical future needs.
- Accepts replaceable dependencies instead of constructing them internally.
- Tests observable behavior through module interfaces.

The reviewer must apply these three principles explicitly:

- **Deletion test:** If deleting a module removes complexity, the module is
  probably a pass-through. Valuable depth redistributes complexity to callers
  after deletion.
- **The interface is the test surface:** Tests and callers cross the same seam.
  Internal refactors must not require behavior-test rewrites.
- **One adapter is hypothetical, two establish a real seam:** Production and
  test adapters can justify variation. Names or speculative future adapters
  cannot.

For deepening proposals, use the dependency categories in `DEEPENING.md` to
assess injection and test strategy. Keep substitutable local seams internal when
callers do not need them. Replace redundant shallow-module tests with
interface-level behavior tests rather than layer both suites without purpose. Do
not require adapters for in-process computation or unrelated refactors in
untouched modules.

### Findings and disposition

The report contains a short architecture survey, evidence-backed findings,
inspection limits, and a readiness conclusion. The survey cites the code and
tests that establish the current architecture. Each blocking finding must name
the violated requirement, concrete source evidence, user or maintenance impact,
and the smallest required correction. Evidence can cite files and symbols, call
flows, interfaces, seams, or ADRs. Generic preferences such as “use cleaner
architecture” do not block a plan.

The planner records each finding and its disposition in a concise Plan review
section of the implementation plan. Accepted blockers require plan corrections
before success or human submission. Rejected findings require concrete
counter-evidence, not an unsupported dismissal. If a correction changes the
specification, respect the existing Spec gate rather than silently expand
approved scope.

Allow one initial review and one fresh, scoped confirmation after blocking
corrections. The confirmation reviews the corrections and their architectural
effects, not unrelated new design preferences. If blockers remain or a material
decision needs human input, request guidance through the applicable channel. Do
not replace missing confirmation with planner approval.

The final plan records the reviewed artifact revision or content identity,
findings, dispositions, and confirmation outcome when applicable. Later material
edits to tasks or architecture invalidate that review and require a new review
before publication. Review completion never grants permission to merge or
advances a human gate by itself.

## Documentation changes

Update the planning requirements in
`site/src/content/docs/guides/skills-configuration.md`. Document applicability,
the two added skills, domain-path adaptation, required specification analysis,
and fresh Plan review. Explain the prerequisite failure behavior and the
difference between Plan review and the Plan gate. Correct the touched
planning-workflow description to match current gated and interactive behavior,
rather than repeat obsolete draft-PR rules.

Update relevant interactive-planning documentation to explain that it follows
the same design and review requirements. Update `docs/agents/domain.md` only
where necessary to explain the upstream naming adaptation. Keep third-party
provenance in `THIRD_PARTY_NOTICES.md` and the resolved Plan review term in
`CONTEXT.md`. Do not revise historical approved specifications or plans as part
of this change.

## Verification strategy

The implementation plan must preserve the Testing Value Gate. Do not add tests
that only search skill prose, assert dependency-version literals, or duplicate
static configuration.

### Behavior-level integration checks

Extend existing installer and updater coverage to prove:

- Both skills and complete supporting trees come from the package-local
  dependency's nested source layout.
- Source bytes, copied licenses, recorded hashes, and source versions describe
  the actual installation.
- Repeat installation preserves unchanged bytes and modification times.
- Existing repair, permissions, managed-edit protection, and resource-removal
  behavior still works.
- Isolated package fixtures resolve the supplied dependency, not an ambient
  installation.

Extend discovery coverage only where necessary to prove actual loading of the
installed sibling skills. Use the existing console and Run-once runtime suites
to verify that reviewer capability remains available. No model-backed review is
necessary inside automated installer tests.

### Direct workflow scenarios

Inspect the shipped and regenerated instructions, then exercise bounded planning
scenarios:

1. An architectural specification uses both skills and cites existing domain and
   code evidence.
2. A term conflict or ADR conflict remains explicit until resolved. Ordinary
   spec-stage resolutions update domain companions. A narrower envelope records
   the resolution and its deferred destination without unauthorized edits.
3. A non-architectural correction creates no unnecessary domain artifacts.
4. A plan with a shallow pass-through or unjustified adapter receives a concrete
   source-backed blocking finding.
5. A sound plan receives a fresh review whose architecture survey comes from
   actual code and tests.
6. Missing skills, supporting resources, or reviewer capability stop success
   instead of triggering self-review fallback.
7. Spec-only work stops before a plan, while every path that writes a plan
   performs fresh review.
8. Unattended and interactive planning retain their respective publication and
   human-approval contracts.

These scenarios verify agent instructions directly rather than introduce tests
that assert their wording. Record the scenario evidence in the implementation
delivery.

### Packaging and repository checks

Directly compare the immutable dependency reference, installed upstream version,
installed paths, manifest entries, provenance, and regenerated pack. Inspect an
npm package dry run and a clean package installation for both selected skill
trees and their resources. Verify the Nix-installed command can resolve the same
pack from its packaged dependency location.

Run the relevant behavior suites and the repository's type, lint, format, and
build checks. Run `nix build` after dependency and lockfile changes, with the
corresponding `npmDepsHash` update. Report actual failures and missing
prerequisites rather than claim unperformed checks.

## Acceptance criteria

- Architectural specification work reads and uses the pinned Matt Pocock
  domain-modeling skill.
- Module and interface design reads and uses codebase-design and `DEEPENING.md`.
- Specifications respect repository domain conventions and surface relevant code
  or ADR conflicts.
- Architectural specifications explain ownership, caller obligations, hidden
  implementation, seams, adapters, dependency entry, locality, leverage, and
  observable tests.
- Every new or revised plan receives a fresh, read-only review with independent
  source and test inspection.
- The review applies the full rubric, deletion test, interface test surface, and
  real-adapter principle.
- Blocking architecture findings cite concrete codebase evidence and cannot
  remain unresolved at successful submission.
- Reviewer completion remains distinct from human Spec and Plan gates.
- Non-architectural changes do not require new domain artifacts.
- Managed planning environments receive both complete skills, resources, and
  licenses without runtime downloads.
- Dependency references, metadata, provenance, tests, generated pack, and
  installed bytes identify the same upstream version and revision.
- Documentation explains the new planning and review requirements.

## Left to the implementation planner

The implementation plan determines task boundaries and exact test cases within
this design. It can choose a small internal representation for the additional
source layout without creating a general plugin system. The plan must name the
affected files and prove package-local resolution, installation behavior, and
both planning entry paths. It must not implement this specification before the
required planning gates permit implementation.
