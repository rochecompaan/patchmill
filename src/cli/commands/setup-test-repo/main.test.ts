import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { HELP_TEXT, runSetupTestRepo } from "./main.ts";
import type { CommandRunner } from "../triage/types.ts";
import type {
  HostCliCheck,
  HostIssueCreateInput,
  LabelDefinition,
  RepositoryInfo,
  RepositorySetupHostProvider,
  RepositoryTarget,
} from "../../../host/types.ts";

function okCli(): HostCliCheck {
  return { ok: true, message: "ok" };
}

function createProvider(
  options: {
    exists?: boolean;
    cli?: HostCliCheck;
    existingLabels?: string[];
    failCreateIssue?: boolean;
    events?: string[];
  } = {},
): {
  provider: RepositorySetupHostProvider;
  calls: string[];
  issues: Array<{ target: RepositoryTarget; issue: HostIssueCreateInput }>;
  labels: Array<{ target: RepositoryTarget; label: LabelDefinition }>;
} {
  const calls: string[] = [];
  const events = options.events;
  const issues: Array<{
    target: RepositoryTarget;
    issue: HostIssueCreateInput;
  }> = [];
  const labels: Array<{ target: RepositoryTarget; label: LabelDefinition }> =
    [];
  let repositoryExists = options.exists ?? false;
  const info = (target: RepositoryTarget): RepositoryInfo => ({
    publicUrl: `https://example.test/${target.slug}`,
    gitRemoteUrl: `https://example.test/${target.slug}.git`,
  });
  const provider: RepositorySetupHostProvider = {
    id: "github-gh",
    displayName: "GitHub via gh",
    async checkCli() {
      calls.push("checkCli");
      events?.push("checkCli");
      return options.cli ?? okCli();
    },
    async getRepository(target: RepositoryTarget) {
      calls.push(`getRepository:${target.slug}`);
      events?.push(`getRepository:${target.slug}`);
      return repositoryExists ? info(target) : undefined;
    },
    async listLabels(target: RepositoryTarget) {
      calls.push(`listLabels:${target.slug}`);
      return options.existingLabels ?? [];
    },
    async createPublicRepo(target: RepositoryTarget) {
      repositoryExists = true;
      events?.push(`createPublicRepo:${target.slug}`);
      calls.push(`createPublicRepo:${target.slug}`);
    },
    async deleteRepo(target: RepositoryTarget) {
      repositoryExists = false;
      events?.push(`deleteRepo:${target.slug}`);
      calls.push(`deleteRepo:${target.slug}`);
    },
    cloneCommand(target: RepositoryTarget) {
      return `gh repo clone ${target.slug}`;
    },
    async createLabel(target: RepositoryTarget, label: LabelDefinition) {
      events?.push(`createLabel:${label.name}`);
      labels.push({ target, label });
    },
    async createIssue(target: RepositoryTarget, issue: HostIssueCreateInput) {
      events?.push(`createIssue:${issue.title}`);
      if (options.failCreateIssue) throw new Error("issue create failed");
      issues.push({ target, issue });
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

function createEventedGitRunner(
  events: string[],
  options: { failOn?: string } = {},
): CommandRunner {
  return {
    async run(command, args) {
      if (command !== "git") throw new Error(`Unexpected command: ${command}`);
      events.push(`git:${args[0]}`);
      if (args[0] === options.failOn) {
        return { code: 1, stdout: "", stderr: `git ${args[0]} failed` };
      }
      return { code: 0, stdout: "", stderr: "" };
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
    "getRepository:OWNER/patchmill-test",
    "createPublicRepo:OWNER/patchmill-test",
    "getRepository:OWNER/patchmill-test",
    "listLabels:OWNER/patchmill-test",
  ]);
  assert.deepEqual(
    gitCalls.map((args) => args[0]),
    ["--version", "init", "add", "-c", "remote", "push"],
  );
  const commitArgs = gitCalls.find((args) => args.includes("commit"));
  assert.deepEqual(commitArgs?.slice(0, 5), [
    "-c",
    "user.name=Patchmill",
    "-c",
    "user.email=patchmill@example.invalid",
    "commit",
  ]);
  assert.deepEqual(
    labels.map(({ label }) => label.name),
    ["feature", "bug", "docs", "polish"],
  );
  assert.equal(issues.length, 12);
  assert.equal(
    issues[0]?.issue.title,
    "Create the Team Lunch Poll app scaffold",
  );
  assert.ok(
    issues.every(({ target }) => target.slug === "OWNER/patchmill-test"),
  );
  assert.ok(
    labels.every(({ target }) => target.slug === "OWNER/patchmill-test"),
  );
  assert.match(
    stdout.join("\n"),
    /https:\/\/example\.test\/OWNER\/patchmill-test/u,
  );
  assert.match(stdout.join("\n"), /gh repo clone OWNER\/patchmill-test/u);
  assert.match(stdout.join("\n"), /patchmill init/u);
  assert.deepEqual(stdout.slice(0, 16), [
    "Pushing seed commit",
    "Ensuring labels",
    "Seeding issues (12)",
    "  [1/12] Create the Team Lunch Poll app scaffold",
    "  [2/12] Define the poll domain model",
    "  [3/12] Build the create poll form",
    "  [4/12] Add poll listing and detail pages",
    "  [5/12] Implement vote submission",
    "  [6/12] Show live poll results",
    "  [7/12] Add poll closing behavior",
    "  [8/12] Improve empty and loading states",
    "  [9/12] Document local development workflow",
    "  [10/12] Polish responsive layout",
    "  [11/12] Add basic accessibility checks",
    "  [12/12] Fix votes disappearing after refresh",
    "Seeded https://example.test/OWNER/patchmill-test",
  ]);

  await rm(tempParent, { recursive: true, force: true });
});

test("runSetupTestRepo skips labels that already exist on the host", async () => {
  const tempParent = await mkdtemp(join(tmpdir(), "patchmill-setup-test-"));
  const { provider, labels } = createProvider({
    exists: false,
    existingLabels: ["bug"],
  });
  const { runner } = createGitRunner();

  const code = await runSetupTestRepo(
    ["--provider", "github-gh", "--repo", "OWNER/patchmill-test"],
    {
      runner,
      tempParent,
      output: { stdout: () => undefined, stderr: () => undefined },
      createProvider: () => provider,
    },
  );

  assert.equal(code, 0);
  assert.deepEqual(
    labels.map(({ label }) => label.name),
    ["feature", "docs", "polish"],
  );

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
  const stdout: string[] = [];

  const code = await runSetupTestRepo(
    ["--provider", "github-gh", "--repo", "OWNER/patchmill-test", "--reset"],
    {
      runner,
      output: { stdout: (line) => stdout.push(line), stderr: () => undefined },
      createProvider: () => provider,
    },
  );

  assert.equal(code, 0);
  assert.deepEqual(calls, [
    "checkCli",
    "getRepository:OWNER/patchmill-test",
    "deleteRepo:OWNER/patchmill-test",
    "createPublicRepo:OWNER/patchmill-test",
    "getRepository:OWNER/patchmill-test",
    "listLabels:OWNER/patchmill-test",
  ]);
  assert.match(
    stdout.join("\n"),
    /https:\/\/example\.test\/OWNER\/patchmill-test/u,
  );
  assert.match(stdout.join("\n"), /Deleting OWNER\/patchmill-test/u);
  assert.match(
    stdout.join("\n"),
    /Creating public repository OWNER\/patchmill-test/u,
  );
  const resetOutput = stdout.join("\n");
  assert.ok(
    resetOutput.indexOf("Creating public repository OWNER/patchmill-test") <
      resetOutput.indexOf("Pushing seed commit"),
    resetOutput,
  );
  assert.ok(
    resetOutput.indexOf("Pushing seed commit") <
      resetOutput.indexOf("Seeded https://example.test/OWNER/patchmill-test"),
    resetOutput,
  );
});

test("runSetupTestRepo prepares and commits local fixtures before mutating the host", async () => {
  const tempParent = await mkdtemp(join(tmpdir(), "patchmill-setup-test-"));
  const events: string[] = [];
  const { provider } = createProvider({ exists: false, events });

  const code = await runSetupTestRepo(
    ["--provider", "github-gh", "--repo", "OWNER/patchmill-test"],
    {
      runner: createEventedGitRunner(events),
      tempParent,
      output: { stdout: () => undefined, stderr: () => undefined },
      createProvider: () => provider,
    },
  );

  assert.equal(code, 0);
  assert.ok(
    events.indexOf("git:commit") <
      events.indexOf("createPublicRepo:OWNER/patchmill-test"),
    events.join("\n"),
  );

  await rm(tempParent, { recursive: true, force: true });
});

test("runSetupTestRepo prints per-issue progress before creating each issue", async () => {
  const tempParent = await mkdtemp(join(tmpdir(), "patchmill-setup-test-"));
  const events: string[] = [];
  const { provider } = createProvider({ exists: false, events });

  const code = await runSetupTestRepo(
    ["--provider", "github-gh", "--repo", "OWNER/patchmill-test"],
    {
      runner: createEventedGitRunner(events),
      tempParent,
      output: {
        stdout: (line) => events.push(`stdout:${line}`),
        stderr: () => undefined,
      },
      createProvider: () => provider,
    },
  );

  assert.equal(code, 0);
  assert.ok(
    events.indexOf("stdout:Pushing seed commit") < events.indexOf("git:push"),
    events.join("\n"),
  );
  assert.ok(
    events.indexOf("stdout:Ensuring labels") <
      events.indexOf("createLabel:feature"),
    events.join("\n"),
  );
  assert.ok(
    events.indexOf("stdout:  [1/12] Create the Team Lunch Poll app scaffold") <
      events.indexOf("createIssue:Create the Team Lunch Poll app scaffold"),
    events.join("\n"),
  );

  await rm(tempParent, { recursive: true, force: true });
});

test("runSetupTestRepo rolls back the created repository when seeding fails", async () => {
  const tempParent = await mkdtemp(join(tmpdir(), "patchmill-setup-test-"));
  const { provider, calls } = createProvider({
    exists: false,
    failCreateIssue: true,
  });
  const { runner } = createGitRunner();
  const stdout: string[] = [];
  const stderr: string[] = [];

  const code = await runSetupTestRepo(
    ["--provider", "github-gh", "--repo", "OWNER/patchmill-test"],
    {
      runner,
      tempParent,
      output: {
        stdout: (line) => stdout.push(line),
        stderr: (line) => stderr.push(line),
      },
      createProvider: () => provider,
    },
  );

  assert.equal(code, 1);
  assert.match(stdout.join("\n"), /Pushing seed commit/u);
  assert.match(stdout.join("\n"), /Ensuring labels/u);
  assert.match(stdout.join("\n"), /Seeding issues \(12\)/u);
  assert.match(
    stdout.join("\n"),
    /\[1\/12\] Create the Team Lunch Poll app scaffold/u,
  );
  assert.ok(calls.includes("deleteRepo:OWNER/patchmill-test"));
  assert.match(stderr.join("\n"), /issue create failed/u);
  assert.match(stderr.join("\n"), /Rolled back OWNER\/patchmill-test/u);

  await rm(tempParent, { recursive: true, force: true });
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
