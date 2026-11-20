import { extname } from "node:path";
import { fileURLToPath } from "node:url";
import type {
  ExtensionAPI,
  ExtensionFactory,
} from "@earendil-works/pi-coding-agent";
import { loadConfig } from "../config/config.ts";
import { runCommand } from "../process/command.ts";
import type { RunOnceOutcome } from "../kernel/run-once.ts";
import type { RunSnapshot } from "../kernel/run-snapshot.ts";
import type { IssueLock } from "../kernel/lock.ts";
import { createRunOnceDeps } from "../cli/commands/run-once/deps.ts";
import type { StartRun } from "./controller.ts";
import { createPatchmillExtension } from "./extension.ts";
import { createStartRun } from "./start.ts";
import type { EventBus, SubagentsClient } from "./subagents-client.ts";
import { acquireConsoleLock, CONSOLE_SESSION_BUSY } from "./console-lock.ts";

/** The Pi extension for Web session processes. It has the extension of this
 * module: `.ts` from source, `.js` from `dist`. */
export const WEB_SESSION_EXTENSION_PATH = fileURLToPath(
  new URL(
    `./web-session-extension${extname(fileURLToPath(import.meta.url))}`,
    import.meta.url,
  ),
);
/** Stops the worker and the Issue run while pi-subagents still works, then
 * exits Pi. In RPC mode `session_shutdown` comes too late for this. */
export const WEB_SESSION_STOP = "patchmill-web-session-stop";

/** Read the repository and the issue that the server chose. Browser input
 * never reaches these values. */
export function webSessionTarget(env: NodeJS.ProcessEnv): {
  repoRoot: string;
  issue: number;
} {
  const repoRoot = env.PATCHMILL_WEB_SESSION_REPO;
  const text = env.PATCHMILL_WEB_SESSION_ISSUE ?? "";
  const issue = Number(text);
  if (!repoRoot) throw new Error("PATCHMILL_WEB_SESSION_REPO is not set.");
  if (!/^[1-9]\d*$/.test(text) || !Number.isSafeInteger(issue))
    throw new Error("PATCHMILL_WEB_SESSION_ISSUE is not a positive integer.");
  return { repoRoot, issue };
}

function closingLine(outcome: RunOnceOutcome, snapshot?: RunSnapshot) {
  if (outcome.status === "refused") return outcome.reason;
  if (outcome.status === "claimed-elsewhere")
    return `Issue #${outcome.issue} was claimed elsewhere.`;
  return (
    snapshot?.summary ??
    ("summary" in outcome ? outcome.summary : `Issue run ${outcome.status}.`)
  );
}

export function createWebSessionExtension(options: {
  issue: number;
  startRun: StartRun;
  client?: (events: EventBus) => SubagentsClient;
  refusal?: string;
}): ExtensionFactory {
  return (pi) => {
    let shutdownPi: (() => void) | undefined;
    const say = (text: string) =>
      pi.sendMessage(
        { customType: "patchmill", content: text, display: true },
        { triggerTurn: false },
      );
    // Registered first, so this handler gets the context before the run starts.
    pi.on("session_start", async (_event, ctx) => {
      shutdownPi = () => ctx.shutdown();
    });
    if (options.refusal) {
      const refusal = options.refusal;
      pi.on("session_start", async () => {
        say(refusal);
        shutdownPi?.();
      });
      return;
    }
    let started = false;
    let stopRun: (() => Promise<void>) | undefined;
    const startRun: StartRun = (issue, human, observe) => {
      started = true;
      let snapshot: RunSnapshot | undefined;
      const run = options.startRun(issue, human, (next) => {
        snapshot = next;
        observe(next);
      });
      void run
        .then(
          (outcome) => say(closingLine(outcome, snapshot)),
          // The console controller already shows the error.
          () => undefined,
        )
        .finally(() => shutdownPi?.());
      return run;
    };
    createPatchmillExtension({
      firstIssue: options.issue,
      startRun,
      ...(options.client ? { client: options.client } : {}),
      registerShutdown: (shutdown) => {
        stopRun = shutdown;
      },
    })(pi);
    // After Patchmill's handler: a blocked start never calls startRun.
    pi.on("session_start", async () => {
      if (!started) shutdownPi?.();
    });
    pi.registerCommand(WEB_SESSION_STOP, {
      description: "Stop the Issue run and its worker, then end the session.",
      async handler(_args, ctx) {
        say("Stopping the Web session.");
        try {
          await stopRun?.();
        } finally {
          ctx.shutdown();
        }
      },
    });
  };
}

// The file handle holds the flock; a dropped handle is closed on garbage
// collection, so keep it for the life of the process. It drops on exit.
let consoleLock: IssueLock | undefined;

export default async function webSessionExtension(
  pi: ExtensionAPI,
): Promise<void> {
  const { repoRoot, issue } = webSessionTarget(process.env);
  const config = await loadConfig(repoRoot);
  // RPC stdout carries protocol records; diagnostics go to stderr only.
  const output = {
    stdout: (line: string) => process.stderr.write(`${line}\n`),
    stderr: (line: string) => process.stderr.write(`${line}\n`),
  };
  const deps = createRunOnceDeps({
    config,
    repoRoot,
    runner: runCommand,
    output,
  });
  consoleLock = await acquireConsoleLock(repoRoot, config.paths.runsDir, issue);
  createWebSessionExtension({
    issue,
    startRun: createStartRun(config, deps),
    ...(consoleLock ? {} : { refusal: CONSOLE_SESSION_BUSY(issue) }),
  })(pi);
}
