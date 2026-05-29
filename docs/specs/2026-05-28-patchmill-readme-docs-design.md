# Patchmill README and Docs Clarification Design

## Context

Anthony's first read of the README showed that Patchmill's opening explanation
needs to make the product idea easier to grasp before introducing implementation
machinery. The first impression should not center on Pi or low-level agent
configuration. It should explain Patchmill as a software factory that helps
teams move product work through deliberate stages: intake, specification,
planning, implementation, review, landing, and iteration.

## Goals

- Clarify what Patchmill does from a newcomer's perspective.
- Present Patchmill as a careful software factory, not merely an issue-board
  automation loop.
- Remove first-impression mentions of Pi and defer Pi to
  customization/extensibility sections.
- Make supported issue hosts and provider values explicit near
  first-use/configuration content.
- Briefly explain extensibility concepts that appear in the README, especially
  skills and subagent roles.
- Keep current terminology for `doctor` and `triage`, but explain them through
  practical CLI meaning rather than relying on metaphor.
- Record future documentation work for cost/token control, greenfield workflows,
  and glossary/extensibility depth.

## Non-goals

- Do not implement new Patchmill behavior.
- Do not rename CLI commands such as `doctor` or `triage` in this pass.
- Do not write the full cost-control or greenfield guides now; those are tracked
  as future docs todos.
- Do not hide Pi entirely; explain it later where readers are ready for
  customization and extensibility details.

## README Design

Revise the README opening so it answers "what is this?" in product terms:

- Patchmill is an agent-driven software factory for taking product work from
  issues to reviewed, landed changes.
- It gives every stage of automated development an explicit station: intake,
  readiness sorting, planning, implementation, review, evidence, and landing.
- The user starts by connecting a repository and issue host, running safe checks
  and dry runs, then allowing Patchmill to process one ready issue at a time.
- The user remains in control through labels, dry runs, plans, configured
  skills, run logs, and approval gates.

The README should mention supported issue hosts early: Forgejo/Gitea through
`tea` and GitHub through `gh`. It should avoid presenting Pi in the opening
sections. Pi belongs later as the runtime and customization harness.

## Existing Docs Design

Update existing docs only where they clarify first understanding:

- `docs/providers.md`: keep the provider reference concise and ensure accepted
  `host.provider` values are obvious.
- `docs/configuration.md`: clarify that most repositories can start with a small
  config; accepted providers are `forgejo-tea` and `github-gh`.
- `docs/issue-agent-workflows.md`: preserve workflow detail, but keep
  user-facing framing around product-work stations rather than making Pi the
  first concept.
- `docs/skills.md`: continue to explain customization, including where Pi,
  skills, and subagent roles fit.

## Future Docs Captured as Todos

The following future docs are intentionally not part of this pass:

- Cost and token budget controls.
- Greenfield project workflow.
- Patchmill glossary and extensibility concepts.

## Verification

After editing, run repository documentation checks available in this project, at
minimum markdown lint or README rendering checks if configured, plus the
existing test suite if practical for the documentation-only change.
