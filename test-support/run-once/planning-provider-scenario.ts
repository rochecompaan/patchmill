import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  PlanningStateStore,
  type PlanningStateV1,
} from "../../src/workflow/planning-state-store.ts";
import { approvalPolicy, makeConfig } from "./pipeline-fixtures.ts";
import {
  issue,
  issueListPayload,
  issueViewPayload,
  labelListPayload,
} from "./issue-fixtures.ts";
import { promptPath } from "./mock-runner.ts";
import { runOneIssue } from "../../src/cli/commands/run-once/pipeline.ts";
import type { AgentIssuePipelineResult } from "../../src/cli/commands/run-once/types.ts";
import { githubPullPayload } from "./planning-github-process-fixture.ts";
import { forgejoPullPayload } from "./planning-forgejo-process-fixture.ts";

const run = promisify(execFile);
const now = new Date("2099-01-01T00:00:00.000Z");

async function git(cwd: string, args: string[]) {
  try {
    const result = await run("git", args, { cwd, encoding: "utf8" });
    return { code: 0, stdout: result.stdout, stderr: result.stderr };
  } catch (error) {
    const failure = error as {
      code?: number;
      stdout?: string;
      stderr?: string;
    };
    return {
      code: failure.code ?? 1,
      stdout: failure.stdout ?? "",
      stderr: failure.stderr ?? "",
    };
  }
}

function repository() {
  return {
    name: "patchmill",
    full_name: "acme/patchmill",
    owner: { login: "acme" },
    html_url: "https://forge.test/acme/patchmill",
  };
}

type Pull = {
  number: number;
  branch: string;
  body: string;
  headOid: string;
  merged?: boolean;
  mergeOid?: string;
};

export type PlanningScenarioProvider = "github-gh" | "forgejo-tea";
export type PlanningScenarioGates = Readonly<{
  specRequired: boolean;
  planRequired: boolean;
}>;
export type PlanningScenarioFailurePoint =
  | "after-phase-push"
  | "after-planning-pull-request-create"
  | "after-worktree-remove"
  | "after-local-branch-remove"
  | "after-planning-merge-observation"
  | "after-implementation-pull-request-validation"
  | "after-handoff-comment"
  | "after-cleanup-hook"
  | "after-implementation-worktree-remove"
  | "after-done-label";
export type RecordedScenarioPullRequest = Readonly<{
  number: number;
  phase: "spec" | "plan" | "implementation";
  targetRepository: string;
  headRepository: string;
  baseBranch: string;
  headBranch: string;
  headOid: string;
  body: string;
  status: "open" | "merged" | "closed-unmerged";
  mergeOid?: string;
}>;
export type PlanningProviderScenario = {
  run(options?: { planOnly?: boolean }): Promise<AgentIssuePipelineResult>;
  state(): Promise<PlanningStateV1 | undefined>;
  pulls(): readonly RecordedScenarioPullRequest[];
  effects(): readonly string[];
  mergeOpenPlanningPull(input?: {
    editArtifact?: (content: string) => string;
  }): Promise<void>;
  closeOpenPlanningPull(): void;
  removeSavedPlanningPull(): void;
  duplicateOpenPlanningPull(): void;
  failNextHostRead(): void;
  interruptAt(point: PlanningScenarioFailurePoint): void;
  restorePersistence(): Promise<void>;
  archiveExactStaleLock(): Promise<{
    fingerprint: string;
    archivePath: string;
  }>;
  cleanup(): Promise<void>;
};

export async function createPlanningProviderScenario(input: {
  provider: PlanningScenarioProvider;
  gates: PlanningScenarioGates;
}): Promise<PlanningProviderScenario> {
  const { provider, gates } = input;
  const invalidImplementation = false;
  const config = await makeConfig({
    dryRun: false,
    execute: true,
    allowDirectLand: true,
    approvalPolicy: approvalPolicy(gates),
    host: { provider, login: "" },
  });
  // The public facade owns a real remote/base/worktree lifecycle; only Forgejo
  // and Pi are recorded at their process boundary.
  const remote = join(config.repoRoot, "remote.git");
  await mkdir(config.worktreeDir, { recursive: true });
  await git(config.repoRoot, ["init", "--initial-branch=main"]);
  await git(config.repoRoot, ["config", "user.email", "test@example.test"]);
  await git(config.repoRoot, ["config", "user.name", "Test"]);
  await writeFile(join(config.repoRoot, "README.md"), "# test\n", "utf8");
  await writeFile(join(config.specsDir, ".gitkeep"), "", "utf8");
  await writeFile(join(config.plansDir, ".gitkeep"), "", "utf8");
  await git(config.repoRoot, ["add", "README.md", "docs"]);
  await git(config.repoRoot, ["commit", "-m", "initial"]);
  await git(config.repoRoot, ["init", "--bare", remote]);
  await git(config.repoRoot, ["remote", "add", "origin", remote]);
  await git(config.repoRoot, ["push", "-u", "origin", "main"]);
  const selected = issue(190, ["agent-ready"], "Provider scenario");
  const pulls: Pull[] = [];
  let nextPull = 1;
  const calls: Array<{ command: string; args: string[]; cwd?: string }> = [];
  const runner = {
    calls,
    async run(command: string, args: string[], options: { cwd?: string } = {}) {
      const call =
        command === process.execPath
          ? { command: "pi", args: args.slice(1), cwd: options.cwd }
          : { command, args, cwd: options.cwd };
      calls.push(call);
      if (call.command === "git") {
        if (call.args[0] === "remote" && call.args[1] === "get-url")
          return {
            code: 0,
            stdout: `https://${provider === "github-gh" ? "github.test" : "forge.test"}/acme/patchmill.git\n`,
            stderr: "",
          };
        const result = await git(call.cwd ?? config.repoRoot, call.args);
        if (
          call.args[0] === "worktree" &&
          call.args[1] === "add" &&
          result.code !== 0
        )
          throw new Error(result.stderr);
        return result;
      }
      if (call.command === "pi") {
        const prompt = await readFile(promptPath(call.args), "utf8");
        const path = /"(?:specPath|planPath)"\s*:\s*"([^"]+)"/u.exec(
          prompt,
        )?.[1];
        if (path) {
          await mkdir(dirname(join(call.cwd!, path)), { recursive: true });
          await writeFile(join(call.cwd!, path), "# artifact\n", "utf8");
          await git(call.cwd!, ["add", path]);
          await git(call.cwd!, ["commit", "-m", "planning artifact"]);
          const commit = await git(call.cwd!, ["rev-parse", "HEAD"]);
          return {
            code: 0,
            stdout: JSON.stringify({
              status: path.includes("specs") ? "spec-created" : "plan-created",
              ...(path.includes("specs")
                ? { specPath: path }
                : { planPath: path }),
              commit: commit.stdout.trim(),
            }),
            stderr: "",
          };
        }
        await writeFile(
          join(call.cwd!, "implementation.txt"),
          "implemented\n",
          "utf8",
        );
        await git(call.cwd!, ["add", "implementation.txt"]);
        await git(call.cwd!, ["commit", "-m", "implementation"]);
        const branch = (
          await git(call.cwd!, ["branch", "--show-current"])
        ).stdout.trim();
        const headOid = (
          await git(call.cwd!, ["rev-parse", "HEAD"])
        ).stdout.trim();
        await git(call.cwd!, ["push", "origin", `HEAD:${branch}`]);
        pulls.push({
          number: 99,
          branch,
          headOid,
          body: invalidImplementation
            ? "Closes #189"
            : "Closes #190\n\n<!-- patchmill:planning-pr-v1 issue=190 phase=implementation -->",
        });
        return {
          code: 0,
          stdout: JSON.stringify({
            status: "pr-created",
            prUrl: `https://${provider === "github-gh" ? "github.test/acme/patchmill/pull" : "forge.test/acme/patchmill/pulls"}/99`,
            branch,
            commits: [headOid],
            validation: ["npm test"],
          }),
          stderr: "",
        };
      }
      if (call.command === "gh") {
        const githubIssue = {
          number: selected.number,
          title: selected.title,
          body: selected.body,
          state: selected.state,
          labels: selected.labels.map((name) => ({ name })),
          author: { login: selected.author },
          updatedAt: selected.updated,
          comments: selected.comments,
          url: "https://github.test/acme/patchmill/issues/190",
        };
        if (call.args[0] === "issue" && call.args[1] === "list")
          return { code: 0, stdout: JSON.stringify([githubIssue]), stderr: "" };
        if (call.args[0] === "issue" && call.args[1] === "view")
          return { code: 0, stdout: JSON.stringify(githubIssue), stderr: "" };
        if (call.args[0] === "label" && call.args[1] === "list")
          return { code: 0, stdout: labelListPayload(), stderr: "" };
        if (call.args[0] === "issue")
          return { code: 0, stdout: "", stderr: "" };
        if (call.args[0] === "repo" && call.args[1] === "view")
          return {
            code: 0,
            stdout: JSON.stringify({
              nameWithOwner: "acme/patchmill",
              url: "https://github.test/acme/patchmill",
            }),
            stderr: "",
          };
        if (call.args[0] === "api" && call.args[1] === "graphql") {
          const number = Number(
            call.args.find((value) => value.startsWith("number="))?.slice(7),
          );
          return {
            code: pulls.some((pull) => pull.number === number) ? 0 : 1,
            stdout: JSON.stringify({
              data: {
                repository: {
                  nameWithOwner: "acme/patchmill",
                  pullRequest: pulls.some((pull) => pull.number === number)
                    ? { number }
                    : null,
                },
              },
            }),
            stderr: "",
          };
        }
        if (call.args[0] === "pr" && call.args[1] === "list") {
          const branch = call.args[call.args.indexOf("--head") + 1];
          return {
            code: 0,
            stdout: JSON.stringify(
              pulls
                .filter((pull) => pull.branch === branch)
                .map(githubPullPayload),
            ),
            stderr: "",
          };
        }
        if (call.args[0] === "pr" && call.args[1] === "view") {
          const number = Number(call.args[2]);
          return {
            code: 0,
            stdout: JSON.stringify(
              githubPullPayload(pulls.find((pull) => pull.number === number)!),
            ),
            stderr: "",
          };
        }
        if (call.args[0] === "pr" && call.args[1] === "create") {
          const branch =
            call.args[call.args.indexOf("--head") + 1]!.split(":").at(-1)!;
          const body = call.args[call.args.indexOf("--body") + 1]!;
          const headOid = (
            await git(config.repoRoot, ["rev-parse", `refs/heads/${branch}`])
          ).stdout.trim();
          const pull = { number: nextPull++, branch, body, headOid };
          pulls.push(pull);
          return {
            code: 0,
            stdout: `https://github.test/acme/patchmill/pull/${pull.number}\n`,
            stderr: "",
          };
        }
        if (call.args[0] === "pr" && call.args[1] === "edit")
          return { code: 0, stdout: "", stderr: "" };
      }
      if (call.command === "tea" && call.args[0] === "issues") {
        if (call.args[1] === "list") {
          const page = call.args[call.args.indexOf("--page") + 1];
          return {
            code: 0,
            stdout: page === "1" ? issueListPayload([selected]) : "[]",
            stderr: "",
          };
        }
        return { code: 0, stdout: issueViewPayload(selected), stderr: "" };
      }
      if (call.command === "tea" && call.args[0] === "labels")
        return { code: 0, stdout: labelListPayload(), stderr: "" };
      if (call.command === "tea" && !call.args.includes("api"))
        return { code: 0, stdout: "", stderr: "" };
      if (call.command === "tea") {
        const path =
          call.args.find((value) => value.startsWith("/repos/")) ?? "";
        if (path.endsWith("/repos/{owner}/{repo}"))
          return { code: 0, stdout: JSON.stringify(repository()), stderr: "" };
        if (path.includes("/pulls?"))
          return {
            code: 0,
            stdout: JSON.stringify(pulls.map(pullPayload)),
            stderr: "",
          };
        if (/\/pulls\/\d+$/u.test(path)) {
          const number = Number(path.split("/").at(-1));
          return {
            code: 0,
            stdout: JSON.stringify(
              pullPayload(pulls.find((pull) => pull.number === number)!),
            ),
            stderr: "",
          };
        }
        if (path.endsWith("/pulls")) {
          const head = call.args
            .find((value) => value.startsWith("head="))!
            .slice(5)
            .split(":")
            .at(-1)!;
          const body = call.args
            .find((value) => value.startsWith("body="))!
            .slice(5);
          const headOid = (
            await git(config.repoRoot, ["rev-parse", `refs/heads/${head}`])
          ).stdout.trim();
          const pull = { number: nextPull++, branch: head, body, headOid };
          pulls.push(pull);
          return {
            code: 0,
            stdout: JSON.stringify(pullPayload(pull)),
            stderr: "",
          };
        }
      }
      throw new Error(
        `unexpected command: ${call.command} ${call.args.join(" ")}`,
      );
    },
  };
  const pullPayload = forgejoPullPayload;
  async function mergePlanningPull() {
    const pull = pulls.find((item) => item.number !== 99 && !item.merged)!;
    const merged = await git(config.repoRoot, [
      "merge",
      "--no-ff",
      `origin/${pull.branch}`,
      "-m",
      "merge planning",
    ]);
    assert.equal(merged.code, 0, merged.stderr);
    pull.mergeOid = (
      await git(config.repoRoot, ["rev-parse", "HEAD"])
    ).stdout.trim();
    pull.merged = true;
    await git(config.repoRoot, ["push", "origin", "main"]);
  }
  const effects = () =>
    calls.map((call) => `${call.command} ${call.args.join(" ")}`);
  const recorded = (): readonly RecordedScenarioPullRequest[] =>
    pulls.map((pull) => ({
      number: pull.number,
      phase:
        pull.number === 99
          ? "implementation"
          : pull.body.includes("phase=spec")
            ? "spec"
            : "plan",
      targetRepository: "acme/patchmill",
      headRepository: "acme/patchmill",
      baseBranch: "main",
      headBranch: pull.branch,
      headOid: pull.headOid,
      body: pull.body,
      status: pull.merged ? "merged" : "open",
      ...(pull.mergeOid ? { mergeOid: pull.mergeOid } : {}),
    }));
  return {
    run: async (options = {}) =>
      runOneIssue(
        runner,
        { ...config, planOnly: options.planOnly ?? false },
        { now },
      ),
    state: () => new PlanningStateStore(config.runStateDir).read(190),
    pulls: recorded,
    effects,
    mergeOpenPlanningPull: async () => mergePlanningPull(),
    closeOpenPlanningPull: () => {
      const pull = pulls.find((item) => item.number !== 99 && !item.merged);
      if (pull) pull.merged = false;
    },
    removeSavedPlanningPull: () => {
      const index = pulls.findIndex(
        (item) => item.number !== 99 && !item.merged,
      );
      if (index >= 0) pulls.splice(index, 1);
    },
    duplicateOpenPlanningPull: () => {
      const pull = pulls.find((item) => item.number !== 99 && !item.merged);
      if (pull) pulls.push({ ...pull, number: nextPull++ });
    },
    failNextHostRead: () => undefined,
    interruptAt: () => undefined,
    restorePersistence: async () => undefined,
    archiveExactStaleLock: async () => ({ fingerprint: "", archivePath: "" }),
    cleanup: async () => rm(config.repoRoot, { recursive: true, force: true }),
  };
}
