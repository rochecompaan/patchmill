import type {
  AuthCredential,
  AuthStatus,
} from "@earendil-works/pi-coding-agent";

export type AuthMode = "oauth" | "api_key";

export type AuthMethodChoice = {
  mode: AuthMode;
  label: string;
};

export const AUTH_METHOD_CHOICES: AuthMethodChoice[] = [
  { mode: "oauth", label: "Use a subscription" },
  { mode: "api_key", label: "Use an API key" },
];

export type OAuthProviderLike = {
  id: string;
  name: string;
};

export type AuthStorageLike = {
  getOAuthProviders(): OAuthProviderLike[];
  get(provider: string): AuthCredential | undefined;
  getAuthStatus(provider: string): AuthStatus;
};

export type RegistryModelLike = {
  provider: string;
};

export type AuthRegistryLike = {
  getAll(): RegistryModelLike[];
  getProviderDisplayName(provider: string): string;
  getProviderAuthStatus(provider: string): AuthStatus;
};

export type AuthProviderChoice = {
  id: string;
  name: string;
  mode: AuthMode;
  label: string;
  statusLabel: string;
};

export type ProviderSelectorState = {
  choices: AuthProviderChoice[];
  filtered: AuthProviderChoice[];
  query: string;
  selectedIndex: number;
};

export type VisibleProviderRow = {
  choice: AuthProviderChoice;
  selected: boolean;
};

const MAX_VISIBLE_PROVIDER_ROWS = 8;

function statusLabel(options: {
  mode: AuthMode;
  credential: AuthCredential | undefined;
  status: AuthStatus;
}): string {
  const { credential, mode, status } = options;

  if (credential?.type === "oauth") {
    return mode === "oauth" ? "✓ configured" : "• subscription configured";
  }

  if (credential?.type === "api_key") {
    return mode === "api_key" ? "✓ configured" : "• API key configured";
  }

  if (!status.configured) return "• unconfigured";

  if (status.source === "environment") {
    return `✓ env: ${status.label ?? "environment"}`;
  }
  if (status.source === "runtime") return "✓ runtime API key";
  if (status.source === "fallback") return "✓ custom API key";
  if (status.source === "models_json_key") return "✓ key in models.json";
  if (status.source === "models_json_command") {
    return "✓ command in models.json";
  }
  if (status.source === "stored") return "✓ configured";

  return "✓ configured";
}

function choice(options: {
  id: string;
  name: string;
  mode: AuthMode;
  credential: AuthCredential | undefined;
  status: AuthStatus;
}): AuthProviderChoice {
  const suffix = statusLabel(options);
  return {
    id: options.id,
    name: options.name,
    mode: options.mode,
    label: `${options.name} ${suffix}`,
    statusLabel: suffix,
  };
}

function apiProviderIds(registry: AuthRegistryLike): string[] {
  return Array.from(new Set(registry.getAll().map((model) => model.provider)))
    .filter((provider) => provider.length > 0)
    .sort((left, right) =>
      registry
        .getProviderDisplayName(left)
        .localeCompare(registry.getProviderDisplayName(right)),
    );
}

export function createAuthProviderChoices(options: {
  mode: AuthMode;
  authStorage: AuthStorageLike;
  registry: AuthRegistryLike;
}): AuthProviderChoice[] {
  if (options.mode === "oauth") {
    return options.authStorage.getOAuthProviders().map((provider) =>
      choice({
        id: provider.id,
        name: provider.name,
        mode: options.mode,
        credential: options.authStorage.get(provider.id),
        status: options.authStorage.getAuthStatus(provider.id),
      }),
    );
  }

  return apiProviderIds(options.registry).map((provider) =>
    choice({
      id: provider,
      name: options.registry.getProviderDisplayName(provider),
      mode: options.mode,
      credential: options.authStorage.get(provider),
      status: options.registry.getProviderAuthStatus(provider),
    }),
  );
}

function matches(choice: AuthProviderChoice, query: string): boolean {
  const normalized = query.trim().toLocaleLowerCase();
  if (!normalized) return true;
  const haystack = [choice.id, choice.name, choice.statusLabel, choice.label]
    .join(" ")
    .toLocaleLowerCase();
  return haystack.includes(normalized);
}

export function createProviderSelectorState(
  choices: AuthProviderChoice[],
): ProviderSelectorState {
  return {
    choices,
    filtered: choices,
    query: "",
    selectedIndex: 0,
  };
}

export function searchProviderSelector(
  state: ProviderSelectorState,
  query: string,
): ProviderSelectorState {
  const filtered = state.choices.filter((choice) => matches(choice, query));
  return {
    ...state,
    query,
    filtered,
    selectedIndex: 0,
  };
}

export function moveProviderSelection(
  state: ProviderSelectorState,
  delta: number,
): ProviderSelectorState {
  if (state.filtered.length === 0) return state;
  return {
    ...state,
    selectedIndex:
      (state.selectedIndex + delta + state.filtered.length) %
      state.filtered.length,
  };
}

export function selectedProvider(
  state: ProviderSelectorState,
): AuthProviderChoice | undefined {
  return state.filtered[state.selectedIndex];
}

export function visibleProviderRows(
  state: ProviderSelectorState,
): VisibleProviderRow[] {
  const visible = state.filtered.slice(0, MAX_VISIBLE_PROVIDER_ROWS);
  return visible.map((choice, index) => ({
    choice,
    selected: index === state.selectedIndex,
  }));
}

export function authProviderChoiceRows(rows: VisibleProviderRow[]): string[] {
  return rows.map((row) => `${row.selected ? "→" : " "} ${row.choice.label}`);
}

export function formatProviderSelectorCount(
  state: ProviderSelectorState,
): string {
  if (state.filtered.length <= MAX_VISIBLE_PROVIDER_ROWS) return "";
  return `(${state.selectedIndex + 1}/${state.filtered.length})`;
}
