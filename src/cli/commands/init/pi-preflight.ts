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

export type NonEmptyArray<T> = [T, ...T[]];

export type PiReadiness =
  | {
      status: "ready";
      models: NonEmptyArray<PiModelChoice>;
      message: string;
      warning?: string;
    }
  | {
      status: "missing" | "error";
      models: PiModelChoice[];
      message: string;
    };

export function createPiRegistry(
  options: { agentDir?: string } = {},
): PiRegistryLike {
  const agentDir = options.agentDir ?? getAgentDir();
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
  options: { registry?: PiRegistryLike; agentDir?: string } = {},
): PiReadiness {
  const registry =
    options.registry ?? createPiRegistry({ agentDir: options.agentDir });
  const models = registry
    .getAvailable()
    .map((model) => toChoice(registry, model));
  const loadError = registry.getError();

  if (models.length === 0 && loadError) {
    return {
      status: "error",
      models: [],
      message: `Pi model registry could not load provider configuration: ${loadError}`,
    };
  }

  if (models.length === 0) {
    return {
      status: "missing",
      models: [],
      message: "Pi did not report any provider/model with configured auth.",
    };
  }

  return {
    status: "ready",
    models: models as NonEmptyArray<PiModelChoice>,
    message: `Pi reported ${models.length} provider/model option${models.length === 1 ? "" : "s"} with configured auth.`,
    ...(loadError
      ? {
          warning: `Pi model registry reported provider configuration issues: ${loadError}`,
        }
      : {}),
  };
}
