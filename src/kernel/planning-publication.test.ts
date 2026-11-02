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
} from "../../test-support/run-once-fixture.ts";
import { fakeHuman } from "../../test-support/fake-human.ts";

const specBranch = "agent/issue-9--spec";
const specification = {
  writeFiles: { [spec]: "approved spec" },
  commit: "Spec",
  push: true,
  result: done,
};
const planStep = {
  writeFiles: { [plan]: "plan" },
  commit: "Plan",
  push: true,
  result: done,
};

for (const failure of ["rejected push", "branch lock"] as const) {
  test(`${failure} returns planning feedback; fixing it retries the same approved head without a stop`, async (t) => {
    const c = await setupRun(t, [
      specification,
      { result: done },
      planStep,
      implement,
    ]);
    c.config.workflow.specApproval.required = true;
    const blocker =
      failure === "rejected push"
        ? join(c.originPath, "hooks/pre-receive")
        : join(c.repoRoot, ".git/refs/heads", `${branch}.lock`);
    await fs.mkdir(join(blocker, ".."), { recursive: true });
    await fs.writeFile(
      blocker,
      failure === "rejected push"
        ? `#!/bin/sh\nwhile read old new ref; do\n  if [ "$ref" = "refs/heads/${branch}" ]; then\n    echo "publication rejected for test" >&2\n    exit 1\n  fi\ndone\n`
        : "locked for test",
    );
    if (failure === "rejected push") await fs.chmod(blocker, 0o755);
    const human = fakeHuman(c, { quitPlanningAt: 4 });
    const launch = human.runPlanning.bind(human);
    let calls = 0;
    let approvedHead = "";
    human.runPlanning = async (request, feedback) => {
      calls++;
      if (calls === 2) {
        assert.match(
          feedback!,
          failure === "rejected push"
            ? /publication rejected for test/
            : /cannot lock ref|File exists/,
        );
        assert.doesNotMatch(
          feedback!,
          /\n/,
          "publication failure should be a one-line chat reason",
        );
        assert.equal(
          kernelComments(c).length,
          0,
          "publication failure must not publish a stop",
        );
        assert.deepEqual(c.host.state().issues[0]!.labels, ["in-progress"]);
        if (failure === "rejected push")
          assert.equal(
            await c.git(["rev-parse", `refs/heads/${branch}`]),
            approvedHead,
            "the rejected push left a reusable identical local branch",
          );
        assert.equal(
          await c.git([
            "for-each-ref",
            "--format=%(refname)",
            `refs/remotes/origin/${branch}`,
          ]),
          "",
        );
        await fs.unlink(blocker);
      }
      if (calls === 3) {
        assert.equal(
          feedback,
          undefined,
          "retry must advance rather than fail on the leftover branch",
        );
        assert.equal(request.worktree, c.worktree);
        assert.equal(
          await c.git(["rev-parse", `origin/${branch}`]),
          approvedHead,
        );
        assert.equal(kernelComments(c).length, 0);
      }
      const run = await launch(request, feedback);
      if (calls === 1)
        approvedHead = await c.git(["rev-parse", "HEAD"], request.worktree);
      return calls <= 2 ? { ...run, planningApproval: "no-pr" } : run;
    };
    assert.equal((await c.run({ issue: 9 }, { human })).status, "completed");
    assert.equal(human.feedback.length, 1);
    assert.equal(human.calls.includes("wait:gate"), false);
    assert.equal(
      kernelComments(c).length,
      1,
      "only implementation completion publishes a stop",
    );
    assert.equal(
      (await c.records()).result.sessions.length,
      4,
      "retry stays in the same Run attempt",
    );
  });
}

test("conflicting local implementation branch returns chat feedback without overwriting or pushing it", async (t) => {
  const c = await setupRun(t, [specification]);
  c.config.workflow.specApproval.required = true;
  await c.git(["branch", branch, "origin/main"]);
  const original = await c.git(["rev-parse", `refs/heads/${branch}`]);
  const human = fakeHuman(c, { quitPlanningAt: 2 });
  const launch = human.runPlanning.bind(human);
  let observation:
    | {
        feedback: string;
        comments: number;
        head: string;
        remote: string;
        specHead: string;
      }
    | undefined;
  human.runPlanning = async (request, feedback) => {
    if (feedback !== undefined) {
      observation = {
        feedback,
        comments: kernelComments(c).length,
        head: await c.git(["rev-parse", `refs/heads/${branch}`]),
        remote: await c.git([
          "for-each-ref",
          "--format=%(refname)",
          `refs/remotes/origin/${branch}`,
        ]),
        specHead: await c.git(["rev-parse", `origin/${specBranch}`]),
      };
    }
    return { ...(await launch(request, feedback)), planningApproval: "no-pr" };
  };
  assert.equal((await c.run({ issue: 9 }, { human })).status, "stopped");
  assert.ok(
    observation,
    "a branch conflict must return feedback before any stop is published",
  );
  assert.match(
    observation.feedback,
    /local implementation branch.*conflicts with the approved head/i,
  );
  assert.doesNotMatch(observation.feedback, /\n/);
  assert.equal(observation.comments, 0);
  assert.equal(observation.head, original);
  assert.equal(observation.remote, "");
  assert.notEqual(observation.specHead, original);
  assert.equal(await c.git(["rev-parse", `refs/heads/${branch}`]), original);
});
