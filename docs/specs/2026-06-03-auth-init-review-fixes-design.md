# Auth Init Review Fixes Design

## Scope

This follow-up fixes the strict code-quality review findings without taking on
the broader `runInit` rewrite. The broader decomposition of init orchestration
is tracked separately as a follow-up todo.

## Goals

- Keep Pi init-flow behavior covered in the dedicated `pi-init-flow.test.ts`
  suite instead of duplicating it in `main.test.ts`.
- Move Pi setup orchestration behind a canonical production module rather than
  an optional `runInit` test hook.
- Represent cancelled and invalid model selection as explicit Pi setup outcomes,
  not as fabricated smoke-test failures.
- Keep `main.ts` as a thinner coordinator for this slice while preserving
  existing observable init behavior.

## Architecture

Add `src/cli/commands/init/pi-init-setup.ts` as the focused owner of Pi setup
orchestration. It receives readiness detection, model selection, optional
interactive setup, default-model persistence, and smoke-test dependencies. It
returns a discriminated `PiInitSetupResult` with explicit statuses:

- `ready`: selection and smoke test completed successfully.
- `incomplete`: setup did not abort, but Pi smoke/readiness is not complete.
- `cancelled`: required interactive model/setup selection was cancelled.
- `invalid`: interactive model selection returned an unknown model.

Only real smoke-test results are stored in the result. Cancelled and invalid
outcomes carry their selection message directly and do not fabricate
`PiSmokeTestResult` values.

## Main Flow

`runInit` continues to own config, local-exclude, skills, labels, and final
output assembly. For Pi setup it delegates to `resolvePiInitSetup`. `main.ts`
formats the returned explicit result and returns exit code `1` only for aborting
outcomes (`cancelled` and `invalid`).

## Tests

- Remove duplicated Pi-flow scenario tests from `main.test.ts`.
- Keep and adapt the dedicated `pi-init-flow.test.ts` behavior tests.
- Add focused `pi-init-setup.test.ts` tests for explicit outcome modeling and
  the canonical interactive setup dependency.
- Run targeted init tests, TypeScript build, and TypeScript lint.
