# Run-Once Approved Artifact Discovery Design

## Goal

Make `patchmill run-once` resolve approved spec and plan artifacts named in
issue content before it creates replacement workflow artifacts, so approved
issues can continue to the next workflow stage without requiring
Patchmill-generated filenames or saved run state.

## Current behavior

`advancePlanningStages()` resolves workflow artifacts in
`src/cli/commands/run-once/stage-advancement.ts` before invoking Pi for spec or
plan creation. It currently trusts only:

- paths persisted in run state when the referenced files still exist; and
- files in `config.specsDir` or `config.plansDir` whose names contain the
  Patchmill marker `-issue-<number>-`.

If neither source resolves an existing artifact, Patchmill builds a new default
path with `buildSpecPath()` or `buildPlanPath()` and asks Pi to create a new
spec or plan. This can happen even when the issue already has the configured
`spec-approved` and `plan-approved` labels and the body or comments identify the
approved artifacts under different filenames.

Issue titles, bodies, labels, authors, comments, and metadata are untrusted
input. Artifact discovery may parse them as inert data, but must not execute
commands, follow links, or obey instructions embedded in issue content.

## Requirements

- Preserve existing fallback behavior when no approved artifact can be resolved
  from trusted state, repository filenames, or issue content.
- When the issue has the configured spec-approved label, inspect the issue body
  and comments for approved spec artifact references before creating a new spec.
- When the issue has the configured plan-approved label, inspect the issue body
  and comments for approved plan artifact references before creating a new plan.
- Do not require referenced artifacts to use Patchmill-generated filenames.
- Only treat a reference as resolved when it points to an existing file inside
  the repository and the reference is clearly associated with the relevant
  artifact kind.
- Prefer stronger existing signals over weaker ones: saved run state first,
  repository filename discovery second, approved issue-content references third,
  and generated fallback paths last.
- Keep spec and plan resolution independent: resolving an approved plan from
  issue content must not imply that a spec exists unless a spec is also resolved
  or the existing pre-plan shortcut intentionally skips spec creation.
- Normalize resolved artifact paths to repository-relative paths before writing
  run state, comments, prompts, or final results.
- Ignore issue-content references that are absolute paths outside the
  repository, parent-directory escapes, URLs, shell snippets, directories,
  missing files, or ambiguous artifact-kind mentions.
- Continue to record run-state checkpoints when an artifact path is resolved so
  retries remain idempotent.

## Proposed behavior

Add an issue-content artifact resolver used by `resolveWorkflowArtifact()` after
saved state and directory scanning fail.

The resolver should scan the issue body and comments as plain text and extract
candidate Markdown/code/path references only when nearby text clearly identifies
both the artifact kind and approval status. Examples of acceptable signals:

- `Approved spec: docs/designs/custom-spec.md`
- `Spec approved: \`docs/specs/my-feature.md\``
- `Approved plan artifact: [plan](docs/plans/custom-plan.md)`
- Patchmill-style comments such as `Existing plan ready: \`docs/plans/x.md\``
  when the matching approved label is currently present.

The resolver should validate every candidate by resolving it against
`config.repoRoot`, rejecting paths outside the repository, and checking that the
file exists. If multiple valid candidates of the same kind are found, use a
stable deterministic choice and log enough progress data for debugging; a good
initial rule is to prefer the most recent comment over the issue body and the
first valid candidate within that text block.

`advancePlanningStages()` should pass the current labels and issue content into
artifact resolution. If `spec-approved` is present and a spec path is resolved
from issue content, Patchmill should write that path to run state and proceed as
if an existing spec was found. If `plan-approved` is present and a plan path is
resolved from issue content, Patchmill should write that path to run state and
proceed to implementation once all approval gates are satisfied. If no valid
reference is found, current spec/plan creation behavior remains unchanged.

## Affected components

- `src/cli/commands/run-once/artifacts.ts`
  - Add reusable parsing and safe path-validation helpers, or add a focused
    resolver module beside it if keeping filename scanning separate is clearer.
- `src/cli/commands/run-once/stage-advancement.ts`
  - Extend `resolveWorkflowArtifact()` to accept issue-content resolution
    inputs: artifact kind, approval-label gate, issue labels, issue body, and
    comments.
  - Preserve the current precedence of saved state and directory discovery.
  - Write repository-relative paths and existing checkpoints for artifacts found
    from issue content.
- `src/cli/commands/run-once/specs.ts` and `src/cli/commands/run-once/plans.ts`
  - Expose artifact-kind-specific issue-content resolution helpers if the
    generic artifact helper needs kind-specific terms.
- `src/cli/commands/run-once/types.ts`
  - Reuse the existing `IssueSummary.comments` shape; add resolver result types
    only if they improve tests or progress logging.
- `src/cli/commands/run-once/*test.ts`
  - Add direct tests for parsing, path validation, precedence, and full planning
    stage behavior for approved labels.
- `docs/issue-agent-workflows.md`
  - Document that approved issue content can identify existing spec/plan
    artifacts without Patchmill-generated filenames.

## Verification strategy

Targeted automated tests should cover:

- resolving an approved spec path from the issue body when the spec-approved
  label is present and no generated-name spec exists;
- resolving an approved plan path from a recent comment when the plan-approved
  label is present and no generated-name plan exists;
- ignoring the same references when the corresponding approved label is absent;
- rejecting URLs, missing files, directories, absolute paths outside the repo,
  and `../` escapes;
- saved run-state paths and existing generated-name files taking precedence over
  issue-content references;
- `run-once` continuing to implementation for an issue with both approved labels
  and valid existing artifacts; and
- unchanged fallback creation when approved artifact references are missing or
  invalid.

Run targeted tests:

```sh
node --test src/cli/commands/run-once/artifacts.test.ts src/cli/commands/run-once/stage-advancement.test.ts src/cli/commands/run-once/pipeline.test.ts
```

Run the full test suite before merge:

```sh
npm test
```

No dependency changes are expected, so a Nix build is not required unless the
implementation changes `package.json`, `package-lock.json`, or npm shrinkwrap
metadata.
