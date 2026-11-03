# Native issue dependencies instead of the blocked label

## Decisions

Refs #334.

Triage marks dependent issues `blocked`, and nothing removes that label after
the blockers close. The maintainer chose to drop the label and use the trackers'
native dependencies instead: GitHub **Blocked by** and Forgejo/Gitea **Depends
on**. There is no automatic migration. Users link existing blocked issues by
hand.

- The tracker's dependency graph is the only dependency record. The ready label
  means the work suits automation. It does not mean the dependencies are
  complete.
- Triage returns blocker numbers in a structured field. The kernel creates the
  missing native links before it applies the ready label.
- A run starts only when every native dependency of the issue is closed. This
  applies to automatic selection, `--issue N`, interactive runs, dry runs, and
  resumed in-progress issues.
- When the kernel cannot read an issue's dependencies, it warns and does not
  start work on that issue.
- Closing the last blocker makes the issue eligible on the next selection. No
  triage run, label change, or comment is involved. Reopening a blocker makes
  the issue ineligible again.

Out of scope: automatic migration, parsing `Blocked by:` comments, removing
links, creating cross-repository links, cancelling an active run when its
dependencies change, and any change to planning gates.

## Host boundary

Each adapter adds two operations:

- `listIssueDependencies(n)` returns every dependency of issue `n` as
  `{ repository, number, state }`, where `repository` is `owner/repo` and
  `state` is `open` or `closed`. The read covers every page. A failed,
  incomplete, or malformed read rejects. It never returns an empty list in place
  of an error.
- `addIssueDependency(n, blocker)` links a same-repository blocker. It rejects
  on any error, including a cycle the tracker refuses.

| Host    | Read                                                           | Add                                                                 |
| ------- | -------------------------------------------------------------- | ------------------------------------------------------------------- |
| GitHub  | `GET /repos/{owner}/{repo}/issues/{n}/dependencies/blocked_by` | `POST` same path with `issue_id` = the blocker's REST database `id` |
| Forgejo | `GET /repos/{owner}/{repo}/issues/{n}/dependencies`            | `POST` same path with `{ owner, repo, index }`                      |

GitHub's `issue_id` is the database id from `GET .../issues/{blocker}`, not the
issue number or node id. Dependency entries carry their own repository
(`repository_url` on GitHub, `repository.full_name` on Forgejo), so
cross-repository links keep their identity. Repository names compare
case-insensitively.

## Selection

Selection keeps its label rules and oldest-first order, then reads the
dependencies of each candidate in turn:

| Dependencies        | Automatic selection          | `--issue N`                      |
| ------------------- | ---------------------------- | -------------------------------- |
| None, or all closed | Eligible                     | Eligible                         |
| Any open            | Skip; try the next candidate | Refuse, naming the open blockers |
| Read failed         | Warn and skip                | Refuse with the error            |

A refusal claims nothing, creates no worktree, and starts no Pi session.
Automatic selection reports no work only after it has exhausted the candidates.
The CLI's `--interactive` path uses the same selection before it opens a
console, and runs started inside the console pass through the same kernel gate.
There is no second dependency read after selection and no monitoring during an
active run.

## Triage

Triage has three outcomes: ready, needs-info, and unsuitable. Work that is
otherwise clear stays ready even when it depends on other issues. Unidentified
dependencies still mean needs-info.

The result has exactly three fields:

```json
{
  "label": "<configured outcome>",
  "comment": "<text or empty>",
  "blockedBy": [1, 2]
}
```

`blockedBy` lists same-repository issue numbers: distinct positive safe integers
other than the issue itself. It may be non-empty only with the ready outcome.
The kernel rejects anything else before any host write.

Before each session the kernel reads the issue's current dependencies and
renders them in the envelope's issue data, so the skill sees existing links. The
skill stays read-only. After a valid result, the kernel adds each proposed link
that is not already present, then applies the label and comment. Existing links,
including links the result omits, stay as they are.

If a dependency write fails, the kernel warns and skips the issue without
applying the label or comment, as it does for any other triage error. Links
already added stay. The next triage run reads the current links and adds only
what is still missing, so a retry is safe. Automatic candidates carry no ready
label, so a failed write cannot leave them runnable. Explicit re-triage of an
issue that is already ready is the one case where a failed write leaves a
runnable issue with missing links. The warning names them.

Triage dry run reads dependencies and calls Pi, then prints the proposed label,
comment, and links to add. It writes nothing to the host and creates no labels.

## Configuration and upgrade

Remove `labels.blocked` from the config type, defaults, label catalog, generated
config, and examples. The config reader accepts an old string value for
`labels.blocked` and ignores it, like the retired review-label keys. Other types
remain a config error.

Old `blocked` labels no longer prevent selection. Before running the upgraded
Patchmill, users update each blocked issue by hand:

1. Add each dependency with GitHub **Blocked by** or Forgejo/Gitea **Depends
   on**.
2. Remove the old `blocked` label.
3. Add the ready label if the work suits automation.
4. Remove `labels.blocked` from `patchmill.config.json`.

Update the README, `docs/agents/triage-labels.md`, the bundled triage skill and
envelope, and the site's triage, run-once, workflow-label, and configuration
pages. Do not rewrite historical specifications.

## Verification

Automated tests cover:

- Both adapters: paginated reads, rejection of failed or malformed reads,
  cross-repository identity, GitHub's database-id lookup, and Forgejo's request
  body.
- Selection with no, closed, open, foreign-open, and unreadable dependencies,
  including skipping an older blocked issue for a younger eligible one.
- Refusal of explicit, dry-run, and interactive runs without a claim.
- Closing and reopening a blocker changing eligibility with no triage or label
  writes.
- Triage result validation, adding only missing links before the label, skipping
  on a failed write, and dry run with no host writes.
- The retired config key.

Review documentation and skill text directly instead of testing prose. Provider
tests use recorded command responses, never a live tracker.
