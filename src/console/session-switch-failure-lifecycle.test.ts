import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  SessionManager,
  createAgentSessionRuntime,
  createAgentSessionServices,
  createAgentSessionFromServices,
} from "@earendil-works/pi-coding-agent";
import { resolvePiSubagentsPackageRoot } from "../pi/pi-subagents-package.ts";
import { createConsoleSessionHost } from "./session-host.ts";
import { runConsoleRuntime } from "./start.ts";

test(
  "real Pi replacement construction failure after shutdown exits without waiting for the console",
  { timeout: 15000 },
  async (t) => {
    if (!process.env.PATCHMILL_SWITCH_FAILURE_CHILD) {
      const env = { ...process.env, PATCHMILL_SWITCH_FAILURE_CHILD: "1" };
      delete env.NODE_TEST_CONTEXT;
      const child = spawnSync(
        process.execPath,
        ["--test", "--test-force-exit", import.meta.filename],
        { env, encoding: "utf8", timeout: 12000 },
      );
      assert.equal(child.status, 0, child.stdout + child.stderr);
      return;
    }
    const root = await mkdtemp(join(tmpdir(), "console-switch-fatal-"));
    t.after(() => rm(root, { recursive: true, force: true }));
    for (const name of [
      "PI_SUBAGENT_CHILD",
      "PI_SUBAGENT_PARENT_SESSION",
      "PI_SESSION_FILE",
      "PI_SESSION_ID",
    ])
      delete process.env[name];
    const fatal = Promise.withResolvers<string>();
    const events: string[] = [];
    const errors: string[] = [];
    const stderr: string[] = [];
    const host = createConsoleSessionHost({
      repoRoot: root,
      runsDir: "runs",
      issue: 9,
      startRun: async () => ({ status: "no-work" }),
      switchSession: (path) =>
        runtime.switchSession(path, { cwdOverride: root }),
      onFatalSwitch: (issue, error) => {
        assert.equal(issue, 10);
        assert.match(String(error), /construction failed/);
        fatal.resolve("construction failed");
      },
    });
    const runtime = await createAgentSessionRuntime(
      async (target) => {
        if (target.sessionStartEvent) {
          assert.deepEqual(events, ["shutdown"]);
          throw new Error("construction failed");
        }
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
                    events.push("shutdown");
                  });
                },
              },
            ],
          },
        });
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
    await runtime.session.bindExtensions({
      onError: (error) => errors.push(error.error),
    });
    const runner = runtime.session.extensionRunner!;
    const code = await runConsoleRuntime(
      runtime,
      async () => {
        await runner
          .getCommand("patchmill-issue")!
          .handler("10", runner.createCommandContext());
        return new Promise<void>(() => {});
      },
      (line) => stderr.push(line),
      () => host.shutdown(),
      fatal.promise,
    );
    assert.equal(code, 1);
    assert.deepEqual(stderr, ["construction failed"]);
    assert.deepEqual(errors, []);
    assert.ok(events.length >= 1);
  },
);
