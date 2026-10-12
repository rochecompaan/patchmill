# Full commit OIDs in implementation results

- **Issue:** #268
- **Status:** Proposed design
- **Review context:** Current planning pull request

## Purpose and evidence

`planning-pr-v1` must detect malformed implementation commit OIDs before it uses
them as ancestry evidence. An existing branch and pull request must survive this
validation error.

The current path accepts abbreviated OIDs through `parsePiResult()`.
`stringArray()` also silently removes non-string entries. The result therefore
bypasses terminal-result repair. `assertPlanningImplementationAncestry()` passes
the reported strings to `PlanningPublicationGit.assertAncestor()`, which
requires full lowercase OIDs. Only `not-ancestor` receives a classified outcome.
`ancestry/invalid-input` escapes as `unexpected-error`.

A read-only reproduction confirmed that an 8-character OID passes parsing and
fails ancestry input validation. Full 40-character and 64-character OIDs pass
syntax validation with mocked ancestry. The reproduction created no remote pull
request. The existing focused parsing, implementation, validation, and
publication Git suites passed all 47 tests before any change.

## Requirements

Successful implementation results use this OID contract:

- `pr-created.commits` is a non-empty array of full commit OIDs.
- `merged.commits` uses the same contract.
- `merged.mergeCommit` is one full commit OID.
- Each OID contains exactly 40 or 64 lowercase hexadecimal characters.
- Abbreviations, refs, uppercase characters, whitespace, empty strings, and
  non-string entries are invalid. Patchmill does not trim, lowercase, resolve,
  or silently remove invalid values.

The non-empty array requirement matches durable implementation evidence. Syntax
validation does not prove that a commit exists or has valid ancestry. The
existing Git proofs remain mandatory.

Malformed OIDs must enter the existing bounded repair loop before planning
validates reported commit ancestry. If repair cannot produce valid OIDs,
Patchmill must return a classified implementation-validation outcome, not
`unexpected-error`.

## Proposed behavior

### Result parsing and repair

`parsePiResult()` validates only the successful implementation OID fields listed
in the contract. It uses the same full-OID grammar as `planningOid`. A dedicated
validation error identifies the result status, field, optional array index, and
required format. It does not use the generic unsupported-status error for an
otherwise recognized implementation result.

`runPiPrompt()` already resumes the exact observed Pi session after a parsing
error. This design keeps its limit of two repair attempts. A valid repaired
result continues through the normal implementation flow.

The landing prompt states the full-OID requirement instead of the ambiguous
`<sha>` placeholder. The repair prompt explains that terminal JSON can contain
invalid fields. For an OID error, it directs the agent to read full OIDs from
the existing phase workspace and correct the report. It must not instruct the
agent to repeat implementation, create another pull request, or replace the
branch. The original validation, review, and PR-check requirements remain in
force.

Repair exhaustion preserves the typed OID-validation cause and existing repair
diagnostics. Planning handling converts that cause to the existing
`implementation-validation` diagnostic with `validationReason: "invalid-oid"`.
The diagnostic identifies the invalid field and the required format. It directs
the operator to inspect and correct evidence for the existing publication.
Unrelated Pi process, cleanup, and infrastructure errors keep their current
handling. Classification must use typed evidence, not error-message matching.

### Defensive planning validation

The implementation ancestry boundary validates OID syntax before it sends
ancestry operands to Git. This covers reported commits, workspace artifact
commits, and base/head evidence. It protects direct callers that bypass parsing.

Both the fresh-result path in `runPlanningImplementation()` and the resumed
`branch-pushed` path in `validatePlanningImplementation()` classify malformed
OID input as `implementation-validation` with `validationReason: "invalid-oid"`.
A remaining `PlanningPublicationGitError` with operation `ancestry` and reason
`invalid-input` receives the same classification. Other Git errors do not. A
valid OID with failed ancestry retains the existing `implementation-ancestry` or
ancestry-validation outcome.

After a result error, Patchmill retains its existing post-agent workspace
recovery. It checkpoints only clean descendant progress that the existing proofs
permit. A malformed report never advances the phase to `branch-pushed`.
Patchmill preserves the workspace, branch, and pull request. Existing ownership
reconciliation supplies the same pull request on a supported retry.

For a valid report, Patchmill retains remote-head, branch, URL, repository,
ownership, and closing-reference validation. It records full OIDs at
`branch-pushed`, then advances to `pull-request-open` after PR validation.

## Affected components and scope

- `src/cli/commands/run-once/implementation-landing-prompt.ts`: State the OID
  contract for `pr-created`.
- `src/cli/commands/run-once/pi.ts`: Validate implementation OID fields and
  preserve typed validation evidence through repair exhaustion.
- `src/cli/commands/run-once/prompts.ts`: Correct the repair explanation and
  give evidence-only OID repair guidance.
- `src/cli/commands/run-once/planning-implementation-adapter.ts`,
  `planning-implementation.ts`, `planning-implementation-ancestry.ts`, and
  `planning-implementation-validation.ts`: Classify OID errors at the agent and
  ancestry boundaries while preserving workspace recovery.
- `src/git/planning-git-validation.ts` and `planning-publication-git.ts`: Keep
  the strict full-OID contract. Reuse its grammar without relaxing Git input.
- `src/issue-run/types.ts` and the durable implementation codec: Keep the JSON
  shape and existing durable validation. Runtime parsing supplies the stronger
  guarantee that plain TypeScript strings cannot supply.

This design does not change `spec-created`, `plan-created`, or `blocked`
parsing. It does not enable agent-supplied merges or direct landing. Valid
`merged` results still meet the existing PR-only rejection policy.

Abbreviation resolution inside Patchmill is rejected. It adds workspace lookup
and ambiguity handling where the existing repair loop can correct the report.
Durable schema migration, automatic PR replacement, history changes, dependency
updates, and classification of missing but syntactically valid commits are out
of scope.

## Verification strategy

Automated tests pass the Testing Value Gate because they protect parsing,
repair, error classification, and durable workflow transitions.

1. Extend `pi-result-parsing.test.ts` for full SHA-1 and SHA-256 OIDs in both
   implementation statuses. Reject short, wrong-length, uppercase, non-hex,
   whitespace, empty, and mixed-type OIDs. Reject missing, empty, or non-array
   `commits` fields. Reject the entire invalid array. Keep spec/plan
   abbreviated-commit and blocked-result compatibility.
2. Extend `pi.test.ts` and implementation workflow coverage with an abbreviated
   initial result and a full-OID repaired result. Prove exact-session reuse,
   bounded attempts, and repair before reported-commit ancestry validation.
   Prove that the workflow reuses the existing PR and records full OIDs at
   `branch-pushed` before normal PR validation advances it.
3. Exhaust OID repair attempts. Assert the classified `invalid-oid` diagnostic,
   preserved workspace progress, and no `branch-pushed` checkpoint or duplicate
   publication. Retain tests for unrelated Pi failures.
4. Extend `planning-implementation.test.ts` and
   `planning-implementation-validation.test.ts` with malformed direct-call
   inputs and defensive `ancestry/invalid-input` errors. Assert classified
   outcomes, including resumed validation. Keep `not-ancestor` and Git command
   failure behavior distinct.
5. Update successful implementation fixtures that currently use abbreviated
   OIDs. Keep intentional malformed cases and spec/plan fixtures unchanged.
   Review generated prompt text directly instead of adding prose-only tests.

Implementation verification runs the focused parsing, repair, implementation,
and publication Git suites. It then runs `npm run test:run-once`, `npm test`,
`npm run lint`, `npm run build`, and `git diff --check`. Mocked provider
evidence is sufficient for this regression. No live PR creation is required.

## Planning handoff

This spec receives review in the current planning pull request. The next
Patchmill workflow step creates the implementation plan without another manual
spec-approval gate. This step changes no code and creates no implementation task
todos.
