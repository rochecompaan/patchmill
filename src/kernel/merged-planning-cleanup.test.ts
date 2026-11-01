import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { dirname, join } from "node:path";
import test from "node:test";
import {
  setupRun,
  spec,
  plan,
  implement,
  mergePullRequest,
  kernelComments,
} from "../../test-support/run-once-fixture.ts";
import { fakeHuman } from "../../test-support/fake-human.ts";
import type { CommandRunner } from "../process/command.ts";

for (const mode of [
  "clean",
  "dirty spec",
  "remove failure",
  "branch only",
  "absent",
] as const) {
  test(`merged planning workspace cleanup: ${mode}`, async (t) => {
    const c = await setupRun(t, [implement]);
    await c.seed({ [spec]: "spec", [plan]: "plan" });
    const workspaces = [
      {
        branch: "agent/issue-9--spec",
        path: join(dirname(c.worktree), "agent-issue-9--spec"),
      },
      {
        branch: "agent/issue-9--plan",
        path: join(dirname(c.worktree), "agent-issue-9--plan"),
      },
    ];
    for (const workspace of workspaces) {
      if (mode === "absent") continue;
      if (mode === "branch only") await c.git(["branch", workspace.branch]);
      else
        await c.git([
          "worktree",
          "add",
          "-b",
          workspace.branch,
          workspace.path,
        ]);
    }
    const runner: CommandRunner = async (command, args, options) => {
      if (
        mode === "remove failure" &&
        args[1] === "remove" &&
        args[2] === workspaces[0]!.path
      )
        return { code: 1, stdout: "", stderr: "spec cleanup denied" };
      return c.deps.runner(command, args, options);
    };
    const human = fakeHuman(c, {
      onWait: async () => {
        await mergePullRequest(c);
        if (mode === "dirty spec")
          await fs.writeFile(join(workspaces[0]!.path, "dirty"), "keep");
        return "continue";
      },
    });
    assert.deepEqual(await c.run({ issue: 9 }, { human, runner }), {
      status: "completed",
      issue: 9,
    });
    assert.deepEqual(c.host.state().issues[0]!.labels, ["agent-done"]);
    assert.equal(kernelComments(c).length, 1);
    await assert.rejects(fs.access(c.worktree));
    for (const [index, workspace] of workspaces.entries()) {
      const kept =
        index === 0 && (mode === "dirty spec" || mode === "remove failure");
      if (kept) await fs.access(workspace.path);
      else await assert.rejects(fs.access(workspace.path));
      assert.equal(
        (
          await c.deps.runner(
            "git",
            [
              "show-ref",
              "--verify",
              "--quiet",
              `refs/heads/${workspace.branch}`,
            ],
            { cwd: c.repoRoot },
          )
        ).code,
        kept ? 0 : 1,
      );
    }
    const notifications = human.calls.filter((call) =>
      call.startsWith("notify:"),
    );
    if (mode === "dirty spec" || mode === "remove failure") {
      assert.equal(notifications.length, 1);
      assert.match(
        notifications[0]!,
        mode === "dirty spec"
          ? /Kept worktree .*uncommitted changes/
          : /spec cleanup denied/,
      );
    } else assert.deepEqual(notifications, []);
  });
}
