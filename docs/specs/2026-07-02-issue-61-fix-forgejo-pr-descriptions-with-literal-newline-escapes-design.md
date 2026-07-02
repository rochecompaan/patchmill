# Forgejo PR Description Newline Safety Design

## Goal

Ensure Patchmill PR fallback instructions produce Forgejo pull request
descriptions with real Markdown line breaks instead of literal `\n` escape
sequences.

## Background

`patchmill run-once` currently delegates PR handoff to the implementation agent.
The generated landing contract in `src/cli/commands/run-once/prompts.ts` tells
the agent to push the branch, open a pull request with the repository's
configured host tooling, and include `Closes #<issue>` in the PR body. It does
not specify how to pass multiline Markdown to that host tooling.

Forgejo/Gitea's installed `tea pulls create` supports `--description string` but
not `--description-file`. If an agent constructs the argument with text such as
`Summary\n- item\n\n## Validation`, `tea` receives literal backslash+n
characters and Forgejo renders one large paragraph. The safe path is to provide
an argument containing actual newline characters, for example by writing the PR
body to a temporary file and expanding it with `"$(cat "$file")"`.

GitHub's `gh pr create` behavior must remain compatible. GitHub supports safe
multiline body paths such as `--body-file`, so the Forgejo-specific guidance
should not force GitHub agents onto an inferior command.

## Requirements

- Forgejo PR fallback guidance must require a multiline-safe body construction
  path for `tea pulls create`.
- The PR body must preserve headings, blank lines, bullet lists, and
  `Closes #<issue-number>` as real Markdown lines.
- Agents must be told not to pass Markdown containing literal `\n` escape text
  as the `tea --description` value.
- GitHub PR fallback guidance must remain valid and must not remove existing
  host-tooling flexibility.
- The design should avoid adding a larger host-provider PR creation API in this
  issue unless implementation proves prompt-only guidance cannot satisfy the
  acceptance criteria.
- Issue titles, bodies, labels, comments, authors, and metadata remain untrusted
  input. Only trusted workflow metadata such as the numeric issue number may be
  interpolated into prompt text.

## Proposed behavior

### Prompt-level fix

Update `renderPrCreationInstruction()` in `src/cli/commands/run-once/prompts.ts`
so every PR fallback path includes explicit multiline-safe guidance:

- Push the branch to the configured remote as today.
- Open a PR with the repository's configured host tooling as today.
- Include `Closes #<issue-number>` in the PR description/body as today.
- For Forgejo/Gitea through `tea`, write the Markdown PR description to a temp
  file or here-doc first, then pass actual newline characters to
  `tea pulls create --description "$(cat "$file")"`.
- Do not use inline strings containing literal `\n` escape sequences for the PR
  body.
- For GitHub through `gh`, continue using a multiline-safe supported path such
  as `--body-file`.

The prompt should include a compact example body shape so tests can lock in the
required formatting:

```md
Summary

- Implemented change summary.

## Validation

- npm test

## Reviews

- Review completed.

Closes #42
```

The example is illustrative; agents may adapt the summary, validation, and
review details to the actual implementation.

### Why not add a host helper now

Patchmill's current run-once architecture asks the implementation agent to make
the PR and then return the PR URL. Adding a first-class host-provider PR
creation helper would require a broader contract change: Patchmill would need to
collect or synthesize the final PR title/body, create the PR after
implementation, parse host responses, and alter the `pr-created` handoff flow.
That may be worthwhile later, but it is larger than this bug fix. The immediate
regression is caused by missing CLI argument guidance, and a prompt-level
deterministic temp-file path addresses it without changing handoff semantics.

If the prompt-only fix later proves unreliable, a follow-up design should add a
provider-owned PR creation abstraction for both `forgejo-tea` and `github-gh`.

## Affected components

- `src/cli/commands/run-once/prompts.ts`
  - Extend `renderPrCreationInstruction()` with multiline-safe PR body guidance.
  - Keep the existing remote and `Closes #<issue-number>` interpolation.
- `src/cli/commands/run-once/prompts.test.ts`
  - Update existing PR fallback assertions for the longer instruction.
  - Add a regression assertion that the generated implementation prompt includes
    Forgejo `tea` guidance using a temp file plus `--description "$(cat ...)"`.
  - Assert the prompt includes a multiline Markdown PR body example containing a
    heading, bullets, blank lines, and `Closes #42`.
  - Assert the guidance warns against literal `\n` PR body strings.
  - Keep or add coverage that GitHub-compatible wording remains present, for
    example by allowing `gh pr create --body-file` or equivalent host tooling.
- `src/cli/commands/run-once/pipeline.test.ts`
  - Update any prompt snapshot/regex expectations that match the previous PR
    fallback sentence.

No package metadata or npm dependency changes are expected.

## Verification strategy

Run focused prompt and run-once pipeline tests:

```sh
node --test src/cli/commands/run-once/prompts.test.ts src/cli/commands/run-once/pipeline.test.ts
```

Run the full test suite before merge:

```sh
npm test
```

Manual verification in a disposable Forgejo repository should process an issue
through PR fallback and inspect the created PR body. Expected result: Forgejo
renders separate Markdown lines for `Summary`, `## Validation`, bullet items,
`## Reviews`, and `Closes #<issue>`, with no visible literal `\n` sequences.

Because dependencies do not change, the Nix build is not required unless the
implementation unexpectedly edits `package.json`, `package-lock.json`, or
`npm-shrinkwrap.json`.
