---
title: Triage
description:
  Classify issues and record native dependencies with the triage skill.
---

`patchmill triage` runs Pi for each candidate issue. The triage skill returns a
label, a comment, and blocker numbers. Only the kernel applies the result.

```sh
patchmill triage --dry-run
patchmill triage
patchmill triage --issue 123 --dry-run
```

Dry run still calls the model and writes local logs and sessions. It prints the
proposed label, comment, and native links to add without changing the issue
host. The supported flags are `--issue N` and `--dry-run`.

## Candidates

Without `--issue`, Patchmill selects open issues with no configured workflow
label. An issue with only `needs-info` among those labels is also eligible when
its latest comment is a genuine reply from a trusted author. Kernel comments do
not count as replies. Trust comes from the authenticated username and
`host.trustedAuthors`. GitHub also trusts its configured `host.login`, but a Tea
profile alias does not grant trust. Patchmill rechecks eligibility before each
automatic session. Explicit `--issue N` requests classification of that issue
without the normal candidate filter.

## Outcomes and dependencies

| Key          | Default            | Meaning                                                                |
| ------------ | ------------------ | ---------------------------------------------------------------------- |
| `ready`      | `agent-ready`      | Clear work suitable for automation, including identified dependencies. |
| `unsuitable` | `agent-unsuitable` | Unsafe work or unavailable manual access.                              |
| `needsInfo`  | `needs-info`       | Missing facts, unclear scope, or a human decision.                     |

The skill returns exactly `label`, `comment`, and `blockedBy` in a fenced JSON
block. `blockedBy` contains distinct positive same-repository issue numbers,
excluding the issue itself. It can be non-empty only with ready. `wontfix` is
valid only if configured as one of those three label values. Unidentified
dependencies require needs-info.

The kernel reads current dependencies before each session. It adds missing
native links before it applies the label and comment. GitHub uses **Blocked
by**, and Forgejo/Gitea uses **Depends on**. Existing links remain intact,
including links the result omits. The kernel preserves unrelated labels.

Ready means suitable for automation, not that dependencies are complete. Run
selection skips issues with open or unreadable dependencies. Explicit runs
refuse them. Closing the last blocker makes an issue eligible on the next
selection, without another triage session, label change, or comment. Reopening a
blocker makes it ineligible again.

Invalid results, failed sessions, and dependency errors produce warnings and
skip the issue. After a partial dependency write, added links remain intact, but
the kernel applies no label or comment. A later triage invocation adds only
missing links. Explicit re-triage of ready or in-progress issues can leave them
runnable with missing links after an error. Resolve the warning before starting
another run on that issue.

## Manual upgrade

After upgrading, run `patchmill init` to refresh the managed triage skill.
Custom triage skills must also return the required `blockedBy` array.

There is no automatic migration from the old blocked label. Before using the
upgraded Patchmill, update each affected issue manually:

1. Add the dependencies through GitHub **Blocked by** or Forgejo/Gitea **Depends
   on**.
2. Remove the old `blocked` label or its configured replacement.
3. If the work suits automation, apply the configured ready label.
4. Remove `labels.blocked` from `patchmill.config.json`.

Old blocked labels no longer prevent work. String-valued `labels.blocked`
configuration remains accepted but ignored. Historical comments do not create
native links automatically.

## Local output

Triage writes prompts, `session-1.log`, and sessions under
`<runsDir>/triage/<run-id>/`. These files are outputs, not workflow state.
Triage passes no explicit extension paths to Pi. This is not a guarantee that Pi
loads no other extensions from its environment or configuration.

After triage marks an issue ready, use [Run-once](/using-patchmill/run-once/) to
advance it after its dependencies close.
