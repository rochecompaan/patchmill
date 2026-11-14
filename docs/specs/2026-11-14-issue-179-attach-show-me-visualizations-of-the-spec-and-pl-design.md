# Conceptual visualizations for planning output

## Intent

Issue [#179](https://github.com/rochecompaan/patchmill/issues/179) asks for
visual explanations of specifications and implementation plans. Reviewers need a
conceptual model before they can judge the prose.

Use HumanLayer's show-me skill to produce these explanations during planning.
Keep each explanation with the document that it explains.

## Maintainer decisions

The maintainer clarified the requirements during interactive planning:

- Show-me explains concepts. Its output does not duplicate UI mockups.
- HTML visualizations belong in the specs directory, beside the specification.
- The relevant specification or plan links its HTML, as specifications already
  link mockups.
- Committed, linked HTML is sufficient. This delivery does not require browser
  hosting or an image preview.

The last decision replaces the issue's original browser-only viewing requirement
for HTML. GitHub shows committed HTML as source. Reviewers can download the file
and open it in a browser without a build or local server.

Issue #180 already moved planning documents to pull requests. This delivery
follows that workflow instead of restoring issue uploads or issue comments.

## Goals

1. Every new or materially revised spec and plan includes a show-me visual
   explanation.
2. Each explanation uses the smallest useful format, not HTML by default.
3. HTML remains durable, self-contained, and linked from its owning document.
4. Installation and updates include the pinned upstream skill and its license.
5. Missing skills, broken links, and publication errors cannot produce a
   successful planning claim.

## Non-goals

- HTML hosting, GitHub Pages, gists, image generation, and issue asset uploads.
- A live-artifact viewer in `patchmill serve`.
- Product UI changes or a redesign of UI mockups.
- New configuration keys, result fields, kernel phases, or artifact kinds.
- Bulk changes to existing approved specifications or plans.
- A new generation tool, templating framework, or mandatory HTML output for
  every document.

## Approaches and publication trade-offs

| Approach                                 | Benefit                                                         | Cost and decision                                                                              |
| ---------------------------------------- | --------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Committed HTML, linked from the document | Reviewable source and durable revision history. Fits #180.      | GitHub shows source, not a rendered page. Selected for HTML after maintainer clarification.    |
| Inline Mermaid or text sketches          | GitHub renders Mermaid. Trees and diffs need no separate files. | Cannot express every concept clearly. Selected for simpler explanations and the HTML fallback. |
| Rendered PNG or SVG                      | Gives an immediate static preview.                              | Adds capture and refresh work and loses interaction. Not required by the maintainer.           |
| HTML issue attachment                    | Preserves the file.                                             | Still requires download and creates a second publication path. Rejected.                       |
| Gist or external host                    | Can show interactive HTML in a browser.                         | Adds hosting, permissions, and exposure risks. Rejected.                                       |

The primary mechanism for HTML is a committed companion with a relative link.
The fallback is an inline Mermaid diagram or text sketch in the owning document.
The fallback still explains the concept. It is not an apology or a prose-only
replacement.

## Existing architecture and evidence

The inspected base is `7dbac5292d49753be55e73189b66bfa1ba548192`.

- `src/cli/commands/init/skill-installer.ts` exports `PATCHMILL_SKILLS` and
  `installSkills(options)`. It copies complete selected skill directories and
  hashes their resources.
- `src/cli/commands/skills/main.ts` checks the old manifest before updating. It
  refuses customized managed files and removes resources dropped from the pack.
- `src/console/skills.ts` supplies configured pack roots to the resource loader.
  `src/console/skills.test.ts` exercises discovery and worker skill injection.
- `skills/patchmill-planning/SKILL.md` owns document creation, companion links,
  stages, fresh Plan review, commits, and publication.
- `skills/patchmill-plan/SKILL.md` delegates document guidance to the planning
  sibling but prohibits local-helper publication.
- `src/kernel/names.ts` recognizes only `-design.md` and `-plan.md` as primary
  planning documents. Linked HTML does not satisfy either kind.
- `src/kernel/facts.ts` discovers those primary documents.
  `src/kernel/verify.ts` checks stage completion and PR facts, not companion
  contents.
- `src/kernel/planning-gates.test.ts` and
  `src/kernel/planning-publication.test.ts` exercise gated publication and
  ungated planning.
- `src/web/file-run-data.ts` currently returns empty real-artifact collections.
  Browser hosting is therefore not an existing production publication path.

This is a small architecture extension at an existing seam: a bundled skill
enters the managed pack and the planning module calls it. No runtime module
decomposition changes.

## Domain and module ownership

Patchmill remains one context. A **Planning visualization** explains concepts,
relationships, or execution order. A UI mockup depicts the proposed interface.
An implementation screenshot records delivered UI. These are separate concepts.

`GLOSSARY.md` records that distinction. No context map is needed. No relevant
ADR exists under `docs/adr/`. This reversible extension does not justify a new
ADR.

The skill installer module owns copying, repair, update protection, and hashes.
Its existing interface remains unchanged. The planning module owns when to use
show-me, which document it explains, and how to publish its output.

The existing package-root filesystem seam has production and temporary-package
test adapters. The resource-loader seam has the real Pi loader and isolated test
repositories. Dependencies enter through existing `packageRoot`, `repoRoot`, and
configured phase paths. Do not add a remote generation adapter.

The upstream prompt, licensing, and loader details remain hidden from planning
callers. Callers need the installed sibling path and the publication rules, not
a new runtime protocol. This preserves locality in the planning skill and gives
both kernel planning and the local helper the same leverage. The installer
retains its existing depth rather than adding a pass-through module.

## Upstream skill packaging

Vendor the complete selected skill directory from:

- Repository: `https://github.com/humanlayer/skills`.
- Commit: `4d69d20f6e9b57b4fcf0d501ccfb1be961f0f329`.
- Source: `plugins/show-me/skills/show-me/`.
- Packaged destination: `skills/show-me/`.
- Installed destination: `.patchmill/skills/show-me/`.
- License: the repository's root MIT `LICENSE`, copied to
  `skills/show-me/LICENSE`.

At this revision, the selected directory contains `SKILL.md` and
`agents/openai.yaml`. Preserve both verbatim. Record the commit, source paths,
destination paths, license, and modification status in `THIRD_PARTY_NOTICES.md`.

Add `show-me` to `PATCHMILL_SKILLS`, following the existing vendored
`frontend-design` pattern. The manifest records its hashes under the existing
Patchmill source version. Provenance remains in the notices. No npm dependency
or new manifest source field is needed.

Refresh the repository's managed `.patchmill/skills` through the existing update
command. Keep unrelated installed skills and their dependency pins unchanged. No
planning session downloads upstream content.

Upstream sets `disable-model-invocation: true`. Keep this metadata. The planning
wrapper explicitly reads and applies `../show-me/SKILL.md` to its document. It
does not rely on automatic skill suggestions or launch a nested agent.

## Generation and document contract

### Timing and scope

After the document's substantive content is stable, apply show-me to that
document. Do this before spec self-review or fresh Plan review and before the
authorized commit and push.

At stage `spec`, produce only the specification's explanation. At stage `plan`,
reuse the specification and explain the new or revised plan. If the spec is also
missing, explain both newly written documents. At stage `implementation`,
explain each missing or materially revised planning document.

Do not rewrite an approved spec to add a plan link. The plan owns its own
explanation and companion list. Existing unchanged documents do not need a
retroactive explanation. Later substantive revisions refresh their explanations
in the same change.

### Format selection

Each new or revised document contains one `## Visual explanation` section. Use
the installed skill's judgment to select the format:

- Relationships, data flow, or state transitions: Mermaid when it is sufficient.
- Responsibility, execution order, or a refactor: a shallow tree, call tree,
  pseudocode, or diff.
- A concept too dense for these formats: focused HTML with diagrams, an
  infographic, or a short slide deck.

Explain the document's key concepts and decisions, not every paragraph or every
file. Spec explanations emphasize relationships and behavior. Plan explanations
emphasize task order, dependencies, and ownership. These are guidance, not
mandatory templates.

HTML can depict conceptual examples of UI behavior. It remains separate from the
full-page mockup required for frontend design. Do not suppress show-me output
merely because a mockup exists.

### HTML naming and linking

Let `specPath` and `planPath` be the exact document paths from the envelope.
Store all generated HTML in `dirname(specPath)`, including HTML that explains
the plan.

Use the owning document's basename without `.md`, followed by `-show-me.html`. A
spec named `2026-11-14-issue-9-topic-design.md` produces
`2026-11-14-issue-9-topic-design-show-me.html`. Its plan produces
`2026-11-14-issue-9-topic-plan-show-me.html` in the same specs directory.

The owning document's `## Visual explanation` section gives one sentence of
context and a relative link. Its single top-level `## Companion artifacts`
section lists the repository path and a resolving relative link. Reuse that
section if it already lists mockups or domain documents.

For default paths, the spec links
`./2026-11-14-issue-9-topic-design-show-me.html`. The plan links
`../specs/2026-11-14-issue-9-topic-plan-show-me.html`. Resolve relative links
from the owning document, not the repository root. Use actual envelope paths for
custom directory layouts.

HTML includes its title, issue number, and owning document name. It contains no
generated timestamps or commit hash that requires a circular regeneration cycle.
Revisions replace the same file rather than creating a second current
explanation.

### HTML portability

Each HTML file opens directly from disk. Embed its styles and any scripts. Do
not require network assets, CDNs, a build, an installation, or a local server.

Prefer semantic HTML, readable labels, and a layout that works at mobile and
desktop widths. If interaction helps understanding, provide keyboard access and
visible focus. A static diagram is sufficient when interaction adds no value.

Do not open a browser or start a server during unattended planning. Validate the
file and links locally. In an interactive session, opening the file is optional.
Upstream's `open` example does not override these workflow rules.

## Review, publication, and recovery

The planner reviews the visual explanation for agreement with its document.
Fresh Plan review includes the plan's inline output and linked HTML as inputs.
Update `skills/patchmill-planning/plan-review.md` to make that obligation
explicit.

Keep all companions in the owning document's authorized branch, commit, and PR.
Required gates still stop at their existing stages. Ungated documents stay with
implementation. The local helper writes local documents only.

The issue-to-PR relationship remains unchanged. Existing workflow references
provide discoverability. This delivery adds no issue comment, label change,
issue-body edit, upload, host adapter, or PR-body mutation.

| Condition                                         | Required behavior                                                                                                                                  |
| ------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| Installed show-me skill or license is missing     | Stop before success. Ask the maintainer in interactive planning. Use the existing `needs-input` protocol unattended. Do not download a substitute. |
| HTML cannot be generated or validated             | Replace it with an inline Mermaid or text explanation. Record the fallback reason briefly. Remove any link to an absent file.                      |
| All visual formats fail                           | Stop before success through the existing guidance channel. Prose alone does not meet the requirement.                                              |
| A companion link is broken or leaves the worktree | Repair the path before publication. Never claim the missing companion exists.                                                                      |
| Document changes after review                     | Refresh the affected visual. Material plan changes require renewed review under the existing review policy.                                        |
| Commit, push, or required PR publication fails    | Preserve the document and companion. Report the existing execution failure. Do not claim publication or create an alternate issue upload.          |
| A required gate reuses an approved document       | Keep its existing visualization untouched unless the document itself is authorized for revision.                                                   |

The kernel still verifies only existing stage and publication facts. This issue
adds skill-owned requirements, not a kernel HTML parser or a new security
sandbox.

## Frontend applicability

Frontend design does not apply to this delivery. It changes planning
instructions, skill distribution, and documentation, not Patchmill's product UI.
Generated conceptual HTML is a planning document, not a new application screen.
No frontend mockup accompanies this specification.

## Verification and acceptance

Automated tests cover observable pack installation, update protection, hash
integrity, custom-path discovery, and packaged delivery. They do not assert
prompt prose or static dependency versions.

Direct inspection and bounded planning scenarios cover format selection, HTML
links, portability, stage limits, fallback, and publication errors. Use
hand-authored scenario inputs rather than nondeterministic model-output
snapshots. Record those results during implementation.

Acceptance requires:

1. A fresh install and an upgrade provide the pinned show-me tree and license at
   the resolved sibling path.
2. Repeated installation preserves unchanged bytes and modification times.
   Customized managed resources remain protected.
3. Both planning entry points use the same conceptual-visualization contract
   without changing their publication authority.
4. New specs and plans each contain a useful visual explanation. HTML follows
   the naming, directory, link, and portability rules.
5. Review includes the relevant explanations. Existing gates and kernel result
   contracts remain unchanged.
6. The documentation states that linked HTML satisfies this delivery, without
   promising GitHub rendering.

## Companion artifacts

- `GLOSSARY.md`:
  [Canonical Planning visualization definition](../../GLOSSARY.md).
