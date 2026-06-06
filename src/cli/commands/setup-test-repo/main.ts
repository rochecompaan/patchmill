#!/usr/bin/env node
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { createCommandRunner } from "../triage/command.ts";
import type { CommandRunner } from "../triage/types.ts";
import { createRepositorySetupHostProvider } from "../../../host/factory.ts";
import type {
  RepositoryInfo,
  RepositorySetupHostProvider,
  RepositoryTarget,
} from "../../../host/types.ts";
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
  }) => RepositorySetupHostProvider;
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
}): RepositorySetupHostProvider {
  return createRepositorySetupHostProvider({
    runner: options.runner,
    repoRoot: options.repoRoot,
    host: { provider: options.provider, login: options.login },
  });
}

async function prepareRepository(options: {
  provider: RepositorySetupHostProvider;
  target: RepositoryTarget;
  reset: boolean;
  output: SetupTestRepoOutput;
  markCreated: () => void;
}): Promise<RepositoryInfo> {
  const existing = await options.provider.getRepository(options.target);
  if (existing && !options.reset) {
    throw new Error(
      `Repository ${options.target.slug} already exists. Rerun with --reset only if it is disposable and safe to delete.`,
    );
  }

  if (options.reset) {
    options.output.stdout(
      `Resetting ${options.provider.displayName} repository ${options.target.slug}${existing ? ` (${existing.publicUrl})` : ""}`,
    );
    if (existing) {
      options.output.stdout(`Deleting ${options.target.slug}`);
      await options.provider.deleteRepo(options.target);
    }
    options.output.stdout(`Creating public repository ${options.target.slug}`);
  }

  await options.provider.createPublicRepo(options.target);
  options.markCreated();
  const created = await options.provider.getRepository(options.target);
  if (!created) {
    throw new Error(
      `Repository ${options.target.slug} was created but could not be read back from ${options.provider.displayName}`,
    );
  }
  return created;
}

async function createSeedCommit(options: {
  runner: CommandRunner;
  repoRoot: string;
}): Promise<void> {
  await runGit(options.runner, options.repoRoot, ["init", "-b", "main"]);
  await runGit(options.runner, options.repoRoot, [
    "add",
    "README.md",
    "PROJECT_BRIEF.md",
    "issues",
  ]);
  await runGit(options.runner, options.repoRoot, [
    "-c",
    "user.name=Patchmill",
    "-c",
    "user.email=patchmill@example.invalid",
    "commit",
    "-m",
    "Seed Team Lunch Poll demo",
  ]);
}

async function pushSeedCommit(options: {
  runner: CommandRunner;
  repoRoot: string;
  remoteUrl: string;
}): Promise<void> {
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

async function createMissingLabels(
  provider: RepositorySetupHostProvider,
  target: RepositoryTarget,
): Promise<void> {
  const existingLabels = new Set(await provider.listLabels(target));
  for (const label of SETUP_TEST_REPO_LABELS) {
    if (!existingLabels.has(label.name))
      await provider.createLabel(target, label);
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function rollbackCreatedRepository(options: {
  provider: RepositorySetupHostProvider;
  target: RepositoryTarget;
}): Promise<string> {
  try {
    await options.provider.deleteRepo(options.target);
    return `Rolled back ${options.target.slug} after setup failure.`;
  } catch (rollbackError) {
    return `Rollback failed for ${options.target.slug}: ${errorMessage(rollbackError)}`;
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

      const fixtureDir = await resolveFixtureDirectory();
      const issues = await loadSetupIssues(fixtureDir);
      await copyFixtureToRepository(fixtureDir, repoRoot);
      await createSeedCommit({
        runner,
        repoRoot,
      });

      let createdRemote = false;
      try {
        const repository = await prepareRepository({
          provider,
          target: config.target,
          reset: config.reset,
          output,
          markCreated: () => {
            createdRemote = true;
          },
        });

        await pushSeedCommit({
          runner,
          repoRoot,
          remoteUrl: repository.gitRemoteUrl,
        });

        await createMissingLabels(provider, config.target);
        for (const issue of issues)
          await provider.createIssue(config.target, issue);

        output.stdout(`Seeded ${repository.publicUrl}`);
      } catch (error) {
        if (createdRemote) {
          const rollbackMessage = await rollbackCreatedRepository({
            provider,
            target: config.target,
          });
          throw new Error(`${errorMessage(error)}\n${rollbackMessage}`, {
            cause: error,
          });
        }
        throw error;
      }
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
