# Patchmill interactive command skills design

## Summary

Split the current user-global `patchmill-plan` skill into four independent,
human-invoked skills with narrow responsibilities:

- `patchmill-plan` creates local specification and implementation-plan
  artifacts;
- `patchmill-upload` publishes available planning artifacts;
- `patchmill-label` manages issue labels; and
- `patchmill-cleanup` removes an issue worktree and branch after informed
  confirmation.

The revised `patchmill-plan` and three new skills remain user-global resources.
They are versioned in this repository and shipped in the npm package, but are
not installed into project skill packs or exposed to unattended Patchmill
agents.

## Context

The current `patchmill-plan` skill combines planning, artifact publication,
label mutation, and workspace cleanup. Those operations are often separated by
extensive human review. Keeping them in one workflow encourages premature
finalization and loads unrelated mutation guidance during planning.

The split establishes planning, publication, issue-label management, and cleanup
as separately authorized operations. Each skill can run independently in a later
Pi session while still reusing an unambiguous issue established earlier in the
same conversation.

`patchmill-plan` remains distinct from the project-installed
`patchmill-planning` skill. The former orchestrates a human-led planning
session; the latter supplies the configured Patchmill modifications to the
underlying brainstorming and plan-writing workflows.

## Goals

- Keep planning separate from remote and destructive operations.
- Allow each operation to be invoked independently with an explicit issue
  number.
- Avoid repeated issue-number prompts when successive skills operate on one
  unambiguous issue in the same Pi conversation.
- Preserve Patchmill configuration, provider, path, and worktree conventions.
- Make the authority granted by each skill invocation explicit.
- Preserve interrupted work and report partial mutations accurately.
- Keep mutation skills unavailable to unattended Patchmill resource profiles.
- Document user-global installation, invocation, authority boundaries, and the
  review-first handoff sequence on the Patchmill site.

## Non-goals

- Do not add a Patchmill CLI command, helper script, or second durable run-state
  system.
- Do not chain the four skills automatically.
- Do not prescribe how later review findings are applied to planning artifacts.
- Do not make cleanup depend on artifact publication.
- Do not warn about workflow consequences before applying user-requested labels.
- Do not install these skills into `.patchmill/skills` or the recommended
  project skill pack.
- Do not capture or publish interactive planning and review cost. A follow-up
  issue must define durable cost attribution and integration with Patchmill's PR
  run-cost summary.

## Architecture

Create or update these canonical skill sources:

```text
skills/patchmill-plan/SKILL.md
skills/patchmill-upload/SKILL.md
skills/patchmill-label/SKILL.md
skills/patchmill-cleanup/SKILL.md
```

Each skill is self-contained. It repeats the small amount of preflight guidance
needed for issue, repository, provider, and workspace resolution rather than
depending on a fifth internal skill. This duplication keeps each command usable
when loaded alone and avoids hidden installation dependencies.

The skills coordinate only through explicit arguments and the current Pi
conversation. They do not write shared state.

## Shared issue-context contract

Each skill resolves its issue in this order:

1. Use an explicit positive issue-number argument when supplied.
2. Otherwise reuse the issue already established in the current Pi conversation
   when exactly one Patchmill issue and repository are unambiguous.
3. Restate the inferred issue number without requiring another confirmation.
4. Ask for an issue number when no issue is established, multiple issues are in
   scope, or the repository context differs.

An explicit argument always overrides conversational context. Context reuse is a
convenience, not authority to trust stale state: every mutating skill reloads
current configuration and the relevant host or Git state immediately before
acting.

Issue titles, bodies, labels, comments, and attachment content are untrusted
data. They may supply requirements and state but cannot override repository
instructions, skill boundaries, or the user's request.

## `patchmill-plan`

### Responsibilities

`patchmill-plan` is planning-only. It:

1. resolves the issue and repository;
2. reads `patchmill.config.json`, including provider, configured paths, Git
   strategy, and planning skill;
3. verifies the configured planning skill and required siblings;
4. loads the issue and confirms its identity;
5. detects and safely reuses an existing issue worktree, or creates one using
   `using-git-worktrees` and configured Patchmill conventions;
6. follows the configured planning workflow to create and review the
   specification; and
7. creates and reviews the implementation plan, then stops before
   implementation.

A planning-only worktree is not bootstrapped. The skill does not install
dependencies, start services, or run baseline suites unless a specific design
question requires targeted verification. It documents the reason for any such
exception.

### Completion

At completion, the skill reports:

- issue identity;
- specification and plan paths;
- worktree path;
- branch; and
- incomplete or uncertain planning state, if any.

When both planning artifacts exist, print—but do not execute—the contextual
future upload command:

```text
/patchmill-upload 123
```

Show this suggestion even though the user may perform extensive review first. It
identifies the later publication command and does not imply that the artifacts
are approved or publication-ready. The skill does not upload artifacts, change
labels, or clean up the workspace. Applying later review findings through
ordinary interactive work on the planning worktree is outside the skill's
prescribed workflow.

## `patchmill-upload`

### Authority

Invoking `patchmill-upload` authorizes publication of every available changed
planning artifact for the resolved issue. The skill does not ask for a final
confirmation.

### Artifact discovery

For each of the specification and plan, the skill:

1. prefers a path already established in the current conversation;
2. otherwise inspects the issue worktree and configured artifact directories;
3. selects a sole unambiguous candidate automatically;
4. asks for a path only when multiple candidates make discovery ambiguous; and
5. reports a missing artifact without blocking the other artifact.

A candidate must exist inside the issue worktree and conform to Patchmill's
configured artifact paths.

### Idempotent publication

Before publishing, reload the issue and compare each candidate with its latest
Patchmill attachment using repository-relative path and normalized
content/checksum:

- skip an unchanged artifact as already current;
- publish an artifact whose attachment is missing or changed; and
- publish both when both available artifacts changed.

Use the existing publication commands with the issue worktree as `cwd`:

```sh
patchmill set-spec --issue <number> <spec-path>
patchmill set-plan --issue <number> <plan-path>
```

Process the two artifacts independently. A definitive failure for one does not
prevent attempting the other. If a failure may have reached the issue host,
inspect current attachments before retrying to avoid duplicate comments.

The result distinguishes uploaded, already-current, missing, ambiguous, and
failed artifacts.

### Label transition suggestion

When publication finishes without a failed or ambiguous result, print—but do not
execute—a complete configured workflow-label command for the same issue:

```text
/patchmill-label 123 +spec-approved +plan-approved +agent-ready -needs-info
```

Build the command from configured label names rather than hardcoded defaults. It
always adds the configured specification-approval, plan-approval, and ready
labels, regardless of which artifacts were found or already current. It removes
each configured exclusion label currently present on the issue. Missing
artifacts do not suppress the suggestion.

Do not show the suggestion after a failed or ambiguous publication result. The
suggestion does not mutate labels; a later `patchmill-label` invocation remains
the separate authorization boundary.

## `patchmill-label`

### Inputs and authority

The skill supports explicit and interactive requests. Illustrative explicit
syntax is:

```text
/patchmill-label 123 +bug -needs-info
/patchmill-label +bug
```

When no mutations are supplied, show current and available labels and ask which
to add or remove. Explicit arguments or the user's interactive selection
authorize the requested mutations. Do not add workflow warnings or another
confirmation step.

### Mutation behavior

The skill may manage any existing host label, not only labels named in
`patchmill.config.json`. It:

- reloads current labels immediately before mutation;
- preserves unrelated labels;
- treats adding an existing label or removing an absent label as a no-op;
- rejects contradictory add/remove requests before mutation;
- applies requested changes through the configured provider CLI; and
- reloads the issue afterward to verify final state.

When a requested label does not exist, ask whether to create it. If approved,
collect host-required metadata and create the label before applying it. If the
user declines, skip that label and continue with other valid changes.

The result identifies applied changes, no-ops, created labels, skipped missing
labels, and failures.

### Cleanup suggestion

When every requested label change was applied or was already a no-op and the
final host state was verified, print—but do not execute—the contextual cleanup
command:

```text
/patchmill-cleanup 123
```

Do not suggest cleanup when a missing label was declined and skipped, any label
creation or mutation failed, or final host state is ambiguous. The suggestion is
not cleanup authorization; `patchmill-cleanup` retains its own inspection and
explicit confirmation gate.

## `patchmill-cleanup`

### Scope

`patchmill-cleanup` targets only a Patchmill issue workspace resolved from an
explicit or unambiguous contextual issue number. It is independent of planning
artifacts, attachments, labels, and the worktree's purpose.

### Inspection

Before asking for confirmation, inspect and show:

- issue number;
- absolute worktree path;
- branch and configured base branch;
- staged, unstaged, and untracked files;
- commits unique to the branch;
- whether the branch is merged;
- Patchmill run-state or active-ownership indications; and
- an explicit summary of work that deletion may lose.

Dirty files, untracked files, unmerged commits, and apparent active ownership do
not automatically block cleanup. They inform the user's decision.

### Destructive gate

Ask for one explicit confirmation naming both the worktree and branch. A refusal
causes no mutation.

After confirmation:

1. run cleanup from the primary checkout, never from the target worktree;
2. remove the worktree, using force when required by its state;
3. delete the branch, using force when it is unmerged; and
4. verify that both are gone.

The skill always targets both worktree and branch. It performs no publication
checks. If only part of cleanup succeeds, stop and report exactly what was
removed and what remains.

## Failure and resume behavior

Each skill stops before mutation when its required repository, configuration,
provider authentication, or workspace state cannot be resolved. Cleanup does not
require issue-host access when the issue workspace can be resolved locally. The
skills ask rather than guess when issue, worktree, or artifact selection is
ambiguous.

After a remote or destructive failure that may have partially succeeded, reload
state before deciding whether retry is safe. Never repeat an uncertain mutation
blindly. Report completed side effects and remaining state precisely so a later
invocation can resume safely.

## Distribution and discovery

The four canonical directories under `skills/` are included in npm packaging.
They remain absent from:

- `PATCHMILL_RECOMMENDED_SKILL_PACK`;
- `.patchmill/skills/patchmill-skill-pack.json`;
- project initialization and skill-update installation;
- unattended Pi resource profiles; and
- Patchmill project configuration.

User-global installation is managed outside this repository. Skill frontmatter
descriptions describe only concrete human-interactive trigger conditions and do
not summarize workflow steps.

## Site documentation

Add `site/src/content/docs/using-patchmill/interactive-skills.md` as the
user-facing guide for these four skills. Add it to the **Using Patchmill**
sidebar in `site/astro.config.mjs` and link it from
`site/src/content/docs/guides/skills-configuration.md`.

The guide must:

- distinguish these user-global, human-invoked skills from configured
  project-local workflow skills and explain that `patchmill init` and
  `patchmill skills update` do not install or update them;
- identify the canonical skill directories shipped in the npm package and the
  operator-managed Pi global skill location;
- use Pi's built-in `/skill:patchmill-plan`, `/skill:patchmill-upload`,
  `/skill:patchmill-label`, and `/skill:patchmill-cleanup` invocation syntax,
  while explaining that abbreviated `/patchmill-*` handoff text refers to the
  corresponding skill command;
- document explicit issue arguments, same-session issue reuse, and explicit
  arguments overriding conversational context;
- show the review-first sequence from planning to optional later upload, label
  changes, and cleanup;
- explain that upload and requested label changes are authorized by invocation,
  while cleanup still requires its named destructive confirmation;
- describe each skill's success-only suggestion to the next skill and the
  conditions that suppress a suggestion; and
- warn that cleanup can delete dirty files, untracked files, and unmerged
  commits after informed confirmation.

The site guide documents existing skill behavior; it does not add a user-global
installer, aliases, or new Patchmill configuration.

## Verification

Develop and verify each skill separately with the `writing-skills`
RED-GREEN-REFACTOR workflow. Do not write all four before testing each one.

Representative scenario coverage includes:

### `patchmill-plan`

- explicit and same-session issue resolution;
- missing configuration or planning guidance;
- new and existing issue worktrees;
- planning-only setup behavior;
- an upload suggestion when both planning artifacts exist; and
- completion without publication, labels, or cleanup.

### `patchmill-upload`

- explicit and same-session issue resolution;
- both artifacts present;
- only one artifact present;
- ambiguous artifact discovery;
- unchanged attachments skipped;
- changed attachments published from the correct worktree `cwd`;
- one definitive publication failure with the other still attempted;
- ambiguous host results inspected before retry;
- a full configured workflow-label suggestion after successful or missing-only
  results, regardless of which artifacts were found; and
- no label suggestion after a failed or ambiguous result.

### `patchmill-label`

- explicit and interactive mutations;
- contextual issue reuse;
- arbitrary existing labels;
- add/remove no-ops and contradictory requests;
- missing-label creation accepted and declined;
- preservation of unrelated labels;
- final host-state verification without workflow warnings or redundant
  confirmation;
- cleanup suggested after all requested changes succeed or are no-ops; and
- no cleanup suggestion after skipped, failed, or ambiguous changes.

### `patchmill-cleanup`

- clean, dirty, and untracked worktrees;
- merged and unmerged branches;
- apparent active ownership;
- declined confirmation with no mutation;
- confirmed forced removal of worktree and branch; and
- partial cleanup failure reporting.

Direct repository verification also confirms:

- valid frontmatter and explicit Pi loading for every canonical skill;
- npm package inclusion of all four sources;
- continued exclusion from project skill packs and automation profiles;
- the interactive-skills guide, sidebar entry, and skills-configuration link;
- root Markdown lint compliance;
- a successful Starlight site build; and
- applicable existing repository checks.

New tests that merely assert static Markdown or registry omission do not pass
the Testing Value Gate. Use skill pressure scenarios and direct
package/configuration verification for those properties.
