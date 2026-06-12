import assert from "node:assert/strict";
import { access, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
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
  const repoRoot = await mkdtemp(join(tmpdir(), "patchmill-init-main-"));
  await mkdir(join(repoRoot, ".git", "info"), { recursive: true });
  return repoRoot;
}

async function readConfig(repoRoot: string): Promise<Record<string, unknown>> {
  return JSON.parse(
    await readFile(join(repoRoot, "patchmill.config.json"), "utf8"),
  );
}

function missingPiReadiness() {
  return {
    status: "missing" as const,
    message: "Pi did not report any provider/model with configured auth.",
    models: [],
  };
}

async function failingPiSmokeTest() {
  return {
    status: "fail" as const,
    message: "Pi could not complete the provider smoke test.",
    command:
      "pi --no-session --no-context-files --no-prompt-templates -p Reply with PATCHMILL_PI_OK and nothing else.",
    details: "missing key",
  };
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

test("HELP_TEXT documents project as the default --skills mode", () => {
  assert.match(HELP_TEXT, /--skills <mode>[\s\S]*Default: project\./);
});

test("HELP_TEXT documents yes", () => {
  assert.match(HELP_TEXT, /--yes[\s\S]*Approve setup prompts/);
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
        detectPiReadiness: missingPiReadiness,
        runPiSmokeTest: failingPiSmokeTest,
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
  assert.match(
    stdout.join("\n"),
    /Added Patchmill local files to \.git\/info\/exclude/,
  );
  assert.match(
    await readFile(join(repoRoot, ".git", "info", "exclude"), "utf8"),
    /\.patchmill\npatchmill\.config\.json\n/u,
  );
  assert.match(
    stdout.join("\n"),
    /Warning: Patchmill config and skills are local-only by default/u,
  );
  assert.doesNotMatch(stdout.join("\n"), /Commit \.patchmill\/skills\//);
  assert.match(
    stdout.join("\n"),
    /Run `patchmill doctor` after completing Pi setup/,
  );
});

test("runInit preserves existing local exclude entries and does not touch gitignore", async () => {
  const repoRoot = await tempRepo();
  await writeFile(join(repoRoot, ".gitignore"), "node_modules\n");
  await writeFile(
    join(repoRoot, ".git", "info", "exclude"),
    "node_modules\n.patchmill\n",
  );

  assert.equal(
    await runInit(
      ["--skills", "none"],
      repoRoot,
      {
        stdout: () => undefined,
        stderr: () => undefined,
      },
      {
        env: {},
        homeDir: await tempRepo(),
        detectPiReadiness: missingPiReadiness,
        runPiSmokeTest: failingPiSmokeTest,
        isInteractive: false,
        checkPiAvailable: async () => false,
      },
    ),
    0,
  );

  assert.equal(
    await readFile(join(repoRoot, ".gitignore"), "utf8"),
    "node_modules\n",
  );
  assert.equal(
    await readFile(join(repoRoot, ".git", "info", "exclude"), "utf8"),
    "node_modules\n.patchmill\npatchmill.config.json\n",
  );
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
        detectPiReadiness: missingPiReadiness,
        runPiSmokeTest: failingPiSmokeTest,
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
        detectPiReadiness: missingPiReadiness,
        runPiSmokeTest: failingPiSmokeTest,
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
        detectPiReadiness: missingPiReadiness,
        runPiSmokeTest: failingPiSmokeTest,
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
        detectPiReadiness: missingPiReadiness,
        runPiSmokeTest: failingPiSmokeTest,
        isInteractive: false,
        checkPiAvailable: async () => false,
      },
    ),
    0,
  );

  assert.match(stdout.join("\n"), /Created patchmill\.config\.json/);
  assert.match(stdout.join("\n"), /provider: forgejo-tea/);
  assert.match(stdout.join("\n"), /PATCHMILL_HOST_LOGIN/);
  assert.match(
    stdout.join("\n"),
    /Run `patchmill doctor` after completing Pi setup/,
  );
  assert.match(stdout.join("\n"), /patchmill doctor/);
});

test("runInit prints missing label review and edit guidance when label setup is skipped", async () => {
  const repoRoot = await tempRepo();
  const stdout: string[] = [];
  let labelSetupCalled = false;

  assert.equal(
    await runInit(
      ["--skills", "none"],
      repoRoot,
      { stdout: (line) => stdout.push(line), stderr: () => undefined },
      {
        env: {},
        homeDir: await tempRepo(),
        detectPiReadiness: missingPiReadiness,
        runPiSmokeTest: failingPiSmokeTest,
        isInteractive: false,
        checkPiAvailable: async () => false,
        setupLabels: async (options) => {
          labelSetupCalled = true;
          assert.deepEqual(
            options.labelCatalog.workflowApprovalPolicy.labelDefinitions.map(
              (label) => label.name,
            ),
            ["spec-review", "spec-approved", "plan-review", "plan-approved"],
          );
          return {
            status: "skipped",
            missingCount: 1,
            createdCount: 0,
            message:
              "Patchmill needs these labels:\n  agent-ready — Ready for automated agent processing\n\nSkipped label creation.\nYou can edit label names in patchmill.config.json after init, then run:\n  patchmill doctor --fix",
          };
        },
      },
    ),
    0,
  );

  assert.equal(labelSetupCalled, true);
  assert.match(
    stdout.join("\n"),
    /agent-ready — Ready for automated agent processing/,
  );
  assert.match(stdout.join("\n"), /patchmill doctor --fix/);
});

test("runInit --yes approves setup-time label creation", async () => {
  const repoRoot = await tempRepo();
  let assumeYes: boolean | undefined;

  assert.equal(
    await runInit(
      ["--yes", "--skills", "none"],
      repoRoot,
      { stdout: () => undefined, stderr: () => undefined },
      {
        env: {},
        homeDir: await tempRepo(),
        detectPiReadiness: missingPiReadiness,
        runPiSmokeTest: failingPiSmokeTest,
        isInteractive: false,
        checkPiAvailable: async () => false,
        setupLabels: async (options) => {
          assumeYes = options.assumeYes;
          assert.deepEqual(
            options.labelCatalog.workflowApprovalPolicy.labelDefinitions.map(
              (label) => label.name,
            ),
            ["spec-review", "spec-approved", "plan-review", "plan-approved"],
          );
          return {
            status: "satisfied",
            missingCount: 0,
            createdCount: 0,
            message: "Required labels already exist.",
          };
        },
      },
    ),
    0,
  );

  assert.equal(assumeYes, true);
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
