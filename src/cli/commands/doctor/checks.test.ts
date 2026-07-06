import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { runDoctorChecks } from "./checks.ts";
import { installProjectSkills } from "../init/skill-installer.ts";
import type { CommandRunner } from "../triage/types.ts";
import { bundledArtifactExtractionSkillPath } from "../../../workflow/skills.ts";
import {
  DEFAULT_PROJECT_SKILL_DIR,
  PATCHMILL_RECOMMENDED_SKILL_PACK,
  SKILL_PACK_METADATA_FILE,
  hashText,
  type SkillPackMetadataFile,
} from "../../../workflow/skill-pack.ts";

async function tempRepo(): Promise<string> {
  return mkdtemp(join(tmpdir(), "patchmill-doctor-"));
}

async function writeConfig(repoRoot: string, config: unknown): Promise<void> {
  await writeFile(
    join(repoRoot, "patchmill.config.json"),
    JSON.stringify(config),
  );
}

function skillDocument(name: string, description?: string): string {
  return [
    "---",
    `name: ${name}`,
    ...(description ? [`description: ${description}`] : []),
    "---",
    `# ${name}`,
    "",
  ].join("\n");
}

async function writeSkillFile(
  rootDir: string,
  skillDir: string,
  content: string,
): Promise<string> {
  const fullSkillDir = join(rootDir, skillDir);
  await mkdir(fullSkillDir, { recursive: true });
  const skillPath = join(fullSkillDir, "SKILL.md");
  await writeFile(skillPath, content);
  return skillPath;
}

async function writeProjectLocalSkill(
  repoRoot: string,
  skillName: string,
  content: string,
): Promise<string> {
  return writeSkillFile(
    join(repoRoot, DEFAULT_PROJECT_SKILL_DIR),
    skillName,
    content,
  );
}

function recommendedProjectLocalConfig() {
  return {
    host: { provider: "forgejo-tea", login: "triage-agent" },
    skills: {
      triage: `${DEFAULT_PROJECT_SKILL_DIR}/patchmill-issue-triage`,
      planning: `${DEFAULT_PROJECT_SKILL_DIR}/writing-plans`,
      implementation: `${DEFAULT_PROJECT_SKILL_DIR}/subagent-driven-development`,
    },
  };
}

function recommendedProjectLocalMetadata(
  files: Array<{ path: string; sha256: string }>,
): SkillPackMetadataFile {
  return {
    pack: {
      name: PATCHMILL_RECOMMENDED_SKILL_PACK.name,
      version: PATCHMILL_RECOMMENDED_SKILL_PACK.version,
      source: PATCHMILL_RECOMMENDED_SKILL_PACK.source,
    },
    installedAt: "2026-05-29T00:00:00.000Z",
    skillDir: DEFAULT_PROJECT_SKILL_DIR,
    metadataFile: SKILL_PACK_METADATA_FILE,
    files,
  };
}

async function writeProjectLocalMetadata(
  repoRoot: string,
  files: Array<{ path: string; sha256: string }>,
): Promise<void> {
  await mkdir(join(repoRoot, DEFAULT_PROJECT_SKILL_DIR), { recursive: true });
  await writeFile(
    join(repoRoot, DEFAULT_PROJECT_SKILL_DIR, SKILL_PACK_METADATA_FILE),
    JSON.stringify(recommendedProjectLocalMetadata(files)),
  );
}

function projectLocalSkillPath(repoRoot: string, skillName: string): string {
  return join(repoRoot, DEFAULT_PROJECT_SKILL_DIR, skillName, "SKILL.md");
}

function projectLocalMetadataSkillPath(skillName: string): string {
  return `${DEFAULT_PROJECT_SKILL_DIR}/${skillName}/SKILL.md`;
}

function projectLocalPiSmokeCommand(paths: string[]): string {
  return [
    "pi",
    "--no-session",
    "--no-context-files",
    "--no-prompt-templates",
    ...paths.flatMap((path) => ["--skill", path]),
    "-p",
    "Reply with PATCHMILL_SKILLS_OK and nothing else.",
  ].join(" ");
}

function normalizePiCommandKey(command: string, args: string[]): string {
  if (
    command === process.execPath &&
    args[0]?.includes("@earendil-works/pi-coding-agent")
  ) {
    return ["pi", ...args.slice(1)].join(" ");
  }
  return [command, ...args].join(" ");
}

function runnerFrom(
  map: Record<string, { code: number; stdout?: string; stderr?: string }>,
): CommandRunner {
  return {
    async run(command, args) {
      const key = normalizePiCommandKey(command, args);
      const result = map[key] ?? {
        code: 127,
        stderr: `missing mock for ${key}`,
      };
      return {
        code: result.code,
        stdout: result.stdout ?? "",
        stderr: result.stderr ?? "",
      };
    },
  };
}

const REQUIRED_LABELS = [
  "agent-ready",
  "needs-info",
  "agent-unsuitable",
  "in-progress",
  "agent-done",
  "blocked",
  "bug",
  "enhancement",
  "docs",
  "chore",
  "test",
  "priority:critical",
  "priority:high",
  "priority:medium",
  "priority:low",
  "spec-review",
  "spec-approved",
  "plan-review",
  "plan-approved",
];

function successMocks(
  labels = REQUIRED_LABELS,
  overrides: Record<
    string,
    { code: number; stdout?: string; stderr?: string }
  > = {},
) {
  return {
    "git rev-parse --is-inside-work-tree": { code: 0, stdout: "true\n" },
    "git branch --show-current": { code: 0, stdout: "main\n" },
    "git status --porcelain=v1 --untracked-files=all": { code: 0, stdout: "" },
    "tea --help": { code: 0, stdout: "tea help" },
    "tea issues list --state open --fields index,title,body,state,labels,author,created,updated,comments,url --page 1 --limit 1000 --output json --repo /repo --login triage-agent":
      {
        code: 0,
        stdout: "[]",
      },
    "tea labels list --limit 1000 --output json --repo /repo --login triage-agent":
      {
        code: 0,
        stdout: JSON.stringify(labels),
      },
    "pi --help": { code: 0, stdout: "pi help" },
    "pi --no-session --no-context-files --no-prompt-templates -p Reply with PATCHMILL_PI_OK and nothing else.":
      {
        code: 0,
        stdout: "PATCHMILL_PI_OK\n",
      },
    ...overrides,
  };
}

test("runDoctorChecks aggregates successful read-only checks", async () => {
  const repoRoot = await tempRepo();
  await writeConfig(repoRoot, {
    host: { provider: "forgejo-tea", login: "triage-agent" },
  });
  await mkdir(join(repoRoot, "docs"), { recursive: true });
  await mkdir(join(repoRoot, ".patchmill"), { recursive: true });
  const runner = runnerFrom(successMocks());

  const results = await runDoctorChecks(runner, {
    repoRoot,
    teaRepoRootForTests: "/repo",
  });

  assert.equal(
    results.find((result) => result.name === "config")?.status,
    "pass",
  );
  assert.equal(results.find((result) => result.name === "git")?.status, "pass");
  assert.equal(
    results.find((result) => result.name === "pi provider")?.status,
    "pass",
  );
  assert.equal(
    results.find((result) => result.name === "skills")?.status,
    "warn",
  );
  assert.match(
    results.find((result) => result.name === "skills")?.message ?? "",
    /named skill configured; doctor did not verify it/,
  );
  assert.equal(
    results.some((result) => result.status === "fail"),
    false,
  );
});

test("runDoctorChecks points Pi provider failures to guided setup", async () => {
  const repoRoot = await tempRepo();
  await writeConfig(repoRoot, {
    host: { provider: "forgejo-tea", login: "triage-agent" },
  });
  await mkdir(join(repoRoot, "docs"), { recursive: true });
  await mkdir(join(repoRoot, ".patchmill"), { recursive: true });
  const runner = runnerFrom(
    successMocks(REQUIRED_LABELS, {
      "pi --no-session --no-context-files --no-prompt-templates -p Reply with PATCHMILL_PI_OK and nothing else.":
        {
          code: 1,
          stdout: "",
          stderr: "missing key",
        },
    }),
  );

  const results = await runDoctorChecks(runner, {
    repoRoot,
    teaRepoRootForTests: "/repo",
  });
  const piProvider = results.find((result) => result.name === "pi provider");

  assert.equal(piProvider?.status, "fail");
  assert.match((piProvider?.remediation ?? []).join("\n"), /patchmill auth/);
  assert.doesNotMatch(
    (piProvider?.remediation ?? []).join("\n"),
    /patchmill init/,
  );
  assert.match((piProvider?.remediation ?? []).join("\n"), /missing key/);
});

test("runDoctorChecks scopes Pi provider smoke test to local agent dir", async () => {
  const repoRoot = await tempRepo();
  await writeConfig(repoRoot, {
    host: { provider: "forgejo-tea", login: "triage-agent" },
  });
  await mkdir(join(repoRoot, "docs"), { recursive: true });
  await mkdir(join(repoRoot, ".patchmill"), { recursive: true });
  const calls: Array<{
    command: string;
    args: string[];
    env?: Record<string, string | undefined>;
  }> = [];
  const runner: CommandRunner = {
    async run(command, args, options = {}) {
      calls.push({ command, args: [...args], env: options.env });
      const key = normalizePiCommandKey(command, args);
      const result = successMocks()[key] ?? {
        code: 127,
        stdout: "",
        stderr: `missing mock for ${key}`,
      };
      return {
        code: result.code,
        stdout: result.stdout ?? "",
        stderr: result.stderr ?? "",
      };
    },
  };

  const results = await runDoctorChecks(runner, {
    repoRoot,
    teaRepoRootForTests: "/repo",
  });

  assert.equal(
    results.find((result) => result.name === "pi provider")?.status,
    "pass",
  );
  const smokeCall = calls.find((call) =>
    call.args.includes("Reply with PATCHMILL_PI_OK and nothing else."),
  );
  assert.equal(
    smokeCall?.env?.PI_CODING_AGENT_DIR,
    join(repoRoot, ".patchmill", "pi-agent"),
  );
});

test("runDoctorChecks supports github-gh provider", async () => {
  const repoRoot = await tempRepo();
  await writeConfig(repoRoot, { host: { provider: "github-gh", login: "" } });
  await mkdir(join(repoRoot, "docs"), { recursive: true });
  await mkdir(join(repoRoot, ".patchmill"), { recursive: true });
  const runner = runnerFrom({
    "git rev-parse --is-inside-work-tree": {
      code: 0,
      stdout: "true\n",
      stderr: "",
    },
    "git branch --show-current": { code: 0, stdout: "main\n", stderr: "" },
    "git status --porcelain=v1 --untracked-files=all": {
      code: 0,
      stdout: "",
      stderr: "",
    },
    "gh --version": { code: 0, stdout: "gh version 2.0.0\n", stderr: "" },
    "gh auth status": { code: 0, stdout: "Logged in\n", stderr: "" },
    "gh issue list --state open --limit 1000 --json number,title,body,state,labels,author,updatedAt,url":
      { code: 0, stdout: "[]", stderr: "" },
    "gh label list --limit 1000 --json name": {
      code: 0,
      stdout: JSON.stringify(REQUIRED_LABELS.map((name) => ({ name }))),
      stderr: "",
    },
    "pi --help": { code: 0, stdout: "pi help", stderr: "" },
    "pi --no-session --no-context-files --no-prompt-templates -p Reply with PATCHMILL_PI_OK and nothing else.":
      { code: 0, stdout: "PATCHMILL_PI_OK", stderr: "" },
  });

  const results = await runDoctorChecks(runner, { repoRoot });

  assert.equal(
    results.find((result) => result.name === "host")?.status,
    "pass",
  );
});

test("runDoctorChecks reports invalid config and continues", async () => {
  const repoRoot = await tempRepo();
  await writeFile(join(repoRoot, "patchmill.config.json"), "{");
  const runner = runnerFrom({});

  const results = await runDoctorChecks(runner, { repoRoot });

  assert.equal(results[0]?.name, "config");
  assert.equal(results[0]?.status, "fail");
  assert.ok(results.length > 1);
});

test("runDoctorChecks reports missing labels with doctor fix guidance", async () => {
  const repoRoot = await tempRepo();
  await writeConfig(repoRoot, {
    host: { provider: "forgejo-tea", login: "triage-agent" },
  });
  await mkdir(join(repoRoot, "docs"), { recursive: true });
  await mkdir(join(repoRoot, ".patchmill"), { recursive: true });
  const runner = runnerFrom(successMocks([]));

  const results = await runDoctorChecks(runner, {
    repoRoot,
    teaRepoRootForTests: "/repo",
  });
  const labels = results.find((result) => result.name === "labels");

  assert.equal(labels?.status, "fail");
  assert.match(labels?.message ?? "", /agent-ready/);
  assert.deepEqual(labels?.remediation, [
    "Patchmill doctor is read-only and did not create labels.",
    "",
    "Run the approved repair flow:",
    "  patchmill doctor --fix",
    "",
    "You can edit label names in patchmill.config.json before running --fix.",
  ]);
  assert.doesNotMatch(
    (labels?.remediation ?? []).join("\n"),
    /tea labels create/,
  );
});

test("runDoctorChecks reports missing github labels with provider remediation", async () => {
  const repoRoot = await tempRepo();
  await writeConfig(repoRoot, { host: { provider: "github-gh", login: "" } });
  await mkdir(join(repoRoot, "docs"), { recursive: true });
  await mkdir(join(repoRoot, ".patchmill"), { recursive: true });
  const runner = runnerFrom({
    "git rev-parse --is-inside-work-tree": { code: 0, stdout: "true\n" },
    "git branch --show-current": { code: 0, stdout: "main\n" },
    "git status --porcelain=v1 --untracked-files=all": { code: 0, stdout: "" },
    "gh --version": { code: 0, stdout: "gh version 2.0.0\n" },
    "gh auth status": { code: 0, stdout: "Logged in\n" },
    "gh issue list --state open --limit 1000 --json number,title,body,state,labels,author,updatedAt,url":
      { code: 0, stdout: "[]" },
    "gh label list --limit 1000 --json name": { code: 0, stdout: "[]" },
    "pi --help": { code: 0, stdout: "pi help" },
    "pi --no-session --no-context-files --no-prompt-templates -p Reply with PATCHMILL_PI_OK and nothing else.":
      { code: 0, stdout: "PATCHMILL_PI_OK" },
  });

  const results = await runDoctorChecks(runner, { repoRoot });
  const labels = results.find((result) => result.name === "labels");
  const remediation = labels?.remediation ?? [];

  assert.equal(labels?.status, "fail");
  assert.ok(remediation.includes("  patchmill doctor --fix"));
  assert.equal(
    remediation.some((line) => line.includes("gh label create")),
    false,
  );
  assert.equal(
    remediation.some((line) => line.includes("--color #")),
    false,
  );
});

test("runDoctorChecks honors configured git clean-status ignores", async () => {
  const repoRoot = await tempRepo();
  await writeFile(
    join(repoRoot, "patchmill.config.json"),
    JSON.stringify({
      host: { provider: "forgejo-tea", login: "triage-agent" },
      paths: { cleanStatusIgnorePrefixes: ["scratch/"] },
    }),
  );
  await mkdir(join(repoRoot, "docs"), { recursive: true });
  await mkdir(join(repoRoot, ".patchmill"), { recursive: true });
  const runner = runnerFrom(
    successMocks(REQUIRED_LABELS, {
      "git status --porcelain=v1 --untracked-files=all": {
        code: 0,
        stdout: [
          "?? scratch/note.txt",
          "?? .patchmill/runs/run-2026-05-10T04-19-08-934Z.jsonl",
          "?? .pi/todos/issue-45-task-01-date-range-model.md",
          "",
        ].join("\n"),
      },
    }),
  );

  const results = await runDoctorChecks(runner, {
    repoRoot,
    teaRepoRootForTests: "/repo",
  });

  assert.equal(results.find((result) => result.name === "git")?.status, "pass");
});

test("runDoctorChecks does not hide local-only files when git reports them dirty", async () => {
  const repoRoot = await tempRepo();
  await writeConfig(repoRoot, {
    host: { provider: "forgejo-tea", login: "triage-agent" },
  });
  await mkdir(join(repoRoot, "docs"), { recursive: true });
  await mkdir(join(repoRoot, ".patchmill"), { recursive: true });
  const runner = runnerFrom(
    successMocks(REQUIRED_LABELS, {
      "git status --porcelain=v1 --untracked-files=all": {
        code: 0,
        stdout: [
          " M .gitignore",
          "?? patchmill.config.json",
          "?? .patchmill/skills/writing-plans/SKILL.md",
          "?? .patchmill/runs/run-2026-05-10T04-19-08-934Z.jsonl",
          "",
        ].join("\n"),
      },
    }),
  );

  const results = await runDoctorChecks(runner, {
    repoRoot,
    teaRepoRootForTests: "/repo",
  });

  const git = results.find((result) => result.name === "git");
  assert.equal(git?.status, "fail");
  assert.match(git?.message ?? "", /patchmill\.config\.json/);
});

test("runDoctorChecks fails path checks when a configured directory is a file", async () => {
  const repoRoot = await tempRepo();
  await writeFile(
    join(repoRoot, "patchmill.config.json"),
    JSON.stringify({
      host: { provider: "forgejo-tea", login: "triage-agent" },
    }),
  );
  await mkdir(join(repoRoot, "docs"), { recursive: true });
  await writeFile(join(repoRoot, "docs", "plans"), "not a directory\n");
  await mkdir(join(repoRoot, ".patchmill"), { recursive: true });
  const runner = runnerFrom(successMocks());

  const results = await runDoctorChecks(runner, {
    repoRoot,
    teaRepoRootForTests: "/repo",
  });
  const paths = results.find((result) => result.name === "paths");

  assert.equal(paths?.status, "fail");
  assert.match(paths?.message ?? "", /plans:not-directory/);
});

test("runDoctorChecks fails when a configured path-like skill is missing", async () => {
  const repoRoot = await tempRepo();
  await writeFile(
    join(repoRoot, "patchmill.config.json"),
    JSON.stringify({
      host: { provider: "forgejo-tea", login: "triage-agent" },
      skills: {
        planning: "./skills/project-planning/SKILL.md",
      },
    }),
  );
  await mkdir(join(repoRoot, "docs"), { recursive: true });
  await mkdir(join(repoRoot, ".patchmill"), { recursive: true });
  const runner = runnerFrom(successMocks());

  const results = await runDoctorChecks(runner, {
    repoRoot,
    teaRepoRootForTests: "/repo",
  });
  const skills = results.find((result) => result.name === "skills");

  assert.equal(skills?.status, "fail");
  assert.match(
    skills?.message ?? "",
    /planning: `\.\/skills\/project-planning\/SKILL\.md`/,
  );
  assert.match(skills?.message ?? "", /configured path unreadable/);
});

test("runDoctorChecks verifies configured development environment skill paths", async () => {
  const repoRoot = await tempRepo();
  await writeConfig(repoRoot, {
    host: { provider: "forgejo-tea", login: "triage-agent" },
    skills: {
      planning: "./skills/planning",
      implementation: "./skills/implementation",
      developmentEnvironment: "./skills/development-environment",
    },
  });
  await writeSkillFile(
    join(repoRoot, "skills"),
    "planning",
    skillDocument("planning", "Plan work"),
  );
  await writeSkillFile(
    join(repoRoot, "skills"),
    "implementation",
    skillDocument("implementation", "Implement work"),
  );
  await writeSkillFile(
    join(repoRoot, "skills"),
    "development-environment",
    skillDocument(
      "development-environment",
      "Prepare the local development environment",
    ),
  );
  await mkdir(join(repoRoot, "docs"), { recursive: true });
  await mkdir(join(repoRoot, ".patchmill"), { recursive: true });
  const runner = runnerFrom(successMocks());

  const results = await runDoctorChecks(runner, {
    repoRoot,
    teaRepoRootForTests: "/repo",
  });
  const skills = results.find((result) => result.name === "skills");

  assert.equal(skills?.status, "pass");
  assert.match(
    skills?.message ?? "",
    /developmentEnvironment: `\.\/skills\/development-environment` \(path verified\)/,
  );
});

test("runDoctorChecks resolves configured skill directories to their SKILL.md target", async () => {
  const repoRoot = await tempRepo();
  await writeFile(
    join(repoRoot, "patchmill.config.json"),
    JSON.stringify({
      host: { provider: "forgejo-tea", login: "triage-agent" },
      skills: {
        planning: "./skills/project-planning",
      },
    }),
  );
  await mkdir(join(repoRoot, "skills", "project-planning"), {
    recursive: true,
  });
  await mkdir(join(repoRoot, "docs"), { recursive: true });
  await mkdir(join(repoRoot, ".patchmill"), { recursive: true });
  const runner = runnerFrom(successMocks());

  const results = await runDoctorChecks(runner, {
    repoRoot,
    teaRepoRootForTests: "/repo",
  });
  const skills = results.find((result) => result.name === "skills");

  assert.equal(skills?.status, "fail");
  assert.match(
    skills?.message ?? "",
    /planning: `\.\/skills\/project-planning`/,
  );
  assert.match(
    skills?.message ?? "",
    /configured path unreadable at .*skills\/project-planning\/SKILL\.md/,
  );
});

test("runDoctorChecks passes for fresh configured project-local skills", async () => {
  const repoRoot = await tempRepo();
  await writeConfig(repoRoot, recommendedProjectLocalConfig());
  await mkdir(join(repoRoot, "docs"), { recursive: true });
  await installProjectSkills({
    repoRoot,
    installedAt: "2026-05-29T00:00:00.000Z",
  });

  const installedTriageSkill = await readFile(
    projectLocalSkillPath(repoRoot, "patchmill-issue-triage"),
    "utf8",
  );
  assert.match(
    installedTriageSkill,
    /description:\s*\n\s+Triage repository issues/u,
  );

  const smokePaths = [
    projectLocalSkillPath(repoRoot, "patchmill-issue-triage"),
    projectLocalSkillPath(repoRoot, "writing-plans"),
    projectLocalSkillPath(repoRoot, "subagent-driven-development"),
    bundledArtifactExtractionSkillPath(),
  ];

  const calls: string[] = [];
  const runner: CommandRunner = {
    async run(command, args) {
      const key = normalizePiCommandKey(command, args);
      calls.push(key);
      return (
        successMocks(REQUIRED_LABELS, {
          [projectLocalPiSmokeCommand(smokePaths)]: {
            code: 0,
            stdout: "PATCHMILL_SKILLS_OK\n",
          },
        })[key] ?? {
          code: 127,
          stdout: "",
          stderr: `missing mock for ${key}`,
        }
      );
    },
  };

  const expectedSmokeCommand = projectLocalPiSmokeCommand(smokePaths);

  const results = await runDoctorChecks(runner, {
    repoRoot,
    teaRepoRootForTests: "/repo",
  });
  const skills = results.find((result) => result.name === "skills");

  assert.equal(skills?.status, "pass");
  assert.match(skills?.message ?? "", /Pi loaded configured local skills/);
  assert.doesNotMatch(skills?.message ?? "", /metadata/);
  assert.ok(calls.includes(expectedSmokeCommand));
  assert.equal(
    calls.some((call) =>
      call.includes(
        `${join(repoRoot, DEFAULT_PROJECT_SKILL_DIR, DEFAULT_PROJECT_SKILL_DIR)}/`,
      ),
    ),
    false,
  );
});

test("runDoctorChecks fails when a local skill frontmatter is malformed", async () => {
  const repoRoot = await tempRepo();
  await writeConfig(repoRoot, {
    host: { provider: "forgejo-tea", login: "triage-agent" },
    skills: {
      planning: "./skills/project-planning",
    },
  });
  await mkdir(join(repoRoot, "docs"), { recursive: true });
  await mkdir(join(repoRoot, ".patchmill"), { recursive: true });
  await writeSkillFile(
    join(repoRoot, "skills"),
    "project-planning",
    skillDocument("project-planning"),
  );
  const runner = runnerFrom(successMocks());

  const results = await runDoctorChecks(runner, {
    repoRoot,
    teaRepoRootForTests: "/repo",
  });
  const skills = results.find((result) => result.name === "skills");

  assert.equal(skills?.status, "fail");
  assert.match(skills?.message ?? "", /malformed skill frontmatter/);
  assert.match(skills?.message ?? "", /missing description/);
});

test("runDoctorChecks ignores unused .patchmill skills when config uses global/named skills", async () => {
  const repoRoot = await tempRepo();
  await writeConfig(repoRoot, {
    host: { provider: "forgejo-tea", login: "triage-agent" },
    skills: {
      triage: "patchmill-issue-triage",
      planning: "superpowers:writing-plans",
      implementation: "superpowers:subagent-driven-development",
    },
  });
  await mkdir(join(repoRoot, "docs"), { recursive: true });
  await writeProjectLocalSkill(
    repoRoot,
    "stale-unused-skill",
    "not a valid skill document\n",
  );

  const calls: string[] = [];
  const runner: CommandRunner = {
    async run(command, args) {
      const key = normalizePiCommandKey(command, args);
      calls.push(key);
      return (
        successMocks(REQUIRED_LABELS)[key] ?? {
          code: 127,
          stdout: "",
          stderr: `missing mock for ${key}`,
        }
      );
    },
  };

  const results = await runDoctorChecks(runner, {
    repoRoot,
    teaRepoRootForTests: "/repo",
  });
  const skills = results.find((result) => result.name === "skills");

  assert.equal(skills?.status, "warn");
  assert.match(
    skills?.message ?? "",
    /triage: `patchmill-issue-triage` \(named skill configured; doctor did not verify it\)/,
  );
  assert.doesNotMatch(skills?.message ?? "", /stale-unused-skill/);
  assert.doesNotMatch(
    skills?.message ?? "",
    /project-local skill pack metadata/,
  );
  assert.equal(
    calls.some((call) =>
      call.includes("git check-ignore --no-index -q .patchmill/skills"),
    ),
    false,
  );
  assert.equal(
    calls.some((call) => call.includes("PATCHMILL_SKILLS_OK")),
    false,
  );
});

test("runDoctorChecks smoke-tests the exact shared resolver paths when metadata is malformed", async () => {
  const repoRoot = await tempRepo();
  const planningSkill = skillDocument("writing-plans", "Write plans.");

  await writeConfig(repoRoot, {
    host: { provider: "forgejo-tea", login: "triage-agent" },
    skills: {
      triage: "patchmill-issue-triage",
      planning: `${DEFAULT_PROJECT_SKILL_DIR}/writing-plans`,
      implementation: "superpowers:subagent-driven-development",
    },
  });
  await mkdir(join(repoRoot, "docs"), { recursive: true });
  await writeProjectLocalSkill(repoRoot, "writing-plans", planningSkill);
  await writeProjectLocalSkill(
    repoRoot,
    "stale-unused-skill",
    "not a valid skill document\n",
  );
  await mkdir(join(repoRoot, DEFAULT_PROJECT_SKILL_DIR), { recursive: true });
  await writeFile(
    join(repoRoot, DEFAULT_PROJECT_SKILL_DIR, SKILL_PACK_METADATA_FILE),
    "{ malformed json",
  );

  const smokePaths = [
    projectLocalSkillPath(repoRoot, "writing-plans"),
    bundledArtifactExtractionSkillPath(),
  ];
  const calls: string[] = [];
  const runner: CommandRunner = {
    async run(command, args) {
      const key = normalizePiCommandKey(command, args);
      calls.push(key);
      return (
        successMocks(REQUIRED_LABELS, {
          [projectLocalPiSmokeCommand(smokePaths)]: {
            code: 0,
            stdout: "PATCHMILL_SKILLS_OK\n",
          },
        })[key] ?? {
          code: 127,
          stdout: "",
          stderr: `missing mock for ${key}`,
        }
      );
    },
  };

  const results = await runDoctorChecks(runner, {
    repoRoot,
    teaRepoRootForTests: "/repo",
  });
  const skills = results.find((result) => result.name === "skills");

  assert.equal(skills?.status, "warn");
  assert.doesNotMatch(skills?.message ?? "", /metadata malformed/);
  assert.match(skills?.message ?? "", /Pi loaded configured local skills/);
  assert.ok(calls.includes(projectLocalPiSmokeCommand(smokePaths)));
  assert.equal(
    calls.some((call) => call.includes("stale-unused-skill")),
    false,
  );
});

test("runDoctorChecks rejects metadata paths outside project-local skills", async () => {
  for (const invalidPath of [
    "/tmp/outside/SKILL.md",
    "C:\\temp\\outside\\SKILL.md",
    ".patchmill/skills/../../outside/SKILL.md",
  ]) {
    const repoRoot = await tempRepo();
    const triageSkill = skillDocument(
      "patchmill-issue-triage",
      "Triage issues.",
    );
    const planningSkill = skillDocument("writing-plans", "Write plans.");
    const implementationSkill = skillDocument(
      "subagent-driven-development",
      "Execute plans.",
    );

    await writeConfig(repoRoot, recommendedProjectLocalConfig());
    await mkdir(join(repoRoot, "docs"), { recursive: true });
    await writeProjectLocalSkill(
      repoRoot,
      "patchmill-issue-triage",
      triageSkill,
    );
    await writeProjectLocalSkill(repoRoot, "writing-plans", planningSkill);
    await writeProjectLocalSkill(
      repoRoot,
      "subagent-driven-development",
      implementationSkill,
    );
    await writeProjectLocalMetadata(repoRoot, [
      {
        path: projectLocalMetadataSkillPath("patchmill-issue-triage"),
        sha256: hashText(triageSkill),
      },
      { path: invalidPath, sha256: hashText("outside") },
    ]);

    const smokePaths = [
      projectLocalSkillPath(repoRoot, "patchmill-issue-triage"),
      projectLocalSkillPath(repoRoot, "writing-plans"),
      projectLocalSkillPath(repoRoot, "subagent-driven-development"),
      bundledArtifactExtractionSkillPath(),
    ];
    const calls: string[] = [];
    const runner: CommandRunner = {
      async run(command, args) {
        const key = normalizePiCommandKey(command, args);
        calls.push(key);
        return (
          successMocks(REQUIRED_LABELS, {
            [projectLocalPiSmokeCommand(smokePaths)]: {
              code: 0,
              stdout: "PATCHMILL_SKILLS_OK\n",
            },
          })[key] ?? {
            code: 127,
            stdout: "",
            stderr: `missing mock for ${key}`,
          }
        );
      },
    };

    const results = await runDoctorChecks(runner, {
      repoRoot,
      teaRepoRootForTests: "/repo",
    });
    const skills = results.find((result) => result.name === "skills");

    assert.equal(skills?.status, "pass");
    assert.doesNotMatch(skills?.message ?? "", /metadata malformed/);
    assert.ok(calls.includes(projectLocalPiSmokeCommand(smokePaths)));
    assert.equal(
      calls.some((call) => call.includes(invalidPath)),
      false,
    );
  }
});

test("runDoctorChecks warns when project-local skill files differ from metadata", async () => {
  const repoRoot = await tempRepo();
  const triageSkill = skillDocument("patchmill-issue-triage", "Triage issues.");
  const originalPlanningSkill = skillDocument("writing-plans", "Write plans.");
  const customizedPlanningSkill = skillDocument(
    "writing-plans",
    "Write plans with local tweaks.",
  );
  const implementationSkill = skillDocument(
    "subagent-driven-development",
    "Execute plans.",
  );

  await writeConfig(repoRoot, recommendedProjectLocalConfig());
  await mkdir(join(repoRoot, "docs"), { recursive: true });
  await writeProjectLocalSkill(repoRoot, "patchmill-issue-triage", triageSkill);
  await writeProjectLocalSkill(
    repoRoot,
    "writing-plans",
    customizedPlanningSkill,
  );
  await writeProjectLocalSkill(
    repoRoot,
    "subagent-driven-development",
    implementationSkill,
  );
  await writeProjectLocalMetadata(repoRoot, [
    {
      path: projectLocalMetadataSkillPath("patchmill-issue-triage"),
      sha256: hashText(triageSkill),
    },
    {
      path: projectLocalMetadataSkillPath("writing-plans"),
      sha256: hashText(originalPlanningSkill),
    },
    {
      path: projectLocalMetadataSkillPath("subagent-driven-development"),
      sha256: hashText(implementationSkill),
    },
  ]);

  const smokePaths = [
    projectLocalSkillPath(repoRoot, "patchmill-issue-triage"),
    projectLocalSkillPath(repoRoot, "writing-plans"),
    projectLocalSkillPath(repoRoot, "subagent-driven-development"),
    bundledArtifactExtractionSkillPath(),
  ];
  const runner = runnerFrom(
    successMocks(REQUIRED_LABELS, {
      [projectLocalPiSmokeCommand(smokePaths)]: {
        code: 0,
        stdout: "PATCHMILL_SKILLS_OK\n",
      },
    }),
  );

  const results = await runDoctorChecks(runner, {
    repoRoot,
    teaRepoRootForTests: "/repo",
  });
  const skills = results.find((result) => result.name === "skills");

  assert.equal(skills?.status, "pass");
  assert.doesNotMatch(skills?.message ?? "", /customized from installed pack/);
  assert.match(skills?.message ?? "", /Pi loaded configured local skills/);
});

test("runDoctorChecks allows project-local skills to be ignored by git", async () => {
  const repoRoot = await tempRepo();
  const triageSkill = skillDocument("patchmill-issue-triage", "Triage issues.");
  const planningSkill = skillDocument("writing-plans", "Write plans.");
  const implementationSkill = skillDocument(
    "subagent-driven-development",
    "Execute plans.",
  );

  await writeConfig(repoRoot, recommendedProjectLocalConfig());
  await mkdir(join(repoRoot, "docs"), { recursive: true });
  await writeProjectLocalSkill(repoRoot, "patchmill-issue-triage", triageSkill);
  await writeProjectLocalSkill(repoRoot, "writing-plans", planningSkill);
  await writeProjectLocalSkill(
    repoRoot,
    "subagent-driven-development",
    implementationSkill,
  );
  await writeProjectLocalMetadata(repoRoot, [
    {
      path: projectLocalMetadataSkillPath("patchmill-issue-triage"),
      sha256: hashText(triageSkill),
    },
    {
      path: projectLocalMetadataSkillPath("writing-plans"),
      sha256: hashText(planningSkill),
    },
    {
      path: projectLocalMetadataSkillPath("subagent-driven-development"),
      sha256: hashText(implementationSkill),
    },
  ]);

  const calls: string[] = [];
  const runner: CommandRunner = {
    async run(command, args) {
      const key = normalizePiCommandKey(command, args);
      calls.push(key);
      return (
        successMocks(REQUIRED_LABELS, {
          [projectLocalPiSmokeCommand([
            projectLocalSkillPath(repoRoot, "patchmill-issue-triage"),
            projectLocalSkillPath(repoRoot, "writing-plans"),
            projectLocalSkillPath(repoRoot, "subagent-driven-development"),
            bundledArtifactExtractionSkillPath(),
          ])]: {
            code: 0,
            stdout: "PATCHMILL_SKILLS_OK\n",
          },
        })[key] ?? {
          code: 127,
          stdout: "",
          stderr: `missing mock for ${key}`,
        }
      );
    },
  };

  const results = await runDoctorChecks(runner, {
    repoRoot,
    teaRepoRootForTests: "/repo",
  });
  const skills = results.find((result) => result.name === "skills");

  assert.equal(skills?.status, "pass");
  assert.doesNotMatch(
    skills?.message ?? "",
    /\.patchmill\/skills is ignored by git/,
  );
  assert.equal(
    calls.some((call) => call.includes("git check-ignore")),
    false,
  );
  assert.equal(
    calls.some((command) => command.includes("PATCHMILL_SKILLS_OK")),
    true,
  );
});

test("runDoctorChecks fails when Pi cannot load project-local skills", async () => {
  const repoRoot = await tempRepo();
  const triageSkill = skillDocument("patchmill-issue-triage", "Triage issues.");
  const planningSkill = skillDocument("writing-plans", "Write plans.");
  const implementationSkill = skillDocument(
    "subagent-driven-development",
    "Execute plans.",
  );

  await writeConfig(repoRoot, recommendedProjectLocalConfig());
  await mkdir(join(repoRoot, "docs"), { recursive: true });
  await writeProjectLocalSkill(repoRoot, "patchmill-issue-triage", triageSkill);
  await writeProjectLocalSkill(repoRoot, "writing-plans", planningSkill);
  await writeProjectLocalSkill(
    repoRoot,
    "subagent-driven-development",
    implementationSkill,
  );
  await writeProjectLocalMetadata(repoRoot, [
    {
      path: projectLocalMetadataSkillPath("patchmill-issue-triage"),
      sha256: hashText(triageSkill),
    },
    {
      path: projectLocalMetadataSkillPath("writing-plans"),
      sha256: hashText(planningSkill),
    },
    {
      path: projectLocalMetadataSkillPath("subagent-driven-development"),
      sha256: hashText(implementationSkill),
    },
  ]);

  const smokePaths = [
    projectLocalSkillPath(repoRoot, "patchmill-issue-triage"),
    projectLocalSkillPath(repoRoot, "writing-plans"),
    projectLocalSkillPath(repoRoot, "subagent-driven-development"),
    bundledArtifactExtractionSkillPath(),
  ];
  const runner = runnerFrom(
    successMocks(REQUIRED_LABELS, {
      [projectLocalPiSmokeCommand(smokePaths)]: {
        code: 1,
        stderr: "pi failed to load one or more skills",
      },
    }),
  );

  const results = await runDoctorChecks(runner, {
    repoRoot,
    teaRepoRootForTests: "/repo",
  });
  const skills = results.find((result) => result.name === "skills");

  assert.equal(skills?.status, "fail");
  assert.match(
    skills?.message ?? "",
    /Pi could not load the configured local skills/,
  );
  assert.match(skills?.message ?? "", /pi failed to load one or more skills/);
});

test("runDoctorChecks warns when project-local metadata is missing", async () => {
  const repoRoot = await tempRepo();
  const triageSkill = skillDocument("patchmill-issue-triage", "Triage issues.");
  const planningSkill = skillDocument("writing-plans", "Write plans.");
  const implementationSkill = skillDocument(
    "subagent-driven-development",
    "Execute plans.",
  );

  await writeConfig(repoRoot, recommendedProjectLocalConfig());
  await mkdir(join(repoRoot, "docs"), { recursive: true });
  await writeProjectLocalSkill(repoRoot, "patchmill-issue-triage", triageSkill);
  await writeProjectLocalSkill(repoRoot, "writing-plans", planningSkill);
  await writeProjectLocalSkill(
    repoRoot,
    "subagent-driven-development",
    implementationSkill,
  );

  const smokePaths = [
    projectLocalSkillPath(repoRoot, "patchmill-issue-triage"),
    projectLocalSkillPath(repoRoot, "writing-plans"),
    projectLocalSkillPath(repoRoot, "subagent-driven-development"),
    bundledArtifactExtractionSkillPath(),
  ];
  const runner = runnerFrom(
    successMocks(REQUIRED_LABELS, {
      [projectLocalPiSmokeCommand(smokePaths)]: {
        code: 0,
        stdout: "PATCHMILL_SKILLS_OK\n",
      },
    }),
  );

  const results = await runDoctorChecks(runner, {
    repoRoot,
    teaRepoRootForTests: "/repo",
  });
  const skills = results.find((result) => result.name === "skills");

  assert.equal(skills?.status, "pass");
  assert.doesNotMatch(skills?.message ?? "", /metadata missing/);
  assert.match(skills?.message ?? "", /Pi loaded configured local skills/);
});

test("doctor does not parse project-local skill-pack metadata directly", async () => {
  const source = await readFile(
    new URL("./checks.ts", import.meta.url),
    "utf8",
  );

  assert.doesNotMatch(source, /checkProjectLocalMetadata/);
  assert.doesNotMatch(source, /isValidProjectLocalMetadata/);
  assert.doesNotMatch(source, /metadataSkillPaths/);
  assert.doesNotMatch(source, /resolveProjectLocalMetadataFilePath/);
  assert.doesNotMatch(source, /metadata\.files/);
  assert.doesNotMatch(source, /hashContent/);
  assert.doesNotMatch(source, /SKILL_PACK_METADATA_FILE/);
  assert.doesNotMatch(source, /patchmill-skill-pack(?:\.json)?/);
});

test("runDoctorChecks never invokes known mutating host commands", async () => {
  const repoRoot = await tempRepo();
  await writeFile(
    join(repoRoot, "patchmill.config.json"),
    JSON.stringify({
      host: { provider: "forgejo-tea", login: "triage-agent" },
    }),
  );
  const commands: string[] = [];
  const runner: CommandRunner = {
    async run(command, args) {
      commands.push([command, ...args].join(" "));
      return { code: 1, stdout: "", stderr: "mock failure" };
    },
  };

  await runDoctorChecks(runner, { repoRoot });

  assert.equal(
    commands.some((command) =>
      /\blabels create\b|\bissues edit\b|^tea comment\b/.test(command),
    ),
    false,
  );
});
