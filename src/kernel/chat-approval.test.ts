import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import {
  setupRun,
  spec,
  plan,
  branch,
  done,
  implement,
  kernelComments,
  merge,
} from "../../test-support/run-once-fixture.ts";
import { fakeHuman } from "../../test-support/fake-human.ts";
import { collectFacts } from "./facts.ts";
import { planningWorkspace } from "./planning-workspace.ts";

const planning = (files: Record<string, string>, pr = false) => ({
  writeFiles: files,
  commit: "Planning",
  push: true,
  ...(pr ? { pullRequest: { draft: false, body: "Refs #9" } } : {}),
  result: done,
});

test("no-PR spec approval pushes the planning head and continues without a gate stop", async (t) => {
  const c = await setupRun(t, [
    planning({ [spec]: "approved spec" }),
    planning({ [plan]: "plan" }),
    implement,
  ]);
  c.config.workflow.specApproval.required = true;
  const human = fakeHuman(c);
  const launch = human.runPlanning.bind(human);
  let calls = 0;
  human.runPlanning = async (request, feedback) => {
    if (++calls === 2) {
      assert.equal(
        await c.git(["rev-parse", `origin/${branch}`]),
        await c.git(["rev-parse", "origin/agent/issue-9--spec"]),
      );
      assert.equal(kernelComments(c).length, 0);
      assert.equal(request.worktree, c.worktree);
    }
    const run = await launch(request, feedback);
    return calls === 1 ? { ...run, planningApproval: "no-pr" } : run;
  };
  assert.equal((await c.run({ issue: 9 }, { human })).status, "completed");
  assert.equal(human.calls.includes("wait:gate"), false);
  assert.equal(
    (await c.records()).result.sessions[0].planningApproval,
    "no-pr",
  );
  assert.equal(c.host.state().pullRequests.length, 1);
  assert.equal(kernelComments(c).length, 1);
  assert.equal(
    await c.git(["show", `origin/${branch}:${spec}`]),
    "approved spec",
  );
});

test("approval plus PR still asks for a missing gate PR and waits for its merge", async (t) => {
  const c = await setupRun(t, [
    planning({ [spec]: "spec" }),
    { pullRequest: { draft: false, body: "Refs #9" }, result: done },
    planning({ [plan]: "plan" }),
    implement,
  ]);
  c.config.workflow.specApproval.required = true;
  const human = fakeHuman(c, {
    onWait: async (wait) => {
      if (wait.kind === "gate") {
        await merge(c, "agent/issue-9--spec");
        return "continue";
      }
      return "quit";
    },
  });
  const launch = human.runPlanning.bind(human);
  human.runPlanning = async (request, feedback) => ({
    ...(await launch(request, feedback)),
    planningApproval: "pr",
  });
  assert.equal((await c.run({ issue: 9 }, { human })).status, "completed");
  assert.match(human.feedback[0]!, /No planning pull request/);
  assert.ok(human.calls.includes("wait:gate"));
});

test("later plan gate stays on implementation and offers chat-only approval", async (t) => {
  const c = await setupRun(t, [
    planning({ [spec]: "spec" }),
    { ...planning({ [plan]: "plan" }), push: false },
    implement,
  ]);
  c.config.workflow.specApproval.required = true;
  c.config.workflow.planApproval.required = true;
  const human = fakeHuman(c, { quitPlanningAt: 3 });
  const launch = human.runPlanning.bind(human);
  let calls = 0;
  human.runPlanning = async (request, feedback) => {
    if (++calls === 2) {
      assert.equal(request.worktree, c.worktree);
      assert.deepEqual(request.planningGate, {
        required: true,
        pullRequest: false,
      });
      assert.match(request.envelope, /earlier unmerged document/i);
    }
    return { ...(await launch(request, feedback)), planningApproval: "no-pr" };
  };
  assert.equal((await c.run({ issue: 9 }, { human })).status, "completed");
  assert.equal(c.host.state().pullRequests.length, 1);
  assert.equal(await c.git(["show", `origin/${branch}:${plan}`]), "plan");
  assert.equal(human.calls.includes("wait:gate"), false);
});

for (const planRequired of [false, true]) {
  test(`restart derives ${planRequired ? "plan" : "implementation"} from a pushed spec, ignoring local-only plan`, async (t) => {
    const c = await setupRun(t);
    c.config.workflow.specApproval.required = true;
    c.config.workflow.planApproval.required = planRequired;
    await c.seed({ [spec]: "approved" });
    await c.deps.git.fetch();
    await c.deps.git.ensureWorktree({
      path: c.worktree,
      branch,
      base: "main",
      remoteExists: true,
    });
    await fs.mkdir(join(c.worktree, "docs/plans"), { recursive: true });
    await fs.writeFile(join(c.worktree, plan), "not pushed or approved");
    const result = await collectFacts(
      { ...c.deps, config: c.config },
      await c.host.viewIssue(9),
    );
    assert.equal(result.kind, "facts");
    if (result.kind === "facts") {
      assert.equal(
        result.facts.stage,
        planRequired ? "plan" : "implementation",
      );
      assert.equal(result.facts.branch, branch);
    }
  });
}

test("pushed gated documents do not weaken the ambiguous implementation branch refusal", async (t) => {
  const c = await setupRun(t);
  const result = await planningWorkspace({
    host: c.host,
    workflow: c.config.workflow,
    issue: await c.host.viewIssue(9),
    branches: [branch, "agent/issue-9-other"],
    baseBranch: "main",
  });
  assert.equal(result.kind, "ambiguous-branches");
});
