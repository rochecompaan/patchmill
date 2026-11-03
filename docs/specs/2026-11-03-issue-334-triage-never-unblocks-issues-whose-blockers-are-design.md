# Native issue dependencies instead of the blocked label

## Intent and decisions

Refs #334.

Patchmill currently leaves dependency-blocked issues outside automatic triage
forever. The original issue proposes a deterministic pass over blocker numbers
in kernel comments. During interactive planning, the maintainer proposed native
issue dependencies instead. The maintainer then excluded automatic migration and
requested manual dependency setup in the issue tracker.

This design replaces the `blocked` outcome with native dependencies. GitHub's
**Blocked by** and Forgejo/Gitea's **Depends on** become the dependency source
of truth. The configured ready label means that work is suitable for automation,
not that its dependencies are complete. Patchmill starts work only after every
native dependency is closed.

The native-dependency approach replaces the original issue's comment parser,
relabeling pass, and automatic unblock comment. This is a bounded workflow
change across triage, host adapters, and issue selection. It is not only a
change to triage candidate selection.

## Current behavior and cause

- `src/kernel/triage.ts` selects unclassified issues and qualifying `needs-info`
  issues. It excludes issues with the configured blocked label.
- The triage skill identifies blockers through a `Blocked by:` line in its
  comment. The kernel stores no native dependency links.
- `src/host/types.ts` exposes issue reads, labels, and comments, but no
  dependency operations.
- `src/kernel/issue-selection.ts` selects open ready or in-progress issues
  without dependency checks. An explicit issue number bypasses label
  eligibility.
- The interactive CLI has its own selection entry point before it opens the
  console. It needs the same dependency policy as the Run-once workflow.
- `docs/agents/issue-tracker.md` already recommends native GitHub dependencies
  for issue tracking.

The skills-first kernel removed the previous blocker-resolution pass without a
replacement. The fault persists because readiness depends on a label that no
remaining step updates. Native dependencies remove the need to synchronize that
label with issue closure.

## Goals

- Keep one dependency source of truth in the issue tracker.
- Record dependencies that triage identifies as native links through
  kernel-owned writes.
- Prevent automatic and explicit runs from starting with open or unreadable
  dependencies.
- Make an issue eligible automatically after its last dependency closes.
- Preserve dry-run behavior without host writes.
- Document the manual upgrade procedure without automatic migration.

## Non-goals

- Automatic conversion of old labels, comments, or issue bodies.
- A comment parser, a label synchronization pass, or an automatic unblock
  comment.
- Automatic removal of dependency links, including links to closed issues.
- Cross-repository dependency creation by triage.
- A new hosting provider, a scheduler, or a background dependency watcher.
- Cancellation of work already active when a maintainer changes a dependency.
- Changes to specification gates, plan gates, or planning approval rules.

## Approaches

### Native dependencies only: selected direction

The issue tracker stores dependencies, while labels describe suitability and the
issue lifecycle. Selection reads current dependencies before work starts. This
avoids duplicate state and handles reopened blockers without another triage run.
It requires host operations and a dependency gate in every run entry point.

The maintainer proposed this direction instead of the original repair. The
maintainer explicitly chose manual dependency setup instead of automatic
migration. The detailed contracts in this document are design proposals for the
specification gate.

### Native dependencies plus a synchronized blocked label: rejected

Native links identify blockers, while a deterministic pass maintains the blocked
label. This preserves the current label vocabulary but retains two
representations of dependency status. It also retains the synchronization
problem that caused this issue.

### Blocker comments plus an unblock pass: superseded

The original proposal needs fewer host changes and restores the previous
behavior. However, comments remain a second dependency format outside the issue
tracker's native graph. This approach does not satisfy the replacement direction
discussed during planning.

## Dependency model and host boundary

A dependency is a directed relationship: issue A depends on issue B. Only B's
closed state satisfies that relationship. A done label, a merged pull request,
or a comment does not substitute for closure. Closed dependencies remain in the
native graph. If B reopens, A becomes ineligible for its next Run attempt.

The host boundary must support these operations:

- List all native dependencies of an issue, including their repository identity,
  issue number, and open or closed state.
- Add a same-repository dependency by issue number. Each adapter resolves any
  provider-specific identifier that the write requires.

Dependency reads must include every page. A successful, complete empty list
means no dependencies. An unavailable endpoint, denied access, malformed
response, or incomplete read does not mean an empty list. The kernel must
distinguish those errors from an issue with no dependencies.

Existing native cross-repository links must not disappear through filtering. The
kernel honors their states if the provider supplies complete dependency data. If
it cannot determine a dependency's state or identity, it treats that dependency
as unreadable. Triage creates only same-repository links in this change.

### Provider mapping

| Host              | Read dependencies                                                         | Add a dependency                                                            |
| ----------------- | ------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| GitHub            | `GET /repos/{owner}/{repo}/issues/{issue_number}/dependencies/blocked_by` | `POST` to the same endpoint with the blocker's database `issue_id`          |
| Forgejo/Gitea API | `GET /repos/{owner}/{repo}/issues/{index}/dependencies`                   | `POST` to the same endpoint with the blocker's `owner`, `repo`, and `index` |

The existing GitHub and Forgejo adapters own API translation and pagination.
GitHub issue numbers and database IDs are not interchangeable. The Forgejo
adapter remains the existing Tea-based integration, not a new Gitea provider. An
unsupported server or disabled dependency feature produces a warning and
prevents a run for the affected issue. There is no fallback to labels or comment
parsing.

## Triage contract

Triage returns one of three configured outcomes: ready, needs-info, or
unsuitable. An otherwise suitable issue remains ready even if it depends on
other issues. Unidentified dependencies still require needs-info.

The result contains exactly these fields:

```json
{
  "label": "<configured outcome>",
  "comment": "<explanation or empty string>",
  "blockedBy": [1, 2]
}
```

`blockedBy` is a required array of same-repository issue numbers. An empty array
proposes no additional dependency links. Nonempty arrays are valid only with the
ready outcome. Each number must be a positive safe integer, distinct, and
different from the target issue number. The kernel rejects invalid results
before host writes. The kernel resolves every proposed blocker before it applies
a result. Unknown or unreadable blockers produce a warning instead of a ready
classification.

The triage envelope includes the current native dependencies as issue data. The
skill remains read-only and does not call dependency mutation APIs. Its comment
explains the result for people, but comment text does not control dependencies
or selection. Existing AI-triage headers and kernel comment markers remain
unchanged.

For a valid result, the kernel adds missing dependency links before it publishes
a ready result. Existing links remain intact, including manually created links
and links absent from `blockedBy`. Repeated proposals for the same dependency do
not create duplicate links or produce an error. A native cycle rejection
produces a warning and prevents successful application of the proposed result.

Before it adds missing dependency links to an already-ready issue, the kernel
removes the ready label under the per-issue lock. If that label change fails, it
stops without dependency writes. It restores ready only after all proposed links
exist. After a dependency write error, the kernel uses needs-info and reports
any partial native changes instead of successful triage. A failed
error-publication write also produces a warning. Already added native links
remain intact for a later retry. The kernel does not roll back or delete links.
Dependency operations and local issue claiming must respect the same per-issue
lock during host mutation. An active local Run attempt prevents triage from
changing that issue's dependencies.

Ordinary triage candidate rules and ascending issue-number order remain
unchanged, except for retirement of the blocked outcome. A ready issue does not
need reclassification after its blockers close. `triage --issue N` can still
request fresh classification, but it does not bypass dependency validation.

## Selection and starting work

All run entry points use one dependency eligibility policy. This includes
automatic runs, explicit `--issue N`, interactive runs, and run-once dry runs.
Automatic selection retains its existing label rules and oldest-created-first
order among eligible issues. An explicit issue number retains its existing label
override, but never overrides the dependency gate.

| Dependency observation    | Automatic selection           | Explicit selection                      |
| ------------------------- | ----------------------------- | --------------------------------------- |
| Complete empty list       | Eligible under existing rules | Eligible under existing rules           |
| All dependencies closed   | Eligible under existing rules | Eligible under existing rules           |
| Any dependency open       | Skip this issue               | Refuse with the open blocker references |
| Any dependency unreadable | Warn and skip this issue      | Warn and refuse with the reason         |

Automatic selection continues to the next eligible issue after a blocked or
unreadable candidate. It reports no eligible issue only after it exhausts the
candidates. An explicit refusal does not claim the issue, provision a worktree,
or start Pi. The interactive CLI applies the gate before it opens a console for
a new Issue run. The console and worker also share the kernel gate, so
interactive selection cannot bypass it.

Immediately before the claim, the kernel reads dependencies again under the
existing per-issue lock. If that read finds an open or unreadable dependency, it
refuses the attempt without a claim or phase session. This recheck also applies
to resumed attempts with an in-progress label. Within an already active attempt,
this change does not introduce continuous dependency monitoring. External
tracker edits remain subject to the host's non-transactional API behavior.

Closing the last blocker makes the issue eligible on the next selection without
a triage run. No resolution label change or automatic resolution comment occurs.
Manually removing a native dependency also changes eligibility on the next
selection.

## Dry runs and reporting

Triage dry run can call Pi, as it does today. It shows proposed dependency
links, label changes, and the proposed comment. It performs no dependency,
label, or comment writes and does not create missing labels.

Run-once dry run performs dependency reads before it reports an eligible issue
and derived phase. It never claims an issue or starts a phase session. Open
blockers and dependency errors remain visible instead of appearing as a runnable
phase.

Warnings identify the dependent issue and the failed dependency operation.
Available blocker references include their repository identity when necessary.
Progress output distinguishes proposed dependency links from applied links.
There is no model call solely to determine whether a native dependency is
closed.

## Configuration and manual upgrade

Remove `labels.blocked` from defaults, runtime label types, label provisioning,
and generated configuration. As with retired review-label keys, the config
reader accepts an old string-valued `labels.blocked` but ignores it. An invalid
value still produces a configuration error. New configuration omits the key. The
kernel does not use old blocked label names as a compatibility dependency
format.

There is no automatic migration, even for comments with clear blocker numbers.
Before they run Patchmill after the upgrade, users must update affected issues
manually:

1. Add each dependency through GitHub's **Blocked by** or Forgejo/Gitea's
   **Depends on** feature.
2. Verify that each link points to the correct issue.
3. Remove the old `blocked` label, or its previously configured replacement.
4. If the issue is otherwise suitable for automation, apply the configured ready
   label.
5. Remove `labels.blocked` from local configuration.

An old blocked label no longer prevents selection after this change. Users must
create the native links before they remove labels or request an explicit run.
Issues without clear blockers require manual assessment in the issue tracker.
Patchmill does not infer links from their historical comments during selection
or upgrade.

Update the README, `docs/agents/triage-labels.md`, and the site triage guide.
Update issue-tracker guidance to remove the comment-based fallback from the
supported Patchmill dependency workflow. Update the bundled triage skill,
envelope, configuration examples, and relevant setup fixtures consistently. Do
not rewrite historical approved specifications.

## Verification requirements

Automated tests must prove behavior at the following boundaries:

- Both host adapters list all dependency pages and translate dependency writes
  correctly. Coverage includes GitHub database-ID lookup and Forgejo dependency
  direction.
- Empty lists, closed blockers, open blockers, reopened blockers,
  cross-repository references, and unreadable states produce the specified
  eligibility.
- Automatic selection skips an older blocked issue and selects the next eligible
  issue.
- Explicit, interactive, dry-run, and resumed attempts cannot bypass the
  dependency gate.
- A blocker change before claim prevents the claim during the locked recheck.
- Triage validates structured results and adds missing links before ready
  publication. It preserves existing links and handles duplicate proposals,
  cycles, lookup errors, and partial writes safely.
- A local issue lock prevents triage dependency writes during an active attempt.
- Triage dry run previews dependency changes without host writes.
- Closing all native dependencies makes an already-ready issue eligible without
  another triage session, label change, or resolution comment.
- Retired config compatibility accepts old string values without provisioning or
  using a blocked label.

Use existing formatting, Markdown lint, type checks, and relevant behavioral
suites during implementation. Review the manual upgrade instructions directly
instead of adding tests that assert documentation text. Provider tests use
fixtures and mocked command responses, not mutation of real issue trackers.

## Frontend applicability

Frontend design does not apply. This change affects host APIs, CLI behavior,
issue selection, and documentation, not browser-visible layout or interactions.
No HTML mockup is required.

## Implementation boundaries

This specification does not prescribe helper names, module splits, or exact
warning wording. The implementation plan must keep provider details outside
kernel policy and reuse one selection policy across entry points. It must
preserve the existing skill installation contract for bundled and installed
triage instructions. No product code or implementation plan accompanies this
specification-stage change.

## References

- [Issue #334](https://github.com/rochecompaan/patchmill/issues/334).
- [GitHub issue dependency API](https://docs.github.com/en/rest/issues/issue-dependencies).
- [Forgejo API schema](https://codeberg.org/swagger.v1.json).
- [Gitea API schema](https://gitea.com/swagger.v1.json).
- [Skills-first kernel design](2026-10-15-skills-first-kernel-design.md).

The dependency endpoints were inspected during planning. A read-only request to
this repository's GitHub dependency endpoint succeeded. The Forgejo and Gitea
endpoint contracts come from their published API schemas, not a live mutation
test.
