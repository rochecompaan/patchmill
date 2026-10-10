# Frontend design and independent frontend review

## Intent and scope

Issue #210 adds concrete visual intent and independent UX review to meaningful
frontend work. The existing sequence remains:

`brainstorming → writing-plans → implementation → normal code review`

The configured planning wrapper applies frontend guidance during brainstorming.
The implementation wrapper adds frontend review after normal review and final
validation. Neither change creates a top-level workflow phase.

This spec adapts the September issue attachments to the current repository.
Issue #287 replaced the three implementation wrappers with
`inline-dev-with-validation-and-pr-checks`. This change augments that wrapper
only. It does not restore retired workers, Codex reviews, or thermo-nuclear
reviews.

Issue #210 changes workflow resources, not browser-visible product UI. Its own
spec does not require an HTML mockup. The current planning pull request reviews
this document. Run-once owns publication and the next planning step.

## Approach

Extend `patchmill-planning` and the inline implementation wrapper through
sibling skills in the recommended pack. This approach keeps process instructions
with the workflows that use them.

A separate frontend specification wrapper adds navigation without independent
behavior. Frontend orchestration in TypeScript splits ownership between prompts
and skills. Neither alternative is required.

The supporting skills are `frontend-design` and `patchmill-frontend-review`.
Existing configured entrypoints remain unchanged. No new configuration key,
resource profile, execution method, or terminal JSON field is required.

Custom and global workflows remain supported. They receive this behavior only
through wrappers that adopt the same contract. Pack updates must not replace
custom entrypoints or rewrite `patchmill.config.json`.

## Activation and precedence

The planning author evaluates proposed scope. The implementation author
evaluates the final delivery, including materialized files outside the committed
diff. Each author records whether the augmentation applies and gives a brief
reason.

Activation covers browser-visible changes to:

- Layout or responsive behavior.
- Typography, color, spacing, imagery, or styling.
- Interaction or motion.
- Accessibility behavior.
- Navigation or user flow.

Copy-only edits do not activate these skills unless they materially change one
of these areas. Backend-only work and skill documentation skip the augmentation.
The implementation decision does not depend solely on the planning decision.

Conflicts use this precedence order:

1. Explicit user and approved product requirements.
2. Repository policy and the existing design system.
3. The approved written specification.
4. The mockup as visual intent.
5. Generic Anthropic guidance or pinned Vercel rules.

Generic preferences cannot replace approved project choices. Reviewers record
why a higher-priority requirement overrides a generic rule. The mockup does not
require pixel-perfect agreement. Material differences need a product or
technical reason.

## Specification and mockup contract

When frontend design applies, `patchmill-planning` reads
`../frontend-design/SKILL.md` during the normal brainstorming process. The
wrapper explicitly treats this sibling as specification guidance, not a product
implementation skill invoked after brainstorming.

Before the spec is complete, the author creates
`docs/mockups/YYYY-MM-DD-<topic>.html` in the active Phase workspace. The
mockup:

- Is one runnable, self-contained HTML file.
- Embeds required CSS and JavaScript.
- Needs no network assets, dependency installation, build step, or local server.
- Opens directly from disk in a browser.
- Adapts to mobile and desktop viewport widths.
- Shows changed components within a complete page, not isolated fragments.
- Uses semantic HTML, visible keyboard focus, and reduced-motion handling where
  applicable.

The spec identifies the repository-relative mockup path and includes a working
link. The author commits the mockup with the spec as a planning-only companion.
The mockup does not become product code or replace implementation screenshots.

The normal `writing-plans` step consumes the spec and its referenced mockup.
Planning review gates remain unchanged. A missing, unlinked, or
non-self-contained required mockup blocks the plan handoff. The update does not
retroactively invalidate approved specs without mockups. When a mockup exists,
frontend review receives it.

### Planning artifact compatibility

The current spec prompt prohibits all code and commits only one document.
`PlanningPublicationGit.verifyArtifactCommit` also rejects every additional
changed path. Changing skill prose alone cannot satisfy the mockup requirement.

The spec prompt and unattended planning wrapper must permit required
planning-only companions while still prohibiting product implementation.
Frontend activation remains in the skills, not in TypeScript prompts.

The artifact contract adds an optional `companionPaths` list to spec evidence.
The spec declares these paths in a dedicated `## Companion artifacts` section.
Each list entry uses this form:

```markdown
- `docs/mockups/YYYY-MM-DD-topic.html`:
  [Full-page mockup](../mockups/YYYY-MM-DD-topic.html)
```

The artifact reader derives the list from the committed spec, not from issue
comments or an unrestricted agent-supplied allowlist. The link must resolve to
the declared file.

For this feature, permitted companions are regular `.html` files under
`docs/mockups/`. Validation rejects absolute paths, traversal, symlinks,
external URLs, duplicates, missing files, and unrelated changed files. A spec
creation commit changes only its spec and declared companions. Plan creation
retains its single-document restriction.

Companions remain attached to the spec, not a new artifact kind or phase. The
spec's `commitOid` identifies the authoritative tree. Publication lists the
companions in the planning pull request. Resume, reviewed-head adoption, merge
reconciliation, and next-phase base validation verify the spec and its
companions together. Revised specs refresh companion declarations from the
verified tree. No path from an unverified local checkout authorizes a companion.

Old evidence without `companionPaths` remains readable. For a spec with
companion declarations, the workflow derives and verifies them before the next
handoff. Specs without declarations retain their existing behavior. Shared-phase
and implementation-carried specs use the same companion contract.

## Independent frontend review

### Placement and inputs

`inline-dev-with-validation-and-pr-checks` reads
`../patchmill-frontend-review/SKILL.md` for applicable frontend changes. It
first completes task commands, the normal whole-delivery code review, its
ordered fix pass, and final validation. Explicit operator-configured normal
review passes also finish before frontend review.

The parent then dispatches a new, fresh-context canonical `reviewer`. The
reviewer cannot edit files, create children, or inherit implementation context.
A different model or provider is not required. Existing model policy and the
shell-less, read-only tool policy remain binding. The parent supplies requested
command evidence through the existing safe-validation procedure.

The reviewer receives:

- Issue requirements, approved spec, plan, and referenced mockup when present.
- Immutable implementation base and current head.
- Changed frontend files and final materialized content outside that range.
- Relevant repository policy and design-system guidance.
- Available committed screenshots and other visual evidence.
- The local pinned Vercel rule file.

The reviewer inspects code and available visual evidence. Missing optional
evidence does not block this review. Existing required screenshot evidence
remains a handoff requirement. Stale screenshots cannot prove the current UI.
The workflow refreshes affected evidence through the existing visual-evidence
process, not a new capture stage.

### Findings and repair

The reviewer returns `pass` or actionable findings. Each finding includes:

- Severity: Critical, Important, or Minor.
- Specific user impact.
- Concrete code, behavior, or visual evidence.
- `file:line` where applicable, otherwise the visual evidence location.
- A bounded required correction.
- The requirement, design-system rule, mockup intent, or pinned rule it
  violates.

Personal preferences and unrelated pre-existing defects are not findings. The
parent records disputed findings and their reasoned dispositions. It cannot
silently waive a valid requirement to obtain a pass.

Valid frontend findings return to the parent implementation session, which
remains the sole writer. Unlike deferred normal-review Minor recommendations,
valid frontend findings require resolution before frontend review passes.

If a frontend repair changes production code, the parent:

1. Refreshes the review scope and immutable head.
2. Reruns affected validation.
3. Runs independent normal code review for the repair scope.
4. Resolves accepted findings through the existing normal fix process.
5. Reruns required final commands against the final state.
6. Dispatches another fresh frontend reviewer with current evidence.

Other repairs still require affected direct verification and frontend re-review.
The loop ends with `pass` or an evidenced blocker under the existing contract.
All review work must resolve before a ready PR handoff. Frontend changes from a
later PR-check repair invalidate stale frontend approval and use this same
order. Existing PR-check repair limits and failure classifications remain
unchanged.

This is a conditional exception to issue #287's no-automatic-re-review rule.
Non-frontend work retains one normal review and one ordered fix pass. The
generic terminal prompt must prohibit extra reviews beyond the configured
workflow, rather than prohibit this required repair loop. TypeScript does not
dispatch or select frontend reviewers.

The progress ledger records review references, reviewed heads, findings,
dispositions, repairs, and command evidence. The PR summary carries those
records through cleanup. Existing terminal fields, screenshot metadata, landing
policy, and implementation-PR requirements remain unchanged.

## Pinned skills, licenses, and installation

Patchmill vendors immutable source files locally. Installation, updates, and
frontend review do not download guidance at runtime.

| Material                 | Repository                             | Commit                                     | Source files                                                            | License evidence                      |
| ------------------------ | -------------------------------------- | ------------------------------------------ | ----------------------------------------------------------------------- | ------------------------------------- |
| Frontend guidance        | `anthropics/skills`                    | `41bbe19d1a1a7eaab5e7bb9050a417e5c6cffc8f` | `skills/frontend-design/SKILL.md`, `skills/frontend-design/LICENSE.txt` | Apache-2.0, `LICENSE.txt`             |
| Review wrapper reference | `vercel-labs/agent-skills`             | `ba46938889d4e58635362fb8f618e1178ac3ec46` | `skills/web-design-guidelines/SKILL.md`                                 | MIT declaration in pinned `README.md` |
| Review rules             | `vercel-labs/web-interface-guidelines` | `e3d624baaf29dc1fc645aff3e38f03e564d2d6b1` | `command.md`, `LICENSE`                                                 | MIT, `LICENSE`                        |

The September attachment identifies the Vercel wrapper commit as a correction to
the issue body's `ba46938889d48fe25b412aeef77941764aedd976`. Implementation must
verify the corrected source and its license before vendoring. This spec does not
claim that it performed that upstream verification.

Packaged files are:

```text
skills/frontend-design/
  SKILL.md
  LICENSE.txt
skills/patchmill-frontend-review/
  SKILL.md
  LICENSE
  references/upstream-web-design-guidelines.md
  references/web-interface-guidelines.md
```

The Anthropic files and Vercel references remain verbatim. The active
`patchmill-frontend-review/SKILL.md` is Patchmill-owned. It reads only the local
rule file. The renamed upstream wrapper is provenance, not another active skill.
Its `WebFetch` instruction has no runtime authority.

`THIRD_PARTY_NOTICES.md` records repositories, commits, source and installed
paths, license evidence, purpose, and modification status. Applicable licenses
and attribution accompany both packaged and installed skills. Formatting tools
exclude only verbatim upstream Markdown. Patchmill-owned wrappers remain linted.

The recommended pack receives a version newer than `2026.10.1`. Its update
notice explains conditional frontend behavior without a configuration migration.
Existing Superpowers v6.4.2 and SimpleEnglish v1.2.0 sources remain unchanged.
No npm dependency change is required.

### Requirements and provenance

`skill-runtime-requirements.ts` remains the canonical owner of required files.
It adds both new skills, their licenses, and the review references. Planning
requires its frontend-design sibling. Inline implementation requires its
frontend-review sibling. Existing helpers and executable-permission checks
remain intact.

Install, staged-install validation, update preflight, existing-directory
validation, and doctor use these requirements. Missing pinned files block before
mutation or workflow continuation. The workflow cannot fetch a substitute.

Pack entries add upstream provenance records. Each record contains the
repository, commit, original source paths, local target paths, and license
evidence. The installation `source` still selects a local copy root. It does not
identify authorship.

Generated metadata adds a `skills` array with required installed paths and
provenance. Paths respect the selected skill directory. The existing `files`
array remains the SHA-256 integrity record. Older metadata without the new array
remains updateable. Malformed present records fail validation. Provenance
changes participate in up-to-date detection even when file hashes do not change.

Updates retain customized-file and unmanaged-collision safeguards. Regeneration
keeps tracked `.patchmill/skills/` copies, hashes, and provenance aligned with
packaged sources. npm and Nix outputs include all skill, reference, license, and
notice files.

## Affected components

- `skills/patchmill-planning/SKILL.md`: activation, guidance, mockup, and
  handoff.
- `skills/inline-dev-with-validation-and-pr-checks/SKILL.md`: review order,
  parent repairs, re-review, ledger evidence, and PR-check integration.
- New `skills/frontend-design/` and `skills/patchmill-frontend-review/`
  resources.
- `src/workflow/skill-pack.ts` and `skill-runtime-requirements.ts`: pack
  entries, provenance, metadata, and required files.
- Installer, skills update, and doctor: missing-file diagnostics and safe
  updates.
- Run-once prompts: planning companions and compatible finalization wording.
- Planning artifact readers, state validation, Git publication checks, head
  adoption, merge recovery, and base checks: durable companion verification.
- `.patchmill/skills/`, notices, formatting exclusions, npm package checks, and
  `nix/package.nix`: synchronized installed and packaged resources.
- README and site skills/artifact documentation: activation, mockup use, review
  order, repairs, offline pins, precedence, and custom-workflow limits.

## Acceptance and verification

Automated tests cover reusable behavior and safety boundaries:

- Spec prompts permit required planning companions but prohibit product changes.
- Companion parsing rejects unsafe paths and unrelated commit changes.
- Spec-plus-mockup commits survive publication, revisions, resume, merge, and
  fetched-base handoffs without weakening spec-only or plan-only checks.
- Installation copies all required files into default and custom skill paths.
- Missing sidecars or siblings fail preflight without mutation.
- Doctor reports missing frontend guidance, licenses, or pinned references.
- Metadata supports older packs, rejects malformed provenance, and updates for
  provenance-only changes.
- Updates preserve customization and collision safeguards.
- npm and Nix package checks find packaged and initialized skill files.

Direct verification covers static guidance instead of tests that assert prose or
literal upstream commit strings. Implementation compares vendored files with
verified immutable sources and inspects pins, notices, hashes, and installed
paths. Scenario checks cover activation, page-context mockups, override
conflicts, actionable findings, parent repairs, and stale evidence. They also
cover production repairs that require normal review before frontend re-review.

Final implementation verification includes focused tests, `npm test`,
`npm run lint`, `npm pack --dry-run --json --ignore-scripts`, and
`nix build .#patchmill --no-link`. Mockup verification includes direct browser
use at mobile and desktop widths without network access. No new automated test
merely asserts Markdown text, workflow prose, or a dependency version.

This spec-only change requires document formatting, Markdown lint, self-review
against the issue and current sources, and a commit containing only this file.
