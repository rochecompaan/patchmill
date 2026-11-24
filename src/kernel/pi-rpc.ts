import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import { resolve } from "node:path";
import { piCommandArgs } from "../cli/pi-cli.ts";
import {
  descendantGroups,
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
  /**
   * Stop the current turn with RPC `abort` and send `message` as a new prompt
   * in the same session. A settle in between does not finish the session.
   * "unresponsive" means Pi did not answer the abort within `graceMs`.
   */
  recover(
    message: string,
    graceMs: number,
  ): Promise<"continued" | "unresponsive">;
  /** End the session like an abort, without marking it aborted or timed out. */
  stop(): Promise<void>;
  done: Promise<PiSession>;
};
/**
 * `onOutput` is required: an RPC session writes only to its logs and this
 * callback, never to the terminal.
 */
export type PiRpcOptions = Omit<PiSessionOptions, "onOutput"> & {
  onOutput: (chunk: string) => void;
  reportWaitMs?: number;
  /**
   * Called at most once, when the session settles normally. A returned
   * message is sent as one more prompt in the same session.
   */
  remind?: (stdout: string) => string | undefined;
  /** Called with each parsed RPC record, before the session handles it. */
  onRecord?: (record: RpcRecord) => void;
  /** Continue this session file (`--session`). */
  sessionFile?: string;
  /** Append to `logPath` instead of replacing it, for a restart. */
  appendLogs?: boolean;
};

const REPORT_WAIT_MS = 15_000;
type Pending = {
  resolve: (record: RpcRecord) => void;
  reject: (e: Error) => void;
};

/** How Pi answered a `prompt` command. A failure carries Pi's error text. */
function promptOutcome(
  response: RpcRecord,
):
  | { kind: "failed"; error: string }
  | { kind: "handled" | "started" | "queued" } {
  if ("success" in response && !response.success)
    return { kind: "failed", error: String(response.error ?? "Prompt failed") };
  const disposition = (response as { data?: { disposition?: string } }).data
    ?.disposition;
  return {
    kind:
      disposition === "handled"
        ? "handled"
        : disposition === "queued"
          ? "queued"
          : "started",
  };
}

export function piRpcArgs(
  options: PiSessionOptions & { sessionFile?: string },
): string[] {
  return [
    "--mode",
    "rpc",
    "--session-dir",
    options.sessionDir,
    ...(options.sessionFile ? ["--session", options.sessionFile] : []),
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
  let reminderSettle: number | undefined;
  let interruption: Promise<void> | undefined;
  let escalation: Promise<void> | undefined;
  // "abort" until the recovery prompt is sent, then "prompt" until its turn starts.
  let recovering: "abort" | "prompt" | undefined;

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
      // Pi starts each command in its own group, and pi-subagents starts its
      // runners detached, so a kill of Pi's group alone can leave them.
      const groups = child?.pid ? await descendantGroups(child.pid) : [];
      const abort = send("abort").catch(() => undefined);
      await Promise.race([abort, waitForExit(graceMs)]);
      endInput();
      await waitForExit(graceMs);
      if (!closed) await escalate();
      // A kept group can hold Pi's output open, so do not wait for close.
      for (const group of groups) {
        try {
          if (signalGroup(group, 0)) signalGroup(group, "SIGKILL");
        } catch (error) {
          errors.push(error);
        }
      }
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
  // Sends the reminder and returns true, or returns false to finish now.
  const remind = () => {
    if (reminderSettle !== undefined || failedPrompt || interruption)
      return false;
    const current = printModeResult(lastMessage);
    if (current.failed) return false;
    const message = options.remind?.(current.stdout);
    if (message === undefined) return false;
    reminderSettle = settles;
    send("prompt", { message }).then(
      (response) => {
        const outcome = promptOutcome(response);
        if (outcome.kind === "failed") log(`${outcome.error}\n`);
        // The reminder never sets failedPrompt: finish with the first text.
        if (outcome.kind !== "started") finish();
      },
      () => finish(),
    );
    return true;
  };
  const evaluate = () => {
    if (finished || busy || recovering || settles === 0) return;
    if (reminderSettle !== undefined && settles <= reminderSettle) return;
    if (reports.get(settles) !== 0) return;
    if (!remind()) finish();
  };
  const onRecord = (record: RpcRecord) => {
    options.onRecord?.(record);
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
        if (recovering === "prompt") recovering = undefined;
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
      logs.push(await fs.open(options.logPath, options.appendLogs ? "a" : "w"));
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
          const outcome = promptOutcome(response);
          if (outcome.kind === "failed") {
            log(`${outcome.error}\n`);
            failedPrompt = true;
          }
          if (outcome.kind !== "started") finish();
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

  const recover = async (
    message: string,
    recoverGraceMs: number,
  ): Promise<"continued" | "unresponsive"> => {
    if (finished || interruption || closed || !child) return "continued";
    recovering = "abort";
    const answered = await Promise.race([
      send("abort").then(
        () => true,
        () => false,
      ),
      sleep(recoverGraceMs).then(() => false),
    ]);
    if (!answered) return "unresponsive";
    if (finished || interruption || closed) return "continued";
    recovering = "prompt";
    // A background run can start a turn first: the message then steers it.
    send("prompt", { message, streamingBehavior: "steer" }).then(
      (response) => {
        const outcome = promptOutcome(response);
        if (outcome.kind === "started") return;
        recovering = undefined;
        if (outcome.kind === "queued") return evaluate();
        if (outcome.kind === "failed") {
          log(`${outcome.error}\n`);
          failedPrompt = true;
        }
        finish();
      },
      () => {
        recovering = undefined;
        finish();
      },
    );
    return "continued";
  };

  const done = run();
  return {
    steer: (message) => command("steer", { message }),
    followUp: (message) => command("follow_up", { message }),
    abort: async () => {
      await interrupt("aborted");
    },
    recover,
    stop: () => interrupt(),
    done,
  };
}
