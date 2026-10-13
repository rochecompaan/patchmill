# Full Commit OIDs in Implementation Results — Implementation Plan

> **For agentic workers:** Use Native execution through
> `.patchmill/skills/inline-dev-with-validation-and-pr-checks`. Its required
> executor is the sibling `.patchmill/skills/executing-plans/SKILL.md`. Run the
> tasks in order. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Reject malformed implementation OIDs through terminal-result repair
without changes to the existing branch, phase workspace, or pull request.

**Architecture:** A focused validator supplies the strict Git OID grammar and
typed field errors. Pi preserves these errors through bounded repair.
Implementation boundaries classify invalid evidence after safe workspace
recovery, while existing Git and PR proofs remain mandatory.

**Tech Stack:** TypeScript, Node.js 24, `node:test`, Git, mocked Pi and
pull-request host operations, npm.

**Spec:**
`docs/specs/2026-10-12-issue-268-planning-pr-v1-rejects-abbreviated-implementation-commit-oids-after-pr-creation-design.md`

## Global Constraints

- `pr-created.commits` and `merged.commits` must be non-empty arrays of full
  commit OIDs.
- `merged.mergeCommit` must be one full commit OID.
- Each OID contains exactly 40 or 64 lowercase hexadecimal characters.
- Reject abbreviations, refs, uppercase characters, whitespace, empty strings,
  and non-string entries.
- Do not trim, lowercase, resolve, or silently remove invalid values.
- Keep the existing limit of two repair attempts in the exact observed Pi
  session.
- Classify malformed OIDs as `implementation-validation` with
  `validationReason: "invalid-oid"`.
- Use typed evidence for classification. Do not match error messages.
- Keep `spec-created`, `plan-created`, and `blocked` parsing unchanged.
- Keep the PR-only policy. A valid `merged` result remains unacceptable to the
  implementation agent.
- Keep the durable JSON shape, codec, remote-head proofs, repository identity,
  ownership marker, URL, branch, and closing-reference validation.
- Never checkpoint a malformed implementation report as `branch-pushed`.
- Preserve the phase workspace, branch, and existing pull request after an OID
  error.
- Do not change dependencies, durable schema, branch history, or publication
  ownership rules.
- Do not classify missing but syntactically valid commits as malformed OIDs.
- Carry this plan and its spec with implementation code. Do not create a
  separate planning pull request.
- This plan does not authorize implementation before the existing planning
  review gates permit it.

## Review Focus

These cases extend the reported short-OID example. Each case has coverage in its
owning task.

1. Mixed-type arrays must fail as a whole, including a valid first OID followed
   by an invalid entry. Task 1.
2. Missing or malformed `merged.mergeCommit` must produce a typed field error,
   not an unsupported-status error. Tasks 1 and 4.
3. Wrapped OID errors must remain classifiable without hiding concurrent
   cleanup, process, or observation errors. Tasks 2 and 3.
4. Malformed workspace artifact, base, or head evidence must fail before Git
   receives ancestry operands, including recovery and resumed validation.
   Task 3.
5. A full but missing commit must retain Git command-failure handling. Syntax
   validation must not invent an ancestry proof. Task 3.

## Evidence and Testing Value Gate

A read-only reproduction showed that `a1b2c3d4` passes parsing, then fails
`ancestry/invalid-input` before Git runs. The six-suite baseline passed 94
tests.

New behavior tests pass all four Testing Value Gate questions. They detect
meaningful parsing, repair, and workflow regressions at reusable boundaries.

Do not add prompt-prose or dependency-value tests. Use direct prompt inspection
and the existing prompt suite instead.

## File Structure

Paths in this table are relative to the repository root.

| File                                                                          | Responsibility                                                                  |
| ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| `src/cli/commands/run-once/implementation-oid-validation.ts` (new)            | Full-OID validation, typed locations, and typed cause lookup.                   |
| `src/cli/commands/run-once/pi.ts`                                             | Successful implementation parsing and preservation of exhausted parsing causes. |
| `src/cli/commands/run-once/pi-session-repair.ts`                              | Structured OID facts for repair.                                                |
| `src/cli/commands/run-once/implementation-landing-prompt.ts`                  | Full-OID contract for successful PR reports.                                    |
| `src/cli/commands/run-once/prompts.ts`                                        | Terminal-result repair guidance that preserves existing publication.            |
| `src/cli/commands/run-once/planning-implementation-ancestry.ts`               | Validation of all implementation ancestry operands.                             |
| `src/cli/commands/run-once/planning-implementation-workspace-recovery.ts`     | Safe progress recovery with validated ancestry operands.                        |
| `src/cli/commands/run-once/planning-implementation-diagnostics.ts`            | Invalid-OID diagnostic facts using the existing catalog entry.                  |
| `src/cli/commands/run-once/planning-implementation.ts`                        | Fresh-result and agent-error classification after workspace recovery.           |
| `src/cli/commands/run-once/planning-implementation-validation.ts`             | Resumed validation and `invalid-oid` reason.                                    |
| `src/cli/commands/run-once/planning-implementation-oid-repair.test.ts` (new)  | Real adapter/parser/repair flow with mocked external operations.                |
| Existing parsing, Pi, planning implementation, and validation test files      | Focused behavior and regression coverage.                                       |
| `test-support/run-once/pipeline-fixtures.ts` and affected run-once test files | Valid success fixtures that pass through the stronger parser.                   |

Keep `planning-git-validation.ts`, `planning-publication-git.ts`,
`issue-run/types.ts`, and the durable implementation codec unchanged. Reuse
`planningOid` rather than duplicate or relax its grammar.

`pi.ts` and `prompts.ts` are already large modules. Put new validation logic in
the focused module. Limit their edits to parsing, error causes, and prompt
construction.

## Execution Setup

- [ ] Read the spec, `AGENTS.md`, `CONTEXT.md`, and the configured
      implementation skill.
- [ ] Reuse this issue worktree and start this plan's ledger with the installed
      `sdd-workspace` script.
- [ ] Reopen task todos for approved implementation and use the sibling
      executor's `task-start` and `task-done` scripts.

The parent session is the sole writer. Use one final independent review, without
task implementers or per-task reviewers.

All commands run from the issue worktree root after the configured
development-environment stage. Record commands, commits, results, and rulings in
the ledger.

Each task commit must succeed and contain only the named task files.

### Task 1: Enforce the implementation result OID contract

**Files:** Create `implementation-oid-validation.ts` in the run-once directory.
Modify `pi.ts`, `implementation-landing-prompt.ts`, and
`pi-result-parsing.test.ts` there.

**Interfaces:**

Produce these exports from `implementation-oid-validation.ts`:

```ts
export type ImplementationOidContext =
  | "pr-created"
  | "merged"
  | "planning-ancestry";
export type ImplementationOidLocation = {
  context: ImplementationOidContext;
  field: string;
  index?: number;
};
export const IMPLEMENTATION_OID_FORMAT =
  "full lowercase 40-character SHA-1 or 64-character SHA-256 commit OID";
export declare class ImplementationOidValidationError extends Error {
  readonly context: ImplementationOidContext;
  readonly field: string;
  readonly index?: number;
  readonly requiredFormat: string;
  constructor(location: ImplementationOidLocation, options?: ErrorOptions);
}
export function assertImplementationOid(
  value: unknown,
  location: ImplementationOidLocation,
): asserts value is string;
export function parseImplementationCommits(
  value: unknown,
  context: ImplementationOidContext,
): string[];
```

The error message identifies the context, field, optional index, and required
format. An array-shape error also states the non-empty array requirement.

- [ ] **Step 1: Add failing parser tests.**

Use `sha1 = "a".repeat(40)` and `sha256 = "b".repeat(64)`. Keep the existing
metadata and visual-evidence assertions.

| Test name                                                    | Inputs and assertions                                                                                                                                                                    |
| ------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `accepts full implementation OIDs for both statuses`         | For `pr-created` and `merged`, assert exact preservation of SHA-1 and SHA-256 commits. Use each length for `mergeCommit` too.                                                            |
| `rejects malformed implementation OIDs with field locations` | Reject `a1b2c3d4`, `HEAD`, `"a".repeat(39)`, lengths 41/63/65, uppercase, non-hex, spaces, tabs, newlines, and `""`. Assert the typed error, context, field, index, and required format. |
| `rejects the entire invalid commits array`                   | Reject `[sha1, 123]`, `[sha1, null]`, and `[sha1, "abc123"]`. Assert `field === "commits"` and `index === 1`.                                                                            |
| `rejects missing empty and non-array implementation commits` | Reject omitted `commits`, `[]`, `null`, a string, and an object for both statuses. Assert a typed array-shape error without an index.                                                    |
| `rejects missing and malformed mergeCommit as an OID error`  | Reject omitted, non-string, short, uppercase, and whitespace values with otherwise valid `merged` fields. Assert `field === "mergeCommit"`, without an index.                            |
| `preserves planning and blocker parsing compatibility`       | Keep short `spec-created.commit` and `plan-created.commit` values. Assert unchanged blocked-result array filtering and unsupported-status behavior.                                      |

Use error-property assertions for the initial failing run. Do not import the new
module before it exists.

```ts
assert.throws(() => parsePiResult(stdout), {
  name: "ImplementationOidValidationError",
  context: "pr-created",
  field: "commits",
  index: 1,
  requiredFormat:
    "full lowercase 40-character SHA-1 or 64-character SHA-256 commit OID",
});
```

After implementation, also assert
`error instanceof ImplementationOidValidationError` and use the exported format
constant.

- [ ] **Step 2: Run the parser suite before implementation.**

Run:
`GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_NOSYSTEM=1 node --test src/cli/commands/run-once/pi-result-parsing.test.ts`

Expected: The new rejection cases fail because the parser accepts or filters
invalid values. Existing planning compatibility tests pass.

- [ ] **Step 3: Implement the validator exports.**

Require `typeof value === "string"` before `planningOid.test(value)`. Validate
each array entry without filtering or normalization. Reject missing, empty, and
non-array commits.

- [ ] **Step 4: Use the validator in
      `parsePiResult(stdout: string): AgentIssuePiResult`.**

Replace `stringArray()` only for successful implementation commits. Validate
`merged.mergeCommit` inside the recognized result branch, including
missing/non-string values. Leave other result fields and statuses unchanged.

- [ ] **Step 5: State the full-OID requirement in
      `renderPrCreatedContract(branch: string): string`.**

Replace its ambiguous successful-report placeholder with `<full commit OID>`.
State both accepted lengths, lowercase hexadecimal syntax, and the non-empty
array rule. Leave the blocked contract unchanged.

- [ ] **Step 6: Run the parser command again.**

Expected: All parser tests pass. Directly inspect a generated landing contract
for the full-OID instruction and unchanged PR-only policy.

- [ ] **Step 7: Commit the task.**

Stage only the four Task 1 files. Run
`git commit -m "fix(run-once): validate full implementation result OIDs"`.

**Task checkpoint command:** The Step 2 parser command. Expected: Exit 0.

### Task 2: Preserve typed OID errors through terminal-result repair

**Files:** Modify `implementation-oid-validation.ts`, `pi.ts`,
`pi-session-repair.ts`, `prompts.ts`, and `pi.test.ts` in the run-once
directory. Extend `pi-session-repair.test.ts` for structured facts.

**Interfaces:** Consume Task 1's error and format exports. Add:

```ts
export function findImplementationOidValidationError(
  error: unknown,
): ImplementationOidValidationError | undefined;
```

Search a cycle-safe `Error.cause` chain. Return no OID classification for an
`AggregateError`, including one encountered inside that chain. Concurrent
infrastructure errors must remain visible.

Add optional `PiRepairFacts.implementationOidError` with
`ImplementationOidLocation` fields and `requiredFormat: string`. Keep existing
repair facts and prompt-builder signatures.

- [ ] **Step 1: Add failing OID repair tests.**

In `pi.test.ts`, use the existing mock runner and exact-session JSONL pattern.
Name the cases `repairs abbreviated implementation OIDs in the exact session`,
`accepts full OIDs on the second repair`, and
`retains typed OID cause after repair exhaustion`.

Assert these outcomes:

```ts
assert.equal(result.status, "pr-created");
assert.deepEqual(result.commits, ["a".repeat(40)]);
assert.equal(sessions[0], sessions[1]);
// For second-attempt success and exhaustion:
assert.equal(calls, 3); // original invocation plus two repairs
// For exhaustion:
assert.ok(error instanceof Error);
assert.ok(error.cause instanceof ImplementationOidValidationError);
assert.match(error.message, /Pi repair attempts exhausted after 2 attempts/);
```

For exhaustion, retain assertions for unresolved-run summary, assistant excerpt,
and last parse-error details. Repeat with malformed `merged.mergeCommit` to
preserve its location.

Add `preserves OID cause when later repair output is prose`. Start with a
malformed OID report, then return prose twice. Assert a typed OID cause and the
final prose parse-error diagnostics.

In `pi-session-repair.test.ts`, add `reports structured OID repair facts`.
Assert exact context, field, index, and format from a typed parse error. Assert
no OID fact for unrelated parse errors.

- [ ] **Step 2: Run the repair suites before implementation.**

Run:
`GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_NOSYSTEM=1 node --test src/cli/commands/run-once/pi.test.ts src/cli/commands/run-once/pi-session-repair.test.ts`

Expected: Typed exhaustion-cause and structured-fact tests fail. Task 1 already
permits successful repair of an invalid OID.

- [ ] **Step 3: Preserve the exhausted parsing cause in `runPiPrompt()`.**

Retain the most recent typed OID error across parsing attempts. Attach that
error as the exhaustion error's cause. If no OID error exists, attach the final
`parseError` instead.

Keep final parse-error diagnostics, exact-session observation offsets, attempt
limit, and aggregation behavior. Retain typed OID repair facts across later
prose-only responses. Do not classify runner or infrastructure failures from an
earlier OID error.

- [ ] **Step 4: Populate typed OID facts in `readPiRepairFacts()`.**

Use the typed cause helper. Do not infer OID errors from message text.

- [ ] **Step 5: Correct
      `buildImplementationRepairPrompt(input: PiRepairPromptInput): string`.**

Explain that a terminal result can be absent or contain invalid fields. For
typed OID facts, identify the field and accepted format.

Direct the agent to read full OIDs from the existing phase workspace, for
example with `git rev-parse --verify <commit>^{commit}`. Require correction of
the report only. Explicitly prohibit repeated implementation, another PR, or
branch replacement. Preserve the existing finalization, validation, review, and
PR-check requirements.

- [ ] **Step 6: Run repair and existing prompt suites.**

Run:
`GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_NOSYSTEM=1 node --test src/cli/commands/run-once/pi.test.ts src/cli/commands/run-once/pi-session-repair.test.ts src/cli/commands/run-once/prompts.test.ts`

Expected: Exit 0. Existing nonzero-exit, unobserved-session, observation, and
cleanup tests retain their behavior.

Directly inspect generated generic and OID-specific repair prompts. Do not add
prose-only assertions.

- [ ] **Step 7: Commit the task.**

Stage only the Task 2 files. Run
`git commit -m "fix(run-once): preserve typed OID repair failures"`.

**Task checkpoint command:** The Step 6 command. Expected: Exit 0.

### Task 3: Classify invalid OIDs at implementation boundaries

**Files:** Modify the five planning implementation modules listed in File
Structure, including workspace recovery and diagnostics. Extend
`planning-implementation.test.ts` and
`planning-implementation-validation.test.ts`. Create
`planning-implementation-ancestry.test.ts` for direct operand coverage.

**Interfaces:** Consume Task 1's validator and Task 2's cause lookup. Keep the
existing ancestry, recovery, runner, and validation input/output signatures.

Add `"invalid-oid"` to `PlanningImplementationValidationReason`. Add this
diagnostic builder in `planning-implementation-diagnostics.ts`:

```ts
export function implementationInvalidOidFailure(
  state: PlanningStateV1,
  phase: Extract<PlanningStateV1["phases"][number], { kind: "implementation" }>,
  error: ImplementationOidValidationError,
  pullRequestUrl?: string,
  workspaceEvidence?: ReturnType<typeof unsafeWorkspaceEvidence>,
): RunOnceFailure<"implementation-validation">;
```

Its context uses `implementationDiagnosticBase()`,
`validationReason: "invalid-oid"`, and optional `pullRequestUrl`. Put the
required format in `expected`. Put context, field, and optional index in
`observed`. Include unsafe recovery evidence there when supplied. Existing
catalog actions direct correction of the existing publication.

- [ ] **Step 1: Add failing defensive and classification tests.**

| Test name and suite                                                                        | Assertions                                                                                                                                                                                                                |
| ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `validates every ancestry operand before Git` in the new ancestry suite                    | Malformed reported commits, empty arrays, workspace artifact OIDs, `baseOid`, `savedHeadOid`, and `headOid` throw typed location errors. Assert zero ancestry calls for each malformed input.                             |
| `classifies malformed direct implementation reports` in the runner suite                   | Return short/non-string commits through a direct `runAgent` callback. Assert blocked `implementation-validation`, `invalid-oid`, field/format facts, and no `branch-pushed` checkpoint.                                   |
| `classifies typed agent errors after clean progress recovery` in the runner suite          | Throw an exhausted repair error with typed cause. Assert clean descendant head recovery, `workspace-ready` status, preserved identity, and no publication effects.                                                        |
| `does not adopt dirty or unproven progress after OID failure` in the runner suite          | For dirty, missing, and non-descendant workspaces, retain the saved head and workspace. Keep existing recovery diagnostics visible.                                                                                       |
| `classifies invalid OIDs during workspace recovery` in the runner suite                    | Reject malformed saved/observed heads before a recovery ancestry call. Do not checkpoint them.                                                                                                                            |
| `classifies malformed resumed implementation evidence` in the validation and runner suites | Bypass the durable codec deliberately. Assert `PlanningImplementationValidationError.validationReason === "invalid-oid"`, then the runner's public diagnostic. Do not invoke the agent or advance to `pull-request-open`. |
| `classifies remaining ancestry invalid-input only` in both planning suites                 | Inject `new PlanningPublicationGitError("ancestry", "invalid-input")` with valid operands. Assert `invalid-oid`. A different operation's `invalid-input` still propagates.                                                |
| `keeps ancestry and infrastructure failures distinct` in both planning suites              | `not-ancestor` retains the existing ancestry outcome. `command-failed` for a full but missing OID, host errors, and ordinary agent errors still propagate.                                                                |
| `does not hide infrastructure errors beside OID failures` in the runner suite              | An aggregate containing a typed OID cause and cleanup/process failure still throws. A plain message resembling an OID error does not classify.                                                                            |

For classified outcomes, assert
`publicFailure.reason === "implementation-validation"` and
`diagnosticContext.validationReason === "invalid-oid"`. Assert the field and
format facts. Assert that no checkpoint contains `branch-pushed`.

Update the existing empty-commits direct-call test to expect `invalid-oid`,
rather than late durable-codec failure. Keep tests for other invalid durable
evidence.

- [ ] **Step 2: Run the planning suites before implementation.**

Run:
`GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_NOSYSTEM=1 node --test src/cli/commands/run-once/planning-implementation-ancestry.test.ts src/cli/commands/run-once/planning-implementation.test.ts src/cli/commands/run-once/planning-implementation-validation.test.ts`

Expected: New malformed-input cases fail through unclassified errors or accepted
mock ancestry.

- [ ] **Step 3: Validate ancestry inputs in
      `assertPlanningImplementationAncestry()`.**

Validate all reported commits, workspace-source artifact commit OIDs, and
base/head evidence before the first Git call. Use context `planning-ancestry`.

Use field `commits` with the original entry index. Use `baseOid`,
`savedHeadOid`, and `headOid` for scalar evidence. Identify artifacts with field
`phases[phaseIndex].artifacts[artifactIndex].commitOid`. Retain deduplication
and existing ancestry proofs after validation.

Translate only Git operation `ancestry` with reason `invalid-input` to a typed
OID error. Use field `ancestry.operands` for this defensive fallback and
preserve its original cause. Keep `not-ancestor` handling unchanged.

- [ ] **Step 4: Protect ancestry operands in `recoverPostAgentWorkspace()`.**

Validate ready workspace and saved-head OIDs before equality or ancestry proofs.
Apply the same narrow defensive Git-error translation. Keep dirty/missing and
non-descendant recovery behavior unchanged.

- [ ] **Step 5: Classify fresh-result and thrown agent OID errors in
      `runPlanningImplementation()`.**

Use the diagnostic builder and typed cause lookup. Run existing post-agent
recovery before classifying an agent parsing failure. Return its recovered
state, not the stale input state. Classify recovery OID errors without advancing
state. Preserve unrelated errors and unsafe-workspace evidence.

Keep `createPlanningImplementationAdapter()` transparent to typed exceptions. Do
not convert an OID error into a generic blocker before recovery.

- [ ] **Step 6: Classify resumed ancestry OID errors in
      `validatePlanningImplementation()`.**

Translate typed syntax errors to
`PlanningImplementationValidationError("invalid-oid", facts)`. Retain the
existing runner translation to `implementation-validation`. Keep all PR
validation and finish-effect gates.

- [ ] **Step 7: Run the Step 2 command again.**

Expected: Exit 0. Malformed inputs never become `unexpected-error`. Valid but
unrelated ancestry and infrastructure errors retain their original handling.

- [ ] **Step 8: Commit the task.**

Stage only the Task 3 modules and tests. Run
`git commit -m "fix(run-once): classify invalid implementation OID evidence"`.

**Task checkpoint command:** The Step 2 command. Expected: Exit 0.

### Task 4: Prove repair ordering and publication recovery

**Files:** Create
`src/cli/commands/run-once/planning-implementation-oid-repair.test.ts`. Update
affected successful-result fixtures in
`test-support/run-once/pipeline-fixtures.ts` and run-once test files.

**Interfaces:** Consume `createPlanningImplementationAdapter()`,
`runPlanningImplementation()`, and Tasks 1–3 without changing their public
signatures. Use real `runImplementationAgent()` and `runPiPrompt()` through the
adapter, not a replacement parser or repair mock.

- [ ] **Step 1: Build the integration fixture.**

Use `makeConfig()`, `createMockRunner()`, and a temporary phase workspace.
Supply one carried spec and plan artifact, one closed issue-tagged todo, full
workspace/base OIDs, and a valid owned open PR. Use
`validation: ["npm test passed"]` so the unchanged durable codec accepts success
evidence.

Use issue #268 and canonical URL `https://github.com/acme/patchmill/pull/268`.
Match the branch and head to the phase workspace. The PR body contains
`Closes #268` and the exact implementation ownership marker from
`renderPlanningPullRequestMarker()`. Validate checkpoints with
`validatePlanningState()`.

Record Pi calls, exact session paths, reported-commit ancestry calls, checkpoint
statuses, and publication count. Stub Git and host operations. No live provider,
push, or PR creation is required.

- [ ] **Step 2: Add the ordering and recovery regressions.**

| Test name                                                  | Assertions                                                                                                                                                                                                |
| ---------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `repairs abbreviated OIDs before reported-commit ancestry` | Initial `pr-created` reports `a1b2c3d4`. Repair returns the full workspace commit. Assert the same Pi session, two calls, no short ancestry operands, and no reported-commit proof before repair returns. |
| `records full OIDs before normal PR validation`            | Assert `branch-pushed` contains only full OIDs. Assert PR readback succeeds before `pull-request-open`. Parameterize full SHA-1 and SHA-256 evidence with mocked ancestry.                                |
| `preserves publication after exhausted OID repair`         | Three invalid responses yield classified `invalid-oid`, clean progress at `workspace-ready`, no `branch-pushed`, and one existing publication.                                                            |
| `reuses the same PR on supported retry`                    | Resume the saved exhaustion state. Owned-PR reconciliation supplies the same URL and branch to the implementation prompt. A valid result reaches `pull-request-open` without another publication.         |
| `keeps PR-only rejection for valid merged results`         | Full `merged` evidence reaches the existing policy rejection. Malformed merged evidence enters parsing repair first. Do not enable direct landing.                                                        |

Keep recovery ancestry distinct from reported-commit ancestry. Recovery can
prove clean progress after an exhausted report, but must not use malformed
reported commits.

- [ ] **Step 3: Run the new integration suite.**

Run:
`GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_NOSYSTEM=1 node --test src/cli/commands/run-once/planning-implementation-oid-repair.test.ts`

Expected: Exit 0 with Tasks 1–3. To prove the regression tests, run them against
the pre-fix commit in a disposable copy. Expected there: Failed
repair-order/classification assertions. Do not alter the active branch for that
comparison.

- [ ] **Step 4: Update successful parser-facing fixtures.**

Start with `pipeline-fixtures.ts`, `pipeline-landing.test.ts`,
`pipeline-implementation-scenarios.test.ts`,
`pipeline-progress-scenarios.test.ts`, and
`pipeline-selection-scenarios.test.ts`. Inspect other failures from the run-once
suite individually.

Replace only successful implementation OIDs consumed by the runtime parser and
their matching expected values. Use deterministic full OIDs, not arbitrary
padding of production data. Leave malformed regressions, spec/plan commits,
blocked reports, and legacy run-state fixtures unchanged.

- [ ] **Step 5: Run the complete run-once suite.**

Run: `npm run test:run-once`

Expected: Exit 0. Existing direct-merge rejection tests fail for policy, not OID
syntax. Existing recovery, task completion, and PR checks retain their behavior.

- [ ] **Step 6: Commit the task.**

Stage the integration test and only the affected fixture files. Run
`git commit -m "test(run-once): cover OID repair and existing PR recovery"`.

**Task checkpoint command:** `npm run test:run-once`. Expected: Exit 0.

## Final Validation and Review

- [ ] Run the focused regression and strict Git suites:

```sh
GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_NOSYSTEM=1 node --test \
  src/cli/commands/run-once/pi-result-parsing.test.ts \
  src/cli/commands/run-once/pi.test.ts \
  src/cli/commands/run-once/pi-session-repair.test.ts \
  src/cli/commands/run-once/implementation-agent.test.ts \
  src/cli/commands/run-once/planning-implementation-ancestry.test.ts \
  src/cli/commands/run-once/planning-implementation.test.ts \
  src/cli/commands/run-once/planning-implementation-validation.test.ts \
  src/cli/commands/run-once/planning-implementation-oid-repair.test.ts \
  src/git/planning-publication-git.test.ts \
  src/git/planning-publication-git.real.test.ts \
  src/workflow/planning-state.test.ts
```

Expected: Exit 0. The strict Git and unchanged durable-codec suites still reject
abbreviated persisted evidence.

- [ ] Run each repository validation command:

```sh
npm run test:run-once
npm test
npm run lint
npm run build
git diff --check
```

Expected: Each command exits 0. Record unavailable infrastructure or
pre-existing failures as blockers, not speculative code changes.

No dependency or skill-pack changes are planned. If approved implementation
changes npm dependency files, `AGENTS.md` also requires
`nix build .#patchmill --print-build-logs`.

- [ ] Generate the landing contract for direct inspection:

```sh
node --input-type=module <<'JS'
import { renderLandingResultContracts } from './src/cli/commands/run-once/implementation-landing-prompt.ts';
console.log(renderLandingResultContracts({
  allowDirectLand: false, hasLandingSkill: true, targetBranch: 'main',
  remote: 'origin', issueNumber: 268, branch: 'agent/268',
}));
JS
```

Expected: Exit 0. The successful contract requires full lowercase
40/64-character OIDs and a non-empty commits array.

- [ ] Generate generic and OID-specific repair prompts for direct inspection:

```sh
node --input-type=module <<'JS'
import { buildImplementationRepairPrompt } from './src/cli/commands/run-once/prompts.ts';
import { IMPLEMENTATION_OID_FORMAT } from './src/cli/commands/run-once/implementation-oid-validation.ts';
for (const implementationOidError of [undefined, {
  context: 'pr-created', field: 'commits', index: 0,
  requiredFormat: IMPLEMENTATION_OID_FORMAT,
}]) {
  console.log(buildImplementationRepairPrompt({
    attempt: 1, maxAttempts: 2,
    facts: {
      sessionPath: '/tmp/parent.jsonl', sessionByteSize: 0,
      parseErrorMessage: 'invalid terminal result',
      unresolvedSummary: 'no unresolved async subagent runs detected',
      subagentRuns: [],
      ...(implementationOidError ? { implementationOidError } : {}),
    },
  }));
}
JS
```

Expected: Exit 0. OID guidance requires report correction in the existing
workspace, without repeated implementation or replacement publication.

- [ ] Prepare one whole-branch review package under the configured
      implementation wrapper.
- [ ] Supply the immutable base/head, spec, plan, Review Focus, ledger, and
      command evidence to one independent reviewer.
- [ ] Apply the wrapper's one ordered fix pass for accepted Critical and
      Important findings.
- [ ] Run every required validation command again against the final state.
- [ ] Preserve PR-only publication, required checks, and the existing
      terminal-result contract during handoff.

## Planning Completion Record

This document contains four actionable implementation tasks. Local todos use
`issue-268-task-01-*` through `issue-268-task-04-*`, with `agent-issue` and
`issue-268` tags.

Planning closes those records only after the plan-only commit succeeds. Approved
implementation reopens them and records actual task evidence. Do not commit
`.pi/todos` or plan workspace scratch files.

The plan receives self-review against the spec, issue, project instructions,
Testing Value Gate, interfaces, and simple-English rules. This planning phase
changes no code and creates no pull request.
