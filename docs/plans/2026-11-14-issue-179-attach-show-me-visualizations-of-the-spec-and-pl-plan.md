# Planning visualizations implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use the installed sibling
> `executing-plans` skill for inline implementation. Follow the kernel envelope.
> Steps use checkboxes for tracking. Do not start per-task subagents.

**Goal:** Include show-me conceptual explanations in new or revised specs and
plans, with committed HTML companions when useful.

**Architecture:** Add the pinned upstream skill to the existing managed pack.
Keep generation, links, fallback, and publication in the planning skill.
Preserve existing kernel interfaces and approval gates.

**Tech Stack:** TypeScript, Node.js tests, Markdown skills, vendored
MIT-licensed skill files, existing npm packaging.

**Spec:**
[Conceptual visualizations for planning output](../specs/2026-11-14-issue-179-attach-show-me-visualizations-of-the-spec-and-pl-design.md).

## Global constraints

- Committed, linked HTML is sufficient. This delivery does not require browser
  hosting or an image preview.
- Show-me explains concepts. Its output does not duplicate UI mockups.
- HTML visualizations belong in the specs directory, beside the specification.
- No planning session downloads upstream content.
- Do not rewrite an approved spec to add a plan link.
- Existing unchanged documents do not need a retroactive explanation.
- No npm dependency or new manifest source field is needed.
- The kernel still verifies only existing stage and publication facts.

## Review focus

1. A prior pack without show-me must upgrade without losing unrelated files.
   Task 1 exercises upgrade and idempotence.
2. Missing or edited managed resources must not be overwritten by the update
   command. Task 1 exercises both paths.
3. Custom spec and plan directories must produce resolving HTML links in the
   actual spec directory. Task 2 scenario C exercises this.
4. Plan-only work must not modify an approved specification or create an early
   plan at a Spec gate. Task 2 scenario D exercises this.
5. Generation or publication errors must not produce broken links or false
   success. Task 2 scenarios E through G exercise this.

## Inputs and execution

Read the spec, `GLOSSARY.md`, `AGENTS.md`, and the installed planning, writing,
and execution guidance before implementation. No frontend mockup applies.

The inspected base is `7dbac5292d49753be55e73189b66bfa1ba548192`. Relevant
source locations are discovery hints, not a replacement for current inspection.

Use inline execution through the installed `executing-plans/SKILL.md`. Retain
the implementation skill's final independent whole-branch review and validation
requirements. This plan does not authorize publication from the local planning
helper.

## File responsibilities

| Files                                                                                    | Responsibility                                                                                  |
| ---------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `skills/show-me/SKILL.md`, `skills/show-me/agents/openai.yaml`, `skills/show-me/LICENSE` | Complete selected upstream skill tree and root license.                                         |
| `src/cli/commands/init/skill-installer.ts`                                               | Add the skill to the existing managed selection.                                                |
| `src/cli/commands/init/skill-installer.test.ts`                                          | Exercise copying, hash integrity, repair, package-root resolution, and unchanged-file behavior. |
| `src/cli/commands/skills/main.test.ts`                                                   | Exercise prior-pack upgrades and customization protection.                                      |
| `src/console/skills.test.ts`                                                             | Exercise installed sibling discovery and worker resolution at a custom pack root.               |
| `scripts/smoke-packed-artifact.mjs`                                                      | Verify show-me files and hashes after packed installation.                                      |
| `.prettierignore`, `.markdownlint-cli2.jsonc`                                            | Exclude the verbatim upstream skill document from automatic rewriting and Markdown lint.        |
| `THIRD_PARTY_NOTICES.md`                                                                 | Record immutable upstream provenance and licensing.                                             |
| `skills/patchmill-planning/SKILL.md`                                                     | Own generation, formats, naming, links, fallback, stages, and publication rules.                |
| `skills/patchmill-planning/plan-review.md`                                               | Include inline and linked explanations in Plan review.                                          |
| `skills/patchmill-plan/SKILL.md`                                                         | Keep local-helper guidance aligned without granting publication authority.                      |
| `site/src/content/docs/guides/skills-configuration.md`                                   | Explain the installed skill and the document contract.                                          |
| `.patchmill/skills/`                                                                     | Mirror source changes through the existing updater, including manifest hashes.                  |
| `docs/verification/issue-179-planning-visualizations.md`                                 | Record scenario evidence and integration checks.                                                |

Do not modify runtime files under `src/kernel/`, browser code, host adapters,
npm manifests, or lockfiles. No new runtime module, public interface, or
configuration key is necessary.

## Testing Value Gate

Add automated tests only for observable installation, update, discovery,
resource integrity, and packaged delivery behavior. Extend existing suites
instead of adding prompt-string or static-version tests.

Use direct upstream comparisons for provenance and licenses. Use direct
inspection and temporary planning documents for generation, portability, stage
rules, and failure scenarios. Do not snapshot generated prose or use regex tests
to assert skill instructions.

---

### Task 1: Deliver show-me through the managed skill pack

**Files:** The first eight rows of the file map, the verification document,
generated `.patchmill/skills/show-me/`, and `patchmill-skill-pack.json`.

**Interfaces:**

- Consume
  `installSkills({ repoRoot: string, skillDir: string, packageRoot: string }): Promise<{ written: number; unchanged: number }>`.
- Consume `main(["update"], { repoRoot, packageRoot, output }): Promise<number>`
  from the skills command.
- Consume `consoleSkillPaths(config, repoRoot): string[]` and the existing
  real-loader test pattern.
- Produce the unchanged installer interface with `show-me` included in
  `PATCHMILL_SKILLS`.
- Produce `show-me/SKILL.md`, `show-me/agents/openai.yaml`, and
  `show-me/LICENSE` at the destination, with manifest hashes.
- Preserve `disable-model-invocation: true`. Explicit planning use, not
  automatic prompt inclusion, consumes this skill.

- [ ] **Step 1: Add failing installation, upgrade, and discovery tests.**

Extend the existing installer test to compare the new installed resources with
`skills/show-me/` and compare every resource hash. Include explicit access to
the three required installed files so the test fails before registration.

Reuse the complete-tree, read-only-package fixture and second-install mtime
assertions. Add show-me to the fixture's package-local resource exercise. Damage
`show-me/SKILL.md`, remove its license, then call `installSkills` directly and
assert exact byte repair.

Add a prior-pack upgrade case to `src/cli/commands/skills/main.test.ts`:

```ts
// After setup installs the current pack:
await rm(join(skills, "show-me"), { recursive: true, force: true });
manifest.files = manifest.files.filter(
  (file: { path: string }) => !file.path.startsWith("show-me/"),
);
await writeFile(manifestPath, JSON.stringify(manifest));
await writeFile(join(skills, "user-note.txt"), "keep\n");
assert.equal(await run(), 0);
assert.equal(await exists(join(skills, "show-me/SKILL.md")), true);
assert.equal(await exists(join(skills, "show-me/LICENSE")), true);
assert.equal(await readFile(join(skills, "user-note.txt"), "utf8"), "keep\n");
```

The completed test also asserts that the new manifest hashes match installed
bytes and that a second update reports no changes. Add a customization case that
edits the managed skill and removes its managed license. Assert exit `1`, both
paths in diagnostics, unchanged edited bytes, and an unchanged manifest.

Extend the real custom-pack test in `src/console/skills.test.ts`. Assert that
the loader finds `show-me` at `custom/pack/show-me/SKILL.md`, with
`disableModelInvocation === true`. Assert that worker skill resolution has no
missing entries and resolves the same installed file. Use the existing loader
and worker adapters, not a new wrapper.

- [ ] **Step 2: Run the focused tests and observe the missing-resource
      failure.**

Run from the implementation worktree after its normal bootstrap:

```bash
node --test src/cli/commands/init/skill-installer.test.ts src/cli/commands/skills/main.test.ts src/console/skills.test.ts
```

Expected: the new assertions fail because the installed show-me resources do not
exist. Do not treat a dependency or environment error as the expected red
result.

- [ ] **Step 3: Vendor the exact upstream tree and register it.**

Copy `plugins/show-me/skills/show-me/` from HumanLayer commit
`4d69d20f6e9b57b4fcf0d501ccfb1be961f0f329` into `skills/show-me/`. Copy that
commit's root MIT `LICENSE` into the new directory. Preserve bytes, including
`agents/openai.yaml` and the invocation metadata.

Before formatting or committing, exclude `skills/show-me/SKILL.md` in
`.prettierignore` and `.markdownlint-cli2.jsonc`. Follow the existing vendored
`frontend-design` pattern. The pinned Markdown fails Prettier and Markdown rule
`MD040`. Preserve its original bytes instead of fixing upstream style. These
exclusions also protect the file from the commit hook's `prettier --write`
command.

Add `show-me` to `PATCHMILL_SKILLS`. Leave `SkillPackManifest.sources`
unchanged. Record the immutable source, both selected resource paths, packaged
and installed paths, license, and verbatim status in `THIRD_PARTY_NOTICES.md`.

Upstream acquisition belongs to implementation packaging, not a future planner
session. Compare the packaged files directly with the immutable upstream files.
Record the three SHA-256 values in the verification document rather than adding
static-hash assertions to the test suite.

- [ ] **Step 4: Extend packed-artifact verification.**

In `scripts/smoke-packed-artifact.mjs`, after packed `patchmill init`, compare
the three installed resources with the packed `skills/show-me/` resources.
Compute the installed SHA-256 values and compare them with the installed
manifest. Use the already resolved `patchmillPackageRoot` and destination. Keep
this check private to the existing smoke script.

- [ ] **Step 5: Refresh the managed pack and run the focused suites.**

Use the existing update command, not manual manifest edits:

```bash
node --input-type=module -e 'import { main } from "./src/cli/commands/skills/main.ts"; process.exitCode = await main(["update"], { repoRoot: process.cwd(), packageRoot: process.cwd() });'
node --test src/cli/commands/init/skill-installer.test.ts src/cli/commands/skills/main.test.ts src/console/skills.test.ts
node scripts/smoke-packed-artifact.mjs
```

Expected: all focused tests and the packed install pass. Run `npm run lint` to
verify the new exclusions before committing. Compare the packaged and installed
upstream bytes again after the commit hook. Inspect the diff for unchanged
upstream pins and unrelated installed resources. If managed customization blocks
the real update, stop for guidance instead of bypassing protection.

- [ ] **Step 6: Commit the working skill distribution.**

Stage only the task's source, tests, notices, and generated pack changes. Commit
with `feat(skills): bundle pinned show-me guidance`.

### Task 2: Integrate conceptual explanations into planning and review

**Files:** The remaining file-map rows and generated copies of modified planning
skills. Extend the Task 1 verification document.

**Interfaces:**

- Consume the installed sibling `../show-me/SKILL.md` and `../show-me/LICENSE`
  from Task 1.
- Consume exact `specPath`, `planPath`, branch, worktree, stage, and gate facts
  already supplied in the envelope.
- Produce one `## Visual explanation` per new or materially revised planning
  document.
- For HTML, produce
  `dirname(specPath)/<owning-document-basename-without-.md>-show-me.html` and
  resolving relative links from its owning document.
- Reuse the owning document's single `## Companion artifacts` section.
  Inline-only output needs no companion file.
- Preserve all existing publication, approval, review, and missing-prerequisite
  protocols.

- [ ] **Step 1: Add the shared planning contract.**

Update `skills/patchmill-planning/SKILL.md` in one targeted change set. Require
explicit application of installed show-me after substantive drafting and before
review. Keep upstream instructions unchanged and put Patchmill adaptations in
the wrapper.

Specify the exact format, stage, naming, linking, and self-contained HTML
requirements from the spec. Distinguish conceptual explanations from UI mockups.
Do not add HTML by default or suppress it because a mockup exists.

Require both the skill and its license. Preserve the existing interactive
guidance and unattended `needs-input` behavior. Do not download missing
resources or auto-open a browser in unattended planning.

Include the spec's error table. Cover inline fallback, absent files, revisions,
and publication errors. Prohibit dangling links and prose-only success. Add
visualization paths to the existing summary when HTML exists. Do not change
result schemas or add PR-body mutations.

- [ ] **Step 2: Align local planning and fresh Plan review.**

Update `skills/patchmill-plan/SKILL.md` to make its reuse of the sibling
visualization guidance explicit. Keep its no-implementation, no-installation,
no-publication, and existing-gate rules.

Update `skills/patchmill-planning/plan-review.md` to require independent
inspection of the plan's inline explanation and linked HTML. Review for concept
agreement, actual companion existence, relative links, offline portability, and
stage ownership. Keep the reviewer read-only. Do not require browser hosting or
a UI-design review for a conceptual document.

- [ ] **Step 3: Update the user guide and refresh installed copies.**

Update `site/src/content/docs/guides/skills-configuration.md`. Include show-me
in the bundled list and describe its pinned provenance, explicit use, conceptual
purpose, format selection, HTML location, links, fallback, and GitHub
source-view limitation.

Run the Task 1 update command again. Inspect the generated planning copies and
manifest. Keep all live references aligned with the same upstream commit and the
source planning instructions.

- [ ] **Step 4: Exercise bounded planning scenarios and record evidence.**

Use temporary copies of this issue's documents and the installed skill. Do not
mutate approved documents or hosting state. Apply show-me directly to produce
representative output. Record inputs, observed files, link checks, and
limitations in `docs/verification/issue-179-planning-visualizations.md`.

| Scenario                               | Input and expected result                                                                                                                                                                          |
| -------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A: Simple conceptual explanation       | A small state or dependency model produces an inline Mermaid diagram or text sketch under `## Visual explanation`. No mandatory HTML companion.                                                    |
| B: HTML explanation                    | A dense concept produces one offline HTML companion in the spec directory, independent of any existing UI mockup. Both the contextual link and companion entry resolve.                            |
| C: Non-default paths                   | Spec `design/specs/topic-design.md` and plan `delivery/plans/topic-plan.md` put both HTML files in `design/specs/`. Plan links resolve from `delivery/plans/`, not the repository root.            |
| D: Stages and revisions                | Spec-only produces no plan. Plan-only preserves approved spec bytes. Ungated new spec and plan each get explanations. A substantive plan revision refreshes its explanation before renewed review. |
| E: Generation fallback                 | A failed HTML attempt produces inline Mermaid or a text sketch. The document records the reason and contains no link to the absent HTML. Failure of all formats stops success.                     |
| F: Missing prerequisite or broken link | Missing installed skill or license requires guidance, not a download. A broken or escaping companion link requires repair before success.                                                          |
| G: Publication failure                 | A simulated push or required-PR error preserves local companions and reports failure. No alternate issue upload or false published claim. The local helper never publishes.                        |

For generated HTML, open the file directly at mobile and desktop widths with
network access disabled. Verify readable content and any keyboard interaction.
This verifies document portability, not a new product UI.

For failure scenarios, use a read-only walkthrough of the updated instructions
and existing kernel publication behavior. Do not execute real failing pushes or
PR mutations. Label these as walkthrough evidence rather than automated
enforcement or model-reliability proof.

- [ ] **Step 5: Run final integration checks.**

```bash
npm run check:types
node --test src/cli/commands/init/skill-installer.test.ts src/cli/commands/skills/main.test.ts src/console/skills.test.ts src/kernel/names.test.ts src/kernel/planning-gates.test.ts src/kernel/planning-publication.test.ts
npm test
npm run lint
node scripts/smoke-packed-artifact.mjs
```

Expected: type checks, focused tests, full tests, lint, and packed installation
pass. Inspect the primary-artifact matching behavior: HTML never substitutes for
a required spec or plan.

Verify complete upstream files exist at the paths Patchmill resolves. Compare
source and installed bytes, manifest hashes, notices, guide, and live skill
references. Check relative links in representative generated documents.

No npm manifests or lockfiles change under this plan. If an authorized
correction changes them, regenerate the Nix dependency hash and run
`nix build .#patchmill --print-build-logs`, as `AGENTS.md` requires.

- [ ] **Step 6: Commit and hand off through normal implementation review.**

Commit with `feat(planning): add conceptual show-me explanations`. Complete the
implementation skill's required final review before claiming delivery. Keep
planning companions and implementation in this issue's authorized PR. Never push
the base branch or force-push.

## Planner self-review

- Spec coverage: Task 1 supplies the pinned skill, license, discovery, update
  protection, and packed delivery. Task 2 supplies the entire document and
  recovery contract.
- Interfaces: Existing installer, update, console, and kernel interfaces remain
  unchanged. HTML names derive from the owning document and the actual spec
  directory.
- Scope: No product UI, hosting, asset upload, dependency addition, or kernel
  parser is required.
- Verification: Behavior tests cover the existing distribution seams. Direct
  scenarios cover agent instructions without static prompt assertions.
- Review focus: All five listed conditions have an owning task and explicit
  evidence requirements.

## Plan review

Initial fresh-context review used the canonical `reviewer` with
`openai-codex/gpt-6.1-sol:xhigh` against base
`7dbac5292d49753be55e73189b66bfa1ba548192`.

- Reviewed spec SHA-256:
  `5ea33dc542050edac3befd56b5e8f290c01537b94457f323633ae63d5307807b`.
- Initial plan body SHA-256:
  `8b58a22bea6babe0f8aa7bfb60e0f1d2b0d04d0690c9b5a6fa63bec2a04d2484`.
- Independent survey: installer copying, hashes, update protection, discovery,
  and worker resolution. The reviewer also inspected stages, publication,
  Markdown-only primary artifacts, packed delivery, and the pinned upstream
  tree.
- Architecture evidence: `skill-installer.ts:62–154`, `skills/main.ts:33–106`,
  `console/skills.test.ts:12–65`, `init/agent-dir.ts:31–46`,
  `kernel/names.ts:52–59`, `kernel/verify.ts:54–89`, and
  `scripts/smoke-packed-artifact.mjs:32–63`.
- B1 accepted: verbatim upstream Markdown conflicts with repository formatting
  and rule `MD040`. Task 1 now adds the existing-pattern exclusions, lint
  verification, and post-hook byte comparison. No upstream content or dependency
  change is necessary.
- No optional findings. Builder check: nothing important left.
- Limits: no dependency installation, baseline suites, packed workflow, live
  hosting query, or generated-HTML verification occurred. The reviewer
  reproduced the lint conflict in memory and inspected source independently.
- Corrected plan body SHA-256:
  `84968cd785af4afa9ff0ddb57a6d913c1a944c3c52d9dc939e175ec8f460047d`. The body
  hash excludes this entire receipt section.
- Fresh scoped confirmation used the same reviewer model and thinking level. It
  independently verified the exclusions, hook behavior, integrity seams, and
  verification order. B1 is resolved, with no remaining scoped blockers. The
  initial architecture conclusion still stands.
- Readiness: ready for human submission after the accepted correction. This
  assessment does not grant approval or change a gate. Implementation tests,
  actual exclusion edits, post-hook parity, and HTML scenarios remain future
  obligations.
