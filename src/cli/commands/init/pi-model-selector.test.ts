import assert from "node:assert/strict";
import { test } from "node:test";
import type { Terminal } from "@earendil-works/pi-tui";
import { selectModelInteractively } from "./pi-model-selector.ts";
import type { PiModelChoice } from "./pi-preflight.ts";

class FakeTerminal implements Terminal {
  private readonly drainError: Error | undefined;
  private onInput: ((data: string) => void) | undefined;

  stopCalls = 0;
  drainCalls = 0;

  constructor(options: { drainError?: Error } = {}) {
    this.drainError = options.drainError;
  }

  start(onInput: (data: string) => void, _onResize: () => void): void {
    this.onInput = onInput;
  }

  stop(): void {
    this.stopCalls += 1;
  }

  async drainInput(): Promise<void> {
    this.drainCalls += 1;
    if (this.drainError) throw this.drainError;
  }

  write(_data: string): void {}

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

function model(provider: string, id: string, label = id): PiModelChoice {
  return {
    provider,
    providerName: provider,
    id,
    label,
    value: `${provider}/${id}`,
    authSource: "stored",
    reasoning: false,
    input: ["text"],
  };
}

const models = [
  model("openai", "gpt-4.1", "OpenAI / GPT-4.1"),
  model("anthropic", "claude-sonnet-4-5", "Anthropic / Claude Sonnet 4.5"),
];

test("selectModelInteractively resolves selected model even when drainInput fails", async () => {
  const terminal = new FakeTerminal({ drainError: new Error("drain failed") });
  const selection = selectModelInteractively({
    models,
    current: { provider: "anthropic", modelId: "claude-sonnet-4-5" },
    terminal,
  });

  terminal.sendInput("\n");

  const result = await selection;

  assert.equal(result?.value, "anthropic/claude-sonnet-4-5");
  assert.equal(terminal.stopCalls, 1);
  assert.equal(terminal.drainCalls, 1);
});

test("selectModelInteractively only finishes once when cancellation is repeated", async () => {
  const terminal = new FakeTerminal();
  const selection = selectModelInteractively({ models, terminal });

  terminal.sendInput("\u001b");
  terminal.sendInput("\n");

  const result = await selection;

  assert.equal(result, undefined);
  assert.equal(terminal.stopCalls, 1);
  assert.equal(terminal.drainCalls, 1);
});
