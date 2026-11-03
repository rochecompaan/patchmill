import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { ConsoleController } from "./controller.ts";
import { fakeExtensionApi } from "../../test-support/fake-extension-api.ts";
import { readSessionUsage, sumSessionUsage } from "../kernel/pi-cost.ts";
import { readIssueCostReport } from "../kernel/issue-cost.ts";
import type { PhaseLaunch } from "../kernel/launch.ts";

for (const ending of ["submit", "shutdown"] as const) {
  test(`console planning usage excludes earlier chat and survives ${ending} and feedback`, async (t) => {
    const root = await fs.mkdtemp(join(tmpdir(), "planning-usage-"));
    t.after(() => fs.rm(root, { recursive: true, force: true }));
    const session = SessionManager.inMemory();
    const assistant = (input: number, output: number) =>
      session.appendMessage({
        role: "assistant",
        content: [],
        api: "anthropic-messages",
        provider: "anthropic",
        model: "console-model",
        usage: {
          input,
          output,
          cacheRead: 2,
          cacheWrite: 3,
          totalTokens: input + output + 5,
          cost: {
            input: 0,
            output: 0,
            cacheRead: 0,
            cacheWrite: 0,
            total: 0.25,
          },
        },
        stopReason: "toolUse",
        timestamp: Date.now(),
      });
    assistant(999, 999);
    const pi = fakeExtensionApi();
    const controller = new ConsoleController({
      pi,
      session,
      startRun: async () => ({ status: "no-work" }),
      workers: {
        run: async () => {
          throw new Error("unused");
        },
        resume: async () => {
          throw new Error("unused");
        },
        active: () => undefined,
        stopActive: async () => {},
      },
    });
    const launch: PhaseLaunch = {
      phase: "planning",
      envelope: "plan",
      promptPath: "p",
      worktree: root,
      skillPath: "s",
      sessionDir: join(root, "run/sessions/1"),
      logPath: "l",
      aggregateLogPath: "a",
      timeoutMs: 1000,
    };
    const pending = controller.runPlanning(launch);
    assistant(10, 4);
    assistant(20, 6);
    await controller.submitPlanning({ status: "done", summary: "plan" });
    await pending;
    assert.equal((await readSessionUsage(launch.sessionDir))?.length, 2);
    assert.deepEqual(await sumSessionUsage(launch.sessionDir), {
      inputTokens: 40,
      outputTokens: 10,
      costUsd: 0.5,
    });
    const retryDir = join(root, "run/sessions/2");
    const retry = controller.runPlanning(
      { ...launch, sessionDir: retryDir },
      "fix plan",
    );
    assistant(5, 2);
    if (ending === "shutdown") await controller.shutdown();
    else await controller.submitPlanning({ status: "done", summary: "fixed" });
    assert.equal((await retry).session.aborted, ending === "shutdown");
    assert.deepEqual(await sumSessionUsage(retryDir), {
      inputTokens: 10,
      outputTokens: 2,
      costUsd: 0.25,
    });
    const worker = join(root, "run/sessions/3");
    await fs.mkdir(worker);
    await fs.writeFile(
      join(worker, "worker.jsonl"),
      JSON.stringify({
        id: "worker",
        message: {
          model: "worker-model",
          usage: { input: 100, output: 10, cost: { total: 1 } },
        },
      }),
    );
    const report = await readIssueCostReport(root, {
      runId: "run",
      sessions: [
        { phase: "planning" },
        { phase: "planning" },
        { phase: "implementation" },
      ],
    });
    assert.deepEqual(report?.total, {
      inputTokens: 150,
      outputTokens: 22,
      costUsd: 1.75,
    });
    assert.deepEqual(
      report?.rows.map((r) => r.phase),
      ["planning", "implementation"],
    );
    await controller.shutdown();
  });
}

for (const closing of [false, true]) {
  test(`empty aborted earlier planning does not block later usage (already closing=${closing})`, async (t) => {
    const root = await fs.mkdtemp(join(tmpdir(), "planning-empty-"));
    t.after(() => fs.rm(root, { recursive: true, force: true }));
    const session = SessionManager.inMemory();
    const createController = () =>
      new ConsoleController({
        pi: fakeExtensionApi(),
        session,
        startRun: async () => ({ status: "no-work" }),
        workers: {
          run: async () => {
            throw new Error("unused");
          },
          resume: async () => {
            throw new Error("unused");
          },
          active: () => undefined,
          stopActive: async () => {},
        },
      });
    const controller = createController();
    const launch: PhaseLaunch = {
      phase: "planning",
      envelope: "plan",
      promptPath: "p",
      worktree: root,
      skillPath: "s",
      sessionDir: join(root, "earlier/sessions/1"),
      logPath: "l",
      aggregateLogPath: "a",
      timeoutMs: 1000,
    };
    await fs.mkdir(join(root, "earlier/sessions"), { recursive: true });
    if (closing) await controller.shutdown();
    const pending = controller.runPlanning(launch);
    await controller.shutdown();
    assert.equal((await pending).session.aborted, true);
    await fs.writeFile(
      join(root, "earlier/result.json"),
      JSON.stringify({ sessions: [{ phase: "planning" }] }),
    );

    const later = createController();
    const successful = later.runPlanning({
      ...launch,
      sessionDir: join(root, "later/sessions/1"),
    });
    session.appendMessage({
      role: "assistant",
      content: [],
      api: "anthropic-messages",
      provider: "anthropic",
      model: "console-model",
      usage: {
        input: 10,
        output: 4,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 14,
        cost: {
          input: 0.2,
          output: 0.3,
          cacheRead: 0,
          cacheWrite: 0,
          total: 0.5,
        },
      },
      stopReason: "toolUse",
      timestamp: Date.now(),
    });
    await later.submitPlanning({ status: "done", summary: "plan" });
    await successful;
    await later.shutdown();
    const report = await readIssueCostReport(root, {
      runId: "later",
      sessions: [{ phase: "planning" }],
    });
    assert.deepEqual(report?.total, {
      inputTokens: 10,
      outputTokens: 4,
      costUsd: 0.5,
    });
    assert.deepEqual(
      report?.rows.map(({ phase, model }) => [phase, model]),
      [
        ["planning", "console-model"],
        ["planning", "No reply"],
      ],
    );
    assert.deepEqual(await sumSessionUsage(launch.sessionDir), {
      inputTokens: 0,
      outputTokens: 0,
      costUsd: 0,
    });
  });
}
