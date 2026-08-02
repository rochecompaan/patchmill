# Upgrade pi-subagents Child Metadata Contract Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Pin a `pi-subagents` release that exposes authoritative child `model`,
`thinking`, identity, and ordering metadata, then prove Patchmill can load and
validate that release in source, packed npm, and Nix-installed layouts.

**Architecture:** Keep `pi-subagents` as the only authority for child runtime
metadata. Add a small Patchmill-side package-manifest validation helper, extend
resource-profile, packed-artifact, and Nix install checks to prove the resolved
extension files exist in the order Patchmill loads them, and add a live
JSON-mode Pi contract script that validates raw foreground `subagent`
partial/final results for direct, counted, parallel, and chain shapes without
recomputing upstream model or thinking resolution.

**Tech Stack:** TypeScript ESM, Node.js 22.19+/24 `node:test`, npm exact pins
and lockfiles, Pi JSON event stream mode, `pi-subagents`, Nix `buildNpmPackage`.

## Global Constraints

- Pin one exact `pi-subagents` release; `0.37.2` was validated first and blocked
  on missing foreground row identity, and `0.39.0` is the first release that
  passes the contract.
- Do not infer child `model`, `thinking`, identity, or ordering from Patchmill
  configuration, parent Pi settings, agent frontmatter, defaults, array indexes,
  or local copies of upstream resolution logic.
- Missing required metadata or identity for a supported shape blocks the PR; do
  not merge a local fallback or downgraded contract.
- Validate direct single child, counted children, `tasks`-based parallel
  children including a repeated-count task, and chain children including a
  sequential chain and chain parallel fanout when supported by the pinned
  release.
- Preserve absence semantics for legitimate upstream `thinking` absence; absence
  must remain absent rather than backfilled.
- Preserve run-once extension order: dependency-owned `pi-subagents` package
  root first, then Patchmill `extensions/todos.ts`.
- Do not implement Patchmill lifecycle observers, session streaming, progress
  correlation, console rendering, or local upstream resolution logic in this
  issue.
- Do not add `pi-subagents` to helper lists that assume
  `@earendil-works/pi-coding-agent` and `@earendil-works/pi-tui` upgrade in
  version lockstep.
- Because `package.json`, `package-lock.json`, and `npm-shrinkwrap.json` change,
  rerun the Nix build as part of verification.
- Apply Patchmill's Testing Value Gate: automated tests are warranted for
  package manifest parsing, exact-pin/version agreement, installed-file
  resolution, resource-profile extension existence/order, packed/Nix installed
  layout checks, and live child metadata contract parsing; do not add tests that
  merely assert static dependency strings or Nix expression text.

---

## File Structure

- Modify `package.json`: replace `"pi-subagents": "^0.25.0"` with the passing
  exact version, `"0.39.0"`.
- Modify `package-lock.json` and `npm-shrinkwrap.json`: regenerate from npm so
  root dependency entries and `node_modules/pi-subagents.version` agree with the
  exact pin.
- Create `src/pi/pi-subagents-package.ts`: shared helpers that resolve the
  public `pi-subagents` package entry via Node resolution, read the adjacent
  installed manifest, assert the installed version equals the exact root pin,
  and return declared Pi extension file paths that exist as regular files.
- Create `src/pi/pi-subagents-dependency-contract.test.ts`: automated tests for
  exact root pin parsing, installed package version agreement, lockfile and
  shrinkwrap agreement, manifest extension declarations, and normal Pi
  extension-load path resolution.
- Modify `src/pi/resource-profiles.ts`: keep dependency-owned package-root
  resolution separate from Patchmill package-root resolution, but use the helper
  for the resolved `pi-subagents` package root and manifest validation.
- Modify `src/pi/resource-profiles.test.ts`: assert run-once profiles return
  existing extensions in stable order and that the first path is the installed
  `pi-subagents` package root with declared extension files.
- Modify `src/pi/resource-profiles.compiled.test.ts`: assert the compiled layout
  still resolves `pi-subagents` from `node_modules` and validates declared
  extension files.
- Create `scripts/verify-pi-subagents-child-metadata.mjs`: live Pi JSON-mode
  verification that loads `pi-subagents` with `-e <resolved-package-root>`, runs
  direct/counted/parallel/chain/no-thinking fixtures, captures
  `tool_execution_update` and `tool_execution_end`, and validates raw child
  metadata.
- Create `scripts/verify-pi-subagents-child-metadata.test.mjs`: deterministic
  unit tests for the script's JSON event parsing and metadata validation using
  fixture event rows.
- Modify `scripts/smoke-packed-artifact.mjs`: add `pi-subagents` version,
  manifest extension-file, and run-once extension-order checks for the packed
  npm install without adding it to the Pi runtime lockstep package list.
- Modify `nix/package.nix`: refresh `npmDepsHash` and extend `installCheckPhase`
  to verify installed `pi-subagents` version, manifest extension files, and
  run-once extension order.

---

### Task 1: Pin `pi-subagents` exactly and add installed package helpers

**Files:**

- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `npm-shrinkwrap.json`
- Create: `src/pi/pi-subagents-package.ts`
- Create: `src/pi/pi-subagents-dependency-contract.test.ts`

**Interfaces:**

- Produces from `src/pi/pi-subagents-package.ts`:
  - `PI_SUBAGENTS_PACKAGE_NAME = "pi-subagents"`
  - `isExactNpmVersion(spec: string | undefined): spec is string`
  - `readRootPiSubagentsPin(rootPackageJsonPath?: string): string`
  - `resolvePiSubagentsPackageRoot(): string`
  - `readInstalledPiSubagentsManifest(): PiSubagentsPackageManifest`
  - `piSubagentsExtensionFiles(): string[]`
  - `assertInstalledPiSubagentsMatchesRootPin(rootPackageJsonPath?: string): void`
- Consumes: root `package.json`, installed `pi-subagents/package.json`,
  `package-lock.json`, and `npm-shrinkwrap.json`.
- Provides to later tasks: one shared manifest/version contract so resource
  profiles, smoke checks, and Nix checks do not duplicate path rules.

- [ ] **Step 1: Update the dependency pin and npm lock data**

  Run from the repository root:

  ```sh
  npm pkg set dependencies.pi-subagents=0.39.0
  npm install --package-lock-only --ignore-scripts
  tmp_shrinkwrap="$(mktemp)"
  cp npm-shrinkwrap.json "$tmp_shrinkwrap"
  rm npm-shrinkwrap.json
  npm install --package-lock-only --ignore-scripts
  cp "$tmp_shrinkwrap" npm-shrinkwrap.json
  rm "$tmp_shrinkwrap"
  npm install --ignore-scripts
  ```

  Expected: `package.json`, `package-lock.json`, and `npm-shrinkwrap.json`
  change; `package.json.dependencies["pi-subagents"]` is exactly `"0.39.0"`;
  both lockfiles contain
  `packages[""].dependencies["pi-subagents"] === "0.39.0"` and
  `packages["node_modules/pi-subagents"].version === "0.39.0"`.

- [ ] **Step 2: Write the failing dependency contract tests**

  Create `src/pi/pi-subagents-dependency-contract.test.ts` with tests that:

  ```ts
  import assert from "node:assert/strict";
  import { existsSync, readFileSync, statSync } from "node:fs";
  import { spawnSync } from "node:child_process";
  import { dirname, join } from "node:path";
  import { test } from "node:test";
  import { fileURLToPath } from "node:url";
  import {
    assertInstalledPiSubagentsMatchesRootPin,
    isExactNpmVersion,
    piSubagentsExtensionFiles,
    readInstalledPiSubagentsManifest,
    readRootPiSubagentsPin,
    resolvePiSubagentsPackageRoot,
  } from "./pi-subagents-package.ts";

  const rootDir = join(dirname(fileURLToPath(import.meta.url)), "../..");

  function readJson(path: string): unknown {
    return JSON.parse(readFileSync(path, "utf8"));
  }

  test("root pi-subagents dependency is an exact installed pin", () => {
    const pin = readRootPiSubagentsPin(join(rootDir, "package.json"));
    assert.equal(isExactNpmVersion(pin), true);
    assertInstalledPiSubagentsMatchesRootPin(join(rootDir, "package.json"));
  });

  test("lockfiles agree with the root pi-subagents pin", () => {
    const pin = readRootPiSubagentsPin(join(rootDir, "package.json"));
    for (const filename of ["package-lock.json", "npm-shrinkwrap.json"]) {
      const lockfile = readJson(join(rootDir, filename)) as {
        packages?: Record<
          string,
          { version?: string; dependencies?: Record<string, string> }
        >;
      };
      assert.equal(
        lockfile.packages?.[""]?.dependencies?.["pi-subagents"],
        pin,
      );
      assert.equal(
        lockfile.packages?.["node_modules/pi-subagents"]?.version,
        pin,
      );
    }
  });

  test("installed pi-subagents manifest declares existing extension files", () => {
    const packageRoot = resolvePiSubagentsPackageRoot();
    assert.equal(packageRoot.endsWith("pi-subagents"), true);
    const manifest = readInstalledPiSubagentsManifest();
    assert.equal(
      manifest.version,
      readRootPiSubagentsPin(join(rootDir, "package.json")),
    );
    assert.ok(Array.isArray(manifest.pi?.extensions));
    assert.ok((manifest.pi?.extensions ?? []).length > 0);
    for (const extensionFile of piSubagentsExtensionFiles()) {
      assert.equal(extensionFile.startsWith(packageRoot), true);
      assert.equal(
        existsSync(extensionFile),
        true,
        `missing extension ${extensionFile}`,
      );
      assert.equal(
        statSync(extensionFile).isFile(),
        true,
        `not a file ${extensionFile}`,
      );
    }
  });

  test("pi can load the resolved pi-subagents extension package without model execution", () => {
    const result = spawnSync(
      "./node_modules/.bin/pi",
      [
        "--mode",
        "json",
        "--no-session",
        "--offline",
        "-e",
        resolvePiSubagentsPackageRoot(),
        "/subagents-doctor",
      ],
      {
        cwd: rootDir,
        encoding: "utf8",
        timeout: 30_000,
      },
    );
    assert.equal(result.error, undefined);
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.match(
      `${result.stdout}\n${result.stderr}`,
      /subagents|doctor|runtime paths/iu,
    );
    assert.doesNotMatch(
      `${result.stdout}\n${result.stderr}`,
      /Unknown command|No such command|extension load failed/iu,
    );
  });
  ```

- [ ] **Step 3: Run the new test to verify it fails before the helper exists**

  Run:

  ```sh
  node --test src/pi/pi-subagents-dependency-contract.test.ts
  ```

  Expected: FAIL with `ERR_MODULE_NOT_FOUND` for
  `src/pi/pi-subagents-package.ts`.

- [ ] **Step 4: Implement the helper without metadata inference**

  Create `src/pi/pi-subagents-package.ts`:

  ```ts
  import { readFileSync, statSync } from "node:fs";
  import { createRequire } from "node:module";
  import { dirname, resolve } from "node:path";

  const require = createRequire(import.meta.url);
  export const PI_SUBAGENTS_PACKAGE_NAME = "pi-subagents";

  export type PiSubagentsPackageManifest = {
    name?: string;
    version: string;
    pi?: {
      extensions?: string[];
      skills?: string[];
      prompts?: string[];
    };
  };

  export function isExactNpmVersion(spec: string | undefined): spec is string {
    return /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(
      spec ?? "",
    );
  }

  function readJson<T>(path: string): T {
    return JSON.parse(readFileSync(path, "utf8")) as T;
  }

  export function readRootPiSubagentsPin(
    rootPackageJsonPath = resolve("package.json"),
  ): string {
    const packageJson = readJson<{ dependencies?: Record<string, string> }>(
      rootPackageJsonPath,
    );
    const spec = packageJson.dependencies?.[PI_SUBAGENTS_PACKAGE_NAME];
    if (!isExactNpmVersion(spec)) {
      throw new Error(
        `${PI_SUBAGENTS_PACKAGE_NAME} must be pinned to an exact version; found ${spec ?? "missing"}`,
      );
    }
    return spec;
  }

  /**
   * Finds the package directory through the public package entry. pi-subagents
   * intentionally does not export package.json, so resolving that subpath would
   * violate its export map.
   */
  export function resolvePiSubagentsPackageRoot(): string {
    return dirname(require.resolve(PI_SUBAGENTS_PACKAGE_NAME));
  }

  export function resolvePiSubagentsPackageJson(): string {
    return resolve(resolvePiSubagentsPackageRoot(), "package.json");
  }

  export function readInstalledPiSubagentsManifest(): PiSubagentsPackageManifest {
    return readJson<PiSubagentsPackageManifest>(
      resolvePiSubagentsPackageJson(),
    );
  }

  export function piSubagentsExtensionFiles(): string[] {
    const packageRoot = resolvePiSubagentsPackageRoot();
    const manifest = readInstalledPiSubagentsManifest();
    const extensions = manifest.pi?.extensions ?? [];
    if (extensions.length === 0) {
      throw new Error(
        `${PI_SUBAGENTS_PACKAGE_NAME} manifest declares no Pi extensions`,
      );
    }
    return extensions.map((entry) => {
      const extensionPath = resolve(packageRoot, entry);
      if (
        !extensionPath.startsWith(`${packageRoot}/`) &&
        extensionPath !== packageRoot
      ) {
        throw new Error(
          `${PI_SUBAGENTS_PACKAGE_NAME} extension escapes package root: ${entry}`,
        );
      }
      const stats = statSync(extensionPath);
      if (!stats.isFile()) {
        throw new Error(
          `${PI_SUBAGENTS_PACKAGE_NAME} extension is not a regular file: ${extensionPath}`,
        );
      }
      return extensionPath;
    });
  }

  export function assertInstalledPiSubagentsMatchesRootPin(
    rootPackageJsonPath = resolve("package.json"),
  ): void {
    const expected = readRootPiSubagentsPin(rootPackageJsonPath);
    const manifest = readInstalledPiSubagentsManifest();
    if (manifest.version !== expected) {
      throw new Error(
        `${PI_SUBAGENTS_PACKAGE_NAME} resolved ${manifest.version} but package.json pins ${expected}`,
      );
    }
  }
  ```

- [ ] **Step 5: Run the dependency contract test**

  Run:

  ```sh
  node --test src/pi/pi-subagents-dependency-contract.test.ts
  ```

  Expected: PASS. If it fails because installed `0.39.0` omits a Pi extension
  manifest, cannot be resolved through normal Node resolution, or cannot be
  loaded by `pi --mode json --offline -e <package-root> /subagents-doctor`, stop
  and open a focused upstream blocker instead of adding a Patchmill fallback.

- [ ] **Step 6: Commit Task 1**

  Run:

  ```sh
  git add package.json package-lock.json npm-shrinkwrap.json src/pi/pi-subagents-package.ts src/pi/pi-subagents-dependency-contract.test.ts
  git commit -m "chore: pin pi-subagents metadata contract dependency"
  ```

---

### Task 2: Validate run-once resource profiles against the installed package

**Files:**

- Modify: `src/pi/resource-profiles.ts`
- Modify: `src/pi/resource-profiles.test.ts`
- Modify: `src/pi/resource-profiles.compiled.test.ts`

**Interfaces:**

- Consumes from Task 1: `resolvePiSubagentsPackageRoot()` and
  `piSubagentsExtensionFiles()`.
- Preserves: `runOncePlanningPiProfile()`,
  `runOnceDevelopmentEnvironmentPiProfile()`,
  `runOnceImplementationPiProfile()`, `triagePiProfile()`,
  `profileExtensionArgs()`, and public profile shapes.
- Produces: run-once profiles whose first additional extension path is the
  validated installed `pi-subagents` package root and whose second path is the
  Patchmill todos extension.

- [ ] **Step 1: Extend resource-profile tests before changing production code**

  Update `src/pi/resource-profiles.test.ts` so the planning profile test also
  imports `piSubagentsExtensionFiles` and `resolvePiSubagentsPackageRoot` and
  asserts:

  ```ts
  const piSubagentsExtensions = piSubagentsExtensionFiles();
  assert.equal(
    profile.additionalExtensionPaths[0],
    resolvePiSubagentsPackageRoot(),
  );
  assert.ok(piSubagentsExtensions.length > 0);
  assert.equal(
    profile.additionalExtensionPaths[1]
      ?.replaceAll("\\", "/")
      .endsWith("/extensions/todos.ts"),
    true,
  );
  ```

  Keep the existing loop that asserts every profile extension path exists. Add a
  small helper if needed so all run-once profile tests can share the same order
  assertion:

  ```ts
  function assertRunOnceExtensionOrder(extensionPaths: string[]): void {
    assert.equal(extensionPaths.length, 2);
    assert.equal(basename(extensionPaths[0] ?? ""), "pi-subagents");
    assert.equal(
      extensionPaths[1]?.replaceAll("\\", "/").endsWith("/extensions/todos.ts"),
      true,
    );
  }
  ```

- [ ] **Step 2: Run the focused resource-profile test**

  Run:

  ```sh
  node --test src/pi/resource-profiles.test.ts
  ```

  Expected: FAIL if production does not yet validate declared upstream extension
  files; PASS for unchanged order only is not enough, so keep the manifest-file
  assertion in the test.

- [ ] **Step 3: Wire resource profiles to the shared helper**

  In `src/pi/resource-profiles.ts`, replace the local `createRequire`/
  `PI_SUBAGENTS_PACKAGE_ROOT` initialization with the helper while preserving
  Patchmill's separate package-root lookup:

  ```ts
  import {
    piSubagentsExtensionFiles,
    resolvePiSubagentsPackageRoot,
  } from "./pi-subagents-package.ts";

  const PI_SUBAGENTS_PACKAGE_ROOT = resolvePiSubagentsPackageRoot();
  piSubagentsExtensionFiles();
  ```

  Keep `runOnceExtensionPaths()` returning:

  ```ts
  return [PI_SUBAGENTS_PACKAGE_ROOT, PATCHMILL_TODOS_EXTENSION];
  ```

  Do not change triage's empty extension list.

- [ ] **Step 4: Extend the compiled-layout test**

  Update `src/pi/resource-profiles.compiled.test.ts` so after importing the
  compiled profile module it asserts the first extension path is an existing
  `pi-subagents` directory and the installed manifest's declared extensions are
  regular files:

  ```ts
  const profile = compiled.runOncePlanningPiProfile(skills, packageRoot);
  const piSubagentsRoot = profile.additionalExtensionPaths[0];
  const piSubagentsManifest = JSON.parse(
    readFileSync(join(piSubagentsRoot, "package.json"), "utf8"),
  ) as { pi?: { extensions?: string[] } };
  assert.ok((piSubagentsManifest.pi?.extensions ?? []).length > 0);
  for (const extension of piSubagentsManifest.pi?.extensions ?? []) {
    assert.equal(existsSync(join(piSubagentsRoot, extension)), true);
  }
  ```

- [ ] **Step 5: Run focused profile validation**

  Run:

  ```sh
  node --test src/pi/resource-profiles.test.ts
  node --test src/pi/resource-profiles.compiled.test.ts
  ```

  Expected: both PASS. If either test fails because the package manifest points
  at missing upstream files, stop and open/link an upstream blocker; do not make
  Patchmill load guessed paths.

- [ ] **Step 6: Commit Task 2**

  Run:

  ```sh
  git add src/pi/resource-profiles.ts src/pi/resource-profiles.test.ts src/pi/resource-profiles.compiled.test.ts
  git commit -m "test: validate pi-subagents resource profile files"
  ```

---

### Task 3: Add live child metadata contract verification

**Files:**

- Create: `scripts/verify-pi-subagents-child-metadata.mjs`
- Create: `scripts/verify-pi-subagents-child-metadata.test.mjs`

**Interfaces:**

- Produces CLI command: `node scripts/verify-pi-subagents-child-metadata.mjs`.
- Environment contract:
  - `PATCHMILL_PI_SUBAGENTS_CONTRACT_MODEL` is a configured tool-capable Pi
    model for children that should report effective thinking.
  - `PATCHMILL_PI_SUBAGENTS_CONTRACT_THINKING` defaults to `low` and must be one
    Pi thinking level supported by the selected contract model.
  - `PATCHMILL_PI_SUBAGENTS_CONTRACT_NO_THINKING_MODEL` is required and must be
    a configured tool-capable Pi model that legitimately returns absent child
    `thinking` in raw `pi-subagents` child rows.
  - `PATCHMILL_PI_SUBAGENTS_PARENT_MODEL` is optional and can select the parent
    Pi model used to drive the tool calls.
- Consumes: Pi JSON event stream mode (`pi --mode json`), `-e` extension loading
  with the resolved `pi-subagents` package root, and raw
  `tool_execution_update.partialResult` / `tool_execution_end.result` events.
- Produces validation output lines:
  - `direct: metadata contract passed`
  - `counted: metadata contract passed`
  - `parallel: metadata contract passed`
  - `chain: metadata contract passed`
  - `no-thinking: absence contract passed`

- [ ] **Step 1: Write deterministic parser and validator tests first**

  Create `scripts/verify-pi-subagents-child-metadata.test.mjs` with fixture JSON
  event rows that exercise:

  ```js
  import assert from "node:assert/strict";
  import { test } from "node:test";
  import {
    collectSubagentEvents,
    validateShapeContract,
  } from "./verify-pi-subagents-child-metadata.mjs";

  const finalResult = {
    details: {
      results: [
        {
          id: "child-a",
          model: "provider/model-a",
          thinking: "low",
          content: "ok",
        },
        {
          id: "child-b",
          model: "provider/model-a",
          thinking: "low",
          content: "ok",
        },
      ],
    },
  };

  test("validateShapeContract matches partial and final rows by upstream identity", () => {
    const shape = collectSubagentEvents([
      {
        type: "tool_execution_update",
        toolName: "subagent",
        partialResult: {
          details: {
            results: [
              finalResult.details.results[0],
              finalResult.details.results[1],
            ],
          },
        },
      },
      {
        type: "tool_execution_end",
        toolName: "subagent",
        result: finalResult,
        isError: false,
      },
    ]);
    validateShapeContract({
      label: "parallel",
      expectedModel: "provider/model-a",
      expectedThinking: "low",
      expectedFinalChildren: 2,
      requireUniqueSiblingIds: true,
      requireThinking: true,
      shape,
    });
  });

  test("validateShapeContract fails missing model, missing id, duplicate ids, and order drift", () => {
    assert.throws(
      () =>
        validateShapeContract({
          label: "missing-model",
          expectedModel: "provider/model-a",
          expectedThinking: "low",
          expectedFinalChildren: 1,
          requireUniqueSiblingIds: false,
          requireThinking: true,
          shape: collectSubagentEvents([
            {
              type: "tool_execution_end",
              toolName: "subagent",
              result: {
                details: { results: [{ id: "child-a", thinking: "low" }] },
              },
              isError: false,
            },
          ]),
        }),
      /missing model/u,
    );

    assert.throws(
      () =>
        validateShapeContract({
          label: "missing-id",
          expectedModel: "provider/model-a",
          expectedThinking: "low",
          expectedFinalChildren: 1,
          requireUniqueSiblingIds: false,
          requireThinking: true,
          shape: collectSubagentEvents([
            {
              type: "tool_execution_end",
              toolName: "subagent",
              result: {
                details: {
                  results: [{ model: "provider/model-a", thinking: "low" }],
                },
              },
              isError: false,
            },
          ]),
        }),
      /missing upstream identity/u,
    );

    assert.throws(
      () =>
        validateShapeContract({
          label: "duplicate-id",
          expectedModel: "provider/model-a",
          expectedThinking: "low",
          expectedFinalChildren: 2,
          requireUniqueSiblingIds: true,
          requireThinking: true,
          shape: collectSubagentEvents([
            {
              type: "tool_execution_end",
              toolName: "subagent",
              result: {
                details: {
                  results: [
                    { id: "same", model: "provider/model-a", thinking: "low" },
                    { id: "same", model: "provider/model-a", thinking: "low" },
                  ],
                },
              },
            },
          ]),
        }),
      /duplicate upstream identity/u,
    );
  });

  test("validateShapeContract preserves legitimate thinking absence", () => {
    const shape = collectSubagentEvents([
      {
        type: "tool_execution_end",
        toolName: "subagent",
        result: {
          details: {
            results: [{ id: "child-a", model: "provider/no-thinking" }],
          },
        },
        isError: false,
      },
    ]);
    validateShapeContract({
      label: "no-thinking",
      expectedModel: "provider/no-thinking",
      expectedFinalChildren: 1,
      requireUniqueSiblingIds: false,
      requireThinking: false,
      shape,
    });
  });
  ```

  The tests intentionally validate parser behavior and contract failures rather
  than static dependency strings.

- [ ] **Step 2: Run the script tests to verify they fail**

  Run:

  ```sh
  node --test scripts/verify-pi-subagents-child-metadata.test.mjs
  ```

  Expected: FAIL with missing exports from the script.

- [ ] **Step 3: Implement JSON event parsing and validation helpers**

  In `scripts/verify-pi-subagents-child-metadata.mjs`, export pure helpers and
  keep runtime execution behind an entrypoint guard:

  ```js
  export function collectSubagentEvents(events) {
    return {
      partials: events
        .filter(
          (event) =>
            event.type === "tool_execution_update" &&
            event.toolName === "subagent",
        )
        .map((event) => event.partialResult),
      finals: events
        .filter(
          (event) =>
            event.type === "tool_execution_end" &&
            event.toolName === "subagent" &&
            event.isError !== true,
        )
        .map((event) => event.result),
    };
  }

  function childRows(result) {
    if (Array.isArray(result?.details?.results)) return result.details.results;
    throw new Error("subagent result missing details.results child rows");
  }

  function childIdentity(row) {
    return row?.id;
  }

  export function validateShapeContract(options) {
    assert.equal(
      options.shape.finals.length,
      1,
      `${options.label}: expected exactly one final subagent tool result`,
    );
    const finalChildren = options.shape.finals.flatMap(childRows);
    if (finalChildren.length !== options.expectedFinalChildren) {
      throw new Error(
        `${options.label}: expected exactly ${options.expectedFinalChildren} final children, got ${finalChildren.length}`,
      );
    }
    const finalIds = finalChildren.map(childIdentity);
    finalChildren.forEach((child, index) => {
      if (!finalIds[index])
        throw new Error(
          `${options.label}: child ${index} missing upstream identity`,
        );
      if (child.model !== options.expectedModel)
        throw new Error(
          `${options.label}: child ${finalIds[index]} missing model ${options.expectedModel}`,
        );
      if (
        options.requireThinking &&
        child.thinking !== options.expectedThinking
      ) {
        throw new Error(
          `${options.label}: child ${finalIds[index]} missing thinking ${options.expectedThinking}`,
        );
      }
      if (!options.requireThinking && "thinking" in child) {
        throw new Error(
          `${options.label}: expected thinking absence but found ${child.thinking}`,
        );
      }
    });
    if (
      options.requireUniqueSiblingIds &&
      new Set(finalIds).size !== finalIds.length
    ) {
      throw new Error(
        `${options.label}: duplicate upstream identity in final children`,
      );
    }
    if (options.shape.partials.length === 0) {
      console.log(`${options.label}: upstream emitted no partial results`);
    }
    for (const partial of options.shape.partials) {
      const partialChildren = childRows(partial);
      const partialIds = partialChildren.map(childIdentity);
      if (partialIds.length === 0) {
        console.log(`${options.label}: partial result contained no child rows`);
        continue;
      }
      partialChildren.forEach((child, index) => {
        if (!partialIds[index])
          throw new Error(
            `${options.label}: partial child ${index} missing upstream identity`,
          );
        if (child.model !== options.expectedModel)
          throw new Error(
            `${options.label}: partial child ${partialIds[index]} missing model ${options.expectedModel}`,
          );
        if (
          options.requireThinking &&
          child.thinking !== options.expectedThinking
        ) {
          throw new Error(
            `${options.label}: partial child ${partialIds[index]} missing thinking ${options.expectedThinking}`,
          );
        }
        if (!options.requireThinking && "thinking" in child) {
          throw new Error(
            `${options.label}: partial child ${partialIds[index]} unexpectedly had thinking ${child.thinking}`,
          );
        }
      });
      assert.deepEqual(partialIds, finalIds.slice(0, partialIds.length));
    }
  }
  ```

  Import `assert` from `node:assert/strict`. Keep accepted identity field names
  restricted to upstream-supplied identity fields present in raw rows; never use
  array positions as identities.

- [ ] **Step 4: Implement the live Pi runner**

  Add a runtime entrypoint that:
  1. Reads the exact root `pi-subagents` pin and installed package root using
     normal Node resolution.
  2. Creates a temporary project with local `.pi/agents/contract-thinking.md`
     and `.pi/agents/contract-no-thinking.md` using exact frontmatter:

     ```md
     ---
     name: contract-thinking
     model: <PATCHMILL_PI_SUBAGENTS_CONTRACT_MODEL>
     thinking: <PATCHMILL_PI_SUBAGENTS_CONTRACT_THINKING>
     tools: bash
     systemPromptMode: replace
     inheritProjectContext: false
     inheritSkills: false
     ---

     Return exactly the short text requested by the parent. Do not call tools.
     ```

     ```md
     ---
     name: contract-no-thinking
     model: <PATCHMILL_PI_SUBAGENTS_CONTRACT_NO_THINKING_MODEL>
     tools: bash
     systemPromptMode: replace
     inheritProjectContext: false
     inheritSkills: false
     ---

     Return exactly the short text requested by the parent. Do not call tools.
     ```

  3. Spawns Pi once per shape with:

     ```sh
     pi --mode json --no-context-files --no-prompt-templates -e <pi-subagents-package-root> --model <parent-model-if-set> "<shape prompt>"
     ```

  4. Parses stdout JSON lines and validates only the raw `subagent` tool
     partial/final events. Require exactly one successful `subagent` tool result
     per shape and exact final child counts: direct `1`, counted `2`, parallel
     `3`, chain `3`, and no-thinking `1`.

  Use shape prompts that force the parent to call the tool once with exact JSON
  inputs, for example:

  ```text
  Call the subagent tool exactly once with this input and then stop:
  {"agent":"contract-thinking","task":"Return the word direct.","context":"fresh"}
  ```

  Use analogous inputs for:

  ```json
  {"tasks":[{"agent":"contract-thinking","task":"Return the word counted.","count":2}],"concurrency":2,"context":"fresh"}
  {"tasks":[{"agent":"contract-thinking","task":"Return parallel a."},{"agent":"contract-thinking","task":"Return repeated parallel.","count":2}],"concurrency":2,"context":"fresh"}
  {"chain":[{"agent":"contract-thinking","task":"Return chain step one."},{"parallel":[{"agent":"contract-thinking","task":"Return chain fanout a."},{"agent":"contract-thinking","task":"Return chain fanout b."}]}],"context":"fresh","clarify":false}
  {"agent":"contract-no-thinking","task":"Return the words no thinking.","context":"fresh"}
  ```

  If the pinned release rejects chain parallel fanout as unsupported, the script
  must fail with an explicit message that includes the raw command output so the
  implementer can open a focused upstream blocker.

- [ ] **Step 5: Run deterministic tests and live metadata validation**

  Run:

  ```sh
  node --test scripts/verify-pi-subagents-child-metadata.test.mjs
  PATCHMILL_PI_SUBAGENTS_CONTRACT_MODEL="anthropic/claude-sonnet-4-5" \
    PATCHMILL_PI_SUBAGENTS_CONTRACT_THINKING="low" \
    PATCHMILL_PI_SUBAGENTS_CONTRACT_NO_THINKING_MODEL="openai/gpt-4o" \
    node scripts/verify-pi-subagents-child-metadata.mjs
  ```

  Expected: tests PASS; the live script prints the four required
  `metadata contract passed` lines and `no-thinking: absence contract passed`.
  If any supported shape lacks model, thinking, identity, uniqueness, or
  ordering, or if no configured no-thinking model can prove absence semantics,
  stop the PR, capture the failing command output, and open/link a focused
  upstream blocker.

- [ ] **Step 6: Commit Task 3**

  Run:

  ```sh
  git add scripts/verify-pi-subagents-child-metadata.mjs scripts/verify-pi-subagents-child-metadata.test.mjs
  git commit -m "test: verify pi-subagents child metadata contract"
  ```

---

### Task 4: Extend packed npm and Nix installed-layout verification

**Files:**

- Modify: `scripts/smoke-packed-artifact.mjs`
- Modify: `nix/package.nix`

**Interfaces:**

- Consumes from Task 1: exact root pin and package manifest contract. The npm
  smoke script may import `isExactVersion` from
  `scripts/pi-dependency-upgrade-lib.mjs`, but must not add `pi-subagents` to
  `PI_PACKAGES`.
- Preserves: existing packed artifact checks for Patchmill initialization and Pi
  runtime packages.
- Produces: packed npm and Nix installed checks that prove `pi-subagents`
  version agreement, manifest extension files, and run-once extension order.

- [ ] **Step 1: Extend packed npm smoke checks**

  In `scripts/smoke-packed-artifact.mjs`, add local helpers:

  ```js
  const PI_SUBAGENTS_PACKAGE = "pi-subagents";

  function assertPiSubagentsInstalled({
    projectRequire,
    nodeModulesDir,
    rootPin,
  }) {
    const packagePath = join(
      nodeModulesDir,
      PI_SUBAGENTS_PACKAGE,
      "package.json",
    );
    if (!existsSync(packagePath))
      throw new Error(`Could not locate ${packagePath}`);
    const manifest = JSON.parse(readFileSync(packagePath, "utf8"));
    if (manifest.version !== rootPin) {
      throw new Error(
        `${PI_SUBAGENTS_PACKAGE} resolved ${manifest.version} but package.json pins ${rootPin}`,
      );
    }
    for (const extension of manifest.pi?.extensions ?? []) {
      const extensionPath = join(dirname(packagePath), extension);
      if (!existsSync(extensionPath))
        throw new Error(
          `Missing ${PI_SUBAGENTS_PACKAGE} extension: ${extensionPath}`,
        );
    }
    projectRequire.resolve(`${PI_SUBAGENTS_PACKAGE}/package.json`);
  }
  ```

  Use the project installation's `patchmill` package root to import
  `dist/src/pi/resource-profiles.js`, call `runOncePlanningPiProfile()`, and
  assert `additionalExtensionPaths[0]` is the installed `pi-subagents` package
  root and `additionalExtensionPaths[1]` ends with `/extensions/todos.ts`.

- [ ] **Step 2: Run the packed smoke script**

  Run:

  ```sh
  node scripts/smoke-packed-artifact.mjs
  ```

  Expected: PASS and output includes a line equivalent to
  `pi-subagents resolved 0.39.0 from <packed-project>/node_modules/pi-subagents/package.json`.

- [ ] **Step 3: Extend Nix install checks**

  In `nix/package.nix`, update the existing `installCheckPhase` Node snippet so
  it reads `$out/share/${pname}/package.json`, resolves
  `$out/share/${pname}/node_modules/pi-subagents/package.json`, and checks:

  ```js
  const rootPin = packageJson.dependencies["pi-subagents"];
  if (piSubagents.version !== rootPin)
    throw new Error("pi-subagents version drift");
  const extensionPaths = piSubagents.pi.extensions.map((entry) =>
    join(piSubagentsRoot, entry),
  );
  const missing = extensionPaths.filter(
    (extensionPath) => !existsSync(extensionPath),
  );
  if (missing.length > 0)
    throw new Error(
      `missing pi-subagents extension paths: ''${missing.join(", ")}`,
    );
  const profile = runOncePlanningPiProfile(skills, process.cwd());
  assert.equal(
    realpathSync(profile.additionalExtensionPaths[0]),
    realpathSync(piSubagentsRoot),
  );
  assert.equal(
    profile.additionalExtensionPaths[1]
      .replaceAll("\\", "/")
      .endsWith("/extensions/todos.ts"),
    true,
  );
  ```

  Import `readFileSync`, `realpathSync`, and `strict as assert` in the snippet
  as needed so symlinked `$out/share/${pname}/node_modules` paths compare by
  canonical filesystem identity.

- [ ] **Step 4: Refresh `npmDepsHash`**

  Run:

  ```sh
  scripts/update-npm-deps-hash.sh
  git diff -- nix/package.nix
  ```

  Expected: `nix/package.nix` has a new `npmDepsHash` and the install-check
  snippet changes from Step 3.

- [ ] **Step 5: Run packed and focused source checks**

  Run:

  ```sh
  node --test src/pi/pi-subagents-dependency-contract.test.ts
  node --test src/pi/resource-profiles.test.ts
  node --test src/pi/resource-profiles.compiled.test.ts
  node --test scripts/verify-pi-subagents-child-metadata.test.mjs
  node scripts/smoke-packed-artifact.mjs
  ```

  Expected: all PASS.

- [ ] **Step 6: Commit Task 4**

  Run:

  ```sh
  git add scripts/smoke-packed-artifact.mjs nix/package.nix
  git commit -m "test: verify pi-subagents installed artifact contract"
  ```

---

### Task 5: Run full dependency-update validation and prepare the PR

**Files:**

- Modify only if validation exposes a Task 1-4 defect: the affected source,
  script, lock, or Nix file.

**Interfaces:**

- Consumes: all Task 1-4 deliverables.
- Produces: final evidence that source, npm, Nix, packed artifact, extension
  loading, and live child metadata contracts agree on the same upstream version.

- [ ] **Step 1: Run the focused contract and resource-profile commands**

  Run:

  ```sh
  node --test src/pi/resource-profiles.test.ts
  node --test src/pi/pi-subagents-dependency-contract.test.ts
  PATCHMILL_PI_SUBAGENTS_CONTRACT_MODEL="anthropic/claude-sonnet-4-5" \
    PATCHMILL_PI_SUBAGENTS_CONTRACT_THINKING="low" \
    PATCHMILL_PI_SUBAGENTS_CONTRACT_NO_THINKING_MODEL="openai/gpt-4o" \
    node scripts/verify-pi-subagents-child-metadata.mjs
  ```

  Expected: PASS; live metadata output includes `direct`, `counted`, `parallel`,
  and `chain` contract passed lines. If Pi credentials are missing, configure
  normal Pi credentials and rerun; do not replace this command with source
  inspection.

- [ ] **Step 2: Run the full npm test suite and packed artifact smoke**

  Run:

  ```sh
  npm test
  node scripts/smoke-packed-artifact.mjs
  npm run lint
  ```

  Expected: all PASS.

- [ ] **Step 3: Confirm the Nix dependency hash is current**

  Run:

  ```sh
  scripts/update-npm-deps-hash.sh
  git diff --exit-code -- nix/package.nix
  ```

  Expected: `scripts/update-npm-deps-hash.sh` reports the hash already matches,
  and `git diff --exit-code -- nix/package.nix` exits 0. If the script updates
  the hash, commit the `nix/package.nix` change and rerun this step.

- [ ] **Step 4: Run full Nix verification required for npm dependency changes**

  Run:

  ```sh
  nix build .#patchmill --print-build-logs
  nix flake check --print-build-logs
  ```

  Expected: both PASS, including the Nix install check that validates installed
  `pi-subagents` manifest extension files and extension order.

- [ ] **Step 5: Inspect final dependency agreement**

  Run:

  ```sh
  node - <<'NODE'
  const fs = require('node:fs');
  for (const file of ['package.json', 'package-lock.json', 'npm-shrinkwrap.json']) {
    const json = JSON.parse(fs.readFileSync(file, 'utf8'));
    console.log(file, json.dependencies?.['pi-subagents'] ?? json.packages?.['']?.dependencies?.['pi-subagents'], json.packages?.['node_modules/pi-subagents']?.version ?? 'root');
  }
  const piSubagentsEntry = require.resolve('pi-subagents');
  const piSubagentsManifest = require('node:path').join(require('node:path').dirname(piSubagentsEntry), 'package.json');
  console.log('installed', JSON.parse(fs.readFileSync(piSubagentsManifest, 'utf8')).version);
  NODE
  ```

  Expected: every printed `pi-subagents` value is the same exact version,
  expected `0.39.0`.

- [ ] **Step 6: Commit validation fixes if any, then ensure the final branch is
      clean except intended changes**

  If validation fixes changed files, run:

  ```sh
  git add <affected-source-script-lock-or-nix-files>
  git commit -m "test: finalize pi-subagents contract validation"
  ```

  Then run:

  ```sh
  git status --short
  ```

  Expected: no unstaged changes after committing any validation fixes. Do not
  commit `.pi/todos` files.
