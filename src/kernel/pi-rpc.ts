import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import { resolve } from "node:path";
import { piCommandArgs } from "../cli/pi-cli.ts";
import {
  signalGroup,
  type PiSession,
  type PiSessionOptions,
} from "./pi-supervisor.ts";
import {
  BACKGROUND_WORK_STATUS,
  DIALOG_METHODS,
  jsonlRecords,
  parseBackgroundReport,
  printModeResult,
  promptFileText,
  type RpcMessage,
  type RpcRecord,
} from "./pi-rpc-protocol.ts";

export type PiRpcSession = {
  steer(message: string): Promise<void>;
  followUp(message: string): Promise<void>;
  abort(): Promise<void>;
  done: Promise<PiSession>;
};
/**
 * `onOutput` is required: an RPC session writes only to its logs and this
 * callback, never to the terminal.
 */
export type PiRpcOptions = Omit<PiSessionOptions, "onOutput"> & {
  onOutput: (chunk: string) => void;
  reportWaitMs?: number;
};

const REPORT_WAIT_MS = 15_000;
type Pending = {
  resolve: (record: RpcRecord) => void;
  reject: (e: Error) => void;
};

export function piRpcArgs(options: PiSessionOptions): string[] {
  return [
    "--mode",
    "rpc",
    "--session-dir",
    options.sessionDir,
    ...(options.skillPath ? ["--skill", options.skillPath] : []),
    ...options.extensionPaths.flatMap((path) => ["-e", path]),
  ];
}

export function runPiRpc(options: PiRpcOptions): Promise<PiSession> {
  return startPiRpc(options).done;
}

/**
 * Run one phase session with `pi --mode rpc`. The result has the same shape
 * and print-mode semantics as `supervisePi`.
 */
export function startPiRpc(options: PiRpcOptions): PiRpcSession {
  const started = performance.now();
  const graceMs = options.graceMs ?? 5_000;
  const reportWaitMs = options.reportWaitMs ?? REPORT_WAIT_MS;
  const result: PiSession = {
    exitCode: null,
    signal: null,
    timedOut: false,
    aborted: options.signal?.aborted ?? false,
    stdout: "",
    durationMs: 0,
  };
  const errors: unknown[] = [];
  const pending = new Map<string, Pending>();
  const reports = new Map<number, number>();
  const timers = new Set<ReturnType<typeof setTimeout>>();
  const exited = Promise.withResolvers<void>();
  let logs: Awaited<ReturnType<typeof fs.open>>[] = [];
  let writes = Promise.resolve();
  let child: ReturnType<typeof spawn> | undefined;
  let closed = false;
  let finished = false;
  let busy = false;
  let settles = 0;
  let lastMessage: RpcMessage | undefined;
  let lastAssistant: RpcMessage | undefined;
  let logFailed = false;
  let failedPrompt = false;
  let interruption: Promise<void> | undefined;
  let escalation: Promise<void> | undefined;

  const later = (ms: number, run: () => void) => {
    const timer = setTimeout(() => {
      timers.delete(timer);
      run();
    }, ms);
    timers.add(timer);
    return timer;
  };
  const sleep = (ms: number) =>
    new Promise<void>((done) => later(ms, () => done()));
  const fail = (error: unknown) => {
    if (!errors.includes(error)) errors.push(error);
    void interrupt();
  };
  const log = (chunk: string) => {
    if (!chunk || logFailed) return;
    writes = writes.then(async () => {
      if (logFailed) return;
      try {
        for (const file of logs) await file.writeFile(chunk);
        options.onOutput(chunk);
      } catch (error) {
        logFailed = true;
        fail(error);
      }
    });
  };
  const write = (command: Record<string, unknown>) => {
    if (closed || !child?.stdin?.writable) return false;
    child.stdin.write(`${JSON.stringify(command)}\n`);
    return true;
  };
  const send = (type: string, fields: Record<string, unknown> = {}) => {
    const id = randomUUID();
    return new Promise<RpcRecord>((done, reject) => {
      pending.set(id, { resolve: done, reject });
      if (!write({ id, type, ...fields })) {
        pending.delete(id);
        reject(new Error(`Pi session is not running; ${type} not sent`));
      }
    });
  };
  const command = async (type: string, fields?: Record<string, unknown>) => {
    if (finished || interruption)
      throw new Error(`Pi session is done; ${type} not sent`);
    const response = await send(type, fields);
    if ("success" in response && !response.success)
      throw new Error(String(response.error ?? `${type} failed`));
  };
  const endInput = () => {
    if (child?.stdin && !child.stdin.writableEnded) child.stdin.end();
  };
  const escalate = () => {
    escalation ??= (async () => {
      const pid = child?.pid;
      if (!pid || !signalGroup(pid, "SIGTERM")) return;
      const deadline = Date.now() + graceMs;
      while (Date.now() < deadline && signalGroup(pid, 0)) await sleep(20);
      if (signalGroup(pid, 0)) signalGroup(pid, "SIGKILL");
    })().catch((error) => {
      errors.push(error);
    });
    return escalation;
  };
  const waitForExit = (ms: number) => Promise.race([exited.promise, sleep(ms)]);
  const interrupt = (kind?: "aborted" | "timedOut") => {
    if (closed) return Promise.resolve();
    if (kind) result[kind] = true;
    // Before the spawn, the flag is enough: run() checks it and starts nothing.
    if (!child) return Promise.resolve();
    interruption ??= (async () => {
      const abort = send("abort").catch(() => undefined);
      await Promise.race([abort, waitForExit(graceMs)]);
      endInput();
      await waitForExit(graceMs);
      if (!closed) await escalate();
    })();
    return interruption;
  };
  const finish = () => {
    if (finished || interruption) return;
    finished = true;
    const final = printModeResult(lastMessage);
    result.stdout = final.stdout;
    if (final.failed) failedPrompt = true;
    endInput();
  };
  const evaluate = () => {
    if (finished || busy || settles === 0) return;
    if (reports.get(settles) === 0) finish();
  };
  const onRecord = (record: RpcRecord) => {
    switch (record.type) {
      case "response": {
        const response = record as Extract<RpcRecord, { type: "response" }>;
        const waiter = response.id ? pending.get(response.id) : undefined;
        if (!waiter) return;
        pending.delete(response.id!);
        waiter.resolve(response);
        return;
      }
      case "extension_ui_request": {
        const request = record as Extract<
          RpcRecord,
          { type: "extension_ui_request" }
        >;
        if (DIALOG_METHODS.has(request.method))
          write({
            type: "extension_ui_response",
            id: request.id,
            cancelled: true,
          });
        else if (
          request.method === "setStatus" &&
          request.statusKey === BACKGROUND_WORK_STATUS
        ) {
          const report = parseBackgroundReport(request.statusText);
          if (report) reports.set(report.settle, report.count);
          evaluate();
        }
        return;
      }
      case "extension_error": {
        const error = record as Extract<RpcRecord, { type: "extension_error" }>;
        log(`Extension error (${error.extensionPath}): ${error.error}\n`);
        return;
      }
      case "message_end": {
        const { message } = record as Extract<
          RpcRecord,
          { type: "message_end" }
        >;
        lastMessage = message;
        if (message?.role !== "assistant") return;
        lastAssistant = message;
        const shown = printModeResult(message);
        log(shown.stdout);
        log(shown.stderr);
        return;
      }
      case "agent_start":
        busy = true;
        return;
      case "agent_settled": {
        busy = false;
        const settle = ++settles;
        if (!reports.has(settle))
          later(reportWaitMs, () => {
            if (reports.has(settle) || finished) return;
            log(
              `Warning: no background-work report for settle ${settle} after ${reportWaitMs}ms; finishing without it.\n`,
            );
            reports.set(settle, 0);
            evaluate();
          });
        evaluate();
        return;
      }
    }
  };

  const run = async (): Promise<PiSession> => {
    if (result.aborted) return result;
    const onAbort = () => void interrupt("aborted");
    options.signal?.addEventListener("abort", onAbort, { once: true });
    try {
      const promptPath = resolve(options.cwd, options.promptPath);
      const prompt = promptFileText(
        promptPath,
        await fs.readFile(promptPath, "utf8"),
      );
      logs.push(await fs.open(options.logPath, "w"));
      if (options.aggregateLogPath)
        logs.push(await fs.open(options.aggregateLogPath, "a"));
      if (result.aborted) return result;
      child = spawn(
        options.command.command,
        piCommandArgs(options.command, piRpcArgs(options)),
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
      // Pi can exit before it reads its input; a broken pipe is not an error.
      child.stdin!.on("error", () => {});
      child.stdout!.setEncoding("utf8");
      child.stderr!.setEncoding("utf8");
      child.stdout!.on(
        "data",
        jsonlRecords(onRecord, (line) => log(`${line}\n`)),
      );
      child.stderr!.on("data", (chunk: string) => log(chunk));
      child.stdout!.on("error", fail);
      child.stderr!.on("error", fail);
      child.on("error", fail);
      child.once("close", (code, signal) => {
        closed = true;
        result.exitCode = code;
        result.signal = signal;
        for (const waiter of pending.values())
          waiter.reject(new Error("Pi exited"));
        pending.clear();
        exited.resolve();
      });
      later(options.timeoutMs, () => void interrupt("timedOut"));
      void send("prompt", { message: prompt }).then(
        (response) => {
          if ("success" in response && !response.success) {
            log(`${String(response.error ?? "Prompt failed")}\n`);
            failedPrompt = true;
            finish();
          } else if (
            (response as { data?: { disposition?: string } }).data
              ?.disposition === "handled"
          )
            finish();
        },
        () => undefined,
      );
      await exited.promise;
      if (child.pid && signalGroup(child.pid, 0)) await escalate();
      if (interruption) await interruption;
      if (escalation) await escalation;
      if (!finished) result.stdout = printModeResult(lastAssistant).stdout;
      if (failedPrompt && result.exitCode === 0 && !result.signal)
        result.exitCode = 1;
      await writes;
    } catch (error) {
      errors.push(error);
    } finally {
      options.signal?.removeEventListener("abort", onAbort);
      for (const timer of timers) clearTimeout(timer);
      timers.clear();
      for (const file of logs) {
        try {
          await file.close();
        } catch (error) {
          errors.push(error);
        }
      }
      logs = [];
    }
    if (errors.length === 1) throw errors[0];
    if (errors.length > 1)
      throw new AggregateError(errors, "Pi session failed");
    result.durationMs = performance.now() - started;
    return result;
  };

  const done = run();
  return {
    steer: (message) => command("steer", { message }),
    followUp: (message) => command("follow_up", { message }),
    abort: async () => {
      await interrupt("aborted");
    },
    done,
  };
}
