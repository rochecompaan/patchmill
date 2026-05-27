# First-use `init` and `doctor` design

## Purpose

Patchmill's first use should build confidence before any repository or
issue-host mutation. The focused onboarding feature adds two commands:

```sh
patchmill init
patchmill doctor
```

`init` creates a small local configuration file. `doctor` performs read-only
checks, including Pi provider readiness, and tells the user what to fix before
running the existing dry-run workflows.

## Scope

In scope:

- Add `patchmill init`.
- Add `patchmill doctor`.
- Guide users to existing dry-run commands after successful checks.
- Offer to launch Pi's native provider setup from `init` when Pi appears
  unconfigured.
- Keep the first version conservative and understandable.

Out of scope:

- Changing `patchmill triage --dry-run` behavior.
- Changing `patchmill run-once` dry-run behavior.
- Creating labels automatically.
- Creating worktrees, run state, or remote comments.
- Adding a `doctor --fix` repair mode.
- Adding an `init --force` overwrite mode.

## Command flow

Recommended first-use flow:

```sh
patchmill init
patchmill doctor
patchmill triage --dry-run
patchmill run-once
patchmill run-once --execute
```

`patchmill run-once` already defaults to dry-run. The mutating run remains
explicit through `--execute`.

## `patchmill init`

### Goal

Create the smallest useful `patchmill.config.json` for the current repository.

### Behavior

- Write only `patchmill.config.json`.
- Do not call the issue host.
- Do not create labels.
- Do not create Patchmill state directories.
- Do not create git branches or worktrees.
- Do not reimplement Pi provider setup or write Pi credentials directly.
- With explicit user consent, launch Pi interactively so the user can use Pi's
  native `/login` provider setup flow.
- Refuse to overwrite an existing config.
- Do not support overwrite in the first version.
- Infer obvious values from local git metadata when possible, especially host
  provider from remote URLs.
- Use the default host login when no local value is provided, and print guidance
  for changing it via config or `PATCHMILL_HOST_LOGIN`.
- Prefer defaults for skills, labels, paths, and git policy so the generated
  file stays short.
- Perform a local-only Pi provider preflight. If no provider configuration is
  apparent, offer to run `pi` interactively for setup.

### Minimal generated config

The generated v1 config should be this minimal shape:

```json
{
  "host": {
    "provider": "forgejo-tea",
    "login": "triage-agent"
  }
}
```

Patchmill's existing config loader fills omitted values from built-in defaults.
If remote detection is uncertain, `init` still generates the same minimal shape
and explains what the user should edit.

### Output

Successful output should summarize what was written and the next command:

```text
Created patchmill.config.json

Host:
  provider: forgejo-tea
  login: triage-agent

Using Patchmill defaults for labels, paths, skills, and git policy.

Patchmill also requires Pi with an LLM provider configured.
No provider configuration was detected.

Open Pi now to configure a provider with `/login`? [y/N]

Next:
  patchmill doctor
```

If Pi already appears configured, omit the provider setup prompt and print:

```text
Pi provider configuration detected.
Doctor will verify it with a minimal smoke test.

Next:
  patchmill doctor
```

If a config already exists:

```text
patchmill.config.json already exists.

Patchmill did not overwrite it.

Next:
  patchmill doctor
```

### Pi provider setup handoff

`init` should not make an LLM request. It should do a local-only preflight for
obvious provider configuration, such as:

- known Pi provider API key environment variables, including
  `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, and `GEMINI_API_KEY`
- user-level Pi auth entries in `~/.pi/agent/auth.json`

If no provider configuration is apparent and `pi` is available, `init` asks
whether to open Pi now. If the user accepts, Patchmill spawns `pi` attached to
the current terminal and lets the user run Pi's native `/login` flow. Any
credentials are written by Pi to Pi's own user-level auth store, not by
Patchmill.

If `pi` is not available, `init` prints install/setup guidance instead of
offering to launch it. If provider configuration appears present, `init` does
not prompt; `doctor` remains responsible for validating that the provider
actually works.

## `patchmill doctor`

### Goal

Confirm that the repository is ready for safe Patchmill dry runs and explain any
missing setup. `doctor` is strictly read-only in the first version.

### Read-only contract

`doctor` must not:

- create labels
- create directories
- write run state
- create worktrees
- mutate issues
- post comments
- change git state
- write config

`doctor` may:

- read configuration
- inspect git status and remotes
- run read-only host commands
- run a minimal Pi print-mode smoke test that makes one LLM provider request
- check command availability
- verify authentication through read-only host metadata
- list issues or labels
- check whether expected paths exist
- check whether parent directories appear usable without leaving persistent
  files behind

### Checks

The initial checklist should cover:

1. **Config** — `patchmill.config.json` exists, parses, and normalizes through
   the existing config loader.
2. **Git repository** — current directory is inside a git worktree.
3. **Git cleanliness** — worktree is clean using the same ignore rules as
   `run-once` for Patchmill local state paths.
4. **Host CLI** — configured provider is supported and required CLI exists
   (`tea` for `forgejo-tea`).
5. **Host authentication** — configured login can perform a read-only identity
   or repository command.
6. **Repository access** — open issues can be listed read-only.
7. **Labels** — configured lifecycle labels exist, or missing labels are
   reported with manual creation commands.
8. **Pi binary** — `pi` is on PATH and responds to a lightweight version or help
   command.
9. **Pi provider** — Pi can complete a minimal print-mode prompt using the
   user's configured provider/model. This check should run with no session and
   no project context, for example:

   ```sh
   pi --no-session --no-context-files --no-prompt-templates \
     -p "Reply with PATCHMILL_PI_OK and nothing else."
   ```

   This is the point where Patchmill verifies that Pi has an LLM provider
   configured. The check is read-only with respect to the repository and issue
   host, but it does make a small external LLM request.

10. **Required skills** — configured required skills are present by name/path or
    can be described as unresolved with remediation guidance.
11. **Paths** — plans, run-state, triage-log, and worktree paths are reported as
    existing, missing, or parent-usable without creating them.

### Output

Output should be checklist-style and optimized for action:

```text
Patchmill doctor

✓ config: patchmill.config.json
✓ git: clean worktree on main
✓ host: forgejo via tea as triage-agent
✓ issues: open issues can be listed
✓ labels: agent-ready, needs-info, in-progress, agent-done
✓ pi: binary available
✓ pi provider: minimal LLM smoke test succeeded
✓ skills: triage, planning, implementation
✓ paths: plans/run-state/triage/worktree paths look usable

Ready for safe dry runs.

Next:
  patchmill triage --dry-run
```

Failures should say what failed, whether Patchmill changed anything, and how to
retry. Example:

```text
Patchmill doctor

✓ config: patchmill.config.json
✓ git: clean worktree on main
✗ labels: missing agent-ready, needs-info

Patchmill doctor is read-only and did not create labels.

Create the missing labels manually, then rerun:
  tea labels create --name agent-ready --color 0e8a16
  tea labels create --name needs-info --color fbca04
  patchmill doctor
```

Pi provider failure example:

```text
✗ pi provider: Pi could not complete a minimal LLM smoke test

Patchmill doctor did not change the repository or issue host.
The Pi check made no Patchmill workflow changes, but it could not reach a
configured model provider.

Configure Pi, then rerun:
  pi
  /login
  # select a provider
  patchmill doctor

Alternatively set a provider API key, for example:
  export ANTHROPIC_API_KEY=sk-ant-...
  patchmill doctor
```

## Architecture

Add first-class CLI command dispatch entries for `init` and `doctor` alongside
`triage` and `run-once`.

Recommended module layout:

- `src/cli/commands/init/args.ts` — parse `init` flags.
- `src/cli/commands/init/main.ts` — CLI entrypoint and user output.
- `src/cli/commands/init/config-writer.ts` — infer values and write minimal
  config.
- `src/cli/commands/doctor/args.ts` — parse `doctor` flags.
- `src/cli/commands/doctor/main.ts` — CLI entrypoint and user output.
- `src/cli/commands/doctor/checks.ts` — read-only checks and result types.
- `src/cli/commands/doctor/reporting.ts` — checklist formatting.

Where possible, reuse existing config loading, git cleanliness, host, label, and
command-runner helpers instead of duplicating behavior.

## Data flow

`init`:

1. Parse arguments.
2. Check whether `patchmill.config.json` exists.
3. Inspect local git remotes if available.
4. Build a minimal config object.
5. Write the config if safe.
6. Run local-only Pi provider preflight.
7. If Pi appears unconfigured and the terminal is interactive, offer to launch
   `pi` for the native `/login` setup flow.
8. Print summary and next command.

`doctor`:

1. Parse arguments.
2. Load normalized config.
3. Run independent read-only checks.
4. Collect pass/warn/fail results.
5. Print checklist and remediation guidance.
6. Exit non-zero when any required check fails.

## Error handling

- `init` exits non-zero for invalid arguments, failed writes, or existing config
  when overwrite is not requested.
- Declining the Pi setup handoff is not an error; `init` should print the manual
  `pi` and `/login` instructions and continue to recommend `patchmill doctor`.
- If the user accepts the Pi setup handoff and the spawned `pi` process fails,
  `init` should report the failure but still leave the written Patchmill config
  in place.
- `doctor` continues after individual check failures when possible so users get
  a complete setup report.
- Required check failures make `doctor` exit non-zero.
- Warnings may exit zero if Patchmill can still run safe dry-runs.
- All failure messages should be specific and include a retry command.

## Testing

Add tests for:

- command dispatch for `init` and `doctor`
- `init` writes minimal config
- `init` refuses to overwrite existing config
- `init` remote/provider inference where practical
- `init` detects apparent Pi provider configuration from env/auth indicators
- `init` offers to launch Pi only when no provider configuration is apparent
- `init` does not offer to launch Pi when provider configuration is apparent
- `init` handles declined Pi setup handoff without error
- `doctor` success report with mocked command runner
- `doctor` aggregates multiple failures instead of stopping at the first one
- `doctor` does not call mutating host helpers
- `doctor` reports missing labels with manual commands
- `doctor` exits non-zero on required failures
- help text for both commands

## Success criteria

A new user can run:

```sh
patchmill init
patchmill doctor
```

and understand:

- what local config was created
- whether Pi provider setup is already apparent or needs the native Pi `/login`
  flow
- whether their repo and tools are ready
- what must be fixed manually
- that no remote or git mutation happened during `doctor`
- that the next safe step is `patchmill triage --dry-run`
