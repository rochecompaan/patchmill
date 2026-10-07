import type { CommandRunner } from "../command/types.ts";
import {
  PullRequestIdentityError,
  sameRepositoryIdentity,
  type RepositoryIdentity,
} from "../host/pull-requests.ts";
import { parseForgejoRemoteUrl } from "../host/forgejo-tea-pull-request-parsing.ts";

export type ImplementationPrTargetRemote = {
  remote: string;
  url: string;
  targetRepository: RepositoryIdentity;
};
export class ImplementationPrTargetRemoteError extends Error {
  constructor(reason: string) {
    super(`Implementation PR target fetch is unavailable: ${reason}`);
    this.name = "ImplementationPrTargetRemoteError";
  }
}
function identity(
  url: string,
  target: RepositoryIdentity,
): RepositoryIdentity | undefined {
  try {
    // Strict raw-path parsing rejects URL normalization, credentials and local URLs.
    const coordinates = parseForgejoRemoteUrl(url);
    if (target.provider === "github-gh" && url.startsWith("http://"))
      return undefined;
    return {
      provider: target.provider,
      host:
        target.provider === "github-gh" && url.includes("://")
          ? new URL(url).hostname.toLowerCase()
          : coordinates.host,
      owner: coordinates.owner,
      repository: coordinates.repository,
    };
  } catch (error) {
    if (error instanceof PullRequestIdentityError) return undefined;
    throw error;
  }
}

/** Selects exactly one preconfigured, expanded fetch endpoint. Never changes Git config. */
export async function resolveImplementationPrTargetRemote(
  runner: CommandRunner,
  repoRoot: string,
  target: RepositoryIdentity,
): Promise<ImplementationPrTargetRemote> {
  const command = async (args: string[]) => {
    const result = await runner.run("git", args, { cwd: repoRoot });
    if (result.code !== 0)
      throw new ImplementationPrTargetRemoteError(
        "Git remote inspection failed",
      );
    return result.stdout.split(/\r?\n/u).filter(Boolean);
  };
  const candidates: ImplementationPrTargetRemote[] = [];
  for (const remote of await command(["remote"])) {
    if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/u.test(remote))
      throw new ImplementationPrTargetRemoteError(
        "invalid configured remote name",
      );
    // get-url expands insteadOf. Push URLs are deliberately irrelevant here.
    const urls = await command(["remote", "get-url", "--all", "--", remote]);
    const matches = urls.filter((url) => {
      const parsed = identity(url, target);
      return parsed !== undefined && sameRepositoryIdentity(parsed, target);
    });
    if (matches.length === 0) continue;
    if (urls.length !== 1)
      throw new ImplementationPrTargetRemoteError("ambiguous fetch endpoints");
    candidates.push({ remote, url: urls[0]!, targetRepository: target });
  }
  if (candidates.length !== 1)
    throw new ImplementationPrTargetRemoteError(
      candidates.length
        ? "ambiguous configured fetch remotes"
        : "no configured fetch remote matches the saved target",
    );
  return candidates[0]!;
}
