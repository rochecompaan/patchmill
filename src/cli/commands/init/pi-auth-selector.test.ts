import assert from "node:assert/strict";
import { test } from "node:test";
import type { Terminal } from "@earendil-works/pi-tui";
import {
  selectAuthMethodInteractively,
  selectProviderInteractively,
} from "./pi-auth-selector.ts";
import type { AuthProviderChoice } from "./pi-auth-provider-state.ts";

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

function provider(id: string, name: string): AuthProviderChoice {
  return {
    id,
    name,
    mode: "api_key",
    label: `${name} • unconfigured`,
    statusLabel: "• unconfigured",
  };
}

test("selectAuthMethodInteractively returns API key after moving down", async () => {
  const terminal = new FakeTerminal();
  const selection = selectAuthMethodInteractively({ terminal });

  terminal.sendInput("\u001b[B");
  terminal.sendInput("\n");

  assert.equal(await selection, "api_key");
  assert.equal(terminal.stopCalls, 1);
  assert.equal(terminal.drainCalls, 1);
});

test("selectAuthMethodInteractively cancels on escape", async () => {
  const terminal = new FakeTerminal();
  const selection = selectAuthMethodInteractively({ terminal });

  terminal.sendInput("\u001b");

  assert.equal(await selection, undefined);
  assert.equal(terminal.stopCalls, 1);
});

test("selectProviderInteractively filters by typed search and selects matching provider", async () => {
  const terminal = new FakeTerminal();
  const selection = selectProviderInteractively({
    mode: "api_key",
    choices: [
      provider("anthropic", "Anthropic"),
      provider("google", "Google Gemini"),
    ],
    terminal,
  });

  for (const char of "google") terminal.sendInput(char);
  terminal.sendInput("\n");

  assert.equal((await selection)?.id, "google");
});

test("selectProviderInteractively renders one count for long lists", async () => {
  const terminal = new FakeTerminal();
  const choices = Array.from({ length: 10 }, (_entry, index) =>
    provider(`provider-${index + 1}`, `Provider ${index + 1}`),
  );
  const selection = selectProviderInteractively({
    mode: "api_key",
    choices,
    terminal,
  });

  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(terminal.writes.join("").match(/\(1\/10\)/gu)?.length, 1);

  terminal.sendInput("\n");
  await selection;
});
