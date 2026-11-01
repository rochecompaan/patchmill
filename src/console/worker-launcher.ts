import { copyFile, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import type { PhaseLaunch, PhaseRun } from "../kernel/launch.ts";
import { parseAgentResult } from "../kernel/result.ts";
import { SubagentsClient, SubagentsRpcError } from "./subagents-client.ts";

export type WorkerLauncher = {
  run(launch: PhaseLaunch): Promise<PhaseRun>;
  resume(launch: PhaseLaunch, guidance: string): Promise<PhaseRun>;
  active(): { id: string; state: string } | undefined;
  stopActive(): Promise<void>;
};

export function createWorkerLauncher(client: SubagentsClient): WorkerLauncher {
  let previousId: string | undefined;
  let active: { id: string; state: string } | undefined;
  async function stopActive() {
    if (!active) return;
    active.state = "stopping";
    await client.stop(active.id);
  }
  async function execute(
    launch: PhaseLaunch,
    guidance?: string,
  ): Promise<PhaseRun> {
    const outputPath = join(launch.sessionDir, "output.md");
    let onAbort: (() => void) | undefined;
    try {
      await mkdir(launch.sessionDir, { recursive: true });
      // Resume inherits a suffixed upstream output path. Never parse an old output.md.
      await rm(outputPath, { force: true });
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
      onAbort = () => {
        if (active?.id === id) active.state = "stopping";
      };
      launch.signal?.addEventListener("abort", onAbort, { once: true });
      if (launch.signal?.aborted) onAbort();
      const completion = await client.waitForCompletion(id, launch.signal);
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
          timedOut: completion.timedOut,
          aborted: completion.stopped,
        },
      };
    } catch (error) {
      if (!(error instanceof SubagentsRpcError)) throw error;
      return {
        result: { ok: false, reason: `pi-subagents: ${error.message}` },
        session: { exitCode: null, timedOut: false, aborted: false },
      };
    } finally {
      if (onAbort) launch.signal?.removeEventListener("abort", onAbort);
      active = undefined;
    }
  }
  return {
    run: (launch) => execute(launch),
    resume: (launch, guidance) => execute(launch, guidance),
    active: () => (active ? { ...active } : undefined),
    stopActive,
  };
}
