import type { ExtensionFactory } from "@earendil-works/pi-coding-agent";
import { ConsoleController, type StartRun } from "./controller.ts";
import { SubagentsClient, type EventBus } from "./subagents-client.ts";
import { createWorkerLauncher } from "./worker-launcher.ts";
import { stopWorkers } from "./stray-workers.ts";
import { registerConsoleTools } from "./tools.ts";

export function createPatchmillExtension(options: {
  firstIssue?: number;
  startRun: StartRun;
  client?: (events: EventBus) => SubagentsClient;
  registerShutdown?: (shutdown: () => Promise<void>) => void;
}): ExtensionFactory {
  return (pi) => {
    let controller: ConsoleController | undefined;
    let client: SubagentsClient | undefined;
    let startBlocked: string | undefined =
      "Stray-worker cleanup is pending. Patchmill will not start the Issue run.";
    const getController = () => {
      if (!controller) throw new Error("Patchmill console has not started.");
      return controller;
    };
    const startIssueRun = async (issue?: number) =>
      startBlocked ?? getController().startIssueRun(issue);
    registerConsoleTools(pi, getController, startIssueRun);
    pi.on("session_start", async () => {
      if (controller) return;
      client = options.client?.(pi.events) ?? new SubagentsClient(pi.events);
      controller = new ConsoleController({
        pi,
        workers: createWorkerLauncher(client),
        startRun: options.startRun,
      });
      try {
        const stopped = await stopWorkers(client);
        startBlocked = stopped.ok
          ? undefined
          : `Worker ${stopped.stuck.join(", ")} did not stop. Patchmill will not start the Issue run.`;
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        startBlocked = `Stray-worker cleanup failed: ${reason}. Patchmill will not start the Issue run.`;
      }
      if (startBlocked) {
        controller.notify(startBlocked);
        return;
      }
      await startIssueRun(options.firstIssue);
    });
    let shutdownPromise: Promise<void> | undefined;
    const shutdown = () =>
      (shutdownPromise ??= (async () => {
        try {
          await controller?.shutdown();
        } finally {
          client?.dispose();
        }
      })());
    options.registerShutdown?.(shutdown);
    pi.on("session_shutdown", shutdown);
  };
}
