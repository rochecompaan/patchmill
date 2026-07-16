# Patchmill Skill Policy Overrides Design

## Goal

Install Patchmill-recommended project-local skills that preserve Superpowers as
the upstream starting point while layering Patchmill-specific workflow rules for
issue worktrees, artifact locations, and test value.

## Problems

Patchmill currently recommends project-local Superpowers skills for planning and
implementation discipline, but two upstream defaults conflict with Patchmill's
workflow:

1. Superpowers brainstorming and planning guidance writes specs and plans under
   `docs/superpowers/` and assumes the brainstorming skill created a worktree.
   In Patchmill runs, generated specs and plans should be created on the issue
   worktree and saved under Patchmill's artifact directories, normally
   `docs/specs/` and `docs/plans/`.
2. Superpowers test-driven-development guidance is intentionally strict and can
   push agents to create low-value tests for static YAML, documentation,
   lockfiles, dependency versions, or one-off script structure. Patchmill should
   keep automated tests as the default for meaningful production behavior while
   requiring direct verification for artifacts where an automated test only
   restates file contents.

## Design

### Skill source model

Patchmill will continue to consume Superpowers as the upstream source of process
discipline. For the affected skills, Patchmill will vendor adapted copies in the
bundled `skills/` directory and mark them as Patchmill-sourced in
`PATCHMILL_RECOMMENDED_SKILL_PACK`:

- `skills/brainstorming/`
- `skills/writing-plans/`
- `skills/test-driven-development/`

Each adapted skill starts from the pinned Superpowers version in `package.json`
and applies only Patchmill-specific customizations on top. The files should keep
upstream structure and wording where it still fits, with a short Patchmill
customization note near the top explaining what differs and why. Supporting
files from the upstream skills, such as brainstorming visual-companion scripts
and writing-plans reviewer prompts, remain part of the copied skill directories.

The recommended skill pack version should be bumped so `patchmill skills update`
can update existing clean managed project-local installs. The pack metadata
should continue to record the installed file hashes for every managed file.

### Worktree-safe specs and plans

The adapted `brainstorming` skill will save validated designs to:

```text
docs/specs/YYYY-MM-DD-<topic>-design.md
```

The adapted `writing-plans` skill will save implementation plans to:

```text
docs/plans/YYYY-MM-DD-<feature-name>.md
```

Both skills will state the worktree invariant:

- specs and plans are the first files of a feature branch, not base-branch
  notes;
- if already running inside a Patchmill issue worktree, use that worktree and do
  not create another one;
- if working ad hoc outside a worktree, use `using-git-worktrees` before writing
  the spec or plan;
- return artifact paths relative to the repository root.

Patchmill should also enforce this in `run-once`, not rely only on skill text.
When `run-once` must generate a missing spec or plan, it should create or reuse
the issue worktree before invoking Pi for the artifact stage and run Pi with
that worktree as cwd. Artifact path resolution, prompt paths, skill path
resolution, and final JSON normalization should treat paths as relative to the
worktree repository root, while run state still records the relative artifact
path and issue branch/worktree path.

This prevents generated specs and plans from mutating the base checkout and
avoids asking the skill to create an unmanaged second worktree during a
Patchmill run.

### Testing Value Gate

The adapted `test-driven-development` skill will keep the red-green-refactor
loop, but only after a test passes the Patchmill Testing Value Gate:

- Will this test prove behavior rather than restate implementation or
  configuration?
- Could it fail for a meaningful regression?
- Will future maintainers benefit from rerunning it?
- Is the behavior reusable or risky enough to justify test maintenance?

Automated tests remain the default for:

- production behavior changes;
- bug fixes and regressions;
- reusable logic;
- parsing and validation;
- API contracts;
- error handling;
- security-sensitive behavior.

The skill will explicitly reject new tests whose only purpose is to assert:

- GitHub Actions or other workflow YAML content;
- dependency or requirements versions;
- package-lock or shrinkwrap contents;
- static configuration values;
- documentation text;
- one-off script structure.

For those cases, agents should use direct verification such as linting, syntax
checks, dry-runs, builds, or existing test suites. When skipping a new automated
test, the agent must state the verification used instead.

The adapted `writing-plans` skill should generate plan tasks that reflect this
policy: behavior work gets test-first steps; docs/config/static artifact work
gets explicit verification steps instead of low-value tests.

### Implementation prompts and reviews

Patchmill-owned implementation prompt snippets that mention TDD should align
with the same policy so workers do not receive conflicting instructions. Prompts
should say to use automated tests by default for meaningful production behavior
and to apply the Testing Value Gate before adding new tests. Review prompts
should flag missing high-value tests, but should not demand tests for static
artifacts when direct verification is stronger.

### Documentation and upgrade behavior

The skills configuration docs should explain that Patchmill's recommended
project-local skill pack includes a few Patchmill-adapted Superpowers skills.
The docs should make clear that these are upstream-derived skills with Patchmill
workflow overrides, not unrelated replacements.

`patchmill skills update` keeps its existing safety behavior:

- update clean managed skill files;
- refuse to overwrite customized managed files;
- refuse unmanaged new-file collisions;
- record new managed hashes after update.

## Non-goals

- Do not fork the entire Superpowers skill pack.
- Do not remove Superpowers from Patchmill's dependency set.
- Do not make every repository use Patchmill's policy when it explicitly
  configures different custom skills.
- Do not block all tests for docs or configuration changes; add tests when the
  change includes reusable parsing, validation, behavior, or regression risk.

## Verification plan

Automated tests should cover production behavior and update mechanics:

- recommended skill pack metadata now lists the three adapted skills as
  Patchmill-sourced;
- project-local skill installation copies the Patchmill-owned adapted skill
  files and their supporting files;
- `patchmill skills update` updates clean managed installs to the new pack
  version and refuses customized files as before;
- generated spec and plan stages in `run-once` invoke Pi from the issue worktree
  rather than the base repo;
- prompt text includes the worktree-safe artifact paths and Testing Value Gate
  language.

Direct verification should include:

- confirming adapted skill files exist at the paths Patchmill resolves;
- confirming metadata, tests, installed references, and live dependency
  references all point at the same pinned Superpowers version used as the
  starting point;
- `npm test`;
- `npm run lint`;
- package-content verification, such as `npm pack --dry-run`, to confirm bundled
  adapted skill files are included.

Run the Nix build if package metadata or npm dependency files change.
