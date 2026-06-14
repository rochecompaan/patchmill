# Optional Implementation-Ready Skill Design

## Summary

Patchmill should support an optional `skills.implementationReady` stage that
runs between issue worktree preparation and implementation. Repositories with
project-specific runtime requirements can use this stage to prepare and verify a
local development environment before Patchmill spends implementation-agent time.

The stage is generic. Patchmill does not know about Tilt, k3d, Docker, devenv,
ports, namespaces, browsers, or other project-specific tooling. Patchmill only
knows that, when `skills.implementationReady` is configured, the configured
skill must return a small readiness result before `skills.implementation`
starts.

If the skill is omitted, `patchmill run-once` behaves exactly as it does today.

## Goals

- Make implementation-environment readiness a first-class optional workflow
  stage.
- Keep Patchmill generic and avoid hardcoding Tilt/k3d or any other project
  runtime.
- Let repositories express readiness and repair logic in a project-local Pi
  skill.
- Prevent long implementation runs from starting when the repository's required
  local verification environment is unavailable.
- Distinguish local operator/environment failures from issue requirement
  questions.
- Pass readiness evidence into the later implementation prompt when readiness
  succeeds.
- Preserve current behavior for repositories that do not configure the new
  skill.

## Non-goals

- Add hardcoded readiness commands to `projectPolicy.validation`.
- Teach Patchmill how to start or repair specific tools such as Tilt, k3d,
  Docker, Playwright, or devenv.
- Require every repository to configure an implementation-readiness stage.
- Post issue-host `needs-info` questions for local environment failures.
- Replace implementation-time validation rules. The readiness stage only
  verifies that implementation may start; implementation still follows the
  configured validation policy.

## Configuration

Add one optional skill key:

```json
{
  "skills": {
    "implementationReady": ".patchmill/skills/bootstrapping-tilt-worktrees",
    "implementation": ".patchmill/skills/subagent-dev-with-codex-and-thermo-reviews"
  }
}
```

The key follows the same resolution rules as other skill keys:

- path-like references resolve relative to `patchmill.config.json`;
- named or namespace-style references are passed to Pi as normal skill
  invocations;
- `patchmill doctor` verifies path-like configured skills and warns for named
  skills it cannot statically inspect.

`patchmill init` should not configure `implementationReady` by default. The
feature is opt-in because many projects do not need a runtime bootstrap before
implementation.

## Run-once workflow

When `skills.implementationReady` is omitted, the existing implementation flow
is unchanged.

When it is configured, `patchmill run-once` uses this sequence after a plan is
available and implementation is allowed:

1. prepare or reuse the issue worktree;
2. run the configured implementation-ready skill from the issue worktree root;
3. parse the readiness result;
4. if ready, record readiness evidence and proceed to implementation;
5. if not ready, stop before implementation and return an operator-facing
   readiness failure.

The stage should run before any implementation subagents are dispatched. The
implementation skill should not be responsible for remembering to invoke the
readiness skill itself; Patchmill owns the stage ordering.

Readiness is ephemeral. Patchmill may record the successful result in run state
for logging and prompt handoff, but a later `run-once` should run the readiness
stage again instead of treating a previous ready result as permanently valid.
Project skills can make the check cheap by returning quickly when the
environment is already usable.

## Readiness prompt contract

Patchmill should run Pi with a dedicated readiness prompt. The prompt includes:

- issue number, title, labels, branch, worktree path, and plan path;
- the untrusted issue-content boundary;
- required repository context-file instructions;
- the configured `skills.implementationReady` line;
- an instruction not to implement product changes or dispatch implementation
  workers;
- instructions to leave tracked product files unchanged unless the configured
  readiness skill explicitly documents a safe, repository-owned change;
- the readiness result contract below.

The prompt should tell Pi to return only one of two statuses.

Ready:

```json
{
  "status": "ready",
  "summary": "Tilt/k3d environment is ready",
  "evidence": ["devenv shell -- just tilt-ready passed"],
  "environment": {
    "namespace": "optional namespace or other useful detail",
    "tiltPort": "optional port or other useful detail"
  }
}
```

Not ready:

```json
{
  "status": "not-ready",
  "reason": "Tilt/k3d environment unavailable",
  "evidence": [
    "devenv shell -- just tilt-ready failed: Kubernetes API at localhost:8080 refused connection"
  ],
  "remediation": [
    "Run devenv shell -- just tilt-up from the issue worktree",
    "Confirm devenv shell -- just tilt-ready passes",
    "Re-run patchmill run-once"
  ]
}
```

`questions` are intentionally absent. A readiness failure usually means the
operator's local runtime is unavailable, not that the issue author needs to
clarify product requirements.

`environment` is optional and intended for small, non-secret facts that help the
implementation session, such as a namespace, port, profile name, or readiness
script version. Secrets and tokens must not be returned.

## Not-ready behavior

A `not-ready` result should stop the run before implementation starts.

Patchmill should:

- remove the in-progress claim according to existing run-once cleanup behavior;
- leave the issue in its current actionable workflow state so the operator can
  repair the environment and retry;
- write the reason, evidence, remediation, and log path to the final stdout
  result;
- append the same diagnostics to the JSONL run log;
- avoid posting a default `needs-info` issue comment because the failure is
  local/operator-facing rather than issue-facing.

A possible final Patchmill result shape is:

```json
{
  "status": "implementation-not-ready",
  "issueNumber": 84,
  "reason": "Tilt/k3d environment unavailable",
  "evidence": ["devenv shell -- just tilt-ready failed"],
  "remediation": [
    "Run devenv shell -- just tilt-up",
    "Re-run patchmill run-once"
  ],
  "logPath": ".patchmill/runs/issue-84/run-...jsonl"
}
```

The existing `blocked` issue workflow remains available for spec, plan, and
implementation cases where product or maintainer input is required. Readiness
failures should use the new local-environment result instead.

## Ready handoff into implementation

When readiness succeeds, Patchmill includes a concise readiness section in the
implementation prompt, for example:

```text
Implementation readiness:
- The configured implementation-ready skill completed at 2026-06-14T06:00:00Z.
- Summary: Tilt/k3d environment is ready.
- Evidence:
  - devenv shell -- just tilt-ready passed
- Environment:
  - namespace: issue-84
  - tiltPort: 10384
```

This section tells implementation workers that the project-specific bootstrap
has already run. It is evidence for starting work, not permission to skip later
validation commands.

If the environment becomes unavailable later during implementation-time
validation, the implementation skill should follow the normal Patchmill blocker
or landing contract and the repository's validation policy.

## Documentation and generated skill packs

Documentation should explain that `implementationReady` is useful when a project
requires local services, Kubernetes/Tilt, browser automation infrastructure,
containers, seeded databases, or other mutable runtime setup before tests can
run.

The default skill pack should not install a generic implementation-ready skill.
Project owners can add a local skill such as
`.patchmill/skills/bootstrapping-tilt-worktrees` and configure the key when they
need it.

Existing implementation skills may mention that Patchmill can run an optional
readiness stage before implementation, but they should not duplicate the stage
or require project-specific readiness commands themselves.

## Testing and verification

Automated tests should cover reusable Patchmill behavior:

- config loading accepts optional `skills.implementationReady`;
- doctor validates path-like `implementationReady` skills with the existing
  skill-check mechanism;
- `run-once` skips the readiness stage when the key is omitted;
- `run-once` runs readiness before implementation when the key is present;
- a `ready` result is recorded and passed into the implementation prompt;
- a `not-ready` result stops before implementation and returns
  `implementation-not-ready` diagnostics;
- malformed readiness JSON fails clearly without starting implementation.

No tests should hardcode Tilt/k3d behavior. Project-specific readiness commands
belong in project-local skills and can be verified in those projects.
