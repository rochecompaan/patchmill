import assert from "node:assert/strict";
import { test } from "node:test";
import { runInteractivePiAuthSetup } from "./pi-auth-flow.ts";
import type { PiModelChoice, PiReadiness } from "./pi-preflight.ts";
import type {
  PatchmillPiRuntime,
  PiAuthInteraction,
  PiAuthMode,
  PiCredentialStatus,
  PiCredential,
} from "./pi-runtime.ts";

function missingReadiness(): PiReadiness {
  return {
    status: "missing",
    message: "Pi did not report any provider/model with configured auth.",
    models: [],
  };
}

function model(provider = "anthropic", id = "claude-sonnet-4-5") {
  return {
    provider,
    id,
    name: id,
    reasoning: true,
    input: ["text"],
  };
}

function choice(
  provider = "anthropic",
  id = "claude-sonnet-4-5",
): PiModelChoice {
  return {
    provider,
    providerName: provider,
    id,
    label: `${provider} / ${id}`,
    value: `${provider}/${id}`,
    authSource: "stored",
    reasoning: true,
    input: ["text"],
  };
}

function fakeRuntime(
  options: {
    oauthProviders?: Array<{ id: string; name: string }>;
    credentials?: Record<string, PiCredential>;
    statuses?: Record<string, PiCredentialStatus>;
    allModels?: ReturnType<typeof model>[];
    availableModels?: ReturnType<typeof model>[];
    names?: Record<string, string>;
    apiKeyPrompts?: Array<Parameters<PiAuthInteraction["prompt"]>[0]>;
  } = {},
) {
  const credentials = { ...(options.credentials ?? {}) };
  const loginCalls: Array<{ provider: string; mode: PiAuthMode }> = [];
  let refreshed = 0;
  const runtime: PatchmillPiRuntime & {
    loginCalls: typeof loginCalls;
    refreshCount: () => number;
  } = {
    loginCalls,
    refreshCount: () => refreshed,
    refresh: async () => {
      refreshed += 1;
    },
    getError: () => undefined,
    getAll: () => options.allModels ?? [],
    getAvailable: () => options.availableModels ?? [],
    getApiKeyProviders: () =>
      Array.from(
        new Set((options.allModels ?? []).map((item) => item.provider)),
      )
        .filter((provider) => provider.length > 0)
        .map((provider) => ({
          id: provider,
          name: options.names?.[provider] ?? provider,
        })),
    getOAuthProviders: () => options.oauthProviders ?? [],
    get: (provider) => credentials[provider],
    getProviderCredentialState: (provider) =>
      options.statuses?.[provider] ?? {
        configured: Boolean(credentials[provider]),
        source: credentials[provider] ? "stored" : undefined,
      },
    getProviderDisplayName: (provider) => options.names?.[provider] ?? provider,
    login: async (provider, mode, interaction: PiAuthInteraction) => {
      if (mode === "api_key") {
        const prompts = options.apiKeyPrompts ?? [
          {
            type: "secret" as const,
            message: "Enter API key:",
          },
        ];
        const values = [];
        for (const prompt of prompts) {
          values.push(await interaction.prompt(prompt));
        }
        loginCalls.push({ provider, mode });
        credentials[provider] = { type: "api_key", key: values[0] };
        return credentials[provider];
      }
      loginCalls.push({ provider, mode });
      credentials[provider] = {
        type: "oauth",
        refresh: "refresh",
        access: "access",
        expires: 1,
      };
      return credentials[provider];
    },
  };
  return runtime;
}

test("runInteractivePiAuthSetup stores API key auth, refreshes registry, and selects a refreshed model", async () => {
  const runtime = fakeRuntime({
    allModels: [model("anthropic")],
    availableModels: [model("anthropic")],
    names: { anthropic: "Anthropic" },
  });
  let selectorModels: PiModelChoice[] = [];

  const result = await runInteractivePiAuthSetup({
    repoRoot: "/repo",
    agentDir: "/repo/.patchmill/pi-agent",
    currentDefault: undefined,
    initialReadiness: missingReadiness(),
    runtime,
    selectAuthMethod: async () => "api_key",
    selectProvider: async ({ choices }) => choices[0],
    promptApiKey: async () => "sk-ant-test",
    selectModelInteractively: async ({ models }) => {
      selectorModels = models;
      return choice("anthropic");
    },
  });

  assert.deepEqual(runtime.loginCalls, [
    { provider: "anthropic", mode: "api_key" },
  ]);
  assert.equal(runtime.get("anthropic")?.type, "api_key");
  assert.equal(runtime.refreshCount(), 1);
  assert.deepEqual(
    selectorModels.map((selected) => selected.value),
    ["anthropic/claude-sonnet-4-5"],
  );
  assert.equal(result.selection.status, "selected");
  assert.equal(
    result.selection.status === "selected" && result.selection.model,
    "anthropic/claude-sonnet-4-5",
  );
});

test("runInteractivePiAuthSetup routes provider-owned API-key text prompts through generic prompt callbacks", async () => {
  const runtime = fakeRuntime({
    allModels: [model("cloudflare", "workers-ai")],
    availableModels: [model("cloudflare", "workers-ai")],
    names: { cloudflare: "Cloudflare" },
    apiKeyPrompts: [
      { type: "secret", message: "Enter API key:" },
      { type: "text", message: "Enter Cloudflare account ID:" },
    ],
  });
  const genericPrompts: Array<{
    message: string;
    placeholder?: string;
    allowEmpty?: boolean;
  }> = [];

  await runInteractivePiAuthSetup({
    repoRoot: "/repo",
    agentDir: "/repo/.patchmill/pi-agent",
    currentDefault: undefined,
    initialReadiness: missingReadiness(),
    runtime,
    selectAuthMethod: async () => "api_key",
    selectProvider: async ({ choices }) => choices[0],
    promptApiKey: async () => "sk-cloudflare-test",
    selectModelInteractively: async ({ models }) =>
      choice(models[0]?.provider, models[0]?.id),
    oauthCallbacks: () => ({
      onAuth: () => undefined,
      onDeviceCode: () => undefined,
      onPrompt: async (prompt) => {
        genericPrompts.push(prompt);
        return "account-id";
      },
      onSelect: async () => undefined,
    }),
  });

  assert.deepEqual(runtime.loginCalls, [
    { provider: "cloudflare", mode: "api_key" },
  ]);
  assert.deepEqual(genericPrompts, [
    {
      message: "Enter Cloudflare account ID:",
      placeholder: undefined,
      allowEmpty: true,
    },
  ]);
});

test("runInteractivePiAuthSetup calls OAuth login for subscription setup", async () => {
  const runtime = fakeRuntime({
    oauthProviders: [{ id: "openai-codex", name: "ChatGPT Plus/Pro" }],
    availableModels: [model("openai-codex", "gpt-5.5")],
  });

  const result = await runInteractivePiAuthSetup({
    repoRoot: "/repo",
    agentDir: "/repo/.patchmill/pi-agent",
    currentDefault: undefined,
    initialReadiness: missingReadiness(),
    runtime,
    selectAuthMethod: async () => "oauth",
    selectProvider: async ({ choices }) => choices[0],
    promptApiKey: async () => "unused",
    selectModelInteractively: async ({ models }) =>
      choice(models[0]?.provider, models[0]?.id),
  });

  assert.deepEqual(runtime.loginCalls, [
    { provider: "openai-codex", mode: "oauth" },
  ]);
  assert.equal(runtime.refreshCount(), 1);
  assert.equal(result.selection.status, "selected");
});

test("runInteractivePiAuthSetup runs Bedrock through persisted API-key login prompts", async () => {
  const runtime = fakeRuntime({
    allModels: [model("amazon-bedrock", "us.anthropic.claude")],
    availableModels: [model("amazon-bedrock", "us.anthropic.claude")],
    names: { "amazon-bedrock": "Amazon Bedrock" },
    apiKeyPrompts: [
      {
        type: "select",
        message: "Select Amazon Bedrock authentication method:",
        options: [
          { id: "bearer-token", label: "Bearer token" },
          { id: "aws-profile", label: "AWS profile" },
          { id: "credential-chain", label: "Existing AWS credential chain" },
        ],
      },
      { type: "text", message: "Enter AWS profile name" },
    ],
  });
  const selectPrompts: Array<{
    message: string;
    options: Array<{ id: string; label: string }>;
  }> = [];
  const textPrompts: Array<{
    message: string;
    placeholder?: string;
    allowEmpty?: boolean;
  }> = [];

  const result = await runInteractivePiAuthSetup({
    repoRoot: "/repo",
    agentDir: "/repo/.patchmill/pi-agent",
    currentDefault: undefined,
    initialReadiness: missingReadiness(),
    runtime,
    selectAuthMethod: async () => "api_key",
    selectProvider: async ({ choices }) => choices[0],
    promptApiKey: async () => "unused",
    selectModelInteractively: async ({ models }) =>
      choice(models[0]?.provider, models[0]?.id),
    oauthCallbacks: () => ({
      onAuth: () => undefined,
      onDeviceCode: () => undefined,
      onPrompt: async (prompt) => {
        textPrompts.push(prompt);
        return "dev-profile";
      },
      onSelect: async (prompt) => {
        selectPrompts.push(prompt);
        return "aws-profile";
      },
    }),
  });

  assert.deepEqual(runtime.loginCalls, [
    { provider: "amazon-bedrock", mode: "api_key" },
  ]);
  assert.deepEqual(selectPrompts, [
    {
      message: "Select Amazon Bedrock authentication method:",
      options: [
        { id: "bearer-token", label: "Bearer token" },
        { id: "aws-profile", label: "AWS profile" },
        { id: "credential-chain", label: "Existing AWS credential chain" },
      ],
    },
  ]);
  assert.deepEqual(textPrompts, [
    {
      message: "Enter AWS profile name",
      placeholder: undefined,
      allowEmpty: true,
    },
  ]);
  assert.equal(runtime.refreshCount(), 1);
  assert.equal(result.selection.status, "selected");
});

test("runInteractivePiAuthSetup treats cancelled auth method as cancelled selection", async () => {
  const result = await runInteractivePiAuthSetup({
    repoRoot: "/repo",
    agentDir: "/repo/.patchmill/pi-agent",
    currentDefault: undefined,
    initialReadiness: missingReadiness(),
    runtime: fakeRuntime(),
    selectAuthMethod: async () => undefined,
    selectProvider: async () => undefined,
    promptApiKey: async () => undefined,
    selectModelInteractively: async () => undefined,
  });

  assert.equal(result.selection.status, "unavailable");
  assert.equal(
    result.selection.status === "unavailable" && result.selection.reason,
    "cancelled",
  );
});

test("runInteractivePiAuthSetup rejects an empty API key", async () => {
  const runtime = fakeRuntime({ allModels: [model("anthropic")] });
  const result = await runInteractivePiAuthSetup({
    repoRoot: "/repo",
    agentDir: "/repo/.patchmill/pi-agent",
    currentDefault: undefined,
    initialReadiness: missingReadiness(),
    runtime,
    selectAuthMethod: async () => "api_key",
    selectProvider: async ({ choices }) => choices[0],
    promptApiKey: async () => "   ",
    selectModelInteractively: async () => undefined,
  });

  assert.deepEqual(runtime.loginCalls, []);
  assert.equal(result.selection.status, "unavailable");
  assert.equal(
    result.selection.status === "unavailable" && result.selection.reason,
    "invalid-selection",
  );
  assert.match(result.selection.message, /API key cannot be empty/);
});
