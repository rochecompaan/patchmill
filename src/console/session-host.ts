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
  switchSession: (path: string) => Promise<{ cancelled: boolean }>;
}) {
  let nextIssue: number | undefined = options.issue;
  let shutdown = async () => {};
  const factory: ExtensionFactory = (pi) => {
    const firstIssue = nextIssue;
    nextIssue = undefined;
    return createPatchmillExtension({
      ...(firstIssue !== undefined ? { firstIssue } : {}),
      startRun: options.startRun,
      registerShutdown: (handler) => {
        shutdown = handler;
      },
      switchIssue: async (issue) => {
        const session = await openIssueConsoleSession(
          options.repoRoot,
          options.runsDir,
          issue,
        );
        nextIssue = issue;
        try {
          await options.switchSession(session.getSessionFile()!);
        } finally {
          nextIssue = undefined;
        }
      },
    })(pi);
  };
  return { factory, shutdown: () => shutdown() };
}
