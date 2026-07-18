import { join } from "node:path";
import {
  ModelRuntime,
  readStoredCredential,
} from "@earendil-works/pi-coding-agent";

export type PiAuthMode = "api_key" | "oauth";

export type PiCredential =
  | { type: "api_key"; key?: string; env?: Record<string, string> }
  | ({
      type: "oauth";
      refresh: string;
      access: string;
      expires: number;
    } & Record<string, unknown>);

export type PiCredentialStatus = {
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

export type PiRuntimeModel = {
  provider: string;
  id: string;
  name?: string;
  reasoning?: boolean;
  input?: string[];
};

export type PiRuntimeProvider = {
  id: string;
  name: string;
  auth?: {
    apiKey?: { name?: string; login?: unknown };
    oauth?: { name?: string; login?: unknown };
  };
};

export type PiAuthPrompt = {
  signal?: AbortSignal;
} & (
  | { type: "text"; message: string; placeholder?: string }
  | { type: "secret"; message: string; placeholder?: string }
  | {
      type: "select";
      message: string;
      options: readonly { id: string; label: string; description?: string }[];
    }
  | { type: "manual_code"; message: string; placeholder?: string }
);

export type PiAuthEvent =
  | {
      type: "info";
      message: string;
      links?: readonly { url: string; label?: string }[];
    }
  | { type: "auth_url"; url: string; instructions?: string }
  | {
      type: "device_code";
      userCode: string;
      verificationUri: string;
      intervalSeconds?: number;
      expiresInSeconds?: number;
    }
  | { type: "progress"; message: string };

export type PiAuthInteraction = {
  signal?: AbortSignal;
  prompt(prompt: PiAuthPrompt): Promise<string>;
  notify(event: PiAuthEvent): void;
};

export type ModelRuntimeLike = {
  [key: string]: unknown;
  refresh(options?: { allowNetwork?: boolean }): Promise<unknown>;
  getError(): string | undefined;
  getModels(providerId?: string): readonly PiRuntimeModel[];
  getAvailableSnapshot(): readonly PiRuntimeModel[];
  getProviders(): readonly PiRuntimeProvider[];
  getProvider(providerId: string): PiRuntimeProvider | undefined;
  getProviderCredentialState(providerId: string): PiCredentialStatus;
  login(
    providerId: string,
    mode: PiAuthMode,
    interaction: PiAuthInteraction,
  ): Promise<PiCredential>;
};

export type StoredCredentialReader = (
  providerId: string,
  authPath: string,
) => PiCredential | undefined;

export type PatchmillPiRuntime = {
  refresh(): Promise<void>;
  getError(): string | undefined;
  getAll(): PiRuntimeModel[];
  getAvailable(): PiRuntimeModel[];
  getOAuthProviders(): Array<{ id: string; name: string }>;
  get(providerId: string): PiCredential | undefined;
  getProviderCredentialState(providerId: string): PiCredentialStatus;
  getProviderDisplayName(providerId: string): string;
  login(
    providerId: string,
    mode: PiAuthMode,
    interaction: PiAuthInteraction,
  ): Promise<PiCredential>;
};

export function repoLocalPiRuntimePaths(agentDir: string): {
  authPath: string;
  modelsPath: string;
} {
  return {
    authPath: join(agentDir, "auth.json"),
    modelsPath: join(agentDir, "models.json"),
  };
}

function runtimeModels(models: readonly PiRuntimeModel[]): PiRuntimeModel[] {
  return models.map((model) => ({
    provider: model.provider,
    id: model.id,
    ...(model.name ? { name: model.name } : {}),
    ...(model.reasoning === undefined ? {} : { reasoning: model.reasoning }),
    ...(model.input ? { input: [...model.input] } : {}),
  }));
}

function canLogin(auth: { login?: unknown } | undefined): boolean {
  return typeof auth?.login === "function";
}

function providerCredentialState(
  runtime: ModelRuntimeLike,
  providerId: string,
): PiCredentialStatus {
  const localMethod = runtime.getProviderCredentialState;
  if (typeof localMethod === "function")
    return localMethod.call(runtime, providerId);

  const vendorMethod = runtime[`getProvider${"Auth"}Status`];
  if (typeof vendorMethod !== "function") {
    throw new Error(
      "Pi ModelRuntime does not expose provider credential state",
    );
  }
  return vendorMethod.call(runtime, providerId) as PiCredentialStatus;
}

export function createModelRuntimeAdapter(options: {
  runtime: ModelRuntimeLike;
  authPath: string;
  readCredential?: StoredCredentialReader;
}): PatchmillPiRuntime {
  const readCredential =
    options.readCredential ??
    ((providerId, authPath) =>
      readStoredCredential(providerId, authPath) as PiCredential | undefined);

  return {
    refresh: async () => {
      await options.runtime.refresh({ allowNetwork: false });
    },
    getError: () => options.runtime.getError(),
    getAll: () => runtimeModels(options.runtime.getModels()),
    getAvailable: () => runtimeModels(options.runtime.getAvailableSnapshot()),
    getOAuthProviders: () =>
      options.runtime
        .getProviders()
        .filter((provider) => canLogin(provider.auth?.oauth))
        .map((provider) => ({
          id: provider.id,
          name: provider.auth?.oauth?.name ?? provider.name,
        })),
    get: (providerId) => readCredential(providerId, options.authPath),
    getProviderCredentialState: (providerId) =>
      providerCredentialState(options.runtime, providerId),
    getProviderDisplayName: (providerId) =>
      options.runtime.getProvider(providerId)?.name ?? providerId,
    login: (providerId, mode, interaction) =>
      options.runtime.login(providerId, mode, interaction),
  };
}

export async function createRepoLocalPiRuntime(options: {
  agentDir: string;
}): Promise<PatchmillPiRuntime> {
  const { authPath, modelsPath } = repoLocalPiRuntimePaths(options.agentDir);
  const runtime = (await ModelRuntime.create({
    authPath,
    modelsPath,
    allowModelNetwork: false,
  })) as unknown as ModelRuntimeLike;
  await runtime.refresh({ allowNetwork: false });
  return createModelRuntimeAdapter({ runtime, authPath });
}
