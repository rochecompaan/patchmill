import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { HELP_TEXT, runSetupTestRepo } from "./main.ts";
import type { CommandRunner } from "../triage/types.ts";
import type {
  GitHostProvider,
  HostCliCheck,
  HostIssueCreateInput,
  LabelChangePlan,
  LabelDefinition,
  RepositoryTarget,
} from "../../../host/types.ts";

function okCli(): HostCliCheck {
  return { ok: true, message: "ok" };
}

function createProvider(
  options: { exists?: boolean; cli?: HostCliCheck } = {},
): {
  provider: GitHostProvider;
  calls: string[];
  issues: HostIssueCreateInput[];
  labels: LabelDefinition[];
} {
  const calls: string[] = [];
  const issues: HostIssueCreateInput[] = [];
  const labels: LabelDefinition[] = [];
  const provider: GitHostProvider = {
    id: "github-gh",
    displayName: "GitHub via gh",
    async checkCli() {
      calls.push("checkCli");
      return options.cli ?? okCli();
    },
    missingLabelRemediation(label) {
      return `create ${label.name}`;
    },
    async listOpenIssues() {
      return [];
    },
    async viewIssue() {
      throw new Error("not used");
    },
    async hydrateIssueComments(value) {
      return value;
    },
    async listLabels() {
      return [];
    },
    async createLabel(label) {
      labels.push(label);
    },
    async applyLabels(_change: LabelChangePlan) {},
    async commentIssue() {},
    async repoExists() {
      calls.push("repoExists");
      return options.exists ?? false;
    },
    async createPublicRepo(target: RepositoryTarget) {
      calls.push(`createPublicRepo:${target.slug}`);
    },
    async deleteRepo(target: RepositoryTarget) {
      calls.push(`deleteRepo:${target.slug}`);
    },
    async gitRemoteUrl(target: RepositoryTarget) {
      return `https://example.test/${target.slug}.git`;
    },
    async publicRepoUrl(target: RepositoryTarget) {
      return `https://example.test/${target.slug}`;
    },
    cloneCommand(target: RepositoryTarget) {
      return `gh repo clone ${target.slug}`;
    },
    async createIssue(issue: HostIssueCreateInput) {
      issues.push(issue);
    },
  };
  return { provider, calls, issues, labels };
}

function createGitRunner(options: { failOn?: string } = {}): {
  runner: CommandRunner;
  gitCalls: string[][];
} {
  const gitCalls: string[][] = [];
  return {
    gitCalls,
    runner: {
      async run(command, args) {
        if (command !== "git")
          throw new Error(`Unexpected command: ${command}`);
        gitCalls.push(args);
        if (args[0] === options.failOn) {
          return { code: 1, stdout: "", stderr: `git ${args[0]} failed` };
        }
        return { code: 0, stdout: "", stderr: "" };
      },
    },
  };
}

test("runSetupTestRepo creates a new repo, pushes fixtures, labels, and issues", async () => {
  const tempParent = await mkdtemp(join(tmpdir(), "patchmill-setup-test-"));
  const { provider, calls, labels, issues } = createProvider({ exists: false });
  const { runner, gitCalls } = createGitRunner();
  const stdout: string[] = [];

  const code = await runSetupTestRepo(
    ["--provider", "github-gh", "--repo", "OWNER/patchmill-test"],
    {
      runner,
      tempParent,
      output: { stdout: (line) => stdout.push(line), stderr: () => undefined },
      createProvider: () => provider,
    },
  );

  assert.equal(code, 0);
  assert.deepEqual(calls, [
    "checkCli",
    "repoExists",
    "createPublicRepo:OWNER/patchmill-test",
  ]);
  assert.deepEqual(
    gitCalls.map((args) => args[0]),
    ["--version", "init", "add", "commit", "remote", "push"],
  );
  assert.deepEqual(
    labels.map((label) => label.name),
    ["feature", "bug", "docs", "polish"],
  );
  assert.equal(issues.length, 12);
  assert.equal(issues[0]?.title, "Create the Team Lunch Poll app scaffold");
  assert.match(
    stdout.join("\n"),
    /https:\/\/example\.test\/OWNER\/patchmill-test/u,
  );
  assert.match(stdout.join("\n"), /gh repo clone OWNER\/patchmill-test/u);
  assert.match(stdout.join("\n"), /patchmill init/u);

  await rm(tempParent, { recursive: true, force: true });
});

test("runSetupTestRepo refuses existing repo without reset", async () => {
  const { provider } = createProvider({ exists: true });
  const { runner } = createGitRunner();
  const stderr: string[] = [];

  const code = await runSetupTestRepo(
    ["--provider", "github-gh", "--repo", "OWNER/patchmill-test"],
    {
      runner,
      output: { stdout: () => undefined, stderr: (line) => stderr.push(line) },
      createProvider: () => provider,
    },
  );

  assert.equal(code, 1);
  assert.match(stderr.join("\n"), /already exists/u);
  assert.match(stderr.join("\n"), /--reset/u);
});

test("runSetupTestRepo deletes and recreates when reset is supplied", async () => {
  const { provider, calls } = createProvider({ exists: true });
  const { runner } = createGitRunner();

  const code = await runSetupTestRepo(
    ["--provider", "github-gh", "--repo", "OWNER/patchmill-test", "--reset"],
    {
      runner,
      output: { stdout: () => undefined, stderr: () => undefined },
      createProvider: () => provider,
    },
  );

  assert.equal(code, 0);
  assert.deepEqual(calls, [
    "checkCli",
    "repoExists",
    "deleteRepo:OWNER/patchmill-test",
    "createPublicRepo:OWNER/patchmill-test",
  ]);
});

test("runSetupTestRepo reports provider CLI failures", async () => {
  const { provider } = createProvider({
    cli: {
      ok: false,
      message: "gh auth status failed",
      remediation: ["run gh auth login"],
    },
  });
  const { runner } = createGitRunner();
  const stderr: string[] = [];

  const code = await runSetupTestRepo(
    ["--provider", "github-gh", "--repo", "OWNER/patchmill-test"],
    {
      runner,
      output: { stdout: () => undefined, stderr: (line) => stderr.push(line) },
      createProvider: () => provider,
    },
  );

  assert.equal(code, 1);
  assert.match(stderr.join("\n"), /gh auth status failed/u);
  assert.match(stderr.join("\n"), /run gh auth login/u);
});

test("runSetupTestRepo reports git command failures", async () => {
  const { provider } = createProvider({ exists: false });
  const { runner } = createGitRunner({ failOn: "push" });
  const stderr: string[] = [];

  const code = await runSetupTestRepo(
    ["--provider", "github-gh", "--repo", "OWNER/patchmill-test"],
    {
      runner,
      output: { stdout: () => undefined, stderr: (line) => stderr.push(line) },
      createProvider: () => provider,
    },
  );

  assert.equal(code, 1);
  assert.match(stderr.join("\n"), /git push -u origin main failed/u);
});

test("runSetupTestRepo prints help without dependencies", async () => {
  const stdout: string[] = [];
  const code = await runSetupTestRepo(["--help"], {
    output: { stdout: (line) => stdout.push(line), stderr: () => undefined },
  });

  assert.equal(code, 0);
  assert.deepEqual(stdout, [HELP_TEXT]);
});
