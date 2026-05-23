# Patchmill Generalization Design

## Summary

Patchmill is a Pi-driven software factory that turns repository issues into reviewed diffs, pull requests, or safe direct landings. The first implementation is extracted from Croprun's `agent-issue-triage` and `agent-issue-once` scripts and keeps the initial Forgejo + Pi path working while introducing boundaries for issue hosts, project policy, and prompt templates.

## Goals

- Preserve the current Forgejo + Pi workflow as the first supported host/runtime combination.
- Provide a first-class `patchmill` CLI with subcommands for triage and single-issue processing.
- Move Croprun-specific labels, validation commands, plan paths, landing policy, prompts, and environment variable names into configuration.
- Define stable interfaces for issue hosts so GitHub/GitLab can be added later.
- Treat Pi as the built-in execution environment for planning, implementation, skills, todos, subagents, and TUI-driven review.
- Keep run-state, resumability, progress logs, structured output validation, and untrusted issue-content handling as core Patchmill features.

## Non-goals for the first generalization pass

- Implement GitHub or GitLab providers.
- Abstract Pi behind a generic coding-agent interface or implement non-Pi agents.
- Build a daemon, scheduler, or multi-worker queue runner.
- Replace the copied implementation wholesale.
- Change the current direct-land policy behavior beyond moving it into configuration/templates.

## Current extracted baseline

The new repository starts with these copied components:

- `scripts/agent-issue-triage.ts`: CLI entrypoint for automated issue triage.
- `scripts/agent-issue-once.ts`: CLI entrypoint for processing one `agent-ready` issue.
- `scripts/agent-issue-triage/*`: Forgejo/tea issue listing, label handling, triage prompt, validation, mutation, and logs.
- `scripts/agent-issue/*`: issue selection, run-state checkpoints, Pi prompt execution, planning/implementation prompts, git worktree handling, progress logs, and cleanup hooks.
- `bin/patchmill.ts`: initial unified CLI dispatcher over the copied commands.

This baseline is intentionally not yet fully generic. It gives the new project a runnable seed and a regression suite while the abstractions are introduced.

## Desired CLI shape

```sh
patchmill triage --dry-run
patchmill triage --limit 10
patchmill run-once --dry-run
patchmill run-once --agent-team openai-only
patchmill run-once --plan-only --issue 123
```

Future commands may include:

```sh
patchmill status
patchmill queue
patchmill providers
patchmill doctor
```

## Configuration model

Patchmill should load configuration in this order:

1. Built-in defaults.
2. Repository config file, initially `patchmill.config.json`.
3. Environment variables.
4. CLI flags.

Initial config should cover:

```json
{
  "host": {
    "provider": "forgejo-tea",
    "login": "triage-agent"
  },
  "pi": {
    "team": "openai-only",
    "triageThinking": "high"
  },
  "labels": {
    "ready": "agent-ready",
    "needsInfo": "needs-info",
    "unsuitable": "agent-unsuitable",
    "inProgress": "in-progress",
    "done": "agent-done",
    "blocked": "blocked",
    "priorities": ["priority:critical", "priority:high", "priority:medium", "priority:low"]
  },
  "paths": {
    "plansDir": "docs/plans",
    "runStateDir": ".patchmill/runs",
    "triageLogDir": ".patchmill/triage-runs",
    "worktreeDir": ".worktrees"
  },
  "git": {
    "baseBranch": "main",
    "branchPrefix": "agent/issue-",
    "worktreePrefix": "patchmill-issue-",
    "allowDirectLand": true
  },
  "projectPolicy": {
    "validationCommands": [],
    "landingPolicy": "project-default",
    "planRequiresApproval": false
  }
}
```

Croprun-specific names such as `CROPRUN_TRIAGE_TEA_LOGIN` should become compatibility fallbacks, not primary configuration.

## Core module boundaries

### CLI layer

Responsible for parsing top-level commands, loading config, printing help, and invoking workflows. It should not know provider-specific command details.

### Workflow core

Responsible for orchestration:

- select issues
- create/apply run-state checkpoints
- call the host provider
- run Pi prompts for triage, planning, and implementation
- validate structured outputs
- update labels/comments
- report progress

The core should depend on the host interface instead of `tea` directly. Pi is a first-class runtime dependency, not a replaceable coding-agent provider.

### Host provider interface

Initial interface:

```ts
export type IssueHostProvider = {
  listOpenIssues(): Promise<IssueSummary[]>;
  hydrateIssueComments(issues: IssueSummary[]): Promise<IssueSummary[]>;
  listLabels(): Promise<string[]>;
  createLabel(label: LabelDefinition): Promise<void>;
  applyLabels(change: LabelChangePlan): Promise<void>;
  commentIssue(issueNumber: number, body: string): Promise<void>;
};
```

The first implementation is `ForgejoTeaHostProvider`, built from the copied `forgejo.ts` functions.

### Pi runner and prompt contracts

Patchmill should keep Pi integration concrete. The copied Pi prompt runner and prompt result parser become a `PiRunner`/prompt module used directly by the workflows instead of being hidden behind a generic coding-agent provider interface.

The boundary to preserve is the prompt contract, not agent replaceability:

- triage input and raw triage JSON output
- plan input and plan result output
- implementation input and implementation result output
- Pi team, thinking, skill, todo, subagent, and TUI instructions

This keeps the implementation aligned with the real operating model: Patchmill prepares repository and issue context, then drives Pi through a TUI-oriented workflow where a human can review, steer, or resume runs.

### Policy and prompt templates

Project-specific behavior should move out of hard-coded strings and into named policy/template units:

- triage buckets and labels
- plan-writing instructions
- implementation workflow instructions
- validation command selection
- direct-land eligibility
- proof screenshot requirements
- host-tooling instructions, such as `tea` versus `gh`
- Pi-tooling instructions, such as skills, todos, subagents, and TUI handoff/review steps

The first pass can keep templates as TypeScript string builders, but the inputs must come from config/policy objects rather than Croprun constants.

### Git strategy

The copied implementation uses git worktrees and branch-per-issue. Keep this as the first `GitWorktreeStrategy`, but make these items configurable:

- base branch
- branch prefix
- worktree location and prefix
- direct-land enabled/disabled
- cleanup hooks

### Discovered non-generalized workflow assumptions

The extraction audit found additional Croprun-specific behavior that must be treated as policy, strategy, or provider behavior rather than core Patchmill logic:

- **Workflow wiring:** loading `patchmill.config.json` is not enough; triage and run-once orchestration must consume normalized config for labels, paths, git, host login, Pi team, and project policy.
- **Git worktrees:** branch names, worktree paths, base refs, remotes, clean-worktree ignored paths, and saved branch/worktree safety checks are currently deterministic Croprun conventions.
- **Cleanup:** Tilt cleanup is a project cleanup hook, not core behavior. The current `.env` probe, Linux `/proc` process cleanup, `tilt up`/`just tilt-up` detection, and `just tilt-down` command must move behind cleanup-hook configuration.
- **Prompt policy:** Croprun wording, `devenv shell`, `AGENTS.md`, Just/Tilt validation commands, forbidden command substitutions, direct squash landing to `main`, staging QA assumptions, and visual evidence rules belong in prompt policy inputs/templates.
- **Visual evidence:** screenshot requirements and Forgejo PR asset uploads are separate concerns. Prompt policy decides what evidence is required; the host provider or a host-adjacent upload adapter handles PR assets/comments.
- **Pi todos and task progress:** `.pi/todos`, `issue-<n>-task-<NN>-<slug>` todo names, final open-todo rejection, and `## Task N:` plan heading parsing are Patchmill/Pi plan contracts and should be documented or configurable.
- **Agent teams:** `.pi/agent-teams` lookup paths, required `worker`/`reviewer` roles, and model/thinking dispatch rules are Pi team policy, not Croprun-specific constants.
- **Triage taxonomy:** automation labels, type labels, priority labels, confidence levels, ambiguity policy, and needs-info comment generation should be represented as triage policy. Defaults may match the copied workflow.
- **Environment:** `PATCHMILL_*` variables should be primary. `CROPRUN_*` variables remain compatibility fallbacks only for the seed workflow.

## Data and output contracts

Keep strict validation around all Pi output. Pi prompt results are untrusted and must return one of the documented JSON statuses.

Triage statuses remain:

- `agent-ready`
- `needs-info`
- `agent-unsuitable`

Processing statuses remain:

- `no-issue`
- `dry-run`
- `plan-created`
- `plan-found`
- `pr-created`
- `merged`
- `blocked`

Final CLI output for `run-once` remains single-line JSON on stdout so schedulers can consume it.

## Security and safety

- Preserve the untrusted issue-content boundary in every Pi prompt.
- Do not allow issue titles, bodies, comments, labels, authors, or metadata to override workflow policy.
- Preserve clean-worktree checks before mutation.
- Preserve checkpointed run-state before/after host mutations so re-runs are safe.
- Keep provider command execution centralized through `CommandRunner` for testability.
- Keep direct landing opt-in through policy/config and conservative by default for new projects.

## Migration strategy

1. Keep copied scripts running under the new repo.
2. Add the `patchmill` dispatcher CLI as a compatibility shell.
3. Introduce config loading with defaults matching the copied behavior.
4. Extract host provider interface and wrap Forgejo/tea.
5. Move labels, paths, and selection policy to config.
6. Move prompt/policy text to project policy objects while keeping Pi integration concrete.
7. Rename public files and commands from `agent-issue` to Patchmill terminology after behavior is covered by tests.

## Open future extensions

- GitHub provider using `gh`.
- GitLab provider using `glab` or REST.
- Queue runner with concurrency limits.
- Web dashboard for run status.
- Provider conformance test fixtures.
