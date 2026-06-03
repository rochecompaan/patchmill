import {
  Container,
  Input,
  Key,
  matchesKey,
  ProcessTerminal,
  Text,
  TUI,
  type Focusable,
  type Terminal,
} from "@earendil-works/pi-tui";
import type { OAuthLoginCallbacksLike } from "./pi-auth-flow.ts";

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

class PromptComponent extends Container implements Focusable {
  private readonly input = new Input();
  private readonly error = new Text("", 0, 0);
  private isFocused = false;

  constructor(
    title: string,
    prompt: string,
    allowEmpty: boolean,
    onSubmit: (value: string) => void,
    onCancel: () => void,
  ) {
    super();
    this.input.onEscape = onCancel;
    this.input.onSubmit = (value) => {
      if (!allowEmpty && value.trim().length === 0) {
        this.error.setText("API key cannot be empty.");
        return;
      }
      onSubmit(value);
    };

    this.addChild(new Text(title, 0, 0));
    this.addChild(new Text("", 0, 0));
    this.addChild(new Text(prompt, 0, 0));
    this.addChild(this.input);
    this.addChild(this.error);
  }

  get focused(): boolean {
    return this.isFocused;
  }

  set focused(value: boolean) {
    this.isFocused = value;
    this.input.focused = value;
  }

  handleInput(data: string): void {
    this.input.handleInput(data);
  }
}

class InfoComponent extends Container {
  private readonly onClose: () => void;

  constructor(lines: string[], onClose: () => void) {
    super();
    this.onClose = onClose;
    for (const line of lines) this.addChild(new Text(line, 0, 0));
  }

  handleInput(data: string): void {
    if (
      matchesKey(data, Key.escape) ||
      matchesKey(data, Key.ctrl("c")) ||
      matchesKey(data, Key.enter)
    ) {
      this.onClose();
    }
  }
}

class OptionComponent extends Container {
  private selectedIndex = 0;
  private readonly title: string;
  private readonly options: Array<{ id: string; label: string }>;
  private readonly onSelect: (id: string) => void;
  private readonly onCancel: () => void;

  constructor(
    title: string,
    options: Array<{ id: string; label: string }>,
    onSelect: (id: string) => void,
    onCancel: () => void,
  ) {
    super();
    this.title = title;
    this.options = options;
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
        (this.selectedIndex + delta + this.options.length) %
        this.options.length;
      this.renderRows();
      return;
    }
    if (matchesKey(data, Key.enter)) {
      const option = this.options[this.selectedIndex];
      if (option) this.onSelect(option.id);
    }
  }

  private renderRows(): void {
    this.clear();
    this.addChild(new Text(this.title, 0, 0));
    this.addChild(new Text("", 0, 0));
    this.options.forEach((option, index) => {
      const prefix = index === this.selectedIndex ? "→" : " ";
      this.addChild(new Text(`${prefix} ${option.label}`, 0, 0));
    });
  }
}

async function promptText(options: {
  title: string;
  prompt: string;
  allowEmpty?: boolean;
  terminal?: Terminal;
}): Promise<string | undefined> {
  const terminal = options.terminal ?? new ProcessTerminal();
  const tui = new TUI(terminal, true);

  return new Promise((resolve) => {
    let finished = false;
    const finish = (value: string | undefined): void => {
      if (finished) return;
      finished = true;
      void stopTui(tui, terminal).finally(() => resolve(value));
    };

    const component = new PromptComponent(
      options.title,
      options.prompt,
      options.allowEmpty ?? false,
      (value) => finish(value),
      () => finish(undefined),
    );
    tui.addChild(component);
    tui.setFocus(component);
    tui.start();
    tui.requestRender(true);
  });
}

export function promptApiKeyInteractively(options: {
  providerName: string;
  terminal?: Terminal;
}): Promise<string | undefined> {
  return promptText({
    title: options.providerName,
    prompt: "Enter API key:",
    terminal: options.terminal,
  });
}

export async function showBedrockInfoInteractively(
  options: {
    terminal?: Terminal;
  } = {},
): Promise<void> {
  const terminal = options.terminal ?? new ProcessTerminal();
  const tui = new TUI(terminal, false);

  await new Promise<void>((resolve) => {
    let finished = false;
    const finish = (): void => {
      if (finished) return;
      finished = true;
      void stopTui(tui, terminal).finally(() => resolve());
    };

    const component = new InfoComponent(
      [
        "Amazon Bedrock setup",
        "",
        "Amazon Bedrock uses AWS credentials instead of a single API key.",
        "Configure an AWS profile, IAM keys, bearer token, or role-based credentials.",
        "See Pi providers.md for details.",
        "",
        "(escape/ctrl+c/enter to close)",
      ],
      finish,
    );
    tui.addChild(component);
    tui.setFocus(component);
    tui.start();
    tui.requestRender(true);
  });
}

async function selectOption(options: {
  title: string;
  choices: Array<{ id: string; label: string }>;
  terminal?: Terminal;
}): Promise<string | undefined> {
  const terminal = options.terminal ?? new ProcessTerminal();
  const tui = new TUI(terminal, false);

  return new Promise((resolve) => {
    let finished = false;
    const finish = (value: string | undefined): void => {
      if (finished) return;
      finished = true;
      void stopTui(tui, terminal).finally(() => resolve(value));
    };

    const component = new OptionComponent(
      options.title,
      options.choices,
      (id) => finish(id),
      () => finish(undefined),
    );
    tui.addChild(component);
    tui.setFocus(component);
    tui.start();
    tui.requestRender(true);
  });
}

export function createOAuthCallbacks(
  options: {
    terminal?: Terminal;
  } = {},
): OAuthLoginCallbacksLike {
  const terminal = options.terminal ?? new ProcessTerminal();
  return {
    onAuth: (info) => {
      terminal.write(`\nOpen this URL to authenticate:\n${info.url}\n`);
      if (info.instructions) terminal.write(`${info.instructions}\n`);
    },
    onDeviceCode: (info) => {
      terminal.write(
        `\nOpen ${info.verificationUri} and enter code ${info.userCode}.\n`,
      );
    },
    onProgress: (message) => {
      terminal.write(`${message}\n`);
    },
    onPrompt: (prompt) =>
      promptText({
        title: prompt.message,
        prompt: prompt.placeholder ?? prompt.message,
        allowEmpty: prompt.allowEmpty,
        terminal,
      }).then((value) => value ?? ""),
    onManualCodeInput: () =>
      promptText({
        title: "Paste redirect URL or code:",
        prompt: "Redirect URL or code:",
        terminal,
      }).then((value) => value ?? ""),
    onSelect: (prompt) =>
      selectOption({
        title: prompt.message,
        choices: prompt.options,
        terminal,
      }),
  };
}
