import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  executeRunRecoveryMutation,
  RunRecoveryMutationError,
} from "./recovery-mutation.ts";
import { planRunRecovery } from "./recovery.ts";
import type { CommandRunner } from "../../../command/types.ts";

for (const intent of ["retry", "reset"] as const) {
  for (const boundary of intent === "reset"
    ? ["quarantine"]
    : ["quarantine", "staging", "published workspace"]) {
    for (const ignored of [true, false]) {
      test(`${ignored ? "late ignored writes pass at recovery boundaries" : "late ordinary writes preserve and stop recovery"}: ${intent}/${boundary}`, async (t) => {
        const root = await mkdtemp(join(tmpdir(), "patchmill-refresh-late-"));
        t.after(() => rm(root, { recursive: true, force: true }));
        const git = (...args: string[]) =>
          execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
        git("init", "-b", "main");
        git("config", "user.email", "test@example.com");
        git("config", "user.name", "Test");
        await writeFile(join(root, ".gitignore"), ".cache/\n");
        await writeFile(join(root, "file"), "old\n");
        git("add", ".");
        git("commit", "-m", "base");
        const oldOid = git("rev-parse", "HEAD");
        const branch = "agent/refresh";
        const expected = join(root, "expected");
        const quarantine = join(root, "quarantine with spaces");
        const staging = join(root, "staging");
        git("worktree", "add", "-b", branch, expected, oldOid);
        await mkdir(join(expected, ".cache"));
        const bytes = Buffer.from([0, 211, 255, 10]);
        await writeFile(join(expected, ".cache/original.bin"), bytes);
        if (intent === "retry") {
          await writeFile(join(root, "file"), "new\n");
          git("add", "file");
          git("commit", "-m", "new base");
        }
        const baseOid = git("rev-parse", "HEAD");
        let inject = false;
        let injectedPath = "";
        const runner: CommandRunner = {
          async run(command, args, options) {
            if (args.some((arg) => arg.startsWith("--ignored")))
              throw new Error("ignored status must not be read");
            if (inject && args.includes("status")) {
              const path = args[args.indexOf("-C") + 1]!;
              const wanted =
                boundary === "quarantine"
                  ? quarantine
                  : boundary === "staging"
                    ? staging
                    : expected;
              if (!injectedPath && path === wanted) {
                injectedPath = join(
                  path,
                  ignored ? ".cache/late.bin" : "late.txt",
                );
                await mkdir(join(injectedPath, ".."), { recursive: true });
                await writeFile(injectedPath, bytes);
              }
            }
            try {
              return {
                code: 0,
                stdout: execFileSync(command, args, {
                  cwd: options?.cwd ?? root,
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
          },
        };
        const decision = await planRunRecovery({
          intent,
          runner,
          repoRoot: root,
          runStatePath: "state",
          state: {
            issueNumber: 45,
            title: "Recover",
            status: "blocked",
            branch,
            worktreePath: expected,
            createdAt: "x",
            updatedAt: "x",
          },
          baseRef: "HEAD",
          expectedWorkspace: { branch, worktreePath: expected },
          leaseOwnerToken: "owner",
          snapshotRaw: "state",
          recoveryPaths: { quarantinePath: quarantine, stagingPath: staging },
        });
        assert.equal(
          decision.action,
          intent === "retry" ? "refresh-and-resume" : "archive-reset-and-start",
        );
        inject = true;
        const mutation = () =>
          executeRunRecoveryMutation({
            decision,
            repoRoot: root,
            runner,
            reassess: async () => decision,
          });
        if (ignored) {
          const result = await mutation();
          assert.deepEqual(result.quarantinePaths, [quarantine]);
          if (intent === "retry") {
            assert.equal(git("rev-parse", branch), baseOid);
            await assert.rejects(
              stat(join(expected, ".cache/original.bin")),
              /ENOENT/u,
            );
          } else assert.throws(() => git("rev-parse", "--verify", branch));
        } else {
          await assert.rejects(mutation, RunRecoveryMutationError);
          if (boundary === "quarantine")
            assert.equal(git("rev-parse", branch), oldOid);
        }
        const finalInjectedPath =
          ignored && boundary === "staging"
            ? join(expected, ".cache/late.bin")
            : injectedPath;
        assert.deepEqual(await readFile(finalInjectedPath), bytes);
        assert.deepEqual(
          await readFile(join(quarantine, ".cache/original.bin")),
          bytes,
        );
      });
    }
  }
}
