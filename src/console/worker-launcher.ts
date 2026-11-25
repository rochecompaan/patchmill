import { copyFile, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import type { PhaseLaunch, PhaseRun } from "../kernel/launch.ts";
import { assistantText, type RpcMessage } from "../kernel/pi-rpc-protocol.ts";
import {
  hasResultBlock,
  parseAgentResult,
  RESULT_REMINDER,
} from "../kernel/result.ts";
import {
  SubagentsClient,
  SubagentsRpcError,
  type WorkerCompletion,
} from "./subagents-client.ts";
import { createUnprovenWorkers } from "./unproven-workers.ts";

export type WorkerLauncher = {
  run(launch: PhaseLaunch): Promise<PhaseRun>;
  resume(launch: PhaseLaunch, guidance: string): Promise<PhaseRun>;
  active(): { id: string; state: string } | undefined;
  stopActive(): Promise<void>;
};

/** The text of the last assistant message in a worker session file. */
async function lastAssistantText(
  sessionFile: string | undefined,
): Promise<string | undefined> {
  if (!sessionFile) return undefined;
  let content: string;
  try {
    content = await readFile(sessionFile, "utf8");
  } catch {
    return undefined;
  }
  let last: string | undefined;
  for (const line of content.split("\n")) {
    let entry: { type?: unknown; message?: RpcMessage };
    try {
      entry = JSON.parse(line) as typeof entry;
    } catch {
      continue;
    }
    if (entry?.type === "message" && entry.message?.role === "assistant")
      last = assistantText(entry.message);
  }
  return last;
}

/**
 * The result text and the log text of a completion. The last assistant
 * message wins when it has a result block, because pi-subagents can ask the
 * worker for a separate prose report in `output.md`.
 */
async function resultText(
  completion: WorkerCompletion,
  outputPath: string,
): Promise<{ text: string; log: string }> {
  let output: string;
  try {
    output = await readFile(outputPath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    output = completion.output ?? "";
  }
  const last =
    completion.state === "complete"
      ? await lastAssistantText(completion.sessionFile)
      : undefined;
  const differs = last !== undefined && last.trim() !== output.trim();
  return {
    text: last !== undefined && hasResultBlock(last) ? last : output,
    log: differs && last.trim() ? `${output}\n\n${last}` : output,
  };
}

export function createWorkerLauncher(client: SubagentsClient): WorkerLauncher {
  let previousId: string | undefined;
  let active: { id: string; state: string } | undefined;
  let closing = false;
  const pending = new Set<Promise<PhaseRun>>();
  let stop: (() => Promise<void>) | undefined;
  const unproven = createUnprovenWorkers(client);
  const aborted = (): PhaseRun => ({
    result: { ok: false, reason: "Console shut down." },
    session: { exitCode: null, timedOut: false, aborted: true },
  });
  async function stopActive() {
    closing = true;
    // Retried proof uses retained IDs, independent of an execution's callback.
    await (stop ? stop() : unproven.retry()).catch(() => {});
    // A late launch records its cleanup failure while pending settles aborted.
    await Promise.all(pending);
    await unproven.verifyExit();
    if (active && !unproven.state(active.id)) active = undefined;
  }
  function launch(phase: PhaseLaunch, guidance?: string): Promise<PhaseRun> {
    if (closing) return Promise.resolve(aborted());
    const task = execute(phase, guidance);
    pending.add(task);
    void task.finally(() => pending.delete(task)).catch(() => {});
    return task;
  }
  async function execute(
    launch: PhaseLaunch,
    guidance?: string,
  ): Promise<PhaseRun> {
    const outputPath = join(launch.sessionDir, "output.md");
    let onAbort: (() => void) | undefined;
    let cancellation = new AbortController();
    let deadline: ReturnType<typeof setTimeout> | undefined;
    let timedOut = false;
    let currentId: string | undefined;
    const stopping = new Set<Promise<void>>();
    // Binds this execution to a worker id: shutdown and the deadline stop it.
    const bind = (id: string) => {
      previousId = id;
      currentId = id;
      active = { id, state: launch.signal?.aborted ? "stopping" : "running" };
      const cancel = new AbortController();
      cancellation = cancel;
      let own: Promise<void> | undefined;
      stop = () => {
        own ??= unproven.proveExit(id).finally(() => {
          cancel.abort();
          stopping.delete(proof);
          own = undefined;
        });
        const proof = own;
        stopping.add(proof);
        return proof;
      };
    };
    const interrupted = () => closing || timedOut;
    const timedOutRun = (): PhaseRun => ({
      result: parseAgentResult(""),
      session: { exitCode: null, timedOut: true, aborted: false },
    });
    const copySession = async (completion: WorkerCompletion) => {
      if (!completion.sessionFile) return;
      const destination = join(
        launch.sessionDir,
        basename(completion.sessionFile),
      );
      if (resolve(destination) !== resolve(completion.sessionFile))
        await copyFile(completion.sessionFile, destination);
    };
    const awaitWorker = async (id: string) => {
      const completion = await client.waitForCompletion(
        id,
        launch.signal,
        cancellation.signal,
      );
      return { completion, ...(await resultText(completion, outputPath)) };
    };
    const writeLog = async (text: string) => {
      await mkdir(dirname(launch.logPath), { recursive: true });
      await writeFile(launch.logPath, text);
    };
    const phaseRun = (
      completion: WorkerCompletion,
      text: string,
      reminded: boolean,
    ): PhaseRun => {
      return {
        result: parseAgentResult(text, { reminded }),
        session: {
          exitCode: completion.state === "complete" ? 0 : 1,
          timedOut: timedOut || completion.timedOut,
          aborted: !timedOut && completion.stopped,
        },
      };
    };
    try {
      // Retry proof before any new spawn/resume, never overlap an unproven worker.
      await unproven.retry();
      if (closing) return aborted();
      await mkdir(launch.sessionDir, { recursive: true });
      // Resume inherits a suffixed upstream output path. Never parse an old output.md.
      await rm(outputPath, { force: true });
      if (closing) return aborted();
      let id: string;
      if (guidance !== undefined) {
        if (!previousId)
          throw new SubagentsRpcError(
            "not_found",
            "No previous worker to resume",
          );
        id = await client.resume(previousId, guidance);
      } else {
        id = await client.spawnWorker({
          task: launch.envelope,
          cwd: launch.worktree,
          ...(launch.timeoutMs !== undefined
            ? { timeoutMs: launch.timeoutMs }
            : {}),
          output: outputPath,
        });
      }
      bind(id);
      if (closing) {
        await stop!();
        return aborted();
      }
      // Without a Session cap, only pi-subagents' largest deadline applies.
      if (launch.timeoutMs !== undefined)
        deadline = setTimeout(() => {
          timedOut = true;
          void stop?.().catch(() => {});
        }, launch.timeoutMs);
      onAbort = () => {
        if (currentId && active?.id === currentId) active.state = "stopping";
      };
      launch.signal?.addEventListener("abort", onAbort, { once: true });
      if (launch.signal?.aborted) onAbort();
      const first = await awaitWorker(id);
      await writeLog(first.log);
      await copySession(first.completion);
      const remind =
        first.completion.state === "complete" &&
        !first.completion.timedOut &&
        !first.completion.stopped &&
        !interrupted() &&
        !launch.signal?.aborted &&
        !hasResultBlock(first.text);
      if (!remind) return phaseRun(first.completion, first.text, false);

      // One Result reminder in the same conversation.
      await rm(outputPath, { force: true });
      let reminderId: string;
      try {
        reminderId = await client.resume(id, RESULT_REMINDER);
      } catch (error) {
        if (
          error instanceof SubagentsRpcError &&
          !interrupted() &&
          !launch.signal?.aborted
        )
          return phaseRun(first.completion, first.text, false);
        throw error;
      }
      bind(reminderId);
      if (interrupted()) {
        await stop!();
        return closing ? aborted() : timedOutRun();
      }
      const second = await awaitWorker(reminderId);
      await writeLog(`${first.log}\n\n${second.log}`);
      await copySession(second.completion);
      return phaseRun(second.completion, second.text, true);
    } catch (error) {
      if (!(error instanceof SubagentsRpcError)) throw error;
      if (closing) return aborted();
      if (timedOut) return timedOutRun();
      return {
        result: { ok: false, reason: `pi-subagents: ${error.message}` },
        session: { exitCode: null, timedOut: false, aborted: false },
      };
    } finally {
      clearTimeout(deadline);
      if (onAbort) launch.signal?.removeEventListener("abort", onAbort);
      // Completion can arrive before status proof. Settle that proof before
      // discarding execution-local state, retaining failed IDs for later retry.
      await Promise.all([...stopping].map((proof) => proof.catch(() => {})));
      if (active && !unproven.state(active.id)) active = undefined;
      stop = undefined;
    }
  }
  return {
    run: (phase) => launch(phase),
    resume: (phase, guidance) => launch(phase, guidance),
    active: () =>
      active
        ? { ...active, state: unproven.state(active.id) ?? active.state }
        : undefined,
    stopActive,
  };
}
