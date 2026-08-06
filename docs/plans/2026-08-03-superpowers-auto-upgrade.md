# Superpowers Auto-Upgrade Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an independent daily workflow that opens a review-gated
Superpowers upgrade pull request containing every intervening upstream release
note and fully synchronized package, skill-pack, and Nix metadata.

**Architecture:** Keep the existing Pi updater unchanged. Add a focused
Superpowers release library, a filesystem transaction helper, and a dedicated
updater CLI; the GitHub workflow orchestrates the updater, existing validation
commands, and App-token pull-request creation. Treat `package.json` as the
canonical installed pin and verify every generated reference against it.

**Tech Stack:** Node.js 24 ESM, TypeScript tests through Node's test runner, npm
lockfiles, GitHub REST Releases API, GitHub Actions, Patchmill's existing skill
installer, and Nix `buildNpmPackage`.

**Design:** `docs/specs/2026-08-03-superpowers-auto-upgrade-design.md`

## Global Constraints

- Keep `.github/workflows/pi-dependency-upgrade.yml`,
  `scripts/update-pi-deps.mjs`, and their existing behavior unchanged.
- Create a dedicated daily Superpowers workflow and a separate
  `automation/superpowers-vX.Y.Z` pull request.
- Do not upgrade the current `v6.0.3` Superpowers pin in the automation
  implementation commit; the new workflow must propose that upgrade separately.
- Use only stable `obra/superpowers` GitHub Releases; exclude drafts and
  prereleases.
- Embed every non-empty upstream release body after the current pin through the
  target, ordered from oldest to newest.
- Fail before pull-request creation when release notes, package metadata,
  configured skills, project-local metadata, tests, packaging, or Nix checks are
  incomplete.
- Preserve the canonical dependency form
  `https://github.com/obra/superpowers/archive/refs/tags/vX.Y.Z.tar.gz`.
- Keep pull requests review-gated; do not auto-merge or publish.
- Do not add a test that merely asserts workflow YAML text. Verify workflow YAML
  with formatting and `actionlint` instead.
- Use the existing `repairMissingLockfileIntegrities` helper and
  `scripts/update-npm-deps-hash.sh`; add no npm dependency.

---

### Task 1: Superpowers release discovery and PR rendering

**Files:**

- Create: `scripts/superpowers-upgrade-lib.mjs`
- Create: `scripts/superpowers-upgrade-lib.test.mjs`

**Interfaces:**

- Produces:
  - `SUPERPOWERS_PACKAGE: "superpowers"`
  - `SUPERPOWERS_REPOSITORY: "obra/superpowers"`
  - `normalizeVersion(value, label?): string`
  - `tagForVersion(version): string`
  - `tarballUrlForVersion(version): string`
  - `getCurrentSuperpowersVersion(packageJson): string`
  - `compareVersions(a, b): number`
  - `normalizeGitHubRelease(release): Release | undefined`
  - `fetchStableReleases({ fetchImpl, token, repository? }): Promise<Release[]>`
  - `fetchReleasePackageVersion({ fetchImpl, token, repository?, tag }): Promise<string>`
  - `resolveSuperpowersUpgrade({ currentVersion, requestedVersion?, releases }): UpgradeResolution`
  - `assertLockfilesMatchSuperpowersTarget({ packageJson, packageLock, shrinkwrap, targetVersion }): void`
  - `renderSuperpowersPullRequestBody(summary): string`
- `Release` has `{ tag, version, name, htmlUrl, publishedAt, body }` string
  fields.
- `UpgradeResolution` has
  `{ noUpdate, currentVersion, targetVersion, targetTag, releases }`, where
  `releases` is the ascending in-range release list.
- Consumed by Tasks 3, 4, and 5.

- [ ] **Step 1: Write failing version and dependency-spec tests**

Add table-driven tests that establish strict stable versions and the canonical
GitHub tarball URL:

```js
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  compareVersions,
  getCurrentSuperpowersVersion,
  normalizeVersion,
  tagForVersion,
  tarballUrlForVersion,
} from "./superpowers-upgrade-lib.mjs";

const currentSpec =
  "https://github.com/obra/superpowers/archive/refs/tags/v6.0.3.tar.gz";

test("normalizes stable versions and constructs canonical references", () => {
  assert.equal(normalizeVersion("v6.2.0"), "6.2.0");
  assert.equal(tagForVersion("6.2.0"), "v6.2.0");
  assert.equal(
    tarballUrlForVersion("6.2.0"),
    "https://github.com/obra/superpowers/archive/refs/tags/v6.2.0.tar.gz",
  );
  assert.equal(compareVersions("6.1.1", "6.2.0"), -1);
});

test("rejects prerelease and malformed versions", () => {
  for (const value of ["6.2", "6.2.0-beta.1", "release-6.2.0", "06.2.0"]) {
    assert.throws(() => normalizeVersion(value), /stable X\.Y\.Z version/);
  }
});

test("reads the current version only from the canonical dependency URL", () => {
  assert.equal(
    getCurrentSuperpowersVersion({
      dependencies: { superpowers: currentSpec },
    }),
    "6.0.3",
  );
  assert.throws(
    () =>
      getCurrentSuperpowersVersion({
        dependencies: { superpowers: "github:obra/superpowers#v6.0.3" },
      }),
    /canonical GitHub tag tarball/,
  );
});
```

- [ ] **Step 2: Run the version tests to verify RED**

Run:

```bash
node --test scripts/superpowers-upgrade-lib.test.mjs
```

Expected: FAIL with `ERR_MODULE_NOT_FOUND` for
`scripts/superpowers-upgrade-lib.mjs`.

- [ ] **Step 3: Implement strict version and package-spec helpers**

Create the library constants and helpers with these exact validation rules:

```js
export const SUPERPOWERS_PACKAGE = "superpowers";
export const SUPERPOWERS_REPOSITORY = "obra/superpowers";

const stableVersionPattern = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/u;
const canonicalSpecPattern =
  /^https:\/\/github\.com\/obra\/superpowers\/archive\/refs\/tags\/v((?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*))\.tar\.gz$/u;

export function normalizeVersion(value, label = "Superpowers version") {
  const normalized = value.startsWith("v") ? value.slice(1) : value;
  if (!stableVersionPattern.test(normalized)) {
    throw new Error(`${label} must be a stable X.Y.Z version; found ${value}`);
  }
  return normalized;
}

export function tagForVersion(version) {
  return `v${normalizeVersion(version)}`;
}

export function tarballUrlForVersion(version) {
  return `https://github.com/obra/superpowers/archive/refs/tags/${tagForVersion(version)}.tar.gz`;
}

export function compareVersions(a, b) {
  const left = normalizeVersion(a).split(".").map(Number);
  const right = normalizeVersion(b).split(".").map(Number);
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) return left[index] - right[index];
  }
  return 0;
}

export function getCurrentSuperpowersVersion(packageJson) {
  const spec = packageJson.dependencies?.[SUPERPOWERS_PACKAGE];
  const match = canonicalSpecPattern.exec(spec ?? "");
  if (!match) {
    throw new Error(
      `${SUPERPOWERS_PACKAGE} must use the canonical GitHub tag tarball; found ${spec ?? "missing"}`,
    );
  }
  return normalizeVersion(match[1]);
}
```

- [ ] **Step 4: Run the version tests to verify GREEN**

Run:

```bash
node --test scripts/superpowers-upgrade-lib.test.mjs
```

Expected: PASS for the three version/spec tests.

- [ ] **Step 5: Add failing paginated release-discovery and range tests**

Use dependency-injected `fetchImpl` responses. Include two API pages so the test
proves pagination, and include drafts and prereleases so the test proves they
are excluded:

```js
function githubResponse(body, { link, status = 200 } = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json",
      ...(link ? { link } : {}),
    },
  });
}

function release(tag, overrides = {}) {
  return {
    tag_name: tag,
    name: tag,
    html_url: `https://github.com/obra/superpowers/releases/tag/${tag}`,
    published_at: `2026-07-${tag === "v6.2.0" ? "24" : "20"}T00:00:00Z`,
    body: `Notes for ${tag}`,
    draft: false,
    prerelease: false,
    ...overrides,
  };
}

test("fetches every stable release page and selects the full upgrade range", async () => {
  const requests = [];
  const fetchImpl = async (url, options) => {
    requests.push({ url: String(url), options });
    if (String(url).endsWith("page=1")) {
      return githubResponse(
        [release("v6.2.0"), release("v6.2.0-beta.1", { prerelease: true })],
        {
          link: '<https://api.github.com/repos/obra/superpowers/releases?per_page=100&page=2>; rel="next"',
        },
      );
    }
    return githubResponse([
      release("v6.1.1"),
      release("v6.1.0"),
      release("v6.0.3"),
      release("v6.0.2", { draft: true }),
    ]);
  };

  const releases = await fetchStableReleases({ fetchImpl, token: "token" });
  const result = resolveSuperpowersUpgrade({
    currentVersion: "6.0.3",
    releases,
  });

  assert.equal(requests.length, 2);
  assert.equal(requests[0].options.headers.authorization, "Bearer token");
  assert.deepEqual(
    result.releases.map(({ tag }) => tag),
    ["v6.1.0", "v6.1.1", "v6.2.0"],
  );
  assert.equal(result.targetVersion, "6.2.0");
  assert.equal(result.noUpdate, false);
});

test("requires a stable release and a non-empty body for every selected version", () => {
  assert.throws(
    () =>
      resolveSuperpowersUpgrade({
        currentVersion: "6.0.3",
        requestedVersion: "6.2.0",
        releases: [
          normalizeGitHubRelease(release("v6.2.0")),
          normalizeGitHubRelease(release("v6.1.0", { body: "  " })),
        ],
      }),
    /v6\.1\.0 has no release-note body/,
  );
});

test("returns no-update for an equal target", () => {
  const result = resolveSuperpowersUpgrade({
    currentVersion: "6.0.3",
    requestedVersion: "6.0.3",
    releases: [normalizeGitHubRelease(release("v6.0.3"))],
  });
  assert.equal(result.noUpdate, true);
  assert.deepEqual(result.releases, []);
});
```

Import `fetchStableReleases`, `normalizeGitHubRelease`, and
`resolveSuperpowersUpgrade` in the test.

- [ ] **Step 6: Run the release tests to verify RED**

Run:

```bash
node --test scripts/superpowers-upgrade-lib.test.mjs
```

Expected: FAIL because the release functions are not exported.

- [ ] **Step 7: Implement authenticated pagination and range resolution**

Implement GitHub requests with `per_page=100`, follow the RFC 5988 `rel="next"`
link until absent, normalize stable releases, sort by semantic version, require
the target release, then select versions satisfying
`current < release <= target`. Validate non-empty bodies only for selected
releases so historical notes below the current pin cannot block an upgrade.

Use headers that are stable in GitHub Actions:

```js
function githubHeaders(token) {
  return {
    accept: "application/vnd.github+json",
    "x-github-api-version": "2022-11-28",
    ...(token ? { authorization: `Bearer ${token}` } : {}),
  };
}
```

When a request fails, include repository, endpoint, status, and status text in
the thrown error. Reject a requested target absent from the stable release list.

- [ ] **Step 8: Add failing release-package and PR-body tests**

Test the GitHub contents response and exact release-note ordering:

```js
test("verifies that the release package version matches its tag", async () => {
  const fetchImpl = async () =>
    githubResponse({
      encoding: "base64",
      content: Buffer.from(JSON.stringify({ version: "6.2.0" })).toString(
        "base64",
      ),
    });
  assert.equal(
    await fetchReleasePackageVersion({
      fetchImpl,
      token: "token",
      tag: "v6.2.0",
    }),
    "6.2.0",
  );
});

test("renders every release body oldest to newest", () => {
  const body = renderSuperpowersPullRequestBody({
    currentVersion: "6.0.3",
    targetVersion: "6.2.0",
    changedFiles: ["package.json", ".patchmill/skills/writing-plans/SKILL.md"],
    validationCommands: [
      "npm test",
      "nix build .#patchmill --print-build-logs",
    ],
    releases: [
      normalizeGitHubRelease(release("v6.1.0")),
      normalizeGitHubRelease(release("v6.1.1")),
      normalizeGitHubRelease(release("v6.2.0")),
    ],
  });
  assert.ok(body.indexOf("### v6.1.0") < body.indexOf("### v6.1.1"));
  assert.ok(body.indexOf("### v6.1.1") < body.indexOf("### v6.2.0"));
  assert.match(body, /Notes for v6\.1\.0/);
  assert.match(body, /does not auto-merge or publish/);
});
```

Also assert that rendering rejects a body longer than GitHub's 65,536-character
limit instead of truncating upstream notes.

- [ ] **Step 9: Implement package-version fetching and PR rendering**

Fetch `package.json` through
`/repos/obra/superpowers/contents/package.json?ref=vX.Y.Z`, decode base64, parse
its `version`, and require it to equal the normalized tag. Render release bodies
verbatim into a Markdown string with current/target versions, changed files,
validation commands, publication dates, and release links. Check
`body.length <= 65_536` before returning.

- [ ] **Step 10: Add failing lockfile consistency tests**

Create valid `package.json`, `package-lock.json`, and `npm-shrinkwrap.json`
fixtures containing the canonical target spec, `version`, `resolved`, and
`integrity`. Mutate each field one at a time and assert errors identify the
file, expected value, and actual value.

- [ ] **Step 11: Implement lockfile consistency validation**

For both lockfiles, validate:

```js
const expectedSpec = tarballUrlForVersion(targetVersion);
const rootSpec = lockfile.packages?.[""]?.dependencies?.superpowers;
const installed = lockfile.packages?.["node_modules/superpowers"];
```

Require `rootSpec === expectedSpec`, `installed.version === targetVersion`,
`installed.resolved === expectedSpec`, and a non-empty `installed.integrity`.
Apply the same package dependency check to `package.json`.

- [ ] **Step 12: Run the complete library test file**

Run:

```bash
node --test scripts/superpowers-upgrade-lib.test.mjs
```

Expected: all release, package, rendering, and lockfile tests PASS.

- [ ] **Step 13: Commit Task 1**

```bash
git add scripts/superpowers-upgrade-lib.mjs \
  scripts/superpowers-upgrade-lib.test.mjs
git commit -m "feat(deps): add Superpowers release selection"
```

---

### Task 2: Transactional tracked-file snapshots

**Files:**

- Create: `scripts/tracked-files.mjs`
- Create: `scripts/tracked-files.test.mjs`

**Interfaces:**

- Produces:
  - `snapshotTrackedPaths(rootDir, relativeRoots): Promise<Snapshot>`
  - `changedTrackedFiles(before, after): string[]`
  - `restoreTrackedPaths(rootDir, relativeRoots, snapshot): Promise<void>`
- `Snapshot` is a `Map<string, { content: Buffer, mode: number }>` keyed by
  POSIX-style repository-relative file paths.
- Consumed by Task 3 for rollback and Git-independent changed-file reporting.

- [ ] **Step 1: Write failing snapshot, diff, and restoration tests**

Use a temporary root containing individual metadata files and a nested
`.patchmill/skills` tree. Test modification, addition, deletion, executable
mode, and complete rollback:

```js
import assert from "node:assert/strict";
import {
  access,
  chmod,
  mkdtemp,
  mkdir,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  changedTrackedFiles,
  restoreTrackedPaths,
  snapshotTrackedPaths,
} from "./tracked-files.mjs";

test("reports and restores nested tracked file changes without Git", async () => {
  const root = await mkdtemp(join(tmpdir(), "patchmill-tracked-files-"));
  const roots = ["package.json", ".patchmill/skills"];
  try {
    await mkdir(join(root, ".patchmill/skills/writing-plans"), {
      recursive: true,
    });
    await writeFile(join(root, "package.json"), "old package\n");
    const skill = join(root, ".patchmill/skills/writing-plans/SKILL.md");
    await writeFile(skill, "old skill\n");
    await chmod(skill, 0o755);
    const before = await snapshotTrackedPaths(root, roots);

    await writeFile(join(root, "package.json"), "new package\n");
    await rm(skill);
    await writeFile(
      join(root, ".patchmill/skills/writing-plans/reference.md"),
      "new reference\n",
    );
    const after = await snapshotTrackedPaths(root, roots);

    assert.deepEqual(changedTrackedFiles(before, after), [
      ".patchmill/skills/writing-plans/SKILL.md",
      ".patchmill/skills/writing-plans/reference.md",
      "package.json",
    ]);

    await restoreTrackedPaths(root, roots, before);
    assert.equal(
      await readFile(join(root, "package.json"), "utf8"),
      "old package\n",
    );
    assert.equal(await readFile(skill, "utf8"), "old skill\n");
    assert.equal((await stat(skill)).mode & 0o777, 0o755);
    await assert.rejects(
      access(join(root, ".patchmill/skills/writing-plans/reference.md")),
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
```

Add a second test proving an initially absent tracked root is removed during
rollback.

- [ ] **Step 2: Run the tracked-file tests to verify RED**

Run:

```bash
node --test scripts/tracked-files.test.mjs
```

Expected: FAIL with `ERR_MODULE_NOT_FOUND`.

- [ ] **Step 3: Implement recursive snapshots and restoration**

Use `lstat` and sorted `readdir({ withFileTypes: true })`. Record regular file
bytes and permission mode, normalize keys with `/`, and reject symbolic links or
special files with an error naming the path. Missing roots contribute no map
entries.

`restoreTrackedPaths` must remove every tracked root recursively before
recreating snapshot directories/files. `changedTrackedFiles` compares the union
of keys and reports changed content or mode in lexical order.

- [ ] **Step 4: Run the tracked-file tests to verify GREEN**

Run:

```bash
node --test scripts/tracked-files.test.mjs
```

Expected: all snapshot and restoration tests PASS.

- [ ] **Step 5: Commit Task 2**

```bash
git add scripts/tracked-files.mjs scripts/tracked-files.test.mjs
git commit -m "feat(deps): add tracked file transactions"
```

---

### Task 3: Dedicated Superpowers updater CLI

**Files:**

- Create: `scripts/update-superpowers.mjs`
- Create: `scripts/update-superpowers.test.mjs`
- Modify: `scripts/superpowers-upgrade-lib.mjs`
- Modify: `scripts/superpowers-upgrade-lib.test.mjs`

**Interfaces:**

- Consumes all Task 1 release/lock helpers and Task 2 transaction helpers.
- Produces:
  - CLI flags `--mode scheduled|manual`, `--superpowers-version X.Y.Z`,
    `--validate-only`, `--skip-nix-hash`, and `--summary-json PATH`.
  - `runSuperpowersUpgrade(args, dependencies?): Promise<Summary>` for tests.
  - Summary JSON fields
    `{ currentVersion, targetVersion, targetTag, noUpdate, validateOnly, releases, changedFiles, validationCommands, error? }`.
- The production entry point invokes
  `runSuperpowersUpgrade(process.argv.slice(2))` and exits nonzero after writing
  failure summary JSON.
- Consumed by Task 5's workflow.

- [ ] **Step 1: Write failing argument and validate-only tests**

Test the exported runner with a temporary repository fixture and injected
`fetchImpl`/`runCommand`. The fixture must not contain `.git`, proving the
updater does not rely on Git.

Define deterministic test helpers before the cases:

```js
const fixtureTrackedRoots = [
  "package.json",
  "package-lock.json",
  "npm-shrinkwrap.json",
  "nix/package.nix",
  "src/workflow/skill-pack.ts",
  "THIRD_PARTY_NOTICES.md",
  ".patchmill/skills",
];

async function snapshotFixture(rootDir) {
  const snapshot = await snapshotTrackedPaths(rootDir, fixtureTrackedRoots);
  return [...snapshot].map(([path, entry]) => [
    path,
    entry.content.toString("base64"),
    entry.mode,
  ]);
}

function release(tag) {
  return {
    tag_name: tag,
    name: tag,
    html_url: `https://github.com/obra/superpowers/releases/tag/${tag}`,
    published_at: "2026-07-24T00:00:00Z",
    body: `Notes for ${tag}`,
    draft: false,
    prerelease: false,
  };
}

async function releaseFetch(url) {
  if (String(url).includes("/contents/package.json")) {
    return new Response(
      JSON.stringify({
        encoding: "base64",
        content: Buffer.from(JSON.stringify({ version: "6.2.0" })).toString(
          "base64",
        ),
      }),
      { status: 200 },
    );
  }
  return new Response(
    JSON.stringify([
      release("v6.2.0"),
      release("v6.1.1"),
      release("v6.1.0"),
      release("v6.0.3"),
    ]),
    { status: 200 },
  );
}
```

Import `snapshotTrackedPaths` from Task 2. Cover these cases:

```js
test("validate-only resolves all release notes without mutating files", async () => {
  const before = await snapshotFixture(rootDir);
  const summary = await runSuperpowersUpgrade(
    ["--mode", "manual", "--superpowers-version", "6.2.0", "--validate-only"],
    {
      rootDir,
      fetchImpl: releaseFetch,
      runCommand: async () =>
        assert.fail("validate-only must not run commands"),
    },
  );
  assert.equal(summary.currentVersion, "6.0.3");
  assert.equal(summary.targetVersion, "6.2.0");
  assert.deepEqual(
    summary.releases.map(({ tag }) => tag),
    ["v6.1.0", "v6.1.1", "v6.2.0"],
  );
  assert.deepEqual(summary.changedFiles, []);
  assert.deepEqual(await snapshotFixture(rootDir), before);
});

test("records argument failures in summary JSON", async () => {
  await assert.rejects(
    runSuperpowersUpgrade(
      ["--mode", "invalid", "--summary-json", summaryPath],
      { rootDir, fetchImpl: releaseFetch },
    ),
    /--mode must be scheduled or manual/,
  );
  const summary = JSON.parse(await readFile(summaryPath, "utf8"));
  assert.match(summary.error, /--mode must be scheduled or manual/);
  assert.deepEqual(summary.changedFiles, []);
});
```

Also test scheduled latest selection and equal-version no-update behavior.

- [ ] **Step 2: Run updater tests to verify RED**

Run:

```bash
node --test scripts/update-superpowers.test.mjs
```

Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `update-superpowers.mjs`.

- [ ] **Step 3: Implement CLI parsing, release resolution, and summaries**

Use the same `summaryPathFromArgs` safety pattern as `update-pi-deps.mjs`, so
parse errors can still be recorded. Manual mode accepts an omitted explicit
version and then selects latest stable, matching the workflow's optional input.

Define validation commands exactly once in the summary:

```js
const validationCommands = [
  "npm ci",
  "node bin/patchmill.ts skills update",
  "node --test src/cli/commands/init/pi-dependency-contract.test.ts",
  "npm test",
  "node scripts/smoke-packed-artifact.mjs",
  "npm run lint",
  "scripts/update-npm-deps-hash.sh",
  "nix build .#patchmill --print-build-logs",
];
```

Fetch releases and the target tag's `package.json`; require its package version
to equal `targetVersion`. Add an internal
`assertSynchronizedRepository(rootDir, expectedVersion)` helper that reads both
lockfiles, `src/workflow/skill-pack.ts`, `THIRD_PARTY_NOTICES.md`, and
`.patchmill/skills/patchmill-skill-pack.json`. It must call
`assertLockfilesMatchSuperpowersTarget`, require exactly two expected tags in
the live skill-pack source, exactly one expected tagged notice URL, and matching
project-local source metadata. In `validate-only`, call this helper with
`currentVersion`, verify every configured upstream `SKILL.md` exists under the
installed `superpowers/skills` directory, collect target release notes, write
the summary, and do not mutate or invoke commands.

- [ ] **Step 4: Add failing metadata mutation tests**

Build a fixture with the real shapes of:

- `package.json`;
- both npm lockfiles;
- `src/workflow/skill-pack.ts` containing exactly two `v6.0.3` references;
- `THIRD_PARTY_NOTICES.md` containing exactly one tagged source reference;
- `.patchmill/skills/patchmill-skill-pack.json`.

Inject a `runCommand` fake that records commands and simulates npm lockfile
output and skill-pack metadata generation. Assert a successful upgrade:

- writes the canonical `v6.2.0` package URL;
- updates exactly the expected skill-pack and notice references;
- invokes lockfile generation, `npm ci`, `patchmill skills update`, and the Nix
  hash updater in order;
- validates both resulting lockfiles;
- lists nested `.patchmill/skills` changes without Git.

- [ ] **Step 5: Implement transactional metadata updates**

Track these roots:

```js
const trackedRoots = [
  "package.json",
  "package-lock.json",
  "npm-shrinkwrap.json",
  "nix/package.nix",
  "src/workflow/skill-pack.ts",
  "THIRD_PARTY_NOTICES.md",
  ".patchmill/skills",
];
```

Apply mutations in this order:

1. Snapshot all tracked roots.
2. Write the canonical target tarball to `package.json`.
3. Replace exactly two current tags in `src/workflow/skill-pack.ts`; fail if the
   match count differs.
4. Replace exactly one current tag in `THIRD_PARTY_NOTICES.md`; fail if the
   match count differs.
5. Regenerate both lockfiles using the same two-pass shrinkwrap/package-lock
   sequence used by `update-pi-deps.mjs`.
6. Call `repairMissingLockfileIntegrities` for both lockfiles and write them.
7. Call `assertLockfilesMatchSuperpowersTarget`.
8. Run `npm ci`.
9. Run `node bin/patchmill.ts skills update`.
10. Run `scripts/update-npm-deps-hash.sh` unless `--skip-nix-hash` is set.
11. Snapshot again and populate sorted `changedFiles`.

Use `spawn` with `cwd: rootDir` and inherited stdio for the production
`runCommand`. Never build shell command strings; pass executable and argument
arrays.

- [ ] **Step 6: Add failing rollback and synchronization tests**

Make the injected `runCommand` fail at each mutation-stage command. For every
failure assert:

- the thrown error names the failed executable and arguments;
- all tracked files and modes equal the initial snapshot;
- the summary JSON contains the primary error and an empty changed-file list.

Add failures for unexpected source pin match counts and lockfile target
mismatch.

- [ ] **Step 7: Implement rollback and post-update consistency checks**

Wrap all mutation after the initial snapshot in `try/catch`. On error, call
`restoreTrackedPaths(rootDir, trackedRoots, before)`, write the failure summary,
and rethrow the primary error. If restoration fails, append the restoration
error to stderr without replacing the primary summary error.

After `patchmill skills update`, read its metadata and require its source tag
and tarball URL to match the target before taking the final snapshot.

- [ ] **Step 8: Run updater and library tests**

Run:

```bash
node --test \
  scripts/superpowers-upgrade-lib.test.mjs \
  scripts/tracked-files.test.mjs \
  scripts/update-superpowers.test.mjs
```

Expected: all tests PASS, including rollback and Git-independent changed-file
reporting.

- [ ] **Step 9: Run a real non-mutating current-pin validation**

Run:

```bash
rm -rf .tmp/superpowers-validation
node scripts/update-superpowers.mjs \
  --mode manual \
  --superpowers-version 6.0.3 \
  --validate-only \
  --skip-nix-hash \
  --summary-json .tmp/superpowers-validation/summary.json
git diff --exit-code
```

Expected: exit 0, summary reports `currentVersion` and `targetVersion` as
`6.0.3`, `noUpdate: true`, and Git reports no tracked changes.

- [ ] **Step 10: Commit Task 3**

```bash
git add scripts/update-superpowers.mjs \
  scripts/update-superpowers.test.mjs \
  scripts/superpowers-upgrade-lib.mjs \
  scripts/superpowers-upgrade-lib.test.mjs
git commit -m "feat(deps): add Superpowers upgrade updater"
```

---

### Task 4: Repository-wide Superpowers consistency contract

**Files:**

- Create: `scripts/superpowers-repository-contract.test.mjs`
- Modify: `src/workflow/skill-pack.test.ts:20-75`
- Modify: `src/workflow/skill-pack.test.ts:150-165`

**Interfaces:**

- Consumes Task 1's canonical version/spec helpers and the exported
  `PATCHMILL_RECOMMENDED_SKILL_PACK` configuration.
- Proves the package pin, lockfiles, notice, live skill-pack source, checked-in
  project-local metadata, file hashes, and installed upstream paths all agree.
- Runs automatically through the existing `scripts/*.test.mjs` npm test glob.

- [ ] **Step 1: Replace fixed skill-pack source expectations with a failing
      dynamic expectation**

In `src/workflow/skill-pack.test.ts`, parse the expected version from
`package.json` instead of repeating `v6.0.3`:

```ts
const packageJson = JSON.parse(
  readFileSync(join(repoRoot, "package.json"), "utf8"),
) as { dependencies?: Record<string, string> };
const superpowersSpec = packageJson.dependencies?.superpowers ?? "";
const superpowersMatch =
  /^https:\/\/github\.com\/obra\/superpowers\/archive\/refs\/tags\/(v\d+\.\d+\.\d+)\.tar\.gz$/u.exec(
    superpowersSpec,
  );
assert.ok(superpowersMatch, "package.json must pin a stable Superpowers tag");
const expectedSuperpowersSource = {
  type: "github-release" as const,
  repository: "obra/superpowers",
  tag: superpowersMatch[1],
  tarballUrl: superpowersSpec,
};
```

Use `expectedSuperpowersSource` in both the default-pack and
`buildSkillPackMetadata` assertions. This test must fail if only one side of a
future upgrade changes.

- [ ] **Step 2: Run the focused skill-pack test**

Run:

```bash
node --test src/workflow/skill-pack.test.ts
```

Expected: PASS with the current synchronized `v6.0.3` repository.

- [ ] **Step 3: Write the repository consistency contract**

Create a test that:

1. Reads `package.json`, both lockfiles, `THIRD_PARTY_NOTICES.md`, and
   `.patchmill/skills/patchmill-skill-pack.json`.
2. Gets the current version through `getCurrentSuperpowersVersion`.
3. Calls `assertLockfilesMatchSuperpowersTarget`.
4. Imports `PATCHMILL_RECOMMENDED_SKILL_PACK` and compares its source to the
   canonical tag and tarball.
5. Requires the notice to contain exactly
   `https://github.com/obra/superpowers/tree/vX.Y.Z/skills`.
6. Compares checked-in metadata source to the live pack source.
7. Resolves `superpowers/package.json` with `createRequire`, confirms its
   package version, and checks every configured Superpowers skill has `SKILL.md`
   under the resolved `skills` directory.
8. Recomputes SHA-256 for every file listed in checked-in metadata and compares
   it to `sha256`.

Use a subtest per configured skill so failures name the missing upstream path:

```js
for (const skill of PATCHMILL_RECOMMENDED_SKILL_PACK.skills.filter(
  ({ source }) => source === "superpowers",
)) {
  await t.test(`installed upstream skill exists: ${skill.name}`, async () => {
    await access(join(superpowersRoot, "skills", skill.name, "SKILL.md"));
  });
}
```

- [ ] **Step 4: Run consistency and skill-pack tests**

Run:

```bash
node --test \
  scripts/superpowers-repository-contract.test.mjs \
  src/workflow/skill-pack.test.ts
```

Expected: all consistency, metadata-hash, and upstream-path tests PASS.

- [ ] **Step 5: Commit Task 4**

```bash
git add scripts/superpowers-repository-contract.test.mjs \
  src/workflow/skill-pack.test.ts
git commit -m "test(skills): enforce Superpowers pin consistency"
```

---

### Task 5: Dedicated GitHub Actions workflow

**Files:**

- Create: `.github/workflows/superpowers-upgrade.yml`

**Interfaces:**

- Consumes Task 3's updater flags and summary schema.
- Consumes Task 1's `renderSuperpowersPullRequestBody(summary)` export.
- Produces daily and manual GitHub Actions runs plus review-gated
  `automation/superpowers-vX.Y.Z` pull requests.

- [ ] **Step 1: Create the dedicated workflow**

Use the Pi workflow's action versions and App-token pattern, but use a separate
schedule, concurrency group, outputs, branch, title, and changed paths:

```yaml
name: Superpowers dependency upgrade

on:
  schedule:
    - cron: "47 6 * * *"
  workflow_dispatch:
    inputs:
      superpowers-version:
        description: "Explicit stable Superpowers version"
        required: false
        type: string
      validate-only:
        description:
          "Resolve and validate without changing files or opening a PR"
        required: false
        default: false
        type: boolean

permissions:
  contents: read

concurrency:
  group: superpowers-dependency-upgrade
  cancel-in-progress: false

jobs:
  upgrade:
    runs-on: ubuntu-latest
    steps:
      - name: Check out repository
        uses: actions/checkout@v4
        with:
          fetch-depth: 0
          persist-credentials: false

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

      - name: Update Superpowers dependency and skill metadata
        id: update
        env:
          GITHUB_TOKEN: ${{ github.token }}
          SUPERPOWERS_VERSION: ${{ inputs.superpowers-version }}
          VALIDATE_ONLY: ${{ inputs.validate-only || false }}
        run: |
          set -euo pipefail
          mkdir -p .tmp
          args=(--summary-json .tmp/superpowers-summary.json)
          if [[ "${{ github.event_name }}" == "workflow_dispatch" ]]; then
            args+=(--mode manual)
            [[ -n "${SUPERPOWERS_VERSION:-}" ]] && args+=(--superpowers-version "$SUPERPOWERS_VERSION")
            [[ "$VALIDATE_ONLY" == "true" ]] && args+=(--validate-only)
          else
            args+=(--mode scheduled)
          fi
          node scripts/update-superpowers.mjs "${args[@]}"
          node <<'NODE' >> "$GITHUB_OUTPUT"
          const fs = require("node:fs");
          const summary = JSON.parse(fs.readFileSync(".tmp/superpowers-summary.json", "utf8"));
          console.log(`no_update=${summary.noUpdate ? "true" : "false"}`);
          console.log(`validate_only=${summary.validateOnly ? "true" : "false"}`);
          console.log(`target_version=${summary.targetVersion}`);
          console.log(`target_tag=${summary.targetTag}`);
          NODE

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
          cp nix/package.nix .tmp/nix-package.nix.before-hash
          scripts/update-npm-deps-hash.sh
          if ! cmp --silent .tmp/nix-package.nix.before-hash nix/package.nix; then
            echo "::error file=nix/package.nix::npmDepsHash is stale after the Superpowers update."
            exit 1
          fi

      - name: Build Nix package
        if: steps.update.outputs.no_update != 'true'
        run: nix build .#patchmill --print-build-logs

      - name: Render pull request body
        if: >-
          steps.update.outputs.no_update != 'true' &&
          steps.update.outputs.validate_only != 'true'
        run: |
          node -e 'import("./scripts/superpowers-upgrade-lib.mjs").then(({renderSuperpowersPullRequestBody}) => { const fs = require("node:fs"); const summary = JSON.parse(fs.readFileSync(".tmp/superpowers-summary.json", "utf8")); fs.writeFileSync(".tmp/superpowers-pr-body.md", renderSuperpowersPullRequestBody(summary)); })'

      - name: Create automation bot token
        id: app-token
        if: >-
          steps.update.outputs.no_update != 'true' &&
          steps.update.outputs.validate_only != 'true'
        uses: actions/create-github-app-token@v2
        with:
          app-id: ${{ secrets.RELEASE_PLEASE_BOT_APP_ID }}
          private-key: ${{ secrets.RELEASE_PLEASE_BOT_PRIVATE_KEY }}

      - name: Create or update Superpowers upgrade PR
        if: >-
          steps.update.outputs.no_update != 'true' &&
          steps.update.outputs.validate_only != 'true'
        uses: peter-evans/create-pull-request@v7
        with:
          token: ${{ steps.app-token.outputs.token }}
          add-paths: |
            package.json
            package-lock.json
            npm-shrinkwrap.json
            nix/package.nix
            src/workflow/skill-pack.ts
            THIRD_PARTY_NOTICES.md
            .patchmill/skills
          branch: automation/superpowers-${{ steps.update.outputs.target_tag }}
          delete-branch: true
          title: >-
            chore(deps): update Superpowers to ${{
            steps.update.outputs.target_tag }}
          body-path: .tmp/superpowers-pr-body.md
          commit-message: >-
            chore(deps): update Superpowers to ${{
            steps.update.outputs.target_tag }}
          labels: dependencies, automated-pr
```

- [ ] **Step 2: Format and validate workflow syntax directly**

Run:

```bash
npx prettier --check .github/workflows/superpowers-upgrade.yml
nix run nixpkgs#actionlint -- .github/workflows/superpowers-upgrade.yml
```

Expected: both commands exit 0; `actionlint` prints no diagnostics. This is
direct verification, not a test that restates YAML content.

- [ ] **Step 3: Exercise the workflow's updater contract locally**

Run the updater in validate-only latest mode and inspect only stable summary
fields:

```bash
rm -rf .tmp/superpowers-workflow-check
node scripts/update-superpowers.mjs \
  --mode scheduled \
  --validate-only \
  --skip-nix-hash \
  --summary-json .tmp/superpowers-workflow-check/summary.json
node -e 'const s=require("./.tmp/superpowers-workflow-check/summary.json"); if (!s.targetTag || !Array.isArray(s.releases) || s.changedFiles.length) process.exit(1)'
git diff --exit-code
```

Expected: exit 0, a stable `targetTag`, complete release array, no changed
files, and no Git diff.

- [ ] **Step 4: Commit Task 5**

```bash
git add .github/workflows/superpowers-upgrade.yml
git commit -m "ci(deps): automate Superpowers upgrade PRs"
```

---

### Task 6: Documentation and full verification

**Files:**

- Modify: `docs/pi-dependency-upgrades.md:1-43`

**Interfaces:**

- Documents independent Pi and Superpowers schedules, local/manual commands,
  release-note behavior, credentials, validation, and review policy.
- Does not rename the existing documentation path, avoiding broken links.

- [ ] **Step 1: Expand the dependency-upgrade documentation**

Rename the document heading to `# Automated Dependency Upgrades`. Keep the Pi
section and add a `## Superpowers upgrades` section containing:

````markdown
## Superpowers upgrades

The `Superpowers dependency upgrade` workflow runs daily and opens a dedicated
review-gated pull request when `obra/superpowers` publishes a newer stable
GitHub Release. It does not combine Superpowers and Pi runtime changes.

The pull request includes the upstream release body for every stable release
after the current pin through the target, ordered from oldest to newest. Missing
or empty release notes prevent pull-request creation.

Run a non-mutating local validation with:

```bash
node scripts/update-superpowers.mjs \
  --mode manual \
  --superpowers-version 6.0.3 \
  --validate-only \
  --skip-nix-hash \
  --summary-json .tmp/superpowers-summary.json
```

Omit `--superpowers-version` to validate discovery of the latest stable release.
Omit `--validate-only` and `--skip-nix-hash` only when intentionally preparing a
real Superpowers upgrade.
````

Document that both workflows use the same App secrets only after validation and
that neither auto-merges or publishes.

- [ ] **Step 2: Run targeted tests**

Run:

```bash
node --test \
  scripts/superpowers-upgrade-lib.test.mjs \
  scripts/tracked-files.test.mjs \
  scripts/update-superpowers.test.mjs \
  scripts/superpowers-repository-contract.test.mjs \
  src/workflow/skill-pack.test.ts
```

Expected: all targeted tests PASS with zero failures.

- [ ] **Step 3: Run the complete npm test suite**

Run:

```bash
npm test
```

Expected: all tests PASS with zero failures.

- [ ] **Step 4: Run packed-artifact verification and lint**

Run:

```bash
node scripts/smoke-packed-artifact.mjs
npm run lint
```

Expected: packed artifact smoke test exits 0 and lint reports no errors.

- [ ] **Step 5: Re-run workflow validation**

Run:

```bash
npx prettier --check .github/workflows/superpowers-upgrade.yml
nix run nixpkgs#actionlint -- .github/workflows/superpowers-upgrade.yml
```

Expected: both commands exit 0 with no workflow diagnostics.

- [ ] **Step 6: Verify the updater is non-mutating in validation mode**

Run:

```bash
rm -rf .tmp/superpowers-final-validation
node scripts/update-superpowers.mjs \
  --mode scheduled \
  --validate-only \
  --skip-nix-hash \
  --summary-json .tmp/superpowers-final-validation/summary.json
git diff --exit-code
```

Expected: summary contains the current and target versions plus all in-range
release bodies, `changedFiles` is empty, and Git reports no tracked changes.

- [ ] **Step 7: Verify npm/Nix dependency integration**

Run:

```bash
cp nix/package.nix .tmp/nix-package.nix.before-superpowers-check
scripts/update-npm-deps-hash.sh
cmp --silent .tmp/nix-package.nix.before-superpowers-check nix/package.nix
nix build .#patchmill --print-build-logs
```

Expected: the hash updater makes no change and the Nix package build exits 0.
The implementation PR intentionally leaves the current Superpowers dependency
pin unchanged; future automated upgrade PRs will commit the refreshed hash.

- [ ] **Step 8: Review the final diff against the design**

Run:

```bash
git status --short
git diff --check
git diff --stat main...HEAD
git diff main...HEAD -- \
  .github/workflows/superpowers-upgrade.yml \
  scripts \
  src/workflow/skill-pack.test.ts \
  docs/pi-dependency-upgrades.md
```

Expected: only the planned workflow, scripts, tests, and documentation differ;
`package.json` remains pinned to `v6.0.3`; no whitespace errors are reported.

- [ ] **Step 9: Commit Task 6**

```bash
git add docs/pi-dependency-upgrades.md
git commit -m "docs(deps): document Superpowers upgrades"
```

- [ ] **Step 10: Request adversarial code review**

Resolve and dispatch the canonical `reviewer` in fresh context with:

- what was implemented;
- this plan and the approved design path;
- base SHA from `main` and current head SHA;
- confirmation that the implementation does not itself bump Superpowers;
- focus on release-note completeness, untrusted GitHub Markdown handling,
  rollback, skill synchronization, credential timing, and workflow pathspecs.

Apply only technically validated findings, then rerun every command from Steps
2-8 before branch completion.
