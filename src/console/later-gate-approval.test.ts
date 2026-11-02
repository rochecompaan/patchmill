import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import {
  setupRun,
  spec,
  plan,
  branch,
  implement,
  kernelComments,
} from "../../test-support/run-once-fixture.ts";
import { fakeHuman } from "../../test-support/fake-human.ts";
import { fakeExtensionApi } from "../../test-support/fake-extension-api.ts";
import { collectFacts } from "../kernel/facts.ts";
import type { PhaseLaunch } from "../kernel/launch.ts";
import { ConsoleController } from "./controller.ts";
import { registerConsoleTools } from "./tools.ts";

for (const approve of [false, true]) {
  test(`later plan ${approve ? "approval publishes the local head" : "decline and quit keeps the local head unapproved"} across restart`, async (t) => {
    const c = await setupRun(t, [implement]);
    c.config.workflow.specApproval.required = true;
    c.config.workflow.planApproval.required = true;
    await c.seed({ [spec]: "approved spec" });
    const pi = fakeExtensionApi();
    const controller = new ConsoleController({
      pi,
      startRun: async () => ({ status: "no-work" }),
      workers: { stopActive: async () => {} } as never,
    });
    registerConsoleTools(pi, () => controller);
    let ready!: (request: PhaseLaunch) => void;
    const requested = new Promise<PhaseLaunch>((resolve) => {
      ready = resolve;
    });
    const human = fakeHuman(c);
    human.runPlanning = (request, feedback) => {
      assert.equal(
        feedback,
        undefined,
        "a committed local gate should pass verification after approval",
      );
      const pending = controller.runPlanning(request);
      ready(request);
      return pending;
    };
    const implementPhase = human.runImplementation.bind(human);
    human.runImplementation = async (request) => {
      assert.equal(
        await c.git(["rev-parse", `origin/${branch}`]),
        approvedHead,
        "the kernel must publish the approved plan before implementation starts",
      );
      assert.equal(kernelComments(c).length, 0);
      return implementPhase(request);
    };
    const running = c.run({ issue: 9 }, { human });
    const request = await requested;
    assert.deepEqual(request.planningGate, {
      required: true,
      pullRequest: false,
    });
    await fs.mkdir(join(request.worktree, "docs/plans"), { recursive: true });
    await fs.writeFile(join(request.worktree, plan), "plan awaiting approval");
    await c.git(["add", plan], request.worktree);
    await c.git(["commit", "-m", "Plan awaiting approval"], request.worktree);
    const approvedHead = await c.git(["rev-parse", "HEAD"], request.worktree);
    const before = await c.git(["rev-parse", `origin/${branch}`]);
    assert.notEqual(before, approvedHead);
    await pi.callTool(
      "patchmill_submit_planning_result",
      {
        status: "done",
        summary: "Plan is ready",
        highlights: ["Persist votes", "Restore lock"],
      },
      { select: approve ? "Approve (continue now)" : "Request changes" },
    );
    if (!approve) {
      assert.equal(await c.git(["rev-parse", `origin/${branch}`]), before);
      assert.equal(kernelComments(c).length, 0);
      await controller.shutdown();
    }
    const outcome = await running;
    assert.equal(outcome.status, approve ? "completed" : "stopped");
    const restarted = await collectFacts(
      { ...c.deps, config: c.config },
      await c.host.viewIssue(9),
    );
    assert.equal(restarted.kind, "facts");
    if (restarted.kind === "facts") {
      assert.equal(restarted.facts.stage, approve ? "implementation" : "plan");
      assert.equal(restarted.facts.branch, branch);
      assert.equal(
        restarted.facts.planPath,
        plan,
        "the local plan remains available for revision",
      );
    }
    assert.equal(pi.confirmations.length, 0);
    assert.equal(pi.selections.length, 1);
    assert.deepEqual(pi.selections[0]!.options, [
      "Approve (continue now)",
      "Request changes",
    ]);
    assert.match(
      pi.selections[0]!.title,
      /A planning PR isn't offered: it would also carry the spec, which was approved without a PR/,
    );
  });
}
