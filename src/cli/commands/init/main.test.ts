import assert from "node:assert/strict";
import { access, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { HELP_TEXT, runInit } from "./main.ts";

const PROJECT_LOCAL_SKILLS = {
  triage: ".patchmill/skills/patchmill-issue-triage",
  planning: ".patchmill/skills/writing-plans",
  implementation: ".patchmill/skills/subagent-driven-development",
};

const GLOBAL_SKILLS = {
  triage: "patchmill-issue-triage",
  planning: "superpowers:writing-plans",
  implementation: "superpowers:subagent-driven-development",
};

async function tempRepo(): Promise<string> {
  return mkdtemp(join(tmpdir(), "patchmill-init-main-"));
}

async function readConfig(repoRoot: string): Promise<Record<string, unknown>> {
  return JSON.parse(
    await readFile(join(repoRoot, "patchmill.config.json"), "utf8"),
  );
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

test("runInit installs project-local skills by default", async () => {
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

  assert.deepEqual((await readConfig(repoRoot)).skills, PROJECT_LOCAL_SKILLS);
  await access(
    join(
      repoRoot,
      ".patchmill",
      "skills",
      "patchmill-issue-triage",
      "SKILL.md",
    ),
  );
  await access(
    join(repoRoot, ".patchmill", "skills", "writing-plans", "SKILL.md"),
  );
  await access(
    join(
      repoRoot,
      ".patchmill",
      "skills",
      "subagent-driven-development",
      "SKILL.md",
    ),
  );
  assert.match(stdout.join("\n"), /Installed project-local skills/);
  assert.match(stdout.join("\n"), /Commit \.patchmill\/skills\//);
});

test("runInit --skills none skips skill installation and omits skills config", async () => {
  const repoRoot = await tempRepo();
  const stdout: string[] = [];
  let installCalled = false;

  assert.equal(
    await runInit(
      ["--skills", "none"],
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
        installProjectSkills: async () => {
          installCalled = true;
          throw new Error("should not install skills");
        },
      },
    ),
    0,
  );

  assert.equal(installCalled, false);
  assert.equal(Object.hasOwn(await readConfig(repoRoot), "skills"), false);
  assert.match(
    stdout.join("\n"),
    /Skipped default project-local skill installation/,
  );
});

test("runInit --skills global writes default global skill names", async () => {
  const repoRoot = await tempRepo();
  let installCalled = false;

  assert.equal(
    await runInit(
      ["--skills", "global"],
      repoRoot,
      {
        stdout: () => undefined,
        stderr: () => undefined,
      },
      {
        env: {},
        homeDir: await tempRepo(),
        isInteractive: false,
        checkPiAvailable: async () => false,
        installProjectSkills: async () => {
          installCalled = true;
          throw new Error("should not install skills");
        },
      },
    ),
    0,
  );

  assert.equal(installCalled, false);
  assert.deepEqual((await readConfig(repoRoot)).skills, GLOBAL_SKILLS);
});

test("runInit --skills path validates existing local skill directory", async () => {
  const repoRoot = await tempRepo();
  let validatedPath: string | undefined;
  let installCalled = false;
  const localSkills = {
    triage: "vendor/skills/patchmill-issue-triage",
    planning: "vendor/skills/writing-plans",
    implementation: "vendor/skills/subagent-driven-development",
  };

  assert.equal(
    await runInit(
      ["--skills", "path:vendor/skills"],
      repoRoot,
      {
        stdout: () => undefined,
        stderr: () => undefined,
      },
      {
        env: {},
        homeDir: await tempRepo(),
        isInteractive: false,
        checkPiAvailable: async () => false,
        installProjectSkills: async () => {
          installCalled = true;
          throw new Error("should not install skills");
        },
        validateExistingSkillDirectory: async (validateRepoRoot, skillDir) => {
          assert.equal(validateRepoRoot, repoRoot);
          validatedPath = skillDir;
          return localSkills;
        },
      },
    ),
    0,
  );

  assert.equal(installCalled, false);
  assert.equal(validatedPath, "vendor/skills");
  assert.deepEqual((await readConfig(repoRoot)).skills, localSkills);
});

test("runInit creates config and prints next step", async () => {
  const repoRoot = await tempRepo();
  const stdout: string[] = [];

  assert.equal(
    await runInit(
      ["--skills", "none"],
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

test("runInit refuses existing config without installing skills", async () => {
  const repoRoot = await tempRepo();
  await writeFile(join(repoRoot, "patchmill.config.json"), "{}\n");
  const stdout: string[] = [];
  let installCalled = false;

  assert.equal(
    await runInit(
      [],
      repoRoot,
      {
        stdout: (line) => stdout.push(line),
        stderr: () => undefined,
      },
      {
        installProjectSkills: async () => {
          installCalled = true;
          throw new Error("should not install skills");
        },
      },
    ),
    1,
  );
  assert.equal(installCalled, false);
  assert.match(stdout.join("\n"), /already exists/);
  assert.match(stdout.join("\n"), /did not overwrite/);
});

test("runInit does not offer Pi handoff when provider config is apparent", async () => {
  const repoRoot = await tempRepo();
  const stdout: string[] = [];
  let prompted = false;

  assert.equal(
    await runInit(
      ["--skills", "none"],
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
      ["--skills", "none"],
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
      ["--skills", "none"],
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
      ["--skills", "none"],
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
      ["--skills", "none"],
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
