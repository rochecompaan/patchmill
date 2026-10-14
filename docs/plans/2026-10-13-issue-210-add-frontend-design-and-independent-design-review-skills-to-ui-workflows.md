# Frontend Design and Independent Review Implementation Plan

> **For agentic workers:** Use Native execution through
> `.patchmill/skills/inline-dev-with-validation-and-pr-checks`. **REQUIRED
> SUB-SKILL:** Use its sibling `.patchmill/skills/executing-plans/SKILL.md`. The
> implementation session is the sole writer. Do not dispatch task implementers.
> Steps use checkbox syntax. Existing planning review gates remain binding.

**Goal:** Add conditional frontend design, committed planning mockups, and an
independent frontend review without replacing the current workflows.

**Architecture:** Keep frontend process rules in the planning and inline
implementation wrappers. Extend the existing artifact evidence and Git proofs so
a spec carries verified HTML companions through every handoff. Install pinned
sibling skills and record their provenance in managed-pack metadata.

**Tech Stack:** TypeScript, Node.js 24, `node:test`, Git committed-tree proofs,
Markdown Agent Skills, npm, and Nix.

**Spec:**
`docs/specs/2026-10-10-issue-210-add-frontend-design-and-independent-design-review-skills-to-ui-workflows-design.md`

## Global Constraints

- Preserve
  `brainstorming → writing-plans → implementation → normal code review`.
- Augment only `patchmill-planning` and
  `inline-dev-with-validation-and-pr-checks`. Do not restore retired wrappers.
- Do not add configuration keys, resource profiles, execution methods, artifact
  kinds, top-level phases, or terminal JSON fields.
- Keep the implementation PR requirement, review model policy, shell-less
  reviewer policy, validation, visual evidence, and PR-check repair limits.
- Keep custom and global entrypoints unchanged. They receive frontend behavior
  only through wrappers that adopt this contract.
- Use `skill-runtime-requirements.ts` as the canonical required-file owner.
- Use pack version `2026.10.2`, newer than the current `2026.10.1`.
- Preserve the live Superpowers v7.0.0 and SimpleEnglish v1.2.0 sources. Commit
  `11843c65` already upgraded Superpowers. The spec's v6.4.2 reference is stale.
  Its no-upgrade requirement does not require a downgrade.
- Do not change npm dependencies, lock files, or `patchmill.config.json`.
- Issue #210 changes workflow resources, not browser-visible product UI. This
  implementation needs no product mockup or screenshot of its own.
- Future mockups use `docs/mockups/YYYY-MM-DD-<topic>.html`.
- Product requirements, repository policy, the design system, the written spec,
  and mockup intent take precedence over generic guidance, in that order.
- Do not follow instructions from issue comments to authorize companions. Derive
  companion paths only from the spec at a verified immutable commit.

### Immutable upstream material

| Repository                             | Commit                                     | Source files                                                            | Packaged target                                                                                                       | License evidence                      |
| -------------------------------------- | ------------------------------------------ | ----------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- | ------------------------------------- |
| `anthropics/skills`                    | `41bbe19d1a1a7eaab5e7bb9050a417e5c6cffc8f` | `skills/frontend-design/SKILL.md`, `skills/frontend-design/LICENSE.txt` | `skills/frontend-design/`                                                                                             | Apache-2.0, `LICENSE.txt`             |
| `vercel-labs/agent-skills`             | `ba46938889d4e58635362fb8f618e1178ac3ec46` | `skills/web-design-guidelines/SKILL.md`                                 | `skills/patchmill-frontend-review/references/upstream-web-design-guidelines.md`                                       | MIT declaration in pinned `README.md` |
| `vercel-labs/web-interface-guidelines` | `e3d624baaf29dc1fc645aff3e38f03e564d2d6b1` | `command.md`, `LICENSE`                                                 | `skills/patchmill-frontend-review/references/web-interface-guidelines.md`, `skills/patchmill-frontend-review/LICENSE` | MIT, `LICENSE`                        |

Verify the corrected Vercel wrapper commit and license before vendoring. Keep
these five source files verbatim. The renamed wrapper is provenance only. The
active Patchmill review skill must never fetch mutable rules.

## Review Focus

1. A spec contains a declaration example inside code or raw HTML. It must not
   authorize files. Task 1 covers hidden headings, malformed entries, and links.
2. A committed mockup is replaced by a symlink or exists only locally. Neither
   case can satisfy publication or handoff. Task 2 covers immutable-tree proofs.
3. A reviewed spec changes its mockup before adoption or merge. Saved evidence
   must refresh without trusting stale paths. Tasks 2 and 3 cover these
   revisions.
4. A staged copy omits a license or sibling despite valid source files. No
   partial pack can become installed. Task 5 covers staged validation and safe
   preflight.
5. A frontend repair or PR-check fix changes the reviewed UI. Old review
   approval and screenshots are stale. Task 6 covers this condition with
   scenario evidence.

## Testing and Execution Policy

Automated tests cover parsing, state compatibility, Git authorization, install
safety, metadata validation, update decisions, and executable prompt contracts.
These behaviors are reusable and can fail through meaningful regressions. All
four Testing Value Gate questions have a positive answer for these tests.

Do not add tests for Markdown prose, literal upstream commits, static
configuration, or one-off verification scripts. Use immutable-source
comparisons, formatting, Markdown lint, browser/scenario evidence, npm dry-runs,
and Nix builds. Extend the existing package-content test because missing runtime
files break installation. Do not add notice-text assertions.

Run focused commands from the active Phase workspace. Prefix Git tests with
`GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_NOSYSTEM=1` to exclude personal Git
policy. Use existing dependency setup when required. Do not rewrite lock files.

Before implementation, record the immutable base:

```bash
git rev-parse HEAD
```

Store that full OID as `IMPLEMENTATION_BASE` in the progress ledger. Use the
installed `sdd-workspace`, `task-start`, `task-done`, and `review-package`
helpers through the inline wrapper. Keep task commands and evidence in the
ledger. The tasks run in order. This document authorizes planning only until the
existing workflow permits implementation.

## File Structure

- `src/workflow/planning-companion-artifacts.ts`: pure declaration parsing,
  companion-path validation, and evidence-path rendering.
- `src/git/planning-companion-artifacts.ts`: committed-blob reads and
  regular-file proofs shared by publication and head adoption.
- Existing planning state, publication, adoption, and handoff modules: consume
  this contract rather than implement separate companion parsers.
- `src/cli/commands/run-once/planning-companion-evidence.ts`: refresh old
  evidence from its authoritative tree before a lifecycle handoff.
- `src/workflow/skill-runtime-requirements.ts`: frontend files and sibling
  requirements, including existing executable checks.
- `src/workflow/skill-pack.ts`: pack entries, provenance types, and installed
  metadata. No second required-file registry.
- `src/cli/commands/skills/metadata-validation.ts`: managed metadata validation
  extracted from the growing update module.
- New source skills: pinned guidance and references plus one Patchmill-owned
  review wrapper.
- Existing planning/inline skills and prompts: conditional workflow composition.
- Installed `.patchmill/skills/`, npm/Nix checks, notices, and user
  documentation: synchronized packaging and operating contract.

These new modules separate parsing, Git effects, and metadata validation. Do not
restructure unrelated orchestration or the legacy artifact-comment format.

---

### Task 1: Define the companion declaration and state contract

**Files:**

- Create: `src/workflow/planning-companion-artifacts.ts`
- Create: `src/workflow/planning-companion-artifacts.test.ts`
- Modify: `src/workflow/planning-state-types.ts`
- Modify: `src/workflow/planning-state-validation.ts`
- Test: `src/workflow/planning-state.test.ts`
- Reuse: `src/workflow/planning-markdown-top-level-lines.ts`

**Interfaces:**

- Add `companionPaths?: readonly string[]` to `PlanningArtifactEvidence`. Only
  spec evidence can contain this field.
- Export `isPlanningCompanionPath(value: unknown): value is string`.
- Export
  `parsePlanningCompanionPaths(input: { specPath: string; body: string }): readonly string[]`.
- Export
  `planningArtifactPaths(artifacts: readonly PlanningArtifactEvidence[]): readonly string[]`.
  This helper renders verified evidence. It does not authorize paths.
- Export `PlanningCompanionArtifactError` with a stable `reason` and optional
  offending path. Later tasks translate this error at existing boundaries.

- [ ] **Step 1: Add failing parser and state tests.**

Use the spec's exact declaration shape:

```typescript
const specPath = "docs/specs/example.md";
const mockupPath = "docs/mockups/2026-10-13-example.html";
const body = `# Example

## Companion artifacts

- \`${mockupPath}\`:
  [Full-page mockup](../mockups/2026-10-13-example.html)
`;
assert.deepEqual(parsePlanningCompanionPaths({ specPath, body }), [mockupPath]);
```

Add named behavior cases with these assertions:

| Test                                               | Assertions                                                                                                                                       |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `parses wrapped declarations and CRLF`             | The result matches the declared ordered paths. Same-line entries also work.                                                                      |
| `ignores fenced and raw HTML declaration examples` | Examples alone return `[]`. A real section after an example still parses.                                                                        |
| `rejects malformed or repeated companion sections` | Invalid entries and multiple real sections throw typed errors, not `[]`.                                                                         |
| `rejects unsafe declared paths`                    | Absolute paths, drive paths, backslashes, traversal, empty segments, control characters, non-HTML files, and paths outside `docs/mockups/` fail. |
| `requires a matching local link`                   | Missing links, external/protocol-relative URLs, ambiguous encoded paths, query/fragment suffixes, and mismatched destinations fail.              |
| `rejects duplicate declarations`                   | Repeated declared paths fail.                                                                                                                    |
| `keeps old planning evidence readable`             | Old records without `companionPaths` parse unchanged.                                                                                            |
| `validates present companion evidence`             | A valid spec array round-trips. Non-arrays, invalid paths, duplicates, and any plan companion field fail with a field path.                      |
| `renders artifact and companion paths`             | The result includes each verified artifact and companion once. It does not mutate input arrays.                                                  |

- [ ] **Step 2: Run the focused tests and record the expected RED result.**

```bash
node --test src/workflow/planning-companion-artifacts.test.ts src/workflow/planning-state.test.ts
```

Expected: the new behavior fails because the parser and optional state field do
not exist. Correct fixture errors before implementation.

- [ ] **Step 3: Implement the pure contract.**

Read only the dedicated top-level `## Companion artifacts` section. Reuse
`markdownTopLevelLines` to exclude fenced code and raw HTML. Do not treat
indented code or blockquote headings as declaration sections. Accept the
documented entry shape with normal line wrapping. Resolve each local link
against the spec directory with POSIX path semantics. Allow the example's
`../mockups/` link only when its normalized destination equals the canonical
declared path. Never normalize an unsafe declared path into an allowed one. Stop
the section at the next top-level heading.

Use `objectWithOptionalKeys` in state validation. Validate the optional array
without changing version 1 or weakening unknown-field rejection. An absent
section means no companions. A malformed real section means an error.

- [ ] **Step 4: Run the focused tests and formatting.**

```bash
node --test src/workflow/planning-companion-artifacts.test.ts src/workflow/planning-state.test.ts
npx prettier --check src/workflow/planning-companion-artifacts*.ts src/workflow/planning-state-types.ts src/workflow/planning-state-validation.ts src/workflow/planning-state.test.ts
```

Expected: PASS. Review Focus 1 has behavioral coverage.

- [ ] **Step 5: Commit the contract.**

Commit only this task's files with
`feat(planning): define verified spec companion artifacts`.

### Task 2: Prove companions from immutable Git trees

**Files:**

- Create: `src/git/planning-companion-artifacts.ts`
- Create: `src/git/planning-companion-artifacts.test.ts`
- Modify: `src/git/planning-publication-git.ts`
- Modify: `src/git/planning-head-adoption-git.ts`
- Modify: `src/git/planning-workspaces.ts`
- Modify: `src/cli/commands/run-once/planning-phase-artifacts.ts` (typed wiring)
- Modify: `src/cli/commands/run-once/planning-workspace-ready.ts` (typed wiring)
- Modify: `src/cli/commands/run-once/planning-phase-publisher.ts` (typed wiring)
- Modify: `src/cli/commands/run-once/planning-head-adoption.ts` (typed wiring)
- Test: `src/git/planning-publication-git.test.ts`
- Test: `src/git/planning-publication-git.real.test.ts`
- Test: `src/git/planning-head-adoption-git.test.ts`
- Test: `src/git/planning-head-adoption-git.real.test.ts`

**Interfaces:**

- Export
  `readPlanningArtifactEvidence(input: { runner: CommandRunner; repoRoot: string; kind: PlanningArtifactKind; path: string; commitOid: string; source: PlanningArtifactEvidence["source"] }): Promise<PlanningArtifactEvidence>`
  from the new Git module.
- Add `inspectArtifactEvidence` to `PlanningPublicationOperations`. Its input
  omits `runner` and `repoRoot` from the reader signature.
- Add `artifactKind: PlanningArtifactKind` to `PlanningArtifactCommitInput`.
  Change `verifyArtifactCommit` to return `Promise<PlanningArtifactEvidence>`.
- Replace `PlanningWorkspaceVerificationInput.artifactPaths` with
  `artifacts: readonly PlanningArtifactEvidence[]`.
- Replace `PlanningHeadAdoptionInput.artifactPaths` with the same typed array.
  The adopted result returns `artifacts` beside `headOid`.
- Keep existing failure classes, immutable OID validation, ownership,
  remote-head agreement, and clean-workspace requirements.

- [ ] **Step 1: Add failing committed-tree and adoption regressions.**

Use real temporary repositories for filesystem and revision risks:

| Test                                                   | Assertions                                                                                                      |
| ------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------- |
| `verifies a spec plus declared mockup commit`          | The returned evidence contains the declared path and exact head. Both files are regular blobs.                  |
| `does not authorize companions from local content`     | Local spec edits cannot authorize an extra committed path. An untracked mockup cannot satisfy a declaration.    |
| `rejects missing or non-regular companions`            | Missing files, symlinks, directories, and submodules fail before push or local adoption.                        |
| `rejects unrelated creation changes`                   | An undeclared HTML file or production file causes `unexpected-changes`.                                         |
| `preserves single-document creation`                   | Spec-only commits pass. Plan-plus-HTML commits fail, even with declarations in plan prose.                      |
| `checks the whole planning workspace scope`            | Spec, its declared mockup, and an assigned plan pass together. An extra file in another commit fails.           |
| `adopts revised companion declarations`                | A revised spec can add a new declared mockup. Returned evidence uses the fetched candidate, not the saved list. |
| `rejects unsafe revised declarations before mutation`  | Invalid or missing companions leave the local head and saved evidence unchanged.                                |
| `permits removal only of previously proven companions` | Removing a declaration and deleting its former file passes. Editing an undeclared former file fails.            |
| `keeps spec-only and plan-only adoption strict`        | Existing unrelated-path, moved-head, dirty-worktree, and non-descendant cases still fail.                       |

Update command fakes for committed-blob reads. Do not assert only a new command
sequence. Assert returned evidence or the blocked outcome and unchanged state.

- [ ] **Step 2: Run the Git tests and record RED.**

```bash
GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_NOSYSTEM=1 node --test src/git/planning-companion-artifacts.test.ts src/git/planning-publication-git*.test.ts src/git/planning-head-adoption-git*.test.ts
```

Expected: new spec-plus-mockup and revision cases fail under single-file proofs.

- [ ] **Step 3: Implement committed-blob inspection and scoped proofs.**

Read the spec blob at the exact commit after proving its regular tree entry.
Derive companions through Task 1. Prove every declared companion at that commit.
Do not use worktree reads, comments, cached lists, or agent-provided allowlists.
Plans return no companion evidence.

For creation, require the artifact itself to change. Permit only that artifact
and its declared companions in the diff. Existing declared files can remain
unchanged. For workspace publication, rederive declarations at the verified head
and restrict the aggregate diff to assigned artifacts and their companions.

For adoption, inspect both recorded and fetched candidate trees before local
reconciliation. Permit candidate-declared files and artifact paths. A retired
companion can appear only as a deletion of a previously proven companion. Use
no-rename diff semantics for this proof. Return refreshed evidence only after
every proof and final remote-head check succeeds.

Keep this logic in the new Git module. Do not enlarge the publication class with
a second Markdown parser. Adapt the four existing typed callers and their
operation fixtures to the new inputs and results. Task 3 owns durable
propagation. Translate malformed declarations into typed publication/adoption
failures before any push, local reconciliation, or state replacement.

- [ ] **Step 4: Run Git regressions and type-contract checks.**

```bash
GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_NOSYSTEM=1 node --test src/git/planning-companion-artifacts.test.ts src/git/planning-publication-git*.test.ts src/git/planning-head-adoption-git*.test.ts
npm run check:contract-tests
```

Expected: Git tests PASS. Resolve typed operation fixtures that use the changed
interfaces. Review Focus 2 and the Git portion of Review Focus 3 have coverage.

- [ ] **Step 5: Commit the Git proofs.**

Commit this task's files and required interface-fixture updates with
`feat(git): verify committed planning companions`.

### Task 3: Carry companion evidence through planning handoffs

**Files:**

- Create: `src/cli/commands/run-once/planning-companion-evidence.ts`
- Create: `src/cli/commands/run-once/planning-companion-evidence.test.ts`
- Modify: `src/cli/commands/run-once/planning-phase-artifacts.ts`
- Modify: `src/cli/commands/run-once/planning-workspace-ready.ts`
- Modify: `src/cli/commands/run-once/planning-phase-runner-shared.ts`
- Modify: `src/cli/commands/run-once/planning-phase-runner-planning.ts`
- Modify: `src/cli/commands/run-once/planning-phase-runner-implementation.ts`
- Modify: `src/cli/commands/run-once/planning-phase-publisher.ts`
- Modify: `src/cli/commands/run-once/planning-head-adoption.ts`
- Modify: `src/cli/commands/run-once/planning-merge-recovery.ts`
- Modify: `src/cli/commands/run-once/planning-phase-reconciler.ts`
- Modify: `src/cli/commands/run-once/planning-implementation-base.ts`
- Test: adjacent lifecycle tests, including
  `planning-artifact-recovery.real.test.ts`,
  `planning-head-adoption.real.test.ts`,
  `planning-phase-reconciler.real.test.ts`,
  `planning-phase-runner.real.test.ts`, and
  `planning-finish-publication.real.test.ts`

**Interfaces:**

- Export
  `refreshPlanningArtifactEvidence(input: { artifacts: readonly PlanningArtifactEvidence[]; git: Pick<PlanningPublicationOperations, "inspectArtifactEvidence"> }): Promise<readonly PlanningArtifactEvidence[]>`.
- This helper rederives evidence at each record's `commitOid`. It never grants
  authority to the record's cached companion list.
- Task 2 supplies creation and adoption evidence. Task 1 supplies flattened
  verified paths for PR bodies and diagnostics.
- Verified merge proof results add
  `artifacts: readonly PlanningArtifactEvidence[]` from the fetched base. The
  reconciler persists those records instead of copying old declarations.

- [ ] **Step 1: Add failing creation, resume, and base-handoff tests.**

Add these cases to the existing real-repository fixtures:

- `spec companions survive creation and publication`: checkpoint
  spec-plus-mockup evidence and list both paths in the planning PR body.
- `recovers a committed spec and companions after interrupted checkpoint`:
  resume the exact descendant without another agent run.
- `hydrates old spec evidence before handoff`: an old record lacks the array,
  but committed declarations require companion verification before advancement.
- `keeps old specs without declarations valid`: no retroactive mockup
  requirement.
- `validates shared and implementation-carried specs`: spec-plus-mockup followed
  by a plan works in both gate matrices. Plan creation still changes only its
  document.
- `blocks missing companions on fetched bases`: no plan or implementation agent
  runs when the authoritative spec references a missing or non-regular file.

Assert durable records, PR body paths, agent-call counts, and blocked outcomes.
Do not derive these expectations from an unverified local checkout.

- [ ] **Step 2: Add failing revision and merge-recovery tests.**

Cover an open-PR revision, a revised PR merged before adoption, and a rewritten
base that uses existing current-base recovery. Each valid case refreshes
companions from the verified spec tree. Missing companions, stale declarations,
and non-regular files block without advancing or cleaning the workspace.

Keep command errors, malformed responses, and permission errors distinct from
recoverable ancestry/tree insufficiency. Assert that these errors do not become
successful current-base fallback results.

- [ ] **Step 3: Run the lifecycle tests and record RED.**

```bash
GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_NOSYSTEM=1 node --test src/cli/commands/run-once/planning-companion-evidence.test.ts src/cli/commands/run-once/planning-phase-artifacts.test.ts src/cli/commands/run-once/planning-artifact-recovery.real.test.ts src/cli/commands/run-once/planning-head-adoption*.test.ts src/cli/commands/run-once/planning-merge-recovery.test.ts src/cli/commands/run-once/planning-phase-reconciler*.test.ts src/cli/commands/run-once/planning-implementation-base.test.ts src/cli/commands/run-once/planning-phase-runner*.test.ts src/cli/commands/run-once/planning-phase-publisher.test.ts src/cli/commands/run-once/planning-finish-publication.real.test.ts
```

Expected: companion propagation and rehydration cases fail.

- [ ] **Step 4: Connect the verified evidence to existing lifecycle seams.**

Store the result of `verifyArtifactCommit` in both artifact creation and
recovery. Refresh recorded evidence before reuse or publication. Reject a
present cached array that disagrees with declarations at the same authoritative
commit. For an old absent array, derive it before the next handoff.

Keep `resolvePlanningPhaseArtifacts` as the pure candidate selector. In both
phase-runner preparation paths, inspect its selected records before checkpoint
or advancement. Before a plan agent receives its spec path, verify the
fetched-base spec and companions. This requirement includes specs from prior
phases.

Pass typed artifacts to workspace verification and head adoption. Persist the
adoption's returned evidence atomically with its publication head. Use
`planningArtifactPaths` for the planning PR body and blocked diagnostics. Do not
add companions as new artifact kinds.

During merge reconciliation, inspect declarations at the merge and fetched-base
trees. Apply the existing typed recovery rules to missing companion proofs.
Persist the fetched-base evidence after successful merge proof. Recheck prior
specs and companions on the newly fetched implementation base before agent work.
Preserve the newest effective planning anchor and unique-candidate checks.

For implementation-carried artifacts, retain the creation-time evidence OID. Do
not apply planning-only diff restrictions to later production commits. Do not
reparse declarations from a mutable local spec during implementation.

- [ ] **Step 5: Run focused and complete planning regression commands.**

Repeat Step 3, then run:

```bash
npm run test:run-once
npm run check:contract-tests
```

Expected: PASS. Review Focus 3 and the full companion lifecycle have coverage.

- [ ] **Step 6: Commit the durable handoff integration.**

Commit this task's files with
`feat(run-once): preserve spec companions across handoffs`.

### Task 4: Add pinned sibling skills and provenance metadata

**Files:**

- Create: `skills/frontend-design/SKILL.md`
- Create: `skills/frontend-design/LICENSE.txt`
- Create: `skills/patchmill-frontend-review/SKILL.md`
- Create: `skills/patchmill-frontend-review/LICENSE`
- Create:
  `skills/patchmill-frontend-review/references/upstream-web-design-guidelines.md`
- Create:
  `skills/patchmill-frontend-review/references/web-interface-guidelines.md`
- Modify: `src/workflow/skill-runtime-requirements.ts`
- Modify: `src/workflow/skill-pack.ts`
- Test: `src/workflow/skill-pack.test.ts`
- Modify: `bin/package-files.test.ts`
- Modify: `THIRD_PARTY_NOTICES.md`, `.prettierignore`,
  `.markdownlint-cli2.jsonc`

**Interfaces:**

Add these types to `skill-pack.ts`:

```typescript
export type SkillPackUpstreamSource = {
  repository: string;
  commit: string;
  files: Array<{ sourcePath: string; targetPath: string }>;
  license: { name: string; sourcePath: string; targetPath?: string };
};
// Extend SkillPackSkill without changing its existing source union:
// upstreamSources?: SkillPackUpstreamSource[]
export type SkillPackMetadataSkill = {
  name: string;
  source: SkillPackSkill["source"];
  requiredFiles: string[];
  upstreamSources?: Array<{
    repository: string;
    commit: string;
    files: Array<{ sourcePath: string; installedPath: string }>;
    license: { name: string; sourcePath: string; installedPath?: string };
  }>;
};
```

Add `skills?: SkillPackMetadataSkill[]` to old-readable metadata. Extend
`buildSkillPackMetadata` options with `skills?: SkillPackSkill[]`. Every newly
generated metadata file contains the array. Required installed paths come from
`requiredRuntimeFiles`, never pack-entry duplicates.

- [ ] **Step 1: Record baseline skill scenarios before writing wrappers.**

Use the scenario table in Task 6 against the current skills. Record missing
mockup guidance and frontend review behavior as baseline evidence. Keep this as
direct skill verification, not Markdown assertion tests.

- [ ] **Step 2: Add failing metadata and packaging behavior tests.**

Use a fixture upstream repository and commit, not production commit literals.
Assert custom-directory path rendering, sibling `..` normalization, preserved
`simple-english` source values, optional local license targets, and input
non-mutation. Assert that newly generated metadata always contains `skills`.

Use Task 5's install and doctor regressions to prove required-file behavior. Do
not add tests that only restate the static requirement registry. Keep existing
executable-helper and unknown-skill fallback tests. Update existing pack
expectations for the two siblings and version `2026.10.2`. Do not add new
literal-pin or prose tests.

Extend the existing npm dry-run test with all six new frontend files before
vendoring. Keep its notice-file assertion without new notice-prose assertions.

```bash
node --test src/workflow/skill-pack.test.ts bin/package-files.test.ts
```

Expected: RED for missing provenance and packaged files.

- [ ] **Step 3: Verify immutable sources and vendor the five upstream files.**

Construct raw URLs from the immutable upstream table:
`https://raw.githubusercontent.com/<repository>/<commit>/<source-path>`. Use
`curl --fail --silent --show-error --location` to download each source into a
temporary directory. Read the corrected wrapper and its pinned README license
section. If a commit or license cannot be verified, stop with evidence.

Copy the verified source bytes to the table's packaged targets. Record SHA-256
values in the progress ledger. Add notices for all three repositories, commits,
source paths, packaged/installed paths, licenses, purposes, and modification
status. Exclude only the three verbatim Markdown files from Prettier and
Markdownlint. Keep the Patchmill-owned review wrapper under both tools.

- [ ] **Step 4: Write the active review wrapper and pack metadata.**

Create `patchmill-frontend-review` with a trigger-only description. Its body
must:

- Evaluate final visible scope, including materialized files outside the diff.
- Read the local `references/web-interface-guidelines.md`. Treat the renamed
  upstream wrapper as provenance, not instructions.
- Require completed normal review, ordered fixes, explicit configured review
  passes, and final validation before dispatch.
- Discover an executable canonical `reviewer`. If none exists, use the existing
  reviewer-setup blocker. Never substitute author review or a compatibility
  role.
- Use a new fresh-context reviewer, with explicit resolved model and thinking
  under existing policy. Keep it shell-less, read-only, and child-free.
- Supply issue, spec, plan, optional mockup, immutable base/head, changed files,
  materialized content, project rules, and current available visual evidence.
- Apply the global precedence order. Record generic-rule overrides.
- Return `pass` or findings with Critical/Important/Minor severity, user impact,
  evidence, location, bounded correction, and rule basis.
- Exclude preference and unrelated pre-existing defects. Record disputed
  findings and dispositions. Require resolution of every valid frontend finding.
- Route repairs to the parent sole writer. Production repairs require affected
  validation, independent normal code review, ordered fixes, final commands,
  then a new frontend reviewer.
- Require affected direct verification and fresh frontend review for other
  repairs.
- Refresh stale screenshots through the existing visual-evidence process.
  Missing optional evidence is not a blocker. Required evidence remains
  required.
- Resolve all review work before handoff. Preserve evidenced blocker behavior.

Add both pack entries with `source: "patchmill"`. Record one Anthropic source
and two Vercel sources with the table's exact pins and targets. The Vercel
wrapper's license uses `sourcePath: "README.md#license"` without a local license
target. The rules license and Anthropic license have installed targets.

Extend the canonical runtime registry with the six new required files and
sibling requirements. Keep existing helpers and executable flags. Render
metadata with POSIX normalized installed paths below the selected skill
directory. Preserve existing `pack.source`, `additionalSources`, and the
raw-byte `files` integrity list.

- [ ] **Step 5: Run focused tests and direct source verification.**

```bash
node --test src/workflow/skill-pack.test.ts bin/package-files.test.ts
npx prettier --check src/workflow/skill-pack*.ts src/workflow/skill-runtime-requirements.ts bin/package-files.test.ts skills/patchmill-frontend-review/SKILL.md THIRD_PARTY_NOTICES.md .markdownlint-cli2.jsonc
npx markdownlint-cli2 skills/patchmill-frontend-review/SKILL.md THIRD_PARTY_NOTICES.md
```

Compare every vendored file with its temporary verified source using `cmp`.
Inspect the active review wrapper for runtime-fetch instructions. Expected: all
comparisons and commands pass. There is no mutable network rule dependency.

- [ ] **Step 6: Commit the pinned skills and model.**

Commit this task's files with
`feat(skills): add pinned frontend guidance and provenance`.

### Task 5: Preserve safe install, update, and doctor behavior

**Files:**

- Modify: `src/cli/commands/init/skill-installer.ts`
- Test: `src/cli/commands/init/skill-installer.test.ts`
- Test: `src/cli/commands/init/skill-installer-path-mode.test.ts`
- Create: `src/cli/commands/skills/metadata-validation.ts`
- Modify: `src/cli/commands/skills/update.ts`
- Test: `src/cli/commands/skills/update.test.ts`
- Test: `src/cli/commands/doctor/checks.test.ts`

**Interfaces:**

- Keep `installProjectSkills`, `validateExistingSkillDirectory`, and
  `updateProjectSkills` public signatures unchanged.
- Export
  `assertPatchmillManagedProjectLocal(metadata: unknown): asserts metadata is SkillPackMetadataFile`
  and `MISSING_METADATA_MESSAGE` from the new validation module.
- Installer and update pass their actual `packSkills` to metadata generation.
- Doctor continues to consume canonical requirements through
  `requiredSkillFiles`. No new frontend configuration or doctor production
  branch is required.

- [ ] **Step 1: Add failing installation and doctor regressions.**

Verify all six frontend files and metadata paths after default and custom-path
installation. Table-drive missing design licenses, review references, and
wrapper siblings. Source preflight rejection must leave no installed pack.

Simulate a staged copy that omits a required frontend sidecar while sources
remain valid. Assert that no staging directory becomes the installed pack. Keep
existing executable-helper tests and cleanup assertions.

For path mode and doctor, add minimal sibling fixtures to existing successful
cases. Omit one file in each new diagnostic case. Assert the missing file path,
not merely a generic failure. Include custom configured wrapper paths.

- [ ] **Step 2: Add failing metadata and update regressions.**

Cover these update boundaries:

- Old managed metadata without `skills` updates and gains the array.
- Present malformed records fail before mutation. Cases include wrong array
  shapes, missing name/source/requirements, invalid source unions, and empty
  provenance fields. Include malformed license evidence and installed paths
  outside the managed directory.
- Unsafe paths include traversal, backslashes, empty/dot segments, and control
  characters. Do not validate provenance paths more weakly than integrity paths.
- A provenance-only change returns `updated` with zero changed file hashes. An
  unchanged pack then returns `up-to-date`.
- Missing frontend source sidecars leave installed content and metadata
  unchanged.
- Customized managed files and new frontend-file collisions still stop updates.
- Updating from `2026.10.1` emits an informational frontend notice without a
  configuration migration. Custom entrypoints remain untouched.

- [ ] **Step 3: Run the boundary tests and record RED.**

```bash
node --test src/cli/commands/init/skill-installer.test.ts src/cli/commands/init/skill-installer-path-mode.test.ts src/cli/commands/skills/update.test.ts src/cli/commands/doctor/checks.test.ts
```

Expected: new metadata, frontend path-mode, and update-decision cases fail.

- [ ] **Step 4: Implement canonical requirement consumption and metadata
      guards.**

Keep existing installer/update preflight loops over `requiredRuntimeFiles`. Add
the two direct frontend skills to existing-directory validation before wrapper
checks. This order gives normalized missing-file diagnostics. Keep staged
validation and executable checks intact.

Pass custom pack entries to `buildSkillPackMetadata`. Extract existing metadata
guards into the new module before extending them. Accept absent `skills`, but
reject malformed present records. Validate required, upstream-installed, and
license-installed paths against the managed project-local directory. Keep the
current default-directory-only update boundary. Custom-path installation and
validation remain supported without expanding update scope.

Include `skills` in up-to-date comparison beside source, additional sources,
version, and file hashes. Add the `2026.10.2` notice. Keep customization and
collision checks before every mutation. Do not bypass safeguards during
migration.

- [ ] **Step 5: Run boundary tests and commit.**

Repeat Step 3, then run:

```bash
npm run lint:ts
npm run check:contract-tests
```

Expected: PASS, including Review Focus 4. Commit this task's files with
`feat(skills): validate frontend pack installation and updates`.

### Task 6: Compose conditional design and review into existing workflows

**Files:**

- Modify: `src/cli/commands/run-once/prompts.ts`
- Test: `src/cli/commands/run-once/prompts.test.ts`
- Modify: `skills/patchmill-planning/SKILL.md`
- Modify: `skills/inline-dev-with-validation-and-pr-checks/SKILL.md`
- Review: `skills/inline-dev-with-validation-and-pr-checks/review-appendix.md`
- Review: `skills/patchmill-frontend-review/SKILL.md`

**Interfaces:**

- Keep prompt builders and terminal result schemas unchanged.
- Planning consumes `../frontend-design/SKILL.md` and declares companions in the
  section implemented by Task 1.
- Inline implementation consumes `../patchmill-frontend-review/SKILL.md` after
  its existing review/fix/validation gates.
- The parent remains the repair author. No worker topology or TypeScript
  reviewer selection is introduced.

- [ ] **Step 1: Add failing executable prompt-contract tests.**

Extend existing prompt tests to assert these contracts:

```typescript
assert.match(specPrompt, /Do not implement product changes/u);
assert.match(specPrompt, /Required planning-only companion artifacts/u);
assert.match(
  specPrompt,
  /Commit the spec document and any required companion planning artifacts/u,
);
assert.doesNotMatch(specPrompt, /Do not implement code/u);
assert.match(planPrompt, /Commit only the plan document/u);
assert.match(
  implementationPrompt,
  /Do not add reviews beyond the configured workflow/u,
);
assert.doesNotMatch(implementationPrompt, /Do not add an automatic re-review/u);
```

Use the existing generated-prompt fixtures. Also retain finalization coverage
for unresolved subagents and unchanged terminal contracts.

```bash
node --test src/cli/commands/run-once/prompts.test.ts
```

Expected: RED for broad code prohibition and unconditional re-review
prohibition.

- [ ] **Step 2: Make the narrow prompt compatibility changes.**

Permit required planning-only companion artifacts, such as HTML mockups. Require
a spec-and-companions Conventional Commit without product changes. Keep the
plan's single-document commit restriction. Replace the generic finalization
prohibition with `Do not add reviews beyond the configured workflow.` Keep
frontend triggers, sibling paths, and reviewer orchestration out of TypeScript.

- [ ] **Step 3: Extend specification guidance in `patchmill-planning`.**

Require an applicability decision with a brief reason. Use the spec's visible
layout, styling, interaction, motion, accessibility, navigation, and flow
triggers. Copy-only work activates only for a material change in these areas.

When design applies, read the frontend sibling during brainstorming. Explicitly
identify it as specification guidance, not a later implementation phase. Require
one self-contained HTML file with embedded CSS/JavaScript, no network assets,
installation, build, or local server. Require full-page context, responsive
mobile/desktop layouts, semantic HTML, keyboard focus, and reduced-motion
support.

Include the exact `## Companion artifacts` entry shape in the wrapper. Require a
repository-relative declaration and a working link. Commit the mockup with its
spec in the active Phase workspace. Stop the plan handoff for a missing,
unlinked, or non-self-contained required mockup. Preserve previously approved
specs without mockups. Plans identify the spec and any referenced mockup as
inputs.

Amend the unattended artifact-only rule to permit declared spec companions. Keep
planning review gates and Run-once ownership unchanged.

- [ ] **Step 4: Extend the inline wrapper with the conditional review loop.**

Record applicability independently from the planning decision, using the final
delivery and materialized files. Retain one whole-delivery normal review and one
ordered fix pass for non-frontend work. Scope the wrapper's blanket
no-extra-review statements to non-frontend work. Make the required frontend
repair loop an explicit conditional exception.

For frontend work, complete task commands, normal review, its ordered fix pass,
explicit operator-configured reviews, and final validation first. Then use the
shared review skill's fresh reviewer and safe command-evidence procedure.

Record reviewed heads, review references, findings, dispositions, repairs,
commands, and visual evidence in the progress ledger. Unlike normal deferred
Minor findings, valid frontend findings require resolution before `pass`.

For production repairs, rerun affected validation and independent normal review
for the repair scope. Complete accepted normal fixes and final commands before
fresh frontend review. Other repairs need direct verification and frontend
re-review. Treat later current-head PR-check frontend fixes the same way.
Preserve stale-check detection and the two-pass PR-check repair limit.

Carry review records and unresolved human callouts into the PR summary before
scratch cleanup. No ready handoff can retain unresolved review work. The normal
review appendix remains the normal review contract, not a frontend preference
list.

- [ ] **Step 5: Replay the baseline scenarios with the new skill contracts.**

Record decisions, review order, and evidence in the plan workspace:

| Scenario                                                      | Required outcome                                                                                                  |
| ------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Backend-only change, documentation, or non-material copy edit | Both augmentations skip with reasons. Normal inline review behavior remains unchanged.                            |
| Copy changes materially affect navigation or accessibility    | Design/review activate despite a small textual diff.                                                              |
| Responsive UI proposal                                        | Design runs within brainstorming. A linked offline full-page mobile/desktop mockup exists before plan handoff.    |
| Mockup absent, fragment-only, or dependent on a CDN           | The author repairs the planning companion before handoff.                                                         |
| Project design system conflicts with a generic rule           | Project policy wins. The reviewer records the reason, not a preference finding.                                   |
| Approved older spec has no mockup                             | Review proceeds with code and available evidence. No retroactive requirement blocks it.                           |
| Materialized UI changes outside the committed range           | Final review scope includes their final content and activates independently.                                      |
| Missing local pinned rules                                    | Stop with an evidenced blocker. Never fetch a substitute.                                                         |
| Reviewer requests a shell command                             | Parent supplies safe command evidence. Reviewer remains shell-less and cannot create children or edit files.      |
| Valid frontend Minor finding                                  | Parent resolves it and dispatches fresh frontend review. It is not silently deferred.                             |
| Production frontend repair after review                       | Affected validation and independent normal review precede fresh frontend review. Old head approval cannot pass.   |
| PR-check repair changes UI or screenshots become stale        | Invalidate affected approval/evidence. Refresh through existing evidence tooling, then use the same review order. |
| Optional evidence absent, or a requirement is disputed        | Review proceeds without optional evidence. Record a reasoned disposition without waiving valid requirements.      |

For the responsive scenario, use a disposable fixture outside tracked sources.
Open its mockup from disk at 390px and 1440px widths with network disabled.
Verify page context, focus, reduced motion, and no required network request. Do
not commit a demonstration mockup as issue #210 product output.

This is direct behavioral skill verification. No automated test asserts wrapper
prose. Review Focus 5 uses these scenarios instead of a static-text test.

- [ ] **Step 6: Run prompt and skill checks, then commit.**

```bash
node --test src/cli/commands/run-once/prompts.test.ts
npx prettier --check src/cli/commands/run-once/prompts*.ts skills/patchmill-planning/SKILL.md skills/inline-dev-with-validation-and-pr-checks/SKILL.md skills/patchmill-frontend-review/SKILL.md
npx markdownlint-cli2 skills/patchmill-planning/SKILL.md skills/inline-dev-with-validation-and-pr-checks/SKILL.md skills/patchmill-frontend-review/SKILL.md
```

Expected: PASS and scenario evidence satisfies every outcome. Commit this task's
files with `feat(workflow): add conditional frontend design and review`.

### Task 7: Synchronize packaging, installed resources, and documentation

**Files:**

- Test: `bin/package-files.test.ts`
- Modify: `nix/package.nix`
- Regenerate: `.patchmill/skills/patchmill-skill-pack.json`
- Regenerate: source-equivalent new frontend skills and changed wrappers under
  `.patchmill/skills/`
- Modify: `README.md`
- Modify: `site/src/content/docs/guides/skills-configuration.md`
- Modify: `site/src/content/docs/using-patchmill/workflow-artifacts.md`

**Interfaces:**

- Consume Task 4's complete source directories and Task 5's metadata/update
  code.
- Produce installed bytes, hashes, and provenance that match the packaged
  sources.
- Keep configured entrypoint paths and npm/Nix dependency inputs unchanged.

- [ ] **Step 1: Verify npm package-content integration.**

Run the package guard added before vendoring in Task 4:

```bash
node --test bin/package-files.test.ts
```

Expected: PASS for all six frontend paths and the existing notices-file check.

- [ ] **Step 2: Add Nix install checks for both sides of the integration.**

Require all six new files under `$out/share/${pname}/skills/` and under the
project-local pack created by `$out/bin/patchmill init`. Require the notices
file. Do not change `npmDepsHash` because no dependency input changes.

- [ ] **Step 3: Document the workflow and companion authority.**

Explain activation, skips, offline full-page mockups, exact declarations, and
the normal `writing-plans` handoff. Explain independent review placement,
sole-writer repairs, revalidation/re-review, PR-check invalidation, precedence,
and visual-evidence use. Explain companion verification through publication,
resume, revision, merge, and fetched-base handoffs. Plans remain single-document
commits.

Explain pinned offline guidance and metadata provenance. Custom/global workflows
opt in through their own wrappers. This pack update requires no configuration
change. Keep the existing retirement migration documentation intact.

- [ ] **Step 4: Regenerate the managed project-local pack.**

```bash
node bin/patchmill.ts skills update
node bin/patchmill.ts skills update
```

Expected: first invocation writes `2026.10.2` with the frontend notice. Second
invocation reports up-to-date. If customization or collisions block the update,
inspect the reported file. Never overwrite it manually or bypass its hash guard.

- [ ] **Step 5: Verify source/installed equality, hashes, and packaged paths.**

Compare the six new files and the two changed workflow wrappers with `cmp`. Use
a direct Node inspection to recompute SHA-256 for every managed metadata `files`
entry. Compare generated `skills` with `buildSkillPackMetadata` for the same
skill directory. Inspect the three upstream records against the immutable table,
notices, and packaged targets. Verify every required installed path exists.

```bash
node --test bin/package-files.test.ts src/workflow/skill-pack.test.ts src/cli/commands/init/skill-installer.test.ts src/cli/commands/init/skill-installer-path-mode.test.ts src/cli/commands/skills/update.test.ts
npm pack --dry-run --json --ignore-scripts
npx prettier --check README.md site/src/content/docs/guides/skills-configuration.md site/src/content/docs/using-patchmill/workflow-artifacts.md
npx markdownlint-cli2 README.md site/src/content/docs/guides/skills-configuration.md site/src/content/docs/using-patchmill/workflow-artifacts.md
```

Expected: PASS. npm output includes both frontend directories, references,
licenses, and notices. The installed pack agrees with live source references.

- [ ] **Step 6: Commit packaging, generated resources, and documentation.**

Commit this task's files with
`chore(skills): synchronize frontend pack and documentation`.

### Task 8: Verify final consistency and prepare the normal handoff

**Files:** Review all changes since `IMPLEMENTATION_BASE`, the approved spec,
and this plan. No empty verification commit is required.

**Interfaces:** Consume all task evidence. Produce final validation evidence and
the complete package for the configured inline workflow's post-task review.

- [ ] **Step 1: Verify scope and dependency invariants.**

Use the full ledger OID as `IMPLEMENTATION_BASE`:

```bash
git diff --check "$IMPLEMENTATION_BASE"...HEAD
git diff --name-only "$IMPLEMENTATION_BASE"...HEAD
test -z "$(git diff --name-only "$IMPLEMENTATION_BASE"...HEAD -- package.json package-lock.json npm-shrinkwrap.json patchmill.config.json)"
```

Expected: no whitespace errors or forbidden changes. No retired wrapper returns.
There are no new frontend skill keys or frontend orchestration branches in
`src/pi/resource-profiles.ts` or `src/cli/commands/run-once/prompt-workflow.ts`.

- [ ] **Step 2: Repeat immutable-source and installed-pack verification.**

Fetch the five pinned upstream files into a new temporary directory. Repeat the
`cmp` checks and pinned Vercel README license verification from Task 4. Repeat
Task 7's source-to-installed and metadata-hash checks. Inspect both source and
installed planning/review wrappers against the approved spec. Remove temporary
downloads after recording their hashes and results.

- [ ] **Step 3: Run complete repository and package validation.**

```bash
npm test
npm run lint
npm run build
npm run check:contract-tests
npm pack --dry-run --json --ignore-scripts
nix build .#patchmill --no-link
```

Expected: every command exits 0. The Nix check runs tests and verifies packaged
and initialized frontend resources. Stage new tracked files before the Nix build
so its flake source includes them. If a dependency change becomes necessary,
record the scope decision and rerun the Nix build after that change.

- [ ] **Step 4: Prepare the configured whole-delivery review package.**

Include the immutable base/head, final materialized content, spec, plan, Review
Focus, ledger, and command evidence. Record that issue #210's own frontend
checkpoint does not apply because it changes no browser-visible product UI.
Skill scenario verification does not replace normal code review.

After Task 8 has its command evidence, the inline wrapper dispatches the normal
reviewer. It owns the ordered fix pass, final-command reruns, configured
explicit review passes, landing rules, and required PR checks. Do not add a
task-level reviewer or another default review loop.

- [ ] **Step 5: Verify acceptance coverage and durable reporting.**

Verify this acceptance mapping:

- Tasks 1–3 cover the companion contract.
- Tasks 4–5 cover offline resources and provenance.
- Task 6 covers conditional workflows.
- Task 7 covers packaging and documentation.

Record every unavailable check as an explicit blocker, not a passing result.

Record these handoff requirements in the ledger for the wrapper's post-task
gates:

- Carry review findings, dispositions, repairs, commands, and human callouts
  into the PR summary before cleanup.
- Resolve all review runs and local implementation task state before a ready
  handoff.
- Keep the plan workspace while blocked.
- Keep the terminal JSON schema unchanged.
- Carry this plan in the implementation PR, not a separate planning PR.
