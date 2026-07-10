---
name: patchmill-visual-evidence
description:
  Use when Patchmill run-once changes visible UI and needs committed reference
  screenshot evidence in the final pr-created JSON.
---

# Patchmill Visual Evidence

## Overview

Visual evidence is a durable Patchmill handoff artifact. Capture screenshots
from the approved running app, save or update them as committed reference
screenshots in the issue worktree, and return structured metadata so Patchmill
can verify the reference screenshots before it cleans up the worktree.

## Patchmill Contract

When the issue changes visible UI, the final `pr-created` JSON must include
`visualEvidence` entries that point at committed reference screenshots:

```json
"visualEvidence": [
  {
    "screenshotPath": "docs/screenshots/admin-log-entries-page.png",
    "caption": "Reference screenshot for the server-driven log entries page"
  }
]
```

Rules:

- `screenshotPath` is required and must point to a real `.png`, `.jpg`, `.jpeg`,
  `.gif`, or `.webp` file inside the worktree.
- `screenshotPath` must be a committed reference screenshot. By default, use
  `docs/screenshots/` unless project instructions specify another reference
  screenshot directory.
- For an existing screen, update the existing reference screenshot file.
- For a new screen, create a semantic kebab-case filename based on the route,
  page/component name, or visible title.
- Do not use issue numbers, dates, random hashes, or temporary proof names for
  committed reference screenshots.
- `caption` should describe the UI state represented by the reference
  screenshot.
- `referencePaths` is optional; use it only when pointing to additional
  committed baseline/reference screenshots used for comparison.
- Omit `visualEvidence` when the issue does not change visible UI.
- Do not upload or comment on visual evidence manually unless project/user
  instructions explicitly require it; the committed reference screenshot is the
  durable artifact.

## Filename Pattern

Use stable names that future UI changes can update in place:

| UI surface                    | Reference screenshot path                         |
| ----------------------------- | ------------------------------------------------- |
| `/admin/log-entries` route    | `docs/screenshots/admin-log-entries.png`          |
| `LogEntriesPage` component    | `docs/screenshots/log-entries-page.png`           |
| `Log entries` visible title   | `docs/screenshots/log-entries.png`                |
| Empty/error/mobile UI states  | `docs/screenshots/log-entries-empty.png` etc.     |
| Existing dashboard screenshot | update the existing dashboard reference file path |

## Required Pattern

1. **Use the approved app instance.** Run the project's readiness command or use
   the prepared development environment. Do not start ad-hoc servers when
   project rules forbid them.
2. **Use Playwright/browser automation.** Do not use OS/window screenshots
   unless the user explicitly asks.
3. **Wait for proof conditions.** Require visible text or selectors that
   demonstrate the changed UI before capturing.
4. **Save or update a reference screenshot.** Use `docs/screenshots/` by
   default. Commit the screenshot file with the implementation changes.
5. **Return `visualEvidence`.** The screenshot is evidence only if the final
   `pr-created` JSON references the committed screenshot path.

## Helper Script

Use the bundled helper when the project has `@playwright/test` available.
Resolve `scripts/capture-visual-evidence.cjs` relative to this skill's
`SKILL.md` file, then run it from the issue worktree:

```bash
node /absolute/path/to/patchmill-visual-evidence/scripts/capture-visual-evidence.cjs \
  --url "$URL" \
  --output docs/screenshots/admin-log-entries-page.png \
  --wait-text "Log entries"
```

Options:

| Need                | Option                                                               |
| ------------------- | -------------------------------------------------------------------- |
| Readiness check     | `--ready-command 'just tilt-ready'`                                  |
| Viewport            | `--viewport 1366x900`                                                |
| Page load state     | `--load-state domcontentloaded` (`load` or `networkidle` if needed)  |
| Visible text        | `--wait-text 'Changed label'` repeated as needed                     |
| Selector            | `--wait-selector '[data-testid="changed-panel"]'` repeated as needed |
| Auth storage state  | `--storage-state playwright/.auth/user.json`                         |
| Login redirect      | `--login-username-env USER_VAR --login-password-env PASSWORD_VAR`    |
| Viewport screenshot | `--no-full-page`                                                     |

The helper intentionally does not install or bundle Playwright. If
`@playwright/test` is unavailable, use the project's approved screenshot tooling
or ask for a project setup decision before adding dependencies. Do not pass
passwords as command-line arguments; use storage state or environment-variable
options so secrets do not appear in process listings or command logs.

## Common Mistakes

| Mistake                               | Fix                                                           |
| ------------------------------------- | ------------------------------------------------------------- |
| Screenshot from manual browser/window | Use Playwright and wait for proof text/selectors              |
| Wrong/stale server instance           | Run the approved readiness command immediately before capture |
| Screenshot saved under `.tmp/`        | Save/update a committed reference under `docs/screenshots/`   |
| Issue-number screenshot filename      | Use a stable semantic filename future changes can update      |
| Missing committed screenshot          | Commit the reference screenshot before returning final JSON   |
| Missing final JSON evidence           | Add `visualEvidence` to the final `pr-created` result         |
| Treating screenshot as validation     | Still run required validation commands separately             |

## Red Flags

Stop if you are about to write:

- “I’ll just take a quick screenshot manually.”
- “I’ll save it under `.tmp/`; Patchmill will upload it.”
- “I’ll name it `issue-42-after.png`.”
- “The screenshot exists, so Patchmill will find it automatically.”
- “The UI changed, but I’ll omit `visualEvidence`.”
