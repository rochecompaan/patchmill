import { join } from "node:path";
import {
  AuthStorage,
  getAgentDir,
  ModelRegistry,
} from "@earendil-works/pi-coding-agent";

type PiAuthStatus = {
  configured: boolean;
  source?:
    | "stored"
    | "runtime"
    | "environment"
    | "fallback"
    | "models_json_key"
    | "models_json_command";
  label?: string;
};

type PiRegistryModel = {
  provider: string;
  id: string;
  name?: string;
  reasoning?: boolean;
  input?: string[];
};

export type PiRegistryLike = {
  getAvailable(): PiRegistryModel[];
  getError(): string | undefined;
  getProviderAuthStatus(provider: string): PiAuthStatus;
  getProviderDisplayName(provider: string): string;
};

export type PiModelChoice = {
  provider: string;
  providerName: string;
  id: string;
  label: string;
  value: string;
  authSource?: PiAuthStatus["source"];
  reasoning: boolean;
  input: string[];
};

export type PiReadiness =
  | {
      status: "ready";
      models: PiModelChoice[];
      message: string;
    }
  | {
      status: "missing" | "error";
      models: PiModelChoice[];
      message: string;
    };

export function createPiRegistry(): PiRegistryLike {
  const agentDir = getAgentDir();
  const auth = AuthStorage.create(join(agentDir, "auth.json"));
  const registry = ModelRegistry.create(auth, join(agentDir, "models.json"));
  registry.refresh();
  return registry;
}

function toChoice(
  registry: PiRegistryLike,
  model: PiRegistryModel,
): PiModelChoice {
  const providerName = registry.getProviderDisplayName(model.provider);
  const label = `${providerName} / ${model.name ?? model.id}`;
  return {
    provider: model.provider,
    providerName,
    id: model.id,
    label,
    value: `${model.provider}/${model.id}`,
    authSource: registry.getProviderAuthStatus(model.provider).source,
    reasoning: model.reasoning ?? false,
    input: model.input ?? ["text"],
  };
}

export function formatPiModelLabel(model: PiModelChoice): string {
  if (
    model.providerName === model.provider &&
    model.label === `${model.provider} / ${model.id}`
  ) {
    return model.value;
  }
  return model.label;
}

export function detectPiReadiness(
  options: { registry?: PiRegistryLike } = {},
): PiReadiness {
  const registry = options.registry ?? createPiRegistry();
  const loadError = registry.getError();
  if (loadError) {
    return {
      status: "error",
      models: [],
      message: `Pi model registry could not load provider configuration: ${loadError}`,
    };
  }

  const models = registry
    .getAvailable()
    .map((model) => toChoice(registry, model));
  if (models.length === 0) {
    return {
      status: "missing",
      models: [],
      message: "Pi did not report any provider/model with configured auth.",
    };
  }

  return {
    status: "ready",
    models,
    message: `Pi reported ${models.length} provider/model option${models.length === 1 ? "" : "s"} with configured auth.`,
  };
}
