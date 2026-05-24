# Node Coverage and Unit Test Review Design

## Context

Patchmill uses TypeScript on Node 24 with the built-in `node:test` runner. The
current suite passes with 392 tests in roughly 1.5 seconds. There is no coverage
command yet. The suite is large relative to the product size, with about 16.8k
lines of test code across 37 test files. The largest hotspot is
`scripts/agent-issue/pipeline.test.ts`, which contains about 7.1k lines and 64
tests.

## Goals

- Add lightweight coverage tooling using Node's built-in test coverage support.
- Capture a baseline before changing tests so refactors are evidence-based.
- Review unit tests critically for duplicate, indirect, or overly broad
  assertions.
- Keep tests that verify Patchmill behavior directly and remove or consolidate
  superfluous coverage.
- Avoid introducing third-party coverage dependencies unless Node's built-in
  output proves insufficient.

## Non-goals

- Do not add `c8`, `nyc`, or HTML coverage reports in this pass.
- Do not enforce coverage thresholds before a baseline has been reviewed.
- Do not rewrite production code solely to improve coverage numbers.
- Do not remove integration-style tests that are the only coverage for
  orchestration behavior.

## Approach

### Coverage command

Add an npm script named `test:coverage` that runs the same test files as
`npm test` with Node's `--experimental-test-coverage` flag. The command should
include application source areas and exclude `*.test.ts` files from the report.
It should initially avoid coverage thresholds.

The command should cover these source roots:

- `bin/**/*.ts`
- `scripts/**/*.ts`
- `src/**/*.ts`
- `test-support/**/*.ts` if helper modules remain part of the tested product
  surface

It should exclude:

- `**/*.test.ts`
- generated or local state directories if they appear in reports

### Baseline collection

Run `npm run test:coverage` after adding the script and record the observed
line, branch, and function coverage. Use the report to identify modules with low
direct coverage and files whose coverage is supplied mostly by broad pipeline
tests.

### Test review criteria

For each test file, classify tests using these questions:

1. Does the test exercise the module under test directly?
2. Does it duplicate behavior already covered by lower-level unit tests?
3. Does it assert implementation details instead of externally visible behavior?
4. Is it an orchestration scenario that belongs in a pipeline/integration test?
5. Can several table-like cases be merged without losing signal?
6. Does the test protect a previously fixed regression or a safety boundary?

A test should be kept when it verifies unique behavior, security/safety checks,
public contracts, or critical orchestration. It should be removed or merged when
it mainly retests dependencies, repeats the same path with cosmetic input
differences, or checks incidental formatting better covered elsewhere.

### Refactor order

1. Add coverage script.
2. Run baseline coverage and full tests.
3. Audit largest and most indirect test files first, starting with
   `scripts/agent-issue/pipeline.test.ts`.
4. Consolidate duplicate tests only after verifying equivalent direct coverage
   exists elsewhere.
5. Re-run `npm test` and `npm run test:coverage` after each meaningful cleanup
   batch.
6. Consider adding thresholds only after the suite has been simplified and
   baseline coverage is stable.

## Risks and mitigations

- **Risk:** Removing broad pipeline tests could miss orchestration regressions.
  **Mitigation:** Keep one representative test per distinct workflow branch and
  ensure lower-level modules have direct tests for detailed behavior.

- **Risk:** Coverage output may include test files or imported support modules
  unexpectedly. **Mitigation:** Use Node's include/exclude flags and adjust only
  if the baseline report shows noisy entries.

- **Risk:** Coverage numbers may encourage superficial tests. **Mitigation:**
  Treat coverage as an audit aid, not the success metric. Prioritize direct
  behavioral tests and meaningful boundaries.

## Acceptance criteria

- `package.json` contains a `test:coverage` script using Node built-in coverage.
- `npm run test:coverage` succeeds and prints a coverage report for application
  source, not test files.
- `npm test` continues to pass.
- A follow-up test audit identifies concrete candidates for removal,
  consolidation, or movement to lower-level direct unit tests.
