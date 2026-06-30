# Dry-Run Triage Malformed Pi JSON Recovery Design

## Goal

Make `patchmill triage --dry-run --issue <number>` robust to the observed Pi
session-output bug where an otherwise valid preview JSON document is followed by
trailing garbage, while still reporting genuinely unparseable output with useful
debug context.

## Current behavior

`runTriageDryRunAgent()` in `src/cli/commands/triage/dry-run-agent.ts` enables
Pi session observation with `--session-dir` whenever triage progress has an
`onToolCall` observer. Its stdout is parsed by `parseTriagePreviewJson()`, which
currently trims stdout, optionally unwraps a full fenced JSON block, and calls
`JSON.parse()` on the entire remaining string.

When bundled Pi is invoked with `--session-dir`, it can return a valid preview
document followed by an extra closing brace, for example:

```json
{"previews":[{"issueNumber":123,"currentLabels":["enhancement"],"proposedLabels":["enhancement","agent-ready"],"canonicalBucket":"agent-ready","blockedBy":[],"rationale":"...","wouldComment":null,"wouldClose":false,"questions":[]}]}}
```

The strict parse rejects this before validation, dry-run preview output is not
shown, and Patchmill records the run as failed. The related `run-once` Pi parser
already attempts final-JSON extraction instead of requiring the whole stdout to
be exactly one JSON object.

## Requirements

- Keep dry-run triage read-only and keep session observation enabled when an
  `onToolCall` observer is present.
- `parseTriagePreviewJson()` must accept a valid triage preview document
  followed only by trailing non-JSON garbage such as the observed extra `}`.
- Preserve support for direct JSON and full fenced JSON responses.
- Do not silently accept a malformed or partial preview document if no complete
  object with a `previews` array can be extracted.
- When parsing fails, throw an error that still starts with the existing context
  (`Pi triage dry-run returned invalid JSON`) and includes a short stdout
  snippet near the parse failure or failed extraction point.
- Keep schema validation in `validateTriagePreviewDocument()` responsible for
  preview shape, issue count, issue numbers, buckets, blocker metadata,
  comments, closure flags, and questions.
- Treat model stdout as untrusted data. Snippets in errors should be bounded and
  printable; they must not trigger command execution or be interpreted as
  instructions.

## Proposed behavior

Update `parseTriagePreviewJson(stdout)` to use a narrow recovery strategy:

1. Trim stdout and unwrap a response that is entirely a fenced JSON block, as it
   does today.
2. Try `JSON.parse()` on the resulting body first. This keeps the normal path
   strict and preserves existing behavior for valid output.
3. If strict parsing fails, scan the body for a complete JSON object candidate
   that parses successfully and has a top-level `previews` property. Prefer the
   earliest complete candidate that consumes the main preview document rather
   than a nested preview entry. A brace-depth scan that respects JSON strings is
   sufficient and avoids accepting arbitrary text after arbitrary nested braces.
4. Return the recovered object to the existing validation path. If validation
   later rejects the object, surface the validation error as today.
5. If no preview document can be recovered, throw an invalid-JSON error that
   includes the original parse error plus a bounded snippet around the failure
   position when available. For errors without a position, include a bounded
   prefix/suffix snippet of stdout.

This intentionally recovers only after a complete valid preview JSON document is
found. It does not attempt to repair missing braces, invalid strings, invalid
arrays, or schema errors.

## Affected components

- `src/cli/commands/triage/dry-run-agent.ts`
  - Add a small helper for preview JSON extraction or inline it in
    `parseTriagePreviewJson()`.
  - Add a bounded stdout snippet helper for parse failures.
  - Keep `runTriageDryRunAgent()` unchanged except for benefiting from the more
    tolerant parser.
- `src/cli/commands/triage/dry-run-agent.test.ts`
  - Add a regression test that `parseTriagePreviewJson()` accepts preview JSON
    followed by an extra `}`.
  - Add a failure test asserting the invalid-JSON error includes a short stdout
    snippet when no valid preview document can be extracted.
  - Keep existing direct and fenced JSON tests passing.
- Optional shared utility follow-up
  - If implementation would duplicate substantial logic from
    `src/cli/commands/run-once/pi.ts`, consider extracting a focused JSON object
    extraction helper. This is optional; a localized fix is acceptable because
    the dry-run parser needs a top-level `previews` document rather than a final
    status object.

## Verification strategy

Run targeted triage parser and pipeline coverage:

```sh
node --test src/cli/commands/triage/dry-run-agent.test.ts src/cli/commands/triage/pipeline.test.ts
```

Run the full test suite before merge:

```sh
npm test
```

Manual verification, if a repository issue is available, should run:

```sh
patchmill triage --dry-run --issue <number>
```

with normal progress output enabled, confirm the Pi invocation includes
`--session-dir`, and confirm Patchmill prints/writes the dry-run preview instead
of failing on an extra trailing brace. Then test a deliberately unparseable Pi
stdout fixture or mock and confirm the error includes
`Pi triage dry-run returned invalid JSON` plus a bounded stdout snippet. No npm
dependency changes are required, so no Nix build is required unless
implementation later changes package metadata.
