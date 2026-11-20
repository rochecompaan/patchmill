import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import { piCommandArgs, type PiCommandSpec } from "../cli/pi-cli.ts";
import { signalGroup } from "./pi-supervisor.ts";
import { jsonlRecords, type RpcRecord } from "./pi-rpc-protocol.ts";

export const WEB_SESSION_STOP_COMMAND = "/patchmill-web-session-stop";

export type DialogRequest = {
  id: string;
  method: "select" | "confirm" | "input" | "editor";
  title: string;
  message?: string;
  options?: string[];
};
export type DialogAnswer =
  | { value: string }
  | { confirmed: boolean }
  | { cancelled: true };
export type InteractivePiOptions = {
  command: PiCommandSpec;
  cwd: string;
  agentDir: string;
  sessionFile: string;
  sessionDir: string;
  skillPaths: string[];
  extensionPaths: string[];
  env?: Record<string, string | undefined>;
  /** Receives stderr and stdout lines that are not JSON records. */
  logPath: string;
  /** Wait for each signal step. Default 5 s. */
  graceMs?: number;
  /** Default {@link WEB_SESSION_STOP_COMMAND}. */
  stopCommand?: string;
  /** Wait for Pi to exit after the stop command. Default 90 s, because
   * stopping workers can take up to 60 s. */
  shutdownMs?: number;
  /** Every record except command responses and dialogs. */
  onEvent(record: RpcRecord): void;
  onDialog(request: DialogRequest): void;
};
export type InteractivePiExit = {
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  /** True when `end()` started the shutdown. */
  requested: boolean;
};
export type InteractivePi = {
  /** The first `get_state` response. Rejects if Pi exits first. */
  ready: Promise<void>;
  /** Sends chat. Always with `streamingBehavior: "steer"`, which Pi reads
   * only while the agent streams. */
  prompt(text: string): Promise<void>;
  abort(): Promise<void>;
  answer(id: string, answer: DialogAnswer): void;
  /** Idempotent. */
  end(): Promise<InteractivePiExit>;
  exited: Promise<InteractivePiExit>;
};

const DIALOGS = new Set(["select", "confirm", "input", "editor"]);

export function interactivePiArgs(options: InteractivePiOptions): string[] {
  return [
    "--mode",
    "rpc",
    "--session",
    options.sessionFile,
    "--session-dir",
    options.sessionDir,
    ...options.skillPaths.flatMap((path) => ["--skill", path]),
    ...options.extensionPaths.flatMap((path) => ["-e", path]),
  ];
}

function dialogRequest(record: Record<string, unknown>): DialogRequest {
  return {
    id: String(record.id),
    method: record.method as DialogRequest["method"],
    title: typeof record.title === "string" ? record.title : "",
    ...(typeof record.message === "string" ? { message: record.message } : {}),
    ...(Array.isArray(record.options)
      ? { options: record.options.map(String) }
      : {}),
  };
}

/** Start one long-lived `pi --mode rpc` process for a Web session. */
export function startInteractivePi(
  options: InteractivePiOptions,
): InteractivePi {
  const graceMs = options.graceMs ?? 5_000;
  const shutdownMs = options.shutdownMs ?? 90_000;
  const stopCommand = options.stopCommand ?? WEB_SESSION_STOP_COMMAND;
  const pending = new Map<
    string,
    { resolve: (record: RpcRecord) => void; reject: (e: Error) => void }
  >();
  const closed = Promise.withResolvers<{
    code: number | null;
    signal: NodeJS.Signals | null;
  }>();
  const exited = Promise.withResolvers<InteractivePiExit>();
  const ready = Promise.withResolvers<void>();
  ready.promise.catch(() => undefined);
  let isClosed = false;
  let requested = false;
  let ending: Promise<InteractivePiExit> | undefined;
  let writes = Promise.resolve();
  const logFile = fs.open(options.logPath, "a").catch(() => undefined);
  const log = (text: string) => {
    if (!text) return;
    writes = writes.then(async () => {
      try {
        await (await logFile)?.appendFile(text);
      } catch {
        // A log write failure never stops the session.
      }
    });
  };

  const child = spawn(
    options.command.command,
    piCommandArgs(options.command, interactivePiArgs(options)),
    {
      cwd: options.cwd,
      detached: true,
      stdio: ["pipe", "pipe", "pipe"],
      env: {
        ...process.env,
        ...options.env,
        PI_CODING_AGENT_DIR: options.agentDir,
      },
    },
  );
  const pid = child.pid;
  const sleep = (ms: number) =>
    new Promise<void>((done) => setTimeout(done, ms).unref());
  const waitClosed = (ms: number) =>
    Promise.race([
      closed.promise.then(() => true),
      sleep(ms).then(() => false),
    ]);
  const write = (command: Record<string, unknown>) => {
    if (isClosed || !child.stdin?.writable) return false;
    child.stdin.write(`${JSON.stringify(command)}\n`);
    return true;
  };
  const send = (type: string, fields: Record<string, unknown> = {}) => {
    const id = randomUUID();
    return new Promise<RpcRecord>((resolve, reject) => {
      pending.set(id, { resolve, reject });
      if (!write({ id, type, ...fields })) {
        pending.delete(id);
        reject(new Error(`Pi is not running; ${type} not sent`));
      }
    });
  };
  const command = async (type: string, fields?: Record<string, unknown>) => {
    await ready.promise;
    const response = await send(type, fields);
    if ("success" in response && !response.success)
      throw new Error(
        String((response as { error?: unknown }).error ?? `${type} failed`),
      );
  };
  const killGroup = async () => {
    if (!pid || !signalGroup(pid, "SIGTERM")) return;
    const deadline = Date.now() + graceMs;
    while (Date.now() < deadline && signalGroup(pid, 0)) await sleep(20);
    if (signalGroup(pid, 0)) signalGroup(pid, "SIGKILL");
  };

  const onRecord = (record: RpcRecord) => {
    if (record.type === "response") {
      const id = (record as { id?: string }).id;
      const waiter = id ? pending.get(id) : undefined;
      if (!waiter) return;
      pending.delete(id!);
      waiter.resolve(record);
      return;
    }
    if (
      record.type === "extension_ui_request" &&
      DIALOGS.has(String((record as { method?: unknown }).method))
    ) {
      options.onDialog(dialogRequest(record as Record<string, unknown>));
      return;
    }
    options.onEvent(record);
  };

  child.stdin?.on("error", () => {});
  child.stdout?.setEncoding("utf8");
  child.stderr?.setEncoding("utf8");
  child.stdout?.on(
    "data",
    jsonlRecords(onRecord, (line) => log(`${line}\n`)),
  );
  child.stderr?.on("data", (chunk: string) => log(chunk));
  child.on("error", (error) => log(`Pi failed to start: ${error.message}\n`));
  child.once("close", (code, signal) => {
    isClosed = true;
    for (const waiter of pending.values())
      waiter.reject(new Error("Pi exited"));
    pending.clear();
    ready.reject(new Error("Pi exited before it was ready"));
    closed.resolve({ code, signal });
  });
  void closed.promise.then(async ({ code, signal }) => {
    // Pi's own children can outlive it; never leave them behind.
    if (pid && signalGroup(pid, 0)) await killGroup().catch(() => undefined);
    await writes;
    await (await logFile)?.close().catch(() => undefined);
    exited.resolve({ exitCode: code, signal, requested });
  });
  void send("get_state").then(
    () => ready.resolve(),
    (error: Error) => ready.reject(error),
  );

  const end = () =>
    (ending ??= (async () => {
      requested = true;
      if (!isClosed) {
        await Promise.race([
          send("abort").catch(() => undefined),
          waitClosed(graceMs),
        ]);
        if (!isClosed) {
          void send("prompt", { message: stopCommand }).catch(() => undefined);
          if (!(await waitClosed(shutdownMs))) {
            if (child.stdin && !child.stdin.writableEnded) child.stdin.end();
            if (!(await waitClosed(graceMs))) await killGroup();
          }
        }
      }
      return exited.promise;
    })());

  return {
    ready: ready.promise,
    prompt: (text) =>
      command("prompt", { message: text, streamingBehavior: "steer" }),
    abort: () => command("abort"),
    answer: (id, answer) => {
      write({ type: "extension_ui_response", id, ...answer });
    },
    end,
    exited: exited.promise,
  };
}
