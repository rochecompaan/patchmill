# Third-Party Notices

Patchmill vendors the following third-party components:

## Anthropic frontend-design

- Repository: <https://github.com/anthropics/skills>
- Commit: `41bbe19d1a1a7eaab5e7bb9050a417e5c6cffc8f`
- Source files: `skills/frontend-design/SKILL.md` and
  `skills/frontend-design/LICENSE.txt`
- Packaged path: `skills/frontend-design/`
- Installed path: `.patchmill/skills/frontend-design/`
- License: Apache-2.0, from the pinned `skills/frontend-design/LICENSE.txt`
- Purpose: Specification-time frontend design guidance.
- Modification status: Both files remain verbatim.

## Vercel web-design-guidelines reference

- Repository: <https://github.com/vercel-labs/agent-skills>
- Commit: `ba46938889d4e58635362fb8f618e1178ac3ec46`
- Source file: `skills/web-design-guidelines/SKILL.md`
- Packaged path:
  `skills/patchmill-frontend-review/references/upstream-web-design-guidelines.md`
- Installed path:
  `.patchmill/skills/patchmill-frontend-review/references/upstream-web-design-guidelines.md`
- License: MIT, declared in `README.md#license` at the pinned commit.
- Purpose: Provenance for the Patchmill-owned review wrapper.
- Modification status: The reference remains verbatim, with a different
  filename.

The active Patchmill wrapper replaces the runtime fetch with local pinned rules.
The renamed reference is not an active skill.

## Vercel Web Interface Guidelines

- Repository: <https://github.com/vercel-labs/web-interface-guidelines>
- Commit: `e3d624baaf29dc1fc645aff3e38f03e564d2d6b1`
- Source files: `command.md` and `LICENSE`
- Packaged paths:
  `skills/patchmill-frontend-review/references/web-interface-guidelines.md` and
  `skills/patchmill-frontend-review/LICENSE`
- Installed paths:
  `.patchmill/skills/patchmill-frontend-review/references/web-interface-guidelines.md`
  and `.patchmill/skills/patchmill-frontend-review/LICENSE`
- License: MIT, from the pinned `LICENSE` file.
- Purpose: Offline rules for independent frontend review.
- Modification status: Both files remain verbatim.

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

Patchmill includes these lightweight wrappers:

- `skills/patchmill-planning` references the installed sibling Superpowers
  `brainstorming` and `writing-plans` skills.
- `skills/patchmill-implementation` references the installed sibling Superpowers
  `executing-plans` and `subagent-driven-development` skills.

The wrappers add Patchmill worktree, artifact, result, and testing-policy rules.
The upstream Superpowers skills remain installed from the pinned dependency
rather than vendored as modified copies in Patchmill's package.

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

- Source: `http-cache-semantics@4.3.0` from the npm registry
- Repository: <https://github.com/kornelski/http-cache-semantics>
- License: BSD 2-Clause (`vendor/http-cache-semantics/LICENSE`)
- Security patch: <https://github.com/kornelski/http-cache-semantics/pull/58>
- Purpose: Prevents client cache directives from bypassing response security
  restrictions in Astro's site cache policy.

The local copy retains the upstream version and includes the security patch.
`vendor/http-cache-semantics/README.md` records the exact source, patch, tests,
and removal conditions.
