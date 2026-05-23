# Patchmill

Patchmill is an agent-driven software factory: it turns issues into reviewed diffs using configurable issue-host providers, the built-in Pi runtime, and project policy.

This repository started from the Croprun Forgejo + Pi automation scripts, but the primary interface is now the generic Patchmill CLI and `PATCHMILL_*` configuration surface. The remaining compatibility fallbacks are documented in [`docs/migration-from-croprun-scripts.md`](./docs/migration-from-croprun-scripts.md).

## Providers

The first supported host/runtime combination is Forgejo via `tea` and Pi via `pi`. See `docs/providers.md` for the host-provider boundary and Pi runtime contract.

## Current commands

```sh
node bin/patchmill.ts triage --dry-run
node bin/patchmill.ts run-once --dry-run
```

Compatibility aliases copied from the bootstrap scripts are still available during migration:

```sh
node scripts/agent-issue-triage.ts --dry-run
node scripts/agent-issue-once.ts --dry-run
```

Add `patchmill.config.json` at the repo root — even `{}` is enough — to activate normalized Patchmill defaults for the CLI commands above. Without that file, `bin/patchmill.ts` dispatches to the copied compatibility scripts and they keep the legacy Croprun fallbacks for paths, git/worktree settings, cleanup hooks, and prompt policy.

## Validation

```sh
npm test
npm run audit:generalization
```

`npm run audit:generalization` reports the remaining documented Croprun compatibility references in runtime code, tests, and migration docs.

The repo currently uses Node's native TypeScript execution support, so Node 24+ is expected.

## Roadmap docs

- Design spec: `docs/specs/2026-05-22-patchmill-generalization-design.md`
- Implementation plan: `docs/plans/2026-05-22-patchmill-generalization.md`
