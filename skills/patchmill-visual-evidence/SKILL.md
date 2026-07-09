---
name: patchmill-visual-evidence
description:
  Use when Patchmill run-once changes visible UI and needs screenshot evidence
  in the final pr-created JSON.
---

# Patchmill Visual Evidence

## Overview

Visual evidence is a Patchmill handoff artifact. Capture screenshots from the
approved running app, save them in the issue worktree, and return structured
metadata so Patchmill can upload and comment on the PR.

## Patchmill Contract

When the issue changes visible UI, the final `pr-created` JSON must include
`visualEvidence`:

```json
"visualEvidence": [
  {
    "screenshotPath": ".tmp/issue-42-after.png",
    "caption": "Visible UI state after the change",
    "referencePaths": ["docs/screenshots/baseline.png"]
  }
]
```

Rules:

- `screenshotPath` is required and must point to a real `.png`, `.jpg`, `.jpeg`,
  `.gif`, or `.webp` file inside the worktree.
- Save generated screenshots under `.tmp/` unless project instructions specify
  another ignored temp path.
- `caption` should describe the visible state proved by the screenshot.
- `referencePaths` should list committed baseline/reference screenshots used for
  comparison when available.
- Omit `visualEvidence` when the issue does not change visible UI.
- Do not upload or comment on PR evidence manually; Patchmill handles that after
  the final result.

## Required Pattern

1. **Use the approved app instance.** Run the project's readiness command or use
   the prepared development environment. Do not start ad-hoc servers when
   project rules forbid them.
2. **Use Playwright/browser automation.** Do not use OS/window screenshots
   unless the user explicitly asks.
3. **Wait for proof conditions.** Require visible text or selectors that
   demonstrate the changed UI before capturing.
4. **Save the image under `.tmp/`.** Ensure the file exists before returning the
   final JSON.
5. **Return `visualEvidence`.** The screenshot is evidence only if the final
   `pr-created` JSON references it.

## Helper Script

Use the bundled helper when the project has `@playwright/test` available.
Resolve `scripts/capture-visual-evidence.cjs` relative to this skill's
`SKILL.md` file, then run it from the issue worktree:

```bash
node /absolute/path/to/patchmill-visual-evidence/scripts/capture-visual-evidence.cjs \
  --url "$URL" \
  --output .tmp/issue-42-after.png \
  --wait-text "Changed label"
```

Options:

| Need                | Option                                                               |
| ------------------- | -------------------------------------------------------------------- |
| Readiness check     | `--ready-command 'just tilt-ready'`                                  |
| Viewport            | `--viewport 1366x900`                                                |
| Visible text        | `--wait-text 'Changed label'` repeated as needed                     |
| Selector            | `--wait-selector '[data-testid="changed-panel"]'` repeated as needed |
| Login redirect      | `--login-username USER --login-password PASS`                        |
| Viewport screenshot | `--no-full-page`                                                     |

The helper intentionally does not install or bundle Playwright. If
`@playwright/test` is unavailable, use the project's approved screenshot tooling
or ask for a project setup decision before adding dependencies.

## Common Mistakes

| Mistake                               | Fix                                                           |
| ------------------------------------- | ------------------------------------------------------------- |
| Screenshot from manual browser/window | Use Playwright and wait for proof text/selectors              |
| Wrong/stale server instance           | Run the approved readiness command immediately before capture |
| Screenshot saved outside the worktree | Save under `.tmp/` inside the issue worktree                  |
| Manual PR upload/comment              | Return `visualEvidence`; Patchmill uploads/comments           |
| Missing final JSON evidence           | Add `visualEvidence` to the final `pr-created` result         |
| Treating screenshot as validation     | Still run required validation commands separately             |

## Red Flags

Stop if you are about to write:

- “I’ll just take a quick screenshot manually.”
- “I’ll upload the screenshot to the PR myself.”
- “The screenshot exists, so Patchmill will find it automatically.”
- “The UI changed, but I’ll omit `visualEvidence`.”
