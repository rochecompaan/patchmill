import type { PatchmillHostProviderId } from "../../../config/types.ts";
import type { RepositoryTarget } from "../../../host/types.ts";

export type SetupTestRepoConfig = {
  showHelp: boolean;
  provider?: PatchmillHostProviderId;
  target?: RepositoryTarget;
  login?: string;
  reset: boolean;
};

const SUPPORTED_PROVIDERS = new Set<PatchmillHostProviderId>([
  "github-gh",
  "forgejo-tea",
]);

function requireValue(args: string[], index: number, flag: string): string {
  const value = args[index + 1];
  if (!value || value.startsWith("--"))
    throw new Error(`${flag} requires a value`);
  return value;
}

function parseRepo(value: string): RepositoryTarget {
  const match = /^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)$/u.exec(value);
  if (!match) throw new Error("--repo must use OWNER/REPO");
  return { owner: match[1], repo: match[2], slug: value };
}

function parseProvider(value: string): PatchmillHostProviderId {
  if (SUPPORTED_PROVIDERS.has(value as PatchmillHostProviderId)) {
    return value as PatchmillHostProviderId;
  }
  throw new Error(`Unsupported provider: ${value}`);
}

export function parseArgs(args: string[]): SetupTestRepoConfig {
  const config: SetupTestRepoConfig = { showHelp: false, reset: false };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--help" || arg === "-h") {
      config.showHelp = true;
    } else if (arg === "--provider") {
      config.provider = parseProvider(requireValue(args, index, arg));
      index += 1;
    } else if (arg.startsWith("--provider=")) {
      config.provider = parseProvider(arg.slice("--provider=".length));
    } else if (arg === "--repo") {
      config.target = parseRepo(requireValue(args, index, arg));
      index += 1;
    } else if (arg.startsWith("--repo=")) {
      config.target = parseRepo(arg.slice("--repo=".length));
    } else if (arg === "--login") {
      config.login = requireValue(args, index, arg);
      index += 1;
    } else if (arg.startsWith("--login=")) {
      config.login = arg.slice("--login=".length);
      if (!config.login) throw new Error("--login requires a value");
    } else if (arg === "--reset") {
      config.reset = true;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (config.showHelp) return config;
  if (!config.provider) throw new Error("--provider is required");
  if (!config.target) throw new Error("--repo OWNER/REPO is required");
  if (config.login && config.provider !== "forgejo-tea") {
    throw new Error("--login is only supported with forgejo-tea");
  }

  return config;
}
