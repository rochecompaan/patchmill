import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import { piCommandArgs, type PiCommandSpec } from "../cli/pi-cli.ts";

export type PiSessionOptions = {
  command: PiCommandSpec;
  cwd: string;
  agentDir: string;
  sessionDir: string;
  skillPath?: string;
  promptPath: string;
  logPath: string;
  aggregateLogPath?: string;
  extensionPaths: string[];
  timeoutMs: number;
  graceMs?: number;
  signal?: AbortSignal;
  onOutput?: (chunk: string) => void;
  env?: Record<string, string | undefined>;
};
export type PiSession = {
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  timedOut: boolean;
  aborted: boolean;
  stdout: string;
  durationMs: number;
};

export function piArgs(options: PiSessionOptions): string[] {
  return [
    "-p",
    "--session-dir",
    options.sessionDir,
    ...(options.skillPath ? ["--skill", options.skillPath] : []),
    ...options.extensionPaths.flatMap((path) => ["-e", path]),
    "@" + options.promptPath,
  ];
}

function signalGroup(pid: number, signal: NodeJS.Signals | 0): boolean {
  try {
    process.kill(-pid, signal);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ESRCH") return false;
    throw error;
  }
}

export async function supervisePi(
  options: PiSessionOptions,
): Promise<PiSession> {
  const started = performance.now();
  const result: PiSession = {
    exitCode: null,
    signal: null,
    timedOut: false,
    aborted: options.signal?.aborted ?? false,
    stdout: "",
    durationMs: 0,
  };
  if (result.aborted) return result;
  const logs: Awaited<ReturnType<typeof fs.open>>[] = [];
  const errors: unknown[] = [];
  let timeout: ReturnType<typeof setTimeout> | undefined;
  let escalation: ReturnType<typeof setTimeout> | undefined;
  let shutdown: Promise<void> | undefined;
  let finishShutdown: (() => void) | undefined;
  let writes = Promise.resolve();
  let logFailed = false;
  let callbackFailed = false;
  let closed = false;
  let abort: (() => void) | undefined;
  try {
    logs.push(await fs.open(options.logPath, "w"));
    if (options.aggregateLogPath)
      logs.push(await fs.open(options.aggregateLogPath, "a"));
    const child = spawn(
      options.command.command,
      piCommandArgs(options.command, piArgs(options)),
      {
        cwd: options.cwd,
        detached: true,
        stdio: ["ignore", "pipe", "pipe"],
        env: {
          ...process.env,
          ...options.env,
          PI_CODING_AGENT_DIR: options.agentDir,
        },
      },
    );
    const stop = () => {
      if (shutdown) return;
      shutdown = new Promise<void>((resolve) => {
        finishShutdown = resolve;
      });
      try {
        if (!child.pid || !signalGroup(child.pid, "SIGTERM")) {
          finishShutdown!();
          return;
        }
      } catch (error) {
        errors.push(error);
      }
      escalation = setTimeout(() => {
        try {
          if (child.pid) signalGroup(child.pid, "SIGKILL");
        } catch (error) {
          errors.push(error);
        }
        finishShutdown!();
      }, options.graceMs ?? 5_000);
    };
    const fail = (error: unknown) => {
      errors.push(error);
      stop();
    };
    const output = (chunk: string, stdout: boolean) => {
      if (stdout) result.stdout += chunk;
      writes = writes.then(async () => {
        if (logFailed) return;
        try {
          for (const log of logs) await log.writeFile(chunk);
        } catch (error) {
          logFailed = true;
          fail(error);
        }
      });
      if (!callbackFailed) {
        try {
          if (options.onOutput) options.onOutput(chunk);
          else (stdout ? process.stdout : process.stderr).write(chunk);
        } catch (error) {
          callbackFailed = true;
          fail(error);
        }
      }
    };
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => output(chunk, true));
    child.stderr.on("data", (chunk: string) => output(chunk, false));
    child.stdout.on("error", fail);
    child.stderr.on("error", fail);
    child.on("error", fail);
    const completion = new Promise<void>((resolve) => {
      child.once("close", (code, signal) => {
        closed = true;
        result.exitCode = code;
        result.signal = signal;
        clearTimeout(timeout);
        // The leader can exit while descendants still require escalation.
        if (shutdown && child.pid) {
          try {
            if (!signalGroup(child.pid, 0)) {
              clearTimeout(escalation);
              finishShutdown!();
            }
          } catch (error) {
            errors.push(error);
          }
        }
        resolve();
      });
    });
    abort = () => {
      if (closed || shutdown) return;
      result.aborted = true;
      stop();
    };
    timeout = setTimeout(() => {
      if (closed || shutdown) return;
      result.timedOut = true;
      stop();
    }, options.timeoutMs);
    options.signal?.addEventListener("abort", abort, { once: true });
    if (options.signal?.aborted) abort();
    await completion;
    await writes;
    await shutdown;
  } catch (error) {
    errors.push(error);
  } finally {
    clearTimeout(timeout);
    clearTimeout(escalation);
    if (abort) options.signal?.removeEventListener("abort", abort);
    for (const log of logs) {
      try {
        await log.close();
      } catch (error) {
        errors.push(error);
      }
    }
  }
  if (errors.length === 1) throw errors[0];
  if (errors.length > 1) throw new AggregateError(errors, "Pi session failed");
  result.durationMs = performance.now() - started;
  return result;
}
