import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHostForProvider } from "../../../host/factory.ts";
import type {
  HostProviderId,
  RepositorySetupHost,
} from "../../../host/types.ts";
import { CommandFailedError, runCommand } from "../../../process/command.ts";
import type { CommandRunner } from "../../../process/command.ts";
import type { CliOutput } from "../../main.ts";
import { parseArgs } from "./args.ts";
import {
  copyFixtureToRepository,
  loadSetupIssues,
  resolveFixtureDirectory,
} from "./fixtures.ts";
import { SETUP_TEST_REPO_LABELS } from "./labels.ts";

const HELP = `Usage: patchmill setup-test-repo --provider <github-gh|forgejo-tea> --repo OWNER/REPO [--login NAME] [--reset]
Create a public disposable fixture repository. --reset deletes an existing repository.`;
type Options = {
  runner?: CommandRunner;
  output?: CliOutput;
  tempParent?: string;
  createProvider?: (
    provider: HostProviderId,
    login: string,
    runner: CommandRunner,
    repoRoot: string,
  ) => RepositorySetupHost;
};

export async function main(
  args: string[] = process.argv.slice(2),
  options: Options = {},
): Promise<number> {
  const output = options.output ?? {
    stdout: console.log,
    stderr: console.error,
  };
  let directory: string | undefined;
  let created = false;
  let host: RepositorySetupHost | undefined;
  let config: ReturnType<typeof parseArgs> | undefined;
  try {
    config = parseArgs(args);
    if (config.showHelp) {
      output.stdout(HELP);
      return 0;
    }
    const target = config.target!;
    const fixture = await resolveFixtureDirectory();
    const issues = await loadSetupIssues(fixture);
    directory = await mkdtemp(
      join(options.tempParent ?? tmpdir(), "patchmill-setup-"),
    );
    const runner = options.runner ?? runCommand;
    host = (options.createProvider ?? createHostForProvider)(
      config.provider!,
      config.login ?? "",
      runner,
      directory,
    );
    const cli = await host.checkCli();
    if (!cli.ok) throw new Error(cli.message);
    const existing = await host.getRepository(target);
    if (existing && !config.reset)
      throw new Error(
        `${target.slug} already exists; use --reset to delete and recreate it`,
      );
    if (existing) {
      output.stdout(`Deleting ${target.slug}`);
      await host.deleteRepo(target);
    }
    output.stdout(`Creating ${target.slug} on ${host.displayName}`);
    await host.createPublicRepo(target);
    created = true;
    const repository = await host.getRepository(target);
    if (!repository)
      throw new Error(`Created repository ${target.slug} could not be found`);
    await copyFixtureToRepository(fixture, directory);
    const git = async (argv: string[]) => {
      const result = await runner("git", argv, { cwd: directory! });
      if (result.code !== 0) throw new CommandFailedError("git", argv, result);
    };
    await git(["init", "--initial-branch=main"]);
    await git(["add", "."]);
    await git([
      "-c",
      "user.name=Patchmill",
      "-c",
      "user.email=patchmill@example.invalid",
      "commit",
      "-m",
      "Seed demo repository",
    ]);
    await git(["remote", "add", "origin", repository.gitRemoteUrl]);
    await git(["push", "--set-upstream", "origin", "main"]);
    const labels = new Set(await host.listLabels(target));
    for (const label of SETUP_TEST_REPO_LABELS) {
      if (!labels.has(label.name)) await host.createLabel(target, label);
    }
    for (const issue of issues) await host.createIssue(target, issue);
    output.stdout(
      `Created ${issues.length} fixture issues: ${repository.publicUrl}`,
    );
    output.stdout(
      `Next: ${host.cloneCommand(target)}, then run patchmill init and patchmill triage.`,
    );
    return 0;
  } catch (error) {
    output.stderr(error instanceof Error ? error.message : String(error));
    if (created && host && config?.target) {
      try {
        await host.deleteRepo(config.target);
      } catch (rollbackError) {
        output.stderr(`Rollback failed: ${String(rollbackError)}`);
      }
    }
    return 1;
  } finally {
    if (directory) await rm(directory, { recursive: true, force: true });
  }
}
