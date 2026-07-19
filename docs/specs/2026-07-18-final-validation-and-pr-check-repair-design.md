# Final Validation and PR Check Repair Design

## Goal

Prevent Patchmill implementation sessions from handing off pull requests with
known local validation failures, and give the same session a bounded opportunity
to repair code-related CI failures after it creates a pull request.

The change should remain prompt- and skill-driven. It should not add a new
Patchmill validation state machine, move pull-request creation into the host
provider, or replace the current `pr-created` result contract.

## Motivation

Pull request #99 exposed two gaps in the current workflow:

1. The implementation worker and parent Pi session both ran `npm run lint` and
   observed a Prettier failure in plan/spec files introduced by the branch.
2. The session characterized those files as "unchanged," continued to push the
   branch, created the pull request, and returned a successful `pr-created`
   result.

The final Codex and thermo-nuclear reviews passed because their supplied
validation summary emphasized focused passing tests rather than requiring the
reviewers to independently run and assess every final validation command.
Patchmill then accepted the `pr-created` JSON because `validation` is an opaque
string array rather than a pass/fail gate. CI repeated the lint command and left
the pull request unmergeable.

The failure was avoidable inside the existing Pi implementation session. The
session already has the worktree, validation tools, implementation workers,
reviewers, landing skill, and host CLI access needed to repair both local and
remote failures.

## Current PR Creation Flow

Patchmill's TypeScript host provider manages issues, comments, and labels. It
does not create pull requests.

The top-level Pi implementation session currently:

1. executes the configured implementation skill;
2. runs the configured landing skill;
3. pushes the implementation branch;
4. creates or updates the pull request with repository tooling such as
   `gh pr create --body-file` or `tea pulls create`;
5. returns `pr-created` JSON containing the pull-request URL, branch, commits,
   validation prose, review summary, and landing decision.

`parsePiResult()` validates the required result shape but does not interpret the
validation summaries. `pipeline-finish.ts` records the result, posts the handoff
comment, updates labels, and cleans up the issue worktree.

The new behavior should fit inside the top-level Pi session before that final
JSON is returned.

## Non-goals

- Do not add an orchestrator-owned command executor or validation result schema.
- Do not add new run-state statuses such as `ready-for-validation`.
- Do not move `gh` or `tea` pull-request creation into `IssueHostProvider`.
- Do not replace the existing Codex or thermo-nuclear review rubrics.
- Do not add Codex or thermo-nuclear full-worktree reviews to the new
  validation-only wrapper; it retains the upstream Superpowers task-level
  workflow and adds only final validation and PR readiness.
- Do not ask review-only agents to edit files.
- Do not attempt code repair for cancelled, timed-out, infrastructure,
  permissions, quota, or billing failures.
- Do not wait indefinitely for CI or run an unbounded repair loop.

## Design

### 1. Add a final validation-readiness review

Add a focused reviewer pass after the configured implementation workflow's
existing review work and before the landing step. In the Codex/thermo wrappers,
this is a third final pass after both full-worktree reviews. In the new
validation-only wrapper, it follows the upstream Superpowers task-level
implementation/review workflow without adding Codex or thermo-nuclear passes.

The pass uses the canonical Pi `reviewer` agent in fresh, review-only context
with a dedicated `final-validation-review.md` prompt. It is responsible for
executing and assessing final validation rather than repeating general code or
architecture review.

The reviewer receives:

- the implementation base and head SHAs;
- the complete worktree path and status;
- the approved plan and spec paths;
- validation commands required by the plan, repository instructions, and
  configured workflow;
- prior validation results as evidence, not as permission to skip commands.

The reviewer must:

1. run every required final validation command that is feasible in the prepared
   development environment;
2. report every non-zero command as an actionable finding with the command,
   concise failure output, and affected paths;
3. treat every file introduced or changed between the base and head SHAs as
   implementation scope, including materialized plans and specs;
4. never dismiss a failing file as "unchanged" merely because it was created by
   an earlier workflow commit or was not edited by the implementation worker;
5. distinguish a demonstrated external/environmental blocker from a
   repository-fixable failure;
6. return a clear pass only when required validation passes or an explicitly
   documented command is genuinely unavailable for external reasons.

Validation failures use the implementation skill's existing accepted-finding
repair loop:

1. synthesize the validation findings;
2. dispatch a `worker` with the existing fix-review-findings contract;
3. apply only the necessary fixes;
4. commit the fixes;
5. rerun the final validation-readiness reviewer;
6. continue until it passes or an external blocker requires human input.

Landing must not begin while this reviewer has unresolved validation findings.

### 2. Add a post-PR check repair prompt

After the landing skill creates or updates a pull request, but before the
session returns final `pr-created` JSON, the parent Pi session waits for
required pull-request checks using the configured host tooling.

For GitHub, the session should use `gh pr checks` and obtain failed workflow
logs with `gh run view --log-failed` or an equivalent supported command. For
Forgejo/Gitea, it should use the repository's configured `tea` or API workflow.
If the configured host tooling cannot observe required checks, the session must
report that limitation instead of claiming the pull request is ready.

Check outcomes are handled as follows:

- **All required checks pass:** return the normal `pr-created` final JSON.
- **Test, lint, formatting, type-check, or build failure:** dispatch a worker
  with a dedicated `fix-pr-checks.md` prompt.
- **Cancelled, timed-out, infrastructure, permissions, quota, billing, or host
  service failure:** return a concise blocker for operator action; do not ask a
  code worker to guess at a fix.

The PR-check repair worker receives:

- pull-request URL and branch;
- current head SHA;
- failed check names and URLs;
- relevant failed-step logs;
- approved plan/spec and implementation scope;
- previous local validation and review summaries.

The worker must:

1. reproduce or explain the failed check locally when feasible;
2. make only repository changes needed to repair the demonstrated failure;
3. run focused validation and the final validation command affected by the fix;
4. commit and push the repair to the existing pull-request branch;
5. report the new commit SHA and validation evidence;
6. avoid changing approved product scope or architecture without asking.

After the push, the parent session waits for the replacement checks. It may run
at most two PR-check repair passes. If code-related checks still fail, it
returns a blocker containing the remaining failed checks and links rather than
claiming a ready handoff.

### 3. Preserve the final result contract

No new Patchmill result status is required.

The parent Pi session returns `pr-created` only after:

- final validation-readiness review passes;
- the branch is pushed and the pull request exists;
- all observable required checks pass.

The returned `validation` array should summarize the final passing commands, not
retain superseded failure summaries. The review summary should mention the final
validation review and any PR-check repair passes. The landing decision remains
the reason human review is required.

When the session cannot reach a passing state, it uses the existing `blocked`
contract with concise evidence and recommended operator action.

### 4. Add a validation-only wrapper as the recommended default

Create a Patchmill-owned `subagent-dev-with-validation-and-pr-checks` skill. It
wraps the installed Superpowers `subagent-driven-development` skill in the same
way that `subagent-dev-with-codex-and-thermo-reviews` wraps that task-level
workflow, but deliberately omits the two extra full-worktree Codex and
thermo-nuclear review loops.

Its process is:

1. execute the plan through the installed sibling Superpowers
   `subagent-driven-development` skill, including that workflow's task-level
   implementation and reviews;
2. capture the final base/head/worktree scope;
3. run the shared final validation-readiness reviewer;
4. fix and re-review repository-fixable validation findings;
5. follow the configured landing skill;
6. for PR fallback, wait for checks and use the shared bounded PR-check repair
   prompt before returning `pr-created`.

Patchmill's recommended project-local configuration should point
`skills.implementation` at this wrapper. The raw Superpowers
`subagent-driven-development` skill remains installed in the recommended pack as
the wrapper's dependency and remains available for explicit opt-in. Existing
repositories with explicit implementation skill configuration are not rewritten
by this change. Patchmill's global compatibility fallback may remain the raw
Superpowers skill because the wrapper is guaranteed only after project-local
skill-pack installation.

## Skill-Pack Integration

The canonical source and installed Patchmill skill copies must remain identical.
Changes should cover all three implementation wrappers and their installed
copies:

- `skills/subagent-dev-with-validation-and-pr-checks/`
- `.patchmill/skills/subagent-dev-with-validation-and-pr-checks/`
- `skills/subagent-dev-with-codex-and-thermo-reviews/`
- `.patchmill/skills/subagent-dev-with-codex-and-thermo-reviews/`
- `skills/single-subagent-dev-with-codex-and-thermo-reviews/`
- `.patchmill/skills/single-subagent-dev-with-codex-and-thermo-reviews/`

Add the shared prompt resources to the existing shared workflow directory and
its installed copy:

- `subagent-dev-with-codex-and-thermo-reviews/prompts/final-validation-review.md`
- `subagent-dev-with-codex-and-thermo-reviews/prompts/fix-pr-checks.md`

The Codex/thermo task-by-task implementation skill consumes those prompts
directly. The single-subagent skill and the validation-only wrapper reference
them through `../subagent-dev-with-codex-and-thermo-reviews/`; the raw
Superpowers task-level skill remains a separate dependency.

Update all three wrapper processes so the final validation review runs after
their existing review work and the PR-check readiness loop runs after PR
creation but before final JSON. Update the recommended implementation config to
the validation-only wrapper. Update the installed skill-pack manifest, docs, and
related tests so the wrapper and both new shared prompt resources are
discoverable and installed together.

Patchmill's dogfood landing skill should explicitly defer a successful final
`pr-created` response until the configured implementation skill's PR-check
readiness loop has completed.

## Error Handling and Resumption

- A validation failure remains normal implementation work, not a successful
  handoff with a warning.
- A genuine external blocker uses the existing blocked workflow and preserves
  the branch/worktree for resumption.
- A resumed run must inspect the existing pull request and current head before
  deciding whether to wait, repair, or return success.
- Repair prompts must use current logs and SHAs so stale CI results cannot cause
  edits against a newer branch head.
- The parent must not force-push during repair.

## Testing and Verification

Automated tests should prove behavior at the prompt/skill integration boundary:

1. all three Patchmill wrappers require a final validation-readiness review
   after their existing review work and before landing;
2. the validation-only wrapper executes the sibling Superpowers task-level
   workflow without adding Codex or thermo-nuclear full-worktree reviews;
3. the final validation prompt treats all base-to-head files as in scope and
   reports non-zero required commands as findings;
4. all wrappers forbid landing with unresolved validation findings;
5. the PR-check prompt classifies code failures separately from operator
   failures;
6. the repair loop is bounded to two attempts;
7. `pr-created` is returned only after observable required checks pass;
8. canonical and installed copies of all three wrappers remain synchronized, and
   the shared prompt files are byte-identical;
9. the recommended project-local implementation path points to the new wrapper
   while the raw Superpowers skill remains installed;
10. the skill-pack manifest includes the wrapper and both new prompt resources.

Follow the repository Testing Value Gate: assert rendered behavior and
installation/discovery contracts rather than static Markdown wording. Use
Prettier, Markdown lint, existing skill-pack tests, and the full repository test
suite for verification. No new test should merely assert documentation prose.

## Success Criteria

A Patchmill run equivalent to PR #99 must not create a final handoff while
`npm run lint` is failing on plan/spec files introduced by the branch. The final
validation reviewer must report the failure, the worker repair loop must format
and commit the files, and landing may continue only after validation passes.

If a later CI-only test/lint/build failure occurs, the same Patchmill session
must receive the failed logs, make a bounded repair attempt, push the
correction, and wait for replacement checks. A successful `pr-created` handoff
means the pull request's observable required checks are passing.

A newly initialized repository must select
`.patchmill/skills/subagent-dev-with-validation-and-pr-checks` as its
implementation skill. That wrapper must delegate task execution to the still
installed `.patchmill/skills/subagent-driven-development` dependency and add
only final validation and PR readiness—not Codex or thermo-nuclear reviews.
