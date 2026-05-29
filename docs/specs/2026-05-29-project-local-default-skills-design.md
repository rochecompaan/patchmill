# Project-local default skills design

Date: 2026-05-29

## Summary

Patchmill should own the default skill experience by installing a recommended
skill set during `patchmill init`. The default installation mode is
project-local: `init` writes the selected skills into the repository, configures
Patchmill to use those local files, and expects them to be committed to git.

This makes Patchmill effective on first use while preserving project control.
Patchmill supplies a strong starting point; the repository owns the resulting
implementation process.

## Goals

- Make Patchmill useful immediately after `patchmill init` without requiring
  users to separately discover or install workflow skills.
- Treat skills that govern implementation behavior as project-owned, reviewable
  source files.
- Allow projects to customize skills without affecting other Patchmill projects.
- Keep the default workflow replaceable through configuration.
- Let `patchmill doctor` validate the exact skills the project will use.

## Non-goals

- Build a full skill registry or marketplace in this change.
- Automatically upgrade customized project-local skills.
- Force all projects to use Patchmill's recommended skills.
- Require user-global skill installation for normal Patchmill usage.

## Skill ownership and installation policy

`patchmill init` installs Patchmill's recommended default skill set
project-locally and expects those skill files to be committed to git.

Default behavior:

- Install skills into `.patchmill/skills/`.
- Generate config that points workflow stages at those local skills.
- Do not add the skills directory to `.gitignore`.
- Include pack, version, and provenance metadata in config or a lock/manifest
  file.
- Let `patchmill doctor` verify that committed skill files exist and have the
  expected shape.
- Allow users to edit, replace, or override the skills per project.

Configurable alternatives:

- `patchmill init --skills project`: install recommended skills project-locally.
  This is the default.
- `patchmill init --skills global`: reference user-global skills.
- `patchmill init --skills none`: do not install default skills.
- `patchmill init --skills path:<dir>`: use an existing local skill directory.

## Architecture

Patchmill treats default skills as first-class init artifacts, similar to
generated configuration.

### Skill pack manifest

A skill pack manifest defines the recommended pack name, version, source, and
files. For example, Patchmill may publish or reference
`patchmill-recommended@2026.05`. The manifest is used by `init`, `doctor`, and
future skill maintenance commands.

### Project-local skill directory

The default target is `.patchmill/skills/`. It contains the actual committed
skill files. Generated Patchmill config references these local files rather than
external package names, for example `superpowers:subagent-driven-development`.

Example generated mapping:

```json
{
  "skills": {
    "triage": ".patchmill/skills/triage",
    "planning": ".patchmill/skills/writing-plans",
    "implementation": ".patchmill/skills/subagent-driven-development"
  }
}
```

If Pi or a downstream runtime requires skill identifiers instead of paths,
Patchmill resolves these local paths into the runtime invocation.

### Skill installation metadata

Patchmill writes metadata describing what was installed and where it came from.
The metadata can live in `.patchmill/skills/patchmill-skill-pack.json` or a
broader `.patchmill/patchmill.lock.json`.

The metadata lets `doctor` and future commands distinguish between:

- missing skills
- malformed skills
- customized skills
- outdated default packs
- intentionally overridden config

### Init flow

```text
patchmill init
  -> choose skill install mode
  -> resolve default skill pack
  -> copy or install skills into .patchmill/skills/
  -> write config pointing at local skills
  -> write skill pack metadata
  -> run or suggest doctor readiness validation
```

## Behavior, customization, and safety

Patchmill distinguishes installed defaults from project-owned behavior.

- `patchmill init` installs the default skills once.
- After installation, the skill files are normal project files.
- Users are encouraged to edit them when the project needs different behavior.
- Patchmill does not silently overwrite modified project-local skills.
- If a skill path already exists during init, Patchmill avoids overwriting
  unless the user explicitly confirms.
- `doctor` warns when committed skills differ from the original pack, because
  customization is expected.
- `doctor` readiness-blocks only when required configured skills are missing or
  malformed.

Future maintenance commands can build on the manifest and metadata:

- `patchmill skills diff`
- `patchmill skills update`
- `patchmill skills reset`

These commands are explicit so skill changes remain reviewable.

## Distribution strategy

The initial implementation should install a pinned external skill pack during
`patchmill init`. This keeps Patchmill lean while giving users good defaults.

A later hybrid model can add bundled fallback skills so init still works when
the network or external source is unavailable. The product direction remains the
same in both cases: Patchmill owns the default onboarding experience, while each
repository owns the committed skill files it runs.

## Validation

`patchmill doctor` checks:

- required configured skill paths exist
- each required skill has the expected shape and metadata
- generated config points to project-local skills after default init
- the skill directory is not ignored by git
- skill pack metadata exists for project-local default installs
- modified skills are reported as customized, not broken

Readiness should fail when required skills are missing or malformed. Readiness
should warn, not fail, when installed default skills have been customized.

## Testing

Automated tests should cover:

- `patchmill init` installs default skills into `.patchmill/skills/`.
- Generated config references local skill paths.
- Initialized skills are not added to `.gitignore`.
- `patchmill doctor` passes for a freshly initialized repo.
- `patchmill doctor` fails if a required local skill is missing.
- `patchmill doctor` warns, but does not fail, if a default skill was edited.
- `patchmill init --skills none` skips default installation.
- `patchmill init --skills global` references user-global skills without writing
  project-local defaults.
- `patchmill init --skills path:<dir>` uses an existing local skill directory.
- Existing skill files are not overwritten without explicit confirmation.

## Error handling

- If default skill installation fails, `init` explains whether the project is
  still usable and what command can repair it.
- If a network install fails, the current implementation reports the failure
  clearly; a later hybrid implementation may fall back to bundled defaults.
- If configured skill paths are missing, `doctor` reports the exact missing
  paths and suggested repair.
- If local skills are customized, `doctor` reports that state as customization
  rather than corruption.

## Open extension points

This design leaves room for:

- third-party skill packs
- a future Patchmill skill catalog
- skill pack upgrades and diffs
- project-specific skill forks
- bundled offline fallback defaults

None of these are required for the initial project-local default skill
installation behavior.
