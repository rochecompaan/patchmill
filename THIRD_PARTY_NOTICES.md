# Third-Party Notices

Patchmill vendors the following third-party components:

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

- Source: <https://github.com/obra/superpowers/tree/v6.3.0/skills>
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

## SimpleEnglish skill

- Source: <https://github.com/AminBlg/SimpleEnglish/tree/v1.2.0/skills>
- Repository: <https://github.com/AminBlg/SimpleEnglish>
- License: MIT License (`node_modules/simple-english/LICENSE`)
- Purpose: Provides the simple-english writing skill that the Patchmill planning
  wrapper applies to spec and plan documents.

The upstream repository ships no npm manifest, so
`scripts/repack-simple-english.mjs` downloads the pinned release tarball,
verifies its sha256, injects a `package.json`, and copies the skill payload to
`vendor/simple-english/`, which package.json depends on as
`file:vendor/simple-english`. The skill files remain unmodified upstream
content.
