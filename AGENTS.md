# Patchmill agent instructions

## Verification

- When updating any skill pack or skill-pack dependency, verify both sides of
  the integration:
  - installed upstream skill files exist at the paths Patchmill resolves; and
  - Patchmill skill-pack config, metadata, tests, and live dependency references
    point at the same upstream version.
- When npm dependencies change (`package.json`, `package-lock.json`, or
  `npm-shrinkwrap.json`), rerun the Nix build as part of verification.

## Agent skills

### Issue tracker

Issues are tracked in GitHub Issues for `rochecompaan/patchmill`. See
`docs/agents/issue-tracker.md`.

### Triage labels

Patchmill owns issue triage and uses Patchmill workflow labels. See
`docs/agents/triage-labels.md`.

### Domain docs

This repo uses a single-context domain-doc layout. See `docs/agents/domain.md`.
