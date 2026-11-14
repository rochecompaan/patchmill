# Real board verification

## Scope

This delivery replaces the sample-only default with a read-only repository
board. The maintainer selected the current workflow model. Retired labels and
run files have no implicit workflow meaning. Real threads and chat remain
outside this slice.

Frontend review applies. Live markers, synchronization text, document
navigation, and the unavailable-thread view change browser-visible behavior. The
existing fonts, palette, themes, board scrolling, and sample controls remain.

## Automated validation

| Command                                                                            | Result                                                                             |
| ---------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `npm ci`                                                                           | Installed the unchanged shrinkwrap in the issue worktree.                          |
| Baseline `npm test`                                                                | 1,109 passed, zero failed.                                                         |
| Implementation `npm test`                                                          | 1,140 passed, zero failed.                                                         |
| `npm run check:types`                                                              | Passed.                                                                            |
| `npm run lint`                                                                     | Passed, including formatting, ESLint, and Markdownlint.                            |
| `CHROMIUM=/home/roche/.nix-profile/bin/chromium npm run test:web`                  | Existing sample browser regressions passed.                                        |
| `CHROMIUM=/home/roche/.nix-profile/bin/chromium node scripts/check-real-board.mjs` | Real-mode fixture browser checks passed.                                           |
| `npm run build`                                                                    | Passed.                                                                            |
| `node scripts/smoke-serve.mjs -- node "$PWD/dist/bin/patchmill.js"`                | Unrelated-directory sample smoke passed.                                           |
| `npm pack --dry-run --json`                                                        | Passed. The package includes the new source, compiled modules, and browser assets. |

Tests cover column precedence, custom and local roles, process-lock ownership,
current-format progress/results, atomic replacement, PR identity, document URLs,
cache concurrency and errors, immutable API snapshots, source selection, and the
browser freshness clock. Browser checks exercise hostile titles, unsafe links,
Live in review and Blocked, disabled real composers, keyboard focus, and layout.

The new browser assertions failed before their implementation. The short-thread
layout check also exposed a composer above the viewport bottom. A scoped
live-page flex layout corrected it without changing sample layouts. A separate
browser assertion prevents an ownership-only observation from claiming that an
agent is idle.

The installed sample smoke initially failed because its unrelated directory had
no config. The smoke now requests `--sample`, as the new CLI contract requires.

## Repository comparison

The feature branch's actual CLI served data with
`/home/roche/projects/patchmill` as its current directory. The browser used the
printed authenticated link. The capture used a temporary listener and stopped
only that web server afterward.

At `2026-11-14T16:52:23.189Z`, `gh issue list` returned 36 open issues. The
board showed 31 issues with matching numbers, titles, and labels. It excluded
the five unsuitable issues: #191, #229, #230, #293, and #300.

The board showed six Triage cards, 24 Ready cards, and one Planning card. The
other columns were empty. Issue #302 showed Live. A separate read-only probe
confirmed its held issue lock. Its current process predates the new progress
writer, so its precise phase remains unknown. The issue page says “Run active,”
not “Agent idle.” No current `progress.json` exists for that active attempt.
This is the documented older-process fallback, not a claim that historical
admission records are current.

The retired `blocked` labels remain visible, including on #302. They do not
select the Blocked column. Native dependency blockers also remain outside this
board projection, as the approved specification states.

The repository walkthrough and fixture walkthrough each covered 1440px and 390px
widths in dark and light themes. Both reported zero runtime errors, mutation
requests, and foreign-resource requests. No production Issue run changed for
this capture. Fixture-only states are identified in their filenames and
repository header.

## Committed visual evidence

Representative repository views:

- [Desktop board, dark](../screenshots/real-board-repository-1440-dark.png)
- [Desktop board, light](../screenshots/real-board-repository-1440-light.png)
- [Mobile board, dark](../screenshots/real-board-repository-390-dark.png)
- [Mobile board, light](../screenshots/real-board-repository-390-light.png)
- [Desktop placeholder, dark](../screenshots/real-issue-placeholder-repository-1440-dark.png)
- [Desktop placeholder, light](../screenshots/real-issue-placeholder-repository-1440-light.png)
- [Mobile placeholder, dark](../screenshots/real-issue-placeholder-repository-390-dark.png)
- [Mobile placeholder, light](../screenshots/real-issue-placeholder-repository-390-light.png)

Fixture references cover states absent in the live repository:

- [Live review card](../screenshots/real-board-fixture-1440-dark.png)
- [Live blocked card, dark](../screenshots/real-board-fixture-blocked-1440-dark.png)
- [Live blocked card, light](../screenshots/real-board-fixture-blocked-1440-light.png)
- [Mobile blocked card](../screenshots/real-board-fixture-blocked-390-light.png)
- [Disabled real composer](../screenshots/real-issue-placeholder-fixture-390-light.png)

The complete fixture set also includes both themes at both widths. Filenames use
stable semantic names, as the visual-evidence skill requires, rather than the
issue-number prefix suggested by the plan.

## Boundaries and residual risks

- Host data can be up to one cache period old. Failed refreshes retain the last
  successful timestamp and data.
- An already-active older process supplies Live through its lock, but cannot
  supply a precise phase without a progress record. New attempts write that
  record.
- The server and runs must share the same repository directory and host.
- No npm dependency files changed, so the dependency-change Nix requirement did
  not apply. npm reported 19 existing dependency vulnerabilities during
  installation. This delivery does not upgrade those dependencies.
- This record captures implementation validation. The PR body records the fresh
  code review, frontend review, their dispositions, and exact-head host checks.
