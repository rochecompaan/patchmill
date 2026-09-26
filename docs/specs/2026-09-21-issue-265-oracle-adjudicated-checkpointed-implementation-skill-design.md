# Oracle-Adjudicated Checkpointed Implementation Skill Design

Issue: #265

## Context

The current `single-subagent-dev-with-codex-and-thermo-reviews` skill executes
an approved plan with one long-running worker, then runs three sequential
review/fix loops: Codex, thermo-nuclear, and final validation-readiness.

Three defects motivated replacing it:

1. **Unbounded loops.** Each loop re-runs "until it passes"; only PR-check
   repairs are capped (two passes). A reviewer that never passes produces an
   endless, costly loop. This failure occurred in practice and prompted the
   investigation.
2. **Stale verdict coverage.** The Codex loop closes before thermo fixes land,
   so the Codex verdict never covers the final HEAD. Nothing tracks whether a
   verdict still matches the code it inspected.
3. **Conflicted adjudication.** The parent orchestrator decides which findings
   to accept while under landing pressure, with the whole implementation history
   (and its sunk cost) in context.

A hardened variant has been running in the Croprun project, where its
rationalization checks were derived from observed pressure-test failures. That
variant is the design adopted here.

## Decision

Replace the contents of
`skills/single-subagent-dev-with-codex-and-thermo-reviews/` with a generalized
version of the Croprun variant. The skill directory name and frontmatter `name:`
stay unchanged, so existing `patchmill.config.json` references keep working. Do
not ship it as a separate optional skill.

## Design

### Architecture

- **Milestone checkpointing.** The parent groups plan tasks into coherent
  milestones and dispatches one fresh `worker` per milestone. Continuity is
  carried by Git commits and two durable ledgers
  (`.superpowers/single-writer/progress.md` and `oracle-review-ledger.json`),
  never by child conversation. Workers are resumed for blockers and replaced
  only when resumption fails.
- **Frozen review waves.** Every applicable initial reviewer (Codex, thermo,
  plus visual evidence when the diff changes visible UI, plus final validation
  when the plan defines required commands) inspects the same frozen HEAD before
  any repair begins.
- **Oracle adjudication.** A fresh, read-only `oracle` subagent (the
  pi-subagents builtin role; no agent definition file is required) receives all
  findings and returns a structured verdict (`READY` / `REPAIR` / `BLOCKED` /
  `ASK_HUMAN`) against a JSON schema. Reviewer severity is evidence; the oracle
  owns finding dispositions, lineages, and readiness. The parent handles
  verdicts mechanically and may not override them.
- **Bounded repair.** Repairs happen only in oracle-authorized batches with
  explicit allowed paths. Each semantic finding lineage is capped at five repair
  attempts. Original reviewers are resumed (not replaced) for one follow-up per
  cumulative repair interval; unaffected reviewers advance via diff-backed
  carry-forward attestations. Landing requires an unbroken coverage chain to
  current HEAD.
- **PR checks.** Repository-fixable required-check failures re-enter the same
  oracle and lineage state instead of a separate global repair budget.

### Generalization

The Croprun variant is upstreamed verbatim, then made repository-neutral:

- "Croprun references" -> project reference material/screenshots.
- Forgejo/Gitea-only PR-check wording -> host-neutral wording with GitHub and
  Forgejo/Gitea examples, matching the other bundled skills.
- "mobile UI" -> "web or mobile UI" in affected-reviewer rules.
- "device" stays: it names a generic operational-blocker class, not a
  Croprun-ism.

### Pack distribution

- The skill-pack version bumps from `2026.09.1` to `2026.09.2` with a
  `VERSION_NOTICES` entry explaining the behavior change and that no config
  change is required.
- The sibling skill `subagent-dev-with-codex-and-thermo-reviews` gains only the
  new `prompts/final-visual-evidence-review.md` dependency the variant
  references; its own SKILL.md is unchanged.
- The repo's tracked installed copy under `.patchmill/skills/` is synchronized
  with `patchmill skills update` and committed.

### Integrity test

A test extracts backtick-quoted sidecar references (`../...`, `prompts/...`,
`schemas/...`, `rubrics/...`) from both implementation skills' SKILL.md files
and asserts each resolves to a file on disk. The skill instructs the agent to
stop if referenced files are missing, so a renamed or deleted sidecar is a real
runtime regression the test catches.

## Non-goals

- Changing which skill `buildRecommendedProjectSkillConfig` selects for new
  projects (`subagent-dev-with-validation-and-pr-checks` stays the default for
  fresh installs).
- Adopting the Croprun sibling skill's own workflow changes (its visual evidence
  step).
- Provisioning an `oracle` agent definition; the pi-subagents builtin suffices.
- Updating historical specs/plans for the old workflow.

## Risks

- **Oracle operational failure** hard-blocks the workflow by design (no fallback
  to reviewer authority). Accepted: silent degradation to conflicted
  adjudication is worse than an explicit stop.
- **Per-pass cost** is higher (parallel wave plus oracle plus ledger
  bookkeeping), but total cost is bounded by lineage caps; the replaced workflow
  bounded nothing.
- **Small plans** pay the wave and oracle cost even when trivial. Accepted; the
  skill already directs parents not to split one-milestone plans artificially.
