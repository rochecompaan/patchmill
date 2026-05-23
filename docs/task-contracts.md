# Pi task contracts

Patchmill's Pi integration shares one task-contract policy between prompt rendering, plan parsing, and todo progress checks.

## Default contract

Default location in `patchmill.config.json`:

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

Default behavior:

- Issue task todos live under `.pi/todos`.
- Task todo titles use `issue-<issue-number>-task-<two-digit-number>-<slug>`.
- Task todo prompts tag each issue todo with `agent-issue` and `issue-<issue-number>`.
- Plan prompts require todo bodies to include purpose, the source plan checklist item, checkpoint details, and any last error or validation notes known at planning time.
- Implementation prompts require todo bodies to include purpose, the source plan checklist item, checkpoint details, and the latest last error or validation notes.
- Todo status values `closed`, `completed`, and `done` count as complete.
- Plan readers preserve the legacy default heading matcher: `## Task N: Label` plus deeper headings with flexible internal whitespace still count as executable task headings.
- Open issue task todos block final `pr-created` and `merged` handoff checks.

## Supported placeholders

`todoTitlePattern` supports:

- `<number>` or `<issue-number>` — issue number
- `<two-digit-number>` — two-digit task number capture
- `<slug>` — task slug capture

Capture placeholders may appear in any order; Patchmill reads task numbers and slugs by placeholder name rather than capture position.

`todoTags` supports:

- `<number>` or `<issue-number>` — issue number

When `todoTitlePattern` omits `<number>` and `<issue-number>`, Patchmill falls back to tag-based issue lookup: todo readers only include todos whose header `tags` contain every rendered `todoTags` value for the requested issue.

`planTaskHeadingPattern` supports:

- leading `##`, `###`, and so on — minimum heading depth; deeper headings also match
- `<number>` — task number capture
- `<label>` — task label capture

`<number>` and `<label>` may also appear in either order within the heading template.

## Override guidance

Projects may override `projectPolicy.pi.taskContract` when their Pi workflow uses different local todo storage, tags, todo body requirements, or plan heading conventions.

Typical override cases:

- todos live outside `.pi/todos`
- task todo names use a different prefix
- task todos use different tags for lookup and continuity
- plan and implementation todos require different body fields
- completed todos use project-specific status words
- plans use headings such as `### Step 3 - Ship API`
- final handoff should not fail when issue task todos remain open

When overridden, the same contract is used for:

- todo instructions in Pi prompts
- reading issue task todos for progress and completion gates
- reading plan task headings for implementation-task labels
