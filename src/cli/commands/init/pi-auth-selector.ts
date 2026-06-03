import {
  Container,
  Input,
  Key,
  matchesKey,
  ProcessTerminal,
  Text,
  TruncatedText,
  TUI,
  type Focusable,
  type Terminal,
} from "@earendil-works/pi-tui";
import {
  AUTH_METHOD_CHOICES,
  authProviderChoiceRows,
  createProviderSelectorState,
  formatProviderSelectorCount,
  moveProviderSelection,
  searchProviderSelector,
  selectedProvider,
  visibleProviderRows,
  type AuthMode,
  type AuthProviderChoice,
  type ProviderSelectorState,
} from "./pi-auth-provider-state.ts";

async function stopTui(tui: TUI, terminal: Terminal): Promise<void> {
  try {
    tui.stop();
  } catch {
    // Best-effort terminal cleanup.
  }
  try {
    await terminal.drainInput();
  } catch {
    // Best-effort terminal cleanup.
  }
}

class AuthMethodComponent extends Container {
  private selectedIndex = 0;
  private readonly onSelect: (mode: AuthMode) => void;
  private readonly onCancel: () => void;

  constructor(onSelect: (mode: AuthMode) => void, onCancel: () => void) {
    super();
    this.onSelect = onSelect;
    this.onCancel = onCancel;
    this.renderRows();
  }

  handleInput(data: string): void {
    if (matchesKey(data, Key.escape) || matchesKey(data, Key.ctrl("c"))) {
      this.onCancel();
      return;
    }
    if (matchesKey(data, Key.up) || matchesKey(data, Key.down)) {
      const delta = matchesKey(data, Key.up) ? -1 : 1;
      this.selectedIndex =
        (this.selectedIndex + delta + AUTH_METHOD_CHOICES.length) %
        AUTH_METHOD_CHOICES.length;
      this.renderRows();
      return;
    }
    if (matchesKey(data, Key.enter)) {
      this.onSelect(AUTH_METHOD_CHOICES[this.selectedIndex]?.mode ?? "oauth");
    }
  }

  private renderRows(): void {
    this.clear();
    this.addChild(new Text("Select authentication method:", 0, 0));
    this.addChild(new Text("", 0, 0));
    AUTH_METHOD_CHOICES.forEach((choice, index) => {
      const prefix = index === this.selectedIndex ? "→" : " ";
      this.addChild(new Text(`${prefix} ${choice.label}`, 0, 0));
    });
  }
}

class ProviderSelectorComponent extends Container implements Focusable {
  private readonly searchInput = new Input();
  private readonly listContainer = new Container();
  private readonly count = new Text("", 0, 0);
  private readonly onSelect: (provider: AuthProviderChoice) => void;
  private readonly onCancel: () => void;
  private state: ProviderSelectorState;
  private isFocused = false;

  constructor(
    title: string,
    choices: AuthProviderChoice[],
    onSelect: (provider: AuthProviderChoice) => void,
    onCancel: () => void,
  ) {
    super();
    this.onSelect = onSelect;
    this.onCancel = onCancel;
    this.state = createProviderSelectorState(choices);

    this.searchInput.onEscape = onCancel;
    this.searchInput.onSubmit = () => {
      const provider = selectedProvider(this.state);
      if (provider) this.onSelect(provider);
    };

    this.addChild(new Text(title, 0, 0));
    this.addChild(new Text("", 0, 0));
    this.addChild(this.searchInput);
    this.addChild(new Text("", 0, 0));
    this.addChild(this.listContainer);
    this.addChild(this.count);
    this.renderRows();
  }

  get focused(): boolean {
    return this.isFocused;
  }

  set focused(value: boolean) {
    this.isFocused = value;
    this.searchInput.focused = value;
  }

  handleInput(data: string): void {
    if (matchesKey(data, Key.up) || matchesKey(data, Key.down)) {
      this.state = moveProviderSelection(
        this.state,
        matchesKey(data, Key.up) ? -1 : 1,
      );
      this.renderRows();
      return;
    }

    this.searchInput.handleInput(data);
    this.state = searchProviderSelector(
      this.state,
      this.searchInput.getValue(),
    );
    this.renderRows();
  }

  private renderRows(): void {
    this.listContainer.clear();
    const rows = visibleProviderRows(this.state);
    if (rows.length === 0) {
      this.listContainer.addChild(new Text("  No matching providers", 0, 0));
    } else {
      for (const row of authProviderChoiceRows(rows)) {
        this.listContainer.addChild(new TruncatedText(row));
      }
    }
    this.count.setText(formatProviderSelectorCount(this.state));
  }
}

export async function selectAuthMethodInteractively(
  options: {
    terminal?: Terminal;
  } = {},
): Promise<AuthMode | undefined> {
  const terminal = options.terminal ?? new ProcessTerminal();
  const tui = new TUI(terminal, false);

  return new Promise((resolve) => {
    let finished = false;
    const finish = (mode: AuthMode | undefined): void => {
      if (finished) return;
      finished = true;
      void stopTui(tui, terminal).finally(() => resolve(mode));
    };

    const component = new AuthMethodComponent(
      (mode) => finish(mode),
      () => finish(undefined),
    );
    tui.addChild(component);
    tui.setFocus(component);
    tui.start();
    tui.requestRender(true);
  });
}

export async function selectProviderInteractively(options: {
  mode: AuthMode;
  choices: AuthProviderChoice[];
  terminal?: Terminal;
}): Promise<AuthProviderChoice | undefined> {
  const terminal = options.terminal ?? new ProcessTerminal();
  const tui = new TUI(terminal, true);
  const title =
    options.mode === "oauth"
      ? "Select subscription provider to configure:"
      : "Select API-key provider to configure:";

  return new Promise((resolve) => {
    let finished = false;
    const finish = (provider: AuthProviderChoice | undefined): void => {
      if (finished) return;
      finished = true;
      void stopTui(tui, terminal).finally(() => resolve(provider));
    };

    const component = new ProviderSelectorComponent(
      title,
      options.choices,
      (provider) => finish(provider),
      () => finish(undefined),
    );
    tui.addChild(component);
    tui.setFocus(component);
    tui.start();
    tui.requestRender(true);
  });
}
