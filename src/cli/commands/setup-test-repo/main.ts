#!/usr/bin/env node
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { createCommandRunner } from "../triage/command.ts";
import type { CommandRunner } from "../triage/types.ts";
import { createGitHostProvider } from "../../../host/factory.ts";
import type { GitHostProvider, RepositoryTarget } from "../../../host/types.ts";
import { parseArgs } from "./args.ts";
import {
  copyFixtureToRepository,
  loadSetupIssues,
  resolveFixtureDirectory,
} from "./fixtures.ts";
import { SETUP_TEST_REPO_LABELS } from "./labels.ts";

export const HELP_TEXT = `Usage:
  patchmill setup-test-repo --provider github-gh --repo OWNER/REPO [--reset]
  patchmill setup-test-repo --provider forgejo-tea --repo OWNER/REPO --login LOGIN [--reset]

Create or reset a disposable public Team Lunch Poll repository for trying Patchmill.

Options:
  --help, -h             Show this help and exit.
  --provider PROVIDER    Required. One of: github-gh, forgejo-tea.
  --repo OWNER/REPO      Required. Disposable target repository.
  --login LOGIN          Optional named tea login for forgejo-tea.
  --reset                Delete and recreate the target repository before seeding.
`;

export type SetupTestRepoOutput = {
  stdout: (line: string) => void;
  stderr: (line: string) => void;
};

export type SetupTestRepoDependencies = {
  runner?: CommandRunner;
  output?: SetupTestRepoOutput;
  tempParent?: string;
  createProvider?: (options: {
    runner: CommandRunner;
    repoRoot: string;
    provider: "github-gh" | "forgejo-tea";
    login: string;
  }) => GitHostProvider;
};

const DEFAULT_OUTPUT: SetupTestRepoOutput = {
  stdout: (line) => console.log(line),
  stderr: (line) => console.error(line),
};

async function runGit(
  runner: CommandRunner,
  repoRoot: string,
  args: string[],
): Promise<void> {
  const result = await runner.run("git", args, { cwd: repoRoot });
  if (result.code !== 0) {
    throw new Error(
      `git ${args.join(" ")} failed: ${result.stderr || result.stdout}`,
    );
  }
}

async function ensureGit(runner: CommandRunner): Promise<void> {
  const result = await runner.run("git", ["--version"]);
  if (result.code !== 0) {
    throw new Error(`git --version failed: ${result.stderr || result.stdout}`);
  }
}

function createProviderFromFactory(options: {
  runner: CommandRunner;
  repoRoot: string;
  provider: "github-gh" | "forgejo-tea";
  login: string;
}): GitHostProvider {
  return createGitHostProvider({
    runner: options.runner,
    repoRoot: options.repoRoot,
    host: { provider: options.provider, login: options.login },
  });
}

async function prepareRepository(options: {
  provider: GitHostProvider;
  target: RepositoryTarget;
  reset: boolean;
  output: SetupTestRepoOutput;
}): Promise<void> {
  const exists = await options.provider.repoExists(options.target);
  if (exists && !options.reset) {
    throw new Error(
      `Repository ${options.target.slug} already exists. Rerun with --reset only if it is disposable and safe to delete.`,
    );
  }

  if (options.reset) {
    options.output.stdout(
      `Resetting ${options.provider.displayName} repository ${options.target.slug}`,
    );
    if (exists) await options.provider.deleteRepo(options.target);
  }

  await options.provider.createPublicRepo(options.target);
}

async function seedGitRepository(options: {
  runner: CommandRunner;
  repoRoot: string;
  remoteUrl: string;
}): Promise<void> {
  await runGit(options.runner, options.repoRoot, ["init", "-b", "main"]);
  await runGit(options.runner, options.repoRoot, [
    "add",
    "README.md",
    "PROJECT_BRIEF.md",
    "issues",
  ]);
  await runGit(options.runner, options.repoRoot, [
    "commit",
    "-m",
    "Seed Team Lunch Poll demo",
  ]);
  await runGit(options.runner, options.repoRoot, [
    "remote",
    "add",
    "origin",
    options.remoteUrl,
  ]);
  await runGit(options.runner, options.repoRoot, [
    "push",
    "-u",
    "origin",
    "main",
  ]);
}

async function createMissingLabels(provider: GitHostProvider): Promise<void> {
  const existingLabels = new Set(await provider.listLabels());
  for (const label of SETUP_TEST_REPO_LABELS) {
    if (!existingLabels.has(label.name)) await provider.createLabel(label);
  }
}

export async function runSetupTestRepo(
  args: string[],
  dependencies: SetupTestRepoDependencies = {},
): Promise<number> {
  const output = dependencies.output ?? DEFAULT_OUTPUT;
  try {
    const config = parseArgs(args);
    if (config.showHelp) {
      output.stdout(HELP_TEXT);
      return 0;
    }
    if (!config.provider || !config.target) {
      throw new Error("Invalid setup-test-repo configuration");
    }

    const runner = dependencies.runner ?? createCommandRunner();
    await ensureGit(runner);

    const tempParent = dependencies.tempParent ?? tmpdir();
    const repoRoot = await mkdtemp(join(tempParent, "patchmill-test-repo-"));
    try {
      const provider = (
        dependencies.createProvider ?? createProviderFromFactory
      )({
        runner,
        repoRoot,
        provider: config.provider,
        login: config.login ?? "",
      });

      const cli = await provider.checkCli();
      if (!cli.ok) {
        throw new Error([cli.message, ...cli.remediation].join("\n"));
      }

      await prepareRepository({
        provider,
        target: config.target,
        reset: config.reset,
        output,
      });

      const fixtureDir = await resolveFixtureDirectory();
      const issues = await loadSetupIssues(fixtureDir);
      await copyFixtureToRepository(fixtureDir, repoRoot);
      await seedGitRepository({
        runner,
        repoRoot,
        remoteUrl: await provider.gitRemoteUrl(config.target),
      });

      await createMissingLabels(provider);
      for (const issue of issues) await provider.createIssue(issue);

      output.stdout(`Seeded ${await provider.publicRepoUrl(config.target)}`);
      output.stdout("");
      output.stdout("Next steps:");
      output.stdout(`  ${provider.cloneCommand(config.target)}`);
      output.stdout(`  cd ${config.target.repo}`);
      output.stdout("  patchmill init");
      output.stdout("  patchmill triage --dry-run");
      output.stdout("  patchmill triage");
      return 0;
    } finally {
      await rm(repoRoot, { recursive: true, force: true });
    }
  } catch (error) {
    output.stderr(error instanceof Error ? error.message : String(error));
    return 1;
  }
}

export async function main(args = process.argv.slice(2)): Promise<number> {
  return runSetupTestRepo(args);
}

const isMain = process.argv[1]
  ? import.meta.url === pathToFileURL(process.argv[1]).href
  : false;

if (isMain) {
  process.exitCode = await main();
}
