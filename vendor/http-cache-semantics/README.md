# Temporary site cache-policy repair

This directory contains `http-cache-semantics@4.3.0` with the upstream security
patch from [PR #58](https://github.com/kornelski/http-cache-semantics/pull/58).
The patch prevents `max-stale` from bypassing cache restrictions, including
shared responses with session cookies.

## Source and patch

- npm source: `http-cache-semantics@4.3.0`
- Upstream source commit: `b1d4bd682fbab0252985de45219f4e7497c0067c`
- Advisory: [GHSA-ch52-4w7c-c8xp](https://github.com/advisories/GHSA-ch52-4w7c-c8xp)
- Patch commit: `14a8c2ad51740dc39bf3e8f1a11c845a5003f217`
- License: [BSD 2-Clause](LICENSE)

The upstream registry has no patched release as of 2026-10-26. The pull request
closed without a merge. Release `4.3.0` exposes the response status and changes
`Vary` matching, but it does not fix `max-stale`. This local copy keeps the
`4.3.0` version number, which Astro 7.4 requires. The manifest is private and
omits upstream test dependencies.

The code changes match the upstream patch, applied to `4.3.0`. The large source file retains its
upstream structure so maintainers can compare and replace it without a local
refactor.

## Site integration and verification

`site/package.json` selects this directory through a direct `file:` dependency.
Its version satisfies Astro's dependency range, so npm uses the same policy for
Astro.

npm does not audit local file dependencies against registry advisories.
A green registry audit alone does not prove that this local code is safe.
The CI job also runs `site/test/cache-policy.test.mjs` against the policy that
Astro resolves. These tests fail against unpatched `4.2.0` and `4.3.0`.

The tests cover restricted responses, serialized policies, stale reuse,
public and immutable opt-ins, and private caches. They also cover the shared
session-cookie bypass through `stale-while-revalidate`.

The high-severity npm audit gate remains unchanged for registry dependencies.

From the repository root, run:

```sh
npm --prefix site ci
npm --prefix site test
npm --prefix site audit --audit-level=high
npm --prefix site run build
```

## Removal conditions

When upstream publishes a release with this fix:

1. Update the site lockfile to use that release.
2. Remove the direct local dependency from `site/package.json`.
3. Run the security tests against Astro's resolved policy.
4. Run the registry audit and site build.
5. Remove this directory and its third-party notice.

Keep the behavioral security tests after removal. They must continue to catch
unsafe dependency resolution or a regression in cache restrictions.
