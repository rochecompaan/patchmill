# Patchmill Init Interactive Model Selector Design

## Context

`patchmill init` currently checks Pi readiness through Pi's model registry and
then uses a simple prompt to choose a model for the smoke test. The experience
should move toward Pi's interactive login/model flow, but the first proof of
concept should stay small: Patchmill owns a searchable model selector that
closely matches Pi's model selection UI.

Patchmill should not rely on a user's global Pi auth/config session by default.
Each software factory may have distinct provider credentials, model defaults,
and settings. The model selector POC therefore uses repository-local Pi state
under `.patchmill/pi-agent/`.

## Goals

- Add an interactive model selector to `patchmill init`.
- Show only models Pi reports as available with configured auth.
- Match the Pi model picker interaction closely enough to validate the UX
  direction.
- Persist the selected model to the repository-local Pi `settings.json`.
- Keep `patchmill.config.json` free of Pi model selection state.
- Preserve non-interactive behavior for automation.

## Non-goals

- Implement auth method/provider login UI in this POC.
- Show unavailable providers or disabled model rows.
- Reuse Pi's private `InteractiveMode` command handlers directly.
- Add a Patchmill-specific Pi extension for model selection.

## Repository-local Pi state

Patchmill will use a repository-local Pi agent directory:

```text
.patchmill/pi-agent/
```

All Patchmill-owned Pi registry checks and Pi subprocesses should run with:

```text
PI_CODING_AGENT_DIR=<repo>/.patchmill/pi-agent
```

The selector persists the chosen model to:

```text
.patchmill/pi-agent/settings.json
```

The persisted settings mirror Pi's own model selection behavior:

```json
{
  "defaultProvider": "openai-codex",
  "defaultModel": "gpt-5.5"
}
```

`defaultModel` stores the model id only. `defaultProvider` is stored with it so
Pi can restore the selected model reliably.

Existing settings in `settings.json` must be preserved. The writer only updates
`defaultProvider` and `defaultModel`.

## Init flow

1. `patchmill init` creates local Patchmill config and installs skills as it
   does today.
2. It resolves the repository-local Pi agent directory.
3. It detects available models using Pi's model registry scoped to that
   directory.
4. If no models are available, init skips the selector and shows the existing Pi
   setup incomplete guidance.
5. If models are available and init is interactive, it opens the Patchmill model
   selector.
6. The selected model is written to `.patchmill/pi-agent/settings.json`.
7. The Pi smoke test runs with the selected model.
8. Non-interactive init keeps deterministic behavior by selecting the first
   available model and writing no interactive UI.

## Selector UX

The selector should visually and behaviorally track Pi's model selector:

- Search input at the top with a `>` prompt.
- Ten visible rows at a time.
- Current active row is prefixed with an arrow.
- The persisted/current default model is marked with a checkmark.
- A count line shows the selected result and filtered total, such as `(1/30)`.
- A footer shows details for the active row, beginning with `Model Name:`.
- Typing filters models live.
- Arrow keys move selection.
- Enter selects the active model.
- Escape cancels the selector and falls back to the existing/default selection.

The result count is based on the filtered list, not the total registry size. The
visible window contains at most ten rows.

## Data model

The selector consumes the existing `PiModelChoice` shape from `pi-preflight.ts`:

```ts
type PiModelChoice = {
  provider: string;
  providerName: string;
  id: string;
  label: string;
  value: string;
  authSource?: string;
  reasoning: boolean;
  input: string[];
};
```

Filtering should search across at least:

- model id
- provider id
- provider display name
- model label
- `provider/model` value

The selected model writes:

- `defaultProvider = selected.provider`
- `defaultModel = selected.id`

The smoke test receives `selected.value` as the CLI model argument.

## Error handling

- If `settings.json` does not exist, create it with mode-appropriate parent
  directories.
- If `settings.json` contains valid JSON, preserve unrelated keys.
- If `settings.json` contains invalid JSON, fail the model persistence step with
  a clear message and continue to report Pi setup as incomplete rather than
  silently overwriting user state.
- If the terminal is not interactive, skip the selector.
- If the selector is cancelled, use the previously persisted default if
  available and still present in the available list; otherwise use the first
  available model.
- If no models match the search query, show an empty state and keep Enter
  disabled until a model is selected again.

## Testing plan

- Unit test selector state:
  - initial ten-row window
  - count formatting
  - filtering by model id/provider/label
  - selection movement
  - empty search result behavior
  - Enter and Escape outcomes
- Unit test settings persistence:
  - creates `.patchmill/pi-agent/settings.json`
  - writes `defaultProvider` and `defaultModel`
  - preserves unrelated settings keys
  - reports invalid JSON without overwriting
- Init tests:
  - interactive available models path persists selected model
  - smoke test receives selected `provider/model`
  - no available models skips selector and keeps setup guidance
  - non-interactive mode remains deterministic

## Follow-up auth UI

After this POC works, Patchmill can add an auth setup step before model
selection:

1. choose auth method
2. choose provider
3. complete API key or OAuth flow
4. refresh available models
5. open the same model selector

That follow-up should continue to use repository-local Pi state so each software
factory can own its provider credentials and model defaults.
