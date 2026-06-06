import type { PatchmillHostConfig } from "../config/types.ts";
import type { CommandRunner } from "../cli/commands/triage/types.ts";
import { ForgejoTeaHostProvider } from "./forgejo-tea.ts";
import { GitHubGhHostProvider } from "./github-gh.ts";
import type { GitHostProvider, IssueHostProvider } from "./types.ts";

export function createGitHostProvider(options: {
  runner: CommandRunner;
  repoRoot: string;
  host: PatchmillHostConfig;
}): GitHostProvider {
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

export function createIssueHostProvider(options: {
  runner: CommandRunner;
  repoRoot: string;
  host: PatchmillHostConfig;
}): IssueHostProvider {
  return createGitHostProvider(options);
}
