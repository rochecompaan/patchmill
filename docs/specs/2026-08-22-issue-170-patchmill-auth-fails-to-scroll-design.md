# Issue #170 Auth Provider Selector Scrolling Design

**Date:** 2026-08-22 **Status:** Proposed; implementation pending

## Problem

The `patchmill auth` API-key provider selector can contain roughly 39 providers,
but it always renders the first eight. Keyboard navigation still advances
`selectedIndex` across the full filtered list, so the count can report `14/39`
while providers 1–8 remain on screen and no row carries the selection marker.

The behavior is deterministic and terminal-independent. In
`pi-auth-provider-state.ts`, `moveProviderSelection()` correctly updates the
selection and wraps within `state.filtered`, while `visibleProviderRows()`
always uses `state.filtered.slice(0, 8)` and compares that window's local row
indexes with the selection's full-list index.

## Goals

- Keep the selected provider visible while moving up or down through a long
  provider list.
- Preserve wraparound navigation and keep the wrapped selection visible.
- Apply the same behavior to filtered search results.
- Preserve the eight-row maximum, selected/filtered count, provider selection,
  and row labels.
- Cover navigation beyond the first eight providers, including item 14 of 39,
  with an automated regression test.

## Non-goals

- Change provider ordering, filtering, labels, credential status, or selection
  semantics.
- Change the auth flow, terminal integration, keyboard bindings, or TUI layout.
- Add mouse scrolling, page-up/page-down controls, or configurable window size.
- Refactor the model selector or share a new generic selector abstraction.

## Decision

Derive the provider window from `selectedIndex` whenever rows are rendered,
following the existing model selector's stateless visible-window pattern. For an
eight-row window, calculate the start index as the selected index minus seven,
clamped between zero and the last valid eight-row start. Render at most eight
filtered providers from that start and mark the row whose full-list index equals
`selectedIndex`.

This produces the following behavior:

- Initial selection: items 1–8 are visible and item 1 is selected.
- Moving through item 8 leaves items 1–8 visible.
- Moving to item 9 renders items 2–9.
- Moving to item 14 of 39 renders items 7–14 with item 14 selected and the count
  unchanged at `(14/39)`.
- Moving up from item 1 wraps to item 39 and renders items 32–39.
- Moving down from item 39 wraps to item 1 and restores items 1–8.
- A search resets selection to the first filtered result, so the filtered window
  starts at its first row; subsequent movement follows the same window rule.
- Lists of eight or fewer providers render exactly as they do today.

No persistent scroll offset is needed. The selected index remains the sole
navigation state, so movement, wrapping, and search cannot leave a separate
viewport value stale.

## Affected Components

### Provider selector state

Update `src/cli/commands/init/pi-auth-provider-state.ts` so
`visibleProviderRows()`:

- calculates a clamped start index from `state.selectedIndex` and the existing
  `MAX_VISIBLE_PROVIDER_ROWS` limit;
- slices `state.filtered` from that start;
- marks selection using each row's full filtered-list index rather than its
  window-local index.

`moveProviderSelection()`, `searchProviderSelector()`, `selectedProvider()`, and
`formatProviderSelectorCount()` retain their current behavior.

### Provider selector TUI

No structural change is expected in `src/cli/commands/init/pi-auth-selector.ts`.
Its input handler already updates state and rerenders after every arrow key or
search change, and its renderer already consumes `visibleProviderRows()`.

### Automated coverage

Extend `src/cli/commands/init/pi-auth-provider-state.test.ts` with behavioral
coverage for long-list navigation. Add interactive coverage in
`src/cli/commands/init/pi-auth-selector.test.ts` only if needed to prove the TUI
continues to rerender the rows returned by the pure state helper; do not
duplicate all window calculations at both levels.

## Alternatives Considered

### Store a viewport start in selector state

A persistent offset could keep the window stationary until the selection crosses
an edge, but every movement, wrap, and search transition would then need to
synchronize two indexes. That extra state is unnecessary for the reported
behavior and differs from the existing model selector pattern.

### Calculate scrolling inside the TUI component

This would couple navigation presentation to `ProviderSelectorComponent` and
make the pure state helper continue returning incorrect rows. Keeping the
calculation in the state module preserves the current testable boundary.

### Render fixed eight-item pages

Paging by groups of eight would make the selected row visible, but crossing a
page boundary would replace the entire list instead of advancing a following
window. It is a larger visual jump and does not match the model selector's
established behavior.

## Error Handling and Compatibility

The change introduces no new I/O or failure modes. Empty filtered results
continue to render `No matching providers`; short lists and the count-display
rule remain unchanged. Existing provider choice objects and selector state stay
source-compatible because no fields are added.

## Verification Strategy

This is a user-visible production regression with reusable pure state logic, so
it passes Patchmill's Testing Value Gate and warrants automated coverage.

Add state-level tests that prove:

- after moving to item 14 in a 39-provider list, exactly eight rows (items 7–14)
  render, item 14 is marked selected, and the count is `(14/39)`;
- moving beyond the first window in both directions keeps the selected row
  visible;
- wrapping first-to-last and last-to-first renders the corresponding end or
  start window;
- searching a long list resets and then follows a window based on the filtered
  results;
- lists of eight or fewer and empty search results preserve existing behavior.

Run focused tests first, followed by repository checks:

```text
node --test src/cli/commands/init/pi-auth-provider-state.test.ts src/cli/commands/init/pi-auth-selector.test.ts
npm test
npm run lint
npm run build
```

No npm dependency changes are expected, so the repository's dependency-change
policy does not require a Nix build.
