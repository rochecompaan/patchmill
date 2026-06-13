# Module-size skill pack design

Date: 2026-06-13

## Summary

Patchmill should install the `module-size` skill as part of its recommended
project-local skill pack. The skill will be vendored into Patchmill from
`/home/roche/projects/pi/roche-pi/skills/module-size/SKILL.md` and copied during
`patchmill init` alongside the existing recommended skills.

The skill is advisory workflow guidance, not a Patchmill workflow stage. It
should be installed into initialized repositories as
`.patchmill/skills/module-size/SKILL.md`, but it should not be wired into
`triage`, `planning`, `implementation`, or any optional workflow slot by
default.

## Goals

- Include `module-size` in Patchmill's default recommended skill pack.
- Keep the skill available project-locally after `patchmill init`.
- Preserve existing default workflow stage mappings.
- Keep the implementation offline-safe by bundling the skill in Patchmill's
  `skills/` directory.
- Verify package and init behavior with existing automated test coverage.

## Non-goals

- Add a new Patchmill skill configuration key for module sizing.
- Change how Pi chooses or activates skills at runtime.
- Fetch the skill dynamically from the `roche-pi` repository during init.
- Modify the content or behavior of the module-size skill beyond vendoring the
  approved source file.

## Design

### Bundled skill source

Add a new bundled skill directory:

```text
skills/module-size/SKILL.md
```

The file content should match
`/home/roche/projects/pi/roche-pi/skills/module-size/SKILL.md`.

### Recommended skill pack

Update `PATCHMILL_RECOMMENDED_SKILL_PACK` in `src/workflow/skill-pack.ts` to
include:

```ts
{ name: "module-size", source: "patchmill" }
```

The source should be `patchmill` because Patchmill will ship the vendored file
directly. This follows the existing pattern used for `patchmill-issue-triage`
and the Patchmill-owned implementation skills.

### Workflow config

Do not change `buildRecommendedProjectSkillConfig()`. It should continue to
return only the default workflow stage mappings:

- `triage`
- `planning`
- `implementation`

`module-size` is installed as part of the local skill pack metadata and files,
but it is not selected as a workflow stage.

### Packaging

No package file-list change should be required because `package.json` already
includes the top-level `skills` directory, and the Nix package copies that
directory. Verification should confirm the npm pack includes
`skills/module-size/SKILL.md`.

## Testing and verification

Automated tests should cover the behavior because this changes reusable
packaging/init behavior.

Update or add focused assertions in existing tests to verify:

- The recommended skill pack contains `module-size` with source `patchmill`.
- `installProjectSkills()` copies `.patchmill/skills/module-size/SKILL.md` and
  includes it in metadata.
- The package includes `skills/module-size/SKILL.md`.

Existing config tests should remain unchanged where they verify workflow
mappings, because `module-size` should not be added to default workflow stage
config.

Run targeted tests first, then the full relevant suite if needed:

```bash
node --test src/workflow/skill-pack.test.ts src/cli/commands/init/skill-installer.test.ts bin/package-files.test.ts
npm run lint
```

## Error handling

No new runtime error paths are needed. Existing init validation already checks
that every recommended pack skill has a readable `SKILL.md` before copying. If
the vendored file is missing or malformed, the existing installer preflight
should fail with the missing skill path.

## Module-size considerations

This change keeps module boundaries narrow:

- `skills/module-size/SKILL.md` owns the skill content.
- `src/workflow/skill-pack.ts` owns recommended pack membership.
- Installer behavior stays generic and does not gain skill-specific branching.
- Tests assert the new pack member without broadening production APIs.
