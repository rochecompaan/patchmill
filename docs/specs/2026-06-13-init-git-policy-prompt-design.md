# `patchmill init` Git Policy Prompt Design

## Context

`patchmill init` currently installs project-local skills by default, writes
`patchmill.config.json`, automatically adds Patchmill local paths to
`.git/info/exclude`, and prints a broad warning that config and skills are
local-only by default.

That warning leaves the user to decide what to do next. Instead, interactive
initialization should ask how the generated Patchmill files should be handled by
git.

## Goals

- Replace the local-only warning with an interactive git-policy choice.
- Preserve the current safe default for non-interactive and `--yes` runs.
- Let users commit reusable Patchmill configuration and skills when they choose
  to do so.
- Always protect local runtime/auth/session directories when the user chooses to
  add config and skills to git.

## Behavior

After `patchmill init` creates `patchmill.config.json` and installs or validates
skills, interactive runs prompt for one of three choices:

1. **Add to git**
   - Append these entries to `.gitignore` if missing:
     - `.patchmill/pi-agent`
     - `.patchmill/runs`
     - `.patchmill/triage-runs`
   - Run `git add patchmill.config.json .patchmill/skills .gitignore`.
   - Report the staged files and ignored local runtime directories.
2. **Git ignore**
   - Append these entries to `.gitignore` if missing:
     - `patchmill.config.json`
     - `.patchmill/`
   - Report the `.gitignore` update.
3. **Git exclude**
   - Append these entries to `.git/info/exclude` if missing:
     - `patchmill.config.json`
     - `.patchmill/`
   - Report the local exclude update.

Non-interactive runs and `--yes` keep the current safe default by choosing **Git
exclude** automatically.

If the repository has no writable git metadata, Patchmill should still finish
initialization and print a clear warning explaining which entries the user
should add manually.

## Implementation Notes

- Move git-policy file updates into a focused helper module so `main.ts` stays
  responsible for CLI orchestration rather than low-level file edits.
- Reuse the existing prompt dependency used by init label setup for simple
  terminal prompts.
- Use deterministic, line-oriented append logic that avoids duplicate entries.
- Run `git add` through the existing command-runner path so tests can inject a
  fake runner or command behavior.
- Keep existing skill installation modes unchanged.

## Testing

Automated tests should cover:

- Interactive **Add to git** updates `.gitignore` with runtime/auth/session
  entries and runs `git add patchmill.config.json .patchmill/skills .gitignore`.
- Interactive **Git ignore** appends `patchmill.config.json` and `.patchmill/`
  to `.gitignore`.
- Interactive **Git exclude** appends `patchmill.config.json` and `.patchmill/`
  to `.git/info/exclude`.
- Non-interactive and `--yes` runs choose **Git exclude** without prompting.
- Existing ignore/exclude entries are not duplicated.
- Missing git metadata produces an actionable warning instead of failing init.
