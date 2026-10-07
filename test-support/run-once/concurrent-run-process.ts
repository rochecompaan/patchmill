import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  main,
  type loadCliConfig,
} from "../../src/cli/commands/run-once/main.ts";
import { createCommandRunner } from "../../src/cli/commands/triage/command.ts";
import type { CommandRunner } from "../../src/command/types.ts";
import { promptPath } from "./mock-runner.ts";
import {
  resolveRunOnceRepositoryNamespace,
  withRunRecoveryAdmission,
} from "../../src/cli/commands/run-once/repository-admission.ts";
import { withIssueRunLease } from "../../src/cli/commands/run-once/recovery-lease.ts";
import { withRepositoryMutation } from "../../src/git/repository-mutation.ts";

const pending = new Map<
  number,
  { resolve: (value: unknown) => void; reject: (error: Error) => void }
>();
let next = 0;
function request(kind: string, data: unknown): Promise<unknown> {
  const id = ++next;
  const result = new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
  });
  process.send!({ id, kind, data });
  return result;
}
process.on(
  "message",
  (message: { id: number; value?: unknown; error?: string }) => {
    const item = pending.get(message.id);
    if (!item) return;
    pending.delete(message.id);
    if (message.error) item.reject(new Error(message.error));
    else item.resolve(message.value);
  },
);
const [file, number, mode = "explicit", command = "run"] =
  process.argv.slice(2);
const saved = JSON.parse(await readFile(file!, "utf8")) as Awaited<
  ReturnType<typeof loadCliConfig>
>;
const issueNumber = Number(number);
const { issueNumber: _savedIssue, ...shared } = saved;
const config = {
  ...shared,
  ...(mode === "automatic" ? {} : { issueNumber }),
  dryRun: mode === "dry",
  quiet: true,
  showHelp: false,
};
const native = createCommandRunner();
const git = async (cwd: string, ...args: string[]) => {
  const result = await native.run("git", args, { cwd });
  if (result.code !== 0) throw new Error(result.stderr);
  return result.stdout.trim();
};
let agentEntered = false;
const runner: CommandRunner = {
  supportsOwnedGit: true,
  async run(executable, args, options = {}) {
    if (executable === "gh")
      return (await request("host", args)) as Awaited<
        ReturnType<CommandRunner["run"]>
      >;
    if (executable === "git") {
      if (
        args[0] === "push" &&
        (args.includes("--force") ||
          args.at(-1)?.endsWith(":main") ||
          args.at(-1) === "main")
      )
        throw new Error("agent target publication is forbidden");
      const result = await native.run("git", args, {
        ...options,
        cwd: options.cwd ?? config.repoRoot,
      });
      if (args[0] === "remote" && args[1] === "get-url")
        return {
          ...result,
          stdout: "https://github.test/acme/patchmill.git\n",
        };
      if (result.code === 0 && args[0] === "push") {
        const branch = (args.at(-1) ?? "")
          .split(":")
          .at(-1)!
          .replace(/^refs\/heads\//u, "");
        const headOid = await git(
          options.cwd ?? config.repoRoot,
          "rev-parse",
          `refs/heads/${branch}`,
        );
        await request("push", { branch, headOid });
      }
      return result;
    }
    if (executable === process.execPath) {
      const values = args.slice(1);
      const cwd = options.cwd!;
      const prompt = await readFile(promptPath(values), "utf8");
      const branch = await git(cwd, "branch", "--show-current");
      const session = values[values.indexOf("--session") + 1];
      await request(agentEntered ? "agent-unblocked" : "agent", {
        issueNumber,
        cwd,
        branch,
        session,
      });
      agentEntered = true;
      const artifact = /"(?:specPath|planPath)"\s*:\s*"([^"]+)"/u.exec(
        prompt,
      )?.[1];
      const path = artifact ?? `change-${issueNumber}.txt`;
      await mkdir(dirname(join(cwd, path)), { recursive: true });
      await writeFile(
        join(cwd, path),
        artifact ? "# artifact\n" : `issue ${issueNumber}\n`,
      );
      await git(cwd, "add", path);
      await git(cwd, "commit", "-m", `issue ${issueNumber}`);
      const headOid = await git(cwd, "rev-parse", "HEAD");
      if (artifact)
        return {
          code: 0,
          stdout: JSON.stringify({
            status: path.includes("specs") ? "spec-created" : "plan-created",
            ...(path.includes("specs")
              ? { specPath: path }
              : { planPath: path }),
            commit: headOid,
          }),
          stderr: "",
        };
      await git(cwd, "push", "origin", `HEAD:${branch}`);
      const prUrl = await request("publish", {
        issueNumber,
        branch,
        headOid,
        body: `Closes #${issueNumber}\n<!-- patchmill:planning-pr-v1 issue=${issueNumber} phase=implementation -->`,
      });
      return {
        code: 0,
        stdout: JSON.stringify({
          status: "pr-created",
          prUrl,
          branch,
          commits: [headOid],
          validation: ["controlled fixture"],
        }),
        stderr: "",
      };
    }
    throw new Error(`unexpected command ${executable} ${args.join(" ")}`);
  },
};
try {
  if (command === "transaction") {
    const namespace = await resolveRunOnceRepositoryNamespace(runner, config);
    await request("transaction-started", { issueNumber });
    await withRunRecoveryAdmission(runner, config, issueNumber, (admission) =>
      withIssueRunLease(
        { runStateDir: config.runStateDir, issueNumber },
        (lease) =>
          withRepositoryMutation(
            {
              namespace,
              attemptId: admission.attemptId,
              runner,
              assertOwned: async () => {
                const current = await readFile(lease.path, "utf8");
                if (JSON.parse(current).ownerToken !== lease.record.ownerToken)
                  throw new Error("ownership changed");
              },
            },
            async (transaction) => {
              await request("git-barrier", { issueNumber });
              const base = await git(config.repoRoot, "rev-parse", "HEAD");
              const result = await transaction.run([
                "update-ref",
                `refs/heads/recovery-${issueNumber}`,
                base,
                "0".repeat(40),
              ]);
              if (result.code !== 0) throw new Error(result.stderr);
            },
          ),
      ),
    );
    process.send!({ kind: "terminal", data: { code: 0 } });
  } else {
    const code = await main(
      mode === "automatic"
        ? []
        : [
            "--issue",
            String(issueNumber),
            ...(mode === "dry" ? ["--dry-run"] : []),
          ],
      { loadConfig: async () => config, createRunner: () => runner },
    );
    process.send!({ kind: "terminal", data: { code } });
  }
} catch (error) {
  process.send!({ kind: "terminal", data: { code: 1, error: String(error) } });
}
process.disconnect();
