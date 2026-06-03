import assert from "node:assert/strict";
import { test } from "node:test";
import type { Terminal } from "@earendil-works/pi-tui";
import {
  createOAuthCallbacks,
  promptApiKeyInteractively,
  showBedrockInfoInteractively,
} from "./pi-auth-dialog.ts";

class FakeTerminal implements Terminal {
  private onInput: ((data: string) => void) | undefined;
  writes: string[] = [];
  stopCalls = 0;
  drainCalls = 0;

  start(onInput: (data: string) => void, _onResize: () => void): void {
    this.onInput = onInput;
  }
  stop(): void {
    this.stopCalls += 1;
  }
  async drainInput(): Promise<void> {
    this.drainCalls += 1;
  }
  write(data: string): void {
    this.writes.push(data);
  }
  get columns(): number {
    return 80;
  }
  get rows(): number {
    return 24;
  }
  get kittyProtocolActive(): boolean {
    return false;
  }
  moveBy(_lines: number): void {}
  hideCursor(): void {}
  showCursor(): void {}
  clearLine(): void {}
  clearFromCursor(): void {}
  clearScreen(): void {}
  setTitle(_title: string): void {}
  setProgress(_active: boolean): void {}
  sendInput(data: string): void {
    this.onInput?.(data);
  }
}

test("promptApiKeyInteractively keeps prompting after empty input", async () => {
  const terminal = new FakeTerminal();
  const prompt = promptApiKeyInteractively({
    providerName: "Anthropic",
    terminal,
  });

  terminal.sendInput("\n");
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(terminal.stopCalls, 0);
  assert.match(terminal.writes.join(""), /API key cannot be empty/);

  for (const char of "sk-test") terminal.sendInput(char);
  terminal.sendInput("\n");

  assert.equal(await prompt, "sk-test");
  assert.equal(terminal.stopCalls, 1);
});

test("promptApiKeyInteractively cancels on escape", async () => {
  const terminal = new FakeTerminal();
  const prompt = promptApiKeyInteractively({
    providerName: "Anthropic",
    terminal,
  });

  terminal.sendInput("\u001b");

  assert.equal(await prompt, undefined);
});

test("showBedrockInfoInteractively resolves when escape closes the panel", async () => {
  const terminal = new FakeTerminal();
  const panel = showBedrockInfoInteractively({ terminal });

  await new Promise((resolve) => setImmediate(resolve));
  assert.match(terminal.writes.join(""), /Amazon Bedrock setup/);

  terminal.sendInput("\u001b");
  await panel;

  assert.equal(terminal.stopCalls, 1);
});

test("createOAuthCallbacks opens browser URLs for auth callbacks", () => {
  const terminal = new FakeTerminal();
  const opened: string[] = [];
  const callbacks = createOAuthCallbacks({
    terminal,
    openUrl: (url) => opened.push(url),
  });

  callbacks.onAuth({
    url: "https://login.example.test/oauth",
    instructions: "Complete login.",
  });
  callbacks.onDeviceCode({
    verificationUri: "https://device.example.test",
    userCode: "ABCD-EFGH",
  });

  assert.deepEqual(opened, [
    "https://login.example.test/oauth",
    "https://device.example.test",
  ]);
  assert.match(terminal.writes.join(""), /Complete login/);
  assert.match(terminal.writes.join(""), /ABCD-EFGH/);
});

test("createOAuthCallbacks prompts for provider text input", async () => {
  const terminal = new FakeTerminal();
  const callbacks = createOAuthCallbacks({ terminal });
  const answer = callbacks.onPrompt({ message: "GitHub Enterprise domain:" });

  for (const char of "github.example.com") terminal.sendInput(char);
  terminal.sendInput("\n");

  assert.equal(await answer, "github.example.com");
});

test("createOAuthCallbacks selects OAuth prompt options", async () => {
  const terminal = new FakeTerminal();
  const callbacks = createOAuthCallbacks({ terminal });
  const answer = callbacks.onSelect({
    message: "Choose account:",
    options: [
      { id: "first", label: "First" },
      { id: "second", label: "Second" },
    ],
  });

  terminal.sendInput("\u001b[B");
  terminal.sendInput("\n");

  assert.equal(await answer, "second");
});

test("createOAuthCallbacks dispose closes pending manual code input", async () => {
  const terminal = new FakeTerminal();
  const callbacks = createOAuthCallbacks({ terminal });
  const manualInput = callbacks.onManualCodeInput?.();

  await new Promise((resolve) => setImmediate(resolve));
  callbacks.dispose?.();

  assert.equal(await manualInput, "");
  assert.equal(terminal.stopCalls, 1);
});
