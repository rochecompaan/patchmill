# Patchmill Skill Policy Overrides Design

## Goal

Install Patchmill-recommended project-local skills that preserve Superpowers as
the upstream source of workflow discipline while layering Patchmill-specific
rules for issue worktrees, artifact locations, and test value through
lightweight wrapper entry points.

## Problems

Patchmill recommends project-local Superpowers skills for planning and
implementation discipline, but some upstream defaults conflict with Patchmill's
workflow:

1. Upstream brainstorming and planning guidance writes specs and plans under
   `docs/superpowers/` and assumes the brainstorming skill created the worktree.
   Patchmill run-once artifacts should be created in the issue worktree and
   saved under `docs/specs/` and `docs/plans/`.
2. Upstream test-driven-development guidance is intentionally strict and can
   push agents toward low-value tests for static YAML, documentation, lockfiles,
   dependency versions, or one-off script structure. Patchmill should keep
   automated tests as the default for meaningful production behavior while using
   direct verification where a test only restates file contents.
3. Vendoring full edited copies of upstream skills makes Patchmill's delta hard
   to review and increases maintenance cost when Superpowers updates.

## Design

### Skill source model

Patchmill will keep the pinned Superpowers package as the source of upstream
skills. The recommended project-local skill pack installs unmodified Superpowers
siblings for:

- `brainstorming`
- `writing-plans`
- `test-driven-development`
- the other existing Superpowers workflow skills

Patchmill adds a small `patchmill-planning` wrapper skill in the bundled
`skills/` directory. The wrapper explicitly instructs agents to read sibling
upstream files such as `../brainstorming/SKILL.md` and
`../writing-plans/SKILL.md`, then apply Patchmill-specific modifications.

Existing Patchmill implementation wrapper skills continue to use the same
pattern: they reference sibling Superpowers `subagent-driven-development` by
relative path instead of copying it.

The recommended project-local config points `skills.planning` at
`.patchmill/skills/patchmill-planning`. Supporting Superpowers skills still get
installed into `.patchmill/skills/` so the wrapper can reference them and agents
can use them directly when appropriate.

### Worktree-safe specs and plans

The `patchmill-planning` wrapper enforces this invariant:

- specs and plans are feature artifacts, not base-branch notes;
- if already running inside a Patchmill issue worktree, use that worktree and do
  not create another one;
- if working ad hoc outside a worktree, use `using-git-worktrees` before writing
  the artifact;
- return artifact paths relative to the repository root.

When creating specs, the wrapper uses the sibling Superpowers brainstorming
workflow as source material but saves validated designs to:

```text
docs/specs/YYYY-MM-DD-<topic>-design.md
```

When creating plans, the wrapper uses the sibling Superpowers writing-plans
workflow as source material but saves implementation plans to:

```text
docs/plans/YYYY-MM-DD-<feature-name>.md
```

`run-once` also enforces this behavior by creating or reusing the issue worktree
before invoking Pi for missing spec or plan stages, running Pi with that
worktree as cwd, and resolving artifact paths relative to the worktree
repository root.

### Testing Value Gate

Patchmill prompts and wrappers apply the Testing Value Gate before adding new
automated tests:

- Will this test prove behavior rather than restate implementation or
  configuration?
- Could it fail for a meaningful regression?
- Will future maintainers benefit from rerunning it?
- Is the behavior reusable or risky enough to justify test maintenance?

Automated tests remain the default for production behavior changes, bug fixes,
reusable logic, parsing/validation, API contracts, error handling,
security-sensitive behavior, and regressions.

Agents should use direct verification instead of new tests whose only purpose is
to assert workflow YAML content, dependency versions, package lock contents,
static configuration values, documentation text, or one-off script structure.
When skipping a new automated test, the agent must state the verification used
instead.

### Documentation and upgrade behavior

The skills configuration docs should explain that Patchmill's recommended
project-local skill pack includes Patchmill wrapper skills plus pinned upstream
Superpowers siblings. The docs should make clear that wrappers are lightweight
annotations over upstream workflows, not forked copies.

`patchmill skills update` keeps its existing safety behavior:

- update clean managed skill files;
- refuse to overwrite customized managed files;
- refuse unmanaged new-file collisions;
- record new managed hashes after update.

## Non-goals

- Do not fork the entire Superpowers skill pack.
- Do not vendor edited copies of upstream skills when a wrapper can express the
  Patchmill delta.
- Do not remove Superpowers from Patchmill's dependency set.
- Do not make every repository use Patchmill's policy when it explicitly
  configures different custom skills.
- Do not block all tests for docs or configuration changes; add tests when the
  change includes reusable parsing, validation, behavior, or regression risk.

## Verification plan

Automated tests should cover production behavior and update mechanics:

- recommended skill pack metadata lists `patchmill-planning` as
  Patchmill-sourced and keeps upstream `brainstorming`, `writing-plans`, and
  `test-driven-development` Superpowers-sourced;
- project-local skill installation copies the Patchmill wrapper and the upstream
  sibling skills from their respective source roots;
- generated project-local config points planning at
  `.patchmill/skills/patchmill-planning`;
- `patchmill skills update` still updates clean managed installs and refuses
  customized files or unmanaged collisions;
- run-once generated spec and plan stages invoke Pi from the issue worktree;
- prompt text includes worktree-safe artifact paths and Testing Value Gate
  language.

Direct verification should include:

- confirming the wrapper exists at the paths Patchmill resolves;
- confirming upstream Superpowers skill files are resolved from the pinned
  dependency version;
- `npm test`;
- `npm run lint`;
- package-content verification with `npm pack --dry-run --json --ignore-scripts`
  to confirm Patchmill ships the wrapper and not edited upstream skill copies.

Run the Nix build if package metadata or npm dependency files change.
