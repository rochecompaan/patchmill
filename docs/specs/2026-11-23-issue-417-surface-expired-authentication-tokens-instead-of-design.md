# Surface provider failures instead of leaving agents unresponsive

Issue: [#417](https://github.com/rochecompaan/patchmill/issues/417).

## Problem

A model provider can refuse a request. Example: the sign-in token of
`openai-codex` expired. Pi then records an assistant message with empty content,
`stopReason: "error"` and an `errorMessage`, for example
`Your authentication token has expired. Please try refreshing it.`

The terminal Pi interface shows this error. Patchmill does not:

- **Web session, live.** `onMessageEnd` in `src/web/session/web-session.ts`
  keeps only the text blocks of an assistant message. It drops the failed
  message. Then `agent_settled` sets the header state to `idle`. The maintainer
  sees nothing. Each new message fails the same way, without a reply.
- **Issue thread, history.** `projectPiThread` in `src/web/pi-thread.ts` drops
  the failed message in the same way.
- **Unattended phases (`run-once`, `run`).** `startPiRpc` in
  `src/kernel/pi-rpc.ts` writes `errorMessage` only to the phase log. The phase
  then has no Result block. `verifyOutcome` in `src/kernel/verify.ts` stops the
  run with `The worker ended without a result block. Log: …` and `Exit code: 1`.
  The real cause is visible only in the log.
- **Workers in an Interactive Issue run.** The worker launcher
  (`src/console/worker-launcher.ts`) copies the worker's session file into the
  phase session directory, but the stop reason is the same "no result block"
  text.
- **Triage.** `triageIssues` in `src/kernel/triage.ts` uses print mode
  (`supervisePi`). It logs only
  `Pi session failed, timed out, or was cancelled; skipping.`

A restart does not help when the saved sign-in is invalid. Because the failure
is silent, the maintainer cannot tell a sign-in failure from an agent that works
or is stuck.

## Intent

The maintainer agreed in the planning chat: "the web interface is not showing
errors like the interactive Pi interface does. Errors like this should be
surfaced in the web and non-interactive modes."

Success:

- Each request that the provider refuses appears in the Issue thread as an error
  entry with the provider's message. This applies to the live Web session and to
  the history of a finished run.
- An unattended phase or triage that ends because of a provider refusal says so
  in its stop reason, with the provider's message.
- When the message is about sign-in, Patchmill tells the maintainer how to fix
  it: run `patchmill auth`, then continue.

## Goals

- Show every **Provider failure** (definition below), not only sign-in failures.
  All of them disappear today in the same way.
- Add sign-in guidance when the failure is a sign-in failure.
- Keep one classification and one guidance text for all surfaces.

## Non-goals

- Automatic token refresh or a sign-in flow in the web page. `patchmill auth`
  stays the only sign-in path.
- A preflight request before each run to test the credentials. A test request
  costs money and time on each start, and it does not prevent an expiry later in
  the run.
- Changes to the terminal console. Pi's own interface already shows the error.
- Changes to Pi's retry policy. Pi still retries transient errors itself.
- A new header state or a banner in the web page. The existing error entry of
  the Issue thread is the visible surface.

## Anti-goals

- A failure that still looks like "the agent is working" or "idle" with no
  entry.
- A stop reason that hides the provider's message behind "no result block".
- Different wording for the same failure on different surfaces.
- An aborted reply (**Stop reply**) shown as an error. It stays a divider.

## Terms

**Provider failure**: an assistant message that Pi recorded with
`stopReason: "error"`. Its text is `errorMessage`, or `The request failed.` when
`errorMessage` is empty. A message with `stopReason: "aborted"` is not a
Provider failure. _Avoid_: auth error (too narrow), Pi crash (the process still
runs).

**Sign-in failure**: a Provider failure whose text shows that the provider
refused the credentials. See the classification rule below.

`GLOSSARY.md` gets the term **Provider failure**.

## Approaches

1. **Show every Provider failure, with sign-in guidance only for sign-in
   failures.** (Chosen.) One rule for all errors. The cost is the same as for
   sign-in only, and it fixes the same silent failure for overload, quota, and
   network errors.
2. **Show only sign-in failures.** Narrower, but it leaves other errors silent,
   and the classifier would then decide what the maintainer can see at all.
3. **Preflight sign-in check at start.** Rejected: see Non-goals.

The maintainer chose approach 1.

## Design

### One module owns the rule

A new module `src/kernel/provider-failure.ts` owns the definition, the
classification, the guidance text, and the read from session files. Callers do
not know the patterns.

```ts
export type ProviderFailure = {
  /** The provider's text, trimmed, at most 2000 characters. */
  readonly message: string;
  readonly signIn: boolean;
};

/** A Pi message object → a Provider failure, or undefined. */
export function providerFailure(message: unknown): ProviderFailure | undefined;

/** The newest session file in `sessionDir`: its last assistant message as a
 * Provider failure, or undefined. Never throws. */
export function lastProviderFailure(
  sessionDir: string,
): Promise<ProviderFailure | undefined>;

/** Thread entry title and text for a Web session or an Issue thread. */
export function providerFailureEntry(failure: ProviderFailure): {
  title: string;
  text: string;
};

/** One-line stop reason for an unattended phase or triage. */
export function providerFailureReason(failure: ProviderFailure): string;
```

It also exports `explainProviderFailure` (see "Unattended phases").

The module is in the kernel, because the kernel uses it, and `src/web` already
imports from the kernel. It has no dependencies except `node:fs` and
`node:path`.

### Classification

A Provider failure is a sign-in failure when its text matches one of these
patterns, without regard to letter case:

- `authenticat` (authentication, unauthenticated)
- `unauthori[sz]ed`
- `\b401\b`, `\b403\b`
- `token (has )?expired`, `expired token`
- `invalid (api )?key`, `api key (is )?(invalid|missing)`
- `(log ?in|sign ?in|re-?authenticate)` together with `again|required|expired`

The list is a heuristic. A false match adds guidance that does no harm. A missed
match still shows the provider's message. Tests pin the issue's message and one
example for each pattern, and one non-match (`Overloaded`, a 429 rate limit).

### Text

The guidance is the same on each surface. Only the "next step" differs.

| Surface         | Title (thread entry)         | Text                                                                                                                                                                                     |
| --------------- | ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Thread, sign-in | `Sign-in failed`             | `<message>` + blank line + `The model provider refused the sign-in. Run patchmill auth in the repository, then send your message again. If it fails again, press Pause and then Resume.` |
| Thread, other   | `The agent's request failed` | `<message>`                                                                                                                                                                              |
| Stop, sign-in   | —                            | `The model provider refused the request: <message> Run patchmill auth in the repository, then start the run again.`                                                                      |
| Stop, other     | —                            | `The model provider refused the request: <message>`                                                                                                                                      |

A running Pi process reads `auth.json` again when the file changes. So after
`patchmill auth`, the next message in the same Web session can succeed. Pause
and Resume is the fallback. The thread text says both.

The history of a finished run uses the same thread text. The words "send your
message again" also apply there, because Resume continues the same Console
session.

### Web session (live)

In `onMessageEnd` of `src/web/session/web-session.ts`, after the existing text
blocks of an assistant message, call `providerFailure(message)`. If it returns a
failure, add an `error` entry with `providerFailureEntry(failure)`. Text blocks
that came before the error stay. Order: text first, then the error.

Nothing else changes: `agent_settled` still sets `idle`, so the maintainer can
type at once.

When Pi retries a transient error, it records a failed message first. The page
then shows an error entry followed by the retried reply. This is correct: the
terminal Pi interface also shows the failed attempt.

### Issue thread (history)

In `projectPiThread` of `src/web/pi-thread.ts`, for each assistant message, emit
the text and tool events as today. Then, if `providerFailure(m)` returns a
failure, emit one `error` event with the id `${id}:error`. The `seen` key logic
stays.

The browser already renders `error` events (`web/thread.js`, `case "error"`).
There is no browser change.

### Unattended phases and worker phases

`run-once.ts` already calls `explainMissingResult(result, launch.sessionDir)`
for each phase run that did not time out and was not aborted. Before that call,
add `explainProviderFailure(result, launch.sessionDir)` from the new module:

```ts
/** When the result did not parse and the session ended with a Provider
 * failure, the reason becomes providerFailureReason(failure). The `missing`
 * flag stays as it was. A parsed result is returned unchanged. */
export function explainProviderFailure(
  result: ParsedResult,
  sessionDir: string,
): Promise<ParsedResult>;
```

When it changed the reason, `explainMissingResult` is not called. Its "subagent
runs were still running" note does not apply to a refused request.

`verifyOutcome` does not change. It already puts `result.reason`, the log path
and the exit code line into the stop comment, with the label `needsInfo`. A
parsed result is never changed: the agent could have recovered after the error
and finished. The `missing` flag stays, so the existing rule still applies: an
implementation that exited cleanly with a verified pull request is done.

This covers `run-once`, the `run` loop, and the worker phases of an Interactive
Issue run in the console and in a Web session. All of them go through
`run-once.ts`, and all of them write the session file to `launch.sessionDir`
(the worker launcher copies the worker's file there). The stop reason reaches
the issue comment, the CLI output, the run files, and the web board's blocked
reason through the existing paths.

"Last assistant message" means: in the newest `.jsonl` file of the directory (by
modification time), the last record with `type: "message"` and
`message.role: "assistant"`. If that message is not a Provider failure, the
function returns `undefined`. An earlier failure that Pi retried with success is
therefore never reported.

### Triage

`triageIssues` passes a `sessionDir` to `supervisePi`. When the session failed,
call `lastProviderFailure(sessionDir)`. If there is a failure, the warning is
`${providerFailureReason(failure)} Skipping.` Otherwise the current warning
stays.

## Module design

- **Owner.** `src/kernel/provider-failure.ts` owns the Provider failure rule.
  Its interface is five functions and one type. The patterns, the session-file
  format, the newest-file rule, and the text stay hidden.
- **Callers must know:** a Provider failure is only `stopReason: "error"`;
  `lastProviderFailure` never throws and returns `undefined` when it cannot
  read; `message` is at most 2000 characters.
- **Seams.** No new seam. Tests use real temporary directories and real message
  objects, as `unfinished-runs.test.ts` does.
- **Locality.** Today each surface ignores the error in its own way. After this
  change, one module decides, and four short call sites use it.

## Frontend design

Not applicable. The change uses the existing `error` thread entry and its
styles. Only the text of the entry is new. There is no new layout, interaction,
or style, so there is no mockup.

## Domain analysis

This is not an architecture change. It adds one kernel module and four short
call sites. It does not change contexts, seams, or ADRs (the repository has no
`docs/adr/`). The single-context layout of `docs/agents/domain.md` holds. One
term, **Provider failure**, is new. It goes into `GLOSSARY.md`.

## Testing

- `provider-failure.test.ts`: the classification table; `aborted` is not a
  failure; empty `errorMessage`; truncation at 2000 characters;
  `lastProviderFailure` with no directory, an empty directory, a broken line, a
  failure followed by a successful retry, and two files where the newest has the
  failure.
- `web-session.test.ts`: a failed `message_end` adds one `error` entry with the
  sign-in title, and the state becomes `idle` after `agent_settled`; a second
  failed message adds a second entry; an `aborted` message adds no entry.
- `pi-thread` history test: a failed assistant record gives one `error` event;
  text before the error stays.
- `provider-failure.test.ts` also covers `explainProviderFailure`: a parsed
  result stays unchanged; a missing result gets the provider reason and keeps
  `missing`.
- `run-once` test: a phase whose session file ends with a Provider failure stops
  with the provider reason, the log path and the exit code in the comment.
- `triage.test.ts`: a failed session with a sign-in failure in its session file
  gives the provider warning.

## Visual explanation

```mermaid
flowchart LR
  PI["Pi records assistant message<br/>stopReason: error"] --> PF["provider-failure.ts<br/>providerFailure / lastProviderFailure"]
  PF --> WS["Web session (live)<br/>error entry"]
  PF --> TH["Issue thread (history)<br/>error event"]
  PF --> VO["run-once: explainProviderFailure<br/>stop reason"]
  PF --> TR["Triage<br/>warning"]
  VO --> OUT["Issue comment, CLI, board blocked reason"]
```

```text
on assistant message end
  emit text blocks (as today)
  if stopReason == "error"
    failure = { message: errorMessage or "The request failed.", signIn: matches sign-in patterns }
    add error entry: title = signIn ? "Sign-in failed" : "The agent's request failed"
                     text  = message (+ "Run patchmill auth …" when signIn)
```

## Companion artifacts

- `GLOSSARY.md`: [Provider failure](../../GLOSSARY.md)

## Open assumptions

None.
