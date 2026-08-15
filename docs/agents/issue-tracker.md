# Issue tracker: GitHub

Work items for this repo live in GitHub Issues at `rochecompaan/patchmill`. Use
the `gh` CLI for all operations.

Specifications and plans remain in `docs/specs/` and `docs/plans/` and may be
linked or uploaded to their GitHub issues through the project workflow.

## Conventions

- **Create an issue:** `gh issue create --title "..." --body "..."`. Use a
  heredoc for multiline bodies.
- **Read an issue:** `gh issue view <number> --comments`, including its labels.
- **List issues:** Use `gh issue list` with the appropriate `--label`,
  `--state`, and `--json` options.
- **Comment:** `gh issue comment <number> --body "..."`
- **Apply or remove labels:** `gh issue edit <number> --add-label "..."` or
  `--remove-label "..."`
- **Close:** `gh issue close <number> --comment "..."`

Infer the repository from `git remote -v`; `gh` does this automatically inside
this clone.

## Pull requests as a triage surface

**PRs as a request surface: no.**

GitHub shares one number space across issues and pull requests. When a bare
reference such as `#42` is ambiguous, try `gh pr view 42` and then
`gh issue view 42`.

## Skill terminology

When a skill says **publish to the issue tracker**, create a GitHub issue.

When a skill says **fetch the relevant ticket**, run:

```sh
gh issue view <number> --comments
```

## Wayfinding operations

Wayfinder maps and tickets are GitHub issues.

- **Map:** Create one issue labelled `wayfinder:map`.
- **Child ticket:** Create an issue with one `wayfinder:<type>` label and attach
  it to the map through GitHub's sub-issues API. If sub-issues are unavailable,
  add the child to a task list in the map body and begin its body with
  `Part of #<map>`.
- **Blocking:** Use GitHub's native issue dependencies. Add an edge with
  `gh api --method POST repos/rochecompaan/patchmill/issues/<child>/dependencies/blocked_by -F issue_id=<blocker-db-id>`,
  where `<blocker-db-id>` is the blocker's REST database ID, not its issue
  number or node ID. If dependencies are unavailable, begin the child body with
  `Blocked by: #<number>`.
- **Frontier query:** List the map's open child issues, then exclude assigned
  issues and issues with open blockers. Preserve the map's child order.
- **Claim:** Assign the ticket before working on it with
  `gh issue edit <number> --add-assignee @me`.
- **Resolve:** Add a resolution comment, close the ticket, then append its
  linked title and a one-line gist to the map's **Decisions so far** section.
