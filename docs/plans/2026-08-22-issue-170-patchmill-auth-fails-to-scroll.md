# Auth Provider Selector Scrolling Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep the selected API-key or subscription provider visible while
keyboard navigation moves through long or filtered provider lists.

**Architecture:** Keep `selectedIndex` as the selector's only navigation state
and derive an eight-row window inside `visibleProviderRows()` on every render.
Follow the existing model selector's stateless clamped-window pattern, but mark
selection with each row's full filtered-list index so wrapping and search cannot
leave a stale viewport.

**Tech Stack:** Node.js 22.19+ ESM TypeScript, `node:test`,
`node:assert/strict`, and `@earendil-works/pi-tui`.

**Spec:**
`docs/specs/2026-08-22-issue-170-patchmill-auth-fails-to-scroll-design.md`
(issue #170)

## Global Constraints

- Keep `MAX_VISIBLE_PROVIDER_ROWS` at eight and render no more than eight
  provider rows.
- Derive the window start from `selectedIndex`; do not add persistent viewport
  state to `ProviderSelectorState`.
- Keep up/down wrapping, search reset behavior, provider ordering, filtering,
  labels, credential status, selected/filtered count, and provider selection
  semantics unchanged.
- Do not change the auth flow, terminal integration, keyboard bindings, TUI
  layout, or `src/cli/commands/init/pi-auth-selector.ts` unless a focused
  integration failure proves the existing rerender path insufficient.
- Do not add mouse scrolling, page navigation, configurable window size, or a
  shared selector abstraction.
- Keep the change in the existing focused state module. At roughly 205 lines,
  `pi-auth-provider-state.ts` remains cohesive, and this small pure calculation
  does not justify a module split.
- The Testing Value Gate approves state-level regression tests: they exercise a
  user-visible production bug, fail when the selected-index window regresses,
  and protect reusable navigation, wrapping, and filtered-search behavior. Avoid
  duplicating every window assertion in TUI-level tests because
  `ProviderSelectorComponent` already rerenders `visibleProviderRows()` after
  arrow and search input.
- No npm dependency files should change. Per `AGENTS.md`, a Nix build is not
  required unless `package.json`, `package-lock.json`, or `npm-shrinkwrap.json`
  changes unexpectedly.

---

### Task 1: Fix the provider window with state-level regression coverage

**Files:**

- Modify: `src/cli/commands/init/pi-auth-provider-state.test.ts:1-11,217-233`
- Modify: `src/cli/commands/init/pi-auth-provider-state.ts:186-195`
- Verify unchanged integration:
  `src/cli/commands/init/pi-auth-selector.ts:132-158`

**Interfaces:**

- Consumes: existing `ProviderSelectorState`, `moveProviderSelection()`,
  `searchProviderSelector()`, and `MAX_VISIBLE_PROVIDER_ROWS` behavior.
- Produces: unchanged
  `visibleProviderRows(state: ProviderSelectorState): VisibleProviderRow[]`
  signature; rows are a clamped slice of `state.filtered` containing
  `state.selectedIndex`, with exactly one matching row selected when results
  exist.

- [ ] **Step 1: Add a reusable long-list fixture to the state tests**

Add `formatProviderSelectorCount` and `moveProviderSelection` to the existing
import from `pi-auth-provider-state.ts`:

```ts
import {
  AUTH_METHOD_CHOICES,
  authProviderChoiceRows,
  createAuthProviderChoices,
  createProviderSelectorState,
  formatProviderSelectorCount,
  moveProviderSelection,
  searchProviderSelector,
  visibleProviderRows,
  type AuthProviderChoice,
} from "./pi-auth-provider-state.ts";
```

Add this helper immediately after `labels()`:

```ts
function providerChoices(
  count: number,
  idPrefix = "provider",
): AuthProviderChoice[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `${idPrefix}-${index + 1}`,
    name: `Provider ${index + 1}`,
    mode: "api_key" as const,
    label: `Provider ${index + 1} • unconfigured`,
    statusLabel: "• unconfigured",
  }));
}
```

Use this fixture only to make hand-checked expected provider IDs concise; keep
expected windows as literal arrays rather than rebuilding them with the
production calculation.

- [ ] **Step 2: Add the reported item-14 and wraparound regressions**

Append these tests after the existing `visibleProviderRows` test:

```ts
test("visibleProviderRows keeps item 14 of 39 in view", () => {
  const state = moveProviderSelection(
    createProviderSelectorState(providerChoices(39)),
    13,
  );

  const rows = visibleProviderRows(state);

  assert.deepEqual(
    rows.map((row) => row.choice.id),
    [
      "provider-7",
      "provider-8",
      "provider-9",
      "provider-10",
      "provider-11",
      "provider-12",
      "provider-13",
      "provider-14",
    ],
  );
  assert.equal(rows.length, 8);
  assert.equal(rows.at(-1)?.selected, true);
  assert.equal(rows.filter((row) => row.selected).length, 1);
  assert.equal(formatProviderSelectorCount(state), "(14/39)");
});

test("visibleProviderRows follows selection across both wrap boundaries", () => {
  let state = moveProviderSelection(
    createProviderSelectorState(providerChoices(39)),
    -1,
  );

  let rows = visibleProviderRows(state);
  assert.deepEqual(
    rows.map((row) => row.choice.id),
    [
      "provider-32",
      "provider-33",
      "provider-34",
      "provider-35",
      "provider-36",
      "provider-37",
      "provider-38",
      "provider-39",
    ],
  );
  assert.equal(rows.at(-1)?.selected, true);

  state = moveProviderSelection(state, 1);
  rows = visibleProviderRows(state);
  assert.deepEqual(
    rows.map((row) => row.choice.id),
    [
      "provider-1",
      "provider-2",
      "provider-3",
      "provider-4",
      "provider-5",
      "provider-6",
      "provider-7",
      "provider-8",
    ],
  );
  assert.equal(rows[0]?.selected, true);
});
```

These literal windows catch the current fixed-first-eight implementation and a
future off-by-one error at either wrap boundary.

- [ ] **Step 3: Add filtered, short-list, and empty-result coverage**

Append these tests after the wraparound test:

```ts
test("visibleProviderRows follows selection within filtered results", () => {
  const choices = [
    ...providerChoices(12, "matching"),
    ...providerChoices(4, "other"),
  ];
  let state = searchProviderSelector(
    createProviderSelectorState(choices),
    "matching",
  );

  assert.equal(state.selectedIndex, 0);
  assert.equal(visibleProviderRows(state)[0]?.choice.id, "matching-1");

  state = moveProviderSelection(state, 8);
  const rows = visibleProviderRows(state);
  assert.deepEqual(
    rows.map((row) => row.choice.id),
    [
      "matching-2",
      "matching-3",
      "matching-4",
      "matching-5",
      "matching-6",
      "matching-7",
      "matching-8",
      "matching-9",
    ],
  );
  assert.equal(rows.at(-1)?.selected, true);
  assert.equal(formatProviderSelectorCount(state), "(9/12)");
});

test("visibleProviderRows preserves lists of eight or fewer", () => {
  const state = createProviderSelectorState(providerChoices(8));
  const rows = visibleProviderRows(state);

  assert.deepEqual(
    rows.map((row) => row.choice.id),
    [
      "provider-1",
      "provider-2",
      "provider-3",
      "provider-4",
      "provider-5",
      "provider-6",
      "provider-7",
      "provider-8",
    ],
  );
  assert.equal(rows[0]?.selected, true);
  assert.equal(formatProviderSelectorCount(state), "");
});

test("visibleProviderRows preserves empty search results", () => {
  const state = searchProviderSelector(
    createProviderSelectorState(providerChoices(8)),
    "not-present",
  );

  assert.deepEqual(visibleProviderRows(state), []);
  assert.equal(formatProviderSelectorCount(state), "");
});
```

The first test catches applying the window against `choices` instead of the
filtered result set. The compatibility tests protect the unchanged short-list
and empty-result branches while the window calculation changes.

- [ ] **Step 4: Run the state tests and verify the regression is red**

Run:

```bash
node --test src/cli/commands/init/pi-auth-provider-state.test.ts
```

Expected: FAIL only in the three new long-list/window tests. The current code
returns providers 1-8 for item 14, for the wrapped item 39, and after moving to
the ninth filtered result. Existing tests plus the new short-list and
empty-result compatibility tests remain green. Do not change production code
until these failures are observed and confirmed to be caused by the fixed
`slice(0, 8)` window.

- [ ] **Step 5: Implement the minimal stateless clamped window**

Replace `visibleProviderRows()` in
`src/cli/commands/init/pi-auth-provider-state.ts` with:

```ts
export function visibleProviderRows(
  state: ProviderSelectorState,
): VisibleProviderRow[] {
  const start = Math.min(
    Math.max(0, state.selectedIndex - MAX_VISIBLE_PROVIDER_ROWS + 1),
    Math.max(0, state.filtered.length - MAX_VISIBLE_PROVIDER_ROWS),
  );
  return state.filtered
    .slice(start, start + MAX_VISIBLE_PROVIDER_ROWS)
    .map((choice, index) => ({
      choice,
      selected: start + index === state.selectedIndex,
    }));
}
```

Do not change `ProviderSelectorState` or movement/search functions. The start
calculation keeps items 1-8 stable through selection eight, advances one row at
a time from selection nine onward, clamps to the final eight providers, and
naturally returns an empty slice for no matches.

- [ ] **Step 6: Run the state and existing TUI integration tests**

Run:

```bash
node --test \
  src/cli/commands/init/pi-auth-provider-state.test.ts \
  src/cli/commands/init/pi-auth-selector.test.ts
```

Expected: PASS. This proves the pure state regression and confirms the existing
interactive selector still filters, selects, displays one long-list count, and
consumes the corrected row helper without a TUI source change.

- [ ] **Step 7: Check formatting and task scope**

Run:

```bash
npx prettier --check \
  src/cli/commands/init/pi-auth-provider-state.ts \
  src/cli/commands/init/pi-auth-provider-state.test.ts
git diff --check
git status --short
```

Expected: formatting and whitespace checks pass. Status lists only
`pi-auth-provider-state.ts` and `pi-auth-provider-state.test.ts`; neither
`pi-auth-selector.ts` nor dependency metadata changes.

- [ ] **Step 8: Commit the tested fix**

```bash
git add \
  src/cli/commands/init/pi-auth-provider-state.ts \
  src/cli/commands/init/pi-auth-provider-state.test.ts
git commit -m "fix(auth): keep selected provider visible"
```

### Task 2: Run full selector and repository verification

**Files:** none modified; verification only.

**Interfaces:**

- Consumes: Task 1's corrected `visibleProviderRows()` behavior and regression
  coverage.
- Produces: a clean, fully validated implementation commit ready for review and
  landing, with evidence that dependency metadata stayed unchanged.

- [ ] **Step 1: Rerun the focused auth selector tests from the approved spec**

```bash
node --test \
  src/cli/commands/init/pi-auth-provider-state.test.ts \
  src/cli/commands/init/pi-auth-selector.test.ts
```

Expected: PASS with the reported item-14 case, wraparound, filtered navigation,
short-list compatibility, empty results, and existing interactive selector
behavior all green.

- [ ] **Step 2: Run the complete test suite**

```bash
npm test
```

Expected: PASS with no test failures, uncaught errors, or warnings introduced by
the selector change.

- [ ] **Step 3: Run repository lint and formatting checks**

```bash
npm run lint
```

Expected: PASS for Prettier, ESLint, and Markdownlint checks.

- [ ] **Step 4: Build the distributable TypeScript output**

```bash
npm run build
```

Expected: PASS with a clean TypeScript compile into `dist/`.

- [ ] **Step 5: Confirm the committed scope and Nix-build decision**

```bash
git diff --exit-code HEAD^ HEAD -- \
  package.json \
  package-lock.json \
  npm-shrinkwrap.json
git status --short
```

Expected: both commands produce no output. Because Task 1 did not change any npm
dependency file, `AGENTS.md` does not require a Nix build. If any dependency
file appears, stop and investigate the unintended change rather than skipping
Nix verification.
