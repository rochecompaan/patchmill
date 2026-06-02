# Patchmill Init Auth Provider Selector Design

## Context

`patchmill init` is being refactored to use repository-local Pi state and a
Pi-like interactive model selector. The next step is to make init perform the
same kind of provider authentication setup that Pi exposes through `/login`,
while keeping Patchmill in control of the onboarding flow.

Patchmill should not shell out to `pi` for this interaction and should not
import Pi's private interactive-mode components. Instead, Patchmill should
implement its own small TUI components with `@earendil-works/pi-tui` and use
Pi's exported storage, registry, and OAuth APIs as the behavioral source of
truth.

The existing model selector worktree is the implementation baseline. This design
extends that flow so `patchmill init` starts with provider authentication, then
refreshes available models and opens the model selector.

## Goals

- Make interactive `patchmill init` always start with
  `Select authentication method:`.
- Match Pi's login UX closely for auth method selection, provider selection,
  API-key entry, OAuth/device-code login, provider-specific OAuth choices, and
  Amazon Bedrock setup guidance.
- Store credentials in repository-local Pi auth state under
  `.patchmill/pi-agent/`.
- After auth, refresh Pi's model registry and show all currently available
  models in the model selector.
- Preserve the existing model selector's repo-local `settings.json` persistence
  for `defaultProvider` and `defaultModel`.
- Abort init when the user cancels required interactive auth/model setup.
- Keep non-interactive init deterministic and explicit: it should not attempt
  TUI auth and should report incomplete provider/model configuration.

## Non-goals

- Shell out to `pi` or `npx @earendil-works/pi-ai` for auth.
- Import Pi's private `InteractiveMode`, `OAuthSelectorComponent`, or
  `LoginDialogComponent` as runtime dependencies.
- Invent Patchmill-specific credential storage formats.
- Filter the final model selector to the provider just configured.
- Add custom provider authoring or model editing UI.

## Repository-local Pi state

Patchmill continues to use:

```text
.patchmill/pi-agent/
```

Pi APIs should be constructed with explicit paths inside that directory:

```text
.patchmill/pi-agent/auth.json
.patchmill/pi-agent/models.json
.patchmill/pi-agent/settings.json
```

Pi subprocesses, including the smoke test, should run with:

```text
PI_CODING_AGENT_DIR=<repo>/.patchmill/pi-agent
```

Credential writes should mirror Pi:

- Subscription/OAuth login uses `AuthStorage.login(providerId, callbacks)`.
- API-key login writes `authStorage.set(providerId, { type: "api_key", key })`.
- Amazon Bedrock does not store an API key; it shows AWS credential guidance.

Model selection writes only the Pi-compatible local settings keys:

```json
{
  "defaultProvider": "openai-codex",
  "defaultModel": "gpt-5.5"
}
```

Existing unrelated `settings.json` keys must be preserved.

## Interactive init flow

1. Create `patchmill.config.json`, local excludes, skills, and labels as init
   does today.
2. Resolve `.patchmill/pi-agent`.
3. Construct `AuthStorage` from `.patchmill/pi-agent/auth.json` and
   `ModelRegistry` from `.patchmill/pi-agent/models.json`.
4. Open the auth method selector with title `Select authentication method:`.
5. If the user chooses `Use a subscription`, show subscription providers.
6. If the user chooses `Use an API key`, show API-key providers.
7. The user selects a provider to configure. Selecting an already-configured
   provider intentionally reruns auth and replaces that provider's stored
   credential, matching Pi's `/login` behavior.
8. Run the selected provider's auth flow.
9. Refresh the model registry.
10. Read all available models from the refreshed registry. This list must
    include models made available by any configured source, including
    environment variables exported before `patchmill init`, models.json auth,
    and the credential configured during this init run.
11. If no models are available, abort init with incomplete provider/model setup
    guidance.
12. Open the existing model selector with all available models.
13. Persist the selected provider/model to local Pi settings.
14. Run the Pi smoke test with the selected `provider/model` and repo-local
    `PI_CODING_AGENT_DIR`.
15. Print success and next steps only after auth, model persistence, and smoke
    test succeed.

## Non-interactive init flow

When stdin is not a TTY, `patchmill init` should not attempt auth TUI. It should
finish deterministic setup steps that do not require user input, then report Pi
setup as incomplete with guidance similar to:

```text
Pi provider/model setup is incomplete.
Run `patchmill init` in an interactive terminal to configure provider auth and select a model.
After setup, run `patchmill doctor`.
```

`--yes` should continue to approve deterministic prompts such as label creation;
it should not imply non-interactive provider auth.

## Auth method selector

Patchmill owns a simple TUI component using `@earendil-works/pi-tui` primitives.

Display:

```text
Select authentication method:

→ Use a subscription
  Use an API key
```

Behavior:

- Up/down move selection.
- Enter returns `oauth` for subscription or `api_key` for API key.
- Escape/ctrl+c cancels and aborts init.
- No search input is needed for this two-row selector.

## Provider selector

Patchmill owns a searchable provider selector that tracks Pi's provider
selector.

Display:

```text
Select provider to configure:

>

→ Anthropic (Claude Pro/Max) ✓ configured
  ChatGPT Plus/Pro (Codex Subscription) ✓ configured
  GitHub Copilot • unconfigured
```

For API-key mode, long provider lists should include interactive search and an
up-to-eight-row visible window, matching Pi:

```text
Select provider to configure:

>

→ Amazon Bedrock • unconfigured
  Anthropic (Claude Pro/Max) • subscription configured
  Azure OpenAI Responses • unconfigured
  Cerebras • unconfigured
  Cloudflare AI Gateway • unconfigured
  Cloudflare Workers AI • unconfigured
  DeepSeek • unconfigured
  Fireworks • unconfigured
  (1/30)
```

Provider list construction should mirror Pi:

- Subscription providers come from `authStorage.getOAuthProviders()`.
- API-key providers come from model providers in `modelRegistry.getAll()` using
  Pi-equivalent filtering:
  - built-in providers with display names are API-key login providers;
  - built-in providers without API-key login support are excluded unless Pi
    includes them;
  - OAuth provider IDs are excluded from custom API-key providers;
  - custom model providers without OAuth support are API-key providers.
- Amazon Bedrock appears in the API-key provider list and opens the Bedrock
  setup panel instead of an API-key prompt.

Status suffixes should mirror Pi as closely as practical:

- `✓ configured` when the stored credential type matches the current auth mode.
- `• subscription configured` when API-key mode sees an OAuth credential.
- `• API key configured` when subscription mode sees an API-key credential.
- `• unconfigured` when no auth source is available.
- `✓ env: <label>` for environment-backed API keys.
- `✓ runtime API key`, `✓ custom API key`, `✓ key in models.json`, and
  `✓ command in models.json` when `ModelRegistry.getProviderAuthStatus()`
  reports those sources.

Search should match provider name, provider id, and auth type. The count line is
shown when the filtered list is longer than the visible window or when scrolling
is active.

## Auth execution

### Subscription/OAuth providers

Patchmill should call:

```ts
await authStorage.login(providerId, callbacks);
```

Patchmill-owned TUI dialog callbacks:

- `onAuth(info)` shows the browser URL and optional instructions.
- `onDeviceCode(info)` shows verification URI, user code, and waiting state.
- `onPrompt(prompt)` asks for provider-specific text input.
- `onManualCodeInput()` supports paste-redirect-url flows for providers with a
  callback server.
- `onSelect(prompt)` opens a small Pi-like selector for provider-specific OAuth
  choices and returns the selected option id.
- `onProgress(message)` updates the waiting/progress text.
- `signal` is tied to the dialog's abort controller so escape/ctrl+c cancels the
  provider login.

On success, `AuthStorage.login` persists OAuth credentials in repo-local
`auth.json`.

### API-key providers

Patchmill should show a Pi-like login dialog titled for the selected provider
and prompt:

```text
Enter API key:
```

Behavior:

- Empty input is rejected without silently continuing. Prefer staying in the
  prompt with a validation message.
- Escape/ctrl+c cancels and aborts init.
- On valid input, write:

```ts
authStorage.set(providerId, { type: "api_key", key: apiKey });
```

The literal key is stored because this design intentionally follows Pi's
`/login` behavior.

### Amazon Bedrock

Selecting Amazon Bedrock in API-key mode shows Pi-equivalent informational
content instead of a key prompt:

```text
Amazon Bedrock setup

Amazon Bedrock uses AWS credentials instead of a single API key.
Configure an AWS profile, IAM keys, bearer token, or role-based credentials.
See:
  <path-to-pi-docs>/providers.md

(escape/ctrl+c to close)
```

Closing this panel is not a cancellation. It completes the provider setup step
and proceeds to registry refresh. If AWS credentials are not available, the
refreshed registry will have no Bedrock models and init can report incomplete
provider/model configuration.

## Model selector after auth

After auth or Bedrock setup, Patchmill must refresh the registry and pass all
available models to the model selector:

```ts
const availableModels = modelRegistry.getAvailable();
```

Do not filter this list to the provider just configured. A user may already have
an API key in the environment and may additionally configure a subscription
during init. The model selector should show every model currently available from
all configured sources.

If the user cancels model selection, init aborts. Model selection is required
once interactive provider setup has begun.

## Error handling

- Cancel auth method selection: abort init.
- Cancel provider selection: abort init.
- Cancel OAuth/API-key dialog: abort init.
- OAuth provider failure: abort init with the provider error message.
- Empty API key: remain in prompt with validation, or fail that prompt clearly;
  do not store an empty credential.
- Bedrock info close: proceed to refresh/check availability.
- No available models after auth: abort init with incomplete provider/model
  guidance.
- Cancel model selector: abort init.
- Invalid local `settings.json`: fail clearly without overwriting it.
- Invalid local `auth.json`: surface the `AuthStorage` load error and abort
  interactive auth rather than overwriting unknown user state.
- Smoke test failure: keep existing incomplete setup reporting and suggest
  `patchmill doctor` after fixing credentials.

## Components and modules

Suggested focused modules:

- `pi-agent-settings.ts`
  - Existing repo-local Pi path/settings helpers.
- `pi-auth-provider-state.ts`
  - Pure provider list construction, filtering, visible-window calculation,
    count formatting, and status label formatting.
- `pi-auth-selector.ts`
  - Auth method selector runner/component.
- `pi-auth-provider-selector.ts`
  - Searchable provider selector runner/component.
- `pi-auth-dialog.ts`
  - API-key, OAuth/device-code/progress/manual-code, and Bedrock info dialogs.
- `pi-auth-flow.ts`
  - Auth orchestration using `AuthStorage` and `ModelRegistry`.
- `pi-model-selector-state.ts` and `pi-model-selector.ts`
  - Existing model selector state and TUI.
- `pi-model-selection.ts`
  - Continue to persist selected default model after receiving refreshed
    available models.
- `main.ts`
  - Wire init flow, cancellation, non-interactive reporting, registry refresh,
    model selection, and smoke test.

## Testing plan

### Pure state tests

- Auth method selector maps rows to `oauth` and `api_key`.
- Provider list construction includes subscription providers from
  `authStorage.getOAuthProviders()`.
- Provider list construction includes API-key providers from registry models
  using Pi-equivalent filtering.
- Provider filtering searches name, id, and auth type.
- Provider visible window limits to eight rows and reports `(selected/filtered)`
  when appropriate.
- Status suffix formatting covers configured, unconfigured, cross-mode
  configured, env, runtime, fallback, models.json key, and models.json command.

### Auth flow tests

- Subscription path calls `authStorage.login` with callbacks and persists OAuth
  credentials through the fake storage.
- OAuth `onSelect` uses a selector and returns option ids.
- OAuth cancellation propagates an init-aborting cancellation result.
- API-key path stores `{ type: "api_key", key }` for the selected provider.
- Empty API key is rejected and not stored.
- Bedrock path shows setup info and stores no credential.
- Registry refresh happens after successful auth/Bedrock setup.

### Init integration tests

- Interactive init starts with auth method selection before provider/model
  selection.
- Subscription path configures provider auth, refreshes registry, shows all
  available models, persists selected model, and smoke-tests it.
- API-key path configures provider auth, refreshes registry, shows all available
  models, persists selected model, and smoke-tests it.
- Available models from pre-existing environment or models.json auth remain in
  the model selector after newly configured auth.
- Cancelling auth method/provider/API-key/OAuth/model selection aborts init.
- Non-interactive init reports incomplete provider/model config without invoking
  auth selectors.
- Bedrock selection shows guidance and then reports incomplete setup if no
  models become available.

### Verification

- Focused `node --test` for new state/auth modules.
- Focused init integration tests.
- Full `npm test`.
- `npm run lint`.
- `npm run build`.

## Migration impact

This design keeps `patchmill.config.json` unchanged. Provider credentials and
model defaults remain local Patchmill/Pi state under `.patchmill/pi-agent/`, so
existing repositories do not need config migration.

The init messaging should change from instructing users to run Pi manually for
`/login` toward Patchmill's own interactive provider/model setup. Doctor can
continue to validate readiness using the same repo-local Pi agent directory.
