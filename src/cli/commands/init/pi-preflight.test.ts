import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { hasApparentPiProviderConfig } from "./pi-preflight.ts";

async function homeDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), "patchmill-pi-home-"));
}

test("hasApparentPiProviderConfig detects known provider API key env vars", async () => {
  assert.equal(
    await hasApparentPiProviderConfig({
      env: { ANTHROPIC_API_KEY: "sk-ant-test" },
      homeDir: await homeDir(),
    }),
    true,
  );
  assert.equal(
    await hasApparentPiProviderConfig({
      env: { OPENAI_API_KEY: "sk-test" },
      homeDir: await homeDir(),
    }),
    true,
  );
  assert.equal(
    await hasApparentPiProviderConfig({
      env: { GEMINI_API_KEY: "test" },
      homeDir: await homeDir(),
    }),
    true,
  );
});

test("hasApparentPiProviderConfig ignores empty env vars", async () => {
  assert.equal(
    await hasApparentPiProviderConfig({
      env: { ANTHROPIC_API_KEY: "" },
      homeDir: await homeDir(),
    }),
    false,
  );
});

test("hasApparentPiProviderConfig detects auth.json entries", async () => {
  const home = await homeDir();
  await mkdir(join(home, ".pi", "agent"), { recursive: true });
  await writeFile(
    join(home, ".pi", "agent", "auth.json"),
    JSON.stringify({
      anthropic: { type: "api_key", key: "ANTHROPIC_API_KEY" },
    }),
  );

  assert.equal(
    await hasApparentPiProviderConfig({ env: {}, homeDir: home }),
    true,
  );
});

test("hasApparentPiProviderConfig returns false for missing or empty auth", async () => {
  assert.equal(
    await hasApparentPiProviderConfig({ env: {}, homeDir: await homeDir() }),
    false,
  );

  const home = await homeDir();
  await mkdir(join(home, ".pi", "agent"), { recursive: true });
  await writeFile(join(home, ".pi", "agent", "auth.json"), "{}\n");
  assert.equal(
    await hasApparentPiProviderConfig({ env: {}, homeDir: home }),
    false,
  );
});
