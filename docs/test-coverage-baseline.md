# Test Coverage Baseline

Generated with:

```bash
npm run test:coverage
```

## Summary

- Date: 2026-05-24
- Runner: Node built-in `node:test` coverage
- Line coverage: 94.24
- Branch coverage: 84.40
- Function coverage: 96.33

## Initial observations

- `scripts/agent-issue/pipeline.test.ts` is the largest test hotspot by size and
  should be reviewed first for duplicate orchestration coverage.
- Direct unit tests should remain close to the modules they exercise.
- Pipeline tests should be retained when they cover unique workflow transitions,
  resume behavior, or safety boundaries not asserted elsewhere.
- No coverage threshold is enforced yet; thresholds should be considered after
  the cleanup pass stabilizes the baseline.

## First audit targets

1. `scripts/agent-issue/pipeline.test.ts` — identify scenarios that retest
   lower-level selection, state, prompt, git, or visual-evidence behavior.
2. `scripts/agent-issue/pi.test.ts` and `scripts/agent-issue/prompts.test.ts` —
   check for duplicated prompt-string assertions and replace brittle text checks
   with contract-level assertions where possible.
3. `src/config/load.test.ts` — check whether validation cases can be
   table-driven while preserving one direct assertion per validation rule.
