import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import {
  setupRun,
  spec,
  plan,
  done,
  branch,
} from "../../test-support/run-once-fixture.ts";
import { parseConfig } from "../config/config.ts";
import { acquireLock } from "./lock.ts";

const specBranch = "agent/issue-9--spec";
const planBranch = "agent/issue-9--plan";
const planning = (files: Record<string, string>, pr = true) => ({
  writeFiles: files,
  commit: "Planning",
  push: true,
  ...(pr ? { pullRequest: { draft: false, body: "Refs #9" } } : {}),
  result: done,
});
const implement = {
  writeFiles: { "login.ts": "code" },
  commit: "Code",
  push: true,
  pullRequest: { draft: false, body: "Closes #9" },
  result: done,
};
type Scenario = Awaited<ReturnType<typeof setupRun>>;
function gates(c: Scenario, specRequired: boolean, planRequired: boolean) {
  Object.assign(c.config.workflow, {
    specApproval: { required: specRequired },
    planApproval: { required: planRequired },
  });
}
async function merge(c: Scenario, head: string) {
  const cwd = join(c.dir, "seed");
  await c.git(["fetch", "origin", head], cwd);
  await c.git(["merge", "--no-edit", "FETCH_HEAD"], cwd);
  await c.git(["push", "origin", "HEAD:main"], cwd);
  await c.mutate((s) => {
    s.pullRequests.find((p) => p.headBranch === head)!.state = "merged";
  });
}
async function count(c: Scenario) {
  return Number(
    await fs.readFile(`${c.script}.counter`, "utf8").catch(() => "0"),
  );
}

for (const row of [
  {
    name: "neither gate",
    spec: false,
    plan: false,
    heads: [],
    steps: [planning({ [spec]: "spec", [plan]: "plan" }, false), implement],
  },
  {
    name: "spec gate only",
    spec: true,
    plan: false,
    heads: [specBranch],
    steps: [
      planning({ [spec]: "spec" }),
      planning({ [plan]: "plan" }, false),
      implement,
    ],
  },
  {
    name: "plan gate only",
    spec: false,
    plan: true,
    heads: [planBranch],
    steps: [planning({ [spec]: "spec", [plan]: "plan" }), implement],
  },
  {
    name: "both gates",
    spec: true,
    plan: true,
    heads: [specBranch, planBranch],
    steps: [
      planning({ [spec]: "spec" }),
      planning({ [plan]: "plan" }),
      implement,
    ],
  },
]) {
  test(`${row.name}: only merged planning PRs advance; ungated artifacts reach implementation`, async (t) => {
    const c = await setupRun(t, row.steps);
    gates(c, row.spec, row.plan);
    for (const [index, head] of row.heads.entries()) {
      const first = await c.run();
      assert.equal(first.status, "stopped");
      assert.deepEqual(c.host.state().issues[0]!.labels, ["in-progress"]);
      const pull = c.host.state().pullRequests.at(-1)!;
      assert.equal(pull.headBranch, head);
      assert.equal(
        pull.body.split("<!-- patchmill-run-cost:start -->")[0]!.trimEnd(),
        "Refs #9",
      );
      assert.doesNotMatch(pull.body, /\b(?:closes|fixes|resolves) #9/i);
      const calls = await count(c);
      const waiting = await c.run();
      assert.equal(waiting.status, "stopped");
      assert.equal(
        await count(c),
        calls,
        "an open planning PR must not launch Pi",
      );
      assert.equal(
        c.host.state().pullRequests.length,
        index + 1,
        "retry must not duplicate PRs",
      );
      assert.match(c.host.state().issues[0]!.comments.at(-1)!.body, /merge/i);
      await merge(c, head);
      // Hosting services commonly delete merged heads; merge evidence must survive it.
      await c.git(["push", "origin", "--delete", head]);
    }
    assert.equal((await c.run()).status, "completed");
    assert.deepEqual(c.host.state().issues[0]!.labels, ["agent-done"]);
    assert.deepEqual(
      c.host.state().pullRequests.map((p) => p.headBranch),
      [...row.heads, branch],
    );
    assert.equal(await c.git(["show", `origin/${branch}:${spec}`]), "spec");
    assert.equal(await c.git(["show", `origin/${branch}:${plan}`]), "plan");
    assert.equal(await c.git(["show", `origin/${branch}:login.ts`]), "code");
    assert.equal(await count(c), row.steps.length);
  });
}

for (const head of [planBranch, branch]) {
  test(`${head}: a stale later branch cannot replace a merged spec with older content`, async (t) => {
    const c = await setupRun(t, [
      planning({ [spec]: "approved spec" }),
      implement,
    ]);
    gates(c, true, head === planBranch);
    await c.seed({ [spec]: "old spec", [plan]: "old plan" }, head);
    await c.git(["reset", "--hard", "origin/main"], join(c.dir, "seed"));
    await c.run();
    await merge(c, specBranch);
    await c.run();
    assert.equal(await count(c), 1, "a stale artifact must stop before Pi");
    assert.deepEqual(c.host.state().issues[0]!.labels, ["needs-info"]);
    assert.match(
      c.host.state().issues[0]!.comments.at(-1)!.body,
      /merged.*artifact.*base/i,
    );
  });
}

test("omitted gates continue planning and implementation without a planning PR", async (t) => {
  const c = await setupRun(t, [
    planning({ [spec]: "spec", [plan]: "plan" }, false),
    implement,
  ]);
  c.config.workflow = parseConfig({}).workflow;
  assert.equal((await c.run()).status, "completed");
  assert.equal(c.host.state().pullRequests.length, 1);
  assert.equal(await count(c), 2);
});

test("legacy workflow settings parse, default off, and reject mistyped plan gates", () => {
  assert.deepEqual(parseConfig({}).workflow, {
    specApproval: { required: false },
    planApproval: { required: false },
  });
  assert.deepEqual(
    parseConfig({
      workflow: {
        specApproval: { required: true },
        planApproval: { required: true },
      },
    }).workflow,
    { specApproval: { required: true }, planApproval: { required: true } },
  );
  assert.throws(
    () => parseConfig({ workflow: { planApproval: { required: "yes" } } }),
    /workflow.planApproval.required/,
  );
  const migrated = parseConfig({
    labels: {
      specReview: "old-review",
      specApproved: "old-approved",
      planReview: "old-plan",
      planApproved: "old-plan-approved",
    },
  });
  assert.equal(Object.hasOwn(migrated.labels, "specReview"), false);
  assert.equal(Object.hasOwn(migrated.labels, "specApproved"), false);
});

for (const head of [specBranch, planBranch]) {
  test(`${head}: closed unmerged planning PR needs input, never implementation`, async (t) => {
    const c = await setupRun(t);
    gates(c, head === specBranch, true);
    await c.seed({ [spec]: "spec", [plan]: "plan" }, head);
    await c.mutate((s) => {
      s.pullRequests.push({
        number: 1,
        url: "https://example.invalid/1",
        state: "closed",
        draft: false,
        body: "Refs #9",
        headRepository: "fixture/repo",
        headBranch: head,
        baseBranch: "main",
      });
    });
    const r = await c.run();
    assert.equal(r.status, "stopped");
    assert.deepEqual(c.host.state().issues[0]!.labels, ["needs-info"]);
    assert.match(
      c.host.state().issues[0]!.comments.at(-1)!.body,
      /closed.*not merged/i,
    );
    assert.equal(await count(c), 0);
  });

  test(`${head}: host merge without base artifacts does not bypass planning`, async (t) => {
    const c = await setupRun(t);
    gates(c, head === specBranch, head === planBranch);
    await c.seed({ [spec]: "spec", [plan]: "plan" }, head);
    await c.mutate((s) => {
      s.pullRequests.push({
        number: 1,
        url: "https://example.invalid/1",
        state: "merged",
        draft: false,
        body: "Refs #9",
        headRepository: "fixture/repo",
        headBranch: head,
        baseBranch: "main",
      });
    });
    const r = await c.run();
    assert.equal(r.status, "stopped");
    assert.deepEqual(c.host.state().issues[0]!.labels, ["needs-info"]);
    assert.match(
      c.host.state().issues[0]!.comments.at(-1)!.body,
      /merged.*artifact.*base/i,
    );
    assert.equal(await count(c), 0);
  });

  test(`${head}: a planning PR merged into another branch does not pass its gate`, async (t) => {
    const c = await setupRun(t);
    gates(c, head === specBranch, head === planBranch);
    await c.seed({ [spec]: "spec", [plan]: "plan" }, head);
    await c.mutate((s) => {
      s.pullRequests.push({
        number: 1,
        url: "https://example.invalid/1",
        state: "open",
        draft: false,
        body: "Refs #9",
        headRepository: "fixture/repo",
        headBranch: head,
        baseBranch: "release",
      });
    });
    await merge(c, head);
    assert.equal((await c.run()).status, "stopped");
    assert.deepEqual(c.host.state().issues[0]!.labels, ["needs-info"]);
    assert.match(
      c.host.state().issues[0]!.comments.at(-1)!.body,
      /merged into release, not main/,
    );
    assert.equal(await count(c), 0);
  });
}

for (const head of [specBranch, planBranch]) {
  test(`${head}: an existing issue-closing planning PR needs correction, not a merge prompt`, async (t) => {
    const c = await setupRun(t);
    gates(c, head === specBranch, head === planBranch);
    await c.seed({ [spec]: "spec", [plan]: "plan" }, head);
    await c.mutate((s) => {
      s.pullRequests.push({
        number: 1,
        url: "https://example.invalid/1",
        state: "open",
        draft: false,
        body: "Closes #9",
        headRepository: "fixture/repo",
        headBranch: head,
        baseBranch: "main",
      });
    });
    await c.run();
    assert.deepEqual(c.host.state().issues[0]!.labels, ["needs-info"]);
    assert.match(c.host.state().issues[0]!.comments.at(-1)!.body, /Refs #9/);
    assert.equal(await count(c), 0);
  });
}

test("a new commit on an open spec branch keeps its PR at the gate", async (t) => {
  const c = await setupRun(t, [planning({ [spec]: "spec" })]);
  gates(c, true, false);
  await c.run();
  const [pull] = c.host.state().pullRequests;
  const cwd = join(c.dir, "seed");
  await c.git(["fetch", "origin", specBranch], cwd);
  await c.git(["checkout", "--detach", "FETCH_HEAD"], cwd);
  await c.seed({ [spec]: "revised spec" }, specBranch);
  assert.equal((await c.run()).status, "stopped");
  assert.deepEqual(c.host.state().pullRequests, [pull]);
  assert.match(c.host.state().issues[0]!.comments.at(-1)!.body, /merge/i);
  assert.equal(await count(c), 1);
});

test("approval labels and agent-ready cannot bypass an open spec PR", async (t) => {
  const c = await setupRun(t, [planning({ [spec]: "spec" })]);
  gates(c, true, true);
  await c.run();
  await c.mutate((s) => {
    s.issues[0]!.labels.push("spec-approved", "plan-approved", "agent-ready");
  });
  await c.run({ issue: 9 });
  assert.equal(await count(c), 1);
  assert.ok(c.host.state().issues[0]!.labels.includes("in-progress"));
  assert.ok(!c.host.state().issues[0]!.labels.includes("agent-done"));
});

test("plan-only never runs implementation when the artifacts already exist", async (t) => {
  const c = await setupRun(t, [implement]);
  await c.seed({ [spec]: "spec", [plan]: "plan" });
  const r = await c.run({ planOnly: true });
  assert.equal(r.status, "stopped");
  assert.equal(await count(c), 0);
  assert.equal(c.host.state().pullRequests.length, 0);
});

test("a merged non-closing legacy planning PR is not implementation completion", async (t) => {
  const c = await setupRun(t);
  await c.seed({ [spec]: "spec", [plan]: "plan" });
  await c.mutate((s) => {
    s.pullRequests.push({
      number: 1,
      url: "https://example.invalid/1",
      state: "merged",
      draft: false,
      body: "Refs #9",
      headRepository: "fixture/repo",
      headBranch: branch,
      baseBranch: "main",
    });
  });
  assert.equal((await c.run()).status, "stopped");
  assert.deepEqual(c.host.state().issues[0]!.labels, ["needs-info"]);
  assert.match(
    c.host.state().issues[0]!.comments.at(-1)!.body,
    /merged.*does not close/i,
  );
  assert.equal(await count(c), 0);
});

test("resumed in-progress issue still respects the active issue lock", async (t) => {
  const c = await setupRun(t);
  await c.mutate((s) => {
    s.issues[0]!.labels = ["in-progress"];
  });
  const lock = await acquireLock(c.lockPath);
  try {
    const r = await c.run({ issue: 9 });
    assert.equal(r.status, "refused");
    if (r.status === "refused") assert.match(r.reason, /active/);
    assert.equal(await count(c), 0);
    assert.equal(c.host.state().issues[0]!.comments.length, 0);
  } finally {
    await lock.release();
  }
});
