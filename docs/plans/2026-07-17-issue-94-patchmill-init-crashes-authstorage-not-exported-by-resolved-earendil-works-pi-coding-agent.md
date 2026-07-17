# Issue 94 Patchmill Init AuthStorage Export Compatibility Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prevent `patchmill init` from crashing at module import time when
Patchmill depends on Pi init/auth runtime exports such as `AuthStorage`.

**Architecture:** Keep the current exact compatible Pi package pins and add a
runtime dependency-contract regression test for the Pi symbols imported by the
init/auth path. Verify static package metadata directly instead of adding tests
that merely restate dependency strings.

**Tech Stack:** Node.js `node:test`, TypeScript ESM, npm package metadata,
Patchmill CLI init modules, Nix flake build when npm dependency metadata
changes.

## Global Constraints

- Issue #94 is scoped to the exact-pin compatibility fix; do not migrate init
  auth to Pi `0.80.8+` credential APIs in this issue.
- Preserve current init readiness detection, interactive API-key auth,
  subscription/OAuth auth, repo-local `.patchmill/pi-agent/auth.json`, and model
  selection behavior.
- `package.json`, `package-lock.json`, and `npm-shrinkwrap.json` must agree on
  `@earendil-works/pi-coding-agent` version `0.80.3` and
  `@earendil-works/pi-tui` version `0.80.3` if dependency metadata is touched.
- If `package.json`, `package-lock.json`, or `npm-shrinkwrap.json` changes,
  rerun the Nix build as required by `AGENTS.md`.
- Testing Value Gate: add automated coverage only for runtime behavior or
  contract regressions. Do not add a test that only asserts static dependency
  strings; verify those with direct commands.
- Commit implementation work in small conventional commits. Do not commit
  `.pi/todos` local operator state.

---

## File Structure

- Modify: `src/cli/commands/init/pi-preflight.ts` only if the runtime import
  list has drifted from the current `AuthStorage`, `getAgentDir`, and
  `ModelRegistry` contract.
- Modify: `src/cli/commands/init/pi-auth-flow.ts` only if the runtime import
  list has drifted from the current `AuthStorage` and `ModelRegistry` contract.
- Create: `src/cli/commands/init/pi-dependency-contract.test.ts` for the
  runtime export compatibility regression test.
- Modify: `package.json` only if the Pi dependencies are not exact `0.80.3`.
- Modify: `package-lock.json` only if its root dependencies or installed package
  entries are not exact `0.80.3`.
- Modify: `npm-shrinkwrap.json` only if its root dependencies or installed
  package entries are not exact `0.80.3`.

---

### Task 1: Add Pi runtime export compatibility regression test

**Files:**

- Create: `src/cli/commands/init/pi-dependency-contract.test.ts`
- Read: `src/cli/commands/init/pi-preflight.ts`
- Read: `src/cli/commands/init/pi-auth-flow.ts`

**Interfaces:**

- Consumes: runtime exports from `@earendil-works/pi-coding-agent`.
- Produces: a `node:test` regression that fails if the resolved Pi package does
  not export the runtime symbols imported by the Patchmill init/auth modules.

- [ ] **Step 1: Confirm runtime imports in init/auth modules**

  Run:

  ```bash
  rg 'from "@earendil-works/pi-coding-agent"|AuthStorage|ModelRegistry|getAgentDir' \
    src/cli/commands/init/pi-preflight.ts \
    src/cli/commands/init/pi-auth-flow.ts
  ```

  Expected: `pi-preflight.ts` runtime-imports `AuthStorage`, `getAgentDir`, and
  `ModelRegistry`; `pi-auth-flow.ts` runtime-imports `AuthStorage` and
  `ModelRegistry`. `AuthCredential` remains a type-only import.

- [ ] **Step 2: Write the failing contract test**

  Create `src/cli/commands/init/pi-dependency-contract.test.ts` with:

  ```ts
  import assert from "node:assert/strict";
  import { test } from "node:test";
  import * as piCodingAgent from "@earendil-works/pi-coding-agent";

  const REQUIRED_INIT_RUNTIME_EXPORTS = [
    "AuthStorage",
    "ModelRegistry",
    "getAgentDir",
  ] as const;

  test("resolved pi-coding-agent exports the runtime symbols used by patchmill init", () => {
    for (const exportName of REQUIRED_INIT_RUNTIME_EXPORTS) {
      assert.equal(
        exportName in piCodingAgent,
        true,
        `@earendil-works/pi-coding-agent must export ${exportName}`,
      );
      assert.notEqual(
        piCodingAgent[exportName],
        undefined,
        `@earendil-works/pi-coding-agent export ${exportName} must be defined`,
      );
    }
  });
  ```

- [ ] **Step 3: Run the new test**

  Run:

  ```bash
  node --test src/cli/commands/init/pi-dependency-contract.test.ts
  ```

  Expected: PASS with the pinned compatible Pi dependency. If it fails because a
  required export is missing, stop and inspect dependency metadata before
  changing source APIs.

- [ ] **Step 4: Run neighboring init/auth tests**

  Run:

  ```bash
  node --test \
    src/cli/commands/init/pi-preflight.test.ts \
    src/cli/commands/init/pi-auth-flow.test.ts \
    src/cli/commands/init/pi-dependency-contract.test.ts
  ```

  Expected: all tests pass.

- [ ] **Step 5: Commit the regression test**

  Run:

  ```bash
  git add src/cli/commands/init/pi-dependency-contract.test.ts
  git commit -m "test: cover patchmill init pi runtime exports"
  ```

---

### Task 2: Verify and repair Pi dependency metadata pins

**Files:**

- Modify: `package.json` if needed
- Modify: `package-lock.json` if needed
- Modify: `npm-shrinkwrap.json` if needed

**Interfaces:**

- Consumes: npm dependency metadata for Patchmill's publish/install contract.
- Produces: package metadata that cannot resolve
  `@earendil-works/pi-coding-agent` above `0.80.3` for the current release line.

- [ ] **Step 1: Check root dependency pins directly**

  Run:

  ```bash
  node --input-type=module <<'NODE'
  import { readFileSync } from "node:fs";

  const expected = {
    "@earendil-works/pi-coding-agent": "0.80.3",
    "@earendil-works/pi-tui": "0.80.3",
  };

  for (const file of ["package.json", "package-lock.json", "npm-shrinkwrap.json"]) {
    const json = JSON.parse(readFileSync(file, "utf8"));
    const deps = file === "package.json"
      ? json.dependencies
      : json.packages?.[""]?.dependencies;
    for (const [name, version] of Object.entries(expected)) {
      if (deps?.[name] !== version) {
        throw new Error(`${file} root dependency ${name} is ${deps?.[name]}, expected ${version}`);
      }
    }
  }
  NODE
  ```

  Expected: command exits 0. This is direct verification, not an automated test,
  because it checks static metadata strings.

- [ ] **Step 2: Check installed lock/shrinkwrap package entries directly**

  Run:

  ```bash
  node --input-type=module <<'NODE'
  import { readFileSync } from "node:fs";

  const expected = {
    "node_modules/@earendil-works/pi-coding-agent": "0.80.3",
    "node_modules/@earendil-works/pi-tui": "0.80.3",
  };

  for (const file of ["package-lock.json", "npm-shrinkwrap.json"]) {
    const json = JSON.parse(readFileSync(file, "utf8"));
    for (const [entry, version] of Object.entries(expected)) {
      const actual = json.packages?.[entry]?.version;
      if (actual !== version) {
        throw new Error(`${file} ${entry} version is ${actual}, expected ${version}`);
      }
    }
  }
  NODE
  ```

  Expected: command exits 0.

- [ ] **Step 3: Repair metadata only if either direct check fails**

  If Step 1 or Step 2 fails, update all three metadata files so the root
  dependencies and installed package entries use exact `0.80.3` for both Pi
  packages. Prefer regenerating lock metadata with npm over hand-editing:

  ```bash
  npm install \
    @earendil-works/pi-coding-agent@0.80.3 \
    @earendil-works/pi-tui@0.80.3 \
    --package-lock-only
  cp package-lock.json npm-shrinkwrap.json
  ```

  Expected: `git diff -- package.json package-lock.json npm-shrinkwrap.json`
  shows only the dependency-contract repair needed for this issue.

- [ ] **Step 4: Re-run direct metadata checks**

  Re-run the exact Node commands from Steps 1 and 2.

  Expected: both commands exit 0.

- [ ] **Step 5: Commit metadata repairs if files changed**

  If `git diff --quiet -- package.json package-lock.json npm-shrinkwrap.json`
  exits non-zero, run:

  ```bash
  git add package.json package-lock.json npm-shrinkwrap.json
  git commit -m "fix: pin patchmill pi dependencies"
  ```

  If no metadata files changed, do not create an empty commit for this task.

---

### Task 3: Verify packaged install metadata and built init imports

**Files:**

- Read: `package.json`
- Read: `package-lock.json`
- Read: `npm-shrinkwrap.json`
- Generated by command: `dist/`

**Interfaces:**

- Consumes: source imports, package metadata, and npm pack output.
- Produces: evidence that the next package tarball keeps exact Pi pins and the
  built init modules import symbols provided by the resolved dependency.

- [ ] **Step 1: Build the project**

  Run:

  ```bash
  npm run build
  ```

  Expected: `tsc -p tsconfig.build.json` completes successfully.

- [ ] **Step 2: Inspect built init imports for expected runtime symbols**

  Run:

  ```bash
  rg 'AuthStorage|ModelRegistry|getAgentDir|@earendil-works/pi-coding-agent' \
    dist/src/cli/commands/init/pi-preflight.js \
    dist/src/cli/commands/init/pi-auth-flow.js
  ```

  Expected: built JS imports the same runtime Pi symbols covered by
  `pi-dependency-contract.test.ts`.

- [ ] **Step 3: Verify the package tarball metadata dry-run**

  Run:

  ```bash
  npm pack --dry-run
  ```

  Expected: dry-run succeeds after running the `prepack` build. Review the
  output to confirm the package includes `package.json`, `package-lock.json`,
  and `npm-shrinkwrap.json` and does not report packaging errors.

- [ ] **Step 4: Inspect publish metadata with `npm pack --json --dry-run`**

  Run:

  ```bash
  npm pack --json --dry-run > /tmp/patchmill-issue-94-pack.json
  node --input-type=module <<'NODE'
  import { readFileSync } from "node:fs";

  const [pack] = JSON.parse(readFileSync("/tmp/patchmill-issue-94-pack.json", "utf8"));
  const names = new Set(pack.files.map((file) => file.path));
  for (const file of ["package.json", "package-lock.json", "npm-shrinkwrap.json"]) {
    if (!names.has(file)) throw new Error(`packed tarball is missing ${file}`);
  }
  NODE
  ```

  Expected: command exits 0. This verifies packaging structure without adding a
  brittle test for static file lists.

- [ ] **Step 5: Commit no generated build output unless the repository already
  tracks it for this change**

  Run:

  ```bash
  git status --short dist package.json package-lock.json npm-shrinkwrap.json
  ```

  Expected: if `dist/` is untracked or ignored, do not force-add it. If tracked
  build output changed and project history expects it to be committed, include it
  in the relevant implementation commit with a conventional message.

---

### Task 4: Run final validation for issue 94

**Files:**

- Read: all files changed by Tasks 1 through 3

**Interfaces:**

- Consumes: completed dependency contract test, dependency metadata, and build
  state.
- Produces: final validation evidence for landing the issue.

- [ ] **Step 1: Run targeted init/auth regression tests**

  Run:

  ```bash
  node --test \
    src/cli/commands/init/pi-preflight.test.ts \
    src/cli/commands/init/pi-auth-flow.test.ts \
    src/cli/commands/init/pi-dependency-contract.test.ts
  ```

  Expected: all tests pass.

- [ ] **Step 2: Run the full test suite**

  Run:

  ```bash
  npm test
  ```

  Expected: all repository tests pass.

- [ ] **Step 3: Run lint**

  Run:

  ```bash
  npm run lint
  ```

  Expected: formatting, TypeScript lint, and Markdown lint pass.

- [ ] **Step 4: Run build**

  Run:

  ```bash
  npm run build
  ```

  Expected: build passes.

- [ ] **Step 5: Run Nix build if npm dependency metadata changed**

  If `git diff --name-only origin/main...HEAD` or the task commits include
  `package.json`, `package-lock.json`, or `npm-shrinkwrap.json`, run:

  ```bash
  nix build .#patchmill
  ```

  Expected: Nix build succeeds. If no npm dependency metadata changed, record
  `Nix build skipped: npm dependency metadata unchanged` in the final handoff.

- [ ] **Step 6: Record final evidence**

  Capture the command names and pass/fail results for:

  ```text
  node --test src/cli/commands/init/pi-preflight.test.ts src/cli/commands/init/pi-auth-flow.test.ts src/cli/commands/init/pi-dependency-contract.test.ts
  npm test
  npm run lint
  npm run build
  npm pack --dry-run
  nix build .#patchmill (only if npm dependency metadata changed)
  ```

  Expected: final handoff states exact results and whether Nix was required by
  `AGENTS.md`.
