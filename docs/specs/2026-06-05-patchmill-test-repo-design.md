# Patchmill Test Repository Design

## Summary

Create a reusable GitHub demo repository at `rochecompaan/patchmill-test` for
testing Patchmill's `init` and `triage` commands against a greenfield project.
The repository is disposable: reset means deleting and recreating it, then
seeding it with a project brief, issue prompts, basic labels, and GitHub issues.

The reusable source content lives in the Patchmill repository and is copied into
the recreated demo repository on each reset. This keeps the live GitHub
repository clean and disposable while preserving the project description and
prompts for repeated use.

## Goals

- Provide a realistic GitHub repository for manually testing `patchmill init`
  and `patchmill triage`.
- Reset the test repository to a clean state by deleting and recreating
  `rochecompaan/patchmill-test`.
- Keep the public repository URL stable:
  `https://github.com/rochecompaan/patchmill-test`.
- Preserve all reusable project description and issue prompt content in the
  Patchmill repository.
- Copy the project description and prompts into the seeded demo repository for
  transparency.
- Seed 10–12 natural GitHub issues for a small greenfield web app.
- Include mostly ready-to-build issues plus 1–2 deliberately messy issues for
  triage testing.
- Create basic type labels while leaving some issues unlabeled so triage can
  demonstrate classification.

## Non-goals

- Do not create a configurable generic repository reset tool.
- Do not support arbitrary GitHub owners or repository names.
- Do not run `patchmill init` from the reset script; running init is part of the
  manual test.
- Do not create or refresh a local clone of `patchmill-test`; print clone
  instructions instead.
- Do not include expected triage outcomes in issue files.
- Do not scaffold a runnable application in the reset repository. The seeded
  issues should drive the app build from an almost empty repository.

## Demo Project

The demo project is **Team Lunch Poll**, a small web application where a team
can create a lunch poll, add restaurant or meal options, vote, and view results.

The recreated repository starts nearly empty. It contains human-facing
documentation and prompt files only. Patchmill agents should be able to build
the project from the seeded issues.

## Fixture Layout

Patchmill owns the reusable fixture content under this project-local directory:

```text
test-fixtures/patchmill-test/
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

The live `patchmill-test` repository receives a copy of `README.md`,
`PROJECT_BRIEF.md`, and the issue prompt files. The Patchmill repository remains
the source of truth.

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

The reset script creates basic type labels before creating issues. Initial
labels should include:

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

## Reset and Seed Workflow

The primary workflow is this Patchmill-local shell script:

```bash
scripts/reset-patchmill-test-repo.sh
```

The script is hardcoded to `rochecompaan/patchmill-test` and always recreates
the repository as public. It does not accept an owner or repository override.

Workflow:

1. Verify required tools are available: `gh`, `git`, and `node`.
2. Delete `rochecompaan/patchmill-test` if it exists.
3. Recreate `rochecompaan/patchmill-test` as a public GitHub repository.
4. Create a temporary local git repository.
5. Copy fixture files into the temporary repository.
6. Commit and push `main` to the recreated GitHub repository.
7. Create basic labels with `gh label create` or `gh api`.
8. Use a small Node helper to parse `issues/*.md` and create GitHub issues.
9. Print next-step commands for manual testing.

Example final output:

```bash
gh repo clone rochecompaan/patchmill-test
cd patchmill-test
patchmill init
patchmill triage --dry-run
patchmill triage
```

## Node Helper

Use a small Node helper for parsing issue markdown files and producing
predictable issue creation commands or JSON records. The helper owns:

- frontmatter parsing,
- validation of required `title`,
- validation that `labels`, when present, is an array of strings,
- preserving issue body markdown exactly after the frontmatter,
- deterministic ordering by filename.

The shell wrapper owns destructive GitHub lifecycle operations and calls the
helper during issue creation.

## Safety and Error Handling

The reset flow is intentionally destructive but narrowly scoped.

Safety rules:

- Refuse to operate on any repository other than hardcoded
  `rochecompaan/patchmill-test`.
- Print each major destructive step.
- Treat a missing repository during deletion as acceptable.
- Fail fast when `gh`, `git`, or `node` is missing.
- Fail when fixture files are missing.
- Fail when issue frontmatter is invalid.
- Use a temporary directory for git operations.
- Clean up the temporary directory automatically.

Failure recovery is rerunning the reset script. If the script fails after
recreation, the partially seeded repository may remain on GitHub, but the next
run deletes and recreates it.

## Verification

Implementation verification should include:

- parser/helper tests for valid issue files, missing titles, optional labels,
  and invalid labels,
- local validation that all fixture issue files parse,
- running the reset script against GitHub,
- confirming the public repository exists at
  `https://github.com/rochecompaan/patchmill-test`,
- confirming the seeded repository contains the copied project files,
- confirming the expected labels exist,
- confirming the expected 10–12 issues exist.

The implementation should leave `rochecompaan/patchmill-test` live and seeded on
GitHub.

## Documentation

Add documentation describing:

- the purpose of `patchmill-test`,
- that the repository is disposable,
- how to run the reset/seed script,
- that the script deletes and recreates the public GitHub repository,
- where the reusable project brief and issue prompts live,
- how to clone the recreated repository,
- how to manually test `patchmill init` and `patchmill triage` afterward.
