import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createModelRuntimeAdapter,
  repoLocalPiRuntimePaths,
  type ModelRuntimeLike,
  type PiCredential,
} from "./pi-runtime.ts";

function fakeRuntime() {
  const calls: Array<{ provider: string; mode: "api_key" | "oauth" }> = [];
  let refreshCount = 0;
  const runtime: ModelRuntimeLike & {
    calls: typeof calls;
    refreshCount: () => number;
  } = {
    calls,
    refreshCount: () => refreshCount,
    refresh: async () => {
      refreshCount += 1;
      return { aborted: false, errors: new Map() };
    },
    getError: () => undefined,
    getModels: () => [
      {
        provider: "anthropic",
        id: "claude-sonnet-4-5",
        name: "Claude Sonnet 4.5",
        reasoning: true,
        input: ["text"],
      },
      {
        provider: "openai",
        id: "gpt-5.5",
        name: "GPT 5.5",
        reasoning: true,
        input: ["text"],
      },
    ],
    getAvailableSnapshot: () => [
      {
        provider: "anthropic",
        id: "claude-sonnet-4-5",
        name: "Claude Sonnet 4.5",
        reasoning: true,
        input: ["text"],
      },
    ],
    getProviders: () => [
      {
        id: "anthropic",
        name: "Anthropic",
        auth: {
          apiKey: { login: async () => ({ type: "api_key", key: "sk" }) },
          oauth: {
            name: "Claude Pro/Max",
            login: async () => ({
              type: "oauth",
              refresh: "r",
              access: "a",
              expires: 1,
            }),
          },
        },
      },
      {
        id: "openai",
        name: "OpenAI",
        auth: {
          apiKey: { login: async () => ({ type: "api_key", key: "sk" }) },
        },
      },
      {
        id: "openai-codex",
        name: "OpenAI Codex",
        auth: {
          oauth: {
            name: "ChatGPT Plus/Pro",
            login: async () => ({
              type: "oauth",
              refresh: "r",
              access: "a",
              expires: 1,
            }),
          },
        },
      },
    ],
    getProvider: (provider) =>
      provider === "anthropic"
        ? {
            id: "anthropic",
            name: "Anthropic",
            auth: { apiKey: {}, oauth: { name: "Claude Pro/Max" } },
          }
        : undefined,
    getProviderCredentialState: (provider) =>
      provider === "anthropic"
        ? { configured: true, source: "stored" }
        : { configured: false },
    login: async (provider, mode) => {
      calls.push({ provider, mode });
      return mode === "api_key"
        ? { type: "api_key", key: "sk" }
        : { type: "oauth", refresh: "r", access: "a", expires: 1 };
    },
  };
  return runtime;
}

test("repoLocalPiRuntimePaths points auth and models at the repo-local agent dir", () => {
  assert.deepEqual(repoLocalPiRuntimePaths("/repo/.patchmill/pi-agent"), {
    authPath: "/repo/.patchmill/pi-agent/auth.json",
    modelsPath: "/repo/.patchmill/pi-agent/models.json",
  });
});

test("ModelRuntime adapter exposes model snapshots and provider display names", () => {
  const runtime = fakeRuntime();
  const adapter = createModelRuntimeAdapter({
    runtime,
    authPath: "/repo/.patchmill/pi-agent/auth.json",
  });

  assert.deepEqual(adapter.getAvailable(), [
    {
      provider: "anthropic",
      id: "claude-sonnet-4-5",
      name: "Claude Sonnet 4.5",
      reasoning: true,
      input: ["text"],
    },
  ]);
  assert.deepEqual(
    adapter.getAll().map((model) => model.provider),
    ["anthropic", "openai"],
  );
  assert.equal(adapter.getProviderDisplayName("anthropic"), "Anthropic");
  assert.equal(adapter.getProviderDisplayName("missing"), "missing");
});

test("ModelRuntime adapter lists API-key providers that support API-key login", () => {
  const runtime = fakeRuntime();
  const adapter = createModelRuntimeAdapter({
    runtime,
    authPath: "/repo/.patchmill/pi-agent/auth.json",
  });

  assert.deepEqual(adapter.getApiKeyProviders(), [
    { id: "anthropic", name: "Anthropic" },
    { id: "openai", name: "OpenAI" },
  ]);
});

test("ModelRuntime adapter lists OAuth providers and reads stored credentials", () => {
  const runtime = fakeRuntime();
  const credential: PiCredential = {
    type: "oauth",
    refresh: "refresh",
    access: "access",
    expires: 1,
  };
  const adapter = createModelRuntimeAdapter({
    runtime,
    authPath: "/repo/.patchmill/pi-agent/auth.json",
    readCredential: (provider, authPath) => {
      assert.equal(provider, "anthropic");
      assert.equal(authPath, "/repo/.patchmill/pi-agent/auth.json");
      return credential;
    },
  });

  assert.deepEqual(adapter.getOAuthProviders(), [
    { id: "anthropic", name: "Claude Pro/Max" },
    { id: "openai-codex", name: "ChatGPT Plus/Pro" },
  ]);
  assert.equal(adapter.get("anthropic"), credential);
  assert.deepEqual(adapter.getProviderCredentialState("anthropic"), {
    configured: true,
    source: "stored",
  });
});

test("ModelRuntime adapter delegates login and refresh", async () => {
  const runtime = fakeRuntime();
  const adapter = createModelRuntimeAdapter({
    runtime,
    authPath: "/repo/.patchmill/pi-agent/auth.json",
  });

  await adapter.login("anthropic", "api_key", {
    prompt: async () => "sk-test",
    notify: () => undefined,
  });
  await adapter.login("anthropic", "oauth", {
    prompt: async () => "selected",
    notify: () => undefined,
  });
  await adapter.refresh();

  assert.deepEqual(runtime.calls, [
    { provider: "anthropic", mode: "api_key" },
    { provider: "anthropic", mode: "oauth" },
  ]);
  assert.equal(runtime.refreshCount(), 1);
});
