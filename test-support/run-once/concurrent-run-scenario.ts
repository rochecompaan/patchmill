import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { makeConfig, approvalPolicy } from "./pipeline-fixtures.ts";
import { writeFixtureRunState } from "./run-state-fixture.ts";
import {
  buildIssueBranchName,
  buildIssueWorktreePath,
} from "../../src/cli/commands/run-once/git.ts";
import { createCommandRunner } from "../../src/cli/commands/triage/command.ts";
import {
  createConcurrentHost,
  type ConcurrentPull,
} from "./concurrent-host-fixture.ts";

export type AgentBarrier = {
  issueNumber: number;
  cwd: string;
  branch: string;
  session: string;
};
type Message = { id?: number; kind: string; data: unknown };
export async function createConcurrentScenario(
  kinds: Array<"planning" | "legacy">,
) {
  const config = await makeConfig({
    dryRun: false,
    execute: true,
    host: { provider: "github-gh", login: "" },
    approvalPolicy: approvalPolicy({
      specRequired: false,
      planRequired: false,
    }),
  });
  const host = createConcurrentHost(kinds);
  const native = createCommandRunner();
  const git = async (cwd: string, ...args: string[]) => {
    const result = await native.run("git", args, { cwd });
    assert.equal(result.code, 0, result.stderr);
    return result.stdout.trim();
  };
  const root = config.repoRoot,
    remote = join(root, "remote.git"),
    configPath = join(root, "fixture.json");
  await git(root, "init", "-q", "-b", "main");
  await git(root, "config", "user.name", "Test");
  await git(root, "config", "user.email", "test@example.test");
  await writeFile(
    join(root, ".gitignore"),
    ".patchmill/\n.pi/\n.worktrees/\nremote.git/\nfixture.json\n",
  );
  for (const [index, selected] of host.issues.entries())
    if (kinds[index] === "legacy")
      await writeFile(
        join(config.plansDir, `issue-${selected.number}.md`),
        "# Plan\n",
      );
  await git(root, "add", ".gitignore");
  if (kinds.includes("legacy")) await git(root, "add", "docs");
  await git(root, "commit", "-m", "base");
  const baseOid = await git(root, "rev-parse", "HEAD");
  await git(root, "clone", "--bare", root, remote);
  await git(root, "remote", "add", "origin", remote);
  await git(root, "fetch", "origin");
  for (const [index, kind] of kinds.entries()) {
    if (kind !== "legacy") continue;
    const selected = host.issues[index]!;
    const branch = buildIssueBranchName(
      selected.number,
      selected.title,
      config,
    );
    const worktreePath = buildIssueWorktreePath(
      selected.number,
      selected.title,
      { ...config, worktreeDir: ".worktrees" },
    );
    await git(
      root,
      "worktree",
      "add",
      "-b",
      branch,
      resolve(root, worktreePath),
      baseOid,
    );
    await writeFixtureRunState(config.runStateDir, {
      issueNumber: selected.number,
      title: selected.title,
      status: "implementing",
      branch,
      worktreePath,
      planPath: `docs/plans/issue-${selected.number}.md`,
      planCommit: baseOid,
      checkpoints: {
        claimed: true,
        startedCommentPosted: true,
        worktreeReady: true,
      },
    });
  }
  await writeFile(configPath, JSON.stringify(config));
  const agents: AgentBarrier[] = [],
    mutations: number[] = [],
    children: Array<ReturnType<typeof start>> = [];
  function start(
    issueNumber: number,
    mode: "explicit" | "automatic" | "dry" = "explicit",
    command = "run",
  ) {
    const child = spawn(
      process.execPath,
      [
        new URL("./concurrent-run-process.ts", import.meta.url).pathname,
        configPath,
        String(issueNumber),
        mode,
        command,
      ],
      { cwd: root, stdio: ["ignore", "pipe", "pipe", "ipc"] },
    );
    let stdout = "",
      stderr = "",
      terminal: { code: number; error?: string } | undefined;
    let barrier: AgentBarrier | { issueNumber: number } | undefined,
      barrierId: number | undefined;
    let entered!: () => void,
      finished!: () => void,
      transactionStarted!: () => void;
    const enteredPromise = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const terminalPromise = new Promise<void>((resolve) => {
      finished = resolve;
    });
    const transactionPromise = new Promise<void>((resolve) => {
      transactionStarted = resolve;
    });
    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("message", (message: Message) => {
      const respond = (value: unknown) => child.send({ id: message.id, value });
      const handle = async () => {
        if (message.kind === "terminal") {
          terminal = message.data as typeof terminal;
          finished();
          return;
        }
        if (message.kind === "agent") {
          barrier = message.data as AgentBarrier;
          agents.push(barrier);
          barrierId = message.id;
          entered();
          return;
        }
        if (message.kind === "agent-unblocked") {
          respond(null);
          return;
        }
        if (message.kind === "transaction-started") {
          transactionStarted();
          respond(null);
          return;
        }
        if (message.kind === "git-barrier") {
          barrier = message.data as { issueNumber: number };
          mutations.push(barrier.issueNumber);
          barrierId = message.id;
          entered();
          return;
        }
        if (message.kind === "host") {
          respond(await host.run(message.data as string[]));
          return;
        }
        if (message.kind === "push") {
          const value = message.data as { branch: string; headOid: string };
          host.pushed(value.branch, value.headOid);
          respond(null);
          return;
        }
        if (message.kind === "publish") {
          respond(host.publish(message.data as Omit<ConcurrentPull, "number">));
          return;
        }
        throw new Error(`unexpected IPC message: ${message.kind}`);
      };
      void handle().catch((error) =>
        child.send({ id: message.id, error: String(error) }),
      );
    });
    child.on("exit", () => {
      if (!terminal) {
        terminal = {
          code: 1,
          error: `child exited without terminal receipt: ${stderr}`,
        };
        finished();
      }
    });
    const bounded = async <T>(action: Promise<T>) => {
      let timer: NodeJS.Timeout | undefined;
      try {
        return await Promise.race([
          action,
          new Promise<never>((_resolve, reject) => {
            timer = setTimeout(
              () => reject(new Error(`fixture timeout: ${stderr}`)),
              45_000,
            );
          }),
        ]);
      } catch (error) {
        await writeFile(
          `/tmp/patchmill-concurrent-${child.pid}.json`,
          JSON.stringify({ stdout, stderr, root, barrier, terminal }, null, 2),
        );
        throw error;
      } finally {
        clearTimeout(timer);
      }
    };
    const result = {
      child,
      waitForTransactionStart: () => bounded(transactionPromise),
      waitForBarrier: () =>
        bounded(
          Promise.race([
            enteredPromise.then(() => barrier!),
            terminalPromise.then(() => {
              throw new Error(
                `terminated before agent barrier: ${JSON.stringify(terminal)} ${stdout} ${stderr}`,
              );
            }),
          ]),
        ),
      release() {
        assert.ok(barrierId);
        child.send({ id: barrierId, value: null });
      },
      async finish() {
        await bounded(terminalPromise);
        if (child.exitCode === null && child.signalCode === null)
          await bounded(once(child, "exit"));
        const output = stdout.trim()
          ? (JSON.parse(stdout.trim()) as Record<string, unknown>)
          : {};
        return { ...terminal!, output, stderr };
      },
      async kill() {
        if (child.exitCode === null && child.signalCode === null) {
          const exited = once(child, "exit");
          child.kill("SIGKILL");
          await bounded(exited);
        }
      },
    };
    children.push(result);
    return result;
  }
  return {
    root,
    remote,
    baseOid,
    config,
    host,
    agents,
    mutations,
    start,
    git: (...args: string[]) => git(root, ...args),
    remoteGit: (...args: string[]) => git(remote, ...args),
    async noGitGuard() {
      await assert.rejects(
        readFile(join(root, ".git", "patchmill", "run-once", "mutation.lock")),
        { code: "ENOENT" },
      );
    },
    async snapshot(issueNumber: number) {
      const state = await readFile(
        join(config.runStateDir, `issue-${issueNumber}.json`),
        "utf8",
      ).catch((error: NodeJS.ErrnoException) => {
        if (error.code !== "ENOENT") throw error;
        return undefined;
      });
      const planning = await readFile(
        join(
          config.runStateDir,
          "planning-pr-v1",
          "issues",
          `issue-${issueNumber}.json`,
        ),
        "utf8",
      ).catch((error: NodeJS.ErrnoException) => {
        if (error.code !== "ENOENT") throw error;
        return undefined;
      });
      return {
        state,
        planning,
        issue: structuredClone(
          host.issues.find((item) => item.number === issueNumber),
        ),
        effects: host.effects.filter(
          (item) => item.issueNumber === issueNumber,
        ),
        refs: await git(
          root,
          "for-each-ref",
          "--format=%(refname) %(objectname)",
          "refs/heads",
        ),
      };
    },
    async logs() {
      return (await readdir(config.runStateDir, { recursive: true })).filter(
        (name) => /(?:^|\/)run-[^/]+\.jsonl$/u.test(name),
      );
    },
    async merge(pull: ConcurrentPull, expectedBase?: string) {
      const old =
        expectedBase ?? (await git(remote, "rev-parse", "refs/heads/main"));
      const tree = await git(
        remote,
        "merge-tree",
        "--write-tree",
        old,
        pull.headOid,
      );
      const oid = await git(
        remote,
        "-c",
        "user.name=Host",
        "-c",
        "user.email=host@example.test",
        "commit-tree",
        tree,
        "-p",
        old,
        "-p",
        pull.headOid,
        "-m",
        "Merge PR",
      );
      const result = await native.run(
        "git",
        ["update-ref", "refs/heads/main", oid, old],
        { cwd: remote },
      );
      if (result.code !== 0) return false;
      pull.mergeOid = oid;
      host.issues.find((item) => item.number === pull.issueNumber)!.state =
        "closed";
      return true;
    },
    async cleanup() {
      await Promise.all(children.map((child) => child.kill()));
      await rm(root, { recursive: true, force: true });
    },
  };
}
