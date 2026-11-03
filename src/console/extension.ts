import type {
  ExtensionFactory,
  ExtensionCommandContext,
} from "@earendil-works/pi-coding-agent";
import { ConsoleController, type StartRun } from "./controller.ts";
import { SubagentsClient, type EventBus } from "./subagents-client.ts";
import { createWorkerLauncher } from "./worker-launcher.ts";
import { stopWorkers } from "./stray-workers.ts";
import { registerConsoleTools } from "./tools.ts";

export function createPatchmillExtension(options: {
  firstIssue?: number;
  switchIssue?: (issue: number, ctx: ExtensionCommandContext) => Promise<void>;
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
    registerConsoleTools(pi, getController);
    pi.registerCommand("patchmill-issue", {
      description: "Switch to an issue's console session and start its run.",
      async handler(args, ctx) {
        const issue = Number(args.trim());
        if (!/^[1-9]\d*$/.test(args.trim()) || !Number.isSafeInteger(issue)) {
          pi.sendMessage({
            customType: "patchmill",
            content:
              "Use /patchmill-issue N with a positive integer issue number.",
            display: true,
          });
          return;
        }
        const refusal = getController().startRefusal() ?? startBlocked;
        if (refusal) {
          getController().notify(refusal);
          return;
        }
        await options.switchIssue?.(issue, ctx);
      },
    });
    pi.on("session_start", async (_event, ctx) => {
      if (controller) return;
      client = options.client?.(pi.events) ?? new SubagentsClient(pi.events);
      controller = new ConsoleController({
        pi,
        session: ctx.sessionManager,
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
      if (options.firstIssue !== undefined)
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
