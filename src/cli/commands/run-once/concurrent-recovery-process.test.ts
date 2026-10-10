import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import {
  createConcurrentScenario,
  type AgentBarrier,
} from "../../../../test-support/run-once/concurrent-run-scenario.ts";

for (const modes of [
  ["automatic", "automatic"],
  ["automatic", "explicit"],
  ["explicit", "automatic"],
] as const) {
  test(
    `${modes.join("/")} processes retain serial admission`,
    { timeout: 120_000 },
    async () => {
      const scenario = await createConcurrentScenario(["legacy", "legacy"]);
      try {
        const first = scenario.start(1, modes[0]);
        await first.waitForBarrier();
        const before = await scenario.snapshot(2);
        const second = await scenario.start(2, modes[1]).finish();
        assert.equal(second.code, 1);
        assert.match(JSON.stringify(second.output), /admission conflicts/u);
        assert.deepEqual(await scenario.snapshot(2), before);
        assert.equal(scenario.agents.length, 1);
        first.release();
        assert.equal((await first.finish()).code, 0);
      } finally {
        await scenario.cleanup();
      }
    },
  );
}

test("dry-run creates no ownership records", { timeout: 120_000 }, async () => {
  const scenario = await createConcurrentScenario(["planning"]);
  try {
    const before = await scenario.snapshot(1);
    const result = await scenario.start(1, "dry").finish();
    assert.equal(result.code, 0, JSON.stringify(result));
    assert.deepEqual(await scenario.snapshot(1), before);
    assert.equal(scenario.agents.length, 0);
    await assert.rejects(
      readdir(join(scenario.root, ".git", "patchmill", "run-once")),
      { code: "ENOENT" },
    );
    await assert.rejects(readdir(join(scenario.config.runStateDir, "locks")), {
      code: "ENOENT",
    });
  } finally {
    await scenario.cleanup();
  }
});

test(
  "killed explicit process resumes beside another owner with new evidence and one PR",
  { timeout: 120_000 },
  async () => {
    const scenario = await createConcurrentScenario(["legacy", "legacy"]);
    try {
      const first = scenario.start(1),
        other = scenario.start(2);
      const [before] = (await Promise.all([
        first.waitForBarrier(),
        other.waitForBarrier(),
      ])) as AgentBarrier[];
      await first.kill();
      const otherBefore = await scenario.snapshot(2);
      const resumed = scenario.start(1);
      const after = (await resumed.waitForBarrier()) as AgentBarrier;
      assert.equal(after.cwd, before!.cwd);
      assert.equal(after.branch, before!.branch);
      assert.notEqual(after.session, before!.session);
      assert.deepEqual(await scenario.snapshot(2), otherBefore);
      resumed.release();
      const publication = await resumed.finish();
      assert.equal(publication.code, 0, JSON.stringify(publication));
      assert.equal(publication.output.status, "pr-created");
      const saved = await scenario.snapshot(1);
      const repeat = await scenario.start(1).finish();
      assert.equal(repeat.code, 0, JSON.stringify(repeat));
      assert.equal(repeat.output.prUrl, publication.output.prUrl);
      assert.equal(
        scenario.host.pulls.filter((pull) => pull.issueNumber === 1).length,
        1,
      );
      const current = await scenario.snapshot(1);
      assert.deepEqual(
        JSON.parse(current.state!).implementationPr,
        JSON.parse(saved.state!).implementationPr,
      );
      assert.deepEqual(current.effects, saved.effects);
      assert.deepEqual(current.issue, saved.issue);
      assert.equal(current.refs, saved.refs);
      assert.equal(
        scenario.agents.filter((agent) => agent.issueNumber === 1).length,
        2,
      );
      other.release();
      assert.equal((await other.finish()).code, 0);
    } finally {
      await scenario.cleanup();
    }
  },
);

test(
  "shared recovery Git transactions serialize across real processes",
  { timeout: 120_000 },
  async () => {
    const scenario = await createConcurrentScenario(["legacy", "legacy"]);
    try {
      const first = scenario.start(1, "explicit", "transaction");
      await first.waitForBarrier();
      const second = scenario.start(2, "explicit", "transaction");
      await second.waitForTransactionStart();
      assert.deepEqual(scenario.mutations, [1]);
      first.release();
      await second.waitForBarrier();
      assert.deepEqual(scenario.mutations, [1, 2]);
      second.release();
      assert.deepEqual(
        (await Promise.all([first.finish(), second.finish()])).map(
          (result) => result.code,
        ),
        [0, 0],
      );
      assert.equal(
        await scenario.git("rev-parse", "refs/heads/recovery-1"),
        scenario.baseOid,
      );
      assert.equal(
        await scenario.git("rev-parse", "refs/heads/recovery-2"),
        scenario.baseOid,
      );
      await scenario.noGitGuard();
    } finally {
      await scenario.cleanup();
    }
  },
);

test(
  "conflicting host merges use expected base OIDs and finish without agents",
  { timeout: 120_000 },
  async () => {
    const scenario = await createConcurrentScenario(["legacy", "legacy"]);
    try {
      const first = scenario.start(1),
        second = scenario.start(2);
      await Promise.all([first.waitForBarrier(), second.waitForBarrier()]);
      first.release();
      second.release();
      const publications = await Promise.all([first.finish(), second.finish()]);
      assert.deepEqual(
        publications.map((result) => result.output.status),
        ["pr-created", "pr-created"],
        JSON.stringify(publications),
      );
      assert.ok(
        scenario.host.issues.every((issue) =>
          issue.labels.includes("in-progress"),
        ),
      );
      const results = await Promise.all(
        scenario.host.pulls.map((pull) =>
          scenario.merge(pull, scenario.baseOid),
        ),
      );
      assert.deepEqual([...results].sort(), [false, true]);
      const loser = scenario.host.pulls.find((pull) => !pull.mergeOid)!;
      assert.equal(await scenario.merge(loser), true);
      assert.equal(
        await scenario.remoteGit("show", "refs/heads/main:change-1.txt"),
        "issue 1",
      );
      assert.equal(
        await scenario.remoteGit("show", "refs/heads/main:change-2.txt"),
        "issue 2",
      );
      const completions = await Promise.all([
        scenario.start(1).finish(),
        scenario.start(2).finish(),
      ]);
      assert.deepEqual(
        completions.map((result) => result.code),
        [0, 0],
        JSON.stringify(completions),
      );
      assert.deepEqual(
        completions.map((result) => result.output.status),
        ["merged", "merged"],
      );
      assert.equal(scenario.agents.length, 2);
      assert.equal(scenario.host.pulls.length, 2);
      assert.ok(
        scenario.host.issues.every((issue) =>
          issue.labels.includes("agent-done"),
        ),
      );
      assert.equal(await scenario.git("rev-parse", "HEAD"), scenario.baseOid);
      for (const number of [1, 2]) {
        const raw = await readFile(
          join(scenario.config.runStateDir, `issue-${number}.json`),
          "utf8",
        );
        assert.equal(JSON.parse(raw).status, "finished");
      }
    } finally {
      await scenario.cleanup();
    }
  },
);
