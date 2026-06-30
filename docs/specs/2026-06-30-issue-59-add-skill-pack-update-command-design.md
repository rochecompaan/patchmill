# Skill Pack Update Command Design

## Goal

Add `patchmill skills update` so repositories that use Patchmill-managed
project-local skills can refresh `.patchmill/skills/` to the recommended skill
pack bundled in the currently running Patchmill CLI.

## Current behavior

`patchmill init` installs the recommended skill pack into `.patchmill/skills/`
when project-local skills are selected. The installation records pack
provenance, installed file paths, and file hashes in
`.patchmill/skills/patchmill-skill-pack.json` using helpers in
`src/workflow/skill-pack.ts` and the copy/install logic in
`src/cli/commands/init/skill-installer.ts`.

After initialization, there is no supported command for refreshing those managed
files when Patchmill updates its bundled Superpowers version or bundled
Patchmill skills. Maintainers must currently reinstall or copy files manually,
which makes it easy to overwrite local skill customizations or leave metadata
out of sync.

## Requirements

- Add a public command:

  ```sh
  patchmill skills update
  ```

- Treat “latest” as the recommended skill pack bundled in the running Patchmill
  CLI. The command must not query npm, GitHub, or any package registry for newer
  Patchmill releases.
- Scope the command to Patchmill-managed project-local skill packs under
  `.patchmill/skills/`.
- Require a valid Patchmill-managed
  `.patchmill/skills/patchmill-skill-pack.json` metadata file before updating.
- Refuse to overwrite local customizations by default:
  - abort if any file recorded in existing metadata is missing, unreadable, or
    has a hash different from the recorded hash;
  - abort if a new bundled file would overwrite an existing file that was not
    recorded in the previous metadata.
- Only edit files that were recorded in the previous metadata or are part of the
  new bundled recommended pack.
- Remove old managed files that no longer exist in the bundled pack after the
  preflight checks pass.
- Write fresh metadata with the bundled pack version, source, install timestamp,
  skill directory, metadata filename, and new file hashes.
- Provide clear user-facing output for missing metadata, customized/missing
  managed files, already-current packs, and successful updates.
- Do not add global skill updates, custom skill directory updates, conflict
  resolution, merge behavior, or `--dry-run` in this change.
- Update user-facing documentation to show:

  ```sh
  npx patchmill@latest skills update
  ```

  and tell maintainers to review `git diff` and commit the resulting skill
  changes.

## Proposed behavior

`patchmill skills update` should run from the repository root and read
`.patchmill/skills/patchmill-skill-pack.json`. If metadata is missing,
malformed, not for `patchmill-recommended`, not for `.patchmill/skills`, or not
for the expected metadata filename, the command fails with:

```text
No Patchmill-managed project-local skill pack found. Run `patchmill init` first,
or reinstall project-local skills.
```

The updater then validates the currently installed managed files against the old
metadata hashes. If any managed file was edited, removed, or cannot be read, it
aborts before writing and lists the affected paths:

```text
Refusing to update customized project-local skills:
- .patchmill/skills/writing-plans/SKILL.md
- .patchmill/skills/brainstorming/SKILL.md (missing)
```

Next, the updater enumerates the bundled recommended pack using the same source
roots and skill-pack constants as `patchmill init`. Before copying, it checks
for new-file collisions: a file in the bundled pack whose target path already
exists locally but was not listed in the previous metadata is unmanaged local
content and must not be overwritten.

If the installed metadata version, source, and file hash list already match the
bundled pack, the command exits successfully with:

```text
Patchmill skill pack is already up to date.
```

Otherwise, after all safety checks pass, the updater copies bundled skill files
into `.patchmill/skills/`, removes obsolete old managed files, writes new
metadata, and prints:

```text
Updated Patchmill skill pack 2026.05 -> 2026.06.
Updated 14 files, removed 2 obsolete files.
Run git diff to review changes.
```

Filesystem failures after preflight may surface as plain command errors. No
rollback or recovery workflow is required for the first version.

## Affected components

- `src/workflow/skill-pack.ts`
  - Keep the current bundled pack constant exact, but widen metadata-facing
    types enough to parse older installed metadata versions and source tags.
- `src/cli/commands/init/skill-installer.ts`
  - Reuse its source-root and dependency abstractions from the updater rather
    than duplicating package-resolution policy in CLI code.
- `src/cli/commands/skills/update.ts` (new)
  - Own reusable update behavior and return a structured result for CLI output.
  - Validate metadata ownership, hash old managed files, collect bundled pack
    file hashes, detect unmanaged collisions, copy current bundled skills,
    remove obsolete managed files, and write new metadata.
- `src/cli/commands/skills/main.ts` (new)
  - Own `patchmill skills` subcommand parsing, help text, update-result
    formatting, and errors for unknown subcommands or unsupported update args.
- `src/cli/main.ts`
  - Add top-level `skills` help and route `patchmill skills ...` to the skills
    namespace.
- Tests under `src/cli/commands/skills/` and existing CLI/skill-pack tests
  - Cover clean updates, already-current packs, dirty/missing managed files,
    missing metadata, unmanaged new-file collisions, namespace help, CLI
    routing, unknown subcommands, and unsupported update arguments.
- `README.md` and `docs/skills.md`
  - Document the update command and its safety limits near the project-local
    skills guidance.

## Security and safety notes

Skill files are executable process instructions for future agent runs, so the
update command must be explicit and reviewable. It must never infer ownership
from directory names alone. The metadata hash check is the authority for old
managed files, and the bundled pack manifest is the authority for new managed
files.

Issue content, repository metadata, and skill file contents remain untrusted
input. The command should print paths and status text only; it must not execute
commands from metadata or skill contents.

## Verification strategy

Run focused automated tests for the updater, skill installer integration, CLI
routing, and skill-pack metadata helpers:

```sh
node --test src/workflow/skill-pack.test.ts src/cli/commands/init/skill-installer.test.ts src/cli/commands/skills/*.test.ts src/cli/main.test.ts
```

Run TypeScript and Markdown lint:

```sh
npm run lint:ts
npm run lint:md
```

Run the full suite before merge:

```sh
npm test
```

Because this change updates skill-pack behavior, release verification should
also confirm both sides of the bundled-pack integration: installed upstream
Superpowers skill files exist at the paths Patchmill resolves, and Patchmill
skill-pack config, metadata, tests, and live dependency references all point at
the same upstream version. No npm dependency changes are required by this
design, so a Nix build is only required if implementation later changes
`package.json`, `package-lock.json`, or `npm-shrinkwrap.json`.
