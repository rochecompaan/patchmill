# Patchmill Task Contracts

Patchmill uses one task-contract policy for prompt rendering, plan parsing, and todo progress checks.

## Relationship to skills

The task contract controls how Patchmill and Pi coordinate issue task todos. The top-level `skills` config chooses the skill Pi should use while triaging, planning, implementing, reviewing, collecting evidence, and landing. Keep task naming/status behavior in the task contract and agent procedure inside skills.

## Where it is configured

Set task-contract fields in `patchmill.config.json` under `projectPolicy.pi.taskContract`.

```json
{
  "projectPolicy": {
    "pi": {
      "taskContract": {
        "todoRoot": ".pi/todos",
        "todoTitlePattern": "issue-<number>-task-<two-digit-number>-<slug>",
        "todoTags": ["agent-issue", "issue-<number>"],
        "planTodoBodyRequirements": [
          "purpose",
          "the source plan checklist item",
          "checkpoint details",
          "any last error or validation notes known at planning time"
        ],
        "implementationTodoBodyRequirements": [
          "purpose",
          "the source plan checklist item",
          "checkpoint details",
          "the latest last error or validation notes"
        ],
        "doneStatuses": ["closed", "completed", "done"],
        "planTaskHeadingPattern": "## Task <number>: <label>",
        "openTaskTodosBlockFinalHandoff": true
      }
    }
  }
}
```

## Field reference

- `todoRoot`: directory where Patchmill reads and writes task todo files.
- `todoTitlePattern`: title template for issue task todos. Patchmill renders issue numbers into this pattern and reads task numbers and slugs back from the named placeholders.
- `todoTags`: tags applied to issue task todos. Patchmill renders issue numbers into these tags for lookup and continuity.
- `planTodoBodyRequirements`: required body items for plan-created task todos.
- `implementationTodoBodyRequirements`: required body items for implementation-updated task todos.
- `doneStatuses`: todo status values treated as complete.
- `planTaskHeadingPattern`: heading template used when Patchmill parses tasks from a plan document.
- `openTaskTodosBlockFinalHandoff`: when `true`, Patchmill blocks final handoff while any matching issue task todo remains open.

## Supported placeholders and matching rules

### `todoTitlePattern`

- `<number>`: the issue number.
- `<issue-number>`: the issue number.
- `<two-digit-number>`: the zero-padded task number captured from the plan task sequence.
- `<slug>`: the task slug captured from the task title.
- Capture placeholders may appear in any order.

### `todoTags`

- `<number>`: the issue number.
- `<issue-number>`: the issue number.
- When `todoTitlePattern` omits the issue number placeholders, Patchmill uses the rendered tags to match task todos to the issue.

### `planTaskHeadingPattern`

- Leading `##`, `###`, and deeper headings set the minimum heading depth that matches.
- `<number>`: the task number parsed from the plan heading.
- `<label>`: the task label parsed from the plan heading.
- `<number>` and `<label>` may appear in any order within the heading template.

## How Patchmill uses it

- `patchmill triage` reads repository policy but does not create issue-task todos.
- `patchmill run-once` uses the task contract when it creates prompts, reads plan tasks, and checks issue-task completion before final handoff.

## Related settings

Other workflow settings live in the same `patchmill.config.json` file:

- `host.login`
- `pi.team`
- `paths.runStateDir`
- `paths.triageLogDir`
- `paths.worktreeDir`

Environment-variable overrides use the `PATCHMILL_*` namespace, including `PATCHMILL_HOST_LOGIN` and `PATCHMILL_AGENT_TEAM`.

## Local state

Patchmill records run state under `.patchmill/`:

- `.patchmill/runs/`
- `.patchmill/triage-runs/`
