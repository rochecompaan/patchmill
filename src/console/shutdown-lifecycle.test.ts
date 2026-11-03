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
import { SubagentsClient, SubagentsRpcError } from "./subagents-client.ts";
import { createPatchmillExtension } from "./extension.ts";
import { runConsoleRuntime } from "./start.ts";

// Real SDK loader, bridge, startup and shutdown handlers; no provider turns.
test(
  "console settles before the real pi-subagents bridge is torn down",
  { timeout: 15000 },
  async (t) => {
    // Isolate upstream process-global timers and environment from the test runner.
    if (!process.env.PATCHMILL_LIFECYCLE_CHILD) {
      const env = { ...process.env, PATCHMILL_LIFECYCLE_CHILD: "1" };
      delete env.NODE_TEST_CONTEXT;
      const child = spawnSync(
        process.execPath,
        ["--test", "--test-force-exit", import.meta.filename],
        {
          env,
          encoding: "utf8",
          timeout: 12000,
        },
      );
      assert.equal(child.status, 0, child.stdout + child.stderr);
      return;
    }
    const root = await mkdtemp(join(tmpdir(), "patchmill-lifecycle-"));
    t.after(() => rm(root, { recursive: true, force: true }));
    for (const name of [
      "PI_SUBAGENT_CHILD",
      "PI_SUBAGENT_PARENT_SESSION",
      "PI_SESSION_FILE",
      "PI_SESSION_ID",
    ]) {
      const previous = process.env[name];
      delete process.env[name];
      t.after(() => {
        if (previous !== undefined) process.env[name] = previous;
      });
    }
    const agentDir = join(root, "agent");
    let shutdown = async () => {};
    let client: SubagentsClient;
    let settled = false;
    let finish: () => void;
    const runFinished = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const errors: string[] = [];
    const factory = createPatchmillExtension({
      firstIssue: 9,
      registerShutdown: (handler) => {
        shutdown = handler;
      },
      client: (events) =>
        (client = new SubagentsClient(events, { replyTimeoutMs: 100 })),
      startRun: async () => {
        await runFinished;
        settled = true;
        return { status: "no-work" };
      },
    });
    const runtime = await createAgentSessionRuntime(
      async (target) => {
        const services = await createAgentSessionServices({
          cwd: root,
          agentDir,
          resourceLoaderOptions: {
            additionalExtensionPaths: [resolvePiSubagentsPackageRoot()],
            extensionFactories: [{ name: "patchmill", factory }],
          },
        });
        assert.deepEqual(services.resourceLoader.getExtensions().errors, []);
        const created = await createAgentSessionFromServices({
          services,
          sessionManager: target.sessionManager,
        });
        return { ...created, services, diagnostics: [] };
      },
      { cwd: root, agentDir, sessionManager: SessionManager.inMemory(root) },
    );
    await runtime.session.bindExtensions({
      onError: (error) => errors.push(error.error),
    });
    const loaded = runtime.services.resourceLoader.getExtensions().extensions;
    assert.ok(
      loaded.findIndex((e) => e.path.includes("pi-subagents")) <
        loaded.findIndex((e) => e.path === "<inline:patchmill>"),
    );
    await runConsoleRuntime(
      runtime,
      async () => {
        // InteractiveMode calls runtime.dispose() itself, not just after run returns.
        await runtime.dispose();
        assert.equal(settled, true);
      },
      () => {},
      async () => {
        // An unknown stop must receive an upstream error, not time out after teardown.
        await assert.rejects(
          client!.stop("patchmill-nonexistent"),
          (error) =>
            error instanceof SubagentsRpcError &&
            error.code !== "reply_timeout" &&
            error.code !== "disposed",
        );
        finish!();
        await shutdown();
      },
    );
    assert.deepEqual(errors, []);
  },
);
