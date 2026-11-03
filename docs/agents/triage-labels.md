# Triage labels

Patchmill owns normal issue triage through
`.patchmill/skills/patchmill-issue-triage/SKILL.md`. Use Patchmill rather than
Matt Pocock's `/triage` skill for the standard workflow.

The kernel accepts one of three configured outcomes:

| Configuration key   | Default label      | Meaning                                                                          |
| ------------------- | ------------------ | -------------------------------------------------------------------------------- |
| `labels.ready`      | `agent-ready`      | Clear work suitable for automation, including work with identified dependencies. |
| `labels.needsInfo`  | `needs-info`       | Missing facts or a human decision.                                               |
| `labels.unsuitable` | `agent-unsuitable` | Unsafe work or unavailable manual access.                                        |

If Matt's triage skill is explicitly invoked, map `ready-for-agent` to
`agent-ready` and `ready-for-human` to `agent-unsuitable`. Map `needs-info` to
`needs-info`. `needs-triage` means no label. `wontfix` is not a fourth kernel
outcome. It is accepted only if configured as one of the three values, such as
`labels.unsuitable`.

The triage skill returns JSON with `label`, `comment`, and `blockedBy`.
`blockedBy` contains distinct positive same-repository issue numbers other than
the target issue. Only ready results can name blockers. The kernel adds missing
native links before it applies the label and posts a non-empty comment. Existing
links remain intact. Dry run still calls Pi but only previews changes, including
links to add. It writes local logs and sessions, not host data.

Without `--issue`, candidates are open issues with no configured workflow label.
An issue with only `needs-info` among those labels is also eligible when its
latest comment comes from a trusted author. `host.login` and
`host.trustedAuthors` define those authors. Patchmill processes eligible issues
in ascending issue-number order. Use `--issue N` to request a fresh
classification of a specific issue.

Ready means suitable, not immediately runnable. Run selection reads GitHub's
**Blocked by** or Forgejo/Gitea's **Depends on** links. It skips issues with
open or unreadable dependencies, and explicit runs refuse them. Closing the last
blocker makes an issue eligible on the next selection without triage, a label
change, or a resolution comment. Reopening a blocker makes it ineligible again.

If a dependency write fails, the kernel warns and skips the label and comment.
Links already added remain intact. Explicit re-triage can leave an already-ready
or in-progress issue runnable with missing links after a partial write. Resolve
the warning before starting another run on that issue.

Before applying the first valid result, Patchmill creates any missing configured
workflow labels. Dry runs and invalid results do not create labels.

## Manual upgrade from the blocked label

There is no automatic migration. Old blocked labels no longer prevent work.
Before running the upgraded Patchmill, update each affected issue manually:

1. Add its dependencies through GitHub **Blocked by** or Forgejo/Gitea **Depends
   on**.
2. Remove the old `blocked` label or its configured replacement.
3. If the work suits automation, add the configured ready label.
4. Remove `labels.blocked` from `patchmill.config.json`.

The config reader accepts an old string-valued `labels.blocked` but ignores it.
It rejects other types. Patchmill does not infer dependencies from old comments
or automatically remove old labels.
