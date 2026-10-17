---
title: Triage
description: Classify issues with the triage skill.
---

`patchmill triage` runs Pi for each candidate issue. The triage skill reads the
issue and returns one label and a comment. Only the kernel applies the result.

```sh
patchmill triage --dry-run
patchmill triage
patchmill triage --issue 123 --dry-run
```

Dry run still calls the model and writes local logs and sessions. It prints the
proposed label and comment instead of changing the issue host. The supported
flags are `--issue N` and `--dry-run`.

## Candidates

Without `--issue`, Patchmill selects open issues with no configured workflow
label. An issue with `needs-info` is also eligible when its latest comment comes
from a trusted author. Trust comes from `host.login` and `host.trustedAuthors`.
Explicit `--issue N` requests classification of that issue without the normal
candidate filter.

The kernel does not automatically recheck blocked issues when dependencies
close. Use explicit triage after the dependency changes.

## Outcomes

| Key          | Default            | Meaning                                              |
| ------------ | ------------------ | ---------------------------------------------------- |
| `ready`      | `agent-ready`      | Clear work that automation can perform.              |
| `unsuitable` | `agent-unsuitable` | Unsafe work or unavailable manual access.            |
| `blocked`    | `blocked`          | Clear work with identified same-repository blockers. |
| `needsInfo`  | `needs-info`       | Missing facts, unclear scope, or a human decision.   |

The skill returns exactly `label` and `comment` in a fenced JSON block.
`wontfix` is valid only if configured as one of those four values. The kernel
posts non-empty comments and preserves unrelated labels. Invalid results and
failed sessions produce warnings and skip that issue.

## Local output

Triage writes prompts, `session-1.log`, and sessions under
`<runsDir>/triage/<run-id>/`. These files are outputs, not workflow state.
Triage passes no explicit extension paths to Pi. This is not a guarantee that Pi
loads no other extensions from its environment or configuration.

After triage marks an issue ready, use [Run-once](/using-patchmill/run-once/) to
advance it.
