import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { join } from "node:path";
import { test, type TestContext } from "node:test";
import {
  setupRun,
  spec,
  plan,
  implement,
} from "../../test-support/run-once-fixture.ts";
import { runCommand } from "../process/command.ts";
import { STALL_BLOCK_FILE } from "./stall-block.ts";

const waitCall = (id: string) => ({
  type: "message",
  timestamp: "2026-10-15T10:00:00.000Z",
  message: {
    role: "assistant",
    content: [
      { type: "toolCall", id, name: "bg_wait", arguments: { id: "run-1" } },
    ],
  },
});

async function setup(t: TestContext, steps: unknown[]) {
  const c = await setupRun(t, steps);
  // Short limits on the real clock; a quarter of the stop limit per poll.
  c.config.pi.stallStopMinutes = 0.02;
  c.config.pi.maxStalls = 3;
  c.config.pi.commandTimeoutMinutes = 0;
  c.config.pi.maxCommandTimeoutMinutes = 0;
  await c.seed({ [spec]: "spec", [plan]: "plan" });
  await c.mutate((s) => s.issues[0]!.labels.push("spec-approved"));
  const issueDir = join(c.repoRoot, c.config.paths.runsDir, "issue-9");
  return { c, issueDir };
}

const stalled = [
  {
    number: 1,
    kind: "stall-stop",
    calls: [
      {
        session: "p/3f2a/run-0/session.jsonl",
        run: "3f2a",
        tool: "bash",
        command: "npm test",
        startedAt: "2026-10-15T10:00:00.000Z",
        runningMs: 600_000,
      },
    ],
    quietMs: 600_000,
    tried: [],
  },
];

test("a recovered stall keeps the completed outcome", async (t) => {
  const { c } = await setup(t, [{ hang: true, recovery: implement }]);
  const outcome = await c.run();
  assert.equal(outcome.status, "completed");
  assert.match(c.output.join("\n"), /Stall 1 of 3: no activity for/);
  const { dir, result } = await c.records();
  assert.match(
    await fs.readFile(join(dir, "history.jsonl"), "utf8"),
    /Stall 1 of 3/,
  );
  assert.equal(result.sessions.at(-1).stalls, 1);
});

test("the stall limit stops with needs-info and keeps the work", async (t) => {
  const { c, issueDir } = await setup(t, [
    {
      writeFiles: { "left.txt": "half done" },
      sessionEntries: [waitCall("w1")],
      hang: true,
      recovery: { hang: true, sessionEntries: [waitCall("w2")] },
    },
  ]);
  const outcome = await c.run();
  assert.equal(outcome.status, "stopped");
  if (outcome.status !== "stopped") return;
  assert.equal(outcome.label, "needsInfo");
  assert.match(
    outcome.summary,
    /^The implementation stopped: the same command stalled twice\./,
  );
  assert.ok(c.host.state().issues[0]!.labels.includes("needs-info"));
  const record = JSON.parse(
    await fs.readFile(join(issueDir, STALL_BLOCK_FILE), "utf8"),
  );
  assert.equal(record.stalls.length, 2);
  const worktrees = join(c.repoRoot, c.config.paths.worktreeDir);
  const [worktree] = await fs.readdir(worktrees);
  const status = await runCommand("git", ["status", "--porcelain"], {
    cwd: join(worktrees, worktree!),
  });
  assert.match(status.stdout, /\?\? left\.txt/);
});

test("the next attempt names the stalled command and moves the record", async (t) => {
  const { c, issueDir } = await setup(t, [implement]);
  await fs.mkdir(issueDir, { recursive: true });
  await fs.writeFile(
    join(issueDir, STALL_BLOCK_FILE),
    JSON.stringify({ runId: "old", stalls: stalled }),
  );
  assert.equal((await c.run()).status, "completed");
  const { dir, prompt } = await c.records();
  const text = await prompt();
  assert.match(text, /- Previous stalls: .*`npm test` \(subagent run 3f2a\)/);
  await assert.rejects(fs.stat(join(issueDir, STALL_BLOCK_FILE)), {
    code: "ENOENT",
  });
  await fs.stat(join(dir, "stall-block-resumed.json"));
});

test("a paused attempt keeps the record", async (t) => {
  const { c, issueDir } = await setup(t, [{ hang: true }]);
  c.config.pi.stallStopMinutes = 10;
  await fs.mkdir(issueDir, { recursive: true });
  await fs.writeFile(
    join(issueDir, STALL_BLOCK_FILE),
    JSON.stringify({ runId: "old", stalls: stalled }),
  );
  const controller = new AbortController();
  const running = c.run({ signal: controller.signal });
  const commands = join(c.dir, "steps.json.commands.log");
  const deadline = Date.now() + 8000;
  while (
    !(await fs.readFile(commands, "utf8").catch(() => "")).includes("prompt")
  ) {
    assert.ok(Date.now() < deadline, "Pi never got its prompt");
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  controller.abort();
  assert.equal((await running).status, "paused");
  await fs.stat(join(issueDir, STALL_BLOCK_FILE));
});
