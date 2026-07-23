# Issue #109 Todo Terminal Status Design

**Date:** 2026-07-23 **Status:** Proposed; implementation pending

## Problem

Patchmill's bundled Pi `todo` tool can persist `status: "complete"`, but the
status is not interpreted consistently. The todo extension treats only `closed`
and `done` as closed, while the default Patchmill task contract treats `closed`,
`completed`, and `done` as final-gate done statuses. As a result, an
implementation agent can mark every issue task todo `complete`, receive a
successful todo-tool response, and still have Patchmill reject `pr-created` or
`merged` with `0/N complete`.

The same mismatch can keep run progress on the first implementation task because
progress reads the same task-contract done check.

## Goals

- Define one terminal-status vocabulary for Patchmill-managed issue task todos.
- Treat existing default-workflow todos with `status: "complete"` as done.
- Keep documented default terminal statuses `closed`, `completed`, and `done`.
- Make agent-facing prompt guidance name the accepted terminal statuses.
- Make the todo tool schema and UI grouping match the final handoff gate.
- Preserve project task-contract overrides, including custom done statuses.
- Test both the todo-status interpretation and final-gate/progress behavior.

## Non-goals

- Do not add a migration that rewrites existing todo files.
- Do not support arbitrary natural-language completion statuses.
- Do not change todo file location, title matching, tags, locking, assignment,
  or garbage-collection policy except where terminal-status recognition already
  participates in those flows.
- Do not require changes to committed implementation plans or specs.

## Decision

Use compatibility recognition rather than write-time normalization.

The default Patchmill terminal-status set becomes:

```text
closed, completed, complete, done
```

`closed` remains the preferred status for UI close actions and prompt examples.
`done`, `completed`, and `complete` are accepted aliases so existing and natural
agent outputs are handled safely. Status matching should trim surrounding
whitespace and compare case-insensitively.

For projects that configure `projectPolicy.pi.taskContract.doneStatuses`, the
configured list remains authoritative for Patchmill issue task todos. Patchmill
passes that resolved list to the bundled todo extension for each Pi invocation
so the extension can present and group todos using the same terminal vocabulary
as the final gate.

## Affected components

### Shared status vocabulary

Add a small shared helper for todo status handling, for example
`src/policy/todo-statuses.ts`, with:

- `DEFAULT_TODO_DONE_STATUSES = ["closed", "completed", "complete", "done"]`;
- a normalizer for trim/lowercase comparison;
- a `todoStatusIsDone(status, doneStatuses)` predicate;
- serialization/parsing helpers for passing the resolved status list to the Pi
  extension environment.

`DEFAULT_PI_TASK_CONTRACT.doneStatuses` should use the shared default list.
`issueTodoStatusDone` should delegate to the shared predicate so
`readIssueTodoTasks`, `issueTodoProgress`, and `assertIssueTodosComplete` all
interpret statuses identically.

If the Pi extension loader cannot safely import from `src/`, place the helper in
a package-included location that both the CLI and `extensions/todos.ts` can
import. The implementation must still keep a single source of truth.

### Bundled todo extension

Update `extensions/todos.ts` to derive its terminal-status set from the same
helper, defaulting to the Patchmill default set when no Patchmill environment is
provided.

The extension should use that set for:

- `isTodoClosed`;
- clearing assignment when a todo becomes terminal;
- sorting and search result ordering;
- `list`, `list-all`, `/todos`, and rendered tool-result grouping;
- UI close/reopen behavior, with close still writing `closed` and reopen still
  writing `open`;
- garbage collection of closed todos.

Constrain the `status` parameter schema to the active status vocabulary when the
extension registers the tool. The minimum non-terminal status is `open`; the
terminal values are the resolved done-status list. The tool description should
say to prefer `closed` when work is complete and list the accepted terminal
statuses. This prevents `complete` from being an undocumented accident while
still allowing project-specific done statuses when Patchmill supplies them.

Existing todo files that already contain `complete` should not be rewritten, but
under the default contract they must appear under closed todos and be ineligible
for claim as open work.

### Patchmill Pi invocation

When `runPiPrompt` launches Pi, pass the resolved task contract's done statuses
to the todo extension, alongside the existing todo-root environment. Use a stable
format such as a JSON string array to avoid ambiguity around status names.

Invalid or empty environment values should fall back to the shared default inside
the extension. Config validation should continue to require
`doneStatuses` to be an array of strings; implementation may additionally reject
blank normalized statuses if not already covered.

### Prompt guidance

Update the task-contract prompt rendering in
`src/cli/commands/run-once/prompts.ts` so plan and implementation prompts name
the accepted terminal statuses.

Plan-stage guidance should continue to say that plan-related task todos are
closed only after the plan document is committed, but should specify the status
vocabulary rather than saying only "complete" in prose.

Implementation-stage guidance should replace ambiguous wording such as "Mark a
task todo complete" with wording like:

```text
Set a task todo status to `closed` after code, tests, review, fixes, and
verification for that task are done. This contract treats `closed`,
`completed`, `complete`, and `done` as terminal.
```

For custom task contracts, render the configured done statuses instead of the
default list.

## Rejected alternatives

### Normalize `complete` to `closed` on write

This would make newly written default todos safe, but existing `complete` todo
files would still need read-time compatibility. It would also hide the user's
actual status value from tool responses, making debugging harder.

### Add only `complete` to the final gate

This would fix the final rejection but leave `/todos`, tool-result grouping,
assignment clearing, garbage collection, and progress semantics inconsistent.

### Hard-code a fixed enum in the todo extension

A fixed enum would help the default workflow but would break existing Patchmill
support for custom `doneStatuses` such as `shipped` or `verified`.

## Verification strategy

Apply Patchmill's Testing Value Gate: this is a production regression in status
parsing, prompt contracts, and final handoff behavior, so automated tests are
valuable.

Add or update tests for:

- shared status helper defaults, normalization, custom statuses, and invalid
  environment fallback;
- `DEFAULT_PI_TASK_CONTRACT.doneStatuses` including `complete`;
- `readIssueTodoTasks` marking `complete` as done;
- `issueTodoProgress` advancing past tasks marked `complete`;
- `assertIssueTodosComplete` accepting all default terminal statuses;
- the landing/final-handoff path accepting a `pr-created` or `merged` result
  when all issue task todos are `complete`;
- prompt rendering naming the default terminal statuses and custom contract
  terminal statuses;
- `runPiPrompt` passing the resolved done-status list to Pi;
- todo-extension closed grouping and claim blocking for `complete` through the
  shared status helper or a focused extension test.

Run the narrow affected tests first, then the full run-once and project test
suites:

```text
node --test src/policy/*.test.ts src/cli/commands/run-once/issue-todos.test.ts
node --test src/cli/commands/run-once/pi.test.ts src/cli/commands/run-once/prompts.test.ts
node --test src/cli/commands/run-once/pipeline-landing.test.ts src/cli/commands/run-once/pipeline-progress-scenarios.test.ts
npm test
```

No npm dependency changes are expected, so the Nix build is not required by the
repository dependency-change policy.
