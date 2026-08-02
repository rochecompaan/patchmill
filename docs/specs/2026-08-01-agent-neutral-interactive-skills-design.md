# Agent-neutral interactive skills design

## Context

PR 132 added four human-invoked skills and
`site/src/content/docs/using-patchmill/interactive-skills.md`. The packaged
skill bodies use generic repository, filesystem, Git, `patchmill`, GitHub
(`gh`), and Forgejo (`tea`) operations, but each core contract currently says it
may run only in a human-controlled Pi session. That guard contradicts the
intended coding-agent-neutral guide even though no other skill behavior depends
on a Pi API, environment variable, filesystem path, or tool.

The packaged skill directories can be installed and invoked by a coding agent
that supports compatible user-global Agent Skills and provides the tools needed
by the selected Patchmill provider. Pi remains a concrete supported example, not
a universal runtime requirement.

## Goal

Make the four interactive skill contracts and their guide coding-agent-neutral
without weakening human authorization, interactive-only execution, mutation
safety, or the existing Patchmill workflow.

## Compatibility boundary

A compatible environment must:

- run the skill in a human-controlled interactive coding-agent session;
- support user-global skills compatible with the packaged `SKILL.md` format;
- provide filesystem and Git access plus the configured provider CLI and
  `patchmill` command when the selected skill requires them; and
- expose configured project-local skills such as `patchmill-planning` and its
  required siblings when `patchmill-plan` uses them.

Compatibility does not mean every coding agent is tested or documented. The
active agent owns skill installation and invocation syntax.

## Scope

Update the four packaged contracts:

- `skills/patchmill-plan/SKILL.md`;
- `skills/patchmill-upload/SKILL.md`;
- `skills/patchmill-label/SKILL.md`; and
- `skills/patchmill-cleanup/SKILL.md`.

Replace only their Pi-specific activation guard with this shared contract:

> Use only in a human-controlled interactive coding-agent session; stop in
> print-only, RPC, unattended, or automated contexts.

Keep each frontmatter description agent-neutral and preserve every other
planning, publication, label, cleanup, authorization, context-resolution,
untrusted-input, retry, and verification rule.

Update the interactive-skills documentation to:

- describe all four skills as human-invoked, user-global coding-agent skills;
- tell users to expose the packaged directories through their coding agent's
  user-global skill mechanism;
- label `~/.pi/agent/skills/` as a Pi-specific installation example;
- explain that invocation syntax depends on the active coding agent;
- retain Pi's `/skill:...` commands as labeled concrete examples; and
- explain that abbreviated `/patchmill-*` handoff text names the next skill and
  maps to Pi's stock command syntax only when Pi is active.

The handoff text is not a universal executable command. A non-Pi agent must
render or invoke the named skill using its own supported syntax.

## Preserved behavior

The existing authorization boundaries, review-first handoffs, explicit issue
number precedence, same-conversation issue reuse, upload and label semantics,
untrusted-input handling, cleanup warnings, destructive confirmation, and
uncertain-result retry rules remain unchanged.

The skills remain npm-shipped user-global resources. They remain absent from
Patchmill's recommended project skill pack, project initialization, skill
updates, unattended resource profiles, and Patchmill workflow configuration.

## Non-goals

- Document or certify every coding agent.
- Maintain an agent-by-agent installation or command matrix.
- Add an installer or automatic coding-agent configuration.
- Add runtime adapters, new tools, dependencies, Patchmill commands, or workflow
  configuration.
- Change provider support or replace the existing `gh` and `tea` commands.
- Make the four skills safe for print-only, RPC, unattended, or automated use.

## Verification

Treat each skill edit as a writing-skills RED-GREEN-REFACTOR cycle and complete
one skill before editing the next:

1. run five fresh no-guidance interactive controls and save verbatim output;
2. run five fresh controls using the current skill in a compatible non-Pi,
   human-controlled interactive context and verify the Pi-only guard causes the
   expected RED refusal;
3. make only the shared activation-guard change;
4. run five fresh compatible-agent interactive controls and verify the skill no
   longer refuses solely because the agent is not Pi;
5. run five fresh unattended controls with the revised skill and verify it still
   stops; and
6. verify formatting, Markdown lint, a 500-word maximum, direct skill loading,
   and the focused diff before committing that skill.

After all four cycles:

- verify all four revised skills load together;
- audit the four complete skill bodies for remaining Pi runtime dependencies;
- verify npm packaging includes them while project skill-pack configuration and
  live references remain user-global-only;
- run repository Markdown and formatting checks;
- build the production site and verify the interactive-skills route;
- run the existing test suite; and
- review the complete diff against the preserved safety contracts.

Do not add an automated test that merely asserts skill or documentation text.
Pressure-test evidence belongs under `/tmp`, not in git.
