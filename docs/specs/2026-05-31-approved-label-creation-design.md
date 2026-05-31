# Approved Label Creation Design

## Goal

Patchmill should remove the manual label-creation burden while preserving user
control over issue-host mutations.

## Current problem

`patchmill doctor` correctly detects missing required labels, but it prints a
long list of host-specific commands and leaves the user to copy, paste, and
rerun them. The host abstraction already exposes label creation, so this is
unnecessary friction during first-run setup and later repair.

## Proposed behavior

### `patchmill init`

After writing `patchmill.config.json` and resolving the configured host, init
should check which required Patchmill labels are missing.

If labels are missing and the session is interactive, init should print the
exact labels it proposes to create, including name and description, then ask for
approval:

```text
Patchmill needs these labels on GitHub via gh:
  agent-ready — Ready for automated agent processing
  needs-info — Needs reporter information or human decision before planning
  ...

Create these labels now? [y/N]
```

If the user approves, init creates the missing labels through the configured
host provider. If the user declines, init should continue and print clear
follow-up guidance:

```text
Skipped label creation.
You can edit label names in patchmill.config.json after init, then run:
  patchmill doctor --fix
```

If no labels are missing, init should say label setup is already satisfied.

Non-interactive init should not mutate labels unless an explicit approval flag
is present.

### `patchmill init --yes`

`--yes` should approve setup-time prompts that are safe and deterministic,
including required label creation. It should still print the labels before
creating them so logs show what changed.

### `patchmill doctor`

Doctor remains read-only by default. When labels are missing, it should stop
printing the full manual command list and instead give the short repair path:

```text
Missing required labels.
Run `patchmill doctor --fix` to review and create them.
You can edit label names in patchmill.config.json before running --fix.
```

### `patchmill doctor --fix`

`--fix` turns the label check into an approved repair action. It should list the
missing labels and prompt before creating them.

### `patchmill doctor --fix --yes`

`--yes` skips the prompt and creates the missing labels. It should still list
the labels in output before mutation.

`--yes` without `--fix` for doctor should be rejected, because read-only doctor
has nothing to approve.

## Boundaries

- Only required Patchmill labels should be created.
- Existing labels should not be edited, renamed, recolored, or deleted.
- Label creation must use the existing `IssueHostProvider.createLabel()`
  abstraction so GitHub and Forgejo behavior stay centralized.
- Failures should identify which label failed and leave subsequent verification
  to `patchmill doctor`.
- Existing read-only doctor behavior remains the default.

## Implementation shape

- Extend doctor args with `fix` and `yes` booleans.
- Extend init args with a `yes` boolean.
- Extract shared label setup logic into a focused module under
  `src/cli/commands/labels/` or similarly narrow location:
  - compute missing labels from host labels and triage policy
  - format labels for review
  - create missing labels after approval
  - return a concise result message
- Wire init to call the shared helper after config creation.
- Wire doctor label check to use the same helper for `--fix` while keeping
  read-only reporting for default doctor.

## Testing strategy

Use TDD.

- Args tests:
  - init parses `--yes`
  - doctor parses `--fix` and `--yes`
  - doctor rejects `--yes` without `--fix`
- Shared label helper tests:
  - formats all labels that will be created
  - creates missing labels only after approval
  - skips creation on decline
  - no-ops when labels already exist
  - reports creation failures with label names
- Init tests:
  - interactive init shows missing labels and creates them after approval
  - declined init prints edit-config-then-doctor-fix guidance
  - non-interactive init does not create labels without `--yes`
  - `init --yes` creates labels and prints them
- Doctor tests:
  - default doctor remains read-only
  - missing label remediation points to `doctor --fix`
  - `doctor --fix` prompts and creates after approval
  - `doctor --fix --yes` creates without prompt
