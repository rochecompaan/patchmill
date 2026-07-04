# Issue 65 Artifact Source Resolution Design

## Summary

`patchmill run-once` should inspect the selected issue's body and comments as
first-class workflow artifact source data before it creates new specs or plans.
If an issue already provides an unambiguous spec or plan, Patchmill should reuse
or materialize that artifact instead of generating a duplicate.

Extraction should be prompt-based and delegated to a configurable Patchmill
skill. Patchmill should provide a bundled default artifact-extraction skill that
gives agents practical guidelines for recognizing specs and plans in varied
issue content, including role-prefixed paths, Markdown links, headings, and
`<details>` blocks. Patchmill code should validate and materialize the agent's
structured output; it should not rely on a finicky deterministic extractor as
the primary recognition mechanism.

## Goals

- Resolve provided specs and plans from issue body/comments before creating new
  artifacts.
- Make artifact extraction configurable through Patchmill skills.
- Provide a bundled default artifact-extraction skill for repositories that do
  not configure one.
- Scan issue content regardless of `spec-approved` / `plan-approved` labels and
  regardless of whether the workflow approval policy requires spec or plan
  approval.
- Support both existing repo paths and inline Markdown artifact content.
- Materialize inline specs/plans as deterministic files under configured docs
  directories and commit them as part of the claimed run.
- Preserve existing fallback behavior when the extraction skill reports no
  unambiguous artifact source.
- Keep `--dry-run` cheap by not running artifact-source extraction, validation,
  or materialization.

## Non-goals

- Build a deterministic parser that tries to recognize every supported
  issue-content shape in Patchmill code.
- Fetch remote issue-upload attachments or arbitrary external URLs in v1.
- Replace the existing spec/plan approval workflow.
- Trust issue content as instructions. Issue content remains untrusted input;
  the extraction skill classifies artifact sources only.
- Require a narrow issue template for artifact submission.

## Current behavior

Planning advancement currently resolves artifacts in this order:

1. saved run-state path, if it exists;
2. files under configured `specsDir` or `plansDir` with filenames containing
   `-issue-<number>-`;
3. a generated deterministic output path.

Issue body/comments are included in Pi prompts only after artifact discovery has
already decided whether to create a spec or plan. This means clearly provided
artifacts with non-Patchmill filenames, or inline issue artifacts, can be missed
and duplicated.

## Skill configuration

Add an artifact-extraction workflow skill to `PatchmillSkillsConfig`:

```ts
export type PatchmillSkillsConfig = {
  triage: string;
  planning: string;
  implementation: string;
  artifactExtraction: string;
  developmentEnvironment?: string;
  toolchain?: string;
  review?: string;
  visualEvidence?: string;
  landing?: string;
};
```

Default skill references:

- `DEFAULT_PATCHMILL_SKILLS.artifactExtraction`:
  `patchmill:bundled-artifact-extraction`
- `GLOBAL_PATCHMILL_SKILLS.artifactExtraction`: `patchmill-artifact-extraction`

Add a bundled default skill at `skills/patchmill-artifact-extraction/SKILL.md`
and teach skill resolution how to resolve
`patchmill:bundled-artifact-extraction` to that file, similar to the existing
bundled issue-triage skill.

Repositories can override extraction with a project-local skill, path-like
skill, or namespace-style skill through `patchmill.config.json`:

```json
{
  "skills": {
    "artifactExtraction": ".patchmill/skills/artifact-extraction"
  }
}
```

## Default artifact-extraction skill

The bundled skill should instruct the agent to inspect the full issue body and
comments and return a strict JSON classification. It should emphasize judgment
over template matching: users may provide specs and plans in different but still
unambiguous ways.

The default skill should include recognition guidelines, not implementation
rules for Patchmill code. Examples of source shapes the skill should consider:

- role-prefixed local paths, e.g. `Spec: ./docs/specs/foo.md`;
- Markdown links with role-clear labels or surrounding context, e.g.
  `[spec](docs/specs/foo.md)`;
- inline Markdown under headings such as `Spec`, `Approved Spec`, `Plan`, or
  `Implementation Plan`;
- inline Markdown inside `<details><summary>Spec</summary> ... </details>` and
  matching plan details blocks;
- issue body or comment prose that clearly says a following block is the spec or
  plan.

The default skill should prefer `ambiguous` over guessing. It should return
`none` when no source is provided.

## Extraction prompt and contract

Patchmill should run a dedicated artifact-extraction Pi prompt in execute mode
after issue selection and branch-base safety, but before claiming or mutating
the issue. The prompt should include:

- configured extractor skill reference;
- issue number, title, labels, author, updated time, body, and comments;
- configured `specsDir` and `plansDir`;
- an untrusted issue-content boundary;
- a strict JSON output contract.

The extractor result shape should be:

```json
{
  "status": "resolved",
  "spec": {
    "type": "path",
    "value": "docs/specs/foo.md",
    "evidence": "Spec: ./docs/specs/foo.md"
  },
  "plan": {
    "type": "inline",
    "content": "# Plan\n...",
    "evidence": "<details><summary>Plan</summary>...</details>"
  }
}
```

or:

```json
{ "status": "none" }
```

or:

```json
{
  "status": "ambiguous",
  "reason": "Two possible plan sections were found",
  "candidates": [{ "kind": "plan", "type": "inline", "evidence": "..." }]
}
```

Patchmill should parse only this structured result. It should not infer
additional sources in code when the extractor returns `none`.

## Validation rules

Patchmill validates the extraction skill's output before claim:

- `ambiguous` results fail preflight.
- Malformed extractor JSON fails preflight.
- More than one source for the same artifact kind fails preflight.
- A path source must stay inside the configured directory for that kind.
- A spec source cannot point into `plansDir`; a plan source cannot point into
  `specsDir`.
- A path source must exist locally.
- Inline content must be substantive Markdown.
- If the extractor returns `none`, preserve existing fallback behavior: saved
  run state, filename-based discovery, then generation.

The v1 trust model accepts any issue body/comment as source data when the
extractor returns an unambiguous source and validation passes. Approval labels
remain the workflow gate for public repositories, while private repositories can
submit artifacts with low friction.

## Proposed architecture

Add focused run-once modules:

- `artifact-source-extraction.ts`
  - builds the extraction prompt;
  - invokes Pi with the configured artifact-extraction skill;
  - parses the structured extractor result.
- `artifact-sources.ts`
  - owns artifact-source domain types;
  - validates extracted sources;
  - computes target paths for inline sources;
  - raises typed preflight errors.
- `artifact-source-materialization.ts`
  - writes inline sources to deterministic files;
  - commits materialized files;
  - returns paths and commit SHAs for run state.

This split keeps prompt/skill orchestration, validation, and filesystem/git
effects separate.

## Pipeline integration

Execute-mode sequencing should be:

1. Select the issue as today.
2. Perform the branch-base safety check as today.
3. Hydrate or view the selected issue so full comments are available.
4. Run the configured artifact-extraction skill before worktree-clean checks,
   labels, comments, or run-state writes.
5. Validate the extractor result.
6. If extraction or validation fails, return an error without claiming or
   mutating the issue.
7. Continue with the existing clean-worktree check and claim flow.
8. Post the started comment as today.
9. Materialize inline sources after claim:
   - create deterministic files under configured `specsDir` / `plansDir`;
   - commit only those files with a Conventional Commit message;
   - record resulting paths and commit SHAs in run state.
10. Pass resolved/materialized paths into `advancePlanningStages`.
11. Have `advancePlanningStages` prefer explicit extracted sources before saved
    state, filename-based discovery, or generated paths.

Path sources do not create a new commit; Patchmill validates and reuses them.
Inline sources are repo mutations and therefore happen only after the issue is
claimed.

## Materialized artifact paths and commits

Inline artifacts should use the existing deterministic filename conventions:

- specs: `docs/specs/YYYY-MM-DD-issue-<number>-<slug>-design.md`
- plans: `docs/plans/YYYY-MM-DD-issue-<number>-<slug>.md`

If both inline spec and inline plan are materialized in the same run, Patchmill
may either commit them together or as two commits, but it must record the
correct commit SHA for each artifact in run state. Committing together is
acceptable if both paths share the same commit SHA.

Suggested commit messages:

- `docs(specs): materialize issue <number> spec`
- `docs(plans): materialize issue <number> plan`
- or `docs(workflow): materialize issue <number> artifacts` when committing both
  together.

Materialized inline artifacts are source-provided artifacts, not Pi-created
artifacts. Existing approval labels must not be treated as stale solely because
Patchmill wrote the source-provided file this run.

## Stage advancement changes

`advancePlanningStages` should accept optional resolved artifact inputs:

```ts
resolvedArtifacts?: {
  spec?: WorkflowArtifactResolution;
  plan?: WorkflowArtifactResolution;
}
```

The existing `resolveWorkflowArtifact()` helper should prefer an explicit
resolved source before checking saved state or directory discovery. This
preserves existing resume/fallback behavior while making extracted issue content
authoritative when it is unambiguous.

Run-state checkpoints should reflect resolved/materialized paths so reruns do
not duplicate materialization, comments, specs, or plans.

## Error handling

Typed preflight errors should include:

- artifact kind (`spec` or `plan`) when applicable;
- issue number;
- source evidence when available;
- clear operator guidance.

Examples:

- `Issue #65 has ambiguous plan artifact sources: Two possible plan sections were found.`
- `Issue #65 references spec path docs/specs/foo.md, but the file does not exist.`
- `Issue #65 references plan path ../plan.md outside configured plansDir.`
- `Issue #65 artifact extraction returned malformed JSON.`

Preflight errors are allowed to surface as CLI `status: "error"` results and
should not mutate labels/comments/run-state. Materialization or commit failures
after claim use the existing unexpected-failure path so diagnostics and recovery
state are preserved.

## Dry-run behavior

`patchmill run-once --dry-run` should not run artifact extraction, should not
invoke the extractor skill, should not validate extracted artifacts, and should
not materialize artifacts. It keeps the current cheap transition preview
behavior.

## Documentation updates

Update `docs/configuration.md` so the Skills section lists `artifactExtraction`,
shows the bundled/default value, and demonstrates how repositories can override
it in `patchmill.config.json`. Update `docs/issue-agent-workflows.md` so
operators understand where extraction runs in the `run-once` sequence.

## Testing strategy

Automated tests should cover behavior:

- Config defaults include `skills.artifactExtraction`.
- Config loading accepts custom `skills.artifactExtraction` values.
- Bundled skill resolution maps `patchmill:bundled-artifact-extraction` to
  `skills/patchmill-artifact-extraction/SKILL.md`.
- The extraction prompt includes the configured skill, full issue content,
  untrusted-content boundary, artifact directories, and strict JSON contract.
- Extraction result parsing accepts `resolved`, `none`, and `ambiguous` results.
- Malformed extractor output fails preflight before claim.
- Path outputs are validated for existence and directory containment.
- Inline outputs are materialized, committed, recorded, and reused by stage
  advancement.
- Extracted path references prevent duplicate spec/plan creation.
- Ambiguous extractor output fails before claim.
- Missing referenced local paths fail before claim.
- `--dry-run` does not run artifact extraction.
- Resolved issue-content sources take precedence over filename-based discovery.

No tests are needed for static documentation text. Documentation-only
verification can use linting/format checks.

## Open implementation notes

- Keep extractor prompt construction testable without invoking Pi.
- Keep extractor result parsing independent of filesystem validation.
- Pass the configured artifact-extraction skill through existing skill
  invocation mechanics so bundled/path-like skills are available to Pi and
  namespace-style skills are named in the prompt.
- The default skill should be concise and focused on extraction judgment, not
  Patchmill implementation details.
- Consider progress events for `artifact extraction`, `materialize spec`, and
  `materialize plan` so operators can see why a run used an existing artifact.
