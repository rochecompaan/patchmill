# CLI-neutral ownership for shared workflow values

- **Issue:** #156
- **Status:** Proposed design

## Summary

Patchmill will move shared command, issue, label, and workflow-decision
contracts out of CLI command modules and give each concern a focused CLI-neutral
owner. Host, policy, Pi, Issue run, command, and test-support code will import
those canonical owners directly. Existing CLI type modules will retain type-only
compatibility re-exports so current import paths and public value shapes keep
working.

This is an ownership move only. It will not change command execution, issue
selection, label policy, workflow decisions, Pi result interpretation, or any
runtime payload.

## Context

Several cross-cutting values currently appear to belong to command wiring:

- `CommandResult`, `CommandRunOptions`, and `CommandRunner` are defined in the
  triage command's `types.ts`, although Host and Pi code also consume them.
- issue and label records are defined independently in triage and Host types,
  which leaves structurally similar values with more than one owner.
- Pi contracts import Issue run result, resume, issue, and prompt-label values
  from `src/cli/commands/run-once/`.
- `HumanDecisionQuestion` is owned by triage even though Issue run blocker
  results and recovery state also use it.

These dependencies make command file layout look like domain architecture. They
also prevent later Issue run and Pi ownership work from moving cleanly without
either preserving CLI imports or copying contracts again.

## Goals

- Establish one CLI-neutral definition for every shared value in scope.
- Make non-CLI consumers import canonical owners rather than command modules.
- Preserve existing exported type names and structural shapes through
  compatibility re-exports.
- Preserve every discriminant, literal, required field, optional field, and
  readonly/array expectation used by current consumers.
- Keep issue selection, label ordering and mutation, workflow gates, Pi result
  parsing, and command execution observably unchanged.
- Leave a dependency direction suitable for later Issue run and generic Pi
  moves.

## Non-goals

- Moving the run-once lifecycle or generic Pi runtime behavior in this issue;
  behavioral imports of current prompt and Pi execution functions move in later
  architecture work.
- Renaming `run-once`, existing `AgentIssue*` types, result statuses, labels, or
  public fields.
- Redesigning Host, Git, Pi, workflow, or command-runner interfaces.
- Introducing a dependency container, generic context object, or adapter for
  every helper.
- Changing issue selection priority, exclusion, explicit-selection, approval, or
  diagnostic behavior.
- Changing persisted Run recovery state or its decision types unless a type must
  reference a newly neutral shared value.
- Adding runtime validation, serialization, or schema migration for values that
  are currently TypeScript contracts.

## Approaches considered

### Focused neutral owners with compatibility re-exports (chosen)

Create small modules named for the concern they own, update production consumers
to import those modules, and turn old CLI definitions into type-only re-exports.
This gives future code stable dependencies while preserving existing source
import paths.

### One shared `types.ts` module

A single catch-all module would minimize import count, but it would group values
that change for unrelated reasons and become a generic type bag. It is rejected
because it hides rather than clarifies ownership.

### New capability adapters around every consumer

New Host, Git, Pi, or workflow ports could avoid direct imports, but the issue
requires only ownership of existing values. Additional interfaces would be
hypothetical indirection with no new substitution need, so this approach is
rejected.

## Design

### Canonical owners

The implementation will use these focused ownership boundaries:

| Concern                               | Canonical owner             | Values                                                                                                                                                                    |
| ------------------------------------- | --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Command execution contract            | `src/command/types.ts`      | `CommandResult`, `CommandRunOptions`, `CommandRunner`                                                                                                                     |
| Issue and issue-label exchange values | `src/issue/types.ts`        | `IssueCommentSummary`, `IssueSummary`, `LabelDefinition`, `LabelChangePlan`                                                                                               |
| Human workflow decisions              | `src/workflow/decisions.ts` | `HumanDecisionQuestion`                                                                                                                                                   |
| Issue run values shared with Pi       | `src/issue-run/types.ts`    | blocker-question, resume-context, prompt-label, development-environment, visual-evidence, and discriminated Pi result contracts currently shared by run-once and `src/pi` |

`src/issue-run/types.ts` is scoped to the existing Issue run/Pi boundary. It is
not a home for command configuration, progress rendering, pipeline option
objects, persistence helpers, or unrelated shared types.

The ownership move must retain current names for compatibility, including
`AgentIssueImplementationResumeContext`, `AgentIssueBlockerQuestion`,
`PromptTriageLabels`, the existing `AgentIssue*Result` variants, and
`AgentIssuePiResult`. A later architecture change may rename concepts, but this
issue will not combine a naming migration with the dependency move.

### Compatibility boundaries

- `src/cli/commands/triage/types.ts` will keep triage-only values and re-export
  the moved command, issue, label, and human-decision types.
- `src/cli/commands/run-once/types.ts` will keep command-specific configuration,
  selection, pipeline, state, and recovery contracts and re-export shared Issue
  run values required by existing consumers.
- `src/cli/commands/run-once/prompts.ts` will re-export `PromptTriageLabels`
  from its new owner so that the existing prompt-module import path remains
  valid.
- `src/host/types.ts` will keep Host capability interfaces and repository/PR
  values and re-export the canonical issue and label values.
- Existing source paths therefore remain valid, but production code outside
  those compatibility modules will import the canonical owner.
- The neutral owner modules must not import `src/cli`, Host implementations, Pi
  implementations, or command factories.

There will be no duplicate structural definitions behind the compatibility
exports. Re-exports must refer to the canonical type identity so future changes
cannot drift between Host, triage, run-once, and Pi.

### Consumer migration

Imports will move by concern rather than through a new barrel module:

- Host factories/providers, Pi hooks/runner contracts, Git/worktree consumers,
  and test command runners use `src/command/types.ts`.
- Host providers, policy label catalogs, workflow approval policy, triage, and
  run-once selection use `src/issue/types.ts`.
- Triage logs and Issue run blocker values use `src/workflow/decisions.ts`.
- `src/pi/types.ts`, Pi runner tests, run-once prompt/result parsing, and Issue
  run consumers use `src/issue-run/types.ts` for shared Issue run contracts.

CLI-local types that are not shared remain local. The concrete
`createCommandRunner()` implementation remains command wiring; only its existing
contract receives a neutral owner. Existing Host, Git, and Pi capabilities are
reused without wrapping them in new adapters.

### Behavioral compatibility

Because the move changes ownership and imports rather than runtime algorithms:

- `selectIssue()` and `selectIssueWithDiagnostics()` retain current explicit
  selection, blocking-label, approval, priority, and issue-number ordering.
- label catalogs, definitions, deduplication, mutation plans, and workflow label
  transitions retain current names, colors, descriptions, and ordering.
- workflow-state, approval-gate, recovery, and Pi-result unions retain their
  exact discriminants and branch payloads.
- `createCommandRunner()` retains process spawning, streaming, abort-signal,
  environment, working-directory, and result behavior.
- no persisted JSON, prompt JSON, CLI output, error text, or command order
  changes.

## Affected components

- New focused type owners under `src/command/`, `src/issue/`, and
  `src/issue-run/`, plus `src/workflow/decisions.ts`.
- Compatibility exports in triage, run-once, and Host type modules.
- Import updates across `src/host`, `src/pi`, `src/policy`, `src/workflow`, CLI
  commands, and `test-support`.
- Existing selection, label, Host-provider, Pi-runner, prompt/result, and
  command-runner tests as behavior-preservation coverage.

No dependency-file change is expected.

## Verification strategy

Apply the Testing Value Gate: do not add tests that merely assert filenames,
import strings, or re-export syntax. Existing tests already exercise the
meaningful behavior behind these values. Add a focused type-contract test only
if the existing suites and strict TypeScript check cannot prove a public shape
or compatibility path.

Verification will include:

1. Run focused tests for command execution, issue selection/workflow state,
   label catalogs and transitions, Host providers, Pi runner inputs/results, and
   run-once Pi result parsing.
2. Run bounded source scans to confirm neutral owner modules do not import CLI
   code and non-CLI consumers no longer obtain moved values from command type
   modules.
3. Run `npm run check:types` to catch optionality, union, and assignability
   drift under strict TypeScript settings.
4. Run `npm run build` and `npm run lint` as required acceptance checks.
5. Run `npm test` to catch behavior changes outside the focused suites.
6. Confirm the diff contains no runtime label, selection, decision, or
   command-runner logic changes and no duplicate definitions.

If an npm dependency file changes unexpectedly, revert it. If a dependency-file
change becomes necessary, run the Nix build required by `AGENTS.md` before
completion.

## Acceptance mapping

| Acceptance criterion                               | Design response                                                                                                             |
| -------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Shared values have CLI-neutral owners              | Focused command, issue, workflow-decision, and Issue run modules own the canonical definitions.                             |
| Existing consumers use those owners                | Non-CLI and shared consumers import canonical modules; old paths remain compatibility re-exports only.                      |
| Public behavior and shapes remain compatible       | Definitions keep names, fields, discriminants, labels, and algorithms unchanged.                                            |
| No generic dependency bag or hypothetical adapters | Owners are concern-specific and reuse existing capabilities without new ports or context containers.                        |
| Focused tests, build, and lint pass                | Existing behavioral suites, strict type checking, source scans, full tests, build, and lint form the verification contract. |
