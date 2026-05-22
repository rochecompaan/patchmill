# Patchmill Generalization Design

## Summary

Patchmill is an agent-driven software factory that turns repository issues into reviewed diffs, pull requests, or safe direct landings. The first implementation is extracted from Croprun's `agent-issue-triage` and `agent-issue-once` scripts and keeps the initial Forgejo + Pi path working while introducing boundaries for host providers, coding agents, project policy, and prompt templates.

## Goals

- Preserve the current Forgejo + Pi workflow as the first supported provider combination.
- Provide a first-class `patchmill` CLI with subcommands for triage and single-issue processing.
- Move Croprun-specific labels, validation commands, plan paths, landing policy, prompts, and environment variable names into configuration.
- Define stable interfaces for issue hosts and coding agents so GitHub/GitLab and non-Pi agents can be added later.
- Keep run-state, resumability, progress logs, structured output validation, and untrusted issue-content handling as core Patchmill features.

## Non-goals for the first generalization pass

- Implement GitHub or GitLab providers.
- Implement non-Pi agent providers.
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
patchmill triage --execute --limit 10
patchmill run-once --dry-run
patchmill run-once --execute --agent-team openai-only
patchmill run-once --execute --plan-only --issue 123
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
  "agent": {
    "provider": "pi",
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
- call the agent provider
- validate structured outputs
- update labels/comments
- report progress

The core should depend on interfaces, not on `tea` or `pi` directly.

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

### Coding agent provider interface

Initial interface:

```ts
export type CodingAgentProvider = {
  runTriage(input: TriageAgentInput): Promise<RawTriageDocument>;
  runPlan(input: PlanAgentInput): Promise<AgentPlanResult>;
  runImplementation(input: ImplementationAgentInput): Promise<AgentImplementationResult>;
};
```

The first implementation is `PiAgentProvider`, built from the copied Pi prompt runner and prompt result parser.

### Policy and prompt templates

Project-specific behavior should move out of hard-coded strings and into named policy/template units:

- triage buckets and labels
- plan-writing instructions
- implementation workflow instructions
- validation command selection
- direct-land eligibility
- proof screenshot requirements
- host-tooling instructions, such as `tea` versus `gh`
- agent-tooling instructions, such as Pi skills, todos, and subagents

The first pass can keep templates as TypeScript string builders, but the inputs must come from config/policy objects rather than Croprun constants.

### Git strategy

The copied implementation uses git worktrees and branch-per-issue. Keep this as the first `GitWorktreeStrategy`, but make these items configurable:

- base branch
- branch prefix
- worktree location and prefix
- direct-land enabled/disabled
- cleanup hooks

## Data and output contracts

Keep strict validation around all agent output. Agents are untrusted and must return one of the documented JSON statuses.

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

- Preserve the untrusted issue-content boundary in every agent prompt.
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
5. Extract coding agent provider interface and wrap Pi.
6. Move labels, paths, and selection policy to config.
7. Move prompt/policy text to project policy objects.
8. Rename public files and commands from `agent-issue` to Patchmill terminology after behavior is covered by tests.

## Open future extensions

- GitHub provider using `gh`.
- GitLab provider using `glab` or REST.
- Claude Code/Codex/Gemini agent providers.
- Queue runner with concurrency limits.
- Web dashboard for run status.
- Provider conformance test fixtures.
