# Patchmill Test Repository Command Design

## Summary

Add a packaged Patchmill command for creating a reusable disposable repository
on a supported issue host. The repository lets users test Patchmill's `init` and
`triage` commands against a greenfield project without pointing Patchmill at a
production repository.

Users should be able to install Patchmill and run the command against the same
issue-host providers Patchmill already supports:

```bash
patchmill setup-test-repo --provider github-gh --repo OWNER/REPO
patchmill setup-test-repo --provider github-gh --repo OWNER/REPO --reset

patchmill setup-test-repo --provider forgejo-tea --repo OWNER/REPO
patchmill setup-test-repo --provider forgejo-tea --repo OWNER/REPO --login LOGIN
patchmill setup-test-repo --provider forgejo-tea --repo OWNER/REPO --login LOGIN --reset
```

The target repository is supplied explicitly on every run as
`--repo OWNER/REPO`. There is no default target and no repository inference.
Setup creates and seeds a public repository on the selected provider. `--reset`
deletes and recreates an existing disposable repository before seeding it with a
project brief, issue prompts, basic labels, and issues.

The reusable source content ships with Patchmill and is copied into the target
demo repository on each setup or reset. This lets users try Patchmill end to end
without cloning the Patchmill source repository, while preserving the project
description and issue prompts for repeated use.

## Goals

- Provide a realistic disposable repository for manually testing
  `patchmill init` and `patchmill triage`.
- Expose the workflow as a packaged CLI command: `patchmill setup-test-repo`.
- Support the issue-host providers Patchmill already supports:
  - `github-gh`: GitHub through `gh`.
  - `forgejo-tea`: Forgejo/Gitea through `tea`.
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
- Require the caller to pass `--provider`; there is no provider inference
  because the repository may not exist yet.
- Allow any supported-host user or organization to reuse the prompts and command
  in a disposable public repository they control.
- Preserve all reusable project description and issue prompt content in the
  Patchmill package.
- Copy the project description and prompts into the seeded demo repository for
  transparency.
- Seed 10–12 natural issues for a small greenfield web app.
- Include mostly ready-to-build issues plus 1–2 deliberately messy issues for
  triage testing.
- Create basic type labels while leaving some issues unlabeled so triage can
  demonstrate classification.

## Non-goals

- Do not provide a default repository target.
- Do not infer the target repository from the current directory, git remote, or
  host CLI context.
- Do not infer the provider from the target repository or current git remote.
- Do not add support for providers Patchmill does not already support.
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

## Provider-Aware Command Shape

Use explicit provider and repository arguments:

```bash
patchmill setup-test-repo --provider github-gh --repo OWNER/REPO
patchmill setup-test-repo --provider forgejo-tea --repo OWNER/REPO
```

Rules:

- `--provider` is required.
- Accepted provider values are `github-gh` and `forgejo-tea`.
- `--repo OWNER/REPO` is required for all providers.
- `OWNER/REPO` is provider-neutral; both `gh` and `tea` use this repository slug
  shape.
- `--login LOGIN` is only meaningful for providers with named-login support.
  `forgejo-tea` uses it to select a `tea` login. `github-gh` ignores named
  logins and uses the active `gh` authentication context, matching the existing
  `github-gh` provider behavior.
- `--reset` is optional and destructive. It deletes and recreates the target
  repository before seeding it.

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
- Missing `labels` means the host issue is created without labels.
- Issue bodies are natural user-facing prompts.
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
patchmill setup-test-repo --provider github-gh --repo OWNER/REPO
patchmill setup-test-repo --provider forgejo-tea --repo OWNER/REPO --login LOGIN
```

The command requires explicit `--provider` and `--repo OWNER/REPO` arguments. It
creates or recreates the target repository as public on the selected provider.
There is no default repository target.

Examples:

```bash
patchmill setup-test-repo --provider github-gh --repo rochecompaan/patchmill-test --reset
patchmill setup-test-repo --provider forgejo-tea --repo demo-org/patchmill-test --login forgejo-demo --reset
```

The `--reset` flag is required for the destructive delete/recreate operation. If
`--reset` is omitted and the target repository already exists, the command fails
with instructions to rerun with `--reset` when the caller intends to replace it.

Workflow:

1. Validate the required `--provider` and `--repo OWNER/REPO` arguments.
2. Resolve the setup provider adapter for `github-gh` or `forgejo-tea`.
3. Verify required external tools are available for the selected provider:
   - `git` for all providers.
   - `gh` for `github-gh`.
   - `tea` for `forgejo-tea`.
4. Check provider authentication or login readiness.
5. Determine whether the caller requested `--reset`.
6. If `--reset` is omitted, create the target public repository only when it
   does not already exist.
7. If `--reset` is provided, print the exact target provider, repository, and
   public URL; delete the target repository if it exists; and recreate it as a
   public repository.
8. Create a temporary local git repository.
9. Copy fixture files from the installed Patchmill package into the temporary
   repository.
10. Commit and push `main` to the target repository using a provider-supplied
    git remote URL.
11. Create basic labels through the selected provider.
12. Parse `issues/*.md` and create issues through the selected provider.
13. Print provider-specific next-step commands for manual testing.

Example final output for a GitHub target:

```bash
gh repo clone OWNER/REPO
cd REPO
patchmill init
patchmill triage --dry-run
patchmill triage
```

Example final output for a Forgejo/Gitea target:

```bash
tea clone OWNER/REPO
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
  issue-parser.ts
  issue-parser.test.ts
  main.ts
  main.test.ts
  provider.ts
  provider.test.ts
  providers/
    forgejo-tea.ts
    forgejo-tea.test.ts
    github-gh.ts
    github-gh.test.ts
```

Responsibilities:

- `args.ts`: parse `--provider`, `--repo OWNER/REPO`, `--login`, `--reset`, and
  help output.
- `issue-parser.ts`: parse issue markdown frontmatter and validate titles and
  labels.
- `fixtures.ts`: resolve and validate the bundled fixture directory from the
  installed package.
- `provider.ts`: define the setup-specific provider adapter interface.
- `providers/github-gh.ts`: implement repository lifecycle, labels, issues, git
  remote, and clone instructions through `gh`.
- `providers/forgejo-tea.ts`: implement repository lifecycle, labels, issues,
  git remote, and clone instructions through `tea`.
- `main.ts`: orchestrate setup/reset, fixture copy, git push, label creation,
  issue creation, and final instructions.

Register the command in `src/cli/main.ts` help and dispatch maps.

## Setup Provider Adapter

The existing `IssueHostProvider` interface supports Patchmill operations on an
already-configured repository: list issues, inspect labels, comment, and apply
labels. `setup-test-repo` needs repository lifecycle and issue creation before a
repository has been initialized for Patchmill, so it should use a small
setup-specific adapter rather than forcing lifecycle methods into
`IssueHostProvider`.

The adapter should support:

- `id` and `displayName`, using existing provider IDs.
- `checkCli()` for provider tool/auth readiness.
- `repoExists(owner, repo)`.
- `createPublicRepo(owner, repo)`.
- `deleteRepo(owner, repo)` for reset mode.
- `gitRemoteUrl(owner, repo)` for pushing the seeded commit.
- `publicRepoUrl(owner, repo)` for output and verification.
- `cloneCommand(owner, repo)` for final instructions.
- `createLabel(owner, repo, label)`.
- `createIssue(owner, repo, issue)`.

Provider implementation notes:

- `github-gh` should use `gh` and the active `gh` authentication context,
  matching the existing Patchmill GitHub provider.
- `forgejo-tea` should use `tea` and pass `--login LOGIN` when supplied,
  matching the existing Patchmill Forgejo/Gitea named-login behavior.
- If `tea` lacks a convenient high-level subcommand for a specific lifecycle
  operation, the provider may use `tea api` behind the adapter. Keep those API
  details isolated to `providers/forgejo-tea.ts`.

## Safety and Error Handling

The setup flow requires an explicit provider and target. The reset mode is
intentionally destructive and requires `--reset`.

Safety rules:

- Refuse to run unless `--provider` is provided.
- Refuse unsupported provider IDs.
- Refuse to run unless `--repo OWNER/REPO` is provided.
- Refuse malformed repository names.
- Refuse to infer a target repository from the current directory, git remote, or
  host CLI context.
- Refuse to infer provider from the current directory, git remote, or host CLI
  context.
- Require `--reset` for the destructive delete/recreate operation.
- Print each major step, including every destructive reset step.
- Print the exact provider, target repository, and public URL before deletion.
- Treat a missing repository during reset deletion as acceptable.
- Fail fast when required provider tools are missing.
- Fail when provider authentication/login is unavailable.
- Fail when bundled fixture files are missing.
- Fail when issue frontmatter is invalid.
- Use a temporary directory for git operations.
- Clean up the temporary directory automatically.

Failure recovery is rerunning the command. If the command fails after creation
or recreation, the partially seeded repository may remain on the selected host,
but the next run with `--reset` deletes and recreates it.

## Verification

Implementation verification should include:

- argument parser tests for missing `--provider`, unsupported providers, missing
  `--repo`, malformed repo names, `--login`, `--reset`, and help output,
- issue parser tests for valid issue files, missing titles, optional labels, and
  invalid labels,
- fixture resolution tests proving bundled fixture files can be found,
- setup provider adapter tests for both `github-gh` and `forgejo-tea`,
- orchestration tests using mocked provider adapters for create-only,
  existing-repo-without-reset failure, and reset flows,
- mocked CLI-contract tests for provider commands generated by `github-gh` and
  `forgejo-tea`,
- local validation that all fixture issue files parse,
- package/build verification that fixture files are included in the installable
  package,
- running `patchmill setup-test-repo` against GitHub with an explicit provider,
  repository argument, and `--reset`,
- confirming the public repository exists at the requested GitHub URL,
- confirming the seeded GitHub repository contains the copied project files,
- confirming the expected GitHub labels exist,
- confirming the expected 10–12 GitHub issues exist,
- optional live Forgejo/Gitea verification when a disposable Forgejo/Gitea repo
  and `tea` login are available.

For Patchmill's own live GitHub verification, use:

```bash
patchmill setup-test-repo --provider github-gh --repo rochecompaan/patchmill-test --reset
```

Leave that repository live and seeded on GitHub.

## README Promotion

Update `README.md` so new users can discover the disposable test repository
workflow before pointing Patchmill at production work.

The README should include a short section near the first-use command overview
that explains:

- `patchmill setup-test-repo` creates a disposable greenfield repository on a
  supported issue host with reusable demo prompts and issues.
- This is the recommended way to quickly see Patchmill in action without letting
  it operate on a production repository.
- The target must be an explicit disposable public repository passed as
  `--repo OWNER/REPO`.
- The provider must be explicit, with examples for `github-gh` and
  `forgejo-tea`.
- `--reset` deletes and recreates that repository, so users should only use it
  with a repo they are comfortable losing.
- After setup, users can clone the repo and run `patchmill init`,
  `patchmill triage --dry-run`, and `patchmill triage`.

Example README GitHub command flow:

```bash
patchmill setup-test-repo --provider github-gh --repo OWNER/REPO
gh repo clone OWNER/REPO
cd REPO
patchmill init
patchmill triage --dry-run
```

Example README Forgejo/Gitea command flow:

```bash
patchmill setup-test-repo --provider forgejo-tea --repo OWNER/REPO --login LOGIN
tea clone OWNER/REPO
cd REPO
patchmill init
patchmill triage --dry-run
```

The README should also show the reset form for rerunning the demo from a clean
state:

```bash
patchmill setup-test-repo --provider github-gh --repo OWNER/REPO --reset
patchmill setup-test-repo --provider forgejo-tea --repo OWNER/REPO --login LOGIN --reset
```

## Documentation

Add documentation describing:

- README guidance that promotes `patchmill setup-test-repo` as the safe quick
  start path for trying Patchmill on a disposable repository,
- the purpose of the reusable Patchmill test repository fixture,
- that the target repository should be disposable,
- how to choose a disposable `OWNER/REPO` target,
- how to choose a supported provider,
- how to run `patchmill setup-test-repo --provider github-gh --repo OWNER/REPO`,
- how to run
  `patchmill setup-test-repo --provider forgejo-tea --repo OWNER/REPO --login LOGIN`,
- how to reset an existing disposable repository with `--reset`,
- that `--reset` deletes and recreates the public repository on the selected
  provider,
- where the reusable project brief and issue prompts live in the installed
  package/source tree,
- how to clone the recreated repository for each supported provider,
- how to manually test `patchmill init` and `patchmill triage` afterward.
