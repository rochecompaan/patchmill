import { getAgentDir } from "@earendil-works/pi-coding-agent";
import {
  createRepoLocalPiRuntime,
  type PatchmillPiRuntime,
  type PiRuntimeModel,
} from "./pi-runtime.ts";

export type PiRegistryModel = PiRuntimeModel;

export type PiRegistryLike = Pick<
  PatchmillPiRuntime,
  | "getAvailable"
  | "getError"
  | "getProviderAuthStatus"
  | "getProviderDisplayName"
>;

export type PiModelChoice = {
  provider: string;
  providerName: string;
  id: string;
  label: string;
  value: string;
  authSource?: ReturnType<PiRegistryLike["getProviderAuthStatus"]>["source"];
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

export async function createPiRegistry(
  options: { agentDir?: string } = {},
): Promise<PiRegistryLike> {
  return createRepoLocalPiRuntime({
    agentDir: options.agentDir ?? getAgentDir(),
  });
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

export function detectPiReadinessFromRegistry(
  registry: PiRegistryLike,
): PiReadiness {
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

export async function detectPiReadiness(
  options: {
    registry?: PiRegistryLike;
    agentDir?: string;
    createRuntime?: (options: { agentDir: string }) => Promise<PiRegistryLike>;
  } = {},
): Promise<PiReadiness> {
  const registry =
    options.registry ??
    (await (options.createRuntime ?? createRepoLocalPiRuntime)({
      agentDir: options.agentDir ?? getAgentDir(),
    }));
  return detectPiReadinessFromRegistry(registry);
}
