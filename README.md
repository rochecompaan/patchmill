# Patchmill

Patchmill is an agent-driven software factory: it turns issues into reviewed diffs using configurable issue-host providers, coding-agent providers, and project policy.

This repository is bootstrapped from Croprun's Forgejo + Pi automation scripts. The initial code still carries Croprun-specific names and policy in several modules; the generalization spec and implementation plan document how to extract those assumptions.

## Current commands

```sh
node bin/patchmill.ts triage --dry-run
node bin/patchmill.ts run-once --dry-run
```

Compatibility aliases copied from Croprun are still available:

```sh
node scripts/agent-issue-triage.ts --dry-run
node scripts/agent-issue-once.ts --dry-run
```

## Tests

```sh
npm test
```

The repo currently uses Node's native TypeScript execution support, so Node 24+ is expected.

## Roadmap docs

- Design spec: `docs/specs/2026-05-22-patchmill-generalization-design.md`
- Implementation plan: `docs/plans/2026-05-22-patchmill-generalization.md`
