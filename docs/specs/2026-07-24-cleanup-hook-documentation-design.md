# Cleanup Hook Documentation Design

## Goal

Make Patchmill's existing `cleanupHook` configuration discoverable and explain
its lifecycle contract well enough that projects can use it to tear down local
development environments after successful `run-once` handoff.

## Decision

Use the existing top-level `cleanupHook` configuration for deterministic
development-environment cleanup. Do not add another workflow stage, skill slot,
Pi invocation, or cleanup implementation to Patchmill.

The documentation must distinguish environment cleanup from Patchmill-owned Git
cleanup:

- the configured hook cleans project-specific resources such as Tilt sessions,
  Kubernetes namespaces, Docker Compose projects, local services, ports, or
  seeded data;
- Patchmill retains responsibility for its issue worktree and local branch;
- planning, failed, blocked, approval-required, and other retryable outcomes do
  not run the hook.

## Existing behavior to document

`cleanupHook` is an optional path in `patchmill.config.json`. When it is
configured, successful `run-once` finalization executes:

```sh
bash <cleanupHook>
```

The command runs with the issue worktree as its current working directory, so a
relative path is resolved from that worktree. The script does not need its
executable bit set because Patchmill invokes it through `bash`.

The lifecycle order is:

1. implementation returns terminal success as `pr-created` or `merged`;
2. Patchmill records and reports the successful handoff;
3. Patchmill runs `cleanupHook` from the issue worktree;
4. for `pr-created`, Patchmill performs its built-in local worktree and branch
   cleanup.

A missing hook configuration is a no-op. A hook failure is emitted as cleanup
progress but does not change an already successful PR or merge result into an
implementation failure. The run log and final run state remain available as
audit evidence.

The docs should recommend that cleanup scripts:

- are idempotent;
- target only resources namespaced to the current issue or worktree;
- tolerate resources that are already absent;
- return a non-zero exit code when cleanup is incomplete;
- avoid deleting Patchmill's worktree, local branch, remote branch, PR, or run
  state;
- avoid depending on a future retry, because the hook runs only after terminal
  success.

## Site documentation changes

### Getting-started configuration

Add a short cleanup-hook section to
`site/src/content/docs/getting-started/configuration.md` near the workflow skill
and project-environment configuration.

Include:

- a minimal `patchmill.config.json` example;
- a minimal Bash script example;
- the issue-worktree working-directory rule;
- the idempotence and resource-scoping guidance;
- a link to the detailed `run-once` lifecycle explanation.

Example configuration:

```json
{
  "cleanupHook": "./scripts/cleanup.sh"
}
```

The example script should demonstrate safe shell defaults and an idempotent,
project-specific teardown command without prescribing Tilt, Kubernetes, or
Docker as a required tool.

### Run-once guide

Add a “Cleanup after successful handoff” section to
`site/src/content/docs/using-patchmill/run-once.md` after the development
environment and implementation discussion.

Explain:

- the terminal-success-only trigger;
- execution through `bash` from the issue worktree;
- the ordering after handoff recording and before built-in PR workspace removal;
- non-fatal cleanup failure reporting;
- why retryable outcomes retain their environments;
- the boundary between environment cleanup and Patchmill-owned Git cleanup.

### Lifecycle reference

Update the numbered terminal portion of
`site/src/content/docs/reference/agent-workflow-lifecycle.md` to include the
configured cleanup hook and subsequent built-in PR worktree cleanup. Keep this
entry concise and link to the `run-once` guide for the detailed contract.

### Configuration example

Retain the existing `cleanupHook` entry in
`site/src/content/docs/reference/configuration-example.md`. No schema or example
value change is required.

## Compatibility and error handling

This is a documentation-only change. It describes current behavior and does not
change configuration parsing, hook execution, progress events, result statuses,
or workspace cleanup.

The documentation must not imply that:

- cleanup runs after failures, blockers, or approval gates;
- Patchmill retries a failed cleanup hook automatically;
- a failed hook changes a successful implementation result;
- the hook receives structured arguments or environment metadata;
- the hook should remove Patchmill's Git resources.

## Validation

Do not add automated tests for documentation text. This falls outside the
Testing Value Gate because it would assert static prose rather than production
behavior.

Verify the change with:

```sh
npm run lint:md
npm run format:check
npm run site:build
```

Also review the rendered navigation and links to confirm readers can move from
configuration to the detailed `run-once` cleanup contract.

## Non-goals

- Adding `skills.cleanup` or `skills.developmentEnvironmentCleanup`.
- Re-invoking `skills.developmentEnvironment` after implementation.
- Changing `cleanupHook` execution or failure semantics.
- Adding automatic cleanup for abandoned or retryable runs.
- Supplying a project-specific production cleanup script.
- Changing built-in worktree or branch cleanup.
