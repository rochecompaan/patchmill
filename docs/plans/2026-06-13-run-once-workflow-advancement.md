# Run Once Workflow Advancement Implementation Plan

## Spec reference

- Design: `docs/specs/2026-06-13-run-once-workflow-advancement-design.md`
- Scope: advance `patchmill run-once` through spec, plan, and implementation
  workflow states.
- Actionable labels: `agent-ready`, `spec-approved`, `plan-approved`.
- Waiting labels: `spec-review`, `plan-review`.

## Durable decisions

1. `patchmill run-once` remains the single automation entrypoint.
2. Spec creation precedes plan creation when no plan already exists.
3. A pre-existing plan means the issue can skip spec creation and continue with
   plan/implementation behavior.
4. Required spec approval gates any current spec unless the issue currently
   carries a non-stale `spec-approved` label.
5. Required plan approval gates any current plan unless the issue currently
   carries a non-stale `plan-approved` label.
6. Creating a new spec or plan makes any already-present approval label stale
   for that artifact.
7. Review labels are waiting states and should not be selected automatically.
8. Stage prompts must stay stage-specific: spec prompts write specs, plan
   prompts manage plan task todos, implementation prompts execute plans.
9. Filesystem state checks should only translate `ENOENT` to “missing”; all
   other IO failures must fail loudly with path context.

## Implementation structure

### Workflow state

- Add a canonical workflow-state module for:
  - resolving actionable vs waiting labels,
  - explicit issue approval errors,
  - review-label cleanup rules,
  - plan approval gate decisions.
- Remove stale duplicate approval helpers so approval ownership is in one
  module.

### Workflow artifacts

- Use shared artifact helpers for date prefixes, slugged filenames, issue
  artifact lookup, and path construction.
- Keep spec/plan modules as narrow wrappers:
  - plan filenames: `<date>-issue-<number>-<slug>.md`
  - spec filenames: `<date>-issue-<number>-<slug>-design.md`

### Planning stage orchestration

- Keep `runOneIssue` focused on selection, claim, implementation, and top-level
  failure handling.
- Delegate spec/plan advancement to a shared stage orchestrator that performs:
  1. resolve saved/found/generated artifact path,
  2. create artifact with Pi when needed,
  3. persist run-state checkpoints,
  4. post ready comments,
  5. apply review/approval labels,
  6. return either a final spec/plan result or normalized data for
     implementation.

### Prompts

- Spec prompt:
  - writes and commits the spec only,
  - returns `spec-created`,
  - does not create/update implementation task todos.
- Plan prompt:
  - writes and commits the plan,
  - creates/updates plan task todos according to the task contract,
  - returns `plan-created`.
- Implementation prompt:
  - consumes the approved plan and task todos,
  - reports PR/merge/blocker outcomes.

### Selection and summaries

- Automatic selection accepts actionable labels and ignores waiting review
  labels.
- Explicit issue selection returns `approval-required` for waiting review
  labels.
- Dry-run and CLI summaries report the workflow transition that would be
  attempted.

## Test plan

Focused behavior tests:

- workflow-state resolution and cleanup rules,
- spec and plan artifact filename/path/find behavior,
- prompt contracts for spec, plan, and implementation stages,
- automatic and explicit issue selection by workflow state,
- pipeline paths for:
  - spec creation then spec review,
  - existing spec then spec review,
  - stale spec approval after replacement spec creation,
  - plan creation then plan review,
  - approved plan advancing to implementation,
  - saved artifact access failures that are not `ENOENT`.

Verification commands:

```bash
npm run test:run-once
npm test
npm run lint
npm run build
git diff --check
```

## Completion checklist

- [x] Workflow state labels modeled centrally.
- [x] Spec artifact helpers and configuration added.
- [x] Spec creation result contract added.
- [x] Selection recognizes actionable approval labels.
- [x] Pipeline advances through spec, plan, and implementation stages.
- [x] Spec approval gates existing and newly-created specs.
- [x] Spec prompt no longer leaks plan-task todo mechanics.
- [x] Saved artifact access fails fast for non-`ENOENT` errors.
- [x] Shared artifact helpers eliminate spec/plan copy-paste.
- [x] Approval ownership consolidated into workflow-state.
- [x] Oversized implementation plan compressed to durable decisions.
