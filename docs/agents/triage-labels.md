# Triage labels

Patchmill owns normal issue triage through
`.patchmill/skills/patchmill-issue-triage/SKILL.md`. Use Patchmill rather than
Matt Pocock's `/triage` skill for the standard triage workflow.

If Matt's triage skill is explicitly invoked, map its roles to Patchmill's
GitHub labels as follows:

| Matt triage role  | Patchmill label    | Meaning                                     |
| ----------------- | ------------------ | ------------------------------------------- |
| `needs-triage`    | no label           | Leave for Patchmill's triage intake         |
| `needs-info`      | `needs-info`       | Waiting for information or a human decision |
| `ready-for-agent` | `agent-ready`      | Ready for automated agent processing        |
| `ready-for-human` | `agent-unsuitable` | Not suitable for automated implementation   |
| `wontfix`         | `wontfix`          | Will not be worked on                       |

Patchmill also uses `blocked` for work blocked by concrete dependencies. Matt's
five-role vocabulary has no equivalent role.

The Patchmill prompt and `patchmill.config.json` are authoritative for triage
states, transitions, comments, and repository mutations.
