# Actionable run-once failure diagnostics

- **Issue:** #242
- **Status:** Proposed design

## Summary

Every public `reason` emitted by the run-once workflow will resolve through one
exhaustive diagnostic catalog. The stable reason code remains machine-readable,
while the catalog adds a concise summary, a plain-language explanation,
reason-specific details, safe actions, safety guidance, and explicit retry
behavior.

The same structured diagnostic will drive the interactive terminal report,
redirected JSON, and final JSONL `result` event. Selection-rejection events that
carry a reason will use the same catalog. Patchmill will preserve all current
safety checks, workspaces, locks, Run recovery state, labels, exit codes, and
workflow effects.

## Context

Issue #174 established `RunOnceResultSummary` as the common public output and
made `terminal-result.ts` a pure renderer over that summary. Redirected stdout
serializes the summary directly, and `writeRunOnceResult()` records the same
summary in the final JSONL event. These are the correct reuse points for richer
diagnostics.

Current reason handling is fragmented:

- stable classifier codes such as `planning-workspace-dirty`,
  `implementation-workspace`, and `issue-lock-stale` reach the result as bare
  strings;
- agent blockers, development-environment failures, validation failures, and
  unexpected exceptions put free-form prose in the same `reason` position;
- planning lock diagnostics already know the lock path, fingerprint, and owner,
  but discard that context when constructing the final result;
- recovery decisions already carry assessments and guidance, but refusals are
  commonly flattened into an error message; and
- selection rejection events contain codes and context without an explanation or
  recovery contract.

Operators therefore have to read source or logs to distinguish a safe retry from
a retry that must produce the same outcome. This design uses **run-once
workflow**, **Issue run**, **Run attempt**, **Run recovery state**, and **phase
workspace** as defined in `CONTEXT.md`. No ADR conflicts apply.

## Goals

- Give every reason-bearing non-success result an actionable diagnostic.
- Keep existing stable reason codes unchanged and separate codes from prose.
- Give terminal errors that currently have no reason a bounded stable code.
- Include useful paths, state, owner metadata, fingerprints, validation facts,
  and reported messages when they are available.
- Recommend an exact Patchmill command only when that command supports the
  recovery being described.
- Explicitly identify unsafe cleanup, required confirmation, and retry timing.
- Reuse one diagnostic object across interactive, redirected, and JSONL output.
- Make a new public reason fail compilation or contract tests until its
  diagnostic is defined.
- Keep interactive output concise, wrapped, and safe for a terminal.

## Non-goals

This issue will not:

- weaken a lock, workspace, ancestry, artifact, pull-request, or recovery check;
- automatically delete, clean, reset, archive, move, or repair preserved state;
- add a force option or make an existing recovery command more permissive;
- infer remote process death from lock age or local process information;
- change result status, severity, exit code, label transitions, issue comments,
  or Run recovery state solely to improve wording;
- make arbitrary agent-provided remediation a Patchmill-endorsed safe action;
- rewrite historical JSONL logs; or
- add a general localization or documentation-generation system.

## Approaches considered

### Exhaustive catalog plus typed diagnostic context (chosen)

Define the public reason-code set and one catalog in a focused module. Producers
return a code plus structured context; the summary boundary materializes the
public diagnostic. Selection events use the same materializer directly.

This keeps wording and recovery policy centralized without forcing the catalog
to perform I/O. It also preserves the existing summary/output architecture and
allows TypeScript to reject uncatalogued codes.

### Producer-owned messages

Each planning, implementation, selection, lock, and recovery branch could add
its own explanation and actions. That is initially direct, but duplicates
wording, makes terminal and JSON output drift, and cannot prove future reason
coverage. It is rejected.

### Renderer-only lookup

The terminal renderer could translate each reason code while redirected output
keeps the old shape. This would leave automation and JSONL consumers without the
new information and would mix recovery policy into presentation code. It is
rejected.

## Public diagnostic contract

### Stable reason codes

Create a canonical `RUN_ONCE_REASON_CODES` tuple and derive `RunOnceReasonCode`
from it. The diagnostic catalog must satisfy
`Record<RunOnceReasonCode, DiagnosticDefinition>`. Result and event types that
publish a reason use this type rather than `string`.

The initial inventory covers these existing reason families:

| Family                                        | Existing codes or normalized public code                                                                                                                                                                                     |
| --------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Selection                                     | `non-open-state`, `blocking-labels`, `not-actionable`, `waiting-spec-approval`, `waiting-plan-approval`                                                                                                                      |
| Expected stop or pending state                | `plan-only`, `issue-locked`, `ignored-worktree-content`                                                                                                                                                                      |
| Planning lock and identity                    | `issue-lock-stale`, `issue-lock-unverifiable`, `issue-lock-malformed`, `planning-state-invalid`, `planning-identity-changed`, `planning-run-id-mismatch`                                                                     |
| Planning workspace and review                 | `planning-workspace-dirty`, `ambiguous-base-artifact`, `planning-pull-request-closed-unmerged`, `planning-pull-request-missing`, `planning-pull-request-ambiguous`                                                           |
| Implementation                                | `implementation-configuration`, `implementation-workspace`, `implementation-direct-merge`, `implementation-ancestry`, `implementation-remote-head`, `implementation-url`, `implementation-branch`, `implementation-evidence` |
| Run recovery refusal                          | `active-run`, `dirty-worktree`, `unmerged-commits`, `workspace-unverifiable`, `legacy-active-unfenced`, `not-blocked`                                                                                                        |
| Bounded wrappers for current free-form values | `agent-blocked`, `development-environment-not-ready`, `implementation-validation`, `planning-workspace-conflict`, `unexpected-error`                                                                                         |

`ignored-worktree-content` is shared by pending cleanup and recovery refusal but
uses status and context to select the appropriate details and actions. This is
the required initial inventory. The implementation audit must fail if any
current reason-bearing producer is not mapped; an omitted literal is a defect,
not permission to pass an untyped string through the fallback.

Known stable codes retain their spelling at the top-level `reason` field. Values
that are currently prose are normalized without losing information:

- an agent blocker becomes `reason: "agent-blocked"`, with the original report
  and questions in details;
- a development-environment refusal becomes
  `reason: "development-environment-not-ready"`, with the reported reason,
  evidence, and remediation retained as context;
- implementation pull-request validation becomes
  `reason: "implementation-validation"`, with its validation subreason and
  observed evidence retained;
- `planning-state-invalid: <detail>` becomes `reason: "planning-state-invalid"`
  plus separate state path and validation details; and
- an unclassified terminal exception becomes `reason: "unexpected-error"`, with
  the original error and causes retained.

Agent text and error messages never become catalog keys. They are evidence, not
trusted recovery policy.

### Structured diagnostic

Every reason-bearing public object includes:

```ts
type RunOnceDiagnostic = {
  summary: string;
  explanation: string;
  details: Array<{
    key: string;
    label: string;
    value: string | number | readonly string[];
  }>;
  actions: Array<{
    description: string;
    command?: string;
  }>;
  safety: readonly string[];
  retry: {
    kind: "retry-now" | "after-action" | "same-result" | "inspect-first";
    guidance: string;
  };
};
```

`reason` remains next to `diagnostic`; the diagnostic does not replace it. Every
catalog result has a nonblank explanation, at least one action, explicit safety
guidance, and retry guidance. `details` may be empty only when no
reason-specific evidence exists. Detail keys are stable machine names; labels
are presentation text.

A command is included only when Patchmill owns a supported command for that
step. Commands are constructed from validated values such as a positive issue
number. The catalog does not synthesize shell commands around arbitrary paths.
When no safe command exists, the action explicitly requires manual inspection.

### Catalog API and context

The catalog is pure. Its conceptual interface is:

```ts
diagnosticFor<R extends RunOnceReasonCode>(
  reason: R,
  context: RunOnceDiagnosticContextByReason[R],
): RunOnceDiagnostic
```

The context map makes reason-specific evidence explicit. Producers collect facts
while they still have typed domain objects; the catalog only turns those facts
into public data. Context includes, where applicable:

- issue number, phase, configured ready label, and result status;
- branch, phase-workspace path, detected workspace state, and status evidence;
- planning lock path, SHA-256 fingerprint, classification, and owner fields;
- saved and expected workspace identities;
- recovery classification, blocked action, lease resource, owner, and guidance;
- pull-request URL/reference and the observed validation subreason;
- selection state, blocking labels, workflow state, and missing label; and
- reported agent message, questions, evidence, causes, and resolved run-log
  path.

No formatter re-reads Git, lock files, host state, or Run recovery state. This
avoids races and ensures the diagnostic describes the evidence used for the
actual decision.

## Diagnostic policy

Catalog entries explain both what Patchmill observed and why proceeding would be
unsafe. Recommendations follow these rules:

- A planning lock is not an Issue run lease. Diagnostics must not recommend
  `patchmill run lease repair` for a `planning-pr-v1` lock.
- `issue-lock-stale` reports the lock path, fingerprint, and recorded owner. It
  instructs the operator to confirm that owner has stopped and preserve the
  exact lock bytes as evidence before manually archiving or moving them.
  Deleting or editing the lock in place is prohibited. Immediate retry is
  reported as the same result until the lock is handled.
- `issue-lock-unverifiable` and `issue-lock-malformed` require owner/operator
  coordination or inspection of preserved bytes. Age alone is explicitly
  insufficient evidence.
- `issue-locked` identifies an active planning lock, tells the operator to wait,
  and prohibits lock removal.
- `planning-workspace-dirty` and `implementation-workspace` report the phase,
  branch, path, and observed state. They require manual inspection and
  preservation of work; they never recommend `git clean`, reset, force removal,
  or deleting the worktree.
- Recovery refusal codes use the existing recovery assessment. The inspection
  form `patchmill run lease repair --issue N` is shown only for a relevant Issue
  run lease/guard/fence. A reset command is shown only when the assessed policy
  says reset can pass.
- Pull-request, ancestry, remote-head, and evidence mismatches identify the
  expected and observed facts when available. They require repairing or manually
  inspecting the existing artifact/branch/pull request rather than replacing
  preserved evidence.
- `agent-blocked` retains the agent's questions and report, but the catalog's
  safe action is to answer the questions, acknowledge through the configured
  workflow label, and then run `patchmill run-once --issue N`. Arbitrary agent
  prose is not copied into the catalog-owned action or safety fields.
- `development-environment-not-ready` retains agent evidence and reported
  remediation as clearly attributed details. Patchmill tells the operator to
  validate those prerequisites before retrying; it does not certify an
  agent-suggested destructive action as safe.
- `unexpected-error` identifies the error, causes, and log path, requires log
  inspection, warns against deleting preserved state, and marks retry outcome
  unknown. It is a fallback for unclassified exceptions, not a way to introduce
  new classifier codes without catalog entries.

## Data flow and affected behavior

### Producer normalization

Separate agent-facing blocked results from public pipeline failures.
`AgentIssueBlockedResult.reason` may remain free-form because it is part of the
Pi task contract and existing blocker comments. Pipeline adapters convert it to
`agent-blocked` for public output while retaining the report as context.
Persisted `lastError`, blocker questions, comment receipts, and comment bodies
keep their current behavior.

Planning, implementation, workspace, lock, selection, and recovery branches
return typed reason/context pairs. Typed exceptions caught at the CLI boundary
map to a specific catalog code where one exists; all other exceptions map to
`unexpected-error`. Recovery refusals retain their typed reason and assessment
instead of being flattened into `AgentIssueSafetyError` text before output.

### Summary and structured output

`summarizeResult()` materializes the diagnostic once. Reason-bearing summary
members require both the typed reason and its context internally, and expose
`reason` plus `diagnostic` publicly. `summarizeErrorResult()` also returns a
reason-bearing summary.

`writeRunOnceResult()` remains the single fan-out point:

1. append the complete summary to the resolved JSONL log as the final `result`
   event;
2. render that summary for an interactive terminal; or
3. serialize that exact summary as one compact JSON line for redirected stdout.

Thus redirected output and the final run-log event contain identical diagnostic
fields. Existing result fields remain unless they held free-form text in the
reason position; that text moves to a keyed diagnostic detail. Status, severity,
and exit-code mappings do not change.

Selection rejections are not final results, but they already publish `reason` in
JSONL event data. `emitSelectionDiagnostics()` adds the catalog diagnostic to
each such event. A `no-issue` result does not invent a single reason when
multiple issues were rejected; the detailed rejection events remain the
structured source of those per-issue decisions.

### Interactive rendering

For `blocked`, `error`, `development-environment-not-ready`, `cleanup-pending`,
and reason-bearing `stopped` results, the terminal renderer shows:

1. stable `Reason` code;
2. one wrapped explanation;
3. available keyed details;
4. `Recommended action` entries, with a command on its own indented line;
5. `Safety` warnings; and
6. `Retry` guidance.

Existing question, evidence, artifact, workspace, and run-file sections remain.
Duplicate legacy remediation is folded into attributed details or omitted when
the catalog action already represents it. Empty sections are not rendered.
Existing wrapping, ANSI sanitization, literal-value preservation, and color
rules apply to every new dynamic field. Color is never the only safety signal.

## Components

- `src/cli/commands/run-once/result-diagnostics.ts` (new) — canonical reason
  tuple, typed context map, exhaustive catalog, and pure materializer.
- `src/cli/commands/run-once/types.ts` and `src/issue-run/types.ts` — separate
  free-form agent results from typed public pipeline failures and carry
  reason-specific context.
- Planning phase runner, implementation validation, workspace recovery, planning
  lock, selection, and Run recovery adapters — preserve existing evidence and
  emit typed reason/context pairs.
- `src/cli/commands/run-once/pipeline-failures.ts` and `main.ts` — normalize
  agent, typed, and unexpected failures without changing side effects.
- `src/cli/commands/run-once/result-summary.ts` — expose `reason` plus the
  materialized structured diagnostic for every reason-bearing result and error.
- `src/cli/commands/run-once/terminal-result.ts` — render the shared diagnostic
  with existing layout and sanitization primitives.
- `src/cli/commands/run-once/result-output.ts` — retain the common summary
  fan-out and current exit behavior.
- `site/src/content/docs/using-patchmill/run-once.md` — document diagnostic
  fields, retry meanings, and the distinction between planning locks and Issue
  run leases.

Focused modules may be added when preserving context in one listed producer
would mix classification, workflow effects, and presentation concerns.

## Verification strategy

These tests pass Patchmill's Testing Value Gate because they protect a reusable
public CLI contract, safety guidance, machine-readable output, and destructive
recovery boundaries.

### Catalog contract tests

- Assert that the canonical reason tuple contains unique values and that catalog
  keys match it exactly.
- Materialize every reason with a typed fixture and require nonblank summary,
  explanation, action, safety, and retry guidance.
- Require an explicit exact command for entries that advertise a supported
  Patchmill recovery command and no command for manual-only recovery.
- Assert that planning-lock entries never mention Issue run lease repair, force
  cleanup, `git clean`, reset, or lock deletion.
- Assert that arbitrary agent/error text appears only in details and cannot
  change catalog actions, safety text, or retry classification.

### Producer and summary tests

- Cover each current reason-producing branch by family: selection, planning
  state, lock classifications, phase-workspace state, planning pull request,
  implementation validation, recovery refusal, agent blocker, environment
  readiness, and unexpected error.
- Specifically verify actionable diagnostics for `implementation-workspace`,
  `planning-workspace-dirty`, and `issue-lock-stale`, including available path,
  owner, and fingerprint details.
- Verify free-form inputs normalize to bounded codes while their original text,
  questions, evidence, and causes remain available.
- Verify every reason-bearing result summary includes one diagnostic and that an
  unclassified exception becomes `unexpected-error`.
- Verify persisted state, blocker comments, labels, checkpoints, and recovery
  decisions are unchanged by diagnostic materialization.

### Output tests

- Verify interactive output contains Reason, Explanation, Recommended action,
  Safety, and Retry in readable order without duplicate headings.
- Verify narrow output wraps every new field within the requested width and
  hostile control sequences cannot inject headings or styles.
- Verify redirected stdout is one parseable JSON line with structured details,
  actions, safety, and retry fields and no ANSI sequences.
- Verify the final JSONL `result` event data is deeply equal to redirected
  summary data, and selection rejection events carry the same catalog shape.
- Verify all status severities and exit codes remain unchanged.

Run focused diagnostics, summary, terminal, selection, planning, implementation,
and recovery tests first, followed by:

```sh
npm run test:run-once
npm test
npm run lint
npm run build
npm run site:build
```

No dependency change is planned. The Nix build is required only if
implementation changes `package.json`, `package-lock.json`, or
`npm-shrinkwrap.json`, as required by `AGENTS.md`.

## Success criteria

Every public run-once reason has one stable code and one catalog-backed,
actionable diagnostic. Interactive failures explain what Patchmill found, why it
stopped, what evidence matters, the safest next step, what must not be
destroyed, and whether immediate retry can progress. Redirected JSON and JSONL
logs expose the same facts as structured data. Adding a reason without its
catalog entry fails verification, while all existing workflow safety, state
preservation, and exit behavior remain unchanged.
