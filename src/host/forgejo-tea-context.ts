import { existsSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

function insertBeforeSeparator(args: string[], extraArgs: string[]): string[] {
  const separator = args.indexOf("--");
  if (separator === -1) return [...args, ...extraArgs];
  return [...args.slice(0, separator), ...extraArgs, ...args.slice(separator)];
}

function commonGitConfigPath(gitDir: string): string {
  const commonDirPath = join(gitDir, "commondir");
  if (!existsSync(commonDirPath)) return join(gitDir, "config");
  const commonDir = readFileSync(commonDirPath, "utf8").trim();
  return join(resolve(gitDir, commonDir), "config");
}

function gitConfigPath(repoRoot: string): string | undefined {
  const gitPath = join(repoRoot, ".git");
  if (!existsSync(gitPath)) return undefined;
  if (statSync(gitPath).isDirectory()) return commonGitConfigPath(gitPath);
  const gitMetadata = readFileSync(gitPath, "utf8");
  if (/^gitdir:/u.test(gitMetadata)) {
    const gitDir = gitMetadata.replace(/^gitdir:\s*/u, "").trim();
    return commonGitConfigPath(resolve(repoRoot, gitDir));
  }
  return undefined;
}

function originRemoteUrl(config: string): string | undefined {
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
  return undefined;
}

function repoSlugFromRemoteUrl(url: string): string | undefined {
  const trimmed = url.replace(/\.git$/u, "");
  const sshUrl = /^ssh:\/\/[^@]+@[^/]+\/(.+)$/u.exec(trimmed);
  if (sshUrl) return sshUrl[1];
  const scpLikeUrl = /^[^@]+@[^:]+:(.+)$/u.exec(trimmed);
  if (scpLikeUrl) return scpLikeUrl[1];
  try {
    const parsed = new URL(trimmed);
    return parsed.pathname.replace(/^\/+/, "");
  } catch {
    return undefined;
  }
}

function teaRepo(repoRoot: string): string {
  try {
    const configPath = gitConfigPath(repoRoot);
    if (!configPath || !existsSync(configPath)) return repoRoot;
    const remoteUrl = originRemoteUrl(readFileSync(configPath, "utf8"));
    return remoteUrl
      ? (repoSlugFromRemoteUrl(remoteUrl) ?? repoRoot)
      : repoRoot;
  } catch {
    return repoRoot;
  }
}

export function withTeaContext(
  args: string[],
  repoRoot: string,
  teaLogin?: string,
): string[] {
  return withTeaRepositoryContext(args, teaRepo(repoRoot), teaLogin);
}

export function withTeaRepositoryContext(
  args: string[],
  repoSlug: string,
  teaLogin?: string,
): string[] {
  const repoArgs = insertBeforeSeparator(args, ["--repo", repoSlug]);
  if (!teaLogin) return repoArgs;
  return insertBeforeSeparator(repoArgs, ["--login", teaLogin]);
}
