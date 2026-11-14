# Issue #173: domain-aware planning verification

## Scope and environment

This delivery installs the two pinned Matt Pocock skills, adds
specification-time analysis and fresh Plan review, and migrates Patchmill's
glossary filename. Frontend design and review do not apply. No visible UI
behavior changes.

The dependency is `mattpocock-skills` version `1.3.2`, revision
`5863806dd4e15c63174bee4e7515a4256792ecfa`. Both npm lockfiles resolve the exact
archive and the same SHA-512 integrity. Selected upstream trees and copied root
MIT licenses remain byte-identical.

## Automated and packaging evidence

- Baseline `npm ci` and `npm test`: 1069 tests passed before source edits.
- Behavioral RED: missing installed design trees, source metadata, and discovery
  assertions failed before the installer change.
- Focused installer, guarded-update, discovery, and Superpowers-upgrade suite:
  21 tests passed after implementation.
- Full Task 1 `npm test`: 1074 tests passed, with no failures or skips.
- `npm run lint`: formatting, TypeScript lint, and Markdown lint passed.
- Packed npm smoke: a clean isolated installation invoked `init`, then compared
  complete upstream trees, copied licenses, manifest hashes, and source version.
  It resolved the dependency from the installed application's package location.
- `scripts/update-npm-deps-hash.sh`: completed a successful Nix build, including
  its full test and install checks. The dependency hash is
  `sha256-TgbdsiXOFCooOoPGTzHRxCd8KEHKq5lyhGCUflw7Xp8=`.
- Normal `skills update` regenerated the pack. A repeated update reported no
  changes. All 80 managed-file hashes matched their installed bytes.

The real-pack tests cover nested source copying, isolated package resolution,
read-only source permissions, writable copies, repair, unchanged mtimes, legacy
manifest upgrades, edit protection, and worker skill resolution. The Superpowers
updater retains its strict complete-pack validation and rollback coverage with
the additional source and license resources.

## Executed policy scenarios

Five successful fresh model sessions consumed installed instruction files in a
disposable stock-reservations fixture. Every session used the canonical
read-only `reviewer`, `openai-codex/gpt-6.1-sol`, and high thinking. These are
instruction-consumer exercises, not a real Issue run or implementation review
gates. The runtime persisted each response as its sole output artifact. No
session published, changed host state, installed packages, or started agents.

The fixture exposed `reserve(sku, quantity, stock)` over a caller-supplied Map.
It decremented Available stock and rejected unavailable quantities. Two tests
observed behavior through that interface. Its glossary defined Reservation and
rejected the synonym Hold. The requested change was 15-minute expiry with
injected current time. A deliberately poor plan added forwarding layers, a
speculative eight-method adapter interface, internally constructed adapters, and
call-forwarding tests.

| Case                               | Session identity                       | Observed result                                                                                                                                                                                                                                  |
| ---------------------------------- | -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Architectural specification        | `87e0f9ad-5598-4155-b7dc-3c3c50e4d26a` | Read both upstream skills, `DEEPENING.md`, glossary, source, and tests. Produced ownership, caller obligations, hidden state, dependency entry, seams, locality/leverage, and observable interface tests with source citations.                  |
| Narrow spec-only envelope          | `1e7a9f5b-9eed-4f23-b891-9308a7975640` | Recorded the resolved Expired reservation definition, exact glossary destination, artifact-limit reason, and implementation as the next authorized stage. Explicitly stated that the glossary did not change.                                    |
| Independent shallow-design review  | `ccf3ca43-c36b-4fc3-8680-410d9f93d3c1` | Independently read source/tests and reported three concrete blockers: missing lifetime ownership/data, pass-through/speculative adapters, and tests that excluded observable stock outcomes. Applied all three required architecture principles. |
| Unattended missing reviewer        | `bb9695bb-67ac-482c-a245-52b0ffef7a2c` | Returned `needs-input`: no subagent capability could obtain the required fresh reviewer. Did not substitute self-review or claim completion.                                                                                                     |
| Local-interactive missing reviewer | `f2abf456-4468-455e-a84f-d84e33555915` | Asked for a reviewer-capable session or independent read-only review, then recorded a wait/incomplete/no-publication disposition. No actual maintainer dialog was invoked.                                                                       |

The shallow review cited `src/reservations.ts:1–6` and the existing tests. Its
deletion test found that removing the forwarding modules removed indirection
without redistributing domain complexity to callers. Its adapter analysis found
no actual variation beyond in-process memory. Its test-surface finding explained
how forwarding assertions missed early, missing, or repeated stock restoration.

The narrow-envelope session retained this resolved definition: “An Expired
reservation is a Reservation whose 15-minute commitment ended without checkout.”
The original sandbox glossary remained unchanged.

### Reproduction and artifact identity

The disposable fixture was `/tmp/patchmill-173-scenarios.x6kPWR`. Sessions read
this delivery's installed `.patchmill/skills` pack. Their explicit envelopes
overrode publication and restricted direct writes. The missing-reviewer cases
used a read-only role with no subagent tool. Shared reviewer definitions and
agent settings were not changed.

| Output                   | SHA-256                                                            |
| ------------------------ | ------------------------------------------------------------------ |
| `architecture-design.md` | `128d1dc0ad53703f8dede6cabe548a35751db6efb826c394949d49490b16b54f` |
| `narrow-design.md`       | `c1cb669ded59a279c69a1901c9621805c0ec80969e646188562ddb1176a348f0` |
| `shallow-review.md`      | `e594c01cd86e5e38bb0bee4f93125b1039b70c0a774cbdfd647b25cf50754c92` |
| `missing-unattended.md`  | `4a970e400b3eb1f8957cc9c21c84c7bfd2b2df09d9d9a6de92c57d60f872b3fd` |
| `missing-interactive.md` | `eec0fc62c26e22bb9cb7b2d22e4c0f90a17d6599ca184c9057902cedba7fb0df` |

One earlier architecture session timed out after 300 seconds without an output
artifact. Three concurrent tool requests were rejected before launch. The
supervisor authorized one serial retry of each unfinished case through the same
subagent protocol. All four authorized serial runs completed. No alternate CLI
execution mode or hidden retry was used.

## Direct inspection, not executed model scenarios

The remaining cases received source walkthroughs:

- A glossary map selects relevant contexts and ADRs. No map or ADR exists in
  this single-context Patchmill repository, and none was created.
- Ordinary domain companions follow their specification's authorized path. A
  narrower envelope records a deferred resolution instead.
- Non-architectural work records non-applicability without invented documents.
- Spec-only stages do not create a plan. Every plan-writing stage and the local
  helper inherit fresh review, including ungated implementation-stage planning.
- Accepted review blockers require correction and one fresh scoped confirmation.
  Later material edits invalidate review readiness.
- Reviewer readiness does not change human gates. The local helper retains
  non-publication authority, distinct from Interactive Issue run submission.
- Legacy `CONTEXT` files remain inputs until an authorized rename.

The glossary migration preserved every pre-existing byte after removal of the
single added Plan review definition. No historical specification, plan, or
changelog was rewritten. No competing root glossary or ceremonial ADR remains.

## Limits

These bounded sessions prove observed instruction consumption, not universal
model compliance. Their fixture has no Git history or real issue host. The
architecture and narrow-envelope outputs were returned for runtime persistence
rather than direct file editing. No real publication was exercised. The existing
runtime suites cover launch, provisioning, and interactive contracts separately.

## Final delivered-state checks

The following checks ran after the planning policy and glossary changes:

| Command or probe                                                                               | Result                                                                                                                                        |
| ---------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm test`                                                                                     | 1074 passed, zero failures, skips, or cancellations.                                                                                          |
| `npm run lint`                                                                                 | Formatting, TypeScript lint, and Markdown lint passed. Markdown covered 278 files.                                                            |
| `npm run build`                                                                                | TypeScript application build passed.                                                                                                          |
| Targeted Run-once, provisioning, supervisor, interactive, worker-launcher, and discovery tests | 89 passed with zero failures.                                                                                                                 |
| `npm pack --dry-run --json`                                                                    | Verified the wrapper, review prompt, shrinkwrap, and provenance in the package inventory.                                                     |
| `node scripts/smoke-packed-artifact.mjs`                                                       | Clean npm installation and actual `init` installed both complete design trees, licenses, hashes, and version `1.3.2`.                         |
| `nix build --print-build-logs .#patchmill`                                                     | Passed the build, full test phase, and installed-command checks.                                                                              |
| Nix-installed `installSkills` probe                                                            | Verified all ten design resource/license files, all managed metadata, and unchanged repeat installation. The new review prompt was installed. |
| Final dependency/manifest audit and `skills update`                                            | Both lock references and integrity values agree. All 80 managed hashes match. Update reports no changes.                                      |

The npm smoke resolved the dependency under its isolated application's
`node_modules/mattpocock-skills`, without using the checkout's dependency path.
The Nix probe imported the packaged TypeScript installation module and supplied
these actual package locations:

- Application:
  `/nix/store/fmcl0chlxqz3la3x3ps5xyxvfbg4vjxz-patchmill-1.0.0/share/patchmill`.
- Dependency:
  `/nix/store/fmcl0chlxqz3la3x3ps5xyxvfbg4vjxz-patchmill-1.0.0/lib/node_modules/patchmill/node_modules/mattpocock-skills`.

The probe used a temporary destination and compared copied bytes, license bytes,
hashes, and the actual source version. It removed its temporary output. These
store paths identify the tested policy/source state before this results section
was appended. No unavailable build or required model scenario remains.

Full local command logs remain in this implementation plan's ignored execution
workspace. The committed record preserves results, scenario identities, artifact
hashes, scope, and limitations without including credentials or raw session
transcripts.
