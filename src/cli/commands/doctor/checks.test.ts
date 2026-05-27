import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { runDoctorChecks } from "./checks.ts";
import type { CommandRunner } from "../triage/types.ts";

async function tempRepo(): Promise<string> {
  return mkdtemp(join(tmpdir(), "patchmill-doctor-"));
}

function runnerFrom(
  map: Record<string, { code: number; stdout?: string; stderr?: string }>,
): CommandRunner {
  return {
    async run(command, args) {
      const key = [command, ...args].join(" ");
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
];

function successMocks(labels = REQUIRED_LABELS) {
  return {
    "git rev-parse --is-inside-work-tree": { code: 0, stdout: "true\n" },
    "git branch --show-current": { code: 0, stdout: "main\n" },
    "git status --porcelain=v1 --untracked-files=all": { code: 0, stdout: "" },
    "tea --help": { code: 0, stdout: "tea help" },
    "tea issues list --state open --fields index,title,body,state,labels,author,updated,comments --page 1 --limit 1000 --output json --repo /repo --login triage-agent":
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
  };
}

test("runDoctorChecks aggregates successful read-only checks", async () => {
  const repoRoot = await tempRepo();
  await writeFile(
    join(repoRoot, "patchmill.config.json"),
    JSON.stringify({
      host: { provider: "forgejo-tea", login: "triage-agent" },
    }),
  );
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
    results.some((result) => result.status === "fail"),
    false,
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

test("runDoctorChecks reports missing labels with manual commands", async () => {
  const repoRoot = await tempRepo();
  await writeFile(
    join(repoRoot, "patchmill.config.json"),
    JSON.stringify({
      host: { provider: "forgejo-tea", login: "triage-agent" },
    }),
  );
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
  assert.match(
    (labels?.remediation ?? []).join("\n"),
    /tea labels create --name agent-ready/,
  );
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
