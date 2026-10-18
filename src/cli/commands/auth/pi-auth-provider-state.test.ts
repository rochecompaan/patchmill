import assert from "node:assert/strict";
import { test } from "node:test";
import {
  AUTH_METHOD_CHOICES,
  authProviderChoiceRows,
  createAuthProviderChoices,
  createProviderSelectorState,
  formatProviderSelectorCount,
  moveProviderSelection,
  searchProviderSelector,
  visibleProviderRows,
  type AuthProviderChoice,
} from "./pi-auth-provider-state.ts";
import type { PiCredentialStatus, PiCredential } from "./pi-runtime.ts";

type FakeModel = { provider: string; id: string; name?: string };

function runtime(
  options: {
    oauth?: Array<{ id: string; name: string }>;
    credentials?: Record<string, PiCredential>;
    statuses?: Record<string, PiCredentialStatus>;
    models?: FakeModel[];
    names?: Record<string, string>;
    apiKey?: Array<{ id: string; name: string }>;
  } = {},
) {
  const credentials = options.credentials ?? {};
  const statuses = options.statuses ?? {};
  return {
    getOAuthProviders: () => options.oauth ?? [],
    getApiKeyProviders: () =>
      options.apiKey ??
      Array.from(new Set((options.models ?? []).map((model) => model.provider)))
        .filter((provider) => provider.length > 0)
        .map((provider) => ({
          id: provider,
          name: options.names?.[provider] ?? provider,
        })),
    get: (provider: string) => credentials[provider],
    getAll: () => options.models ?? [],
    getProviderDisplayName: (provider: string) =>
      options.names?.[provider] ?? provider,
    getProviderCredentialState: (provider: string) =>
      statuses[provider] ?? {
        configured: Boolean(credentials[provider]),
        source: credentials[provider] ? "stored" : undefined,
      },
  };
}

function labels(choices: AuthProviderChoice[]): string[] {
  return choices.map((choice) => choice.label);
}

function providerChoices(
  count: number,
  idPrefix = "provider",
): AuthProviderChoice[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `${idPrefix}-${index + 1}`,
    name: `Provider ${index + 1}`,
    mode: "api_key" as const,
    label: `Provider ${index + 1} • unconfigured`,
    statusLabel: "• unconfigured",
  }));
}

test("auth method choices match Patchmill init prompt order", () => {
  assert.deepEqual(AUTH_METHOD_CHOICES, [
    { mode: "oauth", label: "Use a subscription" },
    { mode: "api_key", label: "Use an API key" },
  ]);
});

test("createAuthProviderChoices lists subscription providers with configured status", () => {
  const choices = createAuthProviderChoices({
    mode: "oauth",
    runtime: runtime({
      oauth: [
        { id: "anthropic", name: "Anthropic (Claude Pro/Max)" },
        { id: "openai-codex", name: "ChatGPT Plus/Pro" },
      ],
      credentials: {
        anthropic: {
          type: "oauth",
          refresh: "refresh",
          access: "access",
          expires: 1,
        },
      },
    }),
  });

  assert.deepEqual(labels(choices), [
    "Anthropic (Claude Pro/Max) ✓ configured",
    "ChatGPT Plus/Pro • unconfigured",
  ]);
  assert.deepEqual(
    choices.map((choice) => choice.id),
    ["anthropic", "openai-codex"],
  );
});

test("createAuthProviderChoices lists API-key providers exposed by the runtime", () => {
  const choices = createAuthProviderChoices({
    mode: "api_key",
    runtime: runtime({
      models: [
        { provider: "anthropic", id: "claude-sonnet-4-5" },
        { provider: "anthropic", id: "claude-opus-4-1" },
        { provider: "amazon-bedrock", id: "us.anthropic.claude" },
        { provider: "custom-proxy", id: "llama" },
      ],
      names: {
        anthropic: "Anthropic",
        "amazon-bedrock": "Amazon Bedrock",
        "custom-proxy": "Custom Proxy",
      },
    }),
  });

  assert.deepEqual(labels(choices), [
    "Amazon Bedrock • unconfigured",
    "Anthropic • unconfigured",
    "Custom Proxy • unconfigured",
  ]);
});

test("createAuthProviderChoices excludes model providers without API-key login support", () => {
  const choices = createAuthProviderChoices({
    mode: "api_key",
    runtime: runtime({
      apiKey: [{ id: "anthropic", name: "Anthropic" }],
      models: [
        { provider: "anthropic", id: "claude-sonnet-4-5" },
        { provider: "openai-codex", id: "gpt-5.5" },
      ],
      names: {
        anthropic: "Anthropic",
        "openai-codex": "OpenAI Codex",
      },
    }),
  });

  assert.deepEqual(
    choices.map((choice) => choice.id),
    ["anthropic"],
  );
});

test("createAuthProviderChoices renders cross-mode and external auth status labels", () => {
  const choices = createAuthProviderChoices({
    mode: "api_key",
    runtime: runtime({
      credentials: {
        anthropic: {
          type: "oauth",
          refresh: "refresh",
          access: "access",
          expires: 1,
        },
        openai: { type: "api_key", key: "sk-test" },
      },
      models: [
        { provider: "anthropic", id: "claude" },
        { provider: "openai", id: "gpt" },
        { provider: "google", id: "gemini" },
        { provider: "custom", id: "local" },
        { provider: "commanded", id: "cmd" },
      ],
      names: {
        anthropic: "Anthropic",
        openai: "OpenAI",
        google: "Google Gemini",
        custom: "Custom",
        commanded: "Commanded",
      },
      statuses: {
        google: {
          configured: true,
          source: "environment",
          label: "GEMINI_API_KEY",
        },
        custom: { configured: true, source: "models_json_key" },
        commanded: { configured: true, source: "models_json_command" },
      },
    }),
  });

  assert.deepEqual(labels(choices), [
    "Anthropic • subscription configured",
    "Commanded ✓ command in models.json",
    "Custom ✓ key in models.json",
    "Google Gemini ✓ env: GEMINI_API_KEY",
    "OpenAI ✓ configured",
  ]);
});

test("provider selector search matches id, name, and status", () => {
  const state = createProviderSelectorState([
    {
      id: "anthropic",
      name: "Anthropic",
      mode: "api_key",
      label: "Anthropic • subscription configured",
      statusLabel: "• subscription configured",
    },
    {
      id: "google",
      name: "Google Gemini",
      mode: "api_key",
      label: "Google Gemini ✓ env: GEMINI_API_KEY",
      statusLabel: "✓ env: GEMINI_API_KEY",
    },
  ]);

  assert.deepEqual(
    visibleProviderRows(searchProviderSelector(state, "gemini")).map(
      (row) => row.choice.id,
    ),
    ["google"],
  );
  assert.deepEqual(
    visibleProviderRows(searchProviderSelector(state, "subscription")).map(
      (row) => row.choice.id,
    ),
    ["anthropic"],
  );
});

test("visibleProviderRows limits to eight rows and reports row labels", () => {
  const choices = Array.from({ length: 10 }, (_, index) => ({
    id: `provider-${index + 1}`,
    name: `Provider ${index + 1}`,
    mode: "api_key" as const,
    label: `Provider ${index + 1} • unconfigured`,
    statusLabel: "• unconfigured",
  }));
  const rows = visibleProviderRows(createProviderSelectorState(choices));

  assert.equal(rows.length, 8);
  assert.equal(rows[0]?.selected, true);
  assert.deepEqual(authProviderChoiceRows(rows).slice(0, 2), [
    "→ Provider 1 • unconfigured",
    "  Provider 2 • unconfigured",
  ]);
});

test("visibleProviderRows keeps item 14 of 39 in view", () => {
  const state = moveProviderSelection(
    createProviderSelectorState(providerChoices(39)),
    13,
  );

  const rows = visibleProviderRows(state);

  assert.deepEqual(
    rows.map((row) => row.choice.id),
    [
      "provider-7",
      "provider-8",
      "provider-9",
      "provider-10",
      "provider-11",
      "provider-12",
      "provider-13",
      "provider-14",
    ],
  );
  assert.equal(rows.length, 8);
  assert.equal(rows.at(-1)?.selected, true);
  assert.equal(rows.filter((row) => row.selected).length, 1);
  assert.equal(formatProviderSelectorCount(state), "(14/39)");
});

test("visibleProviderRows follows selection across both wrap boundaries", () => {
  let state = moveProviderSelection(
    createProviderSelectorState(providerChoices(39)),
    -1,
  );

  let rows = visibleProviderRows(state);
  assert.deepEqual(
    rows.map((row) => row.choice.id),
    [
      "provider-32",
      "provider-33",
      "provider-34",
      "provider-35",
      "provider-36",
      "provider-37",
      "provider-38",
      "provider-39",
    ],
  );
  assert.equal(rows.at(-1)?.selected, true);

  state = moveProviderSelection(state, 1);
  rows = visibleProviderRows(state);
  assert.deepEqual(
    rows.map((row) => row.choice.id),
    [
      "provider-1",
      "provider-2",
      "provider-3",
      "provider-4",
      "provider-5",
      "provider-6",
      "provider-7",
      "provider-8",
    ],
  );
  assert.equal(rows[0]?.selected, true);
});

test("visibleProviderRows follows selection within filtered results", () => {
  const choices = [
    ...providerChoices(12, "matching"),
    ...providerChoices(4, "other"),
  ];
  let state = searchProviderSelector(
    createProviderSelectorState(choices),
    "matching",
  );

  assert.equal(state.selectedIndex, 0);
  assert.equal(visibleProviderRows(state)[0]?.choice.id, "matching-1");

  state = moveProviderSelection(state, 8);
  const rows = visibleProviderRows(state);
  assert.deepEqual(
    rows.map((row) => row.choice.id),
    [
      "matching-2",
      "matching-3",
      "matching-4",
      "matching-5",
      "matching-6",
      "matching-7",
      "matching-8",
      "matching-9",
    ],
  );
  assert.equal(rows.at(-1)?.selected, true);
  assert.equal(formatProviderSelectorCount(state), "(9/12)");
});

test("visibleProviderRows preserves lists of eight or fewer", () => {
  const state = createProviderSelectorState(providerChoices(8));
  const rows = visibleProviderRows(state);

  assert.deepEqual(
    rows.map((row) => row.choice.id),
    [
      "provider-1",
      "provider-2",
      "provider-3",
      "provider-4",
      "provider-5",
      "provider-6",
      "provider-7",
      "provider-8",
    ],
  );
  assert.equal(rows[0]?.selected, true);
  assert.equal(formatProviderSelectorCount(state), "");
});

test("visibleProviderRows preserves empty search results", () => {
  const state = searchProviderSelector(
    createProviderSelectorState(providerChoices(8)),
    "not-present",
  );

  assert.deepEqual(visibleProviderRows(state), []);
  assert.equal(formatProviderSelectorCount(state), "");
});
