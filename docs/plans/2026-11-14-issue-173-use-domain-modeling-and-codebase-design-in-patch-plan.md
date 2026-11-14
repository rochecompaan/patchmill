# Domain-aware planning implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use sibling `executing-plans` to
> implement this plan inline, task by task. Steps use checkbox syntax. Do not
> dispatch implementers or reviewers per task. The implementation wrapper still
> requires its final fresh whole-branch review.

**Goal:** Add domain-aware architectural specification work and fresh,
codebase-backed Plan review to Patchmill's managed planning workflow.

**Architecture:** Extend the existing installation module to copy two selected
upstream skill trees and their licenses. Keep applicability, domain analysis,
and reviewer orchestration in the planning wrapper and its local review prompt.
Reuse the existing reviewer runtime and human gates.

**Tech Stack:** Node.js 24 ESM, TypeScript, Node test runner, npm lockfiles,
Markdown skills, and Nix.

**Spec:**
[Approved specification](../specs/2026-11-13-issue-173-use-domain-modeling-and-codebase-design-in-patch-design.md).

**Other inputs:** Issue #173 and the maintainer's decisions: require a fresh
reviewer and adopt upstream `GLOSSARY.md` naming. There are no frontend mockups.

## Global Constraints

- Use the provided issue branch and worktree. Do not push the base branch,
  force-push, mutate issue labels, or post issue comments.
- Implement through sibling `executing-plans`, under the implementation
  wrapper's review, validation, and publication rules.
- Keep `installSkills({ repoRoot, skillDir, packageRoot })` and its
  `{ written, unchanged }` result unchanged.
- Add only the production dependency `mattpocock-skills` at upstream version
  `1.3.2` and revision `5863806dd4e15c63174bee4e7515a4256792ecfa`.
- Use
  `https://github.com/mattpocock/skills/archive/5863806dd4e15c63174bee4e7515a4256792ecfa.tar.gz`,
  not a moving branch or separate skill downloads.
- Copy complete `skills/engineering/domain-modeling/` and
  `skills/engineering/codebase-design/` trees without modifying upstream bytes.
- Install flat sibling directories `domain-modeling/` and `codebase-design/`,
  with a copy of the upstream root MIT `LICENSE` in each.
- Record `sources.mattPocock` from the actual upstream package version and hash
  every installed resource, including copied licenses.
- Keep dependency metadata, both lockfiles, provenance, installed resources, and
  the regenerated managed pack consistent.
- Use `GLOSSARY.md` and `GLOSSARY-MAP.md`. Preserve all existing terminology
  during Patchmill's rename from `CONTEXT.md`.
- Preserve human Spec and Plan gates. Reviewer readiness never constitutes human
  approval.
- Add no kernel phase, configuration hook, generic provider registry, runtime
  adapter, or runtime download.
- Use behavioral tests for installation and discovery. Use direct scenarios and
  inspection for instructions, filenames, provenance, and version references.
- Rerun the Nix build after dependency changes. Preserve frontend behavior and
  historical planning documents.

## Review Focus

These five risks require deliberate inspection beyond the focused automated
tests:

1. An explicitly narrow envelope must defer domain-document edits without losing
   the resolved definition or bypassing a human gate. Task 2 scenarios verify
   this.
2. A plausible plan summary must not replace the reviewer's independent source
   and test inspection. Task 2's review scenarios verify this.
3. A glossary rename must preserve every prior term and prevent competing
   terminology files. Task 2's rename comparison verifies this.
4. Skill availability must survive package-local npm/Nix resolution, not rely on
   this developer checkout. Task 3's clean-install probes verify this.
5. Missing reviewer capability must not silently fall back to planner
   self-review, including local interactive planning. Task 2's prerequisite
   scenarios verify this.

The Testing Value Gate excludes prose-string and version-literal tests for these
policy risks. The owning tasks specify direct evidence instead.

## Architecture and file ownership

The inspected implementation branch starts at
`1b3c25914aa0d0f32ed566fb6159879f349ffdf8`. It contains the approved
specification above the application base `d4a9ba4`. The inspected installer is
145 lines. A private file-copy helper can support licenses without a new module
or public seam.

| Owner                     | Files and responsibility                                                                                                                                         |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Installation module       | `src/cli/commands/init/skill-installer.ts`: package-local resolution, nested upstream paths, recursive resources, writable copies, counts, and manifest.         |
| Installation verification | `src/cli/commands/init/skill-installer.test.ts`, `src/cli/commands/skills/main.test.ts`: observable installation and guarded-update behavior.                    |
| Upgrade validation        | `scripts/update-superpowers.mjs`, `scripts/update-superpowers.test.mjs`: full-pack synchronization and isolated upgrade fixtures.                                |
| Discovery verification    | `src/console/skills.test.ts`: actual installed skills under a non-default configured pack directory.                                                             |
| Dependency distribution   | `package.json`, both lockfiles, `nix/package.nix`, `THIRD_PARTY_NOTICES.md`, `scripts/smoke-packed-artifact.mjs`: pinned dependency and installed-package proof. |
| Planning module           | `skills/patchmill-planning/SKILL.md`, new `skills/patchmill-planning/plan-review.md`: applicability, domain analysis, reviewer brief, rubric, and disposition.   |
| Interactive helper        | `skills/patchmill-plan/SKILL.md`: reuse planning analysis and fresh review without gaining publication authority.                                                |
| Domain language           | Rename `CONTEXT.md` to `GLOSSARY.md`. Update `docs/agents/domain.md` and add the resolved Plan review term.                                                      |
| User guidance             | `site/src/content/docs/guides/skills-configuration.md`, `site/src/content/docs/using-patchmill/interactive-skills.md`.                                           |
| Managed output            | Relevant `.patchmill/skills/` resources and `patchmill-skill-pack.json`, generated by the existing update command.                                               |
| Delivery evidence         | New `docs/verification/issue-173-domain-aware-planning.md`: scenario inputs, observed outcomes, packaging checks, and limitations.                               |

The interface is the test surface: callers and tests use `installSkills`, the
update command, and the existing resource loader. The private copier hides
layout and filesystem details. It does not need an injected provider interface.
Deleting this module redistributes copying, repair, permissions, and hashing
across its callers, so it earns its depth.

Filesystem tests use temporary directories, an existing local-substitutable
dependency. The reviewer is an existing runtime seam, not a new transport to
abstract. One new source layout does not justify a hypothetical provider
adapter. Locality keeps planning policy and its review prompt together. Leverage
gives both planning modes the same requirements.

## Implementation preparation

Only the implementation session performs these steps. This planning session does
not install dependencies or change product files.

- [ ] Read the specification and implementation wrapper, then initialize this
      plan's inline-execution ledger.
- [ ] Run `npm ci` and the baseline `npm test`. Record actual failures before
      editing.
- [ ] Audit `.patchmill/skills/patchmill-skill-pack.json` against installed file
      hashes before regeneration.

Planning inspection found no managed hash mismatches and no differences between
shipped Patchmill skills and their tracked copies. The existing manifest records
Patchmill `0.20.0`, while this checkout declares `1.0.0`. Normal regeneration
must update that metadata. Do not hand-edit hashes or bypass the updater's
local-edit refusal. If the implementation session finds new mismatches,
investigate before overwriting anything.

### Task 1: Install and distribute the pinned design skills

**Files:**

- Modify: `src/cli/commands/init/skill-installer.ts`.
- Modify tests: `src/cli/commands/init/skill-installer.test.ts`,
  `src/cli/commands/skills/main.test.ts`, `src/console/skills.test.ts`,
  `scripts/update-superpowers.test.mjs`.
- Modify: `scripts/update-superpowers.mjs`.
- Modify: `package.json`, `package-lock.json`, `npm-shrinkwrap.json`,
  `nix/package.nix`, `THIRD_PARTY_NOTICES.md`,
  `scripts/smoke-packed-artifact.mjs`.
- Generate: `.patchmill/skills/domain-modeling/**`,
  `.patchmill/skills/codebase-design/**`,
  `.patchmill/skills/patchmill-skill-pack.json`.

**Interfaces:**

- Consumes: the exact dependency archive from Global Constraints, the upstream
  package manifest, and `skills/engineering/<name>` source directories.
- Preserves:
  `installSkills(options): Promise<{ written: number; unchanged: number }>` and
  the existing update command interface.
- Produces: exported
  `MATT_POCOCK_SKILLS = ["domain-modeling", "codebase-design"]`, installed flat
  sibling trees, licenses, hashes, and
  `SkillPackManifest.sources.mattPocock: string`.
- Task 2 consumes these installed sibling paths. Task 3 consumes the packaged
  dependency and real installed-pack checks.

- [ ] **Step 1: Extend behavior tests before changing installer behavior.**

Extend the existing complete-real-pack test to traverse both actual upstream
trees and compare every installed byte. Compare each installed `LICENSE` with
the upstream root license. Include those license paths in the expected file set
and hash calculations. Compare `sources.mattPocock` with the resolved package's
manifest, not a standalone version literal. Preserve the existing full-pack
idempotence and mtime assertions.

Add these named cases or equivalent assertions in the existing behavioral tests:

| Case                                                             | Required observable assertions                                                                                                                                                                                            |
| ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `repairs a damaged upstream resource and a deleted license`      | Damage `codebase-design/DEEPENING.md` and delete `domain-modeling/LICENSE`. Reinstallation restores exact source bytes and valid hashes while preserving an unrelated user file.                                          |
| `resolves nested design resources from the supplied package`     | Include the new dependency in the isolated package fixture. Alter its resource bytes and manifest version locally. Installation uses that fixture, preserves read-only source modes, and makes copied resources writable. |
| `rejects an absent package-local design dependency`              | Omit the new dependency from an isolated package fixture. Installation rejects rather than resolve a package through the caller's working directory.                                                                      |
| `upgrades a prior manifest to include both design skills`        | Construct a valid prior pack without the two trees, their manifest entries, or `sources.mattPocock`. `skills update` installs both trees and complete resources. Existing obsolete-file cleanup still passes.             |
| `protects customized design resources during update`             | Edit `codebase-design/DEEPENING.md` and remove `domain-modeling/LICENSE`. Update refuses, lists both paths, and preserves the edit and manifest.                                                                          |
| `discovers installed design siblings from configured pack paths` | Install the real pack into `custom/pack`. Configure both entry points there. The existing loader and provisioned implementation worker resolve both named skills without missing resources.                               |

Keep the existing synthetic discovery test for its original contract. Use the
real installation test to prove the added integration rather than assert a
static configuration list.

Extend `scripts/update-superpowers.test.mjs` fixtures with the package-local
Matt Pocock dependency, nested source trees, and upstream root license. They
copy the real installer, so all upgrade and rollback cases need this fourth
source before fixture installation. Extend the existing validate-only behavior
case to accept the complete pack, then reject corrupted design resources,
missing copied licenses, and omitted manifest entries. Preserve the existing
no-update, upgrade, and rollback cases. These tests call
`runSuperpowersUpgrade(args, dependencies)` with isolated fixtures and mock
release data, not the live upgrade command.

- [ ] **Step 2: Add the production dependency and regenerate both lockfiles.**

Set the exact dependency from Global Constraints. Follow `updatePackageMetadata`
in `scripts/update-pi-subagents.mjs` for the two-lockfile procedure.
`npm install --package-lock-only --ignore-scripts` updates shrinkwrap first.
Save that output, temporarily remove shrinkwrap, regenerate package-lock, then
restore the updated shrinkwrap. Preserve originals for recovery if the command
fails. Use existing `repairMissingLockfileIntegrities` for missing non-git
archive integrity, without changing its implementation. Run `npm ci` after both
lockfiles agree.

Expected: the installed dependency declares `1.3.2`, both lockfiles identify the
exact archive, and their archive integrity agrees. No unrelated dependency
upgrade belongs in this task.

- [ ] **Step 3: Run the focused tests and observe the missing installation
      behavior.**

```bash
node --test src/cli/commands/init/skill-installer.test.ts \
  src/cli/commands/skills/main.test.ts src/console/skills.test.ts \
  scripts/update-superpowers.test.mjs
```

Expected: the new resource, metadata, or discovery assertions fail before the
installer change. A dependency-download failure is a prerequisite failure, not
the required behavioral RED result.

- [ ] **Step 4: Extend the installation module without enlarging its
      interface.**

Resolve `mattpocock-skills/package.json` through the existing `createRequire`
anchored at `packageRoot`. Add the two selected names and their
`skills/engineering` source prefix. Keep the flat destination names unchanged.
Use a private `copyFile(source: string, relative: string): Promise<void>` inside
`installSkills` for shared copy mechanics. Let directory recursion and
root-license copies use that same path for hashing, permissions, counts, and
unchanged-file handling. Do not export the helper or introduce another module.
Record the actual dependency version in `sources.mattPocock`.

Extend private `assertSynchronizedRepository` in
`scripts/update-superpowers.mjs` to validate the same fourth source. Resolve its
package locally, traverse `skills/engineering/<name>`, include both root-license
copies in the expected file set, and compare the actual source version with
`metadata.sources.mattPocock`. Preserve strict duplicate, omitted, stray-file,
hash, and installed-byte checks. No new provider registry or installer export is
necessary.

- [ ] **Step 5: Extend the existing packed-artifact smoke probe.**

After the smoke script installs the packed application and invokes its `init`,
inspect the resulting design skill trees. Resolve upstream resources from that
installed application's package root, not this checkout. Compare complete
selected trees, both copied licenses, manifest paths and hashes, and the
recorded source version. Keep the script's existing disposable project, isolated
home, and cleanup behavior. Do not add a new one-off script or tests that
inspect the smoke script's structure.

- [ ] **Step 6: Run the focused suite to GREEN.**

Run the command from Step 3 again. Expected: all installer, updater, discovery,
repair, permissions, and idempotence cases pass.

- [ ] **Step 7: Record provenance and regenerate the tracked pack.**

Add the repository, version, immutable revision, source paths, flat installed
paths, and MIT license to `THIRD_PARTY_NOTICES.md`. Preserve upstream bytes,
including `ADR-FORMAT.md`, `GLOSSARY-FORMAT.md`, `DEEPENING.md`,
`DESIGN-IT-TWICE.md`, and other selected-directory resources.

```bash
node bin/patchmill.ts skills update
```

Expected: both trees and copied licenses appear in the tracked pack, with
`sources.mattPocock` and complete file hashes. A second update reports an
unchanged pack.

- [ ] **Step 8: Verify packaged distribution and update the Nix dependency
      hash.**

```bash
node scripts/smoke-packed-artifact.mjs
bash scripts/update-npm-deps-hash.sh
```

Expected: the clean npm installation passes the extended smoke probe. The hash
updater finishes a successful Nix build with the new dependency. A hash-mismatch
diagnostic alone is not success. Record environmental failures without changing
unrelated packages or pretending that a build passed.

- [ ] **Step 9: Commit this installation deliverable.**

Stage the files listed for this task, including generated resources and the
observed Nix hash. Use
`feat: install pinned domain modeling and codebase design skills` as the commit
message. Expected: installation behavior and packaged resource checks remain
green.

### Task 2: Apply domain-aware planning, fresh review, and glossary naming

**Files:**

- Modify: `skills/patchmill-planning/SKILL.md`,
  `skills/patchmill-plan/SKILL.md`.
- Create: `skills/patchmill-planning/plan-review.md`.
- Rename: `CONTEXT.md` to `GLOSSARY.md`.
- Modify: `docs/agents/domain.md`,
  `site/src/content/docs/guides/skills-configuration.md`,
  `site/src/content/docs/using-patchmill/interactive-skills.md`.
- Create: `docs/verification/issue-173-domain-aware-planning.md`.
- Regenerate: managed copies of the changed planning skills, their review
  prompt, and `.patchmill/skills/patchmill-skill-pack.json`.

**Interfaces:**

- Consumes: Task 1's installed `domain-modeling` and `codebase-design` siblings,
  the existing planning envelope, and the canonical `reviewer` runtime.
- Produces: an unchanged planning entry-point/result interface with conditional
  design analysis and mandatory fresh Plan review.
- Produces: a canonical glossary, updated user guidance, and directly observed
  workflow evidence for Task 3's final delivery check.

This task changes instructions and domain documentation, not executable workflow
behavior. The Testing Value Gate requires direct scenarios, source comparison,
and lint instead of prose-assertion tests.

- [ ] **Step 1: Update specification-time analysis in the planning wrapper.**

Require `../domain-modeling/SKILL.md` for architectural specification work.
Require `../codebase-design/SKILL.md` and `../codebase-design/DEEPENING.md` for
module, interface, seam, or adapter design. Determine applicability from
behavior, including documentation that defines architecture. Record a brief
non-applicability reason for work that changes no architecture.

Include active term clarification, concrete scenarios, code cross-checks,
affected contexts, glossary maps, and relevant ADRs. Require the specification's
ownership, caller obligations, hidden implementation, seam, adapter, dependency,
locality, leverage, and observable-test analysis. Use the seven architecture
terms from the approved specification consistently. Keep `DESIGN-IT-TWICE.md`
available but do not mandate its optional agent fanout.

- [ ] **Step 2: Reconcile companion documents and stage boundaries in both
      wrappers.**

Permit justified glossary, context-relationship, and ADR updates with ordinary
specifications. Require repository paths and relative links in one top-level
`## Companion artifacts` section. Preserve the prohibition on premature
implementation plans or product implementation. If an envelope is narrower,
record the resolved definition, deferred destination, reason, and next
authorized stage in the specification. Do not claim that a deferred canonical
update already occurred.

The local interactive helper inherits analysis and Plan review, not kernel
publication steps. It still does not install dependencies, publish artifacts,
change labels, or grant human approval.

- [ ] **Step 3: Add the local reviewer brief and orchestration requirements.**

Put the complete review rubric in `plan-review.md`, beside its owning wrapper.
The wrapper invokes a fresh-context canonical `reviewer` after Superpowers
self-review of every new or revised plan. Apply this rule to spec/plan gate
configurations and implementation-stage planning that writes an ungated plan. Do
not create a plan merely to review it during spec-only work. Remove the existing
blanket no-subagent instructions only where they contradict mandatory Plan
review. Keep inline execution as the kernel implementation default.

The brief requires exact repository/worktree, issue, specification, plan,
inspected base, project instructions, and sibling guidance paths. Candidate
source locations are hints, never the architecture authority. The reviewer
independently reads domain documents, ADRs, source, callers, dependency entry
points, files that change together, and tests. The report contains the resulting
architecture survey, findings, inspection limits, and readiness conclusion.

Include every review criterion from the specification and all three explicit
principles:

- Deletion test: valuable depth redistributes complexity to callers after
  deletion.
- The interface is the test surface, with observable outcomes rather than
  internal-state coupling.
- One adapter is hypothetical. Two actual adapters establish real variation.

Use `DEEPENING.md` dependency categories and replace redundant shallow tests
rather than layer them without purpose. Require concrete source evidence,
impact, violated requirement, and smallest correction for blockers. No source
edits, dependency installation, publishing, host mutation, or nested agents
belong to the reviewer. It applies upstream guidance as read-only analysis, not
as permission to execute optional workflows.

Require explicit model/thinking settings using available deployment policy, not
a hard-coded provider. Allow one initial review and one fresh scoped
confirmation after accepted blocking corrections. Record findings, dispositions,
counter-evidence for rejections, and the reviewed revision or content identity
in the plan. A content hash can exclude its own review receipt to avoid
self-reference. Receipt-only edits do not invalidate review. Later material task
or architecture edits do. Unresolved blockers cannot reach successful submission
or human approval. Missing skills, resources, reviewer capability, or tool
support stop success. Unattended planning returns the missing prerequisite in
`needs-input`. Interactive planning asks and waits. Do not silently install
dependencies or substitute planner self-review.

- [ ] **Step 4: Migrate the canonical glossary and live guidance.**

```bash
git mv CONTEXT.md GLOSSARY.md
```

Preserve every existing term, definition, and rejected synonym. Add **Plan
review** with the definition and rejected synonyms from the approved
specification. Update `docs/agents/domain.md` to describe `GLOSSARY.md`,
relevant ADRs, and optional `GLOSSARY-MAP.md` for multiple contexts. Patchmill
remains single-context. Do not create a glossary map or ceremonial ADR. Read
legacy `CONTEXT` documents in target repositories until a rename is authorized,
and surface conflicting instructions. Do not create competing terminology files
or rewrite historical plans, specifications, and changelog records.

Update the two user-guide pages with conditional skill use, added resources,
canonical names, prerequisite handling, and fresh Plan review. Correct the
touched obsolete planning-PR description to match current staged and interactive
gate behavior. Keep local helper non-publication rules distinct from Interactive
Issue run submission.

- [ ] **Step 5: Regenerate the changed managed skills.**

```bash
node bin/patchmill.ts skills update
node bin/patchmill.ts skills update
```

Expected: the first command copies the new review prompt and wrapper changes,
with fresh hashes. The second reports an unchanged pack. No upstream skill bytes
change.

- [ ] **Step 6: Exercise and record the direct policy scenarios.**

Use temporary repositories and bounded, no-publication planning/reviewer
sessions. Never run a real Issue run against this repository to test a policy
branch. Keep credentials, comments, labels, real remote pushes, and product
implementation outside scenario authority.

Require actual fresh model sessions for these minimum cases:

1. An architectural specification consumes both installed skills and cites
   relevant code.
2. A resolved term under a narrower envelope remains in the specification, with
   its domain-document update explicitly deferred.
3. A fresh reviewer detects a deliberately shallow or unjustified design through
   independent source and test inspection.
4. Unattended planning without reviewer capability returns `needs-input`.
5. Local interactive planning without reviewer capability asks for guidance and
   does not complete successfully.

Supply exact scratch artifact paths, installed wrapper paths, stage facts, and
explicit no-publication overrides in each scenario envelope. Use isolated
session/tool configuration for absent-reviewer cases. Do not disable this
repository's real reviewer or alter shared agent settings. Observe interactive
questions inside the disposable scenario, not through a real maintainer approval
dialog. These are policy exercises, not per-task implementation review gates.

Walkthroughs can cover the remaining static cases in the matrix. Record each
scenario's inputs, instruction paths, actual artifact or reviewer outcome, and
limitations in the verification document. Label walkthroughs and unexecuted
cases explicitly. If a minimum model session cannot run, report the unmet
prerequisite rather than substitute a walkthrough and claim successful
verification.

| Scenario                                                          | Expected observation                                                                                                            |
| ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Architectural spec with one glossary and relevant source          | Both skills guide the design. Ownership, caller obligations, hidden implementation, dependencies, and test surfaces cite code.  |
| Multiple contexts with a glossary map                             | Only relevant context glossaries and ADRs enter the analysis, with their relationships explicit.                                |
| Term/ADR conflict, then a resolved term                           | The conflict remains visible until resolved. Ordinary spec work updates and links its justified companion.                      |
| Same resolution under a spec-only envelope                        | Only the specification changes. It records the resolution and exact deferred destination.                                       |
| Non-architectural correction                                      | A short applicability decision appears without new glossary, map, ADR, or invented module design.                               |
| Plausible plan with a shallow pass-through or unjustified adapter | A fresh reviewer inspects the code and returns concrete architectural evidence, impact, and a blocking correction.              |
| Sound plan and corrected blocker                                  | The report cites actual source/tests. Any required fresh confirmation assesses corrections, not unrelated preferences.          |
| Missing skill/resource/reviewer                                   | No successful completion or self-review fallback occurs. Interactive and unattended channels handle the prerequisite correctly. |
| Spec-only versus every plan-writing path                          | Spec-only work writes no plan. New/revised plans receive fresh review, including ungated and local interactive paths.           |
| Human gates and publication                                       | Reviewer readiness does not approve a gate. The local helper stays unpublished. Interactive Issue runs use their submit dialog. |
| Former glossary filenames                                         | Prior knowledge remains an input. Conflicting naming instructions stop unauthorized renames and duplicate glossaries.           |

For the glossary migration, compare `git diff --find-renames` with the pre-task
`CONTEXT.md` and inspect every prior term. Use a direct live-reference search
outside historical documents to find stale instructions. Expected: only the
added Plan review concept changes glossary content, and no live guidance directs
creation of a new `CONTEXT.md`.

- [ ] **Step 7: Verify and commit the policy deliverable.**

```bash
npm run lint:md
npm run format:check
node --test src/cli/commands/init/skill-installer.test.ts \
  src/cli/commands/skills/main.test.ts src/console/skills.test.ts
```

Expected: Markdown, formatting, resource installation, and discovery pass. The
verification document distinguishes observed outcomes from unexecuted scenarios.
Commit the listed source, glossary, documentation, evidence, and regenerated
pack files with `feat: require domain-aware planning and fresh plan review`.

### Task 3: Verify the delivered workflow and packaged dependency

**Files:**

- Update: `docs/verification/issue-173-domain-aware-planning.md` with final
  results.
- Modify other files only to repair a demonstrated, in-scope failure under the
  implementation wrapper's review rules.

**Interfaces:**

- Consumes: Tasks 1–2's real installed resources, smoke probe, source
  instructions, and scenario evidence.
- Produces: recorded proof that source, tracked pack, npm installation, Nix
  installation, and both managed planning modes agree.

- [ ] **Step 1: Run the final repository and runtime suites.**

```bash
npm test
npm run lint
npm run build
node --test src/cli/commands/run-once/main.test.ts \
  src/cli/commands/init/agent-dir.test.ts src/kernel/pi-supervisor.test.ts \
  src/kernel/interactive-planning.test.ts src/console/worker-launcher.test.ts \
  src/console/skills.test.ts
```

Expected: complete suites and build pass on the final state. The targeted
runtime tests reuse existing extension, agent-provisioning, and interactive
contracts. Do not add kernel changes or static prompt assertions to make
architecture review deterministic.

- [ ] **Step 2: Verify the final npm artifact from a clean installation.**

```bash
npm pack --dry-run --json
node scripts/smoke-packed-artifact.mjs
```

Expected: the package includes the planning wrapper, review prompt, provenance,
and shrinkwrap. The clean install resolves the pinned dependency and installs
both complete upstream trees and licenses through `init`. The upstream
dependency is installed through npm. It need not appear as bundled files in the
application tarball.

- [ ] **Step 3: Rebuild and inspect the final Nix installation.**

```bash
nix build --print-build-logs .#patchmill
```

Expected: Nix's test and install checks pass with the recorded dependency hash.
From a temporary destination, call the built installation module at
`result/share/patchmill/src/cli/commands/init/skill-installer.ts`. Supply
`packageRoot` resolved from `result/share/patchmill`, not the checkout. Use the
same `installSkills({ repoRoot, skillDir, packageRoot })` interface as the
behavioral tests. Compare both installed trees, licenses, hashes, and source
version against that package's resolved upstream dependency. Record the real
store/package paths as evidence of package-local resolution.

- [ ] **Step 4: Audit final consistency and record evidence.**

Compare the root dependency reference, both lockfiles, installed upstream
manifest, third-party notices, tracked manifest, and installed skill paths.
Verify every tracked managed-file hash and confirm repeated `skills update`
changes nothing. Record scenario results, package paths, all commands, failures,
and limitations in the verification document. If a required model session or
build cannot run, report that prerequisite instead of inventing successful
evidence.

- [ ] **Step 5: Commit the verification record.**

Run `git diff --check` and the changed-document formatting and Markdown checks.
Expected: only intended implementation and evidence changes remain. Commit the
evidence with `docs: record domain-aware planning verification`.

## Final implementation handoff

Follow the implementation wrapper's final fresh whole-branch review after all
tasks, not a per-task review workflow. Supply the approved specification, this
plan, Review Focus verbatim, validation evidence, and execution-ledger rulings.
Resolve accepted findings through the prescribed fix pass and rerun affected
checks. Keep Plan review of this document distinct from that later
implementation review.

The implementation wrapper owns the eventual implementation PR, its check
handling, readiness, and closing reference. This planning session opens no PR
and implements no task. The existing approved specification remains unchanged.

## Plan review

Two fresh, read-only canonical `reviewer` sessions reviewed this plan with
`openai-codex/gpt-6.1-sol` and high thinking: one initial review and one scoped
confirmation.

- **Source/specification revision:** `1b3c25914aa0d0f32ed566fb6159879f349ffdf8`.
- **Reviewed plan body SHA-256:**
  `9f20f1888baab372e8eea49fdbe0acea972bda40a9f05e22ff608557ed2ee51a`.
- **Identity scope:** All bytes before this `## Plan review` heading. The
  receipt does not enter its own hash.
- **Guidance:** The exact-pinned upstream references informed review without
  installing dependencies in this planning worktree.

The reviewer independently inspected installation, guarded update, discovery,
agent provisioning, runtime launch, npm smoke, and Nix packaging sources and
tests. The review applied the deletion test, interface test surface, actual
adapter variation, locality, leverage, dependency entry, and domain ownership.

| Finding                                       | Evidence and disposition                                                                                                                                                                                                                                                   |
| --------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| B1: Missing full-pack upgrade integration     | Accepted. `scripts/update-superpowers.mjs` validates an exact complete pack. Its tests copy the real installer into isolated fixtures. Task 1 now covers fourth-source validation, nested resources, licenses, fixtures, rejection cases, and focused RED/GREEN execution. |
| S1: Unclear minimum executed policy scenarios | Accepted. Task 2 now requires five actual fresh model-session cases. Static walkthroughs cannot replace these cases. Missing execution prerequisites remain explicit.                                                                                                      |

The fresh scoped confirmation found both corrections complete and no remaining
blocker or substantive builder question. No product behavior, dependency
installation, test suite, model scenario, or build ran during this planning
review. The later implementation session must provide that evidence.

Only this receipt changed after confirmation. Human approval remains separate
from reviewer readiness.
