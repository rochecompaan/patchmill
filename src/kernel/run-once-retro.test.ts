import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { dirname, join } from "node:path";
import test from "node:test";
import { setupCleanup } from "../../test-support/merged-cleanup-fixture.ts";
import {
  done,
  implement,
  plan,
  setupRun,
  spec,
  type Scenario,
} from "../../test-support/run-once-fixture.ts";
import { prepareInteractiveRun } from "./interactive-start.ts";
import type { sweepMergedIssues } from "./merged-cleanup-sweep.ts";

const retroStep = {
  result: { status: "done", summary: "Wrote the findings file." },
};
const needsInput = {
  result: { status: "needs-input", summary: "Which login?" },
};

async function retros(c: Scenario) {
  const dir = join(dirname(c.lockPath), "retros");
  const names = await fs.readdir(dir).catch(() => [] as string[]);
  return Promise.all(
    names.map(
      async (name) =>
        JSON.parse(
          await fs.readFile(join(dir, name, "retro.json"), "utf8"),
        ) as Record<string, unknown>,
    ),
  );
}
const launches = async (c: Scenario) =>
  Number(await fs.readFile(`${c.script}.counter`, "utf8").catch(() => "0"));

for (const mode of ["off", "findings-only"] as const)
  test(`an unattended needsInfo stop with retro ${mode} keeps the outcome`, async (t) => {
    const c = await setupRun(t, [needsInput, retroStep]);
    c.config.retro.unattended = mode;
    await c.seed({ [spec]: "spec" });
    const outcome = await c.run();
    assert.equal(outcome.status, "stopped");
    assert.equal("label" in outcome ? outcome.label : undefined, "needsInfo");
    assert.match("summary" in outcome ? outcome.summary : "", /Which login/);
    const { result, dir } = await c.records();
    assert.deepEqual(result.outcome, outcome);
    assert.equal(result.sessions.length, 1);
    assert.deepEqual(c.host.state().issues[0]!.labels, ["needs-info"]);
    const records = await retros(c);
    if (mode === "off") {
      assert.deepEqual(records, []);
      assert.equal(await launches(c), 1);
      return;
    }
    assert.equal(await launches(c), 2);
    assert.equal(records.length, 1);
    assert.equal(records[0]!.end, `needs-info-${dir.split("/").at(-1)}`);
    assert.equal(records[0]!.status, "done");
    assert.deepEqual(records[0]!.runIds, [dir.split("/").at(-1)]);
  });

test("the run cost line excludes Retro usage", async (t) => {
  const c = await setupRun(t, [needsInput, retroStep]);
  c.config.retro.unattended = "findings-only";
  await c.seed({ [spec]: "spec" });
  await c.run();
  const text = c.output.join("\n");
  // The fake Pi records 100 in / 20 out per session: one phase session only.
  assert.match(text, /Cost: 100 in \/ 20 out tokens/);
  assert.match(text, /Retro: .*findings\.md\. Cost: 100 in \/ 20 out tokens/);
});

test("a failed Retro warns and leaves the outcome unchanged", async (t) => {
  const c = await setupRun(t, [needsInput, { stdout: "no block" }]);
  c.config.retro.unattended = "file-issues";
  await c.seed({ [spec]: "spec" });
  const outcome = await c.run();
  assert.equal(outcome.status, "stopped");
  assert.match(c.output.join("\n"), /Warning: Issue #9 Retro: no result/);
  assert.equal((await retros(c))[0]!.status, "failed");
  assert.deepEqual((await c.records()).result.outcome, outcome);
});

test("a merge found by the sweep runs a Retro once", async (t) => {
  const c = await setupCleanup(t);
  c.config.retro.unattended = "findings-only";
  await fs.writeFile(c.script, JSON.stringify([implement, retroStep]));
  const pullRequest = c.host.state().pullRequests[0]!.number;
  assert.equal((await c.run()).status, "no-work");
  const records = await retros(c);
  assert.equal(records.length, 1);
  assert.equal(records[0]!.end, `merged-${pullRequest}`);
  assert.equal(records[0]!.status, "done");
  assert.equal(await launches(c), 2);
});

// One setupRun per test: each mocks process.stdout for its test only.
test("a PR-ready end starts no Retro", async (t) => {
  const ready = await setupRun(t, [implement, retroStep]);
  ready.config.retro.unattended = "file-issues";
  await ready.seed({ [spec]: "spec", [plan]: "plan" });
  assert.equal((await ready.run()).status, "completed");
  assert.deepEqual(await retros(ready), []);
  assert.equal(await launches(ready), 1);
});

test("a gate wait starts no Retro", async (t) => {
  const gate = await setupRun(t, [
    {
      writeFiles: { [spec]: "design" },
      commit: "Spec",
      push: true,
      pullRequest: { draft: false, body: "Refs #9" },
      result: done,
    },
    retroStep,
  ]);
  gate.config.retro.unattended = "file-issues";
  gate.config.workflow.specApproval.required = true;
  const waiting = await gate.run();
  assert.equal(waiting.status, "stopped");
  assert.equal("label" in waiting ? waiting.label : undefined, "inProgress");
  assert.deepEqual(await retros(gate), []);
  assert.equal(await launches(gate), 1);
});

test("a --plan-only run starts no Retro", async (t) => {
  const planOnly = await setupRun(t, [
    {
      writeFiles: { [spec]: "spec", [plan]: "plan" },
      commit: "Planning",
      push: true,
      result: done,
    },
    retroStep,
  ]);
  planOnly.config.retro.unattended = "file-issues";
  await planOnly.run({ planOnly: true });
  assert.deepEqual(await retros(planOnly), []);
  assert.equal(await launches(planOnly), 1);
});

test("an interactive start passes no retro to the sweep", async (t) => {
  const c = await setupRun(t);
  c.config.retro.unattended = "file-issues";
  const inputs: Parameters<typeof sweepMergedIssues>[0][] = [];
  await prepareInteractiveRun({
    config: c.config,
    deps: c.deps,
    report: () => {},
    sweep: async (input) => {
      inputs.push(input);
    },
  });
  assert.equal(inputs.length, 1);
  assert.equal(inputs[0]!.retro, undefined);
});
