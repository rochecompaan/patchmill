import { copyFile, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import type { PhaseLaunch, PhaseRun } from "../kernel/launch.ts";
import { parseAgentResult } from "../kernel/result.ts";
import { SubagentsClient, SubagentsRpcError } from "./subagents-client.ts";
import { createUnprovenWorkers } from "./unproven-workers.ts";

export type WorkerLauncher = {
  run(launch: PhaseLaunch): Promise<PhaseRun>;
  resume(launch: PhaseLaunch, guidance: string): Promise<PhaseRun>;
  active(): { id: string; state: string } | undefined;
  stopActive(): Promise<void>;
};

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
    const cancellation = new AbortController();
    let deadline: ReturnType<typeof setTimeout> | undefined;
    let timedOut = false;
    let stopping: Promise<void> | undefined;
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
          timeoutMs: launch.timeoutMs,
          output: outputPath,
        });
      }
      previousId = id;
      active = { id, state: "running" };
      stop = () =>
        (stopping ??= unproven.proveExit(id).finally(() => {
          cancellation.abort();
          stopping = undefined;
        }));
      if (closing) {
        await stop();
        return aborted();
      }
      deadline = setTimeout(() => {
        timedOut = true;
        void stop?.().catch(() => {});
      }, launch.timeoutMs);
      onAbort = () => {
        if (active?.id === id) active.state = "stopping";
      };
      launch.signal?.addEventListener("abort", onAbort, { once: true });
      if (launch.signal?.aborted) onAbort();
      const completion = await client.waitForCompletion(
        id,
        launch.signal,
        cancellation.signal,
      );
      let text: string;
      try {
        text = await readFile(outputPath, "utf8");
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        text = completion.output ?? "";
      }
      await mkdir(dirname(launch.logPath), { recursive: true });
      await writeFile(launch.logPath, text);
      if (completion.sessionFile) {
        const destination = join(
          launch.sessionDir,
          basename(completion.sessionFile),
        );
        if (resolve(destination) !== resolve(completion.sessionFile))
          await copyFile(completion.sessionFile, destination);
      }
      return {
        result: parseAgentResult(text),
        session: {
          exitCode: completion.state === "complete" ? 0 : 1,
          timedOut: timedOut || completion.timedOut,
          aborted: !timedOut && completion.stopped,
        },
      };
    } catch (error) {
      if (!(error instanceof SubagentsRpcError)) throw error;
      if (closing) return aborted();
      if (timedOut)
        return {
          result: parseAgentResult(""),
          session: { exitCode: null, timedOut: true, aborted: false },
        };
      return {
        result: { ok: false, reason: `pi-subagents: ${error.message}` },
        session: { exitCode: null, timedOut: false, aborted: false },
      };
    } finally {
      clearTimeout(deadline);
      if (onAbort) launch.signal?.removeEventListener("abort", onAbort);
      // Completion can arrive before status proof. Settle that proof before
      // discarding execution-local state, retaining failed IDs for later retry.
      await stopping?.catch(() => {});
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
