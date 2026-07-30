# Run-once subagent model and thinking output umbrella design

**Status:** Umbrella architecture for
[#116](https://github.com/rochecompaan/patchmill/issues/116). Implementation is
decomposed across issues #121–#126; each child issue owns its detailed spec and
plan.

## Context

Patchmill currently reports a run-once subagent invocation using the agent name:

```text
🤖 subagent (agent=reviewer)
```

Operators also need to see the effective model and thinking level reported for
each child:

```text
🤖 subagent (agent=reviewer, model=gpt-5.6-sol, thinking=xhigh)
```

The original design attempted to deliver dependency adoption, installed-layout
repair, Pi session reliability, lifecycle observation, child correlation, and
console rendering in one implementation plan. That plan is retained as a
[deprecated reference](../plans/2026-07-25-run-once-subagent-model-thinking-output.md),
but it is not executable or eligible for plan approval as one unit.

## Program outcome

When a run-once parent invokes `pi-subagents`, Patchmill renders one visible
progress line for each requested child. The line includes the agent and every
available authoritative model or thinking field reported for that child.
Metadata appears near-live when the upstream lifecycle exposes it and remains
visible when a child later fails.

The completed program must preserve existing machine and operator interfaces:

- final run-once JSON remains on stdout;
- progress remains on stderr;
- one parent invocation contributes one `toolCalls` accounting unit;
- implementation todo progression remains responsive to child progress;
- triage remains immediate and receives no run-once enrichment;
- missing metadata is omitted rather than guessed.

## Program contracts

### Authoritative metadata

Patchmill consumes effective child metadata from a validated `pi-subagents`
release. Patchmill does not copy upstream agent, override, model, thinking,
default, provider, or fallback resolution.

The dependency-adoption issue must verify the contract for direct, counted,
parallel, and chain execution. If an execution mode cannot report authoritative
metadata, that gap is handled upstream; Patchmill never infers child thinking
from the parent session or configuration files.

Model identifiers retain all model-specific path segments. Presentation may
remove a separately reported provider prefix only when the child metadata
contract distinguishes it unambiguously.

### Per-child visibility

Every requested child has an independent visibility slot. An authoritative
update resolves that child's slot; completion or shutdown produces one safe
fallback for each unresolved slot. One child's metadata, failure, or repeated
updates cannot hide another child.

Patchmill follows the validated upstream execution-mode rules instead of
inventing an alternate mode resolver. In particular, conflicting nonempty
aggregate modes remain invalid, exactly one aggregate mode owns execution when
present, and direct mode applies otherwise.

### Observation and cancellation

Run-once owns one exact parent Pi session file. It must not discover sessions by
selecting the newest recursive JSONL file. Observation delivery is serialized
and backpressured so updates cannot reorder or outpace their consumer.

Observation failure is terminal for the active Pi command. Cancellation, process
close, observer shutdown, and cleanup must settle without masking independent
runner, stream, callback, or cleanup failures.

### Privacy and context isolation

The lifecycle bridge persists bounded custom session entries outside LLM
context. Entries may contain only correlation identity and the reported child
agent/model/thinking projection required by run-once.

Entries must not include task text, child output, prompts, credentials, costs,
full result objects, unrestricted paths, or other incidental result metadata.

## Delivery issues

### [#121: Fix Pi extension package-root resolution](https://github.com/rochecompaan/patchmill/issues/121)

Owns reliable discovery of package-owned Pi extensions in source,
compiled/npm-packed, and Nix-installed layouts. This pre-existing production fix
remains independent of the progress feature.

### [#122: Upgrade `pi-subagents`](https://github.com/rochecompaan/patchmill/issues/122)

Owns validation and adoption of a release that exposes effective child model and
thinking metadata for every supported execution shape. Any remaining contract
gap becomes a linked upstream blocker rather than local inference.

### [#123: Add deterministic run-once session streaming](https://github.com/rochecompaan/patchmill/issues/123)

Owns exact parent-session creation and following, callback backpressure, command
cancellation, cleanup settlement, and complete terminal-cause reporting. It does
not migrate triage.

### [#124: Persist safe lifecycle metadata](https://github.com/rochecompaan/patchmill/issues/124)

Owns metadata normalization, Pi lifecycle observation, bounded custom entries,
deduplication, run-once profile loading, and observer packaging. It does not own
session following or CLI presentation.

### [#125: Correlate per-child progress](https://github.com/rochecompaan/patchmill/issues/125)

Owns execution-shape inventory, child correlation, unresolved fallbacks,
parent-level accounting compatibility, async cardinality, and implementation
todo progression. It does not own console formatting.

### [#126: Render enriched progress](https://github.com/rochecompaan/patchmill/issues/126)

Owns the stable `🤖 subagent (...)` presentation, omission of unavailable
fields, stdout/stderr separation, and final operator-facing regression coverage.

## Dependency graph

```text
#121 package root ───────────────┐
                                ├──> #124 observer ──┐
upstream metadata -> #122 upgrade                    ├──> #125 correlation -> #126 rendering
#123 session streaming ──────────────────────────────┘
```

Issues #121, #122, and #123 may proceed independently. Issue #124 requires #121
and #122. Issue #125 requires #123 and #124. Issue #126 requires #125.

## High-level data flow

1. A validated `pi-subagents` release resolves and reports each child's
   effective runtime metadata.
2. A package-owned Pi observer projects only the safe metadata fields into the
   exact parent session.
3. Run-once follows that exact session and delivers entries serially.
4. Correlation assigns each valid entry to the corresponding parent tool call
   and child slot.
5. The pipeline records progress without increasing parent invocation
   accounting.
6. The console renders one line for each resolved or fallback child on stderr.

Each step has one owning issue and a bounded interface. Child specs may refine
their internal implementation but may not weaken the program contracts above.

## Error-handling invariants

- Unknown or unsupported metadata stays absent.
- Invalid external entries cannot crash or contaminate unrelated progress.
- Repeated updates are idempotent for the same child metadata tuple.
- Failed and unresolved children remain independently visible.
- Observation errors cancel active work promptly.
- Concurrent runner, observer, callback, cleanup, and close failures remain
  inspectable in the terminal error.
- No failure path moves progress onto stdout or final JSON onto stderr.

## Non-goals

This umbrella does not:

- redesign `pi-subagents` model or thinking selection;
- add Patchmill-owned metadata inference;
- change child prompts, tasks, tools, or execution policy;
- enrich triage output;
- redesign the `pi-subagents` TUI;
- migrate triage session discovery as part of #116;
- prescribe child-level files, commits, fixtures, or implementation algorithms.

A triage exact-session migration may be evaluated as a separate follow-up if it
is independently justified.

## Program acceptance criteria

The umbrella is complete only when all child issues are complete and integrated,
and the combined behavior demonstrates that:

- each requested run-once child produces one visible progress outcome;
- each line includes its agent and all available authoritative model/thinking
  metadata;
- displayed metadata reflects the child runtime contract rather than parent
  inference;
- metadata can appear before parent tool completion;
- failed and unresolved children remain visible;
- task text, child output, credentials, and unrestricted result metadata never
  enter custom progress entries;
- direct, counted, parallel, and chain execution preserve child cardinality;
- parent `toolCalls` accounting remains one unit per parent tool-call ID;
- implementation todo progression remains intact;
- source, npm-packed, and Nix-installed layouts load the same observer;
- progress remains on stderr and final JSON remains on stdout;
- triage behavior remains unchanged.

## Planning governance

Issue #116 is an umbrella tracker, not an executable implementation issue. It
must not receive `agent-ready`, `spec-approved`, or `plan-approved` while it
remains an umbrella.

Each child issue receives its own task-specific worktree, spec, plan, review,
and approval decision. A child plan should own one primary behavior, avoid
unrelated fixes, use roughly five or fewer implementation tasks, and remain
comfortably below GitHub's issue-comment limit. If a child plan exceeds that
scope, it must be decomposed again before approval.
