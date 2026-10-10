import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import {
  createConcurrentScenario,
  type AgentBarrier,
} from "../../../../test-support/run-once/concurrent-run-scenario.ts";
import {
  acquirePlanningIssueLock,
  releasePlanningIssueLock,
} from "../../../workflow/planning-issue-lock.ts";

for (const kinds of [
  ["planning", "planning"],
  ["legacy", "legacy"],
  ["planning", "legacy"],
] as const) {
  test(
    `${kinds.join("/")} explicit processes overlap with isolated resources`,
    { timeout: 120_000 },
    async () => {
      const scenario = await createConcurrentScenario([...kinds]);
      try {
        const first = scenario.start(1),
          second = scenario.start(2);
        const barriers = (await Promise.all([
          first.waitForBarrier(),
          second.waitForBarrier(),
        ])) as AgentBarrier[];
        const bothAgentBarriersReached = scenario.agents.length === 2;
        assert.equal(bothAgentBarriersReached, true);
        assert.notEqual(barriers[0]!.cwd, barriers[1]!.cwd);
        assert.notEqual(barriers[0]!.branch, barriers[1]!.branch);
        assert.notEqual(barriers[0]!.session, barriers[1]!.session);
        await scenario.noGitGuard();
        assert.equal(
          scenario.host.reads.some((read) => read.operation === "list"),
          false,
        );
        first.release();
        second.release();
        const results = await Promise.all([first.finish(), second.finish()]);
        assert.deepEqual(
          results.map((result) => result.code),
          [0, 0],
        );
        assert.ok(scenario.host.pulls.length >= 2);
        assert.equal(new Set(await scenario.logs()).size, 2);
        assert.equal(await scenario.git("rev-parse", "HEAD"), scenario.baseOid);
        assert.ok(
          scenario.host.issues.every(
            (issue) => !issue.labels.includes("agent-done"),
          ),
        );
      } finally {
        await scenario.cleanup();
      }
    },
  );
}

test(
  "same-issue loser exits normally without changing winner evidence",
  { timeout: 120_000 },
  async () => {
    const scenario = await createConcurrentScenario(["legacy"]);
    try {
      const first = scenario.start(1);
      const barrier = (await first.waitForBarrier()) as AgentBarrier;
      const sentinel = join(barrier.cwd, "owned-evidence.txt");
      await writeFile(sentinel, "keep");
      const before = await scenario.snapshot(1);
      const loser = await scenario.start(1).finish();
      assert.equal(loser.code, 0, JSON.stringify(loser));
      assert.equal(loser.output.status, "stopped");
      assert.equal(loser.output.reason, "issue-locked");
      assert.match(
        loser.stderr + JSON.stringify(loser.output),
        /issue already in progress\./u,
      );
      assert.doesNotMatch(
        loser.stderr + JSON.stringify(loser.output),
        /lease repair|confirm.*stopped/u,
      );
      assert.deepEqual(await scenario.snapshot(1), before);
      assert.equal(await readFile(sentinel, "utf8"), "keep");
      assert.equal(scenario.agents.length, 1);
      await scenario.git("-C", barrier.cwd, "add", "owned-evidence.txt");
      await scenario.git("-C", barrier.cwd, "commit", "-m", "owned evidence");
      first.release();
      assert.equal((await first.finish()).code, 0);
    } finally {
      await scenario.cleanup();
    }
  },
);

test(
  "preexisting planning lock stops the explicit command before issue effects",
  { timeout: 120_000 },
  async () => {
    const scenario = await createConcurrentScenario(["planning"]);
    const lock = await acquirePlanningIssueLock(scenario.config.runStateDir, {
      issueNumber: 1,
      runId: randomUUID(),
    });
    try {
      const before = await scenario.snapshot(1);
      const result = await scenario.start(1).finish();
      assert.equal(result.code, 0);
      assert.equal(result.output.reason, "issue-locked");
      assert.deepEqual(await scenario.snapshot(1), before);
      assert.equal(scenario.agents.length, 0);
    } finally {
      await releasePlanningIssueLock(lock);
      await scenario.cleanup();
    }
  },
);

test(
  "explicit fresh work ignores unrelated malformed recovery files",
  { timeout: 120_000 },
  async () => {
    const scenario = await createConcurrentScenario(["planning", "legacy"]);
    try {
      const raw = "malformed unrelated state\n";
      const path = join(scenario.config.runStateDir, "issue-2.json");
      await writeFile(path, raw);
      const planningRoot = join(
        scenario.config.runStateDir,
        "planning-pr-v1",
        "issues",
      );
      await mkdir(planningRoot, { recursive: true });
      await writeFile(join(planningRoot, "issue-2.json"), raw);
      const run = scenario.start(1);
      await run.waitForBarrier();
      run.release();
      assert.equal((await run.finish()).code, 0);
      assert.equal(await readFile(path, "utf8"), raw);
      assert.equal(
        await readFile(join(planningRoot, "issue-2.json"), "utf8"),
        raw,
      );
      assert.equal(
        scenario.host.reads.some((read) => read.issueNumber === 2),
        false,
      );
    } finally {
      await scenario.cleanup();
    }
  },
);
