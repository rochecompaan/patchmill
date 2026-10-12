import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
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

for (const blockedAfterRefresh of [false, true]) {
  test(`refresh preserves ignored bytes and reports quarantine: blocked=${blockedAfterRefresh}`, async () => {
    const config = await makeConfig({
      dryRun: false,
      execute: true,
      issueNumber: 45,
      baseRef: "HEAD",
    });
    const git = (...args: string[]) =>
      execFileSync("git", args, {
        cwd: config.repoRoot,
        encoding: "utf8",
      }).trim();
    git("init", "-b", "main");
    git("config", "user.name", "Test");
    git("config", "user.email", "test@example.invalid");
    await writeFile(
      join(config.repoRoot, ".gitignore"),
      ".patchmill/\n.worktrees/\n.cache/\n.pi/\n",
    );
    await writeFile(join(config.repoRoot, "base"), "old\n");
    git("add", ".gitignore", "base");
    git("commit", "-m", "base");
    const worktreePath = ".worktrees/patchmill-issue-45-recover-blocked-run";
    const branch = "agent/issue-45-recover-blocked-run";
    git("worktree", "add", "-b", branch, worktreePath, "HEAD");
    await mkdir(join(config.repoRoot, worktreePath, ".cache"));
    const bytes = Buffer.from([0, 1, 211, 255]);
    await writeFile(
      join(config.repoRoot, worktreePath, ".cache/cache.bin"),
      bytes,
    );
    await writeFile(join(config.repoRoot, "base"), "new\n");
    git("add", "base");
    git("commit", "-m", "advance base");
    const baseOid = git("rev-parse", "HEAD");
    git("update-ref", "refs/remotes/origin/main", baseOid);
    await writeBlockedRecoveryRunState(config);
    const mock = blockedRecoveryRunner(config, {
      onPi: async () => ({
        code: 0,
        stderr: "",
        stdout: JSON.stringify(
          blockedAfterRefresh
            ? {
                status: "blocked",
                reason: "Review needed",
                questions: [
                  { question: "Approve?", recommendedAnswer: "Review first" },
                ],
                commits: [],
                validation: [],
              }
            : {
                status: "pr-created",
                prUrl: "https://forgejo/pr/45",
                branch,
                commits: ["abc123"],
                validation: ["passed"],
                reviewSummary: "reviewed",
              },
        ),
      }),
    });
    const runner = {
      async run(command: string, args: string[], options?: { cwd?: string }) {
        if (
          command === "git" &&
          (args.includes("--no-optional-locks") ||
            [
              "worktree",
              "update-ref",
              "symbolic-ref",
              "rev-list",
              "log",
            ].includes(args[0] ?? "") ||
            (args[0] === "rev-parse" &&
              args[1] === "--verify" &&
              !args.at(-1)?.startsWith("refs/heads/")))
        ) {
          try {
            return {
              code: 0,
              stdout: execFileSync(command, args, {
                cwd: options?.cwd ?? config.repoRoot,
                encoding: "utf8",
              }),
              stderr: "",
            };
          } catch (error) {
            const e = error as {
              status: number;
              stdout: string;
              stderr: string;
            };
            return { code: e.status, stdout: e.stdout, stderr: e.stderr };
          }
        }
        return mock.run(command, args, options);
      },
    };
    const progressPaths: string[][] = [];
    const result = await runOneIssue(runner, config, {
      now: NOW,
      progress: {
        event: async (event) => {
          if (event.stage === "recovery") {
            const data = event.data as { quarantinePaths: string[] };
            progressPaths.push(data.quarantinePaths);
            assert.ok(event.message.includes(data.quarantinePaths[0]!));
          }
        },
      },
    });
    assert.equal(
      result.status,
      blockedAfterRefresh ? "blocked" : "pr-created",
      JSON.stringify(result),
    );
    assert.equal(result.quarantinePaths?.length, 1);
    assert.deepEqual(progressPaths, [result.quarantinePaths]);
    assert.deepEqual(
      await readFile(
        join(config.repoRoot, result.quarantinePaths![0]!, ".cache/cache.bin"),
      ),
      bytes,
    );
    assert.equal(git("rev-parse", branch), baseOid);
    await assert.rejects(
      stat(join(config.repoRoot, worktreePath, ".cache/cache.bin")),
      /ENOENT/u,
    );
  });
}

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
    const runner = blockedRecoveryRunner(config, {
      revList: scenario.revList,
      log: scenario.log,
      ordinaryStatus: "",
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
    assert.ok(timeline[0]?.includes("will resume"));
    assert.equal(timeline.at(-1), "pi");
    assert.deepEqual(
      runner.calls
        .filter((call) => call.command === "git")
        .filter((call) => isRecoveryMutationCommand(call.args)),
      [],
    );
  });
}
