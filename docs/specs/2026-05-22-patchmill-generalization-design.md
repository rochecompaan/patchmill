# Patchmill Generalization Design

## Summary

Patchmill is a Pi-driven software factory that turns repository issues into reviewed diffs, pull requests, or safe direct landings. The first implementation came from the seed automation scripts and preserved the initial Forgejo + Pi workflow while introducing boundaries for issue hosts, project policy, and prompt templates.

## Goals

- Preserve the initial Forgejo + Pi workflow as the first supported host/runtime combination.
- Provide a first-class `patchmill` CLI with `triage` and `run-once` subcommands.
- Move seed-specific labels, validation commands, plan paths, landing policy, and prompts into configuration.
- Define stable interfaces for issue hosts so additional providers can be added later.
- Treat Pi as the built-in execution environment for planning, implementation, todos, subagents, and TUI-driven review.
- Keep run-state, resumability, progress logs, structured output validation, and untrusted issue-content handling as core Patchmill features.

## Configuration model

Patchmill configuration is layered in this order:

1. Built-in defaults.
2. Repository config from `patchmill.config.json`.
3. `PATCHMILL_*` environment variables.
4. CLI flags.

Initial configuration covers host login, Pi team selection, workflow labels, `.patchmill/*` state paths, worktree settings, and project policy.

## Core boundaries

### CLI layer

The CLI parses commands, loads config, prints help, and invokes workflows.

### Workflow core

The workflow core selects issues, manages run state, calls the host provider, runs Pi prompts, validates structured output, updates host state, and reports progress.

### Host provider interface

Host providers expose issue listing, comment hydration, label management, issue comments, and related repository-host actions.

### Pi runner and prompt contracts

Pi remains a concrete runtime. Patchmill preserves explicit prompt contracts for triage, plan creation, and implementation instead of hiding Pi behind a generic coding-agent abstraction.

### Policy and templates

Project-specific behavior belongs in policy inputs and templates rather than hard-coded workflow strings.

### Git strategy

Patchmill keeps a worktree-per-issue strategy with configurable base branch, branch prefix, worktree location, and direct-land behavior.

## Important extracted assumptions

The seed workflow revealed several concerns that belong in configuration or policy instead of core logic:

- workflow wiring for labels, paths, git, host login, Pi team, and project policy
- cleanup hooks and repository-specific process shutdown
- prompt wording, validation guidance, and landing policy
- screenshot and other visual-evidence requirements
- Pi todo and plan-task contracts
- agent-team lookup and role requirements
- triage taxonomy and issue-selection policy
- public configuration limited to `PATCHMILL_*` names

## Data and output contracts

Patchmill treats Pi output as untrusted and validates all supported result documents. Triage returns structured classification decisions; run-once returns one structured final status document.

## Safety rules

- keep issue content untrusted inside prompts
- prevent issue text from overriding workflow policy
- require clean worktrees before mutation
- checkpoint host mutations for safe resume behavior
- centralize provider command execution for testability
- keep landing policy explicit and conservative

## Future extensions

- additional issue-host providers
- queue runners and dashboards
- provider conformance fixtures
