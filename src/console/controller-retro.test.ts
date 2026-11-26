import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, type TestContext } from "node:test";
import { fakeExtensionApi } from "../../test-support/fake-extension-api.ts";
import { FakeHost, writeFakeHostState } from "../../test-support/fake-host.ts";
import { parseConfig } from "../config/config.ts";
import { acquireLock } from "../kernel/lock.ts";
import type { RunOnceOutcome } from "../kernel/run-once.ts";
import type { RunSnapshot } from "../kernel/run-snapshot.ts";
import { ConsoleController } from "./controller.ts";
import type { EndedRun } from "./run-end.ts";
import { registerConsoleTools, RUN_RETRO, SKIP_RETRO } from "./tools.ts";

const RUN = "20261126-084012-e932";
const tick = () => new Promise<void>((resolve) => setImmediate(resolve));
const stopped: RunOnceOutcome = {
  status: "stopped",
  issue: 9,
  label: "needsInfo",
  summary: "Which login?",
};

async function setup(
  t: TestContext,
  options: { retro?: boolean; outcome?: RunOnceOutcome } = {},
) {
  const root = await fs.mkdtemp(join(tmpdir(), "console-retro-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const issueDir = join(root, ".patchmill/runs/issue-9");
  const runDir = join(issueDir, RUN);
  await fs.mkdir(join(runDir, "sessions", "1"), { recursive: true });
  await fs.writeFile(
    join(runDir, "result.json"),
    JSON.stringify({ startedAt: "2026-11-26T06:40:12.709Z" }),
  );
  const state = join(root, "host.json");
  writeFakeHostState(state, { issues: [] });
  const host = new FakeHost(state);
  const config = parseConfig({});
  const pi = fakeExtensionApi();
  const ends: EndedRun[] = [];
  const snapshot: RunSnapshot = {
    issue: 9,
    runId: RUN,
    runDir,
    startedAt: "2026-11-26T06:40:12.709Z",
    session: 1,
    state: "ended",
    summary: "Which login?",
  };
  const controller = new ConsoleController({
    pi,
    workers: {
      run: async () => assert.fail("no worker"),
      resume: async () => assert.fail("no worker"),
      active: () => undefined,
      stopActive: async () => {},
    },
    startRun: async (_issue, _human, observe) => {
      observe(snapshot);
      return options.outcome ?? stopped;
    },
    onRunEnd: (ended) => ends.push(ended),
    ...(options.retro === false
      ? {}
      : { retro: { config, repoRoot: root, host } }),
  });
  registerConsoleTools(pi, () => controller);
  await controller.startIssueRun(9);
  await tick();
  await tick();
  t.after(() => controller.shutdown());
  const records = async () => {
    const dir = join(issueDir, "retros");
    const names = await fs.readdir(dir).catch(() => [] as string[]);
    return Promise.all(
      names.map(
        async (name) =>
          JSON.parse(
            await fs.readFile(join(dir, name, "retro.json"), "utf8"),
          ) as Record<string, unknown>,
      ),
    );
  };
  return { root, issueDir, pi, controller, ends, records };
}

test("an offered Retro triggers an agent turn and reaches onRunEnd", async (t) => {
  const c = await setup(t);
  const end = c.pi.messages.find((m) =>
    m.message.content.startsWith("Issue #9"),
  )!;
  assert.match(end.message.content, /patchmill_offer_retro/);
  assert.deepEqual(end.options, { triggerTurn: true });
  assert.equal(c.ends.length, 1);
  assert.deepEqual(c.ends[0]!.retroEnd, { kind: "needs-info", runId: RUN });
});

test("no retro option, no offer", async (t) => {
  const c = await setup(t, { retro: false });
  const end = c.pi.messages.find((m) =>
    m.message.content.startsWith("Issue #9"),
  )!;
  assert.doesNotMatch(end.message.content, /patchmill_offer_retro/);
  assert.equal(c.controller.retroOffer(), undefined);
  assert.equal(
    await c.pi.callTool("patchmill_offer_retro", {}),
    "No Issue run end offers a Retro.",
  );
  assert.deepEqual(c.pi.selections, []);
});

test("Run retro claims once and returns the instructions", async (t) => {
  const c = await setup(t);
  const text = await c.pi.callTool(
    "patchmill_offer_retro",
    {},
    { select: RUN_RETRO },
  );
  assert.deepEqual(c.pi.selections.at(-1), {
    title: "Run a retro on this Issue run?",
    options: [RUN_RETRO, SKIP_RETRO],
  });
  assert.ok(
    text.includes(join(c.root, ".patchmill/skills/patchmill-retro")),
    text,
  );
  assert.match(text, /Mode: file-issues/);
  assert.match(text, /ask before you file/);
  assert.match(text, /patchmill_finish_retro/);
  assert.match(text, /Covered since: 2026-11-26T06:40:12.709Z/);
  assert.match(text, /## Retro source map/);
  const [record] = await c.records();
  assert.equal(record!.status, "started");
  assert.ok(text.includes(String(record!.findings ?? "findings.md")));
  const shown = c.pi.selections.length;
  assert.equal(
    await c.pi.callTool("patchmill_offer_retro", {}, { select: RUN_RETRO }),
    "No Issue run end offers a Retro.",
  );
  assert.equal(c.pi.selections.length, shown, "no second dialog");
  assert.match(
    await c.pi.callTool("patchmill_finish_retro", { summary: "Filed #5." }),
    /^The Retro is done/,
  );
  const [done] = await c.records();
  assert.equal(done!.status, "done");
  assert.equal(done!.summary, "Filed #5.");
  assert.equal(
    await c.pi.callTool("patchmill_finish_retro", { summary: "again" }),
    "No Retro is running.",
  );
});

test("Skip records a skipped Retro; a cancelled dialog claims nothing", async (t) => {
  const c = await setup(t);
  assert.equal(
    await c.pi.callTool("patchmill_offer_retro", {}, { select: undefined }),
    "No choice was made. No Retro was started.",
  );
  assert.deepEqual(await c.records(), []);
  assert.equal(
    await c.pi.callTool("patchmill_offer_retro", {}, { select: SKIP_RETRO }),
    "The Retro is skipped.",
  );
  const [record] = await c.records();
  assert.equal(record!.status, "skipped");
});

test("a held issue lock refuses the claim", async (t) => {
  const c = await setup(t);
  const lock = await acquireLock(join(c.issueDir, "lock"));
  try {
    assert.match(
      await c.controller.startRetro(),
      /holds the issue lock\. No Retro was started\. Try again later\./,
    );
  } finally {
    await lock.release();
  }
  assert.deepEqual(await c.records(), []);
  // The offer stays open after a held lock.
  assert.deepEqual(c.controller.retroOffer(), {
    kind: "needs-info",
    runId: RUN,
  });
});

test("a PR-ready run offers no Retro", async (t) => {
  const c = await setup(t, { outcome: { status: "completed", issue: 9 } });
  assert.equal(c.controller.retroOffer(), undefined);
  assert.equal(c.ends[0]!.outcome, "pr-ready");
});
