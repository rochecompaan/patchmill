# Pi Extension Package-Root Resolution Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Resolve and validate Patchmill-owned resources from one
nearest-ancestor package root in source, compiled/npm-packed, and Nix-installed
layouts.

**Architecture:** Add a synchronous `findPackageRoot()` utility under `src/`,
migrate the three explicitly approved consumers to it, and keep dependency-owned
`pi-subagents` resolution separate. Probe package boundaries with fail-fast
filesystem semantics, validate the todos extension during profile
initialization, and commit a compiled-layout regression test before adding npm
and Nix installation checks.

**Tech Stack:** TypeScript ESM, Node.js 22.19+/24, `node:test`, npm package
tarballs, Nix `buildNpmPackage` install checks.

## Global Constraints

- The human reviewer explicitly approved migrating resource profiles,
  setup-test-repo fixtures, and version lookup during #121 design review.
- The resolver returns the nearest ancestor containing a regular `package.json`
  file.
- The resolver suppresses only `ENOENT` and `ENOTDIR`; `EACCES`, `ELOOP`, and
  all other filesystem failures propagate unchanged.
- The resolver normalizes the start directory but does not parse `package.json`,
  validate its package name, call `realpath`, or cache results.
- `readPackageVersion()` preserves its established
  `Could not locate Patchmill package.json` not-found message by translating
  only the resolver's typed not-found error and retaining it as `cause`.
- Resource-profile initialization verifies that `extensions/todos.ts` is a
  regular file and fails immediately when it is absent, inaccessible, cyclic, or
  not a file.
- Preserve run-once extension order: `pi-subagents`, then `extensions/todos.ts`.
- Preserve triage's empty extension list, successful CLI output, fixture
  behavior, and public function signatures.
- Do not change dependencies, package metadata, lock files, `pi-subagents`,
  lifecycle observers, or progress-reporting behavior.
- Verify source, compiled, npm-packed, and Nix-installed layouts.
- Apply Patchmill's Testing Value Gate: behavior tests cover the resolver and
  consumers; Nix expression text is verified by the Nix build rather than a
  static-content test.

---

### Task 1: Add fail-fast package-root discovery and migrate fixture/version lookup

**Files:**

- Create: `src/package-root.ts`
- Create: `src/package-root.test.ts`
- Modify: `src/cli/commands/setup-test-repo/fixtures.ts:1-33`
- Modify: `src/cli/commands/setup-test-repo/fixtures.test.ts:1-29`
- Modify: `src/cli/commands/version/main.ts:1-62`
- Create: `src/cli/commands/version/main.test.ts`

**Interfaces:**

- Produces: `PackageRootNotFoundError` and
  `findPackageRoot(startDir: string): string` from `src/package-root.ts`.
- Consumes: Node filesystem/path APIs only; no package-specific metadata.
- Preserves: `resolveFixtureDirectory(startDir?: string): Promise<string>` and
  `readPackageVersion(moduleUrl?: string): string`.
- Provides to Task 2: a synchronous resolver safe to call during
  resource-profile module initialization.

- [ ] **Step 1: Write the failing resolver tests**

Create `src/package-root.test.ts`:

```ts
import assert from "node:assert/strict";
import fs from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { test } from "node:test";
import { findPackageRoot, PackageRootNotFoundError } from "./package-root.ts";

async function temporaryDirectory(): Promise<string> {
  return mkdtemp(join(tmpdir(), "patchmill-package-root-"));
}

async function writePackageJson(directory: string): Promise<void> {
  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, "package.json"), "{}\n", "utf8");
}

function systemError(code: string): NodeJS.ErrnoException {
  const error = new Error(code) as NodeJS.ErrnoException;
  error.code = code;
  return error;
}

test("findPackageRoot walks up from source and arbitrarily nested dist layouts", async () => {
  const packageRoot = await temporaryDirectory();
  const sourceDirectory = join(packageRoot, "src", "pi");
  const distDirectory = join(packageRoot, "dist", "src", "pi", "nested");

  try {
    await writePackageJson(packageRoot);
    await mkdir(sourceDirectory, { recursive: true });
    await mkdir(distDirectory, { recursive: true });

    assert.equal(findPackageRoot(sourceDirectory), packageRoot);
    assert.equal(findPackageRoot(distDirectory), packageRoot);
    assert.equal(
      findPackageRoot(relative(process.cwd(), distDirectory)),
      packageRoot,
    );
  } finally {
    await rm(packageRoot, { recursive: true, force: true });
  }
});

test("findPackageRoot returns the nearest package boundary", async () => {
  const outerRoot = await temporaryDirectory();
  const innerRoot = join(outerRoot, "packages", "inner");
  const startDirectory = join(innerRoot, "dist", "src", "feature");

  try {
    await writePackageJson(outerRoot);
    await writePackageJson(innerRoot);
    await mkdir(startDirectory, { recursive: true });

    assert.equal(findPackageRoot(startDirectory), innerRoot);
  } finally {
    await rm(outerRoot, { recursive: true, force: true });
  }
});

test("findPackageRoot rejects a non-file package boundary", async () => {
  const packageRoot = await temporaryDirectory();
  const startDirectory = join(packageRoot, "src", "feature");

  try {
    await mkdir(join(packageRoot, "package.json"), { recursive: true });
    await mkdir(startDirectory, { recursive: true });

    assert.throws(
      () => findPackageRoot(startDirectory),
      /package\.json is not a regular file/u,
    );
  } finally {
    await rm(packageRoot, { recursive: true, force: true });
  }
});

for (const code of ["ENOENT", "ENOTDIR"] as const) {
  test(`findPackageRoot continues after ${code}`, (context) => {
    const startDirectory = resolve("virtual", "package", "nested");
    const expectedRoot = dirname(startDirectory);
    let calls = 0;

    context.mock.method(fs, "statSync", () => {
      calls += 1;
      if (calls === 1) throw systemError(code);
      return {
        isFile: () => true,
      } as ReturnType<typeof fs.statSync>;
    });

    assert.equal(findPackageRoot(startDirectory), expectedRoot);
    assert.equal(calls, 2);
  });
}

for (const code of ["EACCES", "ELOOP"] as const) {
  test(`findPackageRoot propagates ${code}`, (context) => {
    const expected = systemError(code);
    context.mock.method(fs, "statSync", () => {
      throw expected;
    });

    assert.throws(
      () => findPackageRoot(resolve("virtual", "nested")),
      (error: unknown) => error === expected,
    );
  });
}

test("findPackageRoot throws a typed error with the normalized start", (context) => {
  const startDirectory = resolve("virtual", "without-package", "nested");
  context.mock.method(fs, "statSync", () => {
    throw systemError("ENOENT");
  });

  assert.throws(
    () => findPackageRoot(startDirectory),
    (error: unknown) => {
      assert.ok(error instanceof PackageRootNotFoundError);
      assert.equal(error.startDir, startDirectory);
      assert.equal(
        error.message,
        `Could not find package root walking up from ${startDirectory}`,
      );
      return true;
    },
  );
});
```

The tests use `node:test`'s scoped mock on the mutable `node:fs` default export.
This deterministically proves `EACCES`/`ELOOP` propagation without adding
dependency injection to the production API.

- [ ] **Step 2: Run the resolver test to verify it fails**

Run:

```sh
node --test src/package-root.test.ts
```

Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `src/package-root.ts`.

- [ ] **Step 3: Implement the minimal fail-fast resolver**

Create `src/package-root.ts`:

```ts
import fs from "node:fs";
import { dirname, join, resolve } from "node:path";

function hasErrorCode(error: unknown, code: string): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === code
  );
}

function isAbsentPathError(error: unknown): boolean {
  return hasErrorCode(error, "ENOENT") || hasErrorCode(error, "ENOTDIR");
}

export class PackageRootNotFoundError extends Error {
  readonly startDir: string;

  constructor(startDir: string) {
    super(`Could not find package root walking up from ${startDir}`);
    this.name = "PackageRootNotFoundError";
    this.startDir = startDir;
  }
}

export function findPackageRoot(startDir: string): string {
  const normalizedStart = resolve(startDir);
  let current = normalizedStart;

  for (;;) {
    const packageJsonPath = join(current, "package.json");
    try {
      const stats = fs.statSync(packageJsonPath);
      if (!stats.isFile()) {
        throw new Error(`${packageJsonPath} is not a regular file`);
      }
      return current;
    } catch (error) {
      if (!isAbsentPathError(error)) throw error;
    }

    const parent = dirname(current);
    if (parent === current) {
      throw new PackageRootNotFoundError(normalizedStart);
    }
    current = parent;
  }
}
```

The catch has one explicit responsibility: translate only stable absence codes
into upward traversal. Access, symlink, validation, and unknown failures are
rethrown unchanged.

- [ ] **Step 4: Run the resolver test to verify it passes**

Run:

```sh
node --test src/package-root.test.ts
```

Expected: PASS with 8 tests and 0 failures.

- [ ] **Step 5: Add consumer tests before migrating the consumers**

In `src/cli/commands/setup-test-repo/fixtures.test.ts`, replace the existing
`"resolveFixtureDirectory finds fixtures from the package root"` test with:

```ts
test("resolveFixtureDirectory finds fixtures from a nested package layout", async () => {
  const packageRoot = await tempDir();
  const nestedModuleDirectory = join(
    packageRoot,
    "dist",
    "src",
    "cli",
    "commands",
    "setup-test-repo",
  );

  try {
    await mkdir(nestedModuleDirectory, { recursive: true });
    await writeFile(join(packageRoot, "package.json"), "{}\n", "utf8");

    assert.equal(
      await resolveFixtureDirectory(nestedModuleDirectory),
      join(packageRoot, "fixtures", "patchmill-test-repo"),
    );
  } finally {
    await rm(packageRoot, { recursive: true, force: true });
  }
});
```

Create `src/cli/commands/version/main.test.ts`:

```ts
import assert from "node:assert/strict";
import fs from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";
import { pathToFileURL } from "node:url";
import { PackageRootNotFoundError } from "../../../package-root.ts";
import { readPackageVersion } from "./main.ts";

type PackageTree = {
  moduleUrl: string;
  packageRoot: string;
};

async function withPackageJson(
  contents: string,
  run: (tree: PackageTree) => void,
): Promise<void> {
  const packageRoot = await mkdtemp(join(tmpdir(), "patchmill-version-"));
  const moduleDirectory = join(
    packageRoot,
    "dist",
    "deep",
    "src",
    "cli",
    "commands",
    "version",
  );

  try {
    await mkdir(moduleDirectory, { recursive: true });
    await writeFile(join(packageRoot, "package.json"), contents, "utf8");
    run({
      moduleUrl: pathToFileURL(join(moduleDirectory, "main.js")).href,
      packageRoot,
    });
  } finally {
    await rm(packageRoot, { recursive: true, force: true });
  }
}

function systemError(code: string): NodeJS.ErrnoException {
  const error = new Error(code) as NodeJS.ErrnoException;
  error.code = code;
  return error;
}

test("readPackageVersion finds the nearest package from arbitrary nesting", async () => {
  await withPackageJson('{"version":"9.8.7"}\n', ({ moduleUrl }) => {
    assert.equal(readPackageVersion(moduleUrl), "9.8.7");
  });
});

test("readPackageVersion preserves malformed JSON failures", async () => {
  await withPackageJson("{", ({ moduleUrl }) => {
    assert.throws(() => readPackageVersion(moduleUrl), SyntaxError);
  });
});

test("readPackageVersion rejects a non-string version", async () => {
  await withPackageJson('{"version":123}\n', ({ moduleUrl, packageRoot }) => {
    assert.throws(
      () => readPackageVersion(moduleUrl),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.equal(
          error.message,
          `package.json at ${join(packageRoot, "package.json")} does not contain a string version`,
        );
        return true;
      },
    );
  });
});

test("readPackageVersion preserves its public missing-root error", (context) => {
  context.mock.method(fs, "statSync", () => {
    throw systemError("ENOENT");
  });
  const moduleUrl = pathToFileURL(
    resolve("virtual", "without-package", "main.js"),
  ).href;

  assert.throws(
    () => readPackageVersion(moduleUrl),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.equal(error.message, "Could not locate Patchmill package.json");
      assert.ok(error.cause instanceof PackageRootNotFoundError);
      return true;
    },
  );
});

test("readPackageVersion propagates package-root access failures", (context) => {
  const expected = systemError("EACCES");
  context.mock.method(fs, "statSync", () => {
    throw expected;
  });
  const moduleUrl = pathToFileURL(resolve("virtual", "main.js")).href;

  assert.throws(
    () => readPackageVersion(moduleUrl),
    (error: unknown) => error === expected,
  );
});
```

- [ ] **Step 6: Run the consumer tests to expose fixed-depth version lookup**

Run:

```sh
node --test \
  src/cli/commands/setup-test-repo/fixtures.test.ts \
  src/cli/commands/version/main.test.ts
```

Expected: the fixture tests pass; the arbitrarily nested version cases fail
before reading their temporary `package.json`, and the not-found test fails
because the current error has no typed resolver cause.

- [ ] **Step 7: Migrate fixture and version lookup to the shared resolver**

In `src/cli/commands/setup-test-repo/fixtures.ts`:

1. Replace the path import with:

```ts
import { dirname, join } from "node:path";
```

1. Add the shared import:

```ts
import { findPackageRoot } from "../../../package-root.ts";
```

1. Delete the private `findPackageRoot()` function at current lines 18-26. Keep
   the asynchronous `exists()` helper because fixture validation still uses it.

1. Replace `resolveFixtureDirectory()` with:

```ts
export async function resolveFixtureDirectory(
  startDir = dirname(fileURLToPath(import.meta.url)),
): Promise<string> {
  const packageRoot = findPackageRoot(startDir);
  return join(packageRoot, FIXTURE_RELATIVE_PATH);
}
```

In `src/cli/commands/version/main.ts`:

1. Add:

```ts
import {
  findPackageRoot,
  PackageRootNotFoundError,
} from "../../../package-root.ts";
```

1. Delete `hasErrorCode()` and `packageJsonCandidates()`.

1. Replace `readPackageVersion()` with:

```ts
export function readPackageVersion(moduleUrl = import.meta.url): string {
  let packageRoot: string;
  try {
    packageRoot = findPackageRoot(dirname(fileURLToPath(moduleUrl)));
  } catch (error) {
    if (error instanceof PackageRootNotFoundError) {
      throw new Error("Could not locate Patchmill package.json", {
        cause: error,
      });
    }
    throw error;
  }

  const packageJsonPath = join(packageRoot, "package.json");
  const packageJson = JSON.parse(
    readFileSync(packageJsonPath, "utf8"),
  ) as PackageJson;

  if (typeof packageJson.version !== "string") {
    throw new Error(
      `package.json at ${packageJsonPath} does not contain a string version`,
    );
  }
  return packageJson.version;
}
```

This catch is the explicit compatibility boundary for one expected failure mode:
exhausted root traversal. It rethrows the established public error with the
typed resolver error as `cause`; every other failure propagates unchanged.

- [ ] **Step 8: Format and run all Task 1 tests**

Run:

```sh
npx prettier --write \
  src/package-root.ts \
  src/package-root.test.ts \
  src/cli/commands/setup-test-repo/fixtures.ts \
  src/cli/commands/setup-test-repo/fixtures.test.ts \
  src/cli/commands/version/main.ts \
  src/cli/commands/version/main.test.ts
node --test \
  src/package-root.test.ts \
  src/cli/commands/setup-test-repo/fixtures.test.ts \
  src/cli/commands/version/main.test.ts
```

Expected: Prettier exits 0; all focused tests pass with 0 failures.

- [ ] **Step 9: Commit the shared resolver migration**

Run:

```sh
git add \
  src/package-root.ts \
  src/package-root.test.ts \
  src/cli/commands/setup-test-repo/fixtures.ts \
  src/cli/commands/setup-test-repo/fixtures.test.ts \
  src/cli/commands/version/main.ts \
  src/cli/commands/version/main.test.ts
git commit -m "fix(paths): centralize package-root discovery"
```

Expected: one commit containing only the shared resolver, its fail-fast tests,
and the fixture/version migrations.

---

### Task 2: Validate Pi extensions in source and compiled layouts

**Files:**

- Modify: `src/pi/resource-profiles.ts:1-21`
- Modify: `src/pi/resource-profiles.test.ts:1-56`
- Create: `src/pi/resource-profiles.compiled.test.ts`

**Interfaces:**

- Consumes: Task 1's `findPackageRoot(startDir: string): string`.
- Preserves: all exported profile types/functions and the two-item extension
  order.
- Produces: a todos-extension path rooted at the nearest package boundary and
  validated as a regular file during module initialization.
- Provides to Task 3: committed compiled-layout coverage plus resource-profile
  behavior that can be checked in npm-packed and Nix-installed layouts.

- [ ] **Step 1: Add source-layout extension-existence coverage**

In `src/pi/resource-profiles.test.ts`, add this import after the assert import:

```ts
import { existsSync } from "node:fs";
```

In the existing
`"run-once planning profile includes context and Patchmill run-once extensions"`
test, add this block after the todos suffix assertion:

```ts
for (const extensionPath of profile.additionalExtensionPaths) {
  assert.equal(
    existsSync(extensionPath),
    true,
    `missing extension: ${extensionPath}`,
  );
}
```

- [ ] **Step 2: Run the source test as a characterization check**

Run:

```sh
node --test src/pi/resource-profiles.test.ts
```

Expected: PASS. The current fixed-depth code works in the source layout, which
is why a compiled-layout test is required.

- [ ] **Step 3: Write the failing committed compiled-layout test**

Create `src/pi/resource-profiles.compiled.test.ts`:

```ts
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { copyFile, mkdir, mkdtemp, rm, symlink } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { findPackageRoot } from "../package-root.ts";
import type { PatchmillSkillsConfig } from "../workflow/skills.ts";

const require = createRequire(import.meta.url);
const sourceRoot = findPackageRoot(dirname(fileURLToPath(import.meta.url)));
const tscPath = require.resolve("typescript/bin/tsc");

const skills: PatchmillSkillsConfig = {
  triage: "triage",
  planning: "planning",
  implementation: "implementation",
  developmentEnvironment: "development-environment",
  toolchain: "toolchain",
  review: "review",
  visualEvidence: "visual-evidence",
  landing: "landing",
};

test(
  "compiled resource profiles resolve and require package-owned extensions",
  { timeout: 60_000 },
  async () => {
    const packageRoot = await mkdtemp(
      join(tmpdir(), "patchmill-compiled-profile-"),
    );
    const compiledProfile = join(
      packageRoot,
      "dist",
      "src",
      "pi",
      "resource-profiles.js",
    );
    const todosExtension = join(packageRoot, "extensions", "todos.ts");

    try {
      await mkdir(dirname(todosExtension), { recursive: true });
      await copyFile(
        join(sourceRoot, "package.json"),
        join(packageRoot, "package.json"),
      );
      await copyFile(
        join(sourceRoot, "extensions", "todos.ts"),
        todosExtension,
      );
      await symlink(
        join(sourceRoot, "node_modules"),
        join(packageRoot, "node_modules"),
        process.platform === "win32" ? "junction" : "dir",
      );

      const build = spawnSync(
        process.execPath,
        [
          tscPath,
          "-p",
          join(sourceRoot, "tsconfig.build.json"),
          "--rootDir",
          sourceRoot,
          "--outDir",
          join(packageRoot, "dist"),
        ],
        {
          cwd: sourceRoot,
          encoding: "utf8",
          timeout: 45_000,
        },
      );
      assert.equal(build.error, undefined);
      assert.equal(build.status, 0, build.stderr || build.stdout);

      const compiled = await import(pathToFileURL(compiledProfile).href);
      const profile = compiled.runOncePlanningPiProfile(skills, packageRoot);
      assert.deepEqual(
        profile.additionalExtensionPaths.map((path: string) =>
          existsSync(path),
        ),
        [true, true],
      );
      assert.equal(
        profile.additionalExtensionPaths[1]
          ?.replaceAll("\\", "/")
          .endsWith("/extensions/todos.ts"),
        true,
      );

      const missingProfile = join(
        dirname(compiledProfile),
        "resource-profiles-missing.js",
      );
      await copyFile(compiledProfile, missingProfile);
      await rm(todosExtension);

      await assert.rejects(
        import(pathToFileURL(missingProfile).href),
        (error: unknown) => {
          assert.ok(error instanceof Error);
          assert.equal((error as NodeJS.ErrnoException).code, "ENOENT");
          assert.match(error.message, /extensions[\\/]todos\.ts/u);
          return true;
        },
      );
    } finally {
      await rm(packageRoot, { recursive: true, force: true });
    }
  },
);
```

This test compiles the actual production module into an isolated package root.
It does not inspect source text, and it fails if the module derives
`<package>/dist` as its root or if initialization tolerates a missing todos
extension.

- [ ] **Step 4: Run the compiled test to verify it fails**

Run:

```sh
node --test src/pi/resource-profiles.compiled.test.ts
```

Expected: FAIL because the first import resolves a missing path ending in
`dist/extensions/todos.ts`.

- [ ] **Step 5: Replace fixed-depth resolution and validate the extension**

In `src/pi/resource-profiles.ts`:

1. Add the filesystem import:

```ts
import fs from "node:fs";
```

1. Replace the path import with:

```ts
import { dirname, join } from "node:path";
```

1. Add:

```ts
import { findPackageRoot } from "../package-root.ts";
```

1. Add this direct validation helper next to the package-root constants:

```ts
function requireRegularFile(path: string): string {
  const stats = fs.statSync(path);
  if (!stats.isFile()) {
    throw new Error(`Patchmill extension is not a regular file: ${path}`);
  }
  return path;
}
```

1. Replace the current Patchmill root/todos constants with:

```ts
const PATCHMILL_PACKAGE_ROOT = findPackageRoot(
  dirname(fileURLToPath(import.meta.url)),
);
const PATCHMILL_TODOS_EXTENSION = requireRegularFile(
  join(PATCHMILL_PACKAGE_ROOT, "extensions", "todos.ts"),
);
```

`requireRegularFile()` intentionally has no catch. Missing files, access
failures, and symlink loops retain their stable filesystem errors; a successful
stat of a non-file becomes an explicit validation error.

Do not change `PI_SUBAGENTS_PACKAGE_ROOT`, `runOnceExtensionPaths()`, or profile
composition.

- [ ] **Step 6: Format and run Task 2 tests**

Run:

```sh
npx prettier --write \
  src/pi/resource-profiles.ts \
  src/pi/resource-profiles.test.ts \
  src/pi/resource-profiles.compiled.test.ts
node --test \
  src/package-root.test.ts \
  src/pi/resource-profiles.test.ts \
  src/pi/resource-profiles.compiled.test.ts
```

Expected: Prettier exits 0; source, resolver, compiled-layout, and
missing-extension assertions all pass with 0 failures.

- [ ] **Step 7: Commit the Pi extension fix**

Run:

```sh
git add \
  src/pi/resource-profiles.ts \
  src/pi/resource-profiles.test.ts \
  src/pi/resource-profiles.compiled.test.ts
git commit -m "fix(pi): resolve and validate packaged extensions"
```

Expected: one commit containing only the resource-profile fix and
source/compiled behavior tests.

---

### Task 3: Verify npm-packed and Nix-installed layouts

**Files:**

- Modify: `nix/package.nix:64-78`
- Verify: all Task 1 and Task 2 files

**Interfaces:**

- Consumes: Task 2's compiled/source resource profile and two ordered extension
  paths.
- Produces: a Nix install check that imports the installed profile and fails
  when any configured extension path is missing.
- Verifies directly: an npm tarball installed into a temporary project resolves
  the same existing extension files.

- [ ] **Step 1: Add the Nix installed-layout assertion**

In `nix/package.nix`, add the following immediately after the existing fixture
assertion in `installCheckPhase`:

```nix
    test -f "$out/share/${pname}/extensions/todos.ts"
    (
      cd "$out/share/${pname}"
      ${nodejs_24}/bin/node --input-type=module -e "
        import { existsSync } from 'node:fs';
        import { runOncePlanningPiProfile } from './src/pi/resource-profiles.ts';
        const skills = {
          triage: 'triage', planning: 'planning', implementation: 'implementation',
          developmentEnvironment: 'development-environment', toolchain: 'toolchain',
          review: 'review', visualEvidence: 'visual-evidence', landing: 'landing',
        };
        const profile = runOncePlanningPiProfile(skills, process.cwd());
        const missing = profile.additionalExtensionPaths.filter(
          (extensionPath) => !existsSync(extensionPath),
        );
        if (missing.length > 0) {
          console.error('missing installed extension paths:', missing.join(', '));
          process.exit(1);
        }
        console.log('all installed extension paths exist');
      "
    )
```

This is direct Nix runtime verification, not a static test of expression text.

- [ ] **Step 2: Build the Nix package and run its install check**

Run:

```sh
nix build .#patchmill --no-link --print-build-logs
```

Expected: PASS. The install check prints `all installed extension paths exist`;
any missing shared resolver, dependency extension, or todos extension fails the
build.

- [ ] **Step 3: Pack, install, and verify the compiled npm artifact**

Run:

```sh
set -eu
ROOT="$PWD"
WORK="$(mktemp -d)"
cleanup() {
  cd "$ROOT"
  rm -rf "$WORK"
}
trap cleanup EXIT

PACK_JSON="$WORK/npm-pack.json"
HUSKY=0 npm pack --json --pack-destination "$WORK" >"$PACK_JSON"
TARBALL="$WORK/$(node -pe "JSON.parse(require('fs').readFileSync(0, 'utf8'))[0].filename" <"$PACK_JSON")"
test -f "$TARBALL"

INSTALL_DIR="$WORK/install"
mkdir -p "$INSTALL_DIR"
cd "$INSTALL_DIR"
npm init -y >/dev/null
npm install --ignore-scripts "$TARBALL" >/dev/null
node --input-type=module <<'NODE'
import { existsSync } from "node:fs";
import { runOncePlanningPiProfile } from "./node_modules/patchmill/dist/src/pi/resource-profiles.js";

const skills = {
  triage: "triage",
  planning: "planning",
  implementation: "implementation",
  developmentEnvironment: "development-environment",
  toolchain: "toolchain",
  review: "review",
  visualEvidence: "visual-evidence",
  landing: "landing",
};
const profile = runOncePlanningPiProfile(skills, process.cwd());
const missing = profile.additionalExtensionPaths.filter(
  (extensionPath) => !existsSync(extensionPath),
);
if (missing.length > 0) {
  console.error("missing packed extension paths:", missing.join(", "));
  process.exit(1);
}
if (
  !profile.additionalExtensionPaths[1]
    ?.replaceAll("\\", "/")
    .endsWith("/extensions/todos.ts")
) {
  console.error("todos extension order changed");
  process.exit(1);
}
console.log("all extension paths exist in the packed install");
NODE
```

Expected: prints `all extension paths exist in the packed install` and
returns 0. `WORK` exists before packing, so the trap removes the tarball and any
partial/corrupt JSON output even when `npm pack` or JSON decoding fails;
decoding remains fail-loud.

- [ ] **Step 4: Run focused and full project verification**

Run:

```sh
node --test \
  src/package-root.test.ts \
  src/pi/resource-profiles.test.ts \
  src/pi/resource-profiles.compiled.test.ts \
  src/cli/commands/setup-test-repo/fixtures.test.ts \
  src/cli/commands/version/main.test.ts
npm test
npm run lint
npm run build
nix build .#patchmill --no-link --print-build-logs
```

Expected: all focused tests pass; the full suite has 0 failures; lint has 0
errors or warnings; TypeScript compilation succeeds; and the Nix package/install
check succeeds.

- [ ] **Step 5: Check the complete implementation diff**

Run:

```sh
BASE_SHA="$(git merge-base main HEAD)"
git diff --check "$BASE_SHA"...HEAD
git diff --check
git diff --stat "$BASE_SHA"
git status --short
```

Expected: both diff checks print nothing; the stat contains only the approved
spec/plan plus Task 1-3 files; status shows only `nix/package.nix` modified.

- [ ] **Step 6: Commit the Nix installed-layout verification**

Run:

```sh
git add nix/package.nix
git commit -m "test(nix): verify installed extension paths"
```

Expected: one commit containing only the Nix install-check change.

- [ ] **Step 7: Confirm the final branch is clean**

Run:

```sh
git status --short
git log --oneline main..HEAD
```

Expected: status prints nothing. The log contains the committed spec and plan
followed by the three implementation commits; no observer, progress-reporting,
dependency, package metadata, or lock-file changes are present.
