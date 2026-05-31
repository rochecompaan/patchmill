import assert from "node:assert/strict";
import { test } from "node:test";
import type { PiModelChoice, PiReadiness } from "./pi-preflight.ts";
import { runPiSetupWizard, type SetupPrompt } from "./pi-setup-wizard.ts";

const model: PiModelChoice = {
  provider: "anthropic",
  providerName: "Anthropic",
  id: "claude-sonnet-4-5",
  label: "Anthropic / Claude Sonnet 4.5",
  value: "anthropic/claude-sonnet-4-5",
  authSource: "stored",
  reasoning: true,
  input: ["text"],
};

function prompt(answers: string[]): SetupPrompt & { questions: string[] } {
  const questions: string[] = [];
  return Object.assign(
    async (question: string) => {
      questions.push(question);
      return answers.shift() ?? "";
    },
    { questions },
  );
}

test("runPiSetupWizard accepts existing ready model", async () => {
  const ask = prompt(["", "1"]);
  const result = await runPiSetupWizard({
    readiness: { status: "ready", models: [model], message: "ready" },
    isInteractive: true,
    assumeYes: false,
    prompt: ask,
  });

  assert.deepEqual(result, {
    status: "selected",
    model: "anthropic/claude-sonnet-4-5",
    message: "Using Pi model Anthropic / Claude Sonnet 4.5.",
  });
});

test("runPiSetupWizard lets user skip existing config", async () => {
  const ask = prompt(["n"]);
  const result = await runPiSetupWizard({
    readiness: { status: "ready", models: [model], message: "ready" },
    isInteractive: true,
    assumeYes: false,
    prompt: ask,
  });

  assert.equal(result.status, "manual");
  assert.match(result.message, /Pi setup was left unchanged/);
});

test("runPiSetupWizard prints manual instructions when missing and non-interactive", async () => {
  const result = await runPiSetupWizard({
    readiness: {
      status: "missing",
      models: [],
      message: "Pi did not report any provider/model with configured auth.",
    },
    isInteractive: false,
    assumeYes: false,
    prompt: prompt([]),
  });

  assert.equal(result.status, "manual");
  assert.match(result.message, /Run `pi`, then `\/login`/);
});

test("runPiSetupWizard does not invent credentials under --yes", async () => {
  const result = await runPiSetupWizard({
    readiness: {
      status: "missing",
      models: [],
      message: "Pi did not report any provider/model with configured auth.",
    },
    isInteractive: true,
    assumeYes: true,
    prompt: prompt([]),
  });

  assert.equal(result.status, "manual");
  assert.match(
    result.message,
    /--yes does not choose or create Pi credentials/,
  );
});

for (const answer of ["2", "anthropic/claude-haiku-4-5"]) {
  test(`runPiSetupWizard accepts manual model entry after ${answer}`, async () => {
    const ask = prompt(["y", answer]);
    const readiness: PiReadiness = {
      status: "missing",
      models: [],
      message: "Pi did not report any provider/model with configured auth.",
    };

    const result = await runPiSetupWizard({
      readiness,
      isInteractive: true,
      assumeYes: false,
      prompt: ask,
    });

    if (answer === "2") {
      assert.equal(result.status, "manual");
      assert.match(result.message, /Run `pi`, then `\/login`/);
    } else {
      assert.deepEqual(result, {
        status: "selected",
        model: "anthropic/claude-haiku-4-5",
        message: "Using manually entered Pi model anthropic/claude-haiku-4-5.",
      });
    }
  });
}
