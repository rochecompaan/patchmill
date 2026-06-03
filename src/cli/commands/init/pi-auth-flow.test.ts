import assert from "node:assert/strict";
import { test } from "node:test";
import {
  runInteractivePiAuthSetup,
  type PiAuthFlowRegistry,
  type PiAuthFlowStorage,
} from "./pi-auth-flow.ts";
import type {
  AuthCredential,
  AuthStatus,
} from "@earendil-works/pi-coding-agent";
import type { PiModelChoice, PiReadiness } from "./pi-preflight.ts";

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

function fakeStorage(
  options: {
    oauthProviders?: Array<{ id: string; name: string }>;
    credentials?: Record<string, AuthCredential>;
    statuses?: Record<string, AuthStatus>;
  } = {},
) {
  const credentials = { ...(options.credentials ?? {}) };
  const setCalls: Array<[string, AuthCredential]> = [];
  const loginCalls: string[] = [];
  const storage: PiAuthFlowStorage & {
    setCalls: Array<[string, AuthCredential]>;
    loginCalls: string[];
  } = {
    setCalls,
    loginCalls,
    getOAuthProviders: () => options.oauthProviders ?? [],
    get: (provider) => credentials[provider],
    getAuthStatus: (provider) =>
      options.statuses?.[provider] ?? {
        configured: Boolean(credentials[provider]),
        source: credentials[provider] ? "stored" : undefined,
      },
    set: (provider, credential) => {
      credentials[provider] = credential;
      setCalls.push([provider, credential]);
    },
    login: async (provider) => {
      credentials[provider] = {
        type: "oauth",
        refresh: "refresh",
        access: "access",
        expires: 1,
      };
      loginCalls.push(provider);
    },
  };
  return storage;
}

function fakeRegistry(
  options: {
    allModels?: ReturnType<typeof model>[];
    availableModels?: ReturnType<typeof model>[];
    names?: Record<string, string>;
    statuses?: Record<string, AuthStatus>;
  } = {},
) {
  let refreshed = 0;
  const registry: PiAuthFlowRegistry & { refreshCount: () => number } = {
    refreshCount: () => refreshed,
    refresh: () => {
      refreshed += 1;
    },
    getAll: () => options.allModels ?? [],
    getAvailable: () => options.availableModels ?? [],
    getError: () => undefined,
    getProviderAuthStatus: (provider) =>
      options.statuses?.[provider] ?? { configured: false },
    getProviderDisplayName: (provider) => options.names?.[provider] ?? provider,
  };
  return registry;
}

test("runInteractivePiAuthSetup stores API key auth, refreshes registry, and selects a refreshed model", async () => {
  const storage = fakeStorage();
  const registry = fakeRegistry({
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
    authStorage: storage,
    registry,
    selectAuthMethod: async () => "api_key",
    selectProvider: async ({ choices }) => choices[0],
    promptApiKey: async () => "sk-ant-test",
    showBedrockInfo: async () => undefined,
    selectModelInteractively: async ({ models }) => {
      selectorModels = models;
      return choice("anthropic");
    },
  });

  assert.deepEqual(storage.setCalls, [
    ["anthropic", { type: "api_key", key: "sk-ant-test" }],
  ]);
  assert.equal(registry.refreshCount(), 1);
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

test("runInteractivePiAuthSetup calls OAuth login for subscription setup", async () => {
  const storage = fakeStorage({
    oauthProviders: [{ id: "openai-codex", name: "ChatGPT Plus/Pro" }],
  });
  const registry = fakeRegistry({
    availableModels: [model("openai-codex", "gpt-5.5")],
  });

  const result = await runInteractivePiAuthSetup({
    repoRoot: "/repo",
    agentDir: "/repo/.patchmill/pi-agent",
    currentDefault: undefined,
    initialReadiness: missingReadiness(),
    authStorage: storage,
    registry,
    selectAuthMethod: async () => "oauth",
    selectProvider: async ({ choices }) => choices[0],
    promptApiKey: async () => "unused",
    showBedrockInfo: async () => undefined,
    selectModelInteractively: async ({ models }) =>
      choice(models[0]?.provider, models[0]?.id),
  });

  assert.deepEqual(storage.loginCalls, ["openai-codex"]);
  assert.equal(registry.refreshCount(), 1);
  assert.equal(result.selection.status, "selected");
});

test("runInteractivePiAuthSetup shows Bedrock guidance without storing a key", async () => {
  const storage = fakeStorage();
  const registry = fakeRegistry({
    allModels: [model("amazon-bedrock", "us.anthropic.claude")],
    availableModels: [],
    names: { "amazon-bedrock": "Amazon Bedrock" },
  });
  let bedrockShown = false;

  const result = await runInteractivePiAuthSetup({
    repoRoot: "/repo",
    agentDir: "/repo/.patchmill/pi-agent",
    currentDefault: undefined,
    initialReadiness: missingReadiness(),
    authStorage: storage,
    registry,
    selectAuthMethod: async () => "api_key",
    selectProvider: async ({ choices }) => choices[0],
    promptApiKey: async () => "unused",
    showBedrockInfo: async () => {
      bedrockShown = true;
    },
    selectModelInteractively: async () => undefined,
  });

  assert.equal(bedrockShown, true);
  assert.deepEqual(storage.setCalls, []);
  assert.equal(registry.refreshCount(), 1);
  assert.equal(result.selection.status, "unavailable");
  assert.equal(
    result.selection.status === "unavailable" && result.selection.reason,
    "not-ready",
  );
});

test("runInteractivePiAuthSetup treats cancelled auth method as cancelled selection", async () => {
  const result = await runInteractivePiAuthSetup({
    repoRoot: "/repo",
    agentDir: "/repo/.patchmill/pi-agent",
    currentDefault: undefined,
    initialReadiness: missingReadiness(),
    authStorage: fakeStorage(),
    registry: fakeRegistry(),
    selectAuthMethod: async () => undefined,
    selectProvider: async () => undefined,
    promptApiKey: async () => undefined,
    showBedrockInfo: async () => undefined,
    selectModelInteractively: async () => undefined,
  });

  assert.equal(result.selection.status, "unavailable");
  assert.equal(
    result.selection.status === "unavailable" && result.selection.reason,
    "cancelled",
  );
});

test("runInteractivePiAuthSetup rejects an empty API key", async () => {
  const storage = fakeStorage();
  const result = await runInteractivePiAuthSetup({
    repoRoot: "/repo",
    agentDir: "/repo/.patchmill/pi-agent",
    currentDefault: undefined,
    initialReadiness: missingReadiness(),
    authStorage: storage,
    registry: fakeRegistry({ allModels: [model("anthropic")] }),
    selectAuthMethod: async () => "api_key",
    selectProvider: async ({ choices }) => choices[0],
    promptApiKey: async () => "   ",
    showBedrockInfo: async () => undefined,
    selectModelInteractively: async () => undefined,
  });

  assert.deepEqual(storage.setCalls, []);
  assert.equal(result.selection.status, "unavailable");
  assert.equal(
    result.selection.status === "unavailable" && result.selection.reason,
    "invalid-selection",
  );
  assert.match(result.selection.message, /API key cannot be empty/);
});
