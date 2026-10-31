# Triage labels

Patchmill owns normal issue triage through
`.patchmill/skills/patchmill-issue-triage/SKILL.md`. Use Patchmill rather than
Matt Pocock's `/triage` skill for the standard workflow.

The kernel accepts one of four configured outcomes:

| Configuration key   | Default label      | Meaning                                                       |
| ------------------- | ------------------ | ------------------------------------------------------------- |
| `labels.ready`      | `agent-ready`      | Clear work that automation can perform.                       |
| `labels.needsInfo`  | `needs-info`       | Missing facts or a human decision.                            |
| `labels.unsuitable` | `agent-unsuitable` | Unsafe work or unavailable manual access.                     |
| `labels.blocked`    | `blocked`          | Clear work that depends on identified same-repository issues. |

If Matt's triage skill is explicitly invoked, map `ready-for-agent` to
`agent-ready` and `ready-for-human` to `agent-unsuitable`. Map `needs-info` to
`needs-info`. `needs-triage` means no label. Its vocabulary has no `blocked`
role. `wontfix` is not a fifth kernel outcome. It is accepted only if configured
as one of the four values, such as `labels.unsuitable`.

The triage skill returns JSON with `label` and `comment`. Only the kernel
applies the label and posts a non-empty comment. Dry run still calls Pi but does
not change the host. It writes local logs and sessions.

Without `--issue`, candidates are open issues with no configured workflow label.
An issue with `needs-info` is also eligible when its latest comment comes from a
trusted author. `host.login` and `host.trustedAuthors` define those authors.
Patchmill processes eligible issues in ascending issue-number order. Use
`--issue N` to request a fresh classification of a specific issue. There is no
automatic blocker-resolution pass.

Before applying the first valid result, Patchmill creates any missing configured
workflow labels. Dry runs and invalid results do not create labels.
