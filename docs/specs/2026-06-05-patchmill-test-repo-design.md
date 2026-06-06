# Patchmill Test Repository Command Design

## Summary

Add a packaged Patchmill command for creating a reusable GitHub demo repository
that tests Patchmill's `init` and `triage` commands against a greenfield
project. Users should be able to install Patchmill and run:

```bash
patchmill setup-test-repo --repo OWNER/REPO
patchmill setup-test-repo --repo OWNER/REPO --reset
```

The target repository is supplied explicitly on every run as
`--repo OWNER/REPO`. There is no default target. Setup creates and seeds a
public GitHub repository; `--reset` deletes and recreates an existing disposable
repository before seeding it with a project brief, issue prompts, basic labels,
and GitHub issues.

The reusable source content ships with Patchmill and is copied into the target
demo repository on each setup or reset. This lets users try Patchmill end to end
without cloning the Patchmill source repository, while preserving the project
description and issue prompts for repeated use.

## Goals

- Provide a realistic GitHub repository for manually testing `patchmill init`
  and `patchmill triage`.
- Expose the workflow as a packaged CLI command: `patchmill setup-test-repo`.
- Let users run the demo setup after installing Patchmill, without cloning the
  Patchmill repository.
- Update the README to present `patchmill setup-test-repo` as the quickest safe
  way to see Patchmill in action without running it against a production
  repository.
- Set up a caller-specified public test repository by creating and seeding it.
- Reset a caller-specified test repository to a clean state when `--reset` is
  passed.
- Require the caller to pass `--repo OWNER/REPO`; there is no default target and
  the command never infers a target from the current git remote.
- Allow any GitHub user or organization to reuse the prompts and command in a
  disposable public repository they control.
- Preserve all reusable project description and issue prompt content in the
  Patchmill package.
- Copy the project description and prompts into the seeded demo repository for
  transparency.
- Seed 10–12 natural GitHub issues for a small greenfield web app.
- Include mostly ready-to-build issues plus 1–2 deliberately messy issues for
  triage testing.
- Create basic type labels while leaving some issues unlabeled so triage can
  demonstrate classification.

## Non-goals

- Do not provide a default repository target.
- Do not infer the target repository from the current directory, git remote, or
  GitHub CLI context.
- Do not name the command `patchmill test`; that would be confused with running
  tests for the current project.
- Do not run `patchmill init` from `setup-test-repo`; running init is part of
  the manual test.
- Do not create or refresh a local clone of the target repository; print clone
  instructions instead.
- Do not include expected triage outcomes in issue files.
- Do not scaffold a runnable application in the target repository. The seeded
  issues should drive the app build from an almost empty repository.

## Command Naming

Use:

```bash
patchmill setup-test-repo
```

Rationale:

- `setup-test-repo` describes the user-visible effect: creating a disposable
  test repository for Patchmill.
- The verb `setup` fits a command that creates and seeds a resource.
- The noun `test-repo` avoids implying that Patchmill will run a test suite.
- `patchmill test` is rejected because it is too ambiguous and would likely be
  read as "run Patchmill tests" or "test this repository."

## Demo Project

The demo project is **Team Lunch Poll**, a small web application where a team
can create a lunch poll, add restaurant or meal options, vote, and view results.

The recreated repository starts nearly empty. It contains human-facing
documentation and prompt files only. Patchmill agents should be able to build
the project from the seeded issues.

## Fixture Layout

Patchmill owns the reusable fixture content in a package-included directory:

```text
fixtures/patchmill-test-repo/
  README.md
  PROJECT_BRIEF.md
  issues/
    01-project-scaffold.md
    02-domain-model.md
    03-create-poll-form.md
    04-voting-flow.md
    05-results-view.md
    06-local-persistence.md
    07-validation-empty-states.md
    08-responsive-polish.md
    09-automated-tests.md
    10-readme-docs.md
    11-make-it-social.md
    12-votes-disappear.md
```

The fixture directory must be included in the npm package, for example by adding
`fixtures` to `package.json` `files`. Runtime code should resolve the fixture
path from the installed package root rather than from the caller's current
working directory.

The live test repository receives a copy of `README.md`, `PROJECT_BRIEF.md`, and
the issue prompt files. The Patchmill package remains the source of truth.

## Issue File Format

Each issue is a markdown file with simple frontmatter:

```markdown
---
title: Build the initial Team Lunch Poll app shell
labels: [feature]
---

Issue body...
```

Rules:

- `title` is required.
- `labels` is optional.
- Missing `labels` means the GitHub issue is created without labels.
- Issue bodies are natural user-facing GitHub prompts.
- Issue files do not include expected triage outcomes or hidden evaluator
  metadata.

## Seeded Labels

The command creates basic type labels before creating issues. Initial labels
should include:

- `feature`
- `bug`
- `docs`
- `polish`

Some issues intentionally omit labels so `patchmill triage` can be tested for
adding the `feature` or `bug` labels.

## Initial Issue Set

Seed 10–12 issues. The approved starting set is 12 issues:

1. **Create the Team Lunch Poll app scaffold** — ready feature issue.
2. **Define the poll, option, and vote data model** — ready feature issue.
3. **Build the create-poll form** — ready feature issue.
4. **Add the option voting flow** — ready feature issue.
5. **Show live results and winner state** — ready feature issue.
6. **Persist polls locally** — ready feature issue.
7. **Add validation, empty states, and error states** — ready feature issue.
8. **Improve responsive visual polish** — ready polish issue.
9. **Add automated tests for core poll flows** — ready test/feature issue.
10. **Document setup and usage** — ready docs issue.
11. **Make lunch polls more social** — deliberately vague issue that should
    invite clarification.
12. **Votes sometimes disappear when I refresh** — deliberately underspecified
    bug-like issue, useful for triage because the app does not exist yet.

## Setup and Reset Workflow

The primary workflow is this Patchmill CLI command:

```bash
patchmill setup-test-repo --repo OWNER/REPO
patchmill setup-test-repo --repo OWNER/REPO --reset
```

The command requires an explicit `--repo OWNER/REPO` argument and always creates
or recreates the target repository as public. There is no default repository
target.

Example:

```bash
patchmill setup-test-repo --repo rochecompaan/patchmill-test --reset
```

The `--reset` flag is required for the destructive delete/recreate operation. If
`--reset` is omitted and the target repository already exists, the command fails
with instructions to rerun with `--reset` when the caller intends to replace it.

Workflow:

1. Verify required external tools are available: `gh` and `git`.
2. Validate the required `--repo OWNER/REPO` argument.
3. Determine whether the caller requested `--reset`.
4. If `--reset` is omitted, create the target public repository only when it
   does not already exist.
5. If `--reset` is provided, print the exact target repository and public URL,
   delete the target repository if it exists, and recreate it as a public GitHub
   repository.
6. Create a temporary local git repository.
7. Copy fixture files from the installed Patchmill package into the temporary
   repository.
8. Commit and push `main` to the target GitHub repository.
9. Create basic labels with `gh label create` or `gh api`.
10. Parse `issues/*.md` and create GitHub issues.
11. Print next-step commands for manual testing.

Example final output for the requested target:

```bash
gh repo clone OWNER/REPO
cd REPO
patchmill init
patchmill triage --dry-run
patchmill triage
```

## Implementation Components

Add a new command directory:

```text
src/cli/commands/setup-test-repo/
  args.ts
  args.test.ts
  fixtures.ts
  fixtures.test.ts
  github.ts
  github.test.ts
  issue-parser.ts
  issue-parser.test.ts
  main.ts
  main.test.ts
```

Responsibilities:

- `args.ts`: parse `--repo OWNER/REPO`, `--reset`, and help output.
- `issue-parser.ts`: parse issue markdown frontmatter and validate titles and
  labels.
- `fixtures.ts`: resolve and validate the bundled fixture directory from the
  installed package.
- `github.ts`: wrap `gh` and `git` subprocess operations behind testable
  functions.
- `main.ts`: orchestrate setup/reset, fixture copy, git push, label creation,
  issue creation, and final instructions.

Register the command in `src/cli/main.ts` help and dispatch maps.

## Safety and Error Handling

The setup flow requires an explicit target. The reset mode is intentionally
destructive and requires `--reset`.

Safety rules:

- Refuse to run unless `--repo OWNER/REPO` is provided.
- Refuse malformed repository names.
- Refuse to infer a target repository from the current directory, git remote, or
  GitHub CLI context.
- Require `--reset` for the destructive delete/recreate operation.
- Print each major step, including every destructive reset step.
- Print the exact target repository and public URL before deletion.
- Treat a missing repository during reset deletion as acceptable.
- Fail fast when `gh` or `git` is missing.
- Fail when bundled fixture files are missing.
- Fail when issue frontmatter is invalid.
- Use a temporary directory for git operations.
- Clean up the temporary directory automatically.

Failure recovery is rerunning the command. If the command fails after creation
or recreation, the partially seeded repository may remain on GitHub, but the
next run with `--reset` deletes and recreates it.

## Verification

Implementation verification should include:

- argument parser tests for missing `--repo`, malformed repo names, `--reset`,
  and help output,
- issue parser tests for valid issue files, missing titles, optional labels, and
  invalid labels,
- fixture resolution tests proving bundled fixture files can be found,
- orchestration tests using mocked `gh`/`git` operations for create-only,
  existing-repo-without-reset failure, and reset flows,
- local validation that all fixture issue files parse,
- package/build verification that fixture files are included in the installable
  package,
- running `patchmill setup-test-repo` against GitHub with an explicit repository
  argument and `--reset`,
- confirming the public repository exists at the requested GitHub URL,
- confirming the seeded repository contains the copied project files,
- confirming the expected labels exist,
- confirming the expected 10–12 issues exist.

For Patchmill's own verification, use:

```bash
patchmill setup-test-repo --repo rochecompaan/patchmill-test --reset
```

Leave that repository live and seeded on GitHub.

## README Promotion

Update `README.md` so new users can discover the disposable test repository
workflow before pointing Patchmill at production work.

The README should include a short section near the first-use command overview
that explains:

- `patchmill setup-test-repo` creates a disposable greenfield GitHub repository
  with reusable demo prompts and issues.
- This is the recommended way to quickly see Patchmill in action without letting
  it operate on a production repository.
- The target must be an explicit disposable public repository passed as
  `--repo OWNER/REPO`.
- `--reset` deletes and recreates that repository, so users should only use it
  with a repo they are comfortable losing.
- After setup, users can clone the repo and run `patchmill init`,
  `patchmill triage --dry-run`, and `patchmill triage`.

Example README command flow:

```bash
patchmill setup-test-repo --repo OWNER/REPO
gh repo clone OWNER/REPO
cd REPO
patchmill init
patchmill triage --dry-run
```

The README should also show the reset form for rerunning the demo from a clean
state:

```bash
patchmill setup-test-repo --repo OWNER/REPO --reset
```

## Documentation

Add documentation describing:

- README guidance that promotes `patchmill setup-test-repo` as the safe quick
  start path for trying Patchmill on a disposable repository,
- the purpose of the reusable Patchmill test repository fixture,
- that the target repository should be disposable,
- how to choose a disposable `OWNER/REPO` target,
- how to run `patchmill setup-test-repo --repo OWNER/REPO`,
- how to reset an existing disposable repository with
  `patchmill setup-test-repo --repo OWNER/REPO --reset`,
- that `--reset` deletes and recreates the public GitHub repository,
- where the reusable project brief and issue prompts live in the installed
  package/source tree,
- how to clone the recreated repository,
- how to manually test `patchmill init` and `patchmill triage` afterward.
