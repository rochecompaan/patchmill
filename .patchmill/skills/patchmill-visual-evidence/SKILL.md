---
name: patchmill-visual-evidence
description:
  Use when a Patchmill issue changes visible UI and needs committed reference
  screenshots.
---

# Patchmill Visual Evidence

Capture screenshots from the approved running app in the existing issue
worktree. Use the same issue branch as the implementation and its pull request.
Screenshots support review. They do not replace project tests or validation
commands.

## Capture reference screenshots

1. Read the project instructions for the approved app instance and readiness
   command.
2. Use Playwright or the project browser tooling, not OS or window screenshots.
3. Wait for visible text or selectors that prove the changed UI state before
   capture.
4. Update an existing reference screenshot, or save a new one under
   `docs/screenshots/` unless project instructions specify another directory.
5. Use a stable semantic filename, such as `admin-log-entries-empty.png`. Do not
   use issue numbers, dates, or temporary names.
6. Commit the screenshots with the implementation changes and push them to the
   issue branch.

Keep screenshots inside the worktree. Use `.png`, `.jpg`, `.jpeg`, `.gif`, or
`.webp` files. Avoid secrets and private data in screenshots. Describe the UI
state and repository-relative screenshot paths in the pull request body. Do not
upload screenshots or post issue comments through this skill.

## Optional helper

If the project provides `@playwright/test`, use the helper bundled beside this
skill. Resolve `scripts/capture-visual-evidence.cjs` relative to this
`SKILL.md`, then run it from the issue worktree:

```bash
node /absolute/path/to/patchmill-visual-evidence/scripts/capture-visual-evidence.cjs \
  --url "$URL" \
  --output docs/screenshots/admin-log-entries.png \
  --wait-text "Log entries"
```

Use `--ready-command` for the approved readiness command. Use `--wait-selector`
or repeated `--wait-text` flags for visible proof conditions. Use
`--storage-state` for existing browser authentication state. The helper also
supports viewport, load-state, and login environment-variable options. Read its
source for those options before use. Do not pass passwords as command-line
arguments. If Playwright is unavailable, use approved project tools or ask for a
setup decision. Do not add dependencies without approval.

## Kernel result

The planning and implementation result contains exactly `status` and `summary`.
Mention committed screenshot paths and the pull request URL in the summary
string when useful. Do not add `visualEvidence`, `referencePaths`, or a legacy
`pr-created` status to the final JSON. The kernel does not upload screenshots or
consume separate screenshot metadata. Make sure that screenshots are committed
and referenced in the pull request before reporting `done`.
