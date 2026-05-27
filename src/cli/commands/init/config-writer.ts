import { constants } from "node:fs";
import { access, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { DEFAULT_PATCHMILL_CONFIG } from "../../../config/defaults.ts";
import type { PatchmillConfig } from "../../../config/types.ts";

export const CONFIG_FILE_NAME = "patchmill.config.json";

type InitialConfig = {
  host: Pick<PatchmillConfig["host"], "provider" | "login">;
};

export type InitWriteResult =
  | { status: "created"; path: string; config: InitialConfig }
  | { status: "exists"; path: string };

export function inferHostProviderFromRemote(
  _remoteUrl: string | undefined,
): PatchmillConfig["host"]["provider"] {
  return "forgejo-tea";
}

export function buildInitialConfig(
  options: {
    provider?: PatchmillConfig["host"]["provider"];
    login?: string;
  } = {},
): InitialConfig {
  return {
    host: {
      provider: options.provider ?? DEFAULT_PATCHMILL_CONFIG.host.provider,
      login: options.login ?? DEFAULT_PATCHMILL_CONFIG.host.login,
    },
  };
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function originRemoteUrl(repoRoot: string): Promise<string | undefined> {
  try {
    const config = await readFile(join(repoRoot, ".git", "config"), "utf8");
    const lines = config.split(/\r?\n/u);
    let inOrigin = false;
    for (const line of lines) {
      const section = /^\s*\[remote\s+"([^"]+)"\]\s*$/u.exec(line);
      if (section) {
        inOrigin = section[1] === "origin";
        continue;
      }
      if (!inOrigin) continue;
      const url = /^\s*url\s*=\s*(\S+)\s*$/u.exec(line);
      if (url) return url[1];
    }
  } catch {
    return undefined;
  }
  return undefined;
}

export async function writeInitialConfig(
  repoRoot: string,
  options: { login?: string },
): Promise<InitWriteResult> {
  const path = join(repoRoot, CONFIG_FILE_NAME);
  if (await fileExists(path)) return { status: "exists", path };

  const provider = inferHostProviderFromRemote(await originRemoteUrl(repoRoot));
  const config = buildInitialConfig({ provider, login: options.login });
  await writeFile(path, `${JSON.stringify(config, null, 2)}\n`, {
    flag: "wx",
  });
  return { status: "created", path, config };
}
