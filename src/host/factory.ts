import type { CommandRunner } from "../command/types.ts";
import type { PatchmillHostConfig } from "../config/types.ts";
import { ForgejoTeaPullRequestHost } from "./forgejo-tea-pull-requests.ts";
import { GitHubGhPullRequestHost } from "./github-gh-pull-requests.ts";
import type { PullRequestHost } from "./pull-requests.ts";
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

export function createPullRequestHost(options: {
  runner: CommandRunner;
  repoRoot: string;
  remote: string;
  host: PatchmillHostConfig;
}): PullRequestHost {
  switch (options.host.provider) {
    case "github-gh":
      return new GitHubGhPullRequestHost({
        runner: options.runner,
        repoRoot: options.repoRoot,
        pushRemote: options.remote,
      });
    case "forgejo-tea":
      return new ForgejoTeaPullRequestHost({
        runner: options.runner,
        repoRoot: options.repoRoot,
        pushRemote: options.remote,
        login: options.host.login,
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
