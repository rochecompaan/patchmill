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

- Source: <https://github.com/obra/superpowers/tree/v7.0.0/skills>
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

## Site HTTP cache policy

- Source: `http-cache-semantics@4.2.0` from the npm registry
- Repository: <https://github.com/kornelski/http-cache-semantics>
- License: BSD 2-Clause (`vendor/http-cache-semantics/LICENSE`)
- Security patch: <https://github.com/kornelski/http-cache-semantics/pull/58>
- Purpose: Prevents client cache directives from bypassing response security
  restrictions in Astro's site cache policy.

The local copy retains the upstream version and includes the security patch.
`vendor/http-cache-semantics/README.md` records the exact source, patch, tests,
and removal conditions.
