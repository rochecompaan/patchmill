---
title: Skills configuration
description: Configure the three skill entry points and their supporting pack.
---

A skill is a reusable set of agent instructions. `patchmill init` installs
Patchmill skills and pinned upstream skill files into `.patchmill/skills`. The
installer copies resource files and records their sources, versions, and hashes
in `patchmill-skill-pack.json`. Repeated init leaves identical files unchanged.
It leaves valid configuration unchanged and does not migrate earlier versions.

## Entry points

Only three skill keys exist in `patchmill.config.json`:

```json
{
  "skills": {
    "triage": ".patchmill/skills/patchmill-issue-triage",
    "planning": ".patchmill/skills/patchmill-planning",
    "implementation": ".patchmill/skills/patchmill-implementation"
  }
}
```

Each path names a directory with `SKILL.md`. Custom entry points must preserve
the result protocol and the kernel's ownership boundaries. Put environment
setup, review, and evidence instructions in skills or `AGENTS.md`. They are not
extra configuration hooks.

## Installed pack

The ten Patchmill skills are `patchmill-issue-triage`, `patchmill-planning`,
`patchmill-implementation`, `patchmill-visual-evidence`,
`patchmill-frontend-review`, `frontend-design`, `module-size`, `patchmill-plan`,
`patchmill-label`, and `patchmill-cleanup`. Patchmill vendors `frontend-design`
from Anthropic and the frontend review rules from Vercel at pinned commits. See
`THIRD_PARTY_NOTICES.md` for their sources and licenses.

The thirteen selected Superpowers skills are `brainstorming`, `writing-plans`,
`executing-plans`, `subagent-driven-development`, `test-driven-development`,
`systematic-debugging`, `verification-before-completion`,
`requesting-code-review`, `receiving-code-review`,
`dispatching-parallel-agents`, `using-superpowers`, `using-git-worktrees`, and
`finishing-a-development-branch`. SimpleEnglish supplies `simple-english`. Keep
supporting resource files and required sibling skills with these entries.

## Planning and implementation

The planning skill reads sibling `brainstorming`, `writing-plans`, and
`simple-english` instructions. It writes the spec and plan at the envelope's
exact paths. Planning and implementation share the same branch and worktree. The
agent commits and pushes artifacts and opens or updates the draft pull request.
Required spec approval stops planning before the plan.

The implementation skill prepares the environment, executes the approved plan,
validates the work, commits, pushes, and marks the pull request ready. It
follows sibling `executing-plans` for inline work. Kernel-launched sessions do
not require subagent tools. An interactive operator can authorize available
subagent tools and the sibling `subagent-driven-development` workflow. The
canonical independent review role is `reviewer`, not `code-reviewer`.

`init` provisions `agents/reviewer.md` in the Pi agent directory. Run-once loads
`pi-subagents` through runtime `-e` arguments, not copied extension files. The
kernel does not observe child agents. Triage passes no explicit extension paths.
Pi can still load resources from its own environment and configuration.

## Frontend design and review

The planning and implementation skills each decide whether frontend work applies
and record a brief reason. Layout, responsive behavior, styling, interaction,
motion, accessibility, navigation, and user-flow changes apply. Backend and
documentation work skip these steps. Copy-only work applies only when it
materially changes one of these areas. No configuration key is needed.

When design applies, planning reads the `frontend-design` sibling while it
writes the spec. It adds a self-contained HTML mockup under `docs/mockups/` that
opens from disk without network access. The mockup shows the full page at mobile
and desktop widths. The spec links it from a `## Companion artifacts` section,
and the mockup is committed with the spec. Older approved specs need no mockup.
The kernel does not check mockups.

After validation, implementation follows `patchmill-frontend-review` for
applicable work. The review uses pinned local rules and never fetches rules at
runtime. Kernel-launched sessions run it as a separate self-review pass. An
interactive operator can authorize a fresh `reviewer` subagent instead. Every
valid finding is fixed and reviewed again before the pull request is marked
ready. The pull request body records the decision, findings, and repairs.

## Results and evidence

Planning and implementation end with a fenced JSON block containing only
`status` and `summary`. Status is `done`, `needs-input`, or `failed`. Triage
instead returns only `label` and `comment`. Questions go in the summary or
triage comment. The kernel alone changes issue labels and posts issue comments.

Visual evidence and module size are skill advice. The kernel does not inspect
screenshots or enforce task lists. Use behavioral tests for meaningful changes
and direct inspection for static prose and configuration.

## Reinstall and review

To reinstall the shipped pack for the installed version, run `patchmill init`.
Review the resulting diff and commit shared skills. Do not hand-edit managed
copies to disguise hash mismatches. Keep custom entry points separate from
managed files. See [Interactive skills](/using-patchmill/interactive-skills/)
for human-controlled planning, labels, and cleanup.
