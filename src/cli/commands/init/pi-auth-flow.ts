import type { LocalPiDefaultModel } from "./pi-agent-settings.ts";
import {
  createOAuthCallbacks,
  promptApiKeyInteractively,
} from "./pi-auth-dialog.ts";
import {
  createAuthProviderChoices,
  type AuthMode,
  type AuthProviderChoice,
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
import {
  detectPiReadinessFromRegistry,
  type PiReadiness,
} from "./pi-preflight.ts";
import {
  createRepoLocalPiRuntime,
  type PatchmillPiRuntime,
  type PiAuthEvent,
  type PiAuthInteraction,
  type PiAuthPrompt,
} from "./pi-runtime.ts";

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

export type PiAuthFlowRuntime = PatchmillPiRuntime;

export type SelectAuthMethod = () => Promise<AuthMode | undefined>;
export type SelectAuthProvider = (options: {
  mode: AuthMode;
  choices: AuthProviderChoice[];
}) => Promise<AuthProviderChoice | undefined>;
export type PromptApiKey = (
  provider: AuthProviderChoice,
) => Promise<string | undefined>;
export type OAuthCallbacksFactory = (
  provider: AuthProviderChoice,
) => OAuthLoginCallbacksLike;

type SelectAuthPromptOption = (prompt: {
  message: string;
  options: Array<{ id: string; label: string }>;
}) => Promise<string | undefined>;

type PromptAuthText = (prompt: {
  message: string;
  placeholder?: string;
  allowEmpty?: boolean;
}) => Promise<string | undefined>;

export type InteractivePiAuthSetupOptions = {
  repoRoot: string;
  agentDir: string;
  currentDefault: LocalPiDefaultModel | undefined;
  initialReadiness: PiReadiness;
  runtime: PiAuthFlowRuntime;
  selectAuthMethod: SelectAuthMethod;
  selectProvider: SelectAuthProvider;
  promptApiKey: PromptApiKey;
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

function loginCancelled(): Error {
  return new Error("Login cancelled");
}

function assertApiKey(value: string | undefined): string {
  if (value === undefined) throw loginCancelled();
  const trimmed = value.trim();
  if (!trimmed) throw new Error("API key cannot be empty.");
  return trimmed;
}

async function promptForAuthValue(options: {
  prompt: PiAuthPrompt;
  provider: AuthProviderChoice;
  promptApiKey: PromptApiKey;
  promptText?: PromptAuthText;
  selectOption: SelectAuthPromptOption;
}): Promise<string> {
  if (options.prompt.type === "select") {
    const selected = await options.selectOption({
      message: options.prompt.message,
      options: options.prompt.options.map((option) => ({
        id: option.id,
        label: option.description
          ? `${option.label} — ${option.description}`
          : option.label,
      })),
    });
    if (selected === undefined) throw loginCancelled();
    return selected;
  }

  if (options.prompt.type === "manual_code") {
    const selected = await options.selectOption({
      message: options.prompt.message,
      options: [
        { id: "manual", label: options.prompt.placeholder ?? "Enter code" },
      ],
    });
    if (selected === undefined) throw loginCancelled();
    return selected;
  }

  if (options.prompt.type === "text") {
    const value = options.promptText
      ? await options.promptText({
          message: options.prompt.message,
          placeholder: options.prompt.placeholder,
          allowEmpty: true,
        })
      : await options.promptApiKey(options.provider);
    if (value === undefined) throw loginCancelled();
    return value;
  }

  return assertApiKey(await options.promptApiKey(options.provider));
}

function createApiKeyInteraction(options: {
  provider: AuthProviderChoice;
  promptApiKey: PromptApiKey;
  promptText?: PromptAuthText;
  selectOption: SelectAuthPromptOption;
}): PiAuthInteraction {
  return {
    prompt: (prompt) =>
      promptForAuthValue({
        prompt,
        provider: options.provider,
        promptApiKey: options.promptApiKey,
        promptText: options.promptText,
        selectOption: options.selectOption,
      }),
    notify: () => undefined,
  };
}

function createPiAuthInteraction(
  callbacks: OAuthLoginCallbacksLike,
): PiAuthInteraction {
  return {
    signal: callbacks.signal,
    notify: (event: PiAuthEvent) => {
      if (event.type === "auth_url") {
        callbacks.onAuth({ url: event.url, instructions: event.instructions });
      } else if (event.type === "device_code") {
        callbacks.onDeviceCode({
          userCode: event.userCode,
          verificationUri: event.verificationUri,
          intervalSeconds: event.intervalSeconds,
          expiresInSeconds: event.expiresInSeconds,
        });
      } else if (event.type === "progress" || event.type === "info") {
        callbacks.onProgress?.(event.message);
      }
    },
    prompt: async (prompt: PiAuthPrompt) => {
      if (prompt.type === "select") {
        const selected = await callbacks.onSelect({
          message: prompt.message,
          options: prompt.options.map((option) => ({
            id: option.id,
            label: option.description
              ? `${option.label} — ${option.description}`
              : option.label,
          })),
        });
        if (selected === undefined) throw loginCancelled();
        return selected;
      }
      if (prompt.type === "manual_code") {
        if (!callbacks.onManualCodeInput) throw loginCancelled();
        return callbacks.onManualCodeInput();
      }
      return callbacks.onPrompt({
        message: prompt.message,
        placeholder: prompt.placeholder,
        allowEmpty: prompt.type === "text",
      });
    },
  };
}

export async function createRepoLocalPiAuth(options: {
  agentDir: string;
}): Promise<{ runtime: PiAuthFlowRuntime }> {
  return {
    runtime: await createRepoLocalPiRuntime({ agentDir: options.agentDir }),
  };
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
    runtime: options.runtime,
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
    const callbacks = options.oauthCallbacks?.(provider);
    try {
      await options.runtime.login(
        provider.id,
        "api_key",
        createApiKeyInteraction({
          provider,
          promptApiKey: options.promptApiKey,
          promptText: callbacks?.onPrompt,
          selectOption: (prompt) =>
            callbacks?.onSelect(prompt) ?? Promise.resolve(undefined),
        }),
      );
    } catch (error) {
      if (
        error instanceof Error &&
        error.message === "API key cannot be empty."
      ) {
        return unavailable(
          options.initialReadiness,
          "invalid-selection",
          "API key cannot be empty.",
        );
      }
      if (error instanceof Error && error.message === "Login cancelled") {
        return unavailable(
          options.initialReadiness,
          "cancelled",
          "Pi provider authentication was cancelled.",
        );
      }
      throw error;
    } finally {
      callbacks?.dispose?.();
    }
  } else {
    const callbacks =
      options.oauthCallbacks?.(provider) ?? createOAuthCallbacks();
    try {
      await options.runtime.login(
        provider.id,
        "oauth",
        createPiAuthInteraction(callbacks),
      );
    } finally {
      callbacks.dispose?.();
    }
  }

  await options.runtime.refresh();
  const readiness = detectPiReadinessFromRegistry(options.runtime);
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
  const { runtime } = await createRepoLocalPiAuth({
    agentDir: options.agentDir,
  });
  return runInteractivePiAuthSetup({
    repoRoot: options.repoRoot,
    agentDir: options.agentDir,
    currentDefault: options.currentDefault,
    initialReadiness: options.initialReadiness,
    runtime,
    selectAuthMethod: () => selectAuthMethodInteractively(),
    selectProvider: ({ mode, choices }) =>
      selectProviderInteractively({ mode, choices }),
    promptApiKey: (provider) =>
      promptApiKeyInteractively({ providerName: provider.name }),
    selectModelInteractively:
      options.selectModelInteractively ?? defaultSelectModelInteractively,
    persistDefaultModel: options.persistDefaultModel,
    oauthCallbacks: () => createOAuthCallbacks(),
  });
}
