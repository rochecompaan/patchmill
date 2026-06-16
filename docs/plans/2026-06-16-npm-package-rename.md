# npm Package Rename Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rename the canonical npm package from `@rochecompaan/patchmill` to
`patchmill` and document deprecation of the old scoped package.

**Architecture:** This is a package metadata and documentation migration. The
repository continues to build and publish the same CLI binary, `patchmill`,
while npm metadata and user-facing installation instructions switch to the
unscoped package name.

**Tech Stack:** npm package metadata, npm lockfiles, Release Please, Markdown
documentation, TypeScript build verification.

---

## File structure

- Modify: `package.json`
  - Responsibility: declares the canonical npm package name and existing CLI
    binary mapping.
- Modify: `package-lock.json`
  - Responsibility: records root package metadata for local installs.
- Modify: `npm-shrinkwrap.json`
  - Responsibility: records publish-time locked dependencies and root package
    metadata.
- Modify: `release-please-config.json`
  - Responsibility: tells Release Please which package name to use for releases.
- Modify: `README.md`
  - Responsibility: documents canonical install and `npx` usage plus migration
    guidance from the deprecated scoped package.
- No new runtime source files.
- No new automated tests because this changes package metadata and
  documentation, not reusable runtime behavior. Use direct verification commands
  in Task 3.

## Implementation tasks

### Task 1: Rename npm package metadata and lockfile roots

**Files:**

- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `npm-shrinkwrap.json`

- [ ] **Step 1: Confirm the unscoped npm name is still available**

  Run:

  ```bash
  npm view patchmill name version --json
  ```

  Expected: command exits non-zero with npm `E404` / `Not Found`. Treat that as
  success because it means no public `patchmill` package currently exists.

  If this command returns package metadata instead of `E404`, stop and report
  the collision before editing files.

- [ ] **Step 2: Change the root package name in `package.json`**

  Run:

  ```bash
  npm pkg set name=patchmill
  ```

  Expected: `package.json` changes from:

  ```json
  "name": "@rochecompaan/patchmill"
  ```

  to:

  ```json
  "name": "patchmill"
  ```

- [ ] **Step 3: Refresh `package-lock.json` despite the shrinkwrap file**

  npm updates `npm-shrinkwrap.json` instead of `package-lock.json` when a
  shrinkwrap file is present. Temporarily move the shrinkwrap aside so npm
  refreshes `package-lock.json` from the updated `package.json`.

  Run:

  ```bash
  mv npm-shrinkwrap.json npm-shrinkwrap.json.bak
  npm install --package-lock-only --ignore-scripts
  mv npm-shrinkwrap.json.bak npm-shrinkwrap.json
  ```

  Expected: `package-lock.json` root metadata now uses `patchmill`.

- [ ] **Step 4: Refresh `npm-shrinkwrap.json`**

  Run:

  ```bash
  npm install --package-lock-only --ignore-scripts
  ```

  Expected: `npm-shrinkwrap.json` root metadata now uses `patchmill`.

- [ ] **Step 5: Verify both lockfiles name the root package consistently**

  Run:

  ```bash
  node <<'NODE'
  const fs = require('node:fs');

  for (const file of ['package.json', 'package-lock.json', 'npm-shrinkwrap.json']) {
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    const rootName = data.packages?.['']?.name ?? data.name;

    console.log(`${file}: name=${data.name}; rootName=${rootName}`);

    if (data.name !== 'patchmill') {
      throw new Error(`${file} top-level name is ${data.name}`);
    }

    if (file !== 'package.json' && rootName !== 'patchmill') {
      throw new Error(`${file} root package name is ${rootName}`);
    }
  }
  NODE
  ```

  Expected output:

  ```text
  package.json: name=patchmill; rootName=patchmill
  package-lock.json: name=patchmill; rootName=patchmill
  npm-shrinkwrap.json: name=patchmill; rootName=patchmill
  ```

- [ ] **Step 6: Review the metadata diff**

  Run:

  ```bash
  git diff -- package.json package-lock.json npm-shrinkwrap.json
  ```

  Expected: only root package name metadata changes from
  `@rochecompaan/patchmill` to `patchmill`; dependencies and CLI `bin` mapping
  remain unchanged.

- [ ] **Step 7: Commit the metadata rename**

  Run:

  ```bash
  git add package.json package-lock.json npm-shrinkwrap.json
  git commit -m "chore(npm): rename package to patchmill"
  ```

  Expected: commit succeeds.

### Task 2: Update Release Please and README migration guidance

**Files:**

- Modify: `release-please-config.json`
- Modify: `README.md`

- [ ] **Step 1: Update Release Please package name**

  In `release-please-config.json`, change:

  ```json
  "package-name": "@rochecompaan/patchmill"
  ```

  to:

  ```json
  "package-name": "patchmill"
  ```

  Expected: Release Please will prepare future releases for the unscoped npm
  package.

- [ ] **Step 2: Update the global install quickstart**

  In `README.md`, replace the current global install block:

  ````markdown
  Install the Patchmill CLI globally, then start with the onboarding flow:

  ```sh
  npm install -g @rochecompaan/patchmill

  patchmill init
  patchmill doctor
  patchmill triage --dry-run
  ```
  ````

  with:

  ````markdown
  Install the Patchmill CLI globally, then start with the onboarding flow:

  ```sh
  npm install -g patchmill

  patchmill init
  patchmill doctor
  patchmill triage --dry-run
  ```
  ````

- [ ] **Step 3: Update the `npx` quickstart**

  In `README.md`, replace the current `npx` paragraph and block:

  ````markdown
  If you prefer not to install Patchmill globally, use the scoped package name
  with `npx`:

  ```sh
  npx @rochecompaan/patchmill init
  npx @rochecompaan/patchmill doctor
  npx @rochecompaan/patchmill triage --dry-run
  ```
  ````

  with:

  ````markdown
  If you prefer not to install Patchmill globally, use `npx`:

  ```sh
  npx patchmill init
  npx patchmill doctor
  npx patchmill triage --dry-run
  ```
  ````

- [ ] **Step 4: Add migration guidance for the deprecated scoped package**

  Immediately after the `npx` quickstart block in `README.md`, add:

  ````markdown
  ### Migrating from `@rochecompaan/patchmill`

  The scoped npm package `@rochecompaan/patchmill` is deprecated. Install the
  unscoped package instead:

  ```sh
  npm uninstall -g @rochecompaan/patchmill
  npm install -g patchmill
  ```

  For one-off usage, replace `npx @rochecompaan/patchmill ...` with
  `npx patchmill ...`.
  ````

- [ ] **Step 5: Review all remaining scoped package references**

  Run:

  ```bash
  rg -n "@rochecompaan/patchmill" README.md package.json package-lock.json npm-shrinkwrap.json release-please-config.json docs
  ```

  Expected: the only remaining matches are intentional migration/deprecation
  references in `README.md` and the already-approved spec at
  `docs/specs/2026-06-16-npm-package-rename-design.md`.

- [ ] **Step 6: Commit the release and documentation updates**

  Run:

  ```bash
  git add release-please-config.json README.md
  git commit -m "docs(npm): document patchmill package install"
  ```

  Expected: commit succeeds.

### Task 3: Verify package metadata, docs, build, and pack output

**Files:**

- Read/verify: `package.json`
- Read/verify: `package-lock.json`
- Read/verify: `npm-shrinkwrap.json`
- Read/verify: `README.md`
- Read/verify: `release-please-config.json`
- Read/verify: generated dry-run pack output only

- [ ] **Step 1: Run Markdown lint for documentation changes**

  Run:

  ```bash
  npm run lint:md
  ```

  Expected: command exits 0.

- [ ] **Step 2: Run the TypeScript build**

  Run:

  ```bash
  npm run build
  ```

  Expected: command exits 0 and regenerates `dist/` from the current source.

- [ ] **Step 3: Run npm pack dry-run**

  Run:

  ```bash
  npm pack --dry-run
  ```

  Expected: output contains `patchmill@0.12.0`, includes
  `dist/bin/patchmill.js`, and does not report `@rochecompaan/patchmill` as the
  package being packed.

- [ ] **Step 4: Review final git diff and status**

  Run:

  ```bash
  git status --short
  git diff --stat HEAD~2..HEAD
  ```

  Expected: working tree is clean except for any generated `dist/` changes from
  `npm run build`. If `dist/` changed, inspect it with `git diff -- dist` and
  commit only if the build output legitimately changed due to the metadata
  rename.

- [ ] **Step 5: Record post-release npm deprecation command for the maintainer**

  In the final implementation summary, include this command for after the first
  successful `patchmill` release:

  ```bash
  npm deprecate "@rochecompaan/patchmill@*" "Package renamed to patchmill. Install with: npm install -g patchmill or use: npx patchmill"
  ```

  Expected: the command is not run during implementation because it should
  happen only after the new `patchmill` package has been published successfully.
