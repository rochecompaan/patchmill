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
import { createConsoleSessionHost } from "./session-host.ts";
import { runConsoleRuntime } from "./start.ts";

// Real SDK loader, bridge, startup and shutdown handlers; no provider turns.
test(
  "switching sessions reloads Patchmill and quitting settles the new run before bridge teardown",
  { timeout: 15000 },
  async (t) => {
    // Isolate upstream process-global timers and environment from the test runner.
    if (!process.env.PATCHMILL_SWITCH_CHILD) {
      const env = { ...process.env, PATCHMILL_SWITCH_CHILD: "1" };
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
    let client: SubagentsClient;
    let settled = false;
    let finish: () => void;
    const runFinished = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const errors: string[] = [];
    const started: number[] = [];
    const host = createConsoleSessionHost({
      repoRoot: root,
      runsDir: "runs",
      issue: 9,
      switchSession: (path) =>
        runtime.switchSession(path, { cwdOverride: root }),
      startRun: async (issue) => {
        started.push(issue!);
        if (issue === 10) {
          await runFinished;
          settled = true;
        }
        return { status: "no-work" };
      },
    });
    const factory = async (pi: Parameters<typeof host.factory>[0]) => {
      await host.factory(pi);
      client = new SubagentsClient(pi.events, { replyTimeoutMs: 100 });
      pi.on("session_shutdown", async () => {
        client.dispose();
      });
    };
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
          ...(target.sessionStartEvent
            ? { sessionStartEvent: target.sessionStartEvent }
            : {}),
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
    runtime.setRebindSession(async (session) => {
      await session.bindExtensions({
        onError: (error) => errors.push(error.error),
      });
    });
    const runner = runtime.session.extensionRunner!;
    await runner
      .getCommand("patchmill-issue")!
      .handler("10", runner.createCommandContext());
    assert.deepEqual(started, [9, 10]);
    assert.equal(
      runtime.session.sessionManager.getSessionDir(),
      join(root, "runs/issue-10/console"),
    );
    assert.equal(runtime.cwd, root);
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
        await host.shutdown();
      },
    );
    assert.deepEqual(errors, []);
  },
);
