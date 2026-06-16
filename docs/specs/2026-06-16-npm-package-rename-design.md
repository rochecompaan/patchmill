# npm package rename design

## Context

Patchmill is currently published as `@rochecompaan/patchmill`. The CLI command
is already `patchmill`, and the Nix package uses the unscoped package name. The
npm package should move to the cleaner canonical package name `patchmill`.

## Decision

Publish future releases from this repository as the unscoped npm package
`patchmill`.

The old scoped package, `@rochecompaan/patchmill`, will not be maintained as a
compatibility shim. After the first successful `patchmill` publish, it will be
deprecated on npm with a clear warning that tells users how to install the new
package.

Recommended deprecation command after release:

```sh
npm deprecate "@rochecompaan/patchmill@*" "Package renamed to patchmill. Install with: npm install -g patchmill or use: npx patchmill"
```

## Repository changes

- Change `package.json` package name from `@rochecompaan/patchmill` to
  `patchmill`.
- Refresh npm lock metadata so `package-lock.json` and `npm-shrinkwrap.json`
  identify the root package as `patchmill`.
- Change Release Please package metadata from `@rochecompaan/patchmill` to
  `patchmill`.
- Update README installation and `npx` examples to use `patchmill`.
- Add a short migration note in the README explaining that
  `@rochecompaan/patchmill` is deprecated and users should install `patchmill`
  instead.

## Non-goals

- Do not create or maintain a wrapper package for `@rochecompaan/patchmill`.
- Do not change the CLI binary name; it remains `patchmill`.
- Do not change Nix packaging beyond what is required by npm metadata, because
  Nix already uses `patchmill` as its package name.

## Release flow

1. Merge the repository changes.
2. Let Release Please prepare and publish the next npm release as `patchmill`.
3. Confirm `npm install -g patchmill` and `npx patchmill` work.
4. Deprecate `@rochecompaan/patchmill` with the warning shown above.

## Verification

Use direct verification rather than new automated tests because this is
npm/release metadata and documentation, not reusable runtime behavior.

Verification commands:

- `npm install --package-lock-only --ignore-scripts`
- `npm run lint:md`
- `npm run build`
- `npm pack --dry-run`

The dry-run pack should show package name `patchmill` and include the expected
files.
