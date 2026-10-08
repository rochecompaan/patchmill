import { spawn } from "node:child_process";
import { readFile, readdir } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";
import type { CommandResult, CommandRunOptions } from "../command/types.ts";

/** Proves the owned group stopped, not arbitrary detached custom-hook processes. */
export async function ownedGitGroupStopped(group: number): Promise<boolean> {
  if (!Number.isSafeInteger(group) || group < 1 || process.platform === "win32")
    return false;
  try {
    process.kill(-group, 0);
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "ESRCH";
  }
  if (process.platform !== "linux") return false;
  for (const entry of await readdir("/proc")) {
    if (!/^\d+$/u.test(entry)) continue;
    let raw: string;
    try {
      raw = await readFile(`/proc/${entry}/stat`, "utf8");
    } catch (error) {
      if (
        (error as NodeJS.ErrnoException).code === "ENOENT" ||
        (error as NodeJS.ErrnoException).code === "ESRCH"
      )
        continue;
      return false;
    }
    const fields = raw.slice(raw.lastIndexOf(")") + 2).split(" ");
    if (Number(fields[2]) === group && fields[0] !== "Z" && fields[0] !== "X")
      return false;
  }
  return true;
}

function signalGroup(group: number, signal: NodeJS.Signals): void {
  try {
    process.kill(-group, signal);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
  }
}

async function waitStopped(
  group: number,
  milliseconds: number,
): Promise<boolean> {
  const deadline = Date.now() + milliseconds;
  do {
    if (await ownedGitGroupStopped(group)) return true;
    await delay(10);
  } while (Date.now() < deadline);
  return ownedGitGroupStopped(group);
}

/** Only this runner signals the group it just created. Recovery never signals a saved PID. */
export async function runOwnedGitCommand(
  args: string[],
  options: CommandRunOptions,
): Promise<CommandResult> {
  const lifecycle = options.ownedGit!;
  if (process.platform === "win32")
    throw new Error("Owned Git shutdown cannot be verified on Windows");
  if (options.signal?.aborted) {
    await lifecycle.onStopped(true);
    return { code: 1, stdout: "", stderr: "command aborted before spawn" };
  }
  const shutdownMs = lifecycle.shutdownMs ?? 1_000;
  if (!Number.isFinite(shutdownMs) || shutdownMs < 1)
    throw new RangeError("Invalid owned Git shutdown bound");
  const child = spawn("git", args, {
    cwd: options.cwd,
    env: options.env ? { ...process.env, ...options.env } : undefined,
    detached: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  const closed = new Promise<CommandResult>((resolve) => {
    child.on("error", (error) => {
      stderr += error.message;
    });
    child.on("close", (code, signal) =>
      resolve({
        code: code ?? 1,
        stdout,
        stderr: `${stderr}${signal ? `\n${signal}` : ""}`,
      }),
    );
  });
  child.stdout.on("data", (chunk) => {
    const text = String(chunk);
    stdout += text;
    options.onStdout?.(text);
  });
  child.stderr.on("data", (chunk) => {
    const text = String(chunk);
    stderr += text;
    options.onStderr?.(text);
  });
  const group = child.pid;
  let shutdown: Promise<boolean> | undefined;
  const stop = (): Promise<boolean> => {
    shutdown ??= (async () => {
      if (group === undefined || (await ownedGitGroupStopped(group)))
        return true;
      // A closed leader no longer supplies signaling authority. Keep evidence
      // fail-closed if its group remains; never signal a possibly reused PID.
      if (child.exitCode !== null || child.signalCode !== null) return false;
      signalGroup(group, "SIGTERM");
      if (await waitStopped(group, shutdownMs)) return true;
      signalGroup(group, "SIGKILL");
      return waitStopped(group, shutdownMs);
    })();
    return shutdown;
  };
  const verifyStopped = async (): Promise<boolean> => {
    if (!(await stop().catch(() => false))) return false;
    return new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => resolve(false), shutdownMs);
      void closed.then(() => {
        clearTimeout(timer);
        resolve(true);
      });
    });
  };
  let receipted = false;
  const abandon = () => {
    child.stdout.destroy();
    child.stderr.destroy();
    child.unref();
  };
  const abort = () => {
    void stop().catch(() => {});
  };
  options.signal?.addEventListener("abort", abort, { once: true });
  try {
    if (group !== undefined) await lifecycle.onSpawn(group);
    if (options.signal?.aborted) abort();
    const result = await Promise.race([
      closed,
      new Promise<CommandResult>((resolve) => {
        const interrupted = () => {
          void stop().then(
            () =>
              resolve({
                code: 1,
                stdout,
                stderr: `${stderr}\ncommand aborted`,
              }),
            () =>
              resolve({
                code: 1,
                stdout,
                stderr: `${stderr}\ncommand shutdown unverified`,
              }),
          );
        };
        if (options.signal?.aborted) interrupted();
        else
          options.signal?.addEventListener("abort", interrupted, {
            once: true,
          });
        void closed.then(() =>
          options.signal?.removeEventListener("abort", interrupted),
        );
      }),
    ]);
    const verified = await verifyStopped();
    receipted = true;
    await lifecycle.onStopped(verified);
    if (!verified) {
      abandon();
      throw new Error("Owned Git command shutdown is unverified");
    }
    return options.signal?.aborted ? { ...result, code: 1 } : result;
  } catch (error) {
    if (!receipted) {
      const verified = await verifyStopped();
      await lifecycle.onStopped(verified).catch(() => {});
      if (!verified) abandon();
    }
    throw error;
  } finally {
    options.signal?.removeEventListener("abort", abort);
  }
}
