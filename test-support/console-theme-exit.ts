import assert from "node:assert/strict";
import { join } from "node:path";
import {
  InteractiveMode,
  SessionManager,
  createAgentSessionRuntime,
  createAgentSessionServices,
  createAgentSessionFromServices,
} from "@earendil-works/pi-coding-agent";
import type { Terminal } from "@earendil-works/pi-tui";
import { main } from "../src/cli/commands/run-once/main.ts";
import { createConsoleSessionHost } from "../src/console/session-host.ts";
import { runConsoleRuntime } from "../src/console/start.ts";
import { resolvePiSubagentsPackageRoot } from "../src/pi/pi-subagents-package.ts";
import { recordingRunner } from "./recording-runner.ts";

// Real Pi run loop and theme watcher, with an inert terminal instead of a TTY.
const terminal: Terminal = {
  columns: 100,
  rows: 30,
  kittyProtocolActive: false,
  start() {},
  stop() {},
  async drainInput() {},
  write() {},
  moveBy() {},
  hideCursor() {},
  showCursor() {},
  clearLine() {},
  clearFromCursor() {},
  clearScreen() {},
  setTitle() {},
  setProgress() {},
  setProgramStatus() {},
};
const root = process.argv[2]!;
const code = await main(["--interactive", "--issue", "9"], {
  repoRoot: root,
  runner: recordingRunner([
    {
      match: /^gh issue view 9 /,
      result: {
        stdout: JSON.stringify({
          number: 9,
          title: "Fixture",
          body: "",
          state: "OPEN",
          labels: [],
          author: { login: "fixture" },
          url: "https://example.invalid/9",
          createdAt: "2026-01-01",
          comments: [],
        }),
      },
    },
    {
      match:
        /^gh api --paginate --slurp .*\/issues\/9\/dependencies\/blocked_by/,
      result: { stdout: "[[]]" },
    },
  ]),
  startConsole: async () => {
    const fatal = Promise.withResolvers<string>();
    const host = createConsoleSessionHost({
      repoRoot: root,
      runsDir: "runs",
      issue: 9,
      startRun: async () => ({ status: "no-work" }),
      switchSession: (path) =>
        runtime.switchSession(path, { cwdOverride: root }),
      onFatalSwitch: (issue, error) =>
        fatal.resolve(
          `${String(error)}\nRun \`patchmill run-once --interactive --issue ${issue}\` to continue.`,
        ),
    });
    let shutdowns = 0;
    const runtime = await createAgentSessionRuntime(
      async (target) => {
        if (target.sessionStartEvent)
          throw new Error("forced replacement failure");
        const services = await createAgentSessionServices({
          cwd: root,
          agentDir: join(root, "agent"),
          resourceLoaderOptions: {
            additionalExtensionPaths: [resolvePiSubagentsPackageRoot()],
            extensionFactories: [
              {
                name: "patchmill",
                factory: async (pi) => {
                  await host.factory(pi);
                  pi.on("session_shutdown", async () => {
                    shutdowns++;
                  });
                  pi.on("session_start", async (_event, ctx) => {
                    assert.equal(
                      ctx.ui.theme.name,
                      "custom",
                      "fixture must activate the custom theme",
                    );
                    // Let InteractiveMode finish binding and enter its pending input loop.
                    setTimeout(() => {
                      const runner = runtime.session.extensionRunner!;
                      void runner
                        .getCommand("patchmill-issue")!
                        .handler("10", runner.createCommandContext())
                        .catch((error: unknown) => {
                          fatal.resolve(String(error));
                        });
                    }, 100);
                  });
                },
              },
            ],
          },
        });
        assert.deepEqual(services.resourceLoader.getExtensions().errors, []);
        const created = await createAgentSessionFromServices({
          services,
          sessionManager: target.sessionManager,
        });
        return { ...created, services, diagnostics: [] };
      },
      {
        cwd: root,
        agentDir: join(root, "agent"),
        sessionManager: SessionManager.create(
          root,
          join(root, "runs/issue-9/console"),
        ),
      },
    );
    const mode = new InteractiveMode(runtime, {
      terminal,
      initialThemeSetting: "custom",
    });
    try {
      return await runConsoleRuntime(
        runtime,
        () => mode.run(),
        console.error,
        () => host.shutdown(),
        fatal.promise,
      );
    } finally {
      mode.stop();
      assert.equal(
        shutdowns,
        2,
        "replacement and final shutdown must finish before exit",
      );
      process.stdout.write("CLEANUP_COMPLETE\n");
      // Exercise pipe backpressure: a direct process.exit must not truncate this.
      process.stderr.write(
        `DRAIN_CHECK:${".".repeat(256 * 1024)}:DRAIN_COMPLETE\n`,
      );
    }
  },
});
// On the broken CLI this sets the status but leaves the real theme watcher alive.
process.exitCode = code;
