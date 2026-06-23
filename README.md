<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/assets/logo-dark.svg">
    <source media="(prefers-color-scheme: light)" srcset="docs/assets/logo-light.svg">
    <img alt="Patchmill logo" src="docs/assets/logo-light.svg" width="400">
  </picture>
</p>

Patchmill is an agent-driven software factory for turning product work into
reviewed, landed changes without hiding the engineering judgment between idea
and production.

It gives automated development an explicit production line: intake incoming
work, sort what is ready, write or reuse a plan, implement in an isolated
worktree, review the result, collect evidence when needed, land the change, and
record what happened. The goal is not a black box that writes code for you; it
is a factory floor where every station is visible, configurable, and designed to
preserve software craftsmanship while making iterative engineering scalable.

## What Patchmill does

Patchmill connects an issue host, repository policy, git worktrees, and
configurable workflow instructions so a repository can move from open product
work to reviewed diffs with clear handoffs.

Current command status:

Functional:

- `patchmill init` initializes local configuration and recommended skills.
- `patchmill auth` configures or repairs repo-local Pi provider authentication
  under `.patchmill/pi-agent`.
- `patchmill doctor` runs read-only readiness checks.
- `patchmill version` prints the installed Patchmill CLI version.
- `patchmill triage` is the intake/sorting station. It classifies open issues
  and can apply readiness labels or comments.
- `patchmill run-once` is the one-issue production run. It advances one
  actionable issue through spec writing, plan writing, implementation, and any
  configured human approval stops.

In progress:

- `patchmill run` will start the factory loop. It will keep selecting the next
  ready issue and running the same controlled production process until there is
  no eligible work left, a configured issue/budget limit is reached, or a
  blocker requires human input.

The controls stay close to the work: labels decide what is ready, dry runs show
what Patchmill would do before it mutates the issue host, plans make scope
reviewable, run logs preserve progress, and repository skills let teams encode
their own process.

`patchmill triage` executes the configured triage skill by default and reports
what changed. Use `patchmill triage --dry-run` to preview the labels, comments,
closures, canonical bucket, and rationale the skill would produce without
mutating the issue host.

Supported issue hosts are Forgejo/Gitea through `tea` (`forgejo-tea`) and GitHub
through `gh` (`github-gh`). GitHub visual-evidence upload is not supported in
the first `github-gh` version; Forgejo visual-evidence upload uses the
`PATCHMILL_FORGEJO_*` environment variables.

## Quickstart

Install the Patchmill CLI globally, then start with the onboarding flow:

```sh
npm install -g patchmill

patchmill init
patchmill auth
patchmill doctor
patchmill triage --dry-run
```

If you prefer not to install Patchmill globally, use `npx`:

```sh
npx patchmill init
npx patchmill auth
npx patchmill doctor
npx patchmill triage --dry-run
```

### Migrating from `@rochecompaan/patchmill`

The scoped npm package `@rochecompaan/patchmill` is deprecated. Install the
unscoped package instead:

```sh
npm uninstall -g @rochecompaan/patchmill
npm install -g patchmill
```

For one-off usage, replace `npx @rochecompaan/patchmill ...` with
`npx patchmill ...`.

### Try Patchmill on a disposable demo repository

Before pointing Patchmill at a production repository, create a disposable Team
Lunch Poll demo repository and let Patchmill triage its seeded issues.

For GitHub:

```bash
patchmill setup-test-repo --provider github-gh --repo OWNER/REPO
gh repo clone OWNER/REPO
cd REPO
patchmill init
patchmill triage
patchmill run-once
```

For Forgejo or Gitea with a named `tea` login:

```bash
patchmill setup-test-repo --provider forgejo-tea --repo OWNER/REPO --login LOGIN
tea clone OWNER/REPO
cd REPO
patchmill init
patchmill triage
patchmill run-once
```

Use an explicit disposable public repository for `OWNER/REPO`. The reset form
deletes and recreates that repository:

```bash
patchmill setup-test-repo --provider github-gh --repo OWNER/REPO --reset
patchmill setup-test-repo --provider forgejo-tea --repo OWNER/REPO --login LOGIN --reset
```

The reusable demo prompts live in the Patchmill package under
`fixtures/patchmill-test-repo/`. See `docs/setup-test-repo.md` for details.

`patchmill run` is still in progress; treat experiments with the continuous
factory loop as development testing rather than supported usage.

`patchmill init` writes a minimal local `patchmill.config.json`, reminds you to
change the default host login, installs Patchmill's recommended skills into
`.patchmill/skills/`, and adds `.patchmill` plus `patchmill.config.json` to
`.git/info/exclude` by default. For consistent Patchmill runs across local
machines and CI, consider committing `patchmill.config.json` and
`.patchmill/skills/` explicitly.

Alternative initialization modes:

```sh
patchmill init --skills project
patchmill init --skills global
patchmill init --skills none
patchmill init --skills path:project-skills
```

`patchmill auth` reruns the repo-local Pi provider/model setup used by init. It
stores Patchmill-owned Pi authentication state under `.patchmill/pi-agent`, so
it is the canonical repair command when provider auth or model selection
changes.

`patchmill doctor` is read-only: it checks git, host access, labels, configured
skills, runtime access, and local paths, verifying bundled/path-like skills and
flagging name-only skills as configured but unverified before recommending dry
runs.

## Configuration

Patchmill loads `patchmill.config.json` from the repository root and fills
omitted fields with defaults. A functional starting point for the default
workflow looks like this:

```json
{
  "host": {
    "provider": "forgejo-tea",
    "login": "triage-agent"
  },
  "skills": {
    "triage": ".patchmill/skills/patchmill-issue-triage",
    "planning": ".patchmill/skills/writing-plans",
    "implementation": ".patchmill/skills/subagent-driven-development"
  },
  "paths": {
    "plansDir": "docs/plans",
    "runStateDir": ".patchmill/runs",
    "triageLogDir": ".patchmill/triage-runs",
    "worktreeDir": ".worktrees"
  }
}
```

The default skills keep the workflow small and explicit:

- `.patchmill/skills/patchmill-issue-triage` is the default triage skill; normal
  triage runs it (or your configured replacement) and reports observed changes,
  while `--dry-run` uses a read-only preview JSON pass. Its triage-note,
  disclosure, and agent-brief practices were inspired by
  [Matt Pocock's triage skill](https://github.com/mattpocock/skills/blob/main/skills/engineering/triage/SKILL.md).
- `.patchmill/skills/writing-plans` writes implementation plans before code
  changes.
- `.patchmill/skills/subagent-driven-development` executes approved plans with
  Superpowers-style worker/reviewer handoffs.
- `.patchmill/skills/subagent-dev-with-codex-and-thermo-reviews` is also
  installed as an opt-in implementation skill for repositories that want the
  same task-by-task subagent workflow plus final full-worktree Codex and
  thermo-nuclear review loops before landing.
- `.patchmill/skills/single-subagent-dev-with-codex-and-thermo-reviews` is a
  second opt-in implementation skill for repositories that want one worker
  subagent to implement the whole plan before those same final review loops.

Accepted `host.provider` values are `forgejo-tea` for Forgejo/Gitea through
`tea` and `github-gh` for GitHub through `gh`.

Customize `skills` when your repository needs different procedures. Optional
skill hooks include `toolchain`, `review`, `visualEvidence`, and `landing`; see
[skills configuration](docs/skills.md) for details and
[configuration examples](docs/configuration.md) for a fuller
`patchmill.config.json`.

## Environment variables

Environment variables are best for machine-local identity, CI secrets, and host
upload credentials that should not live in `patchmill.config.json`.

- `PATCHMILL_HOST_LOGIN`: host account/login override for providers that support
  named logins, such as `forgejo-tea`; ignored by providers without named-login
  support, such as `github-gh`.
- `PATCHMILL_FORGEJO_URL`: Forgejo base URL used when uploading visual evidence
  to PRs.
- `PATCHMILL_FORGEJO_TOKEN`: Forgejo API token for visual-evidence uploads.
- `PATCHMILL_FORGEJO_REPO`: optional `owner/repo` override when Patchmill cannot
  infer the Forgejo repository from git remotes.

CLI flags override environment variables, and environment variables override
`patchmill.config.json`.

## Runtime and subagent customization

Patchmill uses Pi as the runtime harness for configurable agent work. Most users
start by configuring issue hosts, labels, paths, and skills; Pi becomes relevant
when you want to customize the runtime, delegated agent roles, models, tools, or
context behavior.

Patchmill includes `pi-subagents`; users do not install it separately. Patchmill
also bundles the file-backed Pi `todo` extension used by the issue-agent task
contract, so planning and implementation prompts can create local task todos
under the configured `projectPolicy.pi.taskContract.todoRoot` (default:
`.pi/todos`) without requiring a separate Pi package install. Implementation
prompts can rely on the Pi `subagent` tool and the agents discovered by
pi-subagents. For initialized repositories, the default implementation skill is
`.patchmill/skills/subagent-driven-development`. The recommended skill pack also
installs `.patchmill/skills/subagent-dev-with-codex-and-thermo-reviews` as a
task-by-task opt-in alternative, plus
`.patchmill/skills/single-subagent-dev-with-codex-and-thermo-reviews` as a
single-worker opt-in alternative. Both alternatives add final Codex and
thermo-nuclear full-worktree review loops. These workflows can use pi-subagents
builtin agents such as `worker`, `reviewer`, `scout`, `planner`,
`context-builder`, `researcher`, `delegate`, and `oracle`.

Agent files define reusable delegated roles and can live in:

- `~/.pi/agent/agents/**/*.md` for user-scope agents
- `.pi/agents/**/*.md` for project-scope agents

Settings overrides can live in `~/.pi/agent/settings.json` or
`.pi/settings.json`. For example:

```json
{
  "subagents": {
    "agentOverrides": {
      "reviewer": {
        "model": "anthropic/claude-sonnet-4",
        "thinking": "high"
      }
    }
  }
}
```

A minimal project agent file looks like:

```md
---
name: worker
description: Project-specific implementation worker
model: anthropic/claude-sonnet-4
thinking: high
tools: read, grep, find, ls, bash, edit, write
systemPromptMode: append
inheritProjectContext: true
inheritSkills: true
---

Follow this repository's implementation conventions. Escalate unclear product or
architecture decisions instead of guessing.
```

Customize agents with normal pi-subagents user or project configuration when
your repository needs different models, tools, context behavior, or nested
delegation. If you want a child agent to delegate further, include the
`subagent` tool in that agent's tools and configure nesting/depth through
pi-subagents settings. Patchmill does not override those user choices.

## State paths

Patchmill writes local run state under `.patchmill/`:

- `.patchmill/runs/`
- `.patchmill/triage-runs/`

These paths are local workflow state, not source documentation.

## Releases

Patchmill uses release-please on pushes to `main`. Conventional Commits drive
release PRs that update `package.json`, lockfiles, `CHANGELOG.md`, and the Nix
package version marker. Release-please creates plain `vX.Y.Z` Git tags and
release names. When a release PR is merged, the workflow creates the GitHub
release and publishes the npm package with provenance using `NPM_TOKEN`.

## Issue-agent workflows

For a deeper newcomer-friendly walkthrough,
[issue-agent workflows](docs/issue-agent-workflows.md) explains how the intake
station selects and labels issues, how `run-once` claims work, how planning and
implementation prompts are shaped, and where Patchmill records progress and
safety checkpoints.

## Reference docs

- [Configuration examples](docs/configuration.md)
- [Issue-agent workflows](docs/issue-agent-workflows.md)
- [Providers](docs/providers.md)
- [Skills configuration](docs/skills.md)
- [Task contracts](docs/task-contracts.md)
