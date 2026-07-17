# Third-Party Notices

Patchmill vendors the following third-party component:

## agent-stuff `extensions/todos.ts`

- Source:
  <https://github.com/mitsuhiko/agent-stuff/blob/main/extensions/todos.ts>
- Repository: <https://github.com/mitsuhiko/agent-stuff>
- License: Apache License 2.0 (`LICENSE`)
- Purpose: Provides the file-backed Pi `todo` extension used by Patchmill's
  issue-agent workflow.

The vendored copy is stored at `extensions/todos.ts` and carries its own SPDX
and modification notice.

## Superpowers skill wrappers

- Source: <https://github.com/obra/superpowers/tree/v6.0.3/skills>
- Repository: <https://github.com/obra/superpowers>
- License: MIT License (`node_modules/superpowers/LICENSE`)
- Purpose: Provides the upstream workflow skills that Patchmill references from
  project-local wrapper skills.

Patchmill includes `skills/patchmill-planning`, a lightweight wrapper that
instructs agents to read the installed sibling Superpowers `brainstorming` and
`writing-plans` skills, then apply Patchmill-specific worktree,
artifact-location, and testing-policy guidance. The upstream Superpowers skills
remain installed from the pinned dependency rather than vendored as modified
copies in Patchmill's package.
