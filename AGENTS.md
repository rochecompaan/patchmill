# Patchmill agent instructions

## Verification

- When updating any skill pack or skill-pack dependency, verify both sides of
  the integration:
  - installed upstream skill files exist at the paths Patchmill resolves; and
  - Patchmill skill-pack config, metadata, tests, and live dependency references
    point at the same upstream version.
- When npm dependencies change (`package.json`, `package-lock.json`, or
  `npm-shrinkwrap.json`), rerun the Nix build as part of verification.
