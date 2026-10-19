import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import {
  done,
  plan,
  setupRun,
  spec,
} from "../../test-support/run-once-fixture.ts";

for (const failure of [
  "publication",
  "missing-usage",
  "missing-metadata",
  "malformed-markers",
]) {
  test(`PR cost ${failure} failure cannot undo completion or skip label cleanup`, async (t) => {
    const body = `Closes #9${failure === "malformed-markers" ? "\n<!-- patchmill-run-cost:start -->" : ""}`;
    const c = await setupRun(t, [
      {
        writeFiles: { "login.ts": "code" },
        commit: "Code",
        push: true,
        pullRequest: { draft: false, body },
        result: done,
      },
    ]);
    await c.seed({ [spec]: "spec", [plan]: "plan" });
    if (failure === "publication") {
      t.mock.method(c.host, "updatePullRequestBody", async () => {
        throw new Error("permission denied");
      });
    } else if (failure === "missing-usage" || failure === "missing-metadata") {
      const prior = join(
        c.repoRoot,
        c.config.paths.runsDir,
        "issue-9",
        "prior-run",
      );
      await fs.mkdir(join(prior, "sessions"), { recursive: true });
      if (failure === "missing-usage")
        await fs.writeFile(
          join(prior, "result.json"),
          JSON.stringify({ sessions: [{ phase: "planning" }] }),
        );
    }
    assert.equal((await c.run()).status, "completed");
    assert.deepEqual(c.host.state().issues[0]!.labels, ["agent-done"]);
    assert.match(
      c.host.state().issues[0]!.comments.at(-1)!.body,
      /PR cost report unavailable:/,
    );
    assert.equal(c.host.state().pullRequests[0]!.body, body);
  });
}

// Dropping history, child sessions, cached tokens, or de-duplication changes the totals.
test("implementation PR includes earlier specification costs by phase and model", async (t) => {
  const body = "Implementation details\n\nCloses #9\n";
  const c = await setupRun(t, [
    {
      writeFiles: { [plan]: "plan" },
      commit: "Plan",
      push: true,
      result: done,
    },
    {
      writeFiles: { "login.ts": "code" },
      commit: "Code",
      push: true,
      pullRequest: { draft: false, body },
      result: done,
    },
  ]);
  await c.seed({ [spec]: "spec" });
  const prior = join(
    c.repoRoot,
    c.config.paths.runsDir,
    "issue-9",
    "20261014-120000-abcd",
  );
  const sessions = join(prior, "sessions", "1");
  await fs.mkdir(join(sessions, "subagents"), { recursive: true });
  await fs.writeFile(
    join(prior, "result.json"),
    JSON.stringify({
      runId: "20261014-120000-abcd",
      issue: 9,
      startedAt: "2026-10-14T12:00:00Z",
      finishedAt: "2026-10-14T12:01:00Z",
      outcome: {
        status: "stopped",
        issue: 9,
        label: "inProgress",
        summary: "Waiting for spec merge",
      },
      sessions: [
        { phase: "planning", exitCode: 0, timedOut: false, status: "done" },
      ],
    }),
  );
  const parent = JSON.stringify({
    type: "message",
    id: "spec-message",
    message: {
      role: "assistant",
      model: "spec-model",
      usage: {
        input: 10,
        cacheRead: 1000,
        cacheWrite: 50,
        output: 7,
        cost: { total: 0.1 },
      },
    },
  });
  const child = JSON.stringify({
    type: "message",
    id: "review-message",
    message: {
      role: "assistant",
      model: "review-model",
      usage: {
        input: 20,
        output: 3,
        cost: { total: 0.02 },
      },
    },
  });
  await fs.writeFile(join(sessions, "parent.jsonl"), `${parent}\n`);
  await fs.writeFile(
    join(sessions, "subagents", "scout.jsonl"),
    `${parent}\n${child}\n`,
  );

  assert.equal((await c.run()).status, "completed");
  const published = c.host.state().pullRequests[0]!.body;
  assert.ok(published.startsWith(body));
  assert.match(
    published,
    /\| Planning \| spec-model \| 1,060 \| 7 \| \$0\.1000 \|/,
  );
  assert.match(
    published,
    /\| Planning \| review-model \| 20 \| 3 \| \$0\.0200 \|/,
  );
  assert.match(
    published,
    /\| Planning \| Unknown model \| 100 \| 20 \| \$0\.0500 \|/,
  );
  assert.match(
    published,
    /\| Implementation \| Unknown model \| 100 \| 20 \| \$0\.0500 \|/,
  );
  assert.match(
    published,
    /\| \*\*Total\*\* \| {2}\| \*\*1,280\*\* \| \*\*50\*\* \| \*\*\$0\.2200\*\* \|/,
  );
  assert.deepEqual(c.host.state().issues[0]!.labels, ["agent-done"]);
});

test("planning PR gets one cost section and a gated rerun does not double-count", async (t) => {
  const c = await setupRun(t, [
    {
      writeFiles: { [spec]: "spec" },
      commit: "Spec",
      push: true,
      pullRequest: { body: "Spec details\n\nRefs #9" },
      result: done,
    },
  ]);
  c.config.workflow.specApproval.required = true;
  assert.equal((await c.run()).status, "stopped");
  const first = c.host.state().pullRequests[0]!.body;
  assert.match(
    first,
    /\| Planning \| Unknown model \| 100 \| 20 \| \$0\.0500 \|/,
  );
  assert.ok(first.startsWith("Spec details\n\nRefs #9"));

  assert.equal((await c.run()).status, "stopped");
  const second = c.host.state().pullRequests[0]!.body;
  assert.equal(second, first);
  assert.equal(second.split("<!-- patchmill-run-cost:start -->").length - 1, 1);
  assert.equal(await fs.readFile(`${c.script}.counter`, "utf8"), "1");
  assert.deepEqual(c.host.state().issues[0]!.labels, ["in-progress"]);
});
