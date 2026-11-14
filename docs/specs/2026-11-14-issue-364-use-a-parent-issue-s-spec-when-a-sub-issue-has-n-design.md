# Give sub-issue runs their parent issue's spec

- **Issue:** #364
- **Status:** Proposed for the Interactive Issue run approval dialog.
- **Scope:** Find a sub-issue's parent spec on the base branch and give it to
  every planning and implementation session. The child still writes its own
  short spec.

## Intent

Patchmill finds an issue's spec and plan only by file name. It does not read
parent links. A sub-issue of an issue that already has an approved spec gets no
input from that spec. Its planning session designs from the beginning, and the
new spec can drift from the approved parent design.

Today, sub-issues such as #357–#363 of #356 work around this. Each issue body
names the parent spec and adds a "do not redesign" rule. This change moves that
link and rule into Patchmill.

The parent spec is the approved design for its sub-issues. A sub-issue can still
need a decision that the parent spec does not make, or a detail that only that
slice needs. Thus the child keeps its own spec, and the parent spec is a fixed
input to it.

## Evidence and constraints

- `observe()` in `src/kernel/facts.ts` finds artifacts with
  `artifacts.find(dir, kind)`. `isArtifactFile()` in `src/kernel/names.ts`
  matches only the issue's own number.
- `refArtifacts()` in `src/kernel/artifact-source.ts` can read any issue's
  artifacts from any Git ref without a worktree.
- The worktree starts from the base branch. A parent spec on base is thus also
  at the same relative path in the worktree.
- `GET repos/{owner}/{repo}/issues/{n}/parent` returns the parent issue on
  GitHub. It returns HTTP 404 with `No parent issue found` when the issue has no
  parent. This was checked against #357 and #364.
- Forgejo and Gitea have no sub-issues. The issue-tracker guide already uses a
  `Part of #<map>` line at the start of the body as a fallback parent link.
- `renderRunEnvelope()` in `src/kernel/envelope.ts` writes the Facts block from
  `run-envelope.md`. `formatConsole` in `src/kernel/console.ts` lists the
  artifacts. `PlanningDialogFacts` in `src/console/planning-dialog.ts` lists the
  documents in the approval dialog.

## Decisions

### Approaches

| Approach                                                 | Benefit                                                                                                         | Cost                                                                                                         |
| -------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| A. Child always writes its own short spec                | No change to stages, gates, phases, or the result format. Each child records which parent sections it delivers. | One small document per sub-issue. With the Spec gate on, a maintainer approves it even when it adds nothing. |
| B. Agent can declare the parent spec sufficient          | No child document when the parent covers everything.                                                            | A new result field, kernel state across runs, and new gate logic. No record of the slice in the repository.  |
| C. Kernel skips the spec stage when a parent spec exists | The issue's first proposal. Simple kernel rule.                                                                 | Every issue starts without a spec, so the run never gets the choice to write a child spec.                   |

**Selected approach: A.** The maintainer chose it in the planning chat. Approach
C was rejected because it removes the option to write a child spec.

### Rules that the maintainer decided

1. The parent spec is read-only for the sub-issue run. The envelope and the
   planning skill state this rule. The kernel does not enforce it.
2. The child spec links to the parent spec, names the parent sections that the
   child delivers, and records only the decisions that the parent spec leaves
   open. When there are no such decisions, the child spec says so.
3. If the parent spec is wrong, or conflicts with the slice, the agent stops
   with `needs-input`. It does not change the parent spec and does not override
   it in the child spec.

### Calls by the planner

- **One level only.** Patchmill reads the direct parent. It does not walk to a
  grandparent.
- **Base branch only.** The parent spec must be on `origin/<base>`. A parent
  spec that is only on a branch or in an open PR is not approved. The run
  continues as if there is no parent spec.
- **Same repository only.** A parent in another repository is ignored.
- **Newest file wins.** If the parent has more than one spec on base, use the
  newest by file name. This is the same rule as for the issue's own spec.
- **Lookup failure stops the run.** An error other than "no parent" is not the
  same as "no parent". Silent fallback would allow the drift that this change
  prevents. The error goes up through fact collection, and the run stops with
  `needsInfo` and the error message.
- **No body fallback on GitHub.** GitHub uses only the sub-issues API, as the
  issue says. A `Part of #N` line in a GitHub issue body has no effect.
- **No change to stages and gates.** The child spec goes through the spec stage
  and the Spec gate as it does today.

## Design

### Parent lookup: `Host.parentIssue`

Add one method to the `Host` interface in `src/host/types.ts`:

```ts
/** Same-repository parent issue number, or undefined when there is none. */
parentIssue(issue: Issue): Promise<number | undefined>;
```

The method receives the issue that the run has already read. Each adapter then
uses the source that its host supports, and no adapter needs a second read.

- **`github-gh`:** Call `gh api repos/{owner}/{repo}/issues/<n>/parent`. A 404
  result with `No parent issue found` returns `undefined`. Other failures throw.
  Read `number` and `repository_url`. Return `undefined` when the repository is
  not the configured repository. Throw on a malformed response.
- **`forgejo-tea`:** Read the first non-empty line of `issue.body`. Match
  `^Part of #(\d+)\b`. The match is case-sensitive and allows text after the
  number, for example `Part of #356.` Return `undefined` when the line does not
  match, or when the number is the issue's own number. No API call is made.
- **`test-support/fake-host.ts`:** Store a parent number for each issue, with no
  parent as the default.

The seam is real because two production adapters use different sources. The
kernel needs only "which issue is the parent". It does not need the parent's
title, state, or body.

### Facts: `parentSpec`

Add one optional field to `Facts` in `src/kernel/facts.ts`:

```ts
parentSpec?: { issue: number; path: string };
```

`observe()` sets it after it finds the issue's own artifacts:

1. Call `host.parentIssue(issue)`.
2. If there is a parent, call
   `refArtifacts(git, worktree, "origin/<base>", parent).find(specsDir, "spec")`.
3. If a path is found, set `parentSpec` to the parent number and that path.

The field is independent of `specPath`. A child spec does not hide the parent
spec, and the parent spec does not satisfy `specPath`. `derivePhase()`,
`planningWorkspace()`, and `verifyOutcome()` do not change.

The lookup happens each time facts are collected. This is one host call per
collection. It keeps the fact current when a maintainer links or unlinks a
parent between sessions.

### Envelope

Add one line to the Facts block in `src/kernel/run-envelope.md`, after the Spec
line:

```text
- Parent spec: docs/specs/2026-11-14-issue-356-...-design.md (from issue #356; approved and read-only)
```

When there is no parent spec, the envelope has no Parent spec line. An issue
without a parent thus gets the same envelope as today. The planning and
implementation envelopes both show the line when it exists. The implementation
agent then reads the approved design that the child spec refers to.

When a parent spec exists and the phase is planning, add this rule paragraph
after the result rules. The implementation envelope shows only the Facts line,
because its line already says that the parent spec is read-only.

> The parent spec is the approved design for this issue. Do not change it. If
> this issue has no spec yet, write it at the Spec path. Link to the parent
> spec, name the parent sections this issue delivers, and record only decisions
> the parent spec leaves open. If there are none, say so. If the parent spec is
> wrong or conflicts with this issue, stop and ask instead of choosing.

In an Interactive Issue run, "stop and ask" means "ask the maintainer in the
chat". In an unattended run, it means "return `needs-input`". Use the same
`interactivePlanning` switch that `renderRunEnvelope()` already uses for the
human rules.

### Planning skill

Add a short "Parent spec" section to `skills/patchmill-planning/SKILL.md`. It
repeats the three rules that the maintainer decided. It also tells the planner:

- Read the parent spec before brainstorming. Do not ask the maintainer questions
  that the parent spec answers.
- In a child spec, keep the parent's terms.
- List the parent spec as an input in the plan.
- Give the parent spec to the fresh plan reviewer as a specification input.

Refresh the tracked copy in `.patchmill/skills` with
`node bin/patchmill.ts skills update`. Do not edit that copy by hand.

### Console, dialog, and progress

- **Console** (`src/kernel/console.ts`): in the Artifacts list, add a "Parent
  specification" item before "Specification". Its details are the path and
  `from #356`.
- **Planning dialog** (`src/console/planning-dialog.ts`): add an optional
  `parentSpec` to `PlanningDialogFacts`, and pass it through
  `PhaseLaunch.planningReview`. Show a `Parent   <path> (#356)` line, indented
  like the others, above the Spec line. The dialog's height and viewport rules
  apply to the new line too.
- **Run progress** (`src/kernel/run-progress.ts`): add `parentSpec` with the
  value `{ issue, path } | null` to `RunProgress.facts`. Validation accepts a
  missing field from older records as `null`. It rejects a value with a bad
  number or an unsafe path. Use the same `artifactPath` check as the other
  artifact paths.

The web board does not display the field in this change.

### Documentation

- Glossary: add **Parent spec** and **Sub-issue**. See Companion artifacts.
- `site/src/content/docs/reference/agent-workflow-lifecycle.md`: add a short
  sub-issue section. Describe the parent link for each host, the base-branch
  rule, and the child spec rules.
- `docs/agents/issue-tracker.md`: state that a Forgejo or Gitea `Part of #N`
  first line is also the parent link for Patchmill runs.

## Domain and architecture

The change is architectural in a small way. It adds a method to the `Host` seam
and a fact that every session receives. This is a single-context repository.
There are no ADRs, and no ADR conflicts. The change does not need a new ADR,
because it is easy to reverse and has no hidden trade-off.

Two terms are resolved:

- **Sub-issue**: an issue whose host records a parent issue. On GitHub, this is
  a native sub-issue. On Forgejo and Gitea, it is an issue whose body starts
  with `Part of #N`.
- **Parent spec**: the newest spec of a sub-issue's parent on the base branch.
  It is the approved design for the sub-issue, and the sub-issue's run does not
  change it.

"Inherited spec" is rejected as a term because the child does not take the
parent spec as its own spec.

Module ownership:

- The host adapters own how a parent link is read. Callers do not know about API
  endpoints or body lines.
- `observe()` in the facts module owns the parent-spec rule: one level, same
  repository, base branch only, newest file. Callers receive `parentSpec` or no
  field.
- The envelope, console, dialog, and progress modules only display the fact.

## Frontend design

Frontend design does not apply. The console and dialog changes add one text line
in a terminal. There is no browser-visible change. No mockup is needed.

## Goals and exclusions

Goals:

- Every planning and implementation session of a sub-issue gets the parent spec
  path and the read-only rule.
- The console, the planning dialog, and the progress record show the parent spec
  and its issue.

Exclusions:

- No kernel check that the parent spec stays unchanged. This was the
  maintainer's decision.
- No skipped spec stage and no change to gates.
- No grandparents, no cross-repository parents, and no parent specs that are not
  on base.
- No web board display.
- No change to triage or issue selection.

## Verification and acceptance

| Requirement                                        | Evidence                                                                                                     |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| GitHub parent lookup                               | Adapter tests: a parent, a 404 with no parent, another error, another repository, a malformed response.      |
| Forgejo `Part of #N` lookup                        | Adapter tests: a match, text after the number, a later line, a self-reference, no match, an empty body.      |
| `parentSpec` rules                                 | Facts tests with real Git refs: on base, only on a branch, newest of two, no parent, child and parent specs. |
| Lookup errors stop the run                         | A facts or run-once test in which the host throws, with the run ending in `needsInfo`.                       |
| Envelope shows the fact and rule                   | Envelope tests: with and without a parent spec, and the interactive and unattended rule wording.             |
| Console, dialog, and progress show the parent spec | Existing render tests extended. Progress validation accepts old records and rejects bad values.              |
| Phases and gates do not change                     | Existing `derivePhase`, planning-gate, and verify suites pass without changes.                               |
| Docs and skill                                     | Direct inspection, formatting, and Markdown lint. No tests that assert document sentences.                   |

Run `npm test`, `npm run lint`, and `npm run build`. No npm dependency changes
are expected, so the Nix build is not required unless the dependencies change.

## Companion artifacts

- `GLOSSARY.md`: [Sub-issue and Parent spec](../../GLOSSARY.md)
