import assert from "node:assert/strict";
import { test } from "node:test";
import {
  AUTH_METHOD_CHOICES,
  authProviderChoiceRows,
  createAuthProviderChoices,
  createProviderSelectorState,
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
  } = {},
) {
  const credentials = options.credentials ?? {};
  const statuses = options.statuses ?? {};
  return {
    getOAuthProviders: () => options.oauth ?? [],
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

test("createAuthProviderChoices lists unique API-key providers from all registry models", () => {
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
