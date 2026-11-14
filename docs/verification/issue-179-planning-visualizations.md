# Issue #179 verification

## Scope

This delivery adds conceptual show-me explanations to planning. It does not add
HTML hosting, image previews, a product UI, or a kernel artifact kind.

The specification records the maintainer's decision: committed, linked HTML is
sufficient. UI mockups and conceptual visualizations remain separate artifacts.

## Skill provenance and integration

HumanLayer commit: `4d69d20f6e9b57b4fcf0d501ccfb1be961f0f329`.

| Resource             | SHA-256                                                            |
| -------------------- | ------------------------------------------------------------------ |
| `SKILL.md`           | `434a2346cc95e313b0d367d477dda2e23ba642dd2181757415a09500664af100` |
| `agents/openai.yaml` | `a1499d95abd8447558c535fe5554adcc3c9b988a0a39264a6283d430effe1e94` |
| Root MIT `LICENSE`   | `5f13c18ea00ea5c1384f41745feeca774079164f7f59a92e4ac0899ad217b26f` |

The selected upstream directory contains only the first two resources. The
packaged `skills/show-me/` includes both files and the root license. The
standard updater installs the same bytes under `.patchmill/skills/show-me/`. The
managed manifest records their hashes. The notice and planning guide identify
the same immutable source.

The upstream prompt retains `disable-model-invocation: true`. The real Pi
resource loader discovers it at a custom pack root. Worker resolution finds the
same file. Planning explicitly reads the sibling instead of relying on implicit
prompt injection.

## Distribution checks

- `npm ci`: succeeded without manifest or lockfile changes.
- Baseline `npm test`: 1223 passed, zero failures.
- New focused tests before implementation: five expected failures for missing
  show-me files and missing skill discovery.
- Focused tests after registration: 14 passed, zero failures. They cover
  complete resources, hashes, repair, stable bytes and mtimes, package-root
  isolation, prior-pack upgrade, customization protection, and real-loader
  discovery.
- `node scripts/smoke-packed-artifact.mjs`: passed. The packed install provides
  all three resources, byte parity, and matching installed hashes.
- `npm run lint`: passed with file-specific exclusions for the verbatim upstream
  Markdown. Owned planning instructions remain subject to lint.

The smoke install uses an isolated home without GitHub credentials. Its expected
host-readiness warning does not prevent skill installation or integrity checks.

## Planning scenarios

The implementer explicitly read the installed show-me skill and applied it to
temporary copies of this issue's specification and plan. These are direct
scenario exercises, not a separate model reliability benchmark. Approved source
documents remained byte-identical.

| Scenario                           | Observed result                                                                                                                                                                                                                       |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A: Simple concept                  | A text call tree explains installation before planning use. No HTML file is necessary.                                                                                                                                                |
| B: Dense concept                   | A focused HTML concept map separates spec ownership, plan ownership, and the unchanged publication path. A second HTML explains task dependencies. Neither depicts a product UI.                                                      |
| C: Custom paths                    | Both HTML files live in `design/specs/`. The plan in `delivery/plans/` links `../../design/specs/topic-plan-show-me.html`. Contextual and companion links resolve inside the temporary root. Each document has one companion section. |
| D: Stages and revisions            | Walkthrough preserves spec-only and plan-only limits and refreshes revised explanations before review. No approved spec is rewritten to add a plan visual. Existing gate tests pass.                                                  |
| E: HTML fallback                   | A rejected network-dependent HTML attempt becomes an inline text tree. The replacement records the reason and has no HTML link. All-format failure requires guidance, not prose-only success.                                         |
| F: Missing prerequisites and links | A deliberately absent companion is detected. The wrapper requires both skill and license and prohibits download substitution. Installer/update tests exercise missing resources and protection.                                       |
| G: Publication failure             | Read-only walkthrough preserves local companions and rejects success after failed publication. Existing rejected-push, branch-lock, and conflicting-branch tests pass. No real host mutation is necessary.                            |

Scenario D's stage/revision decisions and scenarios F/G's instruction responses
are walkthrough evidence. They do not prove automatic runtime enforcement. The
kernel still checks its existing primary-document and publication facts.

### Offline HTML inspection

The temporary concept map and task-order HTML opened through direct `file:` URLs
in installed Chromium at widths 390 and 1440. CDP disabled network access before
reload. Both files showed their issue number, title, and owning document name.
No horizontal overflow, HTTP request, or JavaScript exception occurred. The
implementer inspected desktop and mobile screenshots. The examples are static,
so no interactive keyboard control needs verification.

The generated HTML identities are:

- Concept map:
  `4120d4a7e8cd0460dbb0abba08fe7d3c57cc38841beef276a90f58ab10ec5242`.
- Task order:
  `ed0259d68f479516edb12822f155b950eafaff8d387eb20425347ab45938a75a`.

These temporary examples do not backfill the approved documents or become
product UI artifacts.

## Final integration

- `npm run check:types`: passed.
- Final `npm test`: 1225 passed, zero failures.
- Final `npm run lint`: passed.
- Final `node scripts/smoke-packed-artifact.mjs`: passed.
- Direct integrity verification: every managed resource matches its manifest
  hash. Changed source/installed pairs match, including the authorized cleanup
  synchronization. Upstream bytes remain unchanged after the commit hook.
- Focused installation, update, discovery, naming, gate, and publication suites:
  50 passed, zero failures.
- The approved specification and plan retain their original file hashes.
- Source and installed planning instructions use the same show-me contract.
- No dependency manifest or lockfile changes are part of the delivery.
- Frontend review does not apply. This delivery changes documentation and skill
  distribution, not browser-visible product behavior. The temporary HTML checks
  verify document portability only.

## Rulings

### Existing generated cleanup drift

The standard updater also refreshed
`.patchmill/skills/patchmill-cleanup/SKILL.md` and its existing manifest hash.
The base already contained a stale installed copy. The cleanup source remains
byte-identical to base `7dbac5292d49753be55e73189b66bfa1ba548192`. The new
installed copy exactly matches that committed source.

The supervisor independently verified these facts and authorized this narrow
exception to the unrelated-installed-files constraint. This preserves standard
updater output and pack coherence. It does not change cleanup source behavior.
The cost if wrong is unrelated generated diff noise, not a new cleanup policy.

## Independent review

The canonical fresh-context `reviewer` used `openai-codex/gpt-6.1-sol:xhigh` on
`7dbac5292d49753be55e73189b66bfa1ba548192..d36dd27a9177561dc95ab31f69e683a32ceaeeb5`.
It found no Critical, Important, or Minor findings. No fix pass was necessary.
The reviewer independently inspected source, tests, immutable upstream bytes,
manifest hashes, generated parity, and custom links. It independently ran type
checks and lint. It inspected recorded test/smoke logs and all four screenshots.
It did not rerun the test suite, packed install, or browser measurements.

The implementer ruled on every declined behavior:

- Hosting, image previews, and uploads remain excluded by the maintainer's
  decision. Cost if wrong: reviewers need to download HTML rather than view a
  hosted page.
- Approved-document backfill remains excluded. Cost if wrong: older documents
  have no retrospective visualization until an authorized revision.
- Product frontend review remains inapplicable to document-only examples. Cost
  if wrong: document styling receives portability checks, not product design
  review.
- General updater hardening stays outside this registration change. Cost if
  wrong: pre-existing updater limitations remain unchanged.
- Universal model reliability is not claimed. Cost if wrong: future planners can
  need guidance despite the tested distribution and explicit instructions.

Deferred Minor findings: none.

## Limits

Automated distribution checks and the direct scenarios do not prove that a model
always obeys planning instructions. Publication and stage requirements remain
skill-owned except for the kernel's existing checks. No npm dependency changed.
The install reported existing dependency audit advisories, which this delivery
does not alter.
