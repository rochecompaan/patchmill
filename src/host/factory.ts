import type { PatchmillHostConfig } from "../config/types.ts";
import type { CommandRunner } from "../cli/commands/triage/types.ts";
import { ForgejoTeaHostProvider } from "./forgejo-tea.ts";
import { GitHubGhHostProvider } from "./github-gh.ts";
import type {
  IssueHostProvider,
  RepositorySetupHostProvider,
  RunOnceHostProvider,
} from "./types.ts";

function createHostProvider(options: {
  runner: CommandRunner;
  repoRoot: string;
  host: PatchmillHostConfig;
}): ForgejoTeaHostProvider | GitHubGhHostProvider {
  switch (options.host.provider) {
    case "forgejo-tea":
      return new ForgejoTeaHostProvider({
        runner: options.runner,
        repoRoot: options.repoRoot,
        login: options.host.login,
      });
    case "github-gh":
      return new GitHubGhHostProvider({
        runner: options.runner,
        repoRoot: options.repoRoot,
      });
  }
}

export function createRepositorySetupHostProvider(options: {
  runner: CommandRunner;
  repoRoot: string;
  host: PatchmillHostConfig;
}): RepositorySetupHostProvider {
  return createHostProvider(options);
}

export function createIssueHostProvider(options: {
  runner: CommandRunner;
  repoRoot: string;
  host: PatchmillHostConfig;
}): IssueHostProvider {
  return createHostProvider(options);
}

export function createRunOnceHostProvider(options: {
  runner: CommandRunner;
  repoRoot: string;
  host: PatchmillHostConfig;
}): RunOnceHostProvider {
  return createHostProvider(options);
}
