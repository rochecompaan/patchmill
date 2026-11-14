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

- Source: <https://github.com/obra/superpowers/tree/v7.0.2/skills>
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

## Matt Pocock engineering skills

- Repository: <https://github.com/mattpocock/skills>
- Package: `mattpocock-skills`, version `1.3.2`
- Commit: `5863806dd4e15c63174bee4e7515a4256792ecfa`
- Source directories: `skills/engineering/domain-modeling/` and
  `skills/engineering/codebase-design/`
- Installed directories: `.patchmill/skills/domain-modeling/` and
  `.patchmill/skills/codebase-design/`
- License: MIT, from `node_modules/mattpocock-skills/LICENSE`
- Purpose: Domain modeling, architectural specification analysis, and fresh
  codebase-backed Plan review.
- Modification status: Selected skill trees remain verbatim, including their
  supporting resources. The installer also copies the upstream root `LICENSE`
  into each installed skill directory and records its hash.

Both skills come from one immutable production dependency archive. Planning uses
the installed files without runtime downloads.

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

## Atkinson Hyperlegible fonts

The bundled WOFF2 files preserve the upstream versions recorded in the serve
specification.

```text
Copyright 2020-2024 The Atkinson Hyperlegible Next Project Authors (https://github.com/googlefonts/atkinson-hyperlegible-next)

This Font Software is licensed under the SIL Open Font License, Version 1.1.
This license is copied below, and is also available with a FAQ at:
https://openfontlicense.org


-----------------------------------------------------------
SIL OPEN FONT LICENSE Version 1.1 - 26 February 2007
-----------------------------------------------------------

PREAMBLE
The goals of the Open Font License (OFL) are to stimulate worldwide
development of collaborative font projects, to support the font creation
efforts of academic and linguistic communities, and to provide a free and
open framework in which fonts may be shared and improved in partnership
with others.

The OFL allows the licensed fonts to be used, studied, modified and
redistributed freely as long as they are not sold by themselves. The
fonts, including any derivative works, can be bundled, embedded,
redistributed and/or sold with any software provided that any reserved
names are not used by derivative works. The fonts and derivatives,
however, cannot be released under any other type of license. The
requirement for fonts to remain under this license does not apply
to any document created using the fonts or their derivatives.

DEFINITIONS
"Font Software" refers to the set of files released by the Copyright
Holder(s) under this license and clearly marked as such. This may
include source files, build scripts and documentation.

"Reserved Font Name" refers to any names specified as such after the
copyright statement(s).

"Original Version" refers to the collection of Font Software components as
distributed by the Copyright Holder(s).

"Modified Version" refers to any derivative made by adding to, deleting,
or substituting -- in part or in whole -- any of the components of the
Original Version, by changing formats or by porting the Font Software to a
new environment.

"Author" refers to any designer, engineer, programmer, technical
writer or other person who contributed to the Font Software.

PERMISSION & CONDITIONS
Permission is hereby granted, free of charge, to any person obtaining
a copy of the Font Software, to use, study, copy, merge, embed, modify,
redistribute, and sell modified and unmodified copies of the Font
Software, subject to the following conditions:

1) Neither the Font Software nor any of its individual components,
in Original or Modified Versions, may be sold by itself.

2) Original or Modified Versions of the Font Software may be bundled,
redistributed and/or sold with any software, provided that each copy
contains the above copyright notice and this license. These can be
included either as stand-alone text files, human-readable headers or
in the appropriate machine-readable metadata fields within text or
binary files as long as those fields can be easily viewed by the user.

3) No Modified Version of the Font Software may use the Reserved Font
Name(s) unless explicit written permission is granted by the corresponding
Copyright Holder. This restriction only applies to the primary font name as
presented to the users.

4) The name(s) of the Copyright Holder(s) or the Author(s) of the Font
Software shall not be used to promote, endorse or advertise any
Modified Version, except to acknowledge the contribution(s) of the
Copyright Holder(s) and the Author(s) or with their explicit written
permission.

5) The Font Software, modified or unmodified, in part or in whole,
must be distributed entirely under this license, and must not be
distributed under any other license. The requirement for fonts to
remain under this license does not apply to any document created
using the Font Software.

TERMINATION
This license becomes null and void if any of the above conditions are
not met.

DISCLAIMER
THE FONT SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,
EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO ANY WARRANTIES OF
MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT
OF COPYRIGHT, PATENT, TRADEMARK, OR OTHER RIGHT. IN NO EVENT SHALL THE
COPYRIGHT HOLDER BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY,
INCLUDING ANY GENERAL, SPECIAL, INDIRECT, INCIDENTAL, OR CONSEQUENTIAL
DAMAGES, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING
FROM, OUT OF THE USE OR INABILITY TO USE THE FONT SOFTWARE OR FROM
OTHER DEALINGS IN THE FONT SOFTWARE.


Copyright 2020-2024 The Atkinson Hyperlegible Mono Project Authors (https://github.com/googlefonts/atkinson-hyperlegible-next-mono)

This Font Software is licensed under the SIL Open Font License, Version 1.1.
This license is copied below, and is also available with a FAQ at:
https://openfontlicense.org


-----------------------------------------------------------
SIL OPEN FONT LICENSE Version 1.1 - 26 February 2007
-----------------------------------------------------------

PREAMBLE
The goals of the Open Font License (OFL) are to stimulate worldwide
development of collaborative font projects, to support the font creation
efforts of academic and linguistic communities, and to provide a free and
open framework in which fonts may be shared and improved in partnership
with others.

The OFL allows the licensed fonts to be used, studied, modified and
redistributed freely as long as they are not sold by themselves. The
fonts, including any derivative works, can be bundled, embedded,
redistributed and/or sold with any software provided that any reserved
names are not used by derivative works. The fonts and derivatives,
however, cannot be released under any other type of license. The
requirement for fonts to remain under this license does not apply
to any document created using the fonts or their derivatives.

DEFINITIONS
"Font Software" refers to the set of files released by the Copyright
Holder(s) under this license and clearly marked as such. This may
include source files, build scripts and documentation.

"Reserved Font Name" refers to any names specified as such after the
copyright statement(s).

"Original Version" refers to the collection of Font Software components as
distributed by the Copyright Holder(s).

"Modified Version" refers to any derivative made by adding to, deleting,
or substituting -- in part or in whole -- any of the components of the
Original Version, by changing formats or by porting the Font Software to a
new environment.

"Author" refers to any designer, engineer, programmer, technical
writer or other person who contributed to the Font Software.

PERMISSION & CONDITIONS
Permission is hereby granted, free of charge, to any person obtaining
a copy of the Font Software, to use, study, copy, merge, embed, modify,
redistribute, and sell modified and unmodified copies of the Font
Software, subject to the following conditions:

1) Neither the Font Software nor any of its individual components,
in Original or Modified Versions, may be sold by itself.

2) Original or Modified Versions of the Font Software may be bundled,
redistributed and/or sold with any software, provided that each copy
contains the above copyright notice and this license. These can be
included either as stand-alone text files, human-readable headers or
in the appropriate machine-readable metadata fields within text or
binary files as long as those fields can be easily viewed by the user.

3) No Modified Version of the Font Software may use the Reserved Font
Name(s) unless explicit written permission is granted by the corresponding
Copyright Holder. This restriction only applies to the primary font name as
presented to the users.

4) The name(s) of the Copyright Holder(s) or the Author(s) of the Font
Software shall not be used to promote, endorse or advertise any
Modified Version, except to acknowledge the contribution(s) of the
Copyright Holder(s) and the Author(s) or with their explicit written
permission.

5) The Font Software, modified or unmodified, in part or in whole,
must be distributed entirely under this license, and must not be
distributed under any other license. The requirement for fonts to
remain under this license does not apply to any document created
using the Font Software.

TERMINATION
This license becomes null and void if any of the above conditions are
not met.

DISCLAIMER
THE FONT SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,
EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO ANY WARRANTIES OF
MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT
OF COPYRIGHT, PATENT, TRADEMARK, OR OTHER RIGHT. IN NO EVENT SHALL THE
COPYRIGHT HOLDER BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY,
INCLUDING ANY GENERAL, SPECIAL, INDIRECT, INCIDENTAL, OR CONSEQUENTIAL
DAMAGES, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING
FROM, OUT OF THE USE OR INABILITY TO USE THE FONT SOFTWARE OR FROM
OTHER DEALINGS IN THE FONT SOFTWARE.
```
