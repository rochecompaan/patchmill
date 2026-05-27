import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { HELP_TEXT, runInit } from "./main.ts";

async function tempRepo(): Promise<string> {
  return mkdtemp(join(tmpdir(), "patchmill-init-main-"));
}

test("runInit prints help", async () => {
  const stdout: string[] = [];
  const stderr: string[] = [];

  assert.equal(
    await runInit(["--help"], await tempRepo(), {
      stdout: (line) => stdout.push(line),
      stderr: (line) => stderr.push(line),
    }),
    0,
  );
  assert.deepEqual(stdout, [HELP_TEXT]);
  assert.deepEqual(stderr, []);
});

test("runInit creates config and prints next step", async () => {
  const repoRoot = await tempRepo();
  const stdout: string[] = [];

  assert.equal(
    await runInit(
      [],
      repoRoot,
      {
        stdout: (line) => stdout.push(line),
        stderr: () => undefined,
      },
      {
        env: {},
        homeDir: await tempRepo(),
        isInteractive: false,
        checkPiAvailable: async () => false,
      },
    ),
    0,
  );

  assert.match(stdout.join("\n"), /Created patchmill\.config\.json/);
  assert.match(stdout.join("\n"), /provider: forgejo-tea/);
  assert.match(stdout.join("\n"), /PATCHMILL_HOST_LOGIN/);
  assert.match(stdout.join("\n"), /patchmill doctor/);
});

test("runInit refuses existing config", async () => {
  const repoRoot = await tempRepo();
  await writeFile(join(repoRoot, "patchmill.config.json"), "{}\n");
  const stdout: string[] = [];

  assert.equal(
    await runInit([], repoRoot, {
      stdout: (line) => stdout.push(line),
      stderr: () => undefined,
    }),
    1,
  );
  assert.match(stdout.join("\n"), /already exists/);
  assert.match(stdout.join("\n"), /did not overwrite/);
});

test("runInit does not offer Pi handoff when provider config is apparent", async () => {
  const repoRoot = await tempRepo();
  const stdout: string[] = [];
  let prompted = false;

  assert.equal(
    await runInit(
      [],
      repoRoot,
      { stdout: (line) => stdout.push(line), stderr: () => undefined },
      {
        env: { ANTHROPIC_API_KEY: "sk-ant-test" },
        homeDir: await tempRepo(),
        isInteractive: true,
        prompt: async () => {
          prompted = true;
          return "yes";
        },
      },
    ),
    0,
  );

  assert.equal(prompted, false);
  assert.match(stdout.join("\n"), /Pi provider configuration detected/);
});

test("runInit offers Pi handoff when provider config is not apparent", async () => {
  const repoRoot = await tempRepo();
  const stdout: string[] = [];
  let launched = false;

  assert.equal(
    await runInit(
      [],
      repoRoot,
      { stdout: (line) => stdout.push(line), stderr: () => undefined },
      {
        env: {},
        homeDir: await tempRepo(),
        isInteractive: true,
        checkPiAvailable: async () => true,
        prompt: async () => {
          assert.match(
            stdout[0] ?? "",
            /No provider configuration was detected/,
          );
          return "y";
        },
        launchPi: async () => {
          launched = true;
          return 0;
        },
      },
    ),
    0,
  );

  assert.equal(launched, true);
  assert.match(stdout[0] ?? "", /No provider configuration was detected/);
  assert.doesNotMatch(
    stdout.at(-1) ?? "",
    /No provider configuration was detected/,
  );
  assert.match(stdout.at(-1) ?? "", /Returned from Pi provider setup/);
});

test("runInit gives manual Pi setup guidance when Pi exits non-zero", async () => {
  const repoRoot = await tempRepo();
  const stdout: string[] = [];

  assert.equal(
    await runInit(
      [],
      repoRoot,
      { stdout: (line) => stdout.push(line), stderr: () => undefined },
      {
        env: {},
        homeDir: await tempRepo(),
        isInteractive: true,
        checkPiAvailable: async () => true,
        prompt: async () => "y",
        launchPi: async () => 1,
      },
    ),
    0,
  );

  assert.match(stdout[0] ?? "", /No provider configuration was detected/);
  assert.doesNotMatch(
    stdout.at(-1) ?? "",
    /No provider configuration was detected/,
  );
  assert.match(
    stdout.at(-1) ?? "",
    /Pi exited before provider setup could be confirmed/,
  );
  assert.match(
    stdout.at(-1) ?? "",
    /To configure manually, run `pi`, then `\/login`/,
  );
});

test("runInit skips Pi handoff prompt when Pi is unavailable", async () => {
  const repoRoot = await tempRepo();
  const stdout: string[] = [];
  let prompted = false;

  assert.equal(
    await runInit(
      [],
      repoRoot,
      { stdout: (line) => stdout.push(line), stderr: () => undefined },
      {
        env: {},
        homeDir: await tempRepo(),
        isInteractive: true,
        checkPiAvailable: async () => false,
        prompt: async () => {
          prompted = true;
          return "y";
        },
      },
    ),
    0,
  );

  assert.equal(prompted, false);
  assert.match(stdout.join("\n"), /No provider configuration was detected/);
  assert.match(stdout.join("\n"), /did not offer to launch it/);
  assert.match(
    stdout.join("\n"),
    /npm install -g @earendil-works\/pi-coding-agent/,
  );
});

test("runInit handles declined Pi handoff without error", async () => {
  const repoRoot = await tempRepo();
  const stdout: string[] = [];

  assert.equal(
    await runInit(
      [],
      repoRoot,
      { stdout: (line) => stdout.push(line), stderr: () => undefined },
      {
        env: {},
        homeDir: await tempRepo(),
        isInteractive: true,
        checkPiAvailable: async () => true,
        prompt: async () => "no",
      },
    ),
    0,
  );

  assert.match(
    stdout.join("\n"),
    /To configure manually, run `pi`, then `\/login`/,
  );
  assert.match(stdout.join("\n"), /patchmill doctor/);
});
