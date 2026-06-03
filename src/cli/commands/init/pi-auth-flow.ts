import { join } from "node:path";
import { AuthStorage, ModelRegistry } from "@earendil-works/pi-coding-agent";
import type { AuthCredential } from "@earendil-works/pi-coding-agent";
import type { LocalPiDefaultModel } from "./pi-agent-settings.ts";
import {
  createOAuthCallbacks,
  promptApiKeyInteractively,
  showBedrockInfoInteractively,
} from "./pi-auth-dialog.ts";
import {
  createAuthProviderChoices,
  type AuthMode,
  type AuthProviderChoice,
  type AuthRegistryLike,
  type AuthStorageLike,
} from "./pi-auth-provider-state.ts";
import {
  selectPiModel,
  type PersistDefaultModel,
  type PiModelSelection,
  type SelectInteractiveModel,
} from "./pi-model-selection.ts";
import {
  selectAuthMethodInteractively,
  selectProviderInteractively,
} from "./pi-auth-selector.ts";
import { selectModelInteractively as defaultSelectModelInteractively } from "./pi-model-selector.ts";
import { detectPiReadiness, type PiReadiness } from "./pi-preflight.ts";

export type OAuthLoginCallbacksLike = {
  onAuth: (info: { url: string; instructions?: string }) => void;
  onDeviceCode: (info: {
    userCode: string;
    verificationUri: string;
    intervalSeconds?: number;
    expiresInSeconds?: number;
  }) => void;
  onPrompt: (prompt: {
    message: string;
    placeholder?: string;
    allowEmpty?: boolean;
  }) => Promise<string>;
  onProgress?: (message: string) => void;
  onManualCodeInput?: () => Promise<string>;
  onSelect: (prompt: {
    message: string;
    options: Array<{ id: string; label: string }>;
  }) => Promise<string | undefined>;
  signal?: AbortSignal;
  dispose?: () => void;
};

export type PiAuthFlowStorage = AuthStorageLike & {
  set(provider: string, credential: AuthCredential): void;
  login(provider: string, callbacks: OAuthLoginCallbacksLike): Promise<void>;
};

export type PiAuthFlowRegistry = AuthRegistryLike & {
  refresh(): void;
  getAvailable(): Array<{
    provider: string;
    id: string;
    name?: string;
    reasoning?: boolean;
    input?: string[];
  }>;
  getError(): string | undefined;
};

export type SelectAuthMethod = () => Promise<AuthMode | undefined>;
export type SelectAuthProvider = (options: {
  mode: AuthMode;
  choices: AuthProviderChoice[];
}) => Promise<AuthProviderChoice | undefined>;
export type PromptApiKey = (
  provider: AuthProviderChoice,
) => Promise<string | undefined>;
export type ShowBedrockInfo = () => Promise<void>;
export type OAuthCallbacksFactory = (
  provider: AuthProviderChoice,
) => OAuthLoginCallbacksLike;

export type InteractivePiAuthSetupOptions = {
  repoRoot: string;
  agentDir: string;
  currentDefault: LocalPiDefaultModel | undefined;
  initialReadiness: PiReadiness;
  authStorage: PiAuthFlowStorage;
  registry: PiAuthFlowRegistry;
  selectAuthMethod: SelectAuthMethod;
  selectProvider: SelectAuthProvider;
  promptApiKey: PromptApiKey;
  showBedrockInfo: ShowBedrockInfo;
  selectModelInteractively: SelectInteractiveModel;
  persistDefaultModel?: PersistDefaultModel;
  oauthCallbacks?: OAuthCallbacksFactory;
};

type InteractivePiAuthSetupResult = {
  readiness: PiReadiness;
  selection: PiModelSelection;
};

function unavailable(
  readiness: PiReadiness,
  reason: Extract<PiModelSelection, { status: "unavailable" }>["reason"],
  message: string,
): InteractivePiAuthSetupResult {
  return {
    readiness,
    selection: {
      status: "unavailable",
      reason,
      message,
    },
  };
}

export function createRepoLocalPiAuth(options: { agentDir: string }): {
  authStorage: PiAuthFlowStorage;
  registry: PiAuthFlowRegistry;
} {
  const authStorage = AuthStorage.create(join(options.agentDir, "auth.json"));
  const registry = ModelRegistry.create(
    authStorage,
    join(options.agentDir, "models.json"),
  );
  registry.refresh();
  return { authStorage, registry };
}

export async function runInteractivePiAuthSetup(
  options: InteractivePiAuthSetupOptions,
): Promise<InteractivePiAuthSetupResult> {
  const mode = await options.selectAuthMethod();
  if (!mode) {
    return unavailable(
      options.initialReadiness,
      "cancelled",
      "Pi provider authentication was cancelled.",
    );
  }

  const choices = createAuthProviderChoices({
    mode,
    authStorage: options.authStorage,
    registry: options.registry,
  });
  const provider = await options.selectProvider({ mode, choices });
  if (!provider) {
    return unavailable(
      options.initialReadiness,
      "cancelled",
      "Pi provider authentication was cancelled.",
    );
  }

  if (mode === "api_key") {
    if (provider.id === "amazon-bedrock") {
      await options.showBedrockInfo();
    } else {
      const apiKey = await options.promptApiKey(provider);
      if (apiKey === undefined) {
        return unavailable(
          options.initialReadiness,
          "cancelled",
          "Pi provider authentication was cancelled.",
        );
      }
      const trimmed = apiKey.trim();
      if (!trimmed) {
        return unavailable(
          options.initialReadiness,
          "invalid-selection",
          "API key cannot be empty.",
        );
      }
      options.authStorage.set(provider.id, { type: "api_key", key: trimmed });
    }
  } else {
    const callbacks =
      options.oauthCallbacks?.(provider) ?? createOAuthCallbacks();
    try {
      await options.authStorage.login(provider.id, callbacks);
    } finally {
      callbacks.dispose?.();
    }
  }

  options.registry.refresh();
  const readiness = detectPiReadiness({ registry: options.registry });
  const selection = await selectPiModel({
    readiness,
    isInteractive: true,
    currentDefault: options.currentDefault,
    selectModelInteractively: options.selectModelInteractively,
    persistDefaultModel: options.persistDefaultModel,
  });
  return { readiness, selection };
}

export async function setupPiInteractively(options: {
  repoRoot: string;
  agentDir: string;
  currentDefault: LocalPiDefaultModel | undefined;
  initialReadiness: PiReadiness;
  selectModelInteractively?: SelectInteractiveModel;
  persistDefaultModel?: PersistDefaultModel;
}): Promise<InteractivePiAuthSetupResult> {
  const { authStorage, registry } = createRepoLocalPiAuth({
    agentDir: options.agentDir,
  });
  return runInteractivePiAuthSetup({
    repoRoot: options.repoRoot,
    agentDir: options.agentDir,
    currentDefault: options.currentDefault,
    initialReadiness: options.initialReadiness,
    authStorage,
    registry,
    selectAuthMethod: () => selectAuthMethodInteractively(),
    selectProvider: ({ mode, choices }) =>
      selectProviderInteractively({ mode, choices }),
    promptApiKey: (provider) =>
      promptApiKeyInteractively({ providerName: provider.name }),
    showBedrockInfo: () => showBedrockInfoInteractively(),
    selectModelInteractively:
      options.selectModelInteractively ?? defaultSelectModelInteractively,
    persistDefaultModel: options.persistDefaultModel,
    oauthCallbacks: () => createOAuthCallbacks(),
  });
}
