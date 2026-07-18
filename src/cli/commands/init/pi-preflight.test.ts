import assert from "node:assert/strict";
import { test } from "node:test";
import {
  detectPiReadiness,
  detectPiReadinessFromRegistry,
  formatPiModelLabel,
  type PiRegistryLike,
} from "./pi-preflight.ts";

function registry(
  models: ReturnType<PiRegistryLike["getAvailable"]>,
): PiRegistryLike {
  return {
    getAvailable: () => models,
    getError: () => undefined,
    getProviderCredentialState: (provider) => ({
      configured: models.some((model) => model.provider === provider),
      source: "stored",
    }),
    getProviderDisplayName: (provider) =>
      provider === "anthropic" ? "Anthropic" : provider,
  };
}

test("detectPiReadiness creates a repo-local runtime when no registry is injected", async () => {
  const readiness = await detectPiReadiness({
    createRuntime: async () =>
      registry([
        {
          provider: "anthropic",
          id: "claude-sonnet-4-5",
          name: "Claude Sonnet 4.5",
          reasoning: true,
          input: ["text"],
        },
      ]),
    agentDir: "/repo/.patchmill/pi-agent",
  });

  assert.equal(readiness.status, "ready");
  assert.equal(readiness.models[0]?.value, "anthropic/claude-sonnet-4-5");
});

test("detectPiReadinessFromRegistry reports ready when Pi registry has available models", () => {
  const readiness = detectPiReadinessFromRegistry(
    registry([
      {
        provider: "anthropic",
        id: "claude-sonnet-4-5",
        name: "Claude Sonnet 4.5",
        reasoning: true,
        input: ["text"],
      },
    ]),
  );

  assert.equal(readiness.status, "ready");
  assert.equal(readiness.models.length, 1);
  assert.deepEqual(readiness.models[0], {
    provider: "anthropic",
    providerName: "Anthropic",
    id: "claude-sonnet-4-5",
    label: "Anthropic / Claude Sonnet 4.5",
    value: "anthropic/claude-sonnet-4-5",
    authSource: "stored",
    reasoning: true,
    input: ["text"],
  });
});

test("detectPiReadinessFromRegistry reports ready with a warning when registry has an error and available models", () => {
  const readiness = detectPiReadinessFromRegistry({
    ...registry([
      {
        provider: "anthropic",
        id: "claude-sonnet-4-5",
        name: "Claude Sonnet 4.5",
        reasoning: true,
        input: ["text"],
      },
    ]),
    getError: () => "bad models.json",
  });

  assert.equal(readiness.status, "ready");
  assert.equal(readiness.models[0]?.value, "anthropic/claude-sonnet-4-5");
  assert.equal(
    readiness.warning,
    "Pi model registry reported provider configuration issues: bad models.json",
  );
});

test("detectPiReadinessFromRegistry reports missing when Pi registry has no available models", () => {
  const readiness = detectPiReadinessFromRegistry(registry([]));

  assert.deepEqual(readiness, {
    status: "missing",
    models: [],
    message: "Pi did not report any provider/model with configured auth.",
  });
});

test("detectPiReadinessFromRegistry reports error when Pi registry cannot load models", () => {
  const readiness = detectPiReadinessFromRegistry({
    getAvailable: () => [],
    getError: () => "bad models.json",
    getProviderCredentialState: () => ({ configured: false }),
    getProviderDisplayName: (provider) => provider,
  });

  assert.deepEqual(readiness, {
    status: "error",
    models: [],
    message:
      "Pi model registry could not load provider configuration: bad models.json",
  });
});

test("formatPiModelLabel falls back to provider and id", () => {
  assert.equal(
    formatPiModelLabel({
      provider: "openai",
      providerName: "openai",
      id: "gpt-4.1",
      label: "openai / gpt-4.1",
      value: "openai/gpt-4.1",
      reasoning: false,
      input: ["text"],
    }),
    "openai/gpt-4.1",
  );
});
