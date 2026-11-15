# Console run status verification

Issue: #367. Implementation reviewed at `d2d2931`.

## Validation

- Baseline `npm test`: 1240 tests passed.
- Final `npm test`: 1257 tests passed, including type checks.
- `npm run lint`: passed format, TypeScript lint, and Markdown lint.
- `npm run build`: passed.
- The new tests failed before implementation, then passed. They cover title
  propagation, all run states, terminal-safe title cleaning, title-first
  shortening, wide graphemes, footer errors, resize, settlement, and shutdown.
- A fresh canonical `reviewer` checked the whole branch with
  `openai-codex/gpt-6.1-sol` at `xhigh`. No blocking findings remained.
- No dependencies changed. A Nix build was not required.

## Manual footer check

Synthetic run snapshots passed through the real console extension and controller
into the installed Pi `FooterComponent`. The UI adapter recorded statuses, and
the real footer rendered them. No host calls or model turns ran.

At 80 columns, planning displayed:

```text
#142 Show issue and step in status bar  ·  01 planning
```

After an implementation snapshot and a resize event to 40 columns:

```text
#142 Show issue a…  ·  02 implementation
```

The status line measured 40 columns. The real footer preserved the separator
spacing and the full phase label. After the run settled, the footer rendered
only its two built-in lines. Shutdown left no Patchmill status.

A live interactive issue run was not started. The current run holds the issue
lock, and another live run would mutate host state. A maintainer can still check
the final result in a live terminal. This synthetic check does not prove all
live terminal behavior.

## Rulings and residual risks

- Replace the live CLI check with the synthetic real-footer check to avoid
  issue-lock conflicts and host mutations. Cost if wrong: live integration
  remains unverified until a maintainer checks it.
- Keep the approved shared-footer limitation. Another extension's temporary
  slash-command status can make Pi truncate the end of the state.
- Keep Pi's truncation fallback when the terminal cannot fit even the issue
  number and state. Cost if wrong: the state clips at these widths.
- Do not poll for title edits during a phase or wait. Use only the existing
  issue fetches. Cost if wrong: edited titles stay stale until the next fetch
  and emission.
- Keep the canonical title filter. It removes executable control bytes, but
  printable C1 CSI parameters such as `31m` can remain visible.

## Deferred minor finding

M1: With a two-column title budget and a wide-leading grapheme, the title can
become a lone `…`. The full state remains visible. A follow-up can drop the
title when no grapheme fits, with CJK and emoji boundary tests.

## Frontend review

Not applicable. The delivery changes plain terminal text, not browser-visible
layout, styling, or interaction. No browser screenshots apply.

## Human Reviewer Callouts (Non-Blocking)

- (none)
