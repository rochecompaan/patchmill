import type { ExtensionFactory } from "@earendil-works/pi-coding-agent";
import { createPatchmillExtension } from "./extension.ts";
import { openIssueConsoleSession } from "./console-session.ts";
import type { StartRun } from "./controller.ts";

/** Carries the next issue across Pi's teardown/reload boundary. */
export function createConsoleSessionHost(options: {
  repoRoot: string;
  runsDir: string;
  issue: number;
  startRun: StartRun;
  onFatalSwitch?: (issue: number, error: unknown) => void;
  switchSession: (path: string) => Promise<{ cancelled: boolean }>;
}) {
  let nextIssue: number | undefined = options.issue;
  let shutdown = async () => {};
  const factory: ExtensionFactory = (pi) => {
    let closed = false;
    pi.on("session_shutdown", async () => {
      closed = true;
    });
    const notify = (content: string) =>
      pi.sendMessage(
        { customType: "patchmill", content, display: true },
        { triggerTurn: false },
      );
    const firstIssue = nextIssue;
    nextIssue = undefined;
    return createPatchmillExtension({
      ...(firstIssue !== undefined ? { firstIssue } : {}),
      startRun: options.startRun,
      registerShutdown: (handler) => {
        shutdown = async () => {
          closed = true;
          await handler();
        };
      },
      switchIssue: async (issue) => {
        try {
          const session = await openIssueConsoleSession(
            options.repoRoot,
            options.runsDir,
            issue,
          );
          nextIssue = issue;
          const result = await options.switchSession(session.getSessionFile()!);
          if (result.cancelled) notify(`Switch to issue #${issue} cancelled.`);
        } catch (error) {
          if (closed) {
            if (!options.onFatalSwitch) throw error;
            options.onFatalSwitch(issue, error);
          } else {
            notify(
              `Could not switch to issue #${issue}: ${error instanceof Error ? error.message : String(error)}`,
            );
          }
        } finally {
          nextIssue = undefined;
        }
      },
    })(pi);
  };
  return { factory, shutdown: () => shutdown() };
}
