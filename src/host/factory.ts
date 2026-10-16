import type { PatchmillConfig } from "../config/config.ts";
import type { CommandRunner } from "../process/command.ts";
import { GitHubHost } from "./github-gh.ts";
import { ForgejoHost } from "./forgejo-tea.ts";
import type { Host, HostProviderId, RepositorySetupHost } from "./types.ts";

export function createHost(
  config: PatchmillConfig,
  runner: CommandRunner,
  repoRoot: string,
): Host & RepositorySetupHost {
  return createHostForProvider(
    config.host.provider,
    config.host.login,
    runner,
    repoRoot,
  );
}

export function createHostForProvider(
  provider: HostProviderId,
  login: string,
  runner: CommandRunner,
  repoRoot: string,
): Host & RepositorySetupHost {
  if (provider === "github-gh") return new GitHubHost({ runner, repoRoot });
  return new ForgejoHost({ runner, repoRoot, login });
}
