import assert from "node:assert/strict";
import { readFile, stat, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { runLegacyOneIssue as runOneIssue } from "./pipeline-legacy.ts";
import {
  blockedRecoveryRunner,
  makeConfig,
  writeBlockedRecoveryRunState,
} from "../../../../test-support/run-once/pipeline-fixtures.ts";

const NOW = new Date("2026-09-06T12:00:00.000Z");

function isRecoveryMutationCommand(args: string[]): boolean {
  return (
    (args[0] === "worktree" && ["add", "move"].includes(args[1] ?? "")) ||
    args[0] === "update-ref" ||
    args[0] === "reset" ||
    args[0] === "clean"
  );
}

for (const scenario of [
  { name: "current", revList: "0\t0\n", log: "" },
  {
    name: "commit-bearing",
    revList: "3\t2\n",
    log: "def456 verify\nabc123 implement\n",
  },
]) {
  test(`blocked retry ${scenario.name} preserves ignored bytes through Pi`, async () => {
    const config = await makeConfig({
      dryRun: false,
      execute: true,
      issueNumber: 45,
    });
    await writeBlockedRecoveryRunState(config);
    const worktreeRoot = join(
      config.repoRoot,
      ".worktrees/patchmill-issue-45-recover-blocked-run",
    );
    const sentinels = new Map<string, Buffer>([
      [".superpowers/single-writer/progress.md", Buffer.from("step=review\n")],
      [
        ".superpowers/single-writer/oracle-review-ledger.json",
        Buffer.from('{"finding":"F-211"}\n'),
      ],
      [".pi/todos/issue-211-task.md", Buffer.from("# task\n")],
      [".cache/generated.bin", Buffer.from([0, 1, 2, 255])],
    ]);
    for (const [path, bytes] of sentinels) {
      await mkdir(join(worktreeRoot, path, ".."), { recursive: true });
      await writeFile(join(worktreeRoot, path), bytes);
    }
    const worktreeStat = await stat(worktreeRoot);
    const stats = new Map(
      await Promise.all(
        [...sentinels.keys()].map(
          async (path) => [path, await stat(join(worktreeRoot, path))] as const,
        ),
      ),
    );
    const timeline: string[] = [];
    const ignoredStatus = [...sentinels.keys()]
      .map((path) => `!! ${path}\n`)
      .join("");
    const runner = blockedRecoveryRunner(config, {
      revList: scenario.revList,
      log: scenario.log,
      ordinaryStatus: "",
      ignoredStatus,
      async onPi(_prompt, call) {
        assert.equal(call.cwd, worktreeRoot);
        const currentWorktreeStat = await stat(worktreeRoot);
        assert.equal(currentWorktreeStat.dev, worktreeStat.dev);
        assert.equal(currentWorktreeStat.ino, worktreeStat.ino);
        for (const [path, expected] of sentinels) {
          assert.deepEqual(await readFile(join(worktreeRoot, path)), expected);
          const before = stats.get(path)!;
          const after = await stat(join(worktreeRoot, path));
          assert.equal(after.dev, before.dev);
          assert.equal(after.ino, before.ino);
        }
        timeline.push("pi");
        return {
          code: 0,
          stdout: JSON.stringify({
            status: "pr-created",
            prUrl: "https://forgejo/pr/45",
            branch: "agent/issue-45-recover-blocked-run",
            commits: ["abc123"],
            validation: ["verification passed"],
            reviewSummary: "reviewed",
          }),
          stderr: "",
        };
      },
    });
    const result = await runOneIssue(runner, config, {
      now: NOW,
      progress: {
        event: async (event) => {
          if (event.stage === "recovery") timeline.push(event.message);
        },
      },
    });
    assert.equal(result.status, "pr-created", JSON.stringify(result));
    assert.ok(
      timeline[0]?.includes(
        "resuming in place without workspace mutation; preserving ignored entries",
      ),
    );
    assert.equal(timeline.at(-1), "pi");
    assert.deepEqual(
      runner.calls
        .filter((call) => call.command === "git")
        .filter((call) => isRecoveryMutationCommand(call.args)),
      [],
    );
  });
}
