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

## Limits

Automated distribution checks do not prove that a model always obeys planning
instructions. Scenario evidence and final integration results follow in the
implementation record. No npm dependency changed. The install reported existing
dependency audit advisories, which this delivery does not alter.
