import type { ExtensionFactory } from "@earendil-works/pi-coding-agent";
import { ConsoleController, type StartRun } from "./controller.ts";
import { SubagentsClient, type EventBus } from "./subagents-client.ts";
import { createWorkerLauncher } from "./worker-launcher.ts";
import { stopWorkers } from "./stray-workers.ts";
import { registerConsoleTools } from "./tools.ts";

export function createPatchmillExtension(options: {
  firstIssue: number;
  startRun: StartRun;
  client?: (events: EventBus) => SubagentsClient;
}): ExtensionFactory {
  return (pi) => {
    let controller: ConsoleController | undefined;
    let client: SubagentsClient | undefined;
    registerConsoleTools(pi, () => {
      if (!controller) throw new Error("Patchmill console has not started.");
      return controller;
    });
    pi.on("session_start", async () => {
      if (controller) return;
      client = options.client?.(pi.events) ?? new SubagentsClient(pi.events);
      controller = new ConsoleController({
        pi,
        workers: createWorkerLauncher(client),
        startRun: options.startRun,
      });
      const stopped = await stopWorkers(client);
      if (!stopped.ok) {
        controller.notify(
          `Worker ${stopped.stuck.join(", ")} did not stop. Patchmill will not start the Issue run.`,
        );
        return;
      }
      await controller.startIssueRun(options.firstIssue);
    });
    pi.on("session_shutdown", async () => {
      try {
        await controller?.shutdown();
      } finally {
        client?.dispose();
      }
    });
  };
}
