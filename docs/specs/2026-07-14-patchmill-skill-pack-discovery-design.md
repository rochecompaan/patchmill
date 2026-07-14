# Patchmill skill pack discovery design

## Context

GitHub issue #82 reports a real bug: Patchmill installs a project-local skill
pack under `.patchmill/skills/`, but Pi runs launched by Patchmill only receive
selected configured skills as individual `--skill PATH` arguments. Patchmill
also runs Pi with `PI_CODING_AGENT_DIR=.patchmill/pi-agent`, so Pi does not
discover `.patchmill/skills/` as its normal global skill directory.

The result is that most Patchmill-managed project-local skills are invisible
during Patchmill runs. This breaks the expected skill-pack model: implementation
skills can reference sibling workflow skills, and engineers cannot easily add
broad project support skills such as `module-size`, `context-mode`, or
repository-specific guidance by putting them in the Patchmill skillset.

Pi's skill model is designed for this use case. A `--skill` argument can point
at either a single skill file or a directory. When pointed at a directory, Pi
scans recursively for `SKILL.md` files and exposes their names and descriptions
to the agent. Full skill contents are still progressively loaded only when the
model chooses to read a matching skill.

## Decision

Patchmill-launched Pi runs should behave like starting Pi with the project skill
directory loaded, then prompting the agent to use the configured skill for the
current stage.

In practice, Patchmill should pass the Patchmill-managed project-local skill
directory, normally `.patchmill/skills/`, to Pi whenever that directory exists.
The stage prompt remains responsible for telling the agent which configured
skill is authoritative for the current task.

Patchmill may still pass individual `--skill` paths for configured skills that
are not discoverable from the loaded project skill directory, such as bundled
Patchmill skills, custom paths outside the skill directory, or other explicit
local files. It should not need to pass both `.patchmill/skills/` and every
configured skill inside that directory.

This accepts issue #82's bug report and fixes it by aligning runtime behavior
with the project-local skill-pack installation model.

## Goals

- Make all installed `.patchmill/skills/` skills discoverable during Patchmill
  Pi runs.
- Keep the configured stage skill authoritative through the stage prompt.
- Let engineers add general-purpose or repository-specific skills to the
  Patchmill skillset without Patchmill code changes.
- Avoid hardcoded dependency maps for Superpowers or Patchmill-managed workflow
  skills.
- Avoid writing persistent Pi settings just to support Patchmill runtime
  behavior.
- Update `patchmill doctor` so it verifies that the installed Patchmill skill
  pack is discoverable by Pi.
- Add regression tests for Pi invocation and doctor behavior.

## Non-goals

- Do not require every configured stage skill to be passed as an individual
  `--skill` argument when it is already discoverable from the project skill
  directory.
- Do not write `.patchmill/pi-agent/settings.json` entries to make
  `.patchmill/skills/` global for ad-hoc Pi runs.
- Do not hardcode a dependency graph for Superpowers or Patchmill-managed
  workflow skills.
- Do not parse free-form skill prose at runtime to infer support-skill
  dependencies.
- Do not require every repository to install `.patchmill/skills/`; repositories
  using only named/global skills may continue to do so.

## Runtime behavior

Introduce a shared resolver for Patchmill Pi skill arguments. It should return
paths in this conceptual order:

1. The Patchmill-managed project-local skill directory, when it exists as a
   readable directory.
2. Individual configured skill paths only when they are not already discoverable
   from that directory.

The resolver should treat a configured skill as discoverable from the
project-local skill directory when the configured value is a path to a skill
directory or `SKILL.md` file under that directory.

The configured stage skills remain stage-specific, but they are primarily prompt
instructions rather than a requirement to pass individual file paths:

| Patchmill stage          | Configured skill named in the prompt                                                                    |
| ------------------------ | ------------------------------------------------------------------------------------------------------- |
| Triage execute / dry-run | `skills.triage`                                                                                         |
| Spec creation            | `skills.planning`                                                                                       |
| Plan creation            | `skills.planning`                                                                                       |
| Development environment  | `skills.developmentEnvironment`                                                                         |
| Implementation           | `skills.toolchain`, `skills.implementation`, `skills.review`, `skills.visualEvidence`, `skills.landing` |

For implementation runs, the project-local skill directory should be resolved
from the repository root where Patchmill configuration and `.patchmill/skills/`
live, not from the issue worktree path. This matches current behavior for
configured project-local skill paths.

If `.patchmill/skills/` does not exist, runtime should not pass a missing
directory to Pi just to produce a warning. Existing behavior should continue for
named/global skills and explicit local paths.

## Prompt behavior

Patchmill prompts should continue to identify the configured stage skill
explicitly. This is what makes a run stage-specific after Pi has loaded the
broader project skill directory.

When the configured skill is a path inside the loaded project skill directory,
the prompt may render both the configured value and the discovered skill name
when that can be derived safely. For example:

> Use the configured implementation skill
> `single-subagent-dev-with-codex-and-thermo-reviews` from
> `.patchmill/skills/single-subagent-dev-with-codex-and-thermo-reviews`.

This is a usability improvement, not a separate discovery mechanism. The
important behavior is that Pi starts with the project skill directory available
and the task prompt points to the intended stage skill.

## Skill path order and collisions

Patchmill should not rely on skill path order for normal behavior. The intended
model is directory discovery plus prompt-directed skill use, not precedence
among duplicate skill paths.

Pi still has collision behavior internally: if two different loaded skills have
the same name, one wins and diagnostics may be produced. Patchmill should treat
unintended same-name collisions as a configuration or doctor issue rather than
depending on argument order to resolve them.

For the common case, where configured skills live inside `.patchmill/skills/`,
passing the directory once avoids duplicate explicit file arguments and makes
path ordering largely irrelevant.

## Doctor behavior

`patchmill doctor` should verify the project-local skill pack from the same
perspective as runtime.

When `.patchmill/skills/` exists, doctor should:

1. Confirm the path is a readable directory.
2. Smoke-test Pi with the `.patchmill/skills/` directory path, plus any required
   individual configured paths that are outside that directory.
3. Verify that Pi can discover representative skills from the directory, not
   only explicitly configured stage skills.
4. Fail or warn clearly if Pi cannot load the directory or if configured
   path-like skills are not discoverable as expected.

Doctor should continue verifying configured path-like skills and
Patchmill-managed skill-pack metadata as it does today. The new check is not a
substitute for managed-pack integrity checks; it verifies Pi runtime
discoverability.

For repositories without `.patchmill/skills/`, doctor should not fail solely
because the directory is absent unless the configured skills point into that
directory or managed-pack metadata indicates it should exist.

## Risks and tradeoffs

### Broader skill surface

All project-local skills become visible to every Patchmill Pi stage. That could
expose planning, implementation, review, or general-purpose skills outside their
primary stage.

This is acceptable because Pi skills are progressively disclosed: the system
prompt includes names and descriptions, while full instructions load only when
the model chooses a matching skill. Patchmill's stage prompt remains explicit
about the configured stage skill and stage boundaries.

### Prompt size

More skill descriptions increase the startup prompt. The recommended Patchmill
skill pack is small enough for this to be acceptable, and the usability benefit
is significant. Repositories that add many large-description skills should treat
`.patchmill/skills/` as part of their project agent environment and keep
descriptions concise.

### General skills affect all stages

Adding a general skill such as `module-size` or `context-mode` makes it
available to all Patchmill stages. This is intended: general skills are useful
precisely because they can support many tasks. Teams should review project-local
skills with the same care they review other automation prompts or scripts.

### Skill collisions

A directory skill can collide with a globally discovered skill or an explicit
custom skill. Patchmill should not depend on argument ordering to hide
collisions. Doctor should surface Pi diagnostics so engineers can resolve
unintended same-name skills.

### Malformed unrelated skills

A malformed skill in `.patchmill/skills/` may generate Pi diagnostics even if
the current stage does not use it. This is a reasonable tradeoff: if a
repository declares a project-local Patchmill skillset, doctor should help keep
that skillset healthy.

### Reproducibility drift

Adding or editing a general skill changes the behavior available to Patchmill
runs. This is intended. `.patchmill/skills/` is the project-controlled skill
environment, analogous to code, config, or prompts that shape automation
behavior.

### Security and trust

Skills can instruct the model and may reference executable helpers. Patchmill
should only load project-local skill directories that are part of the
repository's trusted automation setup. This matches the existing risk of
configuring individual project-local skills.

## Testing strategy

Add or update regression tests to cover:

- Triage execute and dry-run pass the `.patchmill/skills/` directory when it
  exists and still name the configured triage skill in the prompt.
- Spec and plan creation pass the `.patchmill/skills/` directory when it exists
  and still name the configured planning skill in the prompt.
- Development-environment readiness passes the `.patchmill/skills/` directory
  when it exists and still names the configured development-environment skill in
  the prompt.
- Implementation passes the `.patchmill/skills/` directory when it exists and
  still names the configured implementation-adjacent skills in the prompt.
- Configured skills under `.patchmill/skills/` do not also need individual
  `--skill` file arguments.
- Configured local skills outside `.patchmill/skills/` are still passed
  individually.
- Runtime does not pass a missing `.patchmill/skills/` directory for
  repositories that do not install a project-local skill pack.
- Doctor smoke-tests Pi with the same directory-oriented skill arguments that
  runtime would use.
- Doctor warns or fails clearly when an installed project-local skill directory
  is not discoverable by Pi.

## Verification plan

- Run targeted unit tests for skill resolution, triage invocation, Pi
  runner/pipeline invocation, prompt rendering, and doctor checks.
- Run the full test suite with `npm test`.
- Because this changes production invocation behavior, rely on automated
  regression tests rather than documentation-only verification.

## Open decisions resolved

- Full project-local skill directory discovery is desirable and should be
  enabled for Patchmill-launched Pi runs.
- Configured stage-specific skills should be selected by prompt, not by
  duplicating every in-directory skill path as an explicit `--skill` argument.
- Patchmill should still pass individual configured skill paths when they are
  outside the loaded project skill directory.
- Patchmill should not write persistent Pi settings for this behavior.
- `patchmill doctor` should verify runtime discoverability of
  `.patchmill/skills/`.
