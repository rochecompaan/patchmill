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

## Superpowers adapted skills

- Source: <https://github.com/obra/superpowers/tree/v6.0.3/skills>
- Repository: <https://github.com/obra/superpowers>
- License: MIT License (`node_modules/superpowers/LICENSE`)
- Purpose: Provides the upstream starting point for Patchmill-adapted
  project-local workflow skills.

Patchmill vendors adapted copies of the pinned Superpowers `brainstorming`,
`writing-plans`, and `test-driven-development` skills under
`skills/brainstorming`, `skills/writing-plans`, and
`skills/test-driven-development`. The copies preserve the upstream structure and
layer Patchmill-specific worktree, artifact-location, and testing-policy
guidance on top.
