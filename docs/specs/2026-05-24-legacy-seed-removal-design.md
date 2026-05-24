# Legacy Seed Compatibility Removal Design

## Summary

Patchmill should no longer contain compatibility fallbacks, default settings, prompts, docs, or tests for the original seed project. The current code intentionally preserved those references as migration support. This change removes that migration layer and makes the generic Patchmill configuration surface the only supported behavior.

The removal target is intentionally stronger than the 2026-05-22 generalization design: `PATCHMILL_*` configuration is primary and exclusive; legacy seed-project environment variables, policies, cleanup hooks, path fallbacks, and documentation should disappear from runtime code and user-facing docs.

## Goals

- Remove all runtime reads of `CROPRUN_*` environment variables.
- Remove the compatibility project policy and any prompt branches that special-case the old project name.
- Remove legacy cleanup presets and default cleanup behavior derived from the old repository.
- Remove legacy path fallbacks such as `.pi/agent-issue/*` from defaults and clean-worktree ignore lists.
- Remove migration documentation and help text that teaches old names.
- Convert compatibility-preservation tests into generic-only behavior tests or delete them.
- Update the audit script so old-project references are forbidden instead of allowlisted.
- Keep the generic Forgejo/tea provider, Pi runtime, cleanup-hook framework, and visual-evidence uploader where they are genuinely Patchmill features.

## Non-goals

- Do not remove Forgejo support solely because the seed project used Forgejo. Forgejo remains the first implemented host provider.
- Do not remove the generic cleanup hook framework; remove only bundled old-project presets and messages.
- Do not rename every internal `agent-issue` file or command in this pass unless the reference exists only to preserve old-project compatibility. That broader CLI/internal-module rename can remain a separate cleanup.
- Do not add a new host provider.

## Audit performed

Commands run from the repository root on 2026-05-24:

```sh
rg -n -i --hidden --glob '!node_modules' --glob '!dist' --glob '!coverage' --glob '!*.lock' 'croprun|crop run|CROPRUN' .
npm run audit:generalization
```

Results:

- `rg` found 248 matching lines across 26 files before this design document was added.
- `npm run audit:generalization` passed because the existing script allowlists the compatibility code paths, tests, and migration docs. That pass confirms the remaining references are intentional compatibility artifacts, not that the repository is generic-only.

## Current reference inventory

### Runtime environment fallbacks

These files read or advertise old environment variables and must become `PATCHMILL_*` only:

- `scripts/agent-issue/args.ts`
  - Reads `CROPRUN_AGENT_ISSUE_TEA_LOGIN`, `CROPRUN_TRIAGE_TEA_LOGIN`, and `CROPRUN_AGENT_ISSUE_AGENT_TEAM`.
  - Falls back to old cleanup hooks and old project policy when normalized config is absent.
  - Uses the legacy worktree strategy when normalized config is absent.
  - Defaults run state to `.pi/agent-issue/runs` when normalized config is absent.
- `scripts/agent-issue-triage/args.ts`
  - Reads `CROPRUN_TRIAGE_TEA_LOGIN`.
  - Falls back to old project policy and `.pi/agent-issue/triage-runs` when normalized config is absent.
- `scripts/agent-issue-once.ts`
  - Help text lists `CROPRUN_AGENT_ISSUE_*` and `CROPRUN_TRIAGE_TEA_LOGIN` variables.
  - `loadCliConfig` passes normalized config only when `patchmill.config.json` exists, which activates compatibility defaults when the file is absent.
- `scripts/agent-issue-triage.ts`
  - Help text lists `CROPRUN_TRIAGE_TEA_LOGIN`.
  - `loadCliConfig` passes normalized config only when `patchmill.config.json` exists.
- `src/host/forgejo-visual-evidence.ts`
  - Type definitions and `envValue` support `CROPRUN_AGENT_ISSUE_FORGEJO_URL`, `CROPRUN_AGENT_ISSUE_FORGEJO_TOKEN`, and `CROPRUN_AGENT_ISSUE_FORGEJO_REPO`.

### Runtime compatibility settings and prompt behavior

These files preserve old project settings even without old env variables:

- `src/policy/defaults.ts`
  - Exports `CROPRUN_COMPAT_POLICY` plus old direct-land, validation, visual-evidence, Forgejo/tea, screenshot, and Pi workflow wording.
- `scripts/agent-issue/prompts.ts`
  - `isCroprunCompatPolicy()` changes prompt target wording, PR creation wording, and PR URL placeholders.
- `scripts/agent-issue/pipeline.ts`
  - Blocker question recommends `CROPRUN_AGENT_ISSUE_AGENT_TEAM`.
- `src/cleanup/hooks.ts`
  - Exports `LEGACY_CROPRUN_CLEANUP_HOOKS` and the bundled `tilt-just` cleanup preset.
  - Contains special-case messages for `tilt-just`.
- `src/git/worktree-strategy.ts`
  - Exports `LEGACY_AGENT_ISSUE_WORKTREE_STRATEGY_CONFIG`, which exists to preserve old worktree naming.
- `src/config/defaults.ts`
  - Keeps `.pi/agent-issue/runs/` in `cleanStatusIgnorePrefixes`.

### Tests and fixtures

The following tests intentionally prove compatibility and should be rewritten or removed:

- `scripts/agent-issue/args.test.ts`
- `scripts/agent-issue/pipeline.test.ts`
- `scripts/agent-issue/prompts.test.ts`
- `scripts/agent-issue/visual-evidence.test.ts`
- `scripts/agent-issue-triage/agent.test.ts`
- `scripts/agent-issue-triage/args.test.ts`
- `src/host/forgejo-visual-evidence.test.ts`
- `src/policy/defaults.test.ts`

Other tests mention the old project only as negative assertions or fixture strings and should be kept only if the string is removed or replaced with a neutral forbidden-token fixture.

### Documentation and audit tooling

These files currently document or allow compatibility and need updates:

- `README.md`
- `docs/migration-from-croprun-scripts.md`
- `docs/providers.md`
- `docs/task-contracts.md`
- `docs/specs/2026-05-22-patchmill-generalization-design.md`
- `docs/plans/2026-05-22-patchmill-generalization.md`
- `scripts/audit-generalization.sh`

The migration guide should be deleted or rewritten as generic configuration documentation. The old 2026-05-22 spec/plan should be sanitized because the requested end state is that the old seed project is not part of the repository narrative.

## Desired behavior

### Configuration loading

Patchmill loads defaults, config file, environment, and CLI flags as before, but with no old-project compatibility branch. `patchmill.config.json` is optional; absence of the file should still use normalized Patchmill defaults.

Effective defaults when no config file exists:

- host login: `PATCHMILL_HOST_LOGIN ?? "triage-agent"`
- agent team: `PATCHMILL_AGENT_TEAM` or unset
- paths: `.patchmill/runs`, `.patchmill/triage-runs`, `docs/plans`, `.worktrees`
- worktree prefix: `patchmill-issue-`
- cleanup hooks: `[]`
- project policy: `DEFAULT_PATCHMILL_POLICY`

### Environment variables

Supported environment variables after removal:

- `PATCHMILL_HOST_LOGIN`
- `PATCHMILL_AGENT_TEAM`
- `PATCHMILL_FORGEJO_URL`
- `PATCHMILL_FORGEJO_TOKEN`
- `PATCHMILL_FORGEJO_REPO`

Old variables must be ignored if present. They should not affect behavior, appear in help text, or appear in docs.

### Prompt policy

Prompts should render solely from `PatchmillProjectPolicy`. There should be no code path that detects the old project name or infers host behavior from it. If a repository wants project-specific wording, it must put that wording in `patchmill.config.json`.

### Cleanup hooks

Patchmill keeps generic cleanup hooks configured by `cleanupHooks`, but ships no old-project cleanup preset. Generic hook result messages should be based on hook names and commands without Tilt-specific wording.

### Visual evidence upload

Forgejo visual evidence upload uses only `PATCHMILL_FORGEJO_*` variables. Blank primary values count as absent. Old variables do not satisfy configuration checks and are not read.

### Audit script

`npm run audit:generalization` should fail on any old-project token in normal tracked product files. The script should no longer maintain allowlists for old-project compatibility paths. It may exclude generated output, VCS internals, dependency directories, and intentionally temporary planning docs if needed during the removal branch.

## Acceptance criteria

- `npm test` passes.
- `npm run audit:generalization` passes with zero old-project compatibility allowlists.
- Runtime code has no `CROPRUN_`, `CROPRUN_COMPAT_POLICY`, `LEGACY_CROPRUN_CLEANUP_HOOKS`, or `isCroprunCompatPolicy` symbols.
- Help text and user docs mention only `PATCHMILL_*` environment variables.
- Running triage or run-once without `patchmill.config.json` uses normalized Patchmill defaults, not compatibility defaults.
- Supplying old environment variables alone does not set host login, agent team, or Forgejo visual-evidence config.

## Risks and mitigations

- Existing users of old variables will see behavior change. This is intentional; release notes should say those names were removed.
- Removing old prompt policy may change generated plans/implementation prompts. Generic policy tests should assert no old project/tooling text leaks into prompts.
- Removing the bundled Tilt cleanup preset may leave some repositories without cleanup unless they configure hooks explicitly. The generic cleanup hook schema remains available.
- Sanitizing historical docs can obscure origin history. The user explicitly requested an “as if it never existed” outcome, so repository narrative should favor generic Patchmill provenance over migration history.
