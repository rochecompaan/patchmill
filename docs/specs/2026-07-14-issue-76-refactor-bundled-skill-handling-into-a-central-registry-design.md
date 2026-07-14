# Issue 76: central bundled-skill registry design

## Context

Patchmill has several bundled skills that can be used without project-local
installation. Today their metadata is split across multiple modules:

- `src/workflow/skill-resolution.ts` defines bundled config-reference constants,
  path helpers, and resolver branches for triage and visual evidence.
- `src/workflow/skills.ts` repeats bundled references in default and global
  skill config.
- `src/workflow/skill-pack.ts` separately defines Patchmill skill names,
  recommended pack entries, project-local config, and required sidecar files.
- `src/cli/commands/doctor/checks.ts` has special-case verification for bundled
  triage and visual evidence.
- `src/cli/commands/init/skill-installer.ts` derives Patchmill source roots from
  the triage path and validates selected project-local recommended skills by
  hand.

This was workable when bundled skills were modeled as single `SKILL.md` files,
but `patchmill-visual-evidence` now includes the required sidecar script
`scripts/capture-visual-evidence.cjs`. Adding another bundled skill should not
require adding matching one-off constants, resolver branches, doctor branches,
and required-file maps in different places.

## Goals

- Define bundled Patchmill skill metadata once in a canonical registry.
- Use that registry to derive bundled config references, global names, resolved
  `SKILL.md` paths, required files, and project-local recommended config where
  applicable.
- Verify all required files for bundled skills, including sidecar scripts, not
  just `SKILL.md`.
- Preserve current behavior for bundled issue triage, recommended project-local
  skill installation, visual evidence, and existing global/named skills.
- Make adding a new bundled skill a data change in the registry plus targeted
  tests, not a set of unrelated resolver and doctor branches.

## Non-goals

- Do not redesign Pi's skill loading or project-local skill directory discovery.
- Do not change configured skill names, existing default values, or public
  config syntax.
- Do not add, remove, or rewrite bundled skill prose as part of this refactor.
- Do not change the recommended Superpowers version or npm dependencies.

## Proposed design

Introduce a small workflow module, for example `src/workflow/bundled-skills.ts`,
that owns the registry and derived helpers. Each registry entry should include
at least:

```ts
export type BundledPatchmillSkill = {
  key: PatchmillSkillKey;
  configReference: string;
  globalName: string;
  dirName: string;
  requiredFiles: readonly string[];
  recommendedProjectLocal?: boolean;
};
```

Initial entries should preserve current public values:

| key              | configReference                     | globalName / dirName        | requiredFiles                                     | recommendedProjectLocal |
| ---------------- | ----------------------------------- | --------------------------- | ------------------------------------------------- | ----------------------- |
| `triage`         | `patchmill:bundled-issue-triage`    | `patchmill-issue-triage`    | `SKILL.md`                                        | yes                     |
| `visualEvidence` | `patchmill:bundled-visual-evidence` | `patchmill-visual-evidence` | `SKILL.md`, `scripts/capture-visual-evidence.cjs` | yes                     |

The implementation may include additional Patchmill-managed skills in the same
registry if they are bundled and have required-file metadata, but the refactor
must not force every recommended pack skill to become a default workflow skill.
Non-bundled Superpowers skills should stay outside this registry.

The registry module should provide derived helpers rather than inviting call
sites to duplicate predicates:

- lookup by workflow key;
- lookup by config reference;
- lookup by global skill name / directory name;
- `bundledSkillPath(entry)` or `bundledSkillPathForReference(reference)` that
  preserves the current source-tree vs built-package path behavior;
- `requiredFilesForBundledSkillName(name)` or equivalent;
- an iterable list for doctor and tests.

Existing public exports such as `BUNDLED_TRIAGE_SKILL_REFERENCE`,
`BUNDLED_VISUAL_EVIDENCE_SKILL_REFERENCE`, `bundledTriageSkillPath()`, and
`bundledVisualEvidenceSkillPath()` may remain as compatibility wrappers, but
they should be derived from the registry.

## Affected components

### Skill resolution

`src/workflow/skill-resolution.ts` should replace hardcoded bundled-reference
branches with a registry lookup. `resolveConfiguredSkillInvocation()` should map
any registered `configReference` to that skill's bundled `SKILL.md` path. Named
or namespace-style skills that are not registered bundled references should keep
existing behavior.

The generic path helper should continue looking in both the source tree and the
built package layout so tests and packaged CLI runs keep working.

### Default and global skill config

`src/workflow/skills.ts` should derive bundled defaults from the registry:

- `DEFAULT_PATCHMILL_SKILLS.triage` remains `patchmill:bundled-issue-triage`.
- `DEFAULT_PATCHMILL_SKILLS.visualEvidence` remains
  `patchmill:bundled-visual-evidence`.
- `GLOBAL_PATCHMILL_SKILLS.triage` remains `patchmill-issue-triage`.
- `GLOBAL_PATCHMILL_SKILLS.visualEvidence` remains `patchmill-visual-evidence`.

Planning and implementation defaults remain Superpowers references and do not
belong in the bundled Patchmill registry.

### Skill pack metadata and project-local config

`src/workflow/skill-pack.ts` should use the registry for Patchmill bundled skill
names and required files. `requiredSkillFiles("patchmill-visual-evidence")`
should still return both `SKILL.md` and `scripts/capture-visual-evidence.cjs`;
unknown skills should still default to `["SKILL.md"]`.

`buildRecommendedProjectSkillConfig()` should derive project-local paths for
registered default workflow skills instead of hardcoding Patchmill bundled
names. The recommended pack should continue including the same Patchmill and
Superpowers skills it includes today.

### Init skill installer

`src/cli/commands/init/skill-installer.ts` should use registry-derived source
roots and required-file lists when installing or validating Patchmill skills.
`validateExistingSkillDirectory()` should preserve its current contract: return
local paths for triage, planning, implementation, and visual evidence, and fail
when visual evidence is missing its helper script.

### Doctor

`src/cli/commands/doctor/checks.ts` should verify bundled defaults through a
registry lookup instead of key-specific branches. When a configured skill equals
a registered bundled `configReference`, doctor should verify every required file
relative to the bundled skill directory. The visual evidence bundled default
must therefore fail if `scripts/capture-visual-evidence.cjs` is missing or
unreadable.

Doctor should keep existing warnings for unregistered named/global skills and
existing validation for path-like local skills. For path-like skills, required
files may still be inferred from the resolved skill frontmatter name and the
registry/required-file helper.

### Tests and documentation

Update existing tests rather than adding broad integration rewrites. Important
coverage includes:

- registry contains triage and visual evidence metadata with current public
  strings;
- bundled config references resolve through the generic resolver;
- public compatibility exports still return the same paths and constants;
- visual evidence required files are derived from the registry for skill-pack,
  init validation, and doctor;
- doctor verifies all registered required files for bundled defaults;
- recommended project-local config and pack entries are unchanged.

Documentation changes are optional for this internal refactor unless public docs
currently describe a hardcoded implementation detail that becomes inaccurate.

## Compatibility and migration

No user migration is required. Existing `patchmill.config.json` values should
continue to work:

- bundled references such as `patchmill:bundled-issue-triage` and
  `patchmill:bundled-visual-evidence`;
- global names such as `patchmill-issue-triage` and `patchmill-visual-evidence`;
- project-local paths such as `.patchmill/skills/patchmill-visual-evidence`;
- custom path-like visual evidence skills with the same frontmatter name and
  required helper script.

The refactor should preserve public exports used by tests and internal modules,
or update all call sites in the same change if an export is intentionally
renamed.

## Verification strategy

- Run focused tests for workflow skill modules:
  `npm test -- src/workflow/skills.test.ts src/workflow/skill-resolution.test.ts src/workflow/skill-pack.test.ts`.
- Run focused init and doctor tests:
  `npm test -- src/cli/commands/init/skill-installer.test.ts src/cli/commands/doctor/checks.test.ts`.
- Run visual-evidence-specific tests:
  `npm test -- src/workflow/visual-evidence-skill.test.ts`.
- Run the full test suite if focused tests pass.
- Because this design does not require npm dependency changes, a Nix build is
  not required unless implementation changes `package.json`,
  `package-lock.json`, or `npm-shrinkwrap.json`.

## Risks and mitigations

- **Circular imports:** put registry helpers in a low-level workflow module and
  import only type-only `PatchmillSkillKey` references if needed, or define the
  registry key type locally to avoid cycles.
- **Over-generalization:** keep the registry limited to bundled Patchmill skill
  metadata and simple lookup helpers; avoid a new plugin framework.
- **Behavior drift:** assert unchanged default/global config objects and
  recommended project-local paths in tests.
- **Sidecar regressions:** include tests that intentionally remove or omit
  `scripts/capture-visual-evidence.cjs` and expect init/doctor validation to
  fail.
