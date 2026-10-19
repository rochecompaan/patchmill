# Planning Merge Gates Implementation Plan

> **For agentic workers:** Use executing-plans to implement this approved fix
> inline. The operator has said to proceed; no further design approval is
> needed.

**Goal:** Restore the existing optional spec/plan merge gates and sync the test
repo.

**Architecture:** Keep PR/Git-derived kernel facts. A small planning-workspace
resolver selects the required spec, plan, or implementation branch; the kernel
stops on unmerged planning PRs and resumes under the issue lock after merge.

**Tech Stack:** TypeScript, Node tests, Git, existing GitHub/Forgejo adapters,
Nix.

**Spec:** `docs/specs/2026-10-19-planning-merge-gates-design.md`

## Global Constraints

- Both existing `workflow.*Approval.required` values default to `false`.
- No review/approval labels; retain `in-progress` while waiting.
- Merge, not review approval, advances a required gate.
- Never mark a planning merge done or use closing references in planning PRs.
- Preserve existing safety checks and avoid a persisted workflow state machine.
- No npm/skill-pack dependency changes or live host/model mutations.

## Review Focus

- Both gates omitted: both artifacts reach the implementation PR without waits.
- Mixed gates: ungated artifacts go into the correct later PR.
- Merged planning PR with missing base artifacts: stop rather than bypass
  review.
- Closed/unmerged PR or duplicate stage branches: stop without running Pi.
- Resumed in-progress issue: lock still prevents concurrent execution.

### Task 1: Correct planning progression

**Files:** `src/config/config.ts`,
`src/kernel/{planning-workspace,facts,phase, verify,labels,comments,envelope,run-once}.ts`,
existing kernel/config tests, `test-support/run-once-fixture.ts`, bundled
planning skill, config and live docs.

**Interfaces:** The resolver consumes config, remote branches, and host/Git
facts; it supplies the selected stage, branch, and PR to `collectFacts`.
`Facts.stage` distinguishes planning PRs from implementation PRs. Existing
`planning`/`implementation` session types and host APIs remain stable.

- [x] Write merge-gate lifecycle regressions using the existing real Git
      fixture.
- [x] Run them against the existing kernel and record expected RED failures.
- [x] Implement config, stage resolution, phase/verification, label, and prompt
      changes.
- [x] Replace tests for the retired label-driven behavior; retain safety
      coverage.
- [x] Update the bundled skill and current docs/config to match the approved
      rules.
- [x] Run focused tests, then full tests, lint, build, packed smoke, and Nix
      build.
- [x] Review the final diff against the spec and commit the verified fix.

### Task 2: Sync the local test repo

**Files:** Test repo `devenv.yaml`, `devenv.lock`, managed Patchmill
config/skills, and operator test instructions where needed.

**Interfaces:** Consume Task 1's committed revision and bundled skill files. The
test repo must resolve that revision and install those same managed files.

- [ ] Update the existing Patchmill dependency pin to the fix commit.
- [ ] Refresh the lock and managed files without overwriting unrelated user
      work.
- [ ] Verify the installed CLI/config, dependency revision, and managed skill
      contents.
- [ ] Commit only the test repo update; report the exact revision and retest
      steps.
