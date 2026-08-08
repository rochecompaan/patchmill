# Pi-tui 0.84 Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land the pi-tui 0.84.1 upgrade, migrate every Patchmill consumer of
the removed `TUI` value export, and make future Pi API removals fail before the
nightly workflow starts a Nix build.

**Architecture:** pi-tui 0.84 replaces the old inline-screen `TUI` class with
`TuiMainScreen` while keeping `TUI` as a type-only interface. Apply the exact
pin bump and all source migrations together, extend the existing dependency
contract to every pi-tui runtime value used by init or the bundled todos
extension, and pass `--skip-nix-hash` in CI so fast checks run before the
workflow updates and verifies the Nix hash.

**Tech Stack:** Node 24 ESM TypeScript (run directly via `node --test`), npm
exact pins, GitHub Actions, Nix package builds and flake checks.

**Spec:** `docs/specs/2026-08-07-pi-tui-084-migration-design.md` (issue #144)

## Global Constraints

- Pin both `@earendil-works/pi-coding-agent` and `@earendil-works/pi-tui` to
  exactly `0.84.1`.
- Apply the local bump with
  `node scripts/update-pi-deps.mjs --mode manual --target-version 0.84.1 --skip-nix-hash`.
  The outer updater failure path is not transactional; inspect
  `.tmp/pi-deps-summary.json` and `git status --short` after any failure.
- Migrate all four runtime consumers: the three init modules and
  `extensions/todos.ts`.
- Do not adopt `TuiAltScreen`, change selector UX, or add a dual-version
  compatibility factory.
- Keep existing `tui: TUI` annotations as type-only imports. Do not change
  `stopTui` signatures or exported function signatures.
- Do not add an automated test that only asserts workflow YAML content. Verify
  the workflow with formatter checks, existing updater tests, and real PR CI.
- The workflow must run its Pi compatibility contract before any Nix build.
- Because packaged Pi dependencies change, completion requires both
  `nix build .#patchmill --print-build-logs` and
  `nix flake check --accept-flake-config --print-build-logs`.
- Merge intent: squash-merge title
  `chore(deps): update Pi runtime packages to 0.84.1` (no release on merge).

---

### Task 1: Apply the Pi 0.84.1 bump, migrate all consumers, and extend the contract

The dependency bump, source migrations, contract test, and initial hash refresh
form one atomic deliverable. Neither source intermediate can run: old code asks
0.84.1 for the removed `TUI` value, while migrated constructor code asks 0.83.0
for `TuiMainScreen`.

**Files:**

- Modify: `package.json` (via updater)
- Modify: `npm-shrinkwrap.json`, `package-lock.json` (via updater)
- Modify: `nix/package.nix` (via hash helper)
- Modify: `src/cli/commands/init/pi-auth-dialog.ts`
- Modify: `src/cli/commands/init/pi-auth-selector.ts`
- Modify: `src/cli/commands/init/pi-model-selector.ts`
- Modify: `extensions/todos.ts`
- Test: `src/cli/commands/init/pi-dependency-contract.test.ts`

**Interfaces:**

- Consumes: nothing from earlier tasks.
- Produces: Pi runtime packages pinned and installed at 0.84.1; unchanged init
  function signatures; the todos extension imports `TUI` only as a type; a
  contract for all 15 pi-tui runtime values Patchmill uses; refreshed
  `npmDepsHash`.

- [ ] **Step 1: Bootstrap the issue worktree**

```bash
npm ci
```

Expected: clean install of the current 0.83.0 pins.

- [ ] **Step 2: Apply the 0.84.1 metadata bump without starting Nix**

```bash
mkdir -p .tmp
node scripts/update-pi-deps.mjs \
  --mode manual \
  --target-version 0.84.1 \
  --skip-nix-hash \
  --summary-json .tmp/pi-deps-summary.json
```

Expected output includes:

```text
Current Pi pins: @earendil-works/pi-coding-agent=0.83.0, @earendil-works/pi-tui=0.83.0
Selected Pi targets: @earendil-works/pi-coding-agent=0.84.1, @earendil-works/pi-tui=0.84.1
```

If the command fails, inspect rather than assuming rollback:

```bash
cat .tmp/pi-deps-summary.json
git status --short
```

To abandon a partial metadata update:

```bash
git restore -- package.json package-lock.json npm-shrinkwrap.json nix/package.nix
npm ci
```

- [ ] **Step 3: Verify the exact pins and reinstall**

```bash
node -e "const p=require('./package.json'); console.log(p.dependencies['@earendil-works/pi-coding-agent'], p.dependencies['@earendil-works/pi-tui'])"
npm ci
```

Expected: prints `0.84.1 0.84.1`; reinstall succeeds.

- [ ] **Step 4: Confirm the pre-migration regression**

```bash
node --test \
  src/cli/commands/init/pi-model-selector.test.ts \
  test-support/todos-extension.test.ts
```

Expected: FAIL at module load with
`SyntaxError: The requested module '@earendil-works/pi-tui' does not provide an export named 'TUI'`.
This proves both an init consumer and the bundled extension need migration.

- [ ] **Step 5: Migrate `pi-auth-dialog.ts`**

In `src/cli/commands/init/pi-auth-dialog.ts`, replace:

```ts
import {
  Container,
  Input,
  Key,
  matchesKey,
  ProcessTerminal,
  Text,
  TUI,
  type Focusable,
  type Terminal,
} from "@earendil-works/pi-tui";
```

with:

```ts
import {
  Container,
  Input,
  Key,
  matchesKey,
  ProcessTerminal,
  Text,
  TuiMainScreen,
  type Focusable,
  type Terminal,
  type TUI,
} from "@earendil-works/pi-tui";
```

Replace both constructors:

```ts
const tui = new TUI(terminal, true);
const tui = new TUI(terminal, false);
```

with their argument-preserving equivalents:

```ts
const tui = new TuiMainScreen(terminal, true);
const tui = new TuiMainScreen(terminal, false);
```

Leave `stopTui(tui: TUI, terminal: Terminal)` unchanged.

- [ ] **Step 6: Migrate `pi-auth-selector.ts`**

In `src/cli/commands/init/pi-auth-selector.ts`, replace:

```ts
import {
  Container,
  Input,
  Key,
  matchesKey,
  ProcessTerminal,
  Text,
  TruncatedText,
  TUI,
  type Focusable,
  type Terminal,
} from "@earendil-works/pi-tui";
```

with:

```ts
import {
  Container,
  Input,
  Key,
  matchesKey,
  ProcessTerminal,
  Text,
  TruncatedText,
  TuiMainScreen,
  type Focusable,
  type Terminal,
  type TUI,
} from "@earendil-works/pi-tui";
```

Replace both constructors:

```ts
const tui = new TUI(terminal, false);
const tui = new TUI(terminal, true);
```

with:

```ts
const tui = new TuiMainScreen(terminal, false);
const tui = new TuiMainScreen(terminal, true);
```

Leave `stopTui(tui: TUI, terminal: Terminal)` unchanged.

- [ ] **Step 7: Migrate `pi-model-selector.ts`**

In `src/cli/commands/init/pi-model-selector.ts`, replace the value import `TUI`
with `TuiMainScreen`; do not add `type TUI` because this file has no `TUI`
annotation. The complete import remains:

```ts
import {
  Container,
  Input,
  ProcessTerminal,
  Text,
  TruncatedText,
  TuiMainScreen,
  getKeybindings,
  type Focusable,
  type Terminal,
} from "@earendil-works/pi-tui";
```

Replace:

```ts
const tui = new TUI(terminal, true);
```

with:

```ts
const tui = new TuiMainScreen(terminal, true);
```

- [ ] **Step 8: Make the bundled todos extension's TUI import type-only**

In the pi-tui import block in `extensions/todos.ts`, replace:

```ts
TUI,
```

with:

```ts
type TUI,
```

Do not change the extension's `TUI` annotations or any UI construction. The
extension never instantiates the removed class.

- [ ] **Step 9: Add the complete pi-tui runtime contract**

In `src/cli/commands/init/pi-dependency-contract.test.ts`, add this namespace
import after the existing pi-coding-agent namespace import:

```ts
import * as piTui from "@earendil-works/pi-tui";
```

Add this constant after `REQUIRED_INIT_RUNTIME_EXPORTS`:

```ts
const REQUIRED_PI_TUI_RUNTIME_EXPORTS = [
  "TuiMainScreen",
  "Container",
  "Input",
  "Key",
  "matchesKey",
  "ProcessTerminal",
  "Text",
  "TruncatedText",
  "getKeybindings",
  "Markdown",
  "SelectList",
  "Spacer",
  "fuzzyMatch",
  "truncateToWidth",
  "visibleWidth",
] as const;
```

Add the test after the existing pi-coding-agent export test:

```ts
test("resolved pi-tui exports the runtime symbols used by patchmill", () => {
  for (const exportName of REQUIRED_PI_TUI_RUNTIME_EXPORTS) {
    assert.equal(
      exportName in piTui,
      true,
      `@earendil-works/pi-tui must export ${exportName}`,
    );
    assert.notEqual(
      piTui[exportName],
      undefined,
      `@earendil-works/pi-tui export ${exportName} must be defined`,
    );
  }
});
```

- [ ] **Step 10: Run the contract before broader tests**

```bash
node --test src/cli/commands/init/pi-dependency-contract.test.ts
```

Expected: PASS, including the 15-value pi-tui runtime contract.

- [ ] **Step 11: Run focused init and extension tests**

```bash
node --test \
  src/cli/commands/init/pi-auth-dialog.test.ts \
  src/cli/commands/init/pi-auth-selector.test.ts \
  src/cli/commands/init/pi-model-selector.test.ts \
  test-support/todos-extension.test.ts
```

Expected: PASS. The todos test imports and registers `extensions/todos.ts`, so
this is the direct runtime-load check for the bundled extension.

- [ ] **Step 12: Run all fast verification before Nix**

```bash
npm test
node scripts/smoke-packed-artifact.mjs
npm run lint
```

Expected: all commands pass. `npm run lint` also verifies the new spec and plan
are Prettier- and Markdownlint-clean.

- [ ] **Step 13: Refresh the Nix npm dependency hash**

```bash
scripts/update-npm-deps-hash.sh
```

Expected: the helper updates `npmDepsHash` in `nix/package.nix` and its final
Nix build succeeds. If it fails, inspect `git status --short`; a new hash may
remain in `nix/package.nix` and must not be assumed rolled back.

- [ ] **Step 14: Commit the atomic compatibility change**

```bash
git add \
  package.json \
  package-lock.json \
  npm-shrinkwrap.json \
  nix/package.nix \
  extensions/todos.ts \
  src/cli/commands/init/pi-auth-dialog.ts \
  src/cli/commands/init/pi-auth-selector.ts \
  src/cli/commands/init/pi-model-selector.ts \
  src/cli/commands/init/pi-dependency-contract.test.ts
git commit -m "chore(deps): update Pi runtime packages to 0.84.1"
```

### Task 2: Reorder the nightly workflow for fail-fast Pi validation

**Files:**

- Modify: `.github/workflows/pi-dependency-upgrade.yml`
- Modify: `scripts/update-pi-deps.mjs` (`validationCommands` only)
- Test: existing `scripts/update-pi-deps.test.mjs`
- Test: existing `scripts/pi-dependency-upgrade-lib.test.mjs`

**Interfaces:**

- Consumes: the compatibility contract and 0.84.1 pins from Task 1.
- Produces: updater metadata changes without an early Nix build; contract and
  Node tests before hash work; accepted then idempotency-checked Nix hash;
  reported and executed full flake verification.

- [ ] **Step 1: Make the updater skip its internal Nix hash build in CI**

In `.github/workflows/pi-dependency-upgrade.yml`, replace:

```yaml
args=(--summary-json .tmp/pi-deps-summary.json)
```

with:

```yaml
args=(--summary-json .tmp/pi-deps-summary.json --skip-nix-hash)
```

This applies to scheduled, manual, and validate-only dispatches. The flag is
harmless for validate-only because that mode already skips metadata mutation.

- [ ] **Step 2: Update and then verify the Nix hash after fast checks**

Insert this step after `Run lint` and before the existing
`Verify Nix npm dependency hash` step:

```yaml
- name: Update Nix npm dependency hash
  if: steps.update.outputs.no_update != 'true'
  run: scripts/update-npm-deps-hash.sh
```

Keep the existing verification step unchanged. It copies the now-updated
`nix/package.nix`, reruns the helper, and explicitly exits 1 if the file changes
again. Keep the existing `Build Nix package` step after hash verification.

- [ ] **Step 3: Add the required full flake check to CI**

Insert after `Build Nix package`:

```yaml
- name: Run full flake check
  if: steps.update.outputs.no_update != 'true'
  run: nix flake check --accept-flake-config --print-build-logs
```

- [ ] **Step 4: Report the full flake check in generated PR bodies**

In `scripts/update-pi-deps.mjs`, append this exact command to
`validationCommands` after the package build:

```js
"nix flake check --accept-flake-config --print-build-logs",
```

The final array tail is:

```js
"scripts/update-npm-deps-hash.sh",
"nix build .#patchmill --print-build-logs",
"nix flake check --accept-flake-config --print-build-logs",
```

- [ ] **Step 5: Run updater behavior tests**

```bash
node --test \
  scripts/update-pi-deps.test.mjs \
  scripts/pi-dependency-upgrade-lib.test.mjs
```

Expected: PASS. Do not add a test that merely matches workflow YAML text; this
change is verified directly and by PR CI per the Testing Value Gate.

- [ ] **Step 6: Verify formatting of the workflow and updater**

```bash
npx prettier --check \
  .github/workflows/pi-dependency-upgrade.yml \
  scripts/update-pi-deps.mjs
```

Expected: both files use repository formatting.

- [ ] **Step 7: Commit the workflow reorder**

```bash
git add .github/workflows/pi-dependency-upgrade.yml scripts/update-pi-deps.mjs
git commit -m "fix(ci): run Pi contract before upgrade Nix builds"
```

### Task 3: Run full verification and open the pull request

**Files:** none modified; verification and publication only.

**Interfaces:**

- Consumes: Tasks 1 and 2.
- Produces: verified branch and a pull request that closes issue #144.

- [ ] **Step 1: Run the Node-side verification set**

```bash
node --test src/cli/commands/init/pi-dependency-contract.test.ts
node --test test-support/todos-extension.test.ts
npm test
node scripts/smoke-packed-artifact.mjs
npm run lint
```

Expected: all commands pass.

- [ ] **Step 2: Verify Nix hash freshness with fail-fast shell semantics**

```bash
set -euo pipefail
before_hash_file="$(mktemp)"
trap 'rm -f "$before_hash_file"' EXIT
cp nix/package.nix "$before_hash_file"
scripts/update-npm-deps-hash.sh
if ! cmp --silent "$before_hash_file" nix/package.nix; then
  echo "npmDepsHash changed during freshness verification" >&2
  git diff -- nix/package.nix >&2
  exit 1
fi
echo "npmDepsHash fresh"
```

Expected: prints `npmDepsHash fresh`. Any changed hash exits before later builds
can mask the failure.

- [ ] **Step 3: Run package and full flake verification**

```bash
nix build .#patchmill --print-build-logs
nix flake check --accept-flake-config --print-build-logs
```

Expected: both commands succeed.

- [ ] **Step 4: Push and open the pull request**

```bash
git push -u origin agent/issue-144-pi-084-tui-class-export-removed
gh pr create --title "chore(deps): update Pi runtime packages to 0.84.1" --label dependencies --body "$(cat <<'EOF'
## Summary

- Bumps `@earendil-works/pi-coding-agent` and
  `@earendil-works/pi-tui` to 0.84.1 and migrates init constructors to
  `TuiMainScreen` while making the bundled todos extension's `TUI` import
  type-only.
- Extends the Pi compatibility contract to all 15 pi-tui runtime values used
  by init and the bundled extension.
- Reorders the nightly upgrade so the contract and Node checks run before any
  Nix build, then updates and verifies `npmDepsHash` and runs the full flake
  check.

Unblocks failed nightly run 31154881630.

## Verification

- `node --test src/cli/commands/init/pi-dependency-contract.test.ts`
- `node --test test-support/todos-extension.test.ts`
- `npm test`
- `node scripts/smoke-packed-artifact.mjs`
- `npm run lint`
- `scripts/update-npm-deps-hash.sh` freshness check
- `nix build .#patchmill --print-build-logs`
- `nix flake check --accept-flake-config --print-build-logs`

Closes #144
EOF
)"
```

- [ ] **Step 5: Watch pull-request CI**

```bash
gh pr checks --watch
```

Expected: CI passes, including the Nix package build and full flake check.

- [ ] **Step 6: Verify recovery with the next scheduled run**

After squash merge, wait until the next cron-triggered Pi dependency upgrade run
completes. Then run:

```bash
set -euo pipefail
merged_at="$(gh pr view --json mergedAt --jq .mergedAt)"
run_id="$(
  gh run list \
    --workflow=pi-dependency-upgrade.yml \
    --event schedule \
    --limit 20 \
    --json databaseId,createdAt,status,conclusion \
    --jq ".[] | select(.createdAt > \"$merged_at\" and .status == \"completed\" and .conclusion == \"success\") | .databaseId" \
    | head -n 1
)"
if [[ -z "$run_id" ]]; then
  echo "No successful scheduled Pi upgrade run exists after the merge; wait for the next cron run" >&2
  exit 1
fi
log_file="$(mktemp)"
trap 'rm -f "$log_file"' EXIT
gh run view "$run_id" --log >"$log_file"
grep -F "Selected Pi targets:" "$log_file"
if grep -Fq "No Pi dependency update available" "$log_file"; then
  echo "Scheduled upgrade recovered with no update"
else
  pr_step_conclusion="$(
    gh run view "$run_id" --json jobs \
      --jq '[.jobs[].steps[] | select(.name == "Create or update Pi dependency upgrade PR") | .conclusion][0]'
  )"
  if [[ "$pr_step_conclusion" != "success" ]]; then
    echo "Scheduled upgrade neither reported no-update nor completed its PR step" >&2
    exit 1
  fi
  echo "Scheduled upgrade recovered and processed a newer Pi target"
fi
```

Expected: the command finds a successful scheduled run created after the merge.
If 0.84.1 is still latest, it reports no-update; if a newer version is
available, the create-or-update-PR step succeeds. A blank or targeted manual
dispatch is not an equivalent scheduled-mode recovery check.
