import { CommandFailedError, type CommandRunner } from "../process/command.ts";

/** Reads origin's owner/repo, the repository issue branches are pushed to. */
export async function originRepository(
  runner: CommandRunner,
  repoRoot: string,
): Promise<string> {
  const args = ["remote", "get-url", "origin"];
  const result = await runner("git", args, { cwd: repoRoot });
  if (result.code !== 0) throw new CommandFailedError("git", args, result);
  const origin = result.stdout.trim();
  let path: string | undefined;
  if (/^(?:https?|ssh):\/\//u.test(origin)) {
    try {
      const url = new URL(origin);
      if (url.hostname && !url.search && !url.hash)
        path = url.pathname.slice(1);
    } catch {
      /* Report the same origin error for every unsupported URL. */
    }
  } else path = /^(?:[^@\s]+@)?[^:\s/]+:([^\s]+)$/u.exec(origin)?.[1];
  path = path?.replace(/\.git$/u, "");
  if (
    !path ||
    !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u.test(path) ||
    path.split("/").some((part) => part === "." || part === "..")
  )
    throw new Error(`Cannot parse origin as owner/repo: ${origin}`);
  return path;
}
