import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import {
  setupRun,
  spec,
  plan,
  implement,
  branch,
  mergePullRequest,
  kernelComments,
} from "../../test-support/run-once-fixture.ts";
import { fakeHuman } from "../../test-support/fake-human.ts";
import type { CommandRunner } from "../process/command.ts";

test("interactive merge runs a non-executable Bash hook before removing the worktree", async (t) => {
  const c = await setupRun(t, [implement]);
  const marker = join(c.dir, "hook-marker");
  await c.seed({
    [spec]: "spec",
    [plan]: "plan",
    "cleanup hook.sh": `pwd > ${JSON.stringify(marker)}\n`,
  });
  c.config.cleanupHook = "./cleanup hook.sh";
  const human = fakeHuman(c, {
    onWait: async () => {
      await mergePullRequest(c, branch, { closeIssue: true });
      return "continue";
    },
  });
  assert.equal((await c.run({ issue: 9 }, { human })).status, "completed");
  assert.equal((await fs.readFile(marker, "utf8")).trim(), c.worktree);
  await assert.rejects(fs.access(c.worktree));
});

for (const mode of [
  "clean",
  "dirty",
  "status failure",
  "remove failure",
  "branch failure",
] as const) {
  test(`confirmed interactive merge cleanup: ${mode}`, async (t) => {
    const c = await setupRun(t, [implement]);
    await c.seed({ [spec]: "spec", [plan]: "plan" });
    const commands: { args: string[]; cwd: string | undefined }[] = [];
    const runner: CommandRunner = async (command, args, options) => {
      assert.equal(command, "git");
      commands.push({ args, cwd: options?.cwd });
      if (
        (mode === "status failure" && args[0] === "status") ||
        (mode === "remove failure" && args[1] === "remove") ||
        (mode === "branch failure" && args[0] === "branch")
      )
        return { code: 1, stdout: "", stderr: "cleanup denied" };
      return c.deps.runner(command, args, options);
    };
    const human = fakeHuman(c, {
      onWait: async () => {
        await mergePullRequest(c, branch, { closeIssue: true });
        if (mode === "dirty")
          await fs.writeFile(join(c.worktree, "uncommitted.txt"), "keep me");
        return "continue";
      },
    });
    const outcome = await c.run({ issue: 9 }, { human, runner });
    assert.deepEqual(outcome, { status: "completed", issue: 9 });
    assert.deepEqual(c.host.state().issues[0]!.labels, ["agent-done"]);
    assert.equal(kernelComments(c).length, 1);
    assert.deepEqual(
      commands.filter(
        ({ args }) => args[1] === "remove" || args[0] === "branch",
      ),
      [
        ...(["clean", "remove failure", "branch failure"].includes(mode)
          ? [{ args: ["worktree", "remove", c.worktree], cwd: c.repoRoot }]
          : []),
        ...(["clean", "branch failure"].includes(mode)
          ? [{ args: ["branch", "-D", branch], cwd: c.repoRoot }]
          : []),
      ],
    );
    if (mode === "clean") {
      await assert.rejects(fs.access(c.worktree));
      assert.equal(
        (
          await c.deps.runner(
            "git",
            ["show-ref", "--verify", "--quiet", `refs/heads/${branch}`],
            { cwd: c.repoRoot },
          )
        ).code,
        1,
      );
      assert.deepEqual(
        human.calls.filter((s) => s.startsWith("notify:")),
        [],
      );
    } else {
      assert.match(
        c.output.join("\n"),
        mode === "dirty"
          ? /Kept worktree .*uncommitted changes/
          : /cleanup denied/,
      );
      if (mode !== "branch failure") await fs.access(c.worktree);
      assert.equal(
        (
          await c.deps.runner(
            "git",
            ["show-ref", "--verify", "--quiet", `refs/heads/${branch}`],
            { cwd: c.repoRoot },
          )
        ).code,
        0,
      );
    }
    // The remote issue branch is never deleted, including after successful cleanup.
    assert.match(
      await c.git(["ls-remote", "--heads", "origin", branch]),
      new RegExp(branch),
    );
  });
}

for (const ending of ["agent-done", "non-interactive merged"] as const) {
  test(`${ending} leaves the worktree and branch alone`, async (t) => {
    const c = await setupRun(t, [implement]);
    await c.seed({ [spec]: "spec", [plan]: "plan" });
    const commands: string[][] = [];
    const runner: CommandRunner = async (command, args, options) => {
      commands.push(args);
      return c.deps.runner(command, args, options);
    };
    assert.equal(
      (
        await c.run(
          { issue: 9 },
          {
            runner,
            ...(ending === "agent-done" ? { human: fakeHuman(c) } : {}),
          },
        )
      ).status,
      "completed",
    );
    if (ending === "non-interactive merged") {
      await mergePullRequest(c);
      assert.equal((await c.run({ issue: 9 }, { runner })).status, "completed");
    }
    assert.deepEqual(commands, []);
    await fs.access(c.worktree);
    assert.equal(
      (
        await c.deps.runner(
          "git",
          ["show-ref", "--verify", "--quiet", `refs/heads/${branch}`],
          { cwd: c.repoRoot },
        )
      ).code,
      0,
    );
  });
}
