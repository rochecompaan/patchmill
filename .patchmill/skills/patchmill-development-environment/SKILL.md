---
name: patchmill-development-environment
description: Use when Patchmill dogfoods its own development stage.
---

# Patchmill Development Environment

## Overview

Prepare a Patchmill issue worktree so implementation can use the repository's
`devenv` + npm toolchain. This stage verifies local runtime readiness only; it
is not product implementation, review, or final validation.

## Boundaries

- Do not implement product changes, edit tracked source/docs/config, dispatch
  implementation workers, create PRs, land code, or run `patchmill run-once` or
  `patchmill triage` recursively.
- Do not use `git status` as a readiness gate. Patchmill owns clean-worktree
  checks before this stage; unrelated tracked changes are not environment
  failures unless they directly break the commands below.
- Do not run `npm test`, `npm run build`, or `devenv tasks run patchmill:smoke`
  as default readiness gates. Those are implementation/final validation checks
  and may legitimately fail before an issue is fixed.
- Every evidence item must come from a command actually run in this stage. Never
  invent pass counts or summarize commands you did not execute.

## Readiness procedure

Run commands from the issue worktree root.

1. Confirm this is the Patchmill repository by checking for `package.json`,
   `package-lock.json`, `devenv.nix`, and `devenv.yaml`.
2. Ensure dependencies exist. If `node_modules/.package-lock.json` is missing or
   `package-lock.json` is newer than it, run:

   ```sh
   devenv shell -- npm ci
   ```

   Otherwise record that existing `node_modules` is being reused.

3. Verify the runtime:

   ```sh
   devenv shell -- node --version
   devenv shell -- npm --version
   ```

   Node must be v24.x.

4. Run the cheapest Patchmill CLI smoke check:

   ```sh
   devenv shell -- npm run patchmill -- version
   ```

5. Return strict final JSON only.

## Ready JSON

```json
{
  "status": "ready",
  "summary": "Patchmill devenv and npm toolchain are ready",
  "evidence": [
    "devenv shell -- node --version -> v24.x",
    "devenv shell -- npm --version -> <version>",
    "devenv shell -- npm run patchmill -- version -> <version>"
  ],
  "environment": {
    "nodeVersion": "v24.x",
    "npmVersion": "<version>",
    "patchmillVersion": "<version>",
    "dependencyState": "npm ci run or existing node_modules reused"
  }
}
```

## Not-ready JSON

Return `not-ready` for local/operator environment failures such as missing
`devenv`, `npm ci` failure, wrong Node major version, or the Patchmill version
smoke check failing before implementation starts.

```json
{
  "status": "not-ready",
  "reason": "short operator-facing reason",
  "evidence": ["failed command and concise output summary"],
  "remediation": [
    "Run devenv shell -- npm ci from the issue worktree",
    "Confirm devenv shell -- npm run patchmill -- version succeeds",
    "Re-run patchmill run-once"
  ]
}
```
