import assert from "node:assert/strict";
import childProcess from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { main } from "./main.ts";
import type { PiAuthSetupResolver } from "./pi-auth-setup.ts";
import type { PiReadiness } from "./pi-preflight.ts";

test("auth completes standalone setup without launching the interactive Pi CLI", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "patchmill-standalone-auth-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(
    join(root, "patchmill.config.json"),
    JSON.stringify({ pi: { agentDir: "private/pi-agent" } }),
  );
  t.mock.method(childProcess, "spawn", () => {
    assert.fail("auth must not launch the interactive Pi CLI");
  });
  syncBuiltinESMExports();
  t.after(() => {
    t.mock.restoreAll();
    syncBuiltinESMExports();
  });
  const readiness: PiReadiness = {
    status: "ready",
    message: "Provider authentication is configured.",
    models: [
      {
        provider: "anthropic",
        providerName: "Anthropic",
        id: "claude-sonnet-4-5",
        label: "Claude Sonnet 4.5",
        value: "anthropic/claude-sonnet-4-5",
        reasoning: true,
        input: ["text"],
      },
    ],
  };
  const stdout: string[] = [];
  const stderr: string[] = [];
  let configured = false;
  const options = {
    repoRoot: root,
    isInteractive: true,
    output: {
      stdout: (line: string) => stdout.push(line),
      stderr: (line: string) => stderr.push(line),
    },
    detectPiReadiness: () => readiness,
    resolvePiAuthSetup: async ({
      piAgentDir,
      persistDefaultModel,
    }: Parameters<PiAuthSetupResolver>[0]) => {
      assert.equal(piAgentDir, join(root, "private/pi-agent"));
      await persistDefaultModel?.({
        provider: "anthropic",
        modelId: "claude-sonnet-4-5",
      });
      configured = true;
      return {
        status: "ready" as const,
        readiness,
        selection: {
          status: "selected" as const,
          provider: "anthropic",
          modelId: "claude-sonnet-4-5",
          model: "anthropic/claude-sonnet-4-5",
          message: "Model selected.",
        },
        smoke: { status: "pass" as const, message: "Verified.", command: "" },
      };
    },
  };

  assert.equal(await main([], options), 0, stderr.join("\n"));
  assert.equal(configured, true);
  assert.deepEqual(stderr, []);
  assert.match(
    stdout.join("\n"),
    /Selected model: anthropic\/claude-sonnet-4-5/,
  );
  assert.deepEqual(
    JSON.parse(
      await readFile(join(root, "private/pi-agent/settings.json"), "utf8"),
    ),
    { defaultProvider: "anthropic", defaultModel: "claude-sonnet-4-5" },
  );
});
