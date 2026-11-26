import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { test } from "node:test";
import { fakeExtensionApi } from "../../test-support/fake-extension-api.ts";
import { fakeSubagents } from "../../test-support/fake-subagents.ts";
import type { StartRun } from "./controller.ts";
import { SubagentsClient } from "./subagents-client.ts";
import {
  createWebSessionExtension,
  WEB_SESSION_EXTENSION_PATH,
  WEB_SESSION_STOP,
  webSessionTarget,
} from "./web-session-extension.ts";
import { WEB_SESSION_STOP_COMMAND } from "../kernel/pi-rpc-interactive.ts";
import { DEFAULT_CONFIG } from "../config/config.ts";
import type { Host } from "../host/types.ts";
import type { RunSnapshot } from "../kernel/run-snapshot.ts";
import { RETRO_OFFER } from "./run-end.ts";
import { createPatchmillExtension } from "./extension.ts";

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
const texts = (api: ReturnType<typeof fakeExtensionApi>) =>
  api.messages.map((m) => m.message.content);

const retro = {
  config: DEFAULT_CONFIG,
  repoRoot: "/nonexistent",
  host: {} as Host,
};

function setup(startRun: StartRun, refusal?: string, withRetro = false) {
  const events = fakeSubagents();
  const api = fakeExtensionApi(events);
  createWebSessionExtension({
    issue: 7,
    startRun,
    client: (bus) => new SubagentsClient(bus, { replyTimeoutMs: 100 }),
    ...(refusal ? { refusal } : {}),
    ...(withRetro ? { retro } : {}),
  })(api);
  return { api, events };
}

test("webSessionTarget reads the repository and a positive issue number", () => {
  assert.deepEqual(
    webSessionTarget({
      PATCHMILL_WEB_SESSION_REPO: "/r",
      PATCHMILL_WEB_SESSION_ISSUE: "7",
    }),
    { repoRoot: "/r", issue: 7 },
  );
  for (const issue of [undefined, "0", "-1", "1.5", "7x"])
    assert.throws(() =>
      webSessionTarget({
        PATCHMILL_WEB_SESSION_REPO: "/r",
        ...(issue === undefined ? {} : { PATCHMILL_WEB_SESSION_ISSUE: issue }),
      }),
    );
  assert.throws(() => webSessionTarget({ PATCHMILL_WEB_SESSION_ISSUE: "7" }));
});

test("the stop command name matches the RPC client's", () => {
  assert.equal(`/${WEB_SESSION_STOP}`, WEB_SESSION_STOP_COMMAND);
});

test("session_start starts the Issue run and shutdown follows its end", async () => {
  const finish = Promise.withResolvers<void>();
  const issues: (number | undefined)[] = [];
  const { api } = setup(async (issue) => {
    issues.push(issue);
    await finish.promise;
    return { status: "no-work" };
  });
  await api.fire("session_start");
  await tick();
  assert.deepEqual(issues, [7]);
  assert.equal(api.shutdowns, 0);
  finish.resolve();
  await tick();
  await tick();
  assert.equal(api.shutdowns, 1);
  assert.equal(texts(api).at(-1), "Issue run no-work.");
});

test("a failed Issue run also requests shutdown", async () => {
  const { api } = setup(async () => {
    throw new Error("sync failed");
  });
  await api.fire("session_start");
  await tick();
  await tick();
  assert.equal(api.shutdowns, 1);
  assert.ok(texts(api).includes("sync failed"));
});

test("a refused run notifies its reason before shutdown", async () => {
  const { api } = setup(async () => ({
    status: "refused",
    issue: 7,
    reason: "another Run attempt is active",
  }));
  await api.fire("session_start");
  await tick();
  await tick();
  assert.equal(texts(api).at(-1), "another Run attempt is active");
  assert.equal(api.shutdowns, 1);
});

test("blocked stray-worker cleanup shuts the session down", async () => {
  const events = fakeSubagents({
    status: () => ({ error: { code: "boom", message: "status failed" } }),
  });
  const api = fakeExtensionApi(events);
  let started = false;
  createWebSessionExtension({
    issue: 7,
    startRun: async () => {
      started = true;
      return { status: "no-work" };
    },
    client: (bus) => new SubagentsClient(bus, { replyTimeoutMs: 100 }),
  })(api);
  await api.fire("session_start");
  assert.equal(started, false);
  assert.match(texts(api).at(-1) ?? "", /will not start the Issue run/);
  assert.equal(api.shutdowns, 1);
});

test("a held Console session lock refuses without starting a run", async () => {
  let started = false;
  const { api } = setup(async () => {
    started = true;
    return { status: "no-work" };
  }, "Issue #7's Console session is open in another process. Close it first.");
  await api.fire("session_start");
  assert.equal(started, false);
  assert.deepEqual(texts(api), [
    "Issue #7's Console session is open in another process. Close it first.",
  ]);
  assert.equal(api.shutdowns, 1);
});

test("the stop command stops the Issue run before session_shutdown", async () => {
  const order: string[] = [];
  const { api } = setup(async (_issue, human) => {
    const answer = await human.awaitContinue({ kind: "gate", message: "Go" });
    order.push(`run settled: ${answer}`);
    return { status: "no-work" };
  });
  await api.fire("session_start");
  await tick();
  const original = api.shutdowns;
  assert.equal(original, 0);
  await api.runCommand(WEB_SESSION_STOP);
  // The run wrapper and the command both ask Pi to exit; Pi accepts both.
  order.push(`shut down: ${api.shutdowns > 0}`);
  assert.deepEqual(order, ["run settled: quit", "shut down: true"]);
  assert.ok(texts(api).includes("Stopping the Web session."));
  // A later session_shutdown reuses the finished shutdown.
  await api.fire("session_shutdown");
});

test("WEB_SESSION_EXTENSION_PATH exists", () => {
  assert.ok(existsSync(WEB_SESSION_EXTENSION_PATH));
});

const needsInfoRun =
  (gate?: Promise<void>): StartRun =>
  async (_issue, _human, observe) => {
    observe({
      issue: 7,
      runId: "20261126-084012-e932",
      runDir: "/nonexistent/issue-7/20261126-084012-e932",
      startedAt: "now",
      session: 1,
      state: "ended",
      summary: "Which login?",
    } satisfies RunSnapshot);
    await gate;
    return {
      status: "stopped",
      issue: 7,
      label: "needsInfo",
      summary: "Which login?",
    };
  };

test("a needs-info run without a Retro option closes at once", async () => {
  const { api } = setup(needsInfoRun());
  await api.fire("session_start");
  await tick();
  await tick();
  assert.equal(api.shutdowns, 1);
  assert.equal(texts(api).at(-1), "Which login?");
});

test("a run with a Retro offer stays open until patchmill_end_session", async () => {
  const { api } = setup(needsInfoRun(), undefined, true);
  await api.fire("session_start");
  await tick();
  await tick();
  assert.equal(api.shutdowns, 0);
  const offer = api.messages.at(-1)!;
  assert.equal(offer.message.content, `Which login?\n${RETRO_OFFER}`);
  assert.deepEqual(offer.options, { triggerTurn: true });
  assert.equal(
    await api.callTool("patchmill_end_session", {}),
    "The Web session ends now.",
  );
  assert.equal(api.shutdowns, 1);
});

test("patchmill_end_session refuses during an active run", async () => {
  const finish = Promise.withResolvers<void>();
  const { api } = setup(needsInfoRun(finish.promise), undefined, true);
  await api.fire("session_start");
  await tick();
  assert.match(
    await api.callTool("patchmill_end_session", {}),
    /An Issue run is active/,
  );
  assert.equal(api.shutdowns, 0);
  finish.resolve();
  await tick();
  await tick();
  assert.equal(api.shutdowns, 0);
});

test("a thrown run with a Retro option closes at once", async () => {
  const { api } = setup(
    async () => {
      throw new Error("sync failed");
    },
    undefined,
    true,
  );
  await api.fire("session_start");
  await tick();
  await tick();
  assert.equal(api.shutdowns, 1);
});

test("the terminal console has no patchmill_end_session", () => {
  const api = fakeExtensionApi();
  createPatchmillExtension({ startRun: async () => ({ status: "no-work" }) })(
    api,
  );
  assert.equal(api.tools.has("patchmill_end_session"), false);
  assert.equal(api.tools.has("patchmill_offer_retro"), true);
});
