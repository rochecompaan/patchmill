# Standalone quality checks

These commands are local experiments. The CI workflow does not use them. Run
them from a source checkout. Record useful findings before you set thresholds.

## Install the dependencies

```sh
npm ci
```

## Run the checks

| Check           | Command                      | Result                                                                           |
| --------------- | ---------------------------- | -------------------------------------------------------------------------------- |
| Static analysis | `npm run check:static`       | Runs the TypeScript ESLint rules.                                                |
| Strict typing   | `npm run check:types`        | Uses `tsconfig.quality.json` and reports the current type errors.                |
| Branch coverage | `npm run check:coverage`     | Reports production code and writes JSON reports to `coverage/`.                  |
| CRAP            | `npm run check:crap`         | Generates coverage and reports CRAP scores without a threshold error.            |
| Property tests  | `npm run check:property`     | Runs the initial `fast-check` properties in `quality/property/`.                 |
| Architecture    | `npm run check:architecture` | Checks cycles, dependency resolution, and initial layer rules.                   |
| Mutation pilot  | `npm run check:mutation`     | Mutates `src/policy/todo-statuses.ts` and writes reports to `reports/mutation/`. |

## Initial local baseline

The first local run produced these results:

- Static analysis passed.
- Strict typing found 214 errors in 62 files.
- Production branch coverage was between 85.95% and 85.96%.
- Production line and statement coverage were 91.76%.
- Production function coverage was 94.80%.
- CRAP checked 1,615 production functions. Twelve functions scored more than 30.
- Three property tests passed.
- The architecture check found one unresolved `typebox` dependency.
- The mutation pilot created 57 mutants. It killed 38 mutants and 19 survived.
- The mutation score was 66.67%.

These values are observations, not acceptance thresholds. The strict typing,
architecture, and strict CRAP commands currently exit with an error.

## Study CRAP output

`npm run check:crap` uses report-only mode. It does not fail for a high score.
The check includes functions with one or more lines. The strict threshold is 30.

Run this command only after you review the report:

```sh
npm run check:crap:strict
```

## Study mutation output

The mutation pilot uses one policy module and its focused tests. Review each
surviving mutant. The command runner cannot distinguish uncovered mutants from
executed mutants that weak assertions miss. Do not set a mutation threshold
until this pilot is stable.

Stryker stores an incremental cache in `reports/mutation/incremental.json`. The
mutation command reuses this cache when the inputs do not change.

## Add the checks to CI

Add one check at a time after its local result is useful and stable. Do not
expand mutation scope in each pull request. Use a scheduled workflow when the
wider run time is acceptable.
