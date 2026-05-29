import { constants } from "node:fs";
import { access, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { DEFAULT_PATCHMILL_CONFIG } from "../../../config/defaults.ts";
import type { PatchmillConfig } from "../../../config/types.ts";

export const CONFIG_FILE_NAME = "patchmill.config.json";

export type InitialConfigSkills = Pick<
  PatchmillConfig["skills"],
  "triage" | "planning" | "implementation"
>;

type InitialConfig = {
  host: Pick<PatchmillConfig["host"], "provider" | "login">;
  skills?: InitialConfigSkills;
};

export type InitWriteResult =
  | { status: "created"; path: string; config: InitialConfig }
  | { status: "exists"; path: string };

function remoteHost(remoteUrl: string | undefined): string | undefined {
  if (!remoteUrl) return undefined;
  const trimmed = remoteUrl.trim();
  const scpLike = /^[^@]+@([^:]+):/u.exec(trimmed);
  if (scpLike) return scpLike[1]?.toLowerCase();
  try {
    return new URL(trimmed.replace(/^git\+/, "")).hostname.toLowerCase();
  } catch {
    return undefined;
  }
}

export function inferHostProviderFromRemote(
  remoteUrl: string | undefined,
): PatchmillConfig["host"]["provider"] {
  return remoteHost(remoteUrl) === "github.com" ? "github-gh" : "forgejo-tea";
}

export function buildInitialConfig(
  options: {
    provider?: PatchmillConfig["host"]["provider"];
    login?: string;
    skills?: InitialConfigSkills;
  } = {},
): InitialConfig {
  const provider = options.provider ?? DEFAULT_PATCHMILL_CONFIG.host.provider;
  const config: InitialConfig = {
    host: {
      provider,
      login:
        options.login ??
        (provider === "github-gh" ? "" : DEFAULT_PATCHMILL_CONFIG.host.login),
    },
  };

  if (options.skills) {
    config.skills = options.skills;
  }

  return config;
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

export async function configFileExists(repoRoot: string): Promise<boolean> {
  return fileExists(join(repoRoot, CONFIG_FILE_NAME));
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
  options: {
    login?: string;
    skills?: InitialConfigSkills;
  },
): Promise<InitWriteResult> {
  const path = join(repoRoot, CONFIG_FILE_NAME);
  if (await configFileExists(repoRoot)) return { status: "exists", path };

  const provider = inferHostProviderFromRemote(await originRemoteUrl(repoRoot));
  const config = buildInitialConfig({
    provider,
    login: options.login,
    skills: options.skills,
  });
  await writeFile(path, `${JSON.stringify(config, null, 2)}\n`, {
    flag: "wx",
  });
  return { status: "created", path, config };
}
