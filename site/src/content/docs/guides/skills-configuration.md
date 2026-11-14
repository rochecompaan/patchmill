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

Matt Pocock supplies `domain-modeling` and `codebase-design` through the pinned
`mattpocock-skills` production dependency. Both come from version `1.3.2` at
commit `5863806dd4e15c63174bee4e7515a4256792ecfa`. The installer copies their
complete selected directories, including domain formats, `DEEPENING.md`,
`DESIGN-IT-TWICE.md`, and a root MIT license copy for each skill. The manifest
records `sources.mattPocock` and hashes every resource. The two upstream skills
remain unmodified. No planning session downloads them.

## Planning and implementation

The planning skill reads sibling `brainstorming`, `writing-plans`, and
`simple-english` instructions. It writes the spec and plan at the envelope's
exact paths. Required Spec and Plan gates use separate planning branches and
ready planning pull requests in unattended runs. The agent stops at each gate
until its planning PR merges. Ungated documents accompany implementation.
Interactive Issue runs use the envelope's submit dialog for approval and the
available PR choice. Approval without a PR keeps documents on the pushed
implementation branch. Reviewer readiness does not satisfy a human gate.

Architectural specification work follows `domain-modeling` while the planner
clarifies terminology, inspects code, identifies context relationships, and
reads relevant ADRs. Module or interface design also follows `codebase-design`
and `DEEPENING.md`. The specification explains module ownership, caller
obligations, hidden implementation, seams, adapters, dependency entry, locality,
leverage, and observable tests. Non-architectural work records a short reason
and does not invent domain artifacts.

Terminology uses `GLOSSARY.md`, with `GLOSSARY-MAP.md` for multiple contexts.
Legacy `CONTEXT` documents remain inputs until an authorized rename preserves
their knowledge. Relevant domain companions can accompany a specification.
Narrower envelopes instead record the resolution and deferred destination. ADRs
require a real architectural trade-off, not ceremony.

Every new or revised plan gets fresh, read-only review by the canonical
`reviewer`, after planner self-review. The reviewer independently inspects
relevant domain documents, ADRs, source, callers, dependencies, and tests. The
local `patchmill-planning/plan-review.md` brief checks depth, interface size,
seam placement, adapter justification, locality, leverage, and test surfaces. It
explicitly applies the deletion test, the interface as the test surface, and the
principle that two real adapters establish variation. Blocking findings require
concrete codebase evidence and impact. The plan records findings, dispositions,
inspection limits, and reviewed content identity. Accepted blockers need
correction and one fresh scoped confirmation. Material later edits require
renewed review.

Missing required skills, resources, or reviewer capability prevent success.
Unattended planning returns `needs-input`. Interactive planning asks the
maintainer and waits, without installing substitutes or using self-review. The
local interactive helper follows these analysis and review requirements without
gaining publication authority.

The implementation skill prepares the environment, executes the approved plan,
validates the work, commits, pushes, and marks the pull request ready. It
follows sibling `executing-plans` for inline work. An interactive operator can
ask for per-task review through the sibling `subagent-driven-development`
workflow.

Every implementation gets one independent whole-branch review from a
fresh-context `reviewer` subagent, not `code-reviewer`. The reviewer task
combines the upstream `code-reviewer.md` template with the skill's
`review-appendix.md`, which adds finding filters, error-boundary, security, and
structure and readability checks, and a human reviewer callouts section. The
agent makes one ordered fix pass and defers Minor findings. If no reviewer is
available, the run stops with `needs-input` rather than reviewing its own work.

The pull request stays in draft until its checks pass on the current head. The
agent ignores failures for older heads, makes at most two repair passes for
failures caused by the code, and reports base-branch and operator failures
instead of changing code for them. The pull request body records rulings,
deferred Minor findings, validation results, and the reviewer's callouts.

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
runtime. A fresh `reviewer` subagent performs it. Every valid finding is fixed
and reviewed again before the pull request is marked ready. The pull request
body records the decision, findings, and repairs.

## Results and evidence

Planning and implementation end with a fenced JSON block containing only
`status` and `summary`. Status is `done`, `needs-input`, or `failed`. Triage
instead returns only `label` and `comment`. Questions go in the summary or
triage comment. Interactive Issue run planning instead uses its submit tool and
dialog as directed by the envelope. The kernel alone changes issue labels and
posts issue comments.

Visual evidence and module size are skill advice. The kernel does not inspect
screenshots or enforce task lists. Use behavioral tests for meaningful changes
and direct inspection for static prose and configuration.

## Update and review

After upgrading Patchmill, run `patchmill skills update` to bring the managed
pack up to the installed version. The command compares each managed file with
the hash in `.patchmill/skills/patchmill-skill-pack.json`. It refuses to run if
any managed file was edited or deleted, and lists those files. Otherwise it
copies the shipped skills, removes files the new pack no longer ships, and
rewrites the manifest. Review the resulting diff and commit shared skills. Do
not hand-edit managed copies to disguise hash mismatches. Keep custom entry
points separate from managed files. See
[Interactive skills](/using-patchmill/interactive-skills/) for human-controlled
planning, labels, and cleanup.
