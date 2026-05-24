# Patchmill Generalization Implementation Plan

> Archived plan summary for the initial generalization pass.

**Goal:** Turn the seed Forgejo + Pi automation into a configurable Patchmill
CLI with an issue-host provider boundary and a concrete Pi runtime.

**Architecture:** Keep the workflow green while extracting thin interfaces
around host access, configuration, policy, and git strategy. Pi remains the
built-in runtime.

## Workstreams

### 1. CLI bootstrap

- add the top-level `patchmill` dispatcher
- route `patchmill triage` and `patchmill run-once`
- lock command routing with CLI tests

### 2. Configuration

- define typed Patchmill defaults
- load `patchmill.config.json`
- apply `PATCHMILL_*` environment overrides
- thread normalized config into triage and run-once

### 3. Host and runtime boundaries

- extract the issue-host provider contract
- wrap Forgejo + `tea` as the first provider
- preserve concrete Pi prompt and result contracts

### 4. Policy and prompts

- move labels, validation guidance, landing policy, and prompt text into project
  policy
- document task-contract settings used by Pi prompts and plan readers
- keep prompt output validation strict

### 5. Paths, git, and cleanup

- move workflow state to `.patchmill/runs` and `.patchmill/triage-runs`
- make worktree naming and base refs configurable
- replace repository-specific cleanup behavior with cleanup hooks

### 6. Visual evidence

- split screenshot policy from host upload behavior
- make Forgejo evidence upload optional and configuration-driven

### 7. Triage and issue selection

- generalize the triage taxonomy
- make selection rules depend on configured labels and priorities
- preserve structured dry-run and execute logs

### 8. Documentation and audit

- document the Patchmill CLI, provider surface, and task contracts
- keep docs focused on `patchmill triage`, `patchmill run-once`, `PATCHMILL_*`,
  `.patchmill/*`, and `patchmill.config.json`
- add an audit command that flags removed seed-era tokens in tracked product
  files

## Verification goals

- `npm test` passes
- `npm run audit:generalization` passes
- docs describe only the active Patchmill surface
- tracked product files do not reintroduce removed seed-era names or state paths

## Notes

This archive keeps the implementation themes from the original plan while
removing obsolete compatibility guidance that no longer matches the product
surface.
