# Automate Pi Dependency Upgrade PRs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Automate review-gated PRs that upgrade Patchmill's tightly coupled Pi
runtime dependencies only after metadata, compatibility, packed-artifact, and
Nix validation succeed.

**Architecture:** Put repository-specific upgrade logic in versioned Node
scripts that can run locally and from GitHub Actions. Keep pure
target-resolution and metadata-validation behavior unit-tested, make the runtime
compatibility test read the current exact pins, and reuse one packed-artifact
smoke script from CI and the upgrade workflow.

**Tech Stack:** Node.js 24 in CI, TypeScript ESM tests through `node --test`,
JavaScript `.mjs` repository scripts, npm lockfile/shrinkwrap, Prettier, GitHub
Actions, Nix `buildNpmPackage`, `peter-evans/create-pull-request@v7`.

## Global Constraints

- `@earendil-works/pi-coding-agent` and `@earendil-works/pi-tui` remain exact
  dependency pins in `package.json`; do not widen them to ranges.
- Scheduled mode only prepares an upgrade when both packages expose the same
  newer `latest` version than the current pins; divergent scheduled latest
  versions are a non-zero failure before editing files.
- Manual mode may accept explicit package versions and must call out any
  non-matching pair in the generated summary/PR body.
- Generated upgrade PRs update `package.json`, `package-lock.json`,
  `npm-shrinkwrap.json`, and `nix/package.nix` `npmDepsHash` when the dependency
  graph changes.
- Upgrade validation must run the Pi compatibility contract, full Node tests,
  linting, packed-artifact smoke checks, `scripts/update-npm-deps-hash.sh`, and
  `nix build .#patchmill --print-build-logs`.
- Because npm dependencies change in generated upgrade PRs, rerun the Nix build
  as required by `AGENTS.md`.
- The automation opens or updates a normal review PR only; it must not
  auto-merge, auto-publish, or bypass failed compatibility checks.
- Do not add tests that merely assert workflow YAML, dependency versions,
  lockfile text, static config values, documentation text, or one-off script
  structure. Use direct validation such as Prettier, dry-runs, existing test
  suites, and Nix builds for those.
- Do not commit `.pi/todos` or other local operator state.

---

## File Structure

- Create `scripts/pi-dependency-upgrade-lib.mjs`: pure helpers for Pi package
  constants, exact-pin checks, npm `latest` discovery, target selection,
  lockfile validation, JSON I/O, and PR-summary rendering.
- Create `scripts/pi-dependency-upgrade-lib.test.mjs`: behavior tests for target
  selection, exact-pin failures, lockfile mismatch diagnostics, and PR-summary
  text.
- Create `scripts/update-pi-deps.mjs`: CLI wrapper that discovers/accepts target
  versions, updates package pins, regenerates both lockfiles, formats generated
  JSON, validates metadata, optionally updates `npmDepsHash`, and writes a
  machine-readable summary for workflows.
- Modify `package.json`: add `scripts/*.test.mjs` to the `npm test` command so
  script helper tests run with the normal suite.
- Modify `src/cli/commands/init/pi-dependency-contract.test.ts`: derive expected
  Pi versions from exact root `package.json` pins while keeping capability
  assertions for `ModelRuntime`, `ModelRegistry`, `readStoredCredential`, and
  `getAgentDir`.
- Create `scripts/smoke-packed-artifact.mjs`: reusable packed npm artifact smoke
  script for `patchmill --help`, `patchmill init`, installed skill presence, and
  resolved Pi package version assertions.
- Modify `.github/workflows/ci.yml`: replace the inline npm packed smoke shell
  block with the reusable script.
- Create `.github/workflows/pi-dependency-upgrade.yml`: scheduled/manual update
  workflow that validates changes and opens or updates the review PR.

---

### Task 1: Add unit-tested Pi upgrade helper library

**Files:**

- Create: `scripts/pi-dependency-upgrade-lib.mjs`
- Create: `scripts/pi-dependency-upgrade-lib.test.mjs`
- Modify: `package.json`

**Interfaces:**

- Consumes: package metadata objects, lockfile objects, npm registry metadata,
  current package pins, and optional manual target versions.
- Produces: `PI_PACKAGES`, `isExactVersion(spec)`, `readJson(path)`,
  `writeJson(path, value)`, `getRootPins(packageJson)`,
  `fetchLatestVersion(packageName, fetchImpl)`, `resolveUpgradeTarget(options)`,
  `assertLockfilesMatchTargets({ packageJson, packageLock, shrinkwrap, targets })`,
  and `renderPullRequestBody(summary)` for later scripts.

- [ ] **Step 1: Create the helper library with pure validation and target
      selection functions**

  Create `scripts/pi-dependency-upgrade-lib.mjs` with these exported names and
  behavior:

  ```js
  import { readFile, writeFile } from "node:fs/promises";

  export const PI_PACKAGES = [
    "@earendil-works/pi-coding-agent",
    "@earendil-works/pi-tui",
  ];

  export function isExactVersion(spec) {
    return /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(
      spec,
    );
  }

  export async function readJson(path) {
    return JSON.parse(await readFile(path, "utf8"));
  }

  export async function writeJson(path, value) {
    await writeFile(path, `${JSON.stringify(value, null, 2)}\n`);
  }

  export function getRootPins(packageJson) {
    const dependencies = packageJson.dependencies ?? {};
    return Object.fromEntries(
      PI_PACKAGES.map((name) => {
        const spec = dependencies[name];
        if (!isExactVersion(spec ?? "")) {
          throw new Error(
            `${name} must be an exact version; found ${spec ?? "missing"}`,
          );
        }
        return [name, spec];
      }),
    );
  }
  ```

  Add the remaining exports in the same file:
  - `fetchLatestVersion(packageName, fetchImpl = fetch)` calls
    `https://registry.npmjs.org/${encodeURIComponent(packageName).replace("%40", "@")}`,
    requires an OK response, requires `dist-tags.latest`, and throws
    `${packageName}: npm latest dist-tag not found` if missing.
  - `compareVersions(a, b)` handles numeric `major.minor.patch` comparison and
    ignores pre-release ordering beyond treating different strings with equal
    numeric components as equal for scheduled discovery.
  - `resolveUpgradeTarget({ mode, currentPins, latestVersions, manualVersions })`
    returns `{ noUpdate, targets, warnings }`.
  - In scheduled mode, if latest versions differ, throw
    `Scheduled Pi upgrade requires matching latest versions: @earendil-works/pi-coding-agent=<version>, @earendil-works/pi-tui=<version>`.
  - In scheduled mode, if the shared latest version is not newer than both
    current pins, return `noUpdate: true` with current pins as `targets`.
  - In manual mode, require explicit versions for both packages and add warning
    text when they differ.
  - `assertLockfilesMatchTargets` verifies root dependencies and each
    `packages["node_modules/<name>"].version` entry in both lockfiles. Its
    errors must include file label, package name, expected version, and actual
    value.
  - `renderPullRequestBody(summary)` returns markdown listing target versions,
    warnings, changed files, and validation commands.

- [ ] **Step 2: Add focused behavior tests for the helper library**

  Create `scripts/pi-dependency-upgrade-lib.test.mjs` with `node:test` cases
  equivalent to:

  ```js
  import assert from "node:assert/strict";
  import { test } from "node:test";
  import {
    assertLockfilesMatchTargets,
    getRootPins,
    renderPullRequestBody,
    resolveUpgradeTarget,
  } from "./pi-dependency-upgrade-lib.mjs";

  const currentPins = {
    "@earendil-works/pi-coding-agent": "0.80.10",
    "@earendil-works/pi-tui": "0.80.10",
  };

  test("scheduled mode selects a newer shared latest version", () => {
    const result = resolveUpgradeTarget({
      mode: "scheduled",
      currentPins,
      latestVersions: {
        "@earendil-works/pi-coding-agent": "0.80.11",
        "@earendil-works/pi-tui": "0.80.11",
      },
    });

    assert.equal(result.noUpdate, false);
    assert.deepEqual(result.targets, {
      "@earendil-works/pi-coding-agent": "0.80.11",
      "@earendil-works/pi-tui": "0.80.11",
    });
  });

  test("scheduled mode fails before edits when latest versions diverge", () => {
    assert.throws(
      () =>
        resolveUpgradeTarget({
          mode: "scheduled",
          currentPins,
          latestVersions: {
            "@earendil-works/pi-coding-agent": "0.80.12",
            "@earendil-works/pi-tui": "0.80.11",
          },
        }),
      /requires matching latest versions.*pi-coding-agent=0.80.12.*pi-tui=0.80.11/,
    );
  });
  ```

  Include additional tests for: no-update scheduled mode, manual non-matching
  warning, non-exact root pins, lockfile mismatch error text, and PR body
  validation-command rendering.

- [ ] **Step 3: Include script helper tests in the normal Node test suite**

  Modify `package.json` so the `test` script becomes:

  ```json
  "test": "node --test \"bin/*.test.ts\" \"src/**/*.test.ts\" \"test-support/*.test.ts\" \"scripts/*.test.mjs\""
  ```

  Do not change npm dependencies for this task.

- [ ] **Step 4: Run the new helper tests**

  Run:

  ```bash
  node --test scripts/pi-dependency-upgrade-lib.test.mjs
  ```

  Expected: PASS. Failures should name the helper behavior that regressed.

- [ ] **Step 5: Run the normal test entrypoint to prove the new test pattern is
      included**

  Run:

  ```bash
  npm test
  ```

  Expected: PASS, including `scripts/pi-dependency-upgrade-lib.test.mjs`.

- [ ] **Step 6: Commit the helper library and tests**

  Run:

  ```bash
  git add package.json scripts/pi-dependency-upgrade-lib.mjs scripts/pi-dependency-upgrade-lib.test.mjs
  git commit -m "feat: add pi dependency upgrade helpers"
  ```

---

### Task 2: Add the Pi dependency update CLI

**Files:**

- Create: `scripts/update-pi-deps.mjs`
- Modify: `scripts/pi-dependency-upgrade-lib.mjs` only if Task 1 exposed an
  integration gap.
- Modify during generated upgrade runs: `package.json`, `package-lock.json`,
  `npm-shrinkwrap.json`, `nix/package.nix`.

**Interfaces:**

- Consumes: Task 1 helpers, npm registry metadata, current package files, and
  CLI flags.
- Produces: a local/workflow command that updates exact Pi pins, regenerates
  both npm metadata files, refreshes the Nix npm dependency hash unless
  explicitly skipped, validates versions, and writes a JSON summary.

- [ ] **Step 1: Implement CLI argument parsing and summary output contract**

  Create `scripts/update-pi-deps.mjs` with flags:

  ```text
  --mode scheduled|manual
  --pi-coding-agent-version <version>
  --pi-tui-version <version>
  --target-version <version>
  --summary-json <path>
  --validate-only
  --skip-nix-hash
  ```

  Parsing rules:
  - Default `--mode` is `scheduled`.
  - `--target-version` sets both Pi package targets for manual runs.
  - Explicit per-package flags override `--target-version`.
  - `--validate-only` validates current files against selected targets without
    writing package metadata.
  - `--skip-nix-hash` is only for local dry-runs and tests where Nix is
    unavailable; the workflow must not use it.

  The script should always write summary JSON when `--summary-json` is provided:

  ```json
  {
    "noUpdate": false,
    "validateOnly": false,
    "targets": {
      "@earendil-works/pi-coding-agent": "0.80.11",
      "@earendil-works/pi-tui": "0.80.11"
    },
    "warnings": [],
    "changedFiles": [
      "package.json",
      "package-lock.json",
      "npm-shrinkwrap.json",
      "nix/package.nix"
    ],
    "validationCommands": [
      "node --test src/cli/commands/init/pi-dependency-contract.test.ts",
      "npm test",
      "node scripts/smoke-packed-artifact.mjs",
      "npm run lint",
      "scripts/update-npm-deps-hash.sh",
      "nix build .#patchmill --print-build-logs"
    ]
  }
  ```

- [ ] **Step 2: Implement candidate discovery and pre-edit validation**

  Use `readJson`, `getRootPins`, `fetchLatestVersion`, and
  `resolveUpgradeTarget` from Task 1. Log the current pins and selected targets
  before editing. If scheduled mode returns `noUpdate: true`, write the summary,
  print `No Pi dependency update available`, and exit 0 without modifying files.

  Expected divergent-latest failure text:

  ```text
  Scheduled Pi upgrade requires matching latest versions: @earendil-works/pi-coding-agent=0.x.y, @earendil-works/pi-tui=0.a.b
  ```

- [ ] **Step 3: Implement package and lockfile updates**

  When not `--validate-only`, update root `package.json` dependencies to the
  exact target strings, then regenerate both npm metadata files with this
  sequence from the repository root:

  ```js
  await run("npm", ["install", "--package-lock-only", "--ignore-scripts"]);
  await copyFile("npm-shrinkwrap.json", shrinkwrapTempPath);
  await rm("npm-shrinkwrap.json");
  await run("npm", ["install", "--package-lock-only", "--ignore-scripts"]);
  await copyFile(shrinkwrapTempPath, "npm-shrinkwrap.json");
  await run("npx", [
    "prettier",
    "--write",
    "package.json",
    "package-lock.json",
    "npm-shrinkwrap.json",
  ]);
  ```

  Wrap `child_process.spawn` in a `run(command, args)` helper that prints the
  command before execution and throws `Command failed: <command> <args>` on
  non-zero exit. If npm resolution fails, rethrow with the target package names
  and requested versions in the error message.

- [ ] **Step 4: Validate updated metadata and refresh the Nix hash**

  Re-read `package.json`, `package-lock.json`, and `npm-shrinkwrap.json`; call
  `assertLockfilesMatchTargets`. Unless `--skip-nix-hash` or `--validate-only`
  is set, run:

  ```bash
  scripts/update-npm-deps-hash.sh
  ```

  Then compute `changedFiles` from:

  ```bash
  git diff --name-only -- package.json package-lock.json npm-shrinkwrap.json nix/package.nix
  ```

  Include the changed-file list in the JSON summary and human-readable log.

- [ ] **Step 5: Dry-run validate the CLI against current pins without editing**

  Run:

  ```bash
  node scripts/update-pi-deps.mjs \
    --mode manual \
    --target-version 0.80.10 \
    --validate-only \
    --skip-nix-hash \
    --summary-json .tmp/pi-deps-validate-summary.json
  git diff --exit-code -- package.json package-lock.json npm-shrinkwrap.json nix/package.nix
  node -e 'console.log(JSON.parse(require("node:fs").readFileSync(".tmp/pi-deps-validate-summary.json", "utf8")).targets)'
  ```

  Expected: exit 0; `git diff --exit-code` reports no metadata changes; the
  summary targets are both `0.80.10`.

- [ ] **Step 6: Commit the update CLI**

  Run:

  ```bash
  git add scripts/update-pi-deps.mjs scripts/pi-dependency-upgrade-lib.mjs
  git commit -m "feat: automate pi dependency metadata updates"
  ```

---

### Task 3: Make Pi compatibility assertions follow exact root pins

**Files:**

- Modify: `src/cli/commands/init/pi-dependency-contract.test.ts`

**Interfaces:**

- Consumes: exact Pi dependency pins from root `package.json` and resolved
  package metadata from installed Pi packages.
- Produces: compatibility failures that identify the package name, resolved
  version, expected pin, and missing Pi capability.

- [ ] **Step 1: Replace the hard-coded expected version with root-pin lookup**

  Modify `src/cli/commands/init/pi-dependency-contract.test.ts` so it includes:

  ```ts
  const PI_PACKAGES = [
    "@earendil-works/pi-coding-agent",
    "@earendil-works/pi-tui",
  ] as const;

  const ROOT_PACKAGE_JSON = join(
    dirname(fileURLToPath(import.meta.url)),
    "../../../../package.json",
  );

  function isExactVersion(spec: string | undefined): spec is string {
    return /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(
      spec ?? "",
    );
  }

  function rootPiPins(): Record<(typeof PI_PACKAGES)[number], string> {
    const rootPackage = JSON.parse(
      readFileSync(ROOT_PACKAGE_JSON, "utf8"),
    ) as PackageJson;
    const dependencies = rootPackage.dependencies ?? {};
    const pins = {} as Record<(typeof PI_PACKAGES)[number], string>;

    for (const name of PI_PACKAGES) {
      const spec = dependencies[name];
      assert.equal(
        isExactVersion(spec),
        true,
        `${name} must be pinned to an exact version in package.json; found ${spec ?? "missing"}`,
      );
      pins[name] = spec;
    }

    return pins;
  }
  ```

  Remove `const EXPECTED_PI_VERSION = "0.80.10";`.

- [ ] **Step 2: Update the version test assertions with actionable messages**

  Replace the version test body with:

  ```ts
  test("resolved Pi packages use the package.json exact pins", () => {
    const pins = rootPiPins();

    for (const name of PI_PACKAGES) {
      const resolved = packageJson(name);
      assert.equal(
        resolved.version,
        pins[name],
        `${name} resolved ${resolved.version} but package.json pins ${pins[name]}`,
      );
    }
  });
  ```

  Keep the existing export-capability tests unchanged so missing exports still
  fail with messages such as
  `@earendil-works/pi-coding-agent must export ModelRuntime`.

- [ ] **Step 3: Run the focused compatibility contract test**

  Run:

  ```bash
  node --test src/cli/commands/init/pi-dependency-contract.test.ts
  ```

  Expected: PASS with current `0.80.10` pins. If it fails, the output must name
  the mismatched package or missing export.

- [ ] **Step 4: Run the normal Node test suite**

  Run:

  ```bash
  npm test
  ```

  Expected: PASS.

- [ ] **Step 5: Commit the compatibility test update**

  Run:

  ```bash
  git add src/cli/commands/init/pi-dependency-contract.test.ts
  git commit -m "test: derive pi compatibility versions from exact pins"
  ```

---

### Task 4: Move packed npm artifact smoke checks into a reusable script

**Files:**

- Create: `scripts/smoke-packed-artifact.mjs`
- Modify: `.github/workflows/ci.yml`

**Interfaces:**

- Consumes: root package pins, `npm pack` output, a temporary npm project, and
  the installed `patchmill` binary.
- Produces: one command that verifies packed artifact installability,
  `patchmill --help`, non-interactive `patchmill init`, installed Patchmill
  skill presence, and resolved Pi versions.

- [ ] **Step 1: Create the smoke script**

  Create `scripts/smoke-packed-artifact.mjs` with these behaviors:

  ```js
  import { mkdtemp, readFile, rm } from "node:fs/promises";
  import { existsSync } from "node:fs";
  import { tmpdir } from "node:os";
  import { dirname, join } from "node:path";
  import { fileURLToPath } from "node:url";
  import { createRequire } from "node:module";
  import { spawn } from "node:child_process";
  import { getRootPins, PI_PACKAGES } from "./pi-dependency-upgrade-lib.mjs";

  const rootDir = dirname(dirname(fileURLToPath(import.meta.url)));

  function run(command, args, options = {}) {
    console.log(`$ ${[command, ...args].join(" ")}`);
    return new Promise((resolve, reject) => {
      const child = spawn(command, args, { stdio: "inherit", ...options });
      child.on("exit", (code) => {
        if (code === 0) resolve();
        else
          reject(
            new Error(`Command failed (${code}): ${command} ${args.join(" ")}`),
          );
      });
      child.on("error", reject);
    });
  }
  ```

  Complete the script so it:
  - creates one temporary directory with `home`, `config`, `npm-cache`, and
    `project` subdirectories;
  - runs `npm pack --silent` from `rootDir` and records the tarball path;
  - runs `npm init -y` and installs the tarball into the temporary project with
    `npm_config_cache` pointed at the isolated cache;
  - runs `./node_modules/.bin/patchmill --help`;
  - runs `patchmill init` with isolated `HOME` and `XDG_CONFIG_HOME`;
  - asserts `.patchmill/skills/patchmill-issue-triage/SKILL.md` exists;
  - resolves each Pi package's `package.json` from the installed project using
    `createRequire(join(projectDir, "package.json"))` and compares the installed
    version to `getRootPins(root package.json)`;
  - on mismatch, throws
    `<package> resolved <actual> from <path> but package.json pins <expected>`;
  - cleans the temporary directory and packed tarball on exit unless
    `PATCHMILL_KEEP_SMOKE_ARTIFACTS=1` is set.

- [ ] **Step 2: Replace the CI inline npm smoke block with the reusable script**

  In `.github/workflows/ci.yml`, replace the `Smoke test npm package install`
  shell block with:

  ```yaml
  - name: Smoke test npm package install
    run: node scripts/smoke-packed-artifact.mjs
  ```

  Do not add a test that asserts this YAML text. The Testing Value Gate rejects
  that kind of static workflow-content test; use direct formatting and the
  script's own runtime smoke command instead.

- [ ] **Step 3: Run the packed-artifact smoke script locally**

  Run:

  ```bash
  node scripts/smoke-packed-artifact.mjs
  ```

  Expected: PASS. The log should show `npm pack`, package install,
  `patchmill --help`, and `patchmill init`; failures should include the command
  or Pi package version that failed.

- [ ] **Step 4: Run focused formatting checks for the script and workflow**

  Run:

  ```bash
  npx prettier --check scripts/smoke-packed-artifact.mjs .github/workflows/ci.yml
  ```

  Expected: PASS.

- [ ] **Step 5: Commit the reusable smoke script and CI update**

  Run:

  ```bash
  git add scripts/smoke-packed-artifact.mjs .github/workflows/ci.yml
  git commit -m "ci: reuse packed artifact smoke validation"
  ```

---

### Task 5: Add the scheduled/manual Pi dependency upgrade workflow

**Files:**

- Create: `.github/workflows/pi-dependency-upgrade.yml`

**Interfaces:**

- Consumes: `scripts/update-pi-deps.mjs`, `scripts/smoke-packed-artifact.mjs`,
  GitHub Actions workflow inputs, repository credentials, Node 24, and Nix.
- Produces: scheduled/manual validation and, unless validate-only or no-update,
  a review-gated PR branch named `automation/pi-deps-<version>`.

- [ ] **Step 1: Create the workflow triggers, permissions, and inputs**

  Create `.github/workflows/pi-dependency-upgrade.yml` beginning with:

  ```yaml
  name: Pi dependency upgrade

  on:
    schedule:
      - cron: "17 6 * * 1"
    workflow_dispatch:
      inputs:
        target-version:
          description: "Version to apply to both Pi runtime packages"
          required: false
          type: string
        pi-coding-agent-version:
          description: "Explicit @earendil-works/pi-coding-agent version"
          required: false
          type: string
        pi-tui-version:
          description: "Explicit @earendil-works/pi-tui version"
          required: false
          type: string
        validate-only:
          description: "Validate selected versions without creating a PR"
          required: false
          default: false
          type: boolean

  permissions:
    contents: write
    pull-requests: write

  concurrency:
    group: pi-dependency-upgrade
    cancel-in-progress: false
  ```

- [ ] **Step 2: Add checkout, Node, npm, and Nix setup steps**

  Add a single `upgrade` job on `ubuntu-latest` with:

  ```yaml
  steps:
    - name: Check out repository
      uses: actions/checkout@v4
      with:
        ref: main

    - name: Set up Node.js
      uses: actions/setup-node@v4
      with:
        node-version: 24
        cache: npm

    - name: Install dependencies
      run: npm ci

    - name: Install Nix
      uses: cachix/install-nix-action@v31
      with:
        extra_nix_config: |
          experimental-features = nix-command flakes
  ```

- [ ] **Step 3: Run the update script and expose workflow outputs**

  Add a step with `id: update` that builds CLI args from dispatch inputs, runs
  the script, and writes outputs from summary JSON:

  ```yaml
  - name: Update Pi dependency metadata
    id: update
    env:
      TARGET_VERSION: ${{ inputs.target-version }}
      PI_CODING_AGENT_VERSION: ${{ inputs.pi-coding-agent-version }}
      PI_TUI_VERSION: ${{ inputs.pi-tui-version }}
      VALIDATE_ONLY: ${{ inputs.validate-only || false }}
    run: |
      set -euo pipefail
      mkdir -p .tmp
      args=(--summary-json .tmp/pi-deps-summary.json)
      if [[ "${{ github.event_name }}" == "workflow_dispatch" ]]; then
        args+=(--mode manual)
        [[ -n "${TARGET_VERSION:-}" ]] && args+=(--target-version "$TARGET_VERSION")
        [[ -n "${PI_CODING_AGENT_VERSION:-}" ]] && args+=(--pi-coding-agent-version "$PI_CODING_AGENT_VERSION")
        [[ -n "${PI_TUI_VERSION:-}" ]] && args+=(--pi-tui-version "$PI_TUI_VERSION")
        [[ "$VALIDATE_ONLY" == "true" ]] && args+=(--validate-only)
      else
        args+=(--mode scheduled)
      fi
      node scripts/update-pi-deps.mjs "${args[@]}"
      node <<'NODE' >> "$GITHUB_OUTPUT"
      const fs = require("node:fs");
      const summary = JSON.parse(fs.readFileSync(".tmp/pi-deps-summary.json", "utf8"));
      const target = summary.targets["@earendil-works/pi-coding-agent"];
      console.log(`no_update=${summary.noUpdate ? "true" : "false"}`);
      console.log(`validate_only=${summary.validateOnly ? "true" : "false"}`);
      console.log(`target_version=${target}`);
      NODE
  ```

- [ ] **Step 4: Reinstall and run validations when an update is selected**

  Add validation steps guarded by
  `if: steps.update.outputs.no_update != 'true'`:

  ```yaml
  - name: Reinstall updated dependencies
    if: steps.update.outputs.no_update != 'true'
    run: npm ci

  - name: Run Pi compatibility contract
    if: steps.update.outputs.no_update != 'true'
    run: node --test src/cli/commands/init/pi-dependency-contract.test.ts

  - name: Run Node tests
    if: steps.update.outputs.no_update != 'true'
    run: npm test

  - name: Run packed artifact smoke test
    if: steps.update.outputs.no_update != 'true'
    run: node scripts/smoke-packed-artifact.mjs

  - name: Run lint
    if: steps.update.outputs.no_update != 'true'
    run: npm run lint

  - name: Verify Nix npm dependency hash
    if: steps.update.outputs.no_update != 'true'
    run: |
      scripts/update-npm-deps-hash.sh
      if ! git diff --exit-code -- nix/package.nix; then
        echo "::error file=nix/package.nix::npmDepsHash is stale after Pi dependency update."
        exit 1
      fi

  - name: Build Nix package
    if: steps.update.outputs.no_update != 'true'
    run: nix build .#patchmill --print-build-logs
  ```

- [ ] **Step 5: Open or update a review-gated PR when validation succeeds**

  Add a PR-body step and create-pull-request step guarded by
  `no_update != 'true'` and `validate_only != 'true'`:

  ```yaml
  - name: Render pull request body
    if:
      steps.update.outputs.no_update != 'true' &&
      steps.update.outputs.validate_only != 'true'
    run: |
      node -e 'import("./scripts/pi-dependency-upgrade-lib.mjs").then(({renderPullRequestBody}) => { const fs = require("node:fs"); const summary = JSON.parse(fs.readFileSync(".tmp/pi-deps-summary.json", "utf8")); fs.writeFileSync(".tmp/pi-deps-pr-body.md", renderPullRequestBody(summary)); })'

  - name: Create or update Pi dependency upgrade PR
    if:
      steps.update.outputs.no_update != 'true' &&
      steps.update.outputs.validate_only != 'true'
    uses: peter-evans/create-pull-request@v7
    with:
      branch: automation/pi-deps-${{ steps.update.outputs.target_version }}
      delete-branch: true
      title:
        "chore(deps): update Pi runtime packages to ${{
        steps.update.outputs.target_version }}"
      body-path: .tmp/pi-deps-pr-body.md
      commit-message:
        "chore(deps): update Pi runtime packages to ${{
        steps.update.outputs.target_version }}"
      labels: dependencies, automated-pr
  ```

  The workflow must not include an auto-merge or publish step.

- [ ] **Step 6: Directly validate workflow formatting and no-update/manual
      paths**

  Run:

  ```bash
  npx prettier --check .github/workflows/pi-dependency-upgrade.yml
  node scripts/update-pi-deps.mjs \
    --mode manual \
    --target-version 0.80.10 \
    --validate-only \
    --skip-nix-hash \
    --summary-json .tmp/pi-deps-workflow-validate.json
  ```

  Expected: Prettier passes; the validate-only command exits 0 without editing
  package metadata. Do not add a workflow-YAML content test; this is static CI
  configuration and direct verification is more valuable.

- [ ] **Step 7: Commit the workflow**

  Run:

  ```bash
  git add .github/workflows/pi-dependency-upgrade.yml
  git commit -m "ci: automate pi dependency upgrade prs"
  ```

---

### Task 6: Run final integration validation and document operator usage

**Files:**

- Modify:
  `docs/specs/2026-07-23-issue-96-automate-pi-dependency-upgrade-prs-with-compatibility-validation-design.md`
  only if implementation discoveries require a design correction.
- Create: `docs/pi-dependency-upgrades.md`
- Modify: `README.md` only if the repository already links to automation docs in
  the touched section.

**Interfaces:**

- Consumes: all tasks above.
- Produces: final validation evidence and concise operator documentation for
  manual dispatch, validate-only mode, and local script usage.

- [ ] **Step 1: Apply the Testing Value Gate before adding docs-only tests**

  Do not add automated tests for documentation text. The documentation explains
  operator commands and is verified through markdown linting plus the actual
  commands below.

- [ ] **Step 2: Add operator documentation**

  Create `docs/pi-dependency-upgrades.md` with these sections:

  ````markdown
  # Pi Dependency Upgrades

  Patchmill keeps `@earendil-works/pi-coding-agent` and `@earendil-works/pi-tui`
  on exact pins. The `Pi dependency upgrade` workflow discovers matching newer
  npm `latest` versions on a schedule and opens a review-gated PR after
  compatibility, packed-artifact, npm, and Nix validation pass.

  ## Manual validation

  ```bash
  node scripts/update-pi-deps.mjs \
    --mode manual \
    --target-version 0.80.10 \
    --validate-only \
    --skip-nix-hash \
    --summary-json .tmp/pi-deps-summary.json
  ```

  Omit `--skip-nix-hash` when preparing real dependency changes.

  ## Required local checks for a real upgrade

  ```bash
  node --test src/cli/commands/init/pi-dependency-contract.test.ts
  npm test
  node scripts/smoke-packed-artifact.mjs
  npm run lint
  scripts/update-npm-deps-hash.sh
  nix build .#patchmill --print-build-logs
  ```

  The workflow does not auto-merge or publish Pi dependency upgrades.
  ````

- [ ] **Step 3: Run focused checks**

  Run:

  ```bash
  node --test scripts/pi-dependency-upgrade-lib.test.mjs src/cli/commands/init/pi-dependency-contract.test.ts
  node scripts/update-pi-deps.mjs \
    --mode manual \
    --target-version 0.80.10 \
    --validate-only \
    --skip-nix-hash \
    --summary-json .tmp/pi-deps-final-validate.json
  node scripts/smoke-packed-artifact.mjs
  ```

  Expected: all commands pass. The update script should leave package metadata
  unchanged in validate-only mode.

- [ ] **Step 4: Run full repository validation required for npm/Nix-sensitive
      changes**

  Run:

  ```bash
  npm test
  npm run lint
  scripts/update-npm-deps-hash.sh
  git diff --exit-code -- nix/package.nix
  nix build .#patchmill --print-build-logs
  ```

  Expected: all commands pass; `git diff --exit-code -- nix/package.nix` reports
  no stale hash changes after the update script. These commands satisfy the
  `AGENTS.md` requirement for npm dependency changes in generated upgrade PRs
  and validate that this automation has not broken the current package graph.

- [ ] **Step 5: Inspect final diff for scope and security posture**

  Run:

  ```bash
  git diff --stat
  rg "auto-merge|automerge|npm publish|release" .github/workflows/pi-dependency-upgrade.yml scripts/update-pi-deps.mjs
  ```

  Expected: the diff is limited to the files named in this plan, and any matches
  confirm the workflow does not auto-merge or publish.

- [ ] **Step 6: Commit documentation and final validation notes**

  Run:

  ```bash
  git add docs/pi-dependency-upgrades.md README.md docs/specs/2026-07-23-issue-96-automate-pi-dependency-upgrade-prs-with-compatibility-validation-design.md
  git commit -m "docs: document pi dependency upgrade automation"
  ```

  If `README.md` or the spec did not change, omit those paths from `git add`.

---

## Final Validation Commands

Run these before opening the implementation PR:

```bash
node --test scripts/pi-dependency-upgrade-lib.test.mjs src/cli/commands/init/pi-dependency-contract.test.ts
node scripts/update-pi-deps.mjs \
  --mode manual \
  --target-version 0.80.10 \
  --validate-only \
  --skip-nix-hash \
  --summary-json .tmp/pi-deps-final-validate.json
node scripts/smoke-packed-artifact.mjs
npm test
npm run lint
scripts/update-npm-deps-hash.sh
git diff --exit-code -- nix/package.nix
nix build .#patchmill --print-build-logs
```

## Testing Value Gate Decisions

- Add automated tests for `scripts/pi-dependency-upgrade-lib.mjs` because target
  resolution, exact-pin validation, lockfile mismatch diagnostics, and PR body
  rendering are reusable behavior that can regress meaningfully.
- Keep `src/cli/commands/init/pi-dependency-contract.test.ts` as automated
  coverage because it proves runtime package resolution and Pi SDK capabilities,
  not static dependency text.
- Do not add automated tests for workflow YAML, dependency version strings,
  lockfile contents, or docs. Validate those with Prettier, script dry-runs,
  existing CI commands, and Nix builds.
- Do not add a separate automated test for the packed smoke script's internal
  shell structure. Its value comes from running the script against a real packed
  tarball.

## Self-Review Notes

- Spec coverage: candidate discovery, exact metadata updates, Nix hash refresh,
  compatibility assertions, packed-artifact smoke checks, scheduled/manual PR
  automation, actionable failure logs, review-gated posture, and no-auto-publish
  constraints are each mapped to tasks above.
- Placeholder scan: no step relies on unspecified future work; each command and
  expected outcome is stated directly.
- Interface consistency: Task 2 and Task 5 consume the helper exports introduced
  in Task 1; Task 4 consumes `getRootPins` and `PI_PACKAGES`; final validation
  uses commands created by earlier tasks.
