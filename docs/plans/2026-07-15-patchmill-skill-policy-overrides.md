# Patchmill Skill Policy Overrides Plan

## Goal

Refactor PR #93 so Patchmill expresses its Superpowers policy differences with
lightweight wrapper skills instead of vendoring full edited upstream skill
copies.

## Scope

- Add a Patchmill-owned `patchmill-planning` wrapper skill.
- Keep upstream Superpowers `brainstorming`, `writing-plans`, and
  `test-driven-development` skills installed as unmodified siblings from the
  pinned dependency.
- Point project-local planning config at `.patchmill/skills/patchmill-planning`.
- Preserve existing Patchmill implementation wrappers that reference sibling
  Superpowers skills by relative path.
- Keep run-once worktree/artifact-path enforcement and Testing Value Gate prompt
  language.
- Update tests, docs, notices, and package verification expectations.

## Tasks

### 1. Red tests for wrapper architecture

- Update `src/workflow/skill-pack.test.ts` to expect:
  - `PATCHMILL_RECOMMENDED_SKILL_PACK` includes
    `{ name: "patchmill-planning", source: "patchmill" }`;
  - `brainstorming`, `writing-plans`, and `test-driven-development` remain
    `source: "superpowers"`;
  - generated project-local config maps `planning` to
    `.patchmill/skills/patchmill-planning`;
  - the wrapper references `../brainstorming/SKILL.md` and
    `../writing-plans/SKILL.md` and contains Patchmill artifact/worktree/test
    policy.
- Run `node --test src/workflow/skill-pack.test.ts` and confirm it fails before
  implementation.

### 2. Implement skill-pack wiring

- Add `PATCHMILL_PLANNING_SKILL = "patchmill-planning"` to
  `src/workflow/skill-pack.ts`.
- Add `skills/patchmill-planning/SKILL.md` as a small wrapper that:
  - tells agents to read sibling Superpowers `brainstorming` for spec work;
  - tells agents to read sibling Superpowers `writing-plans` for plan work;
  - saves specs to `docs/specs/YYYY-MM-DD-<topic>-design.md`;
  - saves plans to `docs/plans/YYYY-MM-DD-<feature-name>.md`;
  - uses the active Patchmill issue worktree;
  - applies the Testing Value Gate.
- Remove Patchmill-vendored edited copies of upstream `skills/brainstorming`,
  `skills/writing-plans`, and `skills/test-driven-development`.

### 3. Update installer/update/package coverage

- Update installer fixtures so Patchmill-owned sources include
  `patchmill-planning`, while Superpowers sources include upstream
  `brainstorming`, `writing-plans`, `test-driven-development`, and
  `subagent-driven-development`.
- Assert installation writes both the wrapper and upstream sibling skills with
  managed metadata hashes.
- Update path-mode validation tests to require `patchmill-planning` as the
  planning entry point.
- Update package-content tests to assert the npm package includes
  `skills/patchmill-planning/SKILL.md` and does not include edited upstream
  skill directories.

### 4. Update docs and notices

- Update `THIRD_PARTY_NOTICES.md` so it describes Superpowers skill wrappers
  rather than vendored upstream skill copies.
- Update the skills configuration guide to describe Patchmill wrappers plus
  pinned upstream siblings.
- Update this spec and plan to describe the wrapper architecture.

### 5. Verification

Run:

```bash
node --test src/workflow/skill-pack.test.ts
node --test src/cli/commands/init/skill-installer.test.ts src/cli/commands/skills/update.test.ts bin/package-files.test.ts
npm test
npm run lint
npm pack --dry-run --json --ignore-scripts
```

Directly verify:

- no `.patchmill/` files are in the PR diff;
- no edited upstream skill copies remain under `skills/brainstorming`,
  `skills/writing-plans`, or `skills/test-driven-development`;
- package contents include `skills/patchmill-planning/SKILL.md`.

Run the Nix build only if npm dependency metadata changes.
